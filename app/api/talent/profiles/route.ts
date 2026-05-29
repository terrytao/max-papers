// GET — list researcher profiles, optionally filtered by topic
//        or institution. Used by the talent hub browse view.
// POST — create a new profile. Anonymous + auto-live in v1; this
//        is a documented spam vector until auth ships.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const topic = sp.get("topic");
  const institution = sp.get("institution");
  const type = sp.get("profileType");
  const limit = Math.min(Number(sp.get("limit") ?? 50), 100);

  const where: Record<string, unknown> = {};
  if (institution) where.institution = { contains: institution, mode: "insensitive" };
  if (type) where.profileType = type;
  if (topic) where.topics = { has: topic };

  const profiles = await prisma.researchProfile.findMany({
    where,
    take: limit,
    orderBy: [{ paperCount: "desc" }, { totalCitations: "desc" }],
    select: {
      id: true,
      name: true,
      title: true,
      institution: true,
      country: true,
      profileType: true,
      lookingFor: true,
      topics: true,
      paperCount: true,
      totalCitations: true,
      hIndex: true,
    },
  });
  return Response.json({ count: profiles.length, results: profiles });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!name || !email) {
    return Response.json({ error: "name and email are required" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "email is malformed" }, { status: 400 });
  }
  // Idempotent on email — re-posting the same email updates the
  // mutable fields rather than throwing a unique-constraint error.
  try {
    const profile = await prisma.researchProfile.upsert({
      where: { email },
      create: {
        name: name.slice(0, 200),
        email,
        title: stringField(body, "title"),
        institution: stringField(body, "institution"),
        department: stringField(body, "department"),
        lab: stringField(body, "lab"),
        country: stringField(body, "country"),
        website: stringField(body, "website"),
        bio: stringField(body, "bio", 5000),
        orcid: stringField(body, "orcid"),
        googleScholarId: stringField(body, "googleScholarId"),
        twitterHandle: stringField(body, "twitterHandle"),
        linkedinUrl: stringField(body, "linkedinUrl"),
        profileType:
          typeof body.profileType === "string" ? body.profileType : "researcher",
        lookingFor: stringArray(body.lookingFor),
        topics: stringArray(body.topics),
        methods: stringArray(body.methods),
      },
      update: {
        name: name.slice(0, 200),
        title: stringField(body, "title") ?? undefined,
        institution: stringField(body, "institution") ?? undefined,
        department: stringField(body, "department") ?? undefined,
        lab: stringField(body, "lab") ?? undefined,
        country: stringField(body, "country") ?? undefined,
        website: stringField(body, "website") ?? undefined,
        bio: stringField(body, "bio", 5000) ?? undefined,
        topics: stringArray(body.topics),
        methods: stringArray(body.methods),
      },
      select: { id: true, name: true, email: true, profileType: true },
    });
    return Response.json({ status: "live", profile });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message ?? "create failed" },
      { status: 500 },
    );
  }
}

function stringField(
  body: Record<string, unknown>,
  key: string,
  max = 500,
): string | null {
  const v = body[key];
  return typeof v === "string" ? v.trim().slice(0, max) || null : null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 30);
}
