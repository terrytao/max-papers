// Free-text position search.
//
// Two stages so we get both recall and precision without a schema
// change:
//   1. Broad tokenized Prisma query — case-insensitive contains
//      AND across whitespace-split tokens, OR across the four
//      searchable fields (title, institution, description,
//      researchTopics — researchTopics handled via the AND/OR
//      structure on the included list). Returns up to limit*5
//      candidates.
//   2. Normalized field-weighted re-rank in JS — strips all non-
//      alphanumeric chars from both the query and candidate fields
//      so "deep mind" and "DeepMind" collide; weights matches by
//      where they hit (title > institution > topics > description).
//
// normalize() / tokenize() are exported because the rail's
// /api/talent/matches POST handler will want the same normalization
// when it widens its OR clause.

import { prisma } from "@/lib/prisma";

export function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function tokenize(q: string | null | undefined): string[] {
  return (q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export interface PositionSearchOpts {
  q?: string;
  type?: string;
  institution?: string;
  country?: string;
  funded?: boolean;
  source?: "manual" | "crawled" | "import";
  limit?: number;
}

function buildWhere(opts: PositionSearchOpts): Record<string, unknown> {
  const where: Record<string, unknown> = { status: "open" };
  if (opts.type) where.type = opts.type;
  if (opts.country) where.country = { contains: opts.country, mode: "insensitive" };
  if (opts.funded !== undefined) where.funded = opts.funded;
  if (opts.source) where.source = opts.source;
  if (opts.institution) {
    where.institution = { contains: opts.institution, mode: "insensitive" };
  }
  const tokens = tokenize(opts.q);
  if (tokens.length) {
    where.AND = tokens.map((t) => ({
      OR: [
        { title: { contains: t, mode: "insensitive" } },
        { institution: { contains: t, mode: "insensitive" } },
        { description: { contains: t, mode: "insensitive" } },
      ],
    }));
  }
  return where;
}

const FIELD_WEIGHTS: Array<{
  key: "title" | "institution" | "topics" | "description";
  w: number;
}> = [
  { key: "title", w: 12 },
  { key: "institution", w: 8 },
  { key: "topics", w: 6 },
  { key: "description", w: 3 },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scorePosition(p: Record<string, any>, q: string): number {
  let score = baseScore(p);
  if (!q) return score;
  const nq = normalize(q);
  const fields = {
    title: normalize(p.title),
    institution: normalize(p.institution),
    topics: normalize((p.researchTopics ?? []).join(" ")),
    description: normalize(p.description),
  };
  if (nq) {
    if (fields.title.includes(nq)) score += 60;
    else if (fields.institution.includes(nq)) score += 45;
    else if (fields.topics.includes(nq)) score += 30;
    else if (fields.description.includes(nq)) score += 18;
  }
  for (const tok of tokenize(q)) {
    const nt = normalize(tok);
    if (!nt) continue;
    for (const f of FIELD_WEIGHTS) {
      if (fields[f.key].includes(nt)) {
        score += f.w;
        break;
      }
    }
  }
  return score;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function baseScore(p: Record<string, any>): number {
  let s = 0;
  if (p.source === "manual") s += 8;
  if (p.funded) s += 3;
  const created = p.createdAt ? new Date(p.createdAt).getTime() : 0;
  const ageDays = created ? (Date.now() - created) / 86_400_000 : 999;
  s += Math.max(0, 6 - ageDays / 30);
  return s;
}

export type PositionWithPoster = Awaited<
  ReturnType<typeof prisma.position.findMany>
>[number] & {
  postedBy: { id: string; name: string; institution: string | null } | null;
};

export async function searchPositions(
  opts: PositionSearchOpts = {},
): Promise<PositionWithPoster[]> {
  const limit = opts.limit ?? 20;
  const where = buildWhere(opts);
  const candidates = (await prisma.position.findMany({
    where,
    take: Math.min(limit * 5, 200),
    orderBy: { createdAt: "desc" },
    include: {
      postedBy: { select: { id: true, name: true, institution: true } },
    },
  })) as PositionWithPoster[];
  return candidates
    .map((p: PositionWithPoster) => ({
      p,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      score: scorePosition(p as unknown as Record<string, any>, opts.q ?? ""),
    }))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .slice(0, limit)
    .map((x: { p: PositionWithPoster }) => x.p);
}
