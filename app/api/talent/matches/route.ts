// GET ?profileId=<cuid> — matches for a given profile, ordered by
// score desc. No auth gate: anyone can read anyone's match list
// (same trust model as the rest of the talent surface in v1).

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
