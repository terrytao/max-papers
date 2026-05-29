// Natural-language paper search.
//
// Two Claude calls per request:
//   1. Filter extraction — turns a free-text query into a JSON
//      filter object (topic / author / year / journal / open access)
//      plus suggested adjacent values for the UI's filter chips.
//   2. Summary — 2-sentence plain-English synthesis of the top 3
//      result abstracts.
//
// Both calls use Haiku 4.5: structured JSON + short prose are well
// within its quality envelope, and this is an anonymous public
// endpoint where Sonnet/Opus would be a wallet exposure.
//
// Hard caps (cost / abuse guards):
//   • query ≤ 500 chars
//   • extraction max_tokens 400
//   • summary max_tokens 220
//   • DB result cap 10 (15 with filter override)
//   • 30s wall-clock per Anthropic call (AbortSignal)
//
// When the user edits a filter and re-POSTs with `filters` already
// populated, we skip the extraction call and only run the DB query
// + summary. That keeps filter-tweak interactions snappy.

import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const MAX_QUERY_CHARS = 500;

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

async function extractFilters(query: string): Promise<Filters> {
  const prompt = `Extract search filters from this academic paper search query. Return JSON only, no other text.

Query: "${query}"

For author names: extract even partial names — first names only,
last names only, or any combination is fine. The DB does partial
matching, so "Hinton" → author: "Hinton", "Geoffrey" → author:
"Geoffrey", "LeCun" → author: "LeCun", "Geoffrey Hinton" → author:
"Geoffrey Hinton". Don't over-normalize — return what the user typed.

Return exactly this JSON structure:
{
  "topic": "main topic to search for",
  "author": "author name or null",
  "afterYear": year as number or null,
  "journal": "journal/conference name or null",
  "subtopic": "secondary topic or null",
  "openAccess": true or false or null,
  "suggestions": {
    "topics": ["3 related topic suggestions"],
    "authors": ["related author names if author detected, else empty array"],
    "journals": ["relevant journals for this topic"]
  }
}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });
  const text =
    res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim() || "{}";
  try {
    return JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim()) as Filters;
  } catch {
    return { topic: query };
  }
}

// Flexible author-name search via raw SQL.
//
// Prisma's `{ authors: { has: ... } }` is exact-string match against
// array elements, so "Hinton" won't find "Geoffrey Hinton". We use
// Postgres `unnest(authors) ILIKE` instead — but also: if the user
// types multiple words ("Peter Smith"), we want each word to match
// somewhere in the same author entry, in any order. That handles
// "Smith, Peter" and "Peter J. Smith" as well as the original
// "Peter Smith".
//
// What it still misses: "Peter" matching "P. Smith". Initial-vs-
// full-name aliasing is a name-normalization problem; substring
// search alone can't solve it.
//
// Returns the matching paper ids so the main query can intersect via
// `id: { in: ... }` and keep its normal ordering / pagination.
async function findPapersByPartialAuthor(author: string): Promise<string[]> {
  // 2-char floor stops a stray 1-letter query from scanning everyone.
  if (author.length < 2) return [];
  // Split on whitespace; drop 1-char fragments (initials etc.) so we
  // don't AND in noise like "p." matching every author with a P.
  const parts = author
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[.,;]/g, ""))
    .filter((p) => p.length > 1);
  if (parts.length === 0) return [];

  // Escape LIKE metacharacters so a user-typed % / _ / \ is literal.
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  const likeClauses = parts.map(
    (p) => Prisma.sql`a ILIKE ${`%${esc(p)}%`}`,
  );
  // AND every part — one author entry must contain ALL of them.
  const conjunction = Prisma.join(likeClauses, " AND ");

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Paper"
    WHERE EXISTS (
      SELECT 1 FROM unnest(authors) AS a
      WHERE ${conjunction}
    )
    LIMIT 1000
  `);
  return rows.map((r) => r.id);
}

