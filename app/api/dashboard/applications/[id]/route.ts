// PATCH /api/dashboard/applications/[id] — employer updates an
// application's pipeline stage + notes. Creates an InterviewStage
// row so the transition history is preserved.
//
// Auth gate: signed-in user must be the Employer who owns the
// position the application was made to. Otherwise 403.

import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STAGES = new Set([
  "applied",
  "shortlisted",
  "interview",
  "offer",
  "rejected",
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (session?.user as any)?.id;
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const stage =
    typeof body.stage === "string" && ALLOWED_STAGES.has(body.stage)
      ? body.stage
      : null;
  const notes =
    typeof body.notes === "string" ? body.notes.trim().slice(0, 5000) || null : undefined;
  const scheduledAt =
    typeof body.scheduledAt === "string"
      ? (() => {
          const d = new Date(body.scheduledAt as string);
          return Number.isNaN(d.getTime()) ? null : d;
        })()
      : undefined;

  if (!stage && notes === undefined) {
    return Response.json(
      { error: "stage or notes required" },
      { status: 400 },
    );
  }

  // Verify ownership.
  const app = await prisma.application.findUnique({
    where: { id: ctx.params.id },
    select: {
      id: true,
      stage: true,
      position: {
        select: {
          employer: { select: { userId: true } },
        },
      },
    },
  });
  if (!app) return Response.json({ error: "Not found" }, { status: 404 });
  if (app.position.employer?.userId !== userId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // Update + write the stage-transition history row in a single tx.
  await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: ctx.params.id },
      data: {
        ...(stage ? { stage } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
    });
    if (stage && stage !== app.stage) {
      await tx.interviewStage.create({
        data: {
          applicationId: ctx.params.id,
          stage,
          notes: notes ?? null,
          scheduledAt: scheduledAt ?? null,
          createdBy: userId,
        },
      });
    }
  });

  return Response.json({ status: "updated" });
}
