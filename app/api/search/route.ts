// Natural-language paper search — speed-optimized.
//
// Three stages per request:
//   1. extractFilters — Claude Haiku 4.5 turns free-text into a
//      JSON filter object. Cached by query string with a 1-hour
//      TTL, so popular searches skip the API call entirely.
//   2. searchPapers   — single raw SQL statement using the GIN FTS
//      index for the topic match, with inline year / journal /
//      openAccess clauses. Author EXISTS clause merged in for AND
//      mode; OR mode runs the author query in parallel and unions
//      results. ILIKE fallback if to_tsquery throws.
//   3. generateSummary — Haiku 4.5 writes a 2-sentence synthesis
//      of the top 3 abstracts.
//
// Critical: the FTS query MUST use the same to_tsvector expression
// as the GIN index built by agents/add-fts-index.ts —
//   to_tsvector('english', coalesce(title,'') || ' ' || coalesce(abstract,''))
// Any change (substr, casting, additional concat columns) makes
// Postgres treat it as a different expression and skip the index,
// dropping us back to a sequential scan over 1M+ rows.
//
// Cost / abuse guards on a public anonymous endpoint:
//   • query ≤ 500 chars
//   • extraction max_tokens 240, summary max_tokens 180
//   • Haiku 4.5 on both calls (5-10× cheaper than Sonnet)
//   • cache entries cap 500, TTL 1h
//   • 60s wall-clock via maxDuration

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const MAX_QUERY_CHARS = 500;
const CACHE_MAX = 500;
const CACHE_TTL_MS = 60 * 60 * 1000;

// 3-layer cache config. Memory TTL shorter than DB TTL — memory is
// the hot tier (a single process), DB is the warm tier (shared across
// dev server restarts and future replicas). Both keep the same 5-min
// staleness budget; memory's lower TTL just means we re-validate
// against the DB layer faster.
const RESULT_MEM_TTL_MS = 5 * 60 * 1000;
const RESULT_DB_TTL_MS = 5 * 60 * 1000;
const RESULT_MEM_MAX = 500;

type CachedSearch = {
  papers: unknown[];
  total: number;
  filters: unknown;
  matchMode: string;
};
type ResultMemEntry = { data: CachedSearch; expires: number };
const resultMemCache = new Map<string, ResultMemEntry>();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type Filters = {
  topic?: string | null;
  author?: string | null;
  afterYear?: number | null;
  journal?: string | null;
  subtopic?: string | null;
  openAccess?: boolean | null;
  suggestions?: {
    topics?: string[];
    authors?: string[];
    journals?: string[];
  };
};

type SearchBody = {
  query?: string;
  filters?: Filters | null;
  matchMode?: "AND" | "OR";
};

// ── Filter cache ─────────────────────────────────────────────────────
// Simple Map with TTL + size cap. Eviction is FIFO via insertion order
// — sufficient for a popular-query cache; an LRU rewrite isn't worth
// the complexity at this scale.
type CacheEntry = { value: Filters; expiresAt: number };
const filterCache = new Map<string, CacheEntry>();