// Postgres FTS topic search.
//
// Replaces the old tokenized-ILIKE topic branch: at 100k+ rows ILIKE
// over title+abstract is a slow sequential scan. With a GIN index
// on `to_tsvector('english', title || ' ' || abstract)`
// (created by agents/add-fts-index.ts) this is index-backed and
// 10-100× faster.
//
// Returns matching paper ids, ranked by ts_rank desc then citation
// count desc. The caller folds them into the where via
// `id: { in: ids }`, so all the other structured filters (author,
// year, journal, openAccess) and AND/OR mode keep working through
// the existing Prisma path. The Prisma main query orders by
// citationCount within the FTS-matched set — same tradeoff as the
// author helper: filter via raw SQL, order via the typed query.
async function searchPaperIdsByFTS(query: string): Promise<string[]> {
  // Token guard: drop 1-char fragments and non-alphanum noise so the
  // tsquery we hand to Postgres doesn't include things like ':*' that
  // tsquery rejects. Keep 2-char tokens so common acronyms (AI / ML
  // / CV) still search.
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length >= 2)
    .slice(0, 8); // paragraph-length topic shouldn't generate a huge tsquery
  if (tokens.length === 0) return [];

  // `:*` enables prefix matching (so "neur:*" matches "neural",
  // "neuroscience", "neurotransmitter"). `&` is AND across tokens.
  const tsQuery = tokens.map((t) => `${t}:*`).join(" & ");

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "Paper"
      WHERE to_tsvector('english', coalesce(title, '') || ' ' || coalesce(abstract, ''))
        @@ to_tsquery('english', ${tsQuery})
      ORDER BY
        ts_rank(
          to_tsvector('english', coalesce(title, '') || ' ' || coalesce(abstract, '')),
          to_tsquery('english', ${tsQuery})
        ) DESC,
        "citationCount" DESC
      LIMIT 200
    `;
    return rows.map((r) => r.id);
  } catch (err) {
    // to_tsquery throws on malformed input ("&" alone, all stopwords
    // dropped, etc.). Don't take the API down for a search hiccup —
    // return empty so the topic filter becomes a no-op.
    console.error(
      "[search] FTS query failed for tsQuery=" +
        JSON.stringify(tsQuery) +
        ": " +
        (err as Error).message,
    );
    return [];
  }
}

async function buildConditions(f: Filters): Promise<Prisma.PaperWhereInput[]> {
  const conds: Prisma.PaperWhereInput[] = [];

  const topic = f.topic?.trim();
  if (topic) {
    const ftsIds = await searchPaperIdsByFTS(topic);
    // Push even an empty array — in AND mode that correctly returns
    // zero results when the topic doesn't match anything; in OR mode
    // it's a no-op group.
    conds.push({ id: { in: ftsIds } });
  }

  const author = f.author?.trim();
  if (author) {
    const ids = await findPapersByPartialAuthor(author);
    // Even an empty ids[] is pushed — in AND mode that correctly
    // zeros out the result; in OR mode it's a no-op group.
    conds.push({ id: { in: ids } });
  }

  if (typeof f.afterYear === "number" && f.afterYear > 1900) {
    conds.push({ year: { gte: f.afterYear } });
  }
  const journal = f.journal?.trim();
  if (journal) {
    conds.push({ journal: { contains: journal, mode: "insensitive" } });
  }
  if (f.openAccess === true) {
    conds.push({ isOpenAccess: true });
  }

  return conds;
}

async function buildWhere(
  f: Filters,
  mode: "AND" | "OR",
): Promise<Prisma.PaperWhereInput> {
  const conds = await buildConditions(f);
  if (conds.length === 0) return {};
  return mode === "OR" ? { OR: conds } : { AND: conds };
}

async function generateSummary(
  topic: string,
  papers: Array<{ title: string; abstract: string }>,
): Promise<string> {
  if (papers.length === 0) return "";
  const prompt = `Write a 2-sentence plain-English summary of what these papers say about "${topic}". Be specific, cite findings.

Papers:
${papers
  .slice(0, 3)
  .map((p) => `- ${p.title}: ${(p.abstract ?? "").slice(0, 200)}`)
  .join("\n")}

Return only the summary, no preamble.`;
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 220,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function POST(req: NextRequest) {
  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = (body.query ?? "").trim().slice(0, MAX_QUERY_CHARS);
  const matchMode: "AND" | "OR" = body.matchMode === "OR" ? "OR" : "AND";
  let filters: Filters | null = body.filters ?? null;

  if (!filters && !query) {
    return Response.json({ error: "query or filters required" }, { status: 400 });
  }

  try {
    if (!filters && query) {
      filters = await extractFilters(query);
    }
  } catch (err) {
    // If Claude trips, fall back to a basic topic-only filter so
    // the search still works (just without smart extraction).
    filters = { topic: query };
    console.error("[search] extraction failed:", (err as Error).message);
  }

  const where = await buildWhere(filters ?? { topic: query }, matchMode);
  const [papers, total] = await Promise.all([
    prisma.paper.findMany({
      where,
      take: 10,
      orderBy: [{ citationCount: "desc" }, { publishedAt: "desc" }],
    }),
    prisma.paper.count({ where }),
  ]);

  let summary = "";
  try {
    summary = await generateSummary(
      filters?.topic ?? query,
      papers.map((p) => ({ title: p.title, abstract: p.abstract })),
    );
  } catch (err) {
    console.error("[search] summary failed:", (err as Error).message);
  }

  return Response.json({
    papers,
    total,
    summary,
    filters,
    matchMode,
  });
}
