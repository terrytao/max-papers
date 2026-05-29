// GET — list open positions, filtered by topic/type/institution/country/funded
// POST — create a position. Fires the matching engine in the
//        background so /talent/positions/[id] shows ranked candidates
//        on first visit. Anonymous + auto-live; spam vector until
//        auth ships.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchPosition } from "@/lib/matching/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const topic = sp.get("topic");
  const type = sp.get("type");
  const institution = sp.get("institution");
  const country = sp.get("country");
  const funded = sp.get("funded");
  const limit = Math.min(Number(sp.get("limit") ?? 50), 100);

  const where: Record<string, unknown> = { status: "open" };
  if (type) where.type = type;
  if (institution) where.institution = { contains: institution, mode: "insensitive" };
  if (country) where.country = { contains: country, mode: "insensitive" };
  if (funded === "true") where.funded = true;
  if (topic) where.researchTopics = { has: topic };

  const positions = await prisma.position.findMany({
    where,
    take: limit,
    orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    include: {
      postedBy: { select: { id: true, name: true, institution: true } },
    },
  });
  return Response.json({ count: positions.length, results: positions });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const institution =
    typeof body.institution === "string" ? body.institution.trim() : "";
  const postedById =
    typeof body.postedById === "string" ? body.postedById.trim() : "";
  if (!title || !type || !description || !institution || !postedById) {
    return Response.json(
      { error: "title, type, description, institution, and postedById are required" },
      { status: 400 },
    );
  }
  const poster = await prisma.researchProfile.findUnique({
    where: { id: postedById },
    select: { id: true },
  });
  if (!poster) {
    return Response.json({ error: "postedById does not resolve to a profile" }, { status: 400 });
  }

  const created = await prisma.position.create({
    data: {
      title: title.slice(0, 300),
      type,
      description: description.slice(0, 10000),
      institution: institution.slice(0, 200),
      department: stringField(body, "department"),
      lab: stringField(body, "lab"),
      country: stringField(body, "country"),
      city: stringField(body, "city"),
      researchTopics: stringArray(body.researchTopics),
      methods: stringArray(body.methods),
      requirements: stringArray(body.requirements),
      funded: body.funded !== false,
      fundingDetails: stringField(body, "fundingDetails"),
      salary: stringField(body, "salary"),
      deadline: dateField(body, "deadline"),
      startDate: dateField(body, "startDate"),
      duration: stringField(body, "duration"),
      contactEmail: stringField(body, "contactEmail"),
      website: stringField(body, "website"),
      postedById,
    },
    select: { id: true, title: true },
  });

  // Fire-and-forget match computation. Awaiting would block the
  // POST until every researcher profile is scored — fine while there
  // are zero profiles, painful at scale.
  matchPosition(created.id).catch((err) => {
    console.error("[positions] matchPosition failed:", (err as Error).message);
  });

  return Response.json({
    status: "live",
    position: created,
    url: `https://www.max-papers.com/talent/positions/${created.id}`,
  });
}

function stringField(
  body: Record<string, unknown>,
  key: string,
  max = 500,
): string | null {
  const v = body[key];
  return typeof v === "string" ? v.trim().slice(0, max) || null : null;
}

function dateField(body: Record<string, unknown>, key: string): Date | null {
  const v = body[key];
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 30);
}
