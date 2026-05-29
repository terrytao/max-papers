// /api/talent/matches — two unrelated endpoints share this path:
//
//   GET ?profileId=<cuid>  → a single researcher's pre-computed
//                            Match rows, ordered by score. Used by
//                            the talent hub "My matches" tab.
//   POST { topic }         → open positions + available candidates
//                            matching a search topic. Used by the
//                            homepage's right-rail "matching jobs +
//                            candidates" panel that fires alongside
//                            paper search.
//
// Different semantics, different consumers — kept in one file
// because Next.js routes are path-based and splitting would add a
// new directory without real benefit.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const profileId = sp.get("profileId");
  if (!profileId) {
    return Response.json(
      { error: "profileId query param required" },
      { status: 400 },
    );
  }
  const minScore = Math.max(0, Number(sp.get("minScore") ?? 30));
  const limit = Math.min(Number(sp.get("limit") ?? 20), 50);

  const matches = await prisma.match.findMany({
    where: { profileId, score: { gte: minScore } },
    take: limit,
    orderBy: { score: "desc" },
    include: {
      position: {
        include: {
          postedBy: { select: { id: true, name: true, institution: true } },
        },
      },
    },
  });
  return Response.json({ count: matches.length, results: matches });
}

// POST { topic } — return open positions and available candidates
// matching the topic. Designed for the homepage right-rail; called
// in parallel with /api/search so the user sees jobs/candidates
// surface alongside paper results.
//
// Performance notes:
//   • Positions table is small (~tens-hundreds). Filtering is
//     cheap; OR across topics + title + description is fine.
//   • Candidates query goes through ProfilePaper → Paper. The
//     spec's title-contains predicate would seq-scan 2M+ rows;
//     dropped in favor of fields[]/keywords[] array-has which
//     hits the existing GIN indexes. That's the signal that
//     actually matters anyway (a paper's topic tags > whether
//     the user's typed-word appears verbatim in the title).
export async function POST(req: NextRequest) {
  let body: { topic?: string };
  try {
    body = (await req.json()) as { topic?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const topic = (body.topic ?? "").trim().slice(0, 200);
  if (!topic) {
    return Response.json({ positions: [], candidates: [] });
  }
  const topicLower = topic.toLowerCase();

  // Positions matching the topic — open status, OR across
  // researchTopics array-has, title/description contains.
  const positionsP = prisma.position.findMany({
    where: {
      status: "open",
      OR: [
        { researchTopics: { hasSome: [topic] } },
        { title: { contains: topic, mode: "insensitive" } },
        { description: { contains: topic, mode: "insensitive" } },
      ],
    },
    take: 5,
    orderBy: [{ createdAt: "desc" }],
    include: {
      postedBy: {
        select: { id: true, name: true, institution: true },
      },
    },
  });

  // Candidates: researchers who are lookingFor SOMETHING and have
  // at least one paper tagged with this topic (via Paper.fields[]
  // or Paper.keywords[] — both array-has, both GIN-indexable).
  const candidatesP = prisma.researchProfile.findMany({
    where: {
      lookingFor: { isEmpty: false },
      papers: {
        some: {
          paper: {
            OR: [
              { fields: { has: topic } },
              { keywords: { has: topicLower } },
            ],
          },
        },
      },
    },
    take: 5,
    include: {
      papers: {
        include: {
          paper: {
            select: {
              title: true,
              citationCount: true,
              year: true,
            },
          },
        },
        orderBy: { paper: { citationCount: "desc" } },
        take: 1,
      },
    },
  });

  const [positions, candidates] = await Promise.all([positionsP, candidatesP]);

  // Heuristic scores so the panels can rank instead of newest-first.
  const scoredPositions = positions
    .map((p) => ({
      ...p,
      score: scorePosition(p, topic),
    }))
    .sort((a, b) => b.score - a.score);

  const scoredCandidates = candidates
    .map((c) => ({
      ...c,
      score: scoreCandidate(c),
    }))
    .sort((a, b) => b.score - a.score);

  return Response.json({
    positions: scoredPositions,
    candidates: scoredCandidates,
  });
}

function scorePosition(
  p: {
    researchTopics: string[];
    title: string;
    funded: boolean;
  },
  topic: string,
): number {
  let score = 50;
  if (p.researchTopics.includes(topic)) score += 30;
  if (p.title.toLowerCase().includes(topic.toLowerCase())) score += 15;
  if (p.funded) score += 5;
  return Math.min(score, 99);
}

function scoreCandidate(c: {
  papers: Array<{ paper: { citationCount: number } }>;
}): number {
  let score = 50;
  const top = c.papers[0]?.paper;
  if (top && top.citationCount > 100) score += 20;
  if (top && top.citationCount > 500) score += 15;
  if (c.papers.length > 5) score += 10;
  return Math.min(score, 99);
}