function cacheGet(key: string): Filters | null {
  const entry = filterCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    filterCache.delete(key);
    return null;
  }
  return entry.value;
}
function cacheSet(key: string, value: Filters): void {
  if (filterCache.size >= CACHE_MAX) {
    const oldest = filterCache.keys().next().value;
    if (oldest) filterCache.delete(oldest);
  }
  filterCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function extractFilters(query: string): Promise<Filters> {
  const key = query.toLowerCase().trim();
  const cached = cacheGet(key);
  if (cached) return cached;

  const prompt = `Extract search filters from this academic paper search query. Return JSON only, no other text.

For author names: extract even partial names — first names only, last
names only, or any combination is fine. The DB does partial matching.
"Hinton" → author: "Hinton", "Geoffrey Hinton" → author: "Geoffrey Hinton".

Query: "${query}"

Return exactly this JSON structure:
{
  "topic": "main topic — most important words only",
  "author": "author name or null",
  "afterYear": year as number or null,
  "journal": "journal/conference name or null",
  "subtopic": "secondary topic or null",
  "openAccess": true or false or null,
  "suggestions": {
    "topics": ["2-3 related topic suggestions"],
    "authors": ["related author names if author detected, else empty array"],
    "journals": ["2-3 relevant journals for this topic"]
  }
}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 240,
    messages: [{ role: "user", content: prompt }],
  });
  const text =
    res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim() || "{}";
  let parsed: Filters;
  try {
    parsed = JSON.parse(
      text.replace(/^```(?:json)?|```$/g, "").trim(),
    ) as Filters;
  } catch {
    parsed = { topic: query };
  }
  cacheSet(key, parsed);
  return parsed;
}

// ── Paper search ─────────────────────────────────────────────────────
type PaperRow = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  abstract: string;
  isOpenAccess: boolean;
  citationCount: number;
  pdfUrl: string | null;
  url: string | null;
  fields: string[];
};

function tokenizeTopic(topic: string): string[] {
  // 2-char floor — keep AI / ML / CV / NLP. Strip non-alphanum so the
  // tsquery we hand to Postgres doesn't include reserved chars that
  // to_tsquery rejects (e.g. ":*" from "&:*" if a token reduces to "").
  return topic
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length >= 2)
    .slice(0, 8); // cap so a paragraph topic doesn't generate a huge tsquery
}

function buildTsQuery(words: string[]): string {
  // `:*` enables prefix matching ("neur:*" → neural, neuroscience).
  // `&` requires all tokens to appear.
  return words.map((w) => `${w}:*`).join(" & ");
}

async function searchByAuthor(author: string): Promise<Set<string>> {
  const parts = author
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[.,;]/g, ""))
    .filter((p) => p.length > 1);
  if (parts.length === 0) return new Set();
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  const likeClauses = parts.map(
    (p) => Prisma.sql`a ILIKE ${`%${esc(p)}%`}`,
  );
  const conjunction = Prisma.join(likeClauses, " AND ");
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Paper"
    WHERE EXISTS (
      SELECT 1 FROM unnest(authors) AS a
      WHERE ${conjunction}
    )
    LIMIT 500
  `);
  return new Set(rows.map((r) => r.id));
}

async function searchPapers(
  filters: Filters,
  matchMode: "AND" | "OR",
): Promise<PaperRow[]> {
  const topic = filters.topic?.trim() ?? "";
  const words = tokenizeTopic(topic);
  const hasTopic = words.length > 0;
  const hasAuthor = !!filters.author?.trim();

  // Nothing to search on — empty result is correct.
  if (!hasTopic && !hasAuthor) return [];

  // Author search runs in parallel with the FTS query so AND mode
  // can intersect without a round-trip serialization.
  const authorPromise = hasAuthor
    ? searchByAuthor(filters.author!.trim())
    : Promise.resolve<Set<string> | null>(null);

  let papers: PaperRow[] = [];
  if (hasTopic) {
    const tsQuery = buildTsQuery(words);
    // Inline filter clauses — Prisma.sql composes them safely.
    // CRITICAL: the to_tsvector expression here MUST match the GIN
    // index (agents/add-fts-index.ts) exactly. Don't add substr() or
    // any other transformation, or the planner will skip the index.
    const yearClause =
      typeof filters.afterYear === "number" && filters.afterYear > 1900
        ? Prisma.sql`AND year >= ${filters.afterYear}`
        : Prisma.empty;
    const journalClause = filters.journal?.trim()
      ? Prisma.sql`AND journal ILIKE ${"%" + filters.journal.trim() + "%"}`
      : Prisma.empty;
    const openAccessClause = filters.openAccess === true
      ? Prisma.sql`AND "isOpenAccess" = true`
      : Prisma.empty;

    try {
      papers = await prisma.$queryRaw<PaperRow[]>(Prisma.sql`
        SELECT
          id, title, authors, year, journal, abstract,
          "isOpenAccess", "citationCount", "pdfUrl", url, fields
        FROM "Paper"
        WHERE to_tsvector('english',
                coalesce(title, '') || ' ' || coalesce(abstract, ''))
              @@ to_tsquery('english', ${tsQuery})
          ${yearClause}
          ${journalClause}
          ${openAccessClause}
        ORDER BY
          ts_rank(
            to_tsvector('english',
              coalesce(title, '') || ' ' || coalesce(abstract, '')),
            to_tsquery('english', ${tsQuery})
          ) DESC,
          "citationCount" DESC
        LIMIT 50
      `);
    } catch (err) {
      // to_tsquery throws on malformed input (e.g. when the english
      // dictionary drops all tokens as stopwords). Fall back to ILIKE
      // — slower but defensible, won't 500 the route.
      console.error("[search] FTS failed, ILIKE fallback:", (err as Error).message);
      papers = (await prisma.paper.findMany({
        where: {
          OR: [
            { title: { contains: topic, mode: "insensitive" } },
            { abstract: { contains: topic, mode: "insensitive" } },
          ],
        },
        take: 50,
        orderBy: [{ citationCount: "desc" }, { publishedAt: "desc" }],
        select: {
          id: true, title: true, authors: true, year: true, journal: true,
          abstract: true, isOpenAccess: true, citationCount: true,
          pdfUrl: true, url: true, fields: true,
        },
      })) as PaperRow[];
    }
  }

  const authorIds = await authorPromise;

  if (matchMode === "AND" && hasAuthor && authorIds) {
    if (hasTopic) {
      papers = papers.filter((p) => authorIds.has(p.id));
    } else {
      // Author-only search.
      papers = (await prisma.paper.findMany({
        where: { id: { in: Array.from(authorIds) } },
        take: 50,
        orderBy: { citationCount: "desc" },
        select: {
          id: true, title: true, authors: true, year: true, journal: true,
          abstract: true, isOpenAccess: true, citationCount: true,
          pdfUrl: true, url: true, fields: true,
        },
      })) as PaperRow[];
    }
  } else if (matchMode === "OR" && hasAuthor && authorIds && authorIds.size > 0) {
    // Union FTS results with author hits, dedupe, order by citation.
    const existingIds = new Set(papers.map((p) => p.id));
    const newAuthorIds = Array.from(authorIds).filter(
      (id) => !existingIds.has(id),
    );
    if (newAuthorIds.length > 0) {
      const authorPapers = (await prisma.paper.findMany({
        where: { id: { in: newAuthorIds } },
        take: 50,
        orderBy: { citationCount: "desc" },
        select: {
          id: true, title: true, authors: true, year: true, journal: true,
          abstract: true, isOpenAccess: true, citationCount: true,
          pdfUrl: true, url: true, fields: true,
        },
      })) as PaperRow[];
      papers = [...papers, ...authorPapers];
    }
  }

  return papers.slice(0, 10);
}

