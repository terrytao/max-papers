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

// POST — return positions + PUBLIC candidates with full detail +
// PRIVATE candidate aggregate count. Body accepts `topics: string[]`
// (preferred) or `topic: string` (back-compat with the v1 shape).
//
// Visibility split:
//   • visibility = "public" | "open" → row appears in `candidates`
//     with name, institution, top papers, contact-ready actions
//   • visibility = "private"          → counted only; nothing about
//     the row is exposed beyond "N candidates publish on this topic"
//   The default is "private" (set on the schema), so newly-created
//   profiles aren't auto-leaked. Users opt-in to being visible.
//
// Performance notes carried from v1:
//   • Positions table is small; OR across researchTopics +
//     description-contains is fine
//   • Candidate query goes through ProfilePaper → Paper. Uses
//     fields[]/keywords[] hasSome (GIN-indexed) NOT title-contains
//     (would seq-scan 2M+ rows). Same fix as v1.
export async function POST(req: NextRequest) {
  let body: { topic?: string; topics?: string[] };
  try {
    body = (await req.json()) as { topic?: string; topics?: string[] };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const topicList = (
    Array.isArray(body.topics) ? body.topics : body.topic ? [body.topic] : []
  )
    .map((t) => String(t ?? "").trim())
    .filter((t) => t.length > 0 && t.length <= 200)
    .slice(0, 8);

  if (topicList.length === 0) {
    return Response.json({
      positions: [],
      candidates: [],
      privateCandidateCount: 0,
      total: 0,
    });
  }
  const topicsLower = topicList.map((t) => t.toLowerCase());

  // Shared paper-filter used by both candidate queries.
  const paperSomeWhere = {
    some: {
      paper: {
        OR: [
          { fields: { hasSome: topicList } },
          { keywords: { hasSome: topicsLower } },
        ],
      },
    },
  };

  const positionsP = prisma.position.findMany({
    where: {
      status: "open",
      // Widened so institution/title hits surface too — without
      // these, an institution like "DeepMind" wouldn't match any
      // position even when a Position.institution = "DeepMind"
      // existed in the DB.
      OR: [
        { researchTopics: { hasSome: topicList } },
        ...topicList.map((t) => ({
          description: { contains: t, mode: "insensitive" as const },
        })),
        ...topicList.map((t) => ({
          institution: { contains: t, mode: "insensitive" as const },
        })),
        ...topicList.map((t) => ({
          title: { contains: t, mode: "insensitive" as const },
        })),
      ],
    },
    take: 5,
    orderBy: [{ createdAt: "desc" }],
    include: {
      postedBy: { select: { id: true, name: true, institution: true } },
    },
  });

  // Public candidates — full detail.
  const publicCandidatesP = prisma.researchProfile.findMany({
    where: {
      visibility: { in: ["public", "open"] },
      lookingFor: { isEmpty: false },
      papers: paperSomeWhere,
    },
    take: 5,
    orderBy: [{ totalCitations: "desc" }, { paperCount: "desc" }],
    include: {
      papers: {
        include: {
          paper: {
            select: {
              id: true,
              title: true,
              journal: true,
              year: true,
              citationCount: true,
              keywords: true,
              fields: true,
            },
          },
        },
        orderBy: { paper: { citationCount: "desc" } },
        take: 3,
      },
    },
  });

  // Private candidates — count only; never expose row data.
  const privateCountP = prisma.researchProfile.count({
    where: {
      visibility: "private",
      lookingFor: { isEmpty: false },
      papers: paperSomeWhere,
    },
  });

  const [positions, publicCandidates, privateCandidateCount] = await Promise.all(
    [positionsP, publicCandidatesP, privateCountP],
  );

  const scoredCandidates = publicCandidates
    .map((c) => {
      const candidateTopics = c.papers.flatMap((pp) => [
        ...pp.paper.keywords,
        ...pp.paper.fields,
      ]);
      const overlap = topicList.filter((t) =>
        candidateTopics.some((ct) => ct.toLowerCase().includes(t.toLowerCase())),
      ).length;
      const citationBonus = Math.min(20, c.totalCitations / 100);
      const score = Math.min(99, 50 + overlap * 15 + citationBonus);
      const topPaper = c.papers[0]?.paper ?? null;
      const researchTopics = Array.from(new Set(candidateTopics)).slice(0, 4);
      return {
        id: c.id,
        name: c.name,
        institution: c.institution,
        title: c.title,
        lookingFor: c.lookingFor,
        availableFrom: c.availableFrom,
        paperCount: c.paperCount,
        totalCitations: c.totalCitations,
        hIndex: c.hIndex,
        visibility: c.visibility,
        topPaper: topPaper
          ? {
              title: topPaper.title,
              journal: topPaper.journal,
              year: topPaper.year,
              citationCount: topPaper.citationCount,
            }
          : null,
        researchTopics,
        score: Math.round(score),
      };
    })
    .sort((a, b) => b.score - a.score);

  const scoredPositions = positions
    .map((p) => {
      const overlap = topicList.filter((t) => {
        const lt = t.toLowerCase();
        return (
          p.researchTopics.some((rt) => rt.toLowerCase().includes(lt)) ||
          p.description.toLowerCase().includes(lt) ||
          (p.institution ?? "").toLowerCase().includes(lt) ||
          p.title.toLowerCase().includes(lt)
        );
      }).length;
      const score = Math.min(99, 50 + overlap * 20 + (p.funded ? 5 : 0));
      return { ...p, score: Math.round(score) };
    })
    .sort((a, b) => b.score - a.score);

  return Response.json({
    positions: scoredPositions,
    candidates: scoredCandidates,
    privateCandidateCount,
    total: scoredCandidates.length + privateCandidateCount,
  });
}
