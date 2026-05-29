// GET — return the signed-in user's ResearchProfile + sent applications
// PATCH — update profile fields the candidate dashboard exposes
//         (visibility, visibilityFields, lookingFor, availableFrom,
//         title, institution, bio, topics, methods)
//
// Auth gate via getServerSession + session.user.id mapping.
// Resume upload to S3 is a planned addition; this route doesn't
// handle file uploads.

import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_VISIBILITY = new Set(["private", "public", "open"]);
const ALLOWED_LOOKING_FOR = new Set([
  "phd",
  "postdoc",
  "faculty",
  "industry",
  "collaborator",
]);

async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (session?.user as any)?.id ?? null;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const profile = await prisma.researchProfile.findFirst({
    where: { userId },
    include: {
      applications: {
        orderBy: { createdAt: "desc" },
        include: {
          position: {
            select: {
              id: true,
              title: true,
              institution: true,
              type: true,
              deadline: true,
              status: true,
            },
          },
        },
      },
    },
  });
  if (!profile) {
    return Response.json(
      { error: "No ResearchProfile linked to this user" },
      { status: 404 },
    );
  }
  return Response.json({ profile });
}

export async function PATCH(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (typeof body.visibility === "string" && ALLOWED_VISIBILITY.has(body.visibility)) {
    data.visibility = body.visibility;
  }
  if (Array.isArray(body.visibilityFields)) {
    data.visibilityFields = body.visibilityFields
      .filter((v): v is string => typeof v === "string")
      .slice(0, 20);
  }
  if (Array.isArray(body.lookingFor)) {
    data.lookingFor = body.lookingFor
      .filter((v): v is string => typeof v === "string" && ALLOWED_LOOKING_FOR.has(v))
      .slice(0, 5);
  }
  if (typeof body.availableFrom === "string") {
    const d = new Date(body.availableFrom);
    data.availableFrom = Number.isNaN(d.getTime()) ? null : d;
  } else if (body.availableFrom === null) {
    data.availableFrom = null;
  }
  // Free-text profile fields.
  for (const k of [
    "title",
    "institution",
    "department",
    "lab",
    "country",
    "website",
    "bio",
  ]) {
    if (typeof body[k] === "string") {
      data[k] = (body[k] as string).trim().slice(0, 5000) || null;
    }
  }
  if (Array.isArray(body.topics)) {
    data.topics = body.topics
      .filter((v): v is string => typeof v === "string")
      .map((s) => s.trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 20);
  }
  if (Array.isArray(body.methods)) {
    data.methods = body.methods
      .filter((v): v is string => typeof v === "string")
      .map((s) => s.trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 20);
  }

  const profile = await prisma.researchProfile.update({
    where: { userId },
    data,
    select: {
      id: true,
      visibility: true,
      visibilityFields: true,
      lookingFor: true,
    },
  });
  return Response.json({ status: "updated", profile });
}