// ── Simple-query heuristic ───────────────────────────────────────────
// Detects whether a free-text query carries filter signals beyond a
// plain topic. If it doesn't, we skip the AI extraction call entirely
// and use the query as the FTS topic directly — typical 1-2 second
// latency win on every "what's new in X" search.
//
// Trade-off: false negatives (we treat a complex query as simple)
// would silently drop filters; false positives (we treat a simple
// query as complex) just pay the extraction cost unnecessarily.
// Erring on the false-positive side is safe — extraction is cached
// so the cost is amortized to once per unique query.
function isSimpleQuery(query: string): boolean {
  // Author signals: "by X", "Hinton et al", "author: ...", titles
  if (/\b(by|author|professor|dr\.?|prof\.?)\b/i.test(query)) return false;
  // Year signals: "after 2024", "since 2020", "in 2023", "before 2010"
  if (/\b(after|before|since|in)\s+\d{4}\b/i.test(query)) return false;
  // Journal signals — bare "in" is too broad ("robotics in healthcare"
  // would false-flag), so only catch "journal" / "published" /
  // "published in".
  if (/\b(journal|published)\b/i.test(query)) return false;
  // Open-access signal
  if (/\bopen[\s-]?access\b/i.test(query)) return false;
  return true;
}

// ── Cache helpers ────────────────────────────────────────────────────
// Normalize the filter object before hashing so {topic, author} and
// {author, topic} produce the same key. We don't strip null fields —
// caller supplying explicit nulls means "no filter" and should match
// a key built without those fields, so undefined and null collapse.
function stableJSON(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableJSON).join(",")}]`;
  const entries = Object.entries(obj as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJSON(v)}`).join(",")}}`;
}

function makeCacheKey(query: string, filters: unknown, matchMode: string): string {
  return createHash("md5")
    .update(stableJSON({ query, filters, matchMode }))
    .digest("hex");
}

function memCacheSet(key: string, data: CachedSearch): void {
  if (resultMemCache.size >= RESULT_MEM_MAX) {
    const oldest = resultMemCache.keys().next().value;
    if (oldest !== undefined) resultMemCache.delete(oldest);
  }
  resultMemCache.set(key, { data, expires: Date.now() + RESULT_MEM_TTL_MS });
}

// Wraps the existing pipeline in one function so the cache layers can
// memoize a single call boundary.
async function runSearch(
  query: string,
  bodyFilters: Filters | null,
  matchMode: "AND" | "OR",
): Promise<CachedSearch> {
  let filters: Filters | null = bodyFilters;
  if (!filters && query) {
    if (isSimpleQuery(query)) {
      filters = { topic: query };
    } else {
      try {
        filters = await extractFilters(query);
      } catch (err) {
        filters = { topic: query };
        console.error("[search] extraction failed:", (err as Error).message);
      }
    }
  }
  filters = filters ?? { topic: query };
  const papers = await searchPapers(filters, matchMode);
  return {
    papers,
    total: papers.length,
    filters,
    matchMode,
  };
}

// ── Handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = (body.query ?? "").trim().slice(0, MAX_QUERY_CHARS);
  const matchMode: "AND" | "OR" = body.matchMode === "OR" ? "OR" : "AND";
  const bodyFilters: Filters | null = body.filters ?? null;

  if (!bodyFilters && !query) {
    return Response.json({ error: "query or filters required" }, { status: 400 });
  }

  const cacheKey = makeCacheKey(query, bodyFilters, matchMode);

  // ── L1: in-process memory (sub-ms hit) ─────────────────────────────
  const mem = resultMemCache.get(cacheKey);
  if (mem && mem.expires > Date.now()) {
    return jsonWithCache({ ...mem.data, cache: "memory" });
  }

  // ── L2: shared DB cache (~10-30ms hit) ─────────────────────────────
  try {
    const dbHit = await prisma.searchCache.findFirst({
      where: { queryHash: cacheKey, expiresAt: { gt: new Date() } },
      select: { id: true, results: true },
    });
    if (dbHit) {
      const data = dbHit.results as unknown as CachedSearch;
      memCacheSet(cacheKey, data);
      // Increment hit count fire-and-forget — never block the response
      prisma.searchCache
        .update({ where: { id: dbHit.id }, data: { hitCount: { increment: 1 } } })
        .catch((err) => {
          console.error("[search] hitCount update failed:", err.message);
        });
      return jsonWithCache({ ...data, cache: "db" });
    }
  } catch (err) {
    // Don't fail the request on cache lookup failure — fall through
    // to live search.
    console.error("[search] L2 lookup failed:", (err as Error).message);
  }

  // ── L3: live search ────────────────────────────────────────────────
  const result = await runSearch(query, bodyFilters, matchMode);

  // Save to both cache layers. DB write is fire-and-forget so we don't
  // pay write latency on the response path.
  memCacheSet(cacheKey, result);
  const expiresAt = new Date(Date.now() + RESULT_DB_TTL_MS);
  prisma.searchCache
    .upsert({
      where: { queryHash: cacheKey },
      create: {
        queryHash: cacheKey,
        query: query.slice(0, MAX_QUERY_CHARS),
        results: result as unknown as Prisma.InputJsonValue,
        expiresAt,
      },
      update: {
        results: result as unknown as Prisma.InputJsonValue,
        expiresAt,
        hitCount: { increment: 1 },
      },
    })
    .catch((err) => {
      console.error("[search] L2 write failed:", err.message);
    });

  return jsonWithCache({ ...result, cache: "miss" });
}

// Build a Response with the Cache-Control header set. CDNs and
// reverse proxies (Cloudflare, Amplify edge) will cache the same
// payload for 5 min; stale-while-revalidate gives 60s of "serve
// stale while we re-fetch in background" smoothness.
function jsonWithCache(body: unknown): Response {
  const res = Response.json(body);
  res.headers.set(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=60",
  );
  return res;
}

// Admin / cron-triggered cleanup. Gated by CRON_SECRET in env —
// open in dev (env unset) but locked in prod once the secret is
// configured. Without this, anyone could DoS by repeatedly purging.
export async function DELETE(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.nextUrl.searchParams.get("secret") !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const deleted = await prisma.searchCache.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return Response.json({ deleted: deleted.count });
}
