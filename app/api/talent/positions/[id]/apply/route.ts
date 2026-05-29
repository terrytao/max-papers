// POST — submit an application from { applicantId, coverLetter? }
// to a position. If a Match row exists for the (position, applicant)
// pair, attach it as the matchId so the PI sees the score alongside
// the application.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const applicantId =
    typeof body.applicantId === "string" ? body.applicantId.trim() : "";
  if (!applicantId) {
    return Response.json({ error: "applicantId is required" }, { status: 400 });
  }
  const coverLetter =
    typeof body.coverLetter === "string"
      ? body.coverLetter.trim().slice(0, 10000)
      : null;

  const [position, applicant] = await Promise.all([
    prisma.position.findUnique({
      where: { id: ctx.params.id },
      select: { id: true, status: true },
    }),
    prisma.researchProfile.findUnique({
      where: { id: applicantId },
      select: { id: true },
    }),
  ]);
  if (!position) {
    return Response.json({ error: "Position not found" }, { status: 404 });
  }
  if (position.status !== "open") {
    return Response.json(
      { error: "Position is not open for applications" },
      { status: 400 },
    );
  }
  if (!applicant) {
    return Response.json({ error: "applicantId does not resolve" }, { status: 400 });
  }

  // If we already have a match row for this pair, attach it so the
  // PI sees the score in the dashboard.
  const match = await prisma.match.findUnique({
    where: {
      positionId_profileId: {
        positionId: ctx.params.id,
        profileId: applicantId,
      },
    },
    select: { id: true },
  });

  try {
    const application = await prisma.application.create({
      data: {
        positionId: ctx.params.id,
        applicantId,
        coverLetter,
        matchId: match?.id ?? null,
      },
      select: { id: true, status: true, createdAt: true },
    });
    return Response.json({ status: "submitted", application });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("Unique constraint")) {
      return Response.json(
        { status: "already_applied", message: "You have already applied to this position." },
        { status: 200 },
      );
    }
    return Response.json({ error: "Failed to submit application" }, { status: 500 });
  }
}
