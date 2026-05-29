// POST — link a Paper to a ResearchProfile via the ProfilePaper join.
//        Accepts { paperId } (cuid of an existing Paper row).
//        Refreshes the cached paperCount + totalCitations on the
//        profile so the matching engine has fresh metrics.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const paperId = typeof body.paperId === "string" ? body.paperId : "";
  if (!paperId) {
    return Response.json({ error: "paperId is required" }, { status: 400 });
  }

  // Verify the paper exists before creating the join — better error
  // than a generic FK violation from the join insert.
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: { id: true, citationCount: true },
  });
  if (!paper) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  try {
    await prisma.profilePaper.create({
      data: { profileId: ctx.params.id, paperId },
    });
  } catch (err) {
    // Either profile doesn't exist (FK) or duplicate (@@unique).
    const msg = (err as Error).message ?? "";
    if (msg.includes("Unique constraint")) {
      return Response.json(
        { status: "already_linked" },
        { status: 200 },
      );
    }
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }

  // Refresh cached metrics on the profile.
  const agg = await prisma.profilePaper.findMany({
    where: { profileId: ctx.params.id },
    include: { paper: { select: { citationCount: true } } },
  });
  await prisma.researchProfile.update({
    where: { id: ctx.params.id },
    data: {
      paperCount: agg.length,
      totalCitations: agg.reduce((sum, pp) => sum + pp.paper.citationCount, 0),
    },
  });

  return Response.json({ status: "linked" });
}
