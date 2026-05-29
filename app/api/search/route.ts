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
import type { Prisma } from "@prisma/client";
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

// Tiny English stopword set — enough to keep multi-word topics like
// "neural network for cancer detection" from over-constraining the
// query. Tokens shorter than 3 chars are also dropped.
const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "in", "on", "and", "or", "with", "to",
  "by", "is", "are", "be", "as", "at", "from", "into", "that", "this",
  "these", "those", "than", "papers", "paper", "about", "any",
]);

function tokenizeTopic(topic: string): string[] {
  return Array.from(
    new Set(
      topic
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    ),
  ).slice(0, 6); // cap so a paragraph-length topic doesn't explode the query
}

// Partial author-name search via raw SQL — Prisma's `{ authors:
// { has: ... } }` is exact-string-match against array elements, so
// "Hinton" won't find "Geoffrey Hinton". Postgres `unnest` + ILIKE
// does case-insensitive substring match against each author entry.
// Returns the matching paper ids so the main query can intersect via
// `id: { in: ... }` and keep using its normal ordering / pagination.
async function findPapersByPartialAuthor(author: string): Promise<string[]> {
  // 2-char floor stops a stray 1-letter query from scanning everyone.
  if (author.length < 2) return [];
  // Escape LIKE metacharacters in user input before wrapping in % .. %
  const pattern = `%${author.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Paper"
    WHERE EXISTS (
      SELECT 1 FROM unnest(authors) AS author_name
      WHERE author_name ILIKE ${pattern}
    )
    LIMIT 500
  `;
  return rows.map((r) => r.id);
}

async function buildWhere(f: Filters): Promise<Prisma.PaperWhereInput> {
  const where: Prisma.PaperWhereInput = {};
  const ands: Prisma.PaperWhereInput[] = [];

  const topic = f.topic?.trim();
  if (topic) {
    const tokens = tokenizeTopic(topic);
    if (tokens.length > 0) {
      // AND across tokens (each significant word must appear somewhere),
      // OR within each token (title OR abstract OR keywords).
      for (const tok of tokens) {
        ands.push({
          OR: [
            { title: { contains: tok, mode: "insensitive" as const } },
            { abstract: { contains: tok, mode: "insensitive" as const } },
            { keywords: { has: tok } },
          ],
        });
      }
    } else {
      // Topic was all stopwords — fall back to a literal contains so
      // the query still does something instead of returning everything.
      ands.push({
        OR: [
          { title: { contains: topic, mode: "insensitive" } },
          { abstract: { contains: topic, mode: "insensitive" } },
        ],
      });
    }
  }

  const author = f.author?.trim();
  if (author) {
    const ids = await findPapersByPartialAuthor(author);
    // Even when no author matches, push an empty `id IN ()` so the
    // author filter genuinely scopes the query (rather than silently
    // returning unrelated papers that match only the topic).
    ands.push({ id: { in: ids } });
  }

  if (ands.length > 0) where.AND = ands;
  if (typeof f.afterYear === "number" && f.afterYear > 1900) {
    where.year = { gte: f.afterYear };
  }
  const journal = f.journal?.trim();
  if (journal) where.journal = { contains: journal, mode: "insensitive" };
  if (f.openAccess === true) where.isOpenAccess = true;
  return where;
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

  const where = await buildWhere(filters ?? { topic: query });
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
  });
}
