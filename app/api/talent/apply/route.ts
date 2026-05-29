// POST /api/talent/apply — quick anonymous-apply path used by the
// homepage talent-rail "Apply" buttons. Creates an Application row
// without requiring the applicant to have an account; upserts the
// ResearchProfile by email, sets visibility=private.
//
// NOT sending a confirmation email to the applicant's address: it's
// a relay vector when email isn't verified (attacker types
// victim@example.com, victim gets "you applied to X"). Skip until
// auth + verification ship. The application appears in the
// employer dashboard immediately; the applicant sees success
// in-page.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  positionId?: string;
  name?: string;
  email?: string;
  message?: string;
  cvUrl?: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const positionId = body.positionId?.trim() ?? "";
  const name = body.name?.trim() ?? "";
  const email = (body.email ?? "").trim().toLowerCase();
  if (!positionId || !name || !email) {
    return Response.json(
      { error: "positionId, name, and email are required" },
      { status: 400 },
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "email is malformed" }, { status: 400 });
  }

  const position = await prisma.position.findUnique({
    where: { id: positionId },
    select: { id: true, status: true, source: true, sourceUrl: true },
  });
  if (!position) {
    return Response.json({ error: "Position not found" }, { status: 404 });
  }
  if (position.status !== "open") {
    return Response.json(
      { error: "Position is not open for applications" },
      { status: 400 },
    );
  }
  // Crawled positions have no employer on our side to receive an
  // application — refuse here and surface the source URL so the
  // caller can redirect the user to the original posting.
  if (position.source === "crawled") {
    return Response.json(
      {
        error:
          "This position was aggregated from another site. Apply at the original posting.",
        applyAt: position.sourceUrl ?? null,
      },
      { status: 409 },
    );
  }

  // Upsert applicant ResearchProfile by email. Always private — the
  // user can flip to public from /talent/status later if they want.
  const applicant = await prisma.researchProfile.upsert({
    where: { email },
    create: {
      name: name.slice(0, 200),
      email,
      visibility: "private",
    },
    update: {},
    select: { id: true },
  });

  // Dedup on the (positionId, applicantId) composite unique. Return
  // 200 with already_applied rather than 4xx so the UX is "you've
  // applied", not "error".
  const existing = await prisma.application.findUnique({
    where: {
      positionId_applicantId: {
        positionId,
        applicantId: applicant.id,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return Response.json({
      status: "already_applied",
      message: "You have already applied to this position.",
      applicationId: existing.id,
    });
  }

  try {
    const application = await prisma.application.create({
      data: {
        positionId,
        applicantId: applicant.id,
        coverLetter: body.message?.trim().slice(0, 5000) || null,
        status: "pending",
        stage: "applied",
      },
      select: { id: true, createdAt: true },
    });
    return Response.json({
      status: "submitted",
      message: "Application submitted privately",
      applicationId: application.id,
    });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message ?? "Failed to submit application" },
      { status: 500 },
    );
  }
}
