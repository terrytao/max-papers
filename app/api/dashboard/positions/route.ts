// POST   — employer creates a new Position attached to their Employer
// PATCH  — employer updates an existing Position (title, description,
//          status, deadline, etc.) — only if they own it
// DELETE — soft-closes a Position by flipping status to "closed".
//          Hard-delete would break the foreign-key on existing
//          Applications + Matches, so we never destroy.
//
// All routes 401 unauthenticated, 403 non-employer or non-owner.

import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_TYPES = new Set(["phd", "postdoc", "faculty", "job", "fellowship"]);

async function requireEmployer() {
  const session = await getServerSession(authOptions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (session?.user as any)?.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (session?.user as any)?.role;
  if (!userId) return { error: "unauthorized" as const, code: 401 };
  if (role !== "employer" && role !== "admin") {
    return { error: "forbidden" as const, code: 403 };
  }
  const employer = await prisma.employer.findUnique({
    where: { userId },
    include: { user: { select: { researchProfile: { select: { id: true } } } } },
  });
  if (!employer) return { error: "no-employer" as const, code: 404 };
  return { userId, employer };
}

export async function POST(req: NextRequest) {
  const guard = await requireEmployer();
  if ("error" in guard) {
    return Response.json({ error: guard.error }, { status: guard.code });
  }
  const { employer } = guard;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const title = String(body.title ?? "").trim();
  const type = String(body.type ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!title || !type || !description || !ALLOWED_TYPES.has(type)) {
    return Response.json(
      { error: "title, type, and description are required" },
      { status: 400 },
    );
  }

  // postedById needs a ResearchProfile. Create one tied to the
  // employer user if missing — keeps the existing schema happy.
  let postedById = employer.user.researchProfile?.id;
  if (!postedById) {
    const profile = await prisma.researchProfile.create({
      data: {
        userId: guard.userId,
        name: employer.orgName,
        email: `employer-${employer.id}@max-papers.com`,
        profileType: "recruiter",
        institution: employer.orgName,
      },
      select: { id: true },
    });
    postedById = profile.id;
  }

  const deadline = (() => {
    if (typeof body.deadline !== "string") return null;
    const d = new Date(body.deadline);
    return Number.isNaN(d.getTime()) ? null : d;
  })();

  const position = await prisma.position.create({
    data: {
      title: title.slice(0, 300),
      type,
      description: description.slice(0, 10_000),
      institution: (String(body.institution ?? employer.orgName)).slice(0, 200),
      department: stringField(body, "department"),
      country: stringField(body, "country"),
      city: stringField(body, "city"),
      researchTopics: stringArray(body.researchTopics),
      methods: stringArray(body.methods),
      requirements: stringArray(body.requirements),
      funded: body.funded !== false,
      deadline,
      contactEmail: stringField(body, "contactEmail"),
      website: stringField(body, "website"),
      status: "open",
      postedById,
      employerId: employer.id,
      source: "manual",
    },
    select: { id: true, title: true },
  });
  return Response.json({ status: "created", position });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireEmployer();
  if ("error" in guard) {
    return Response.json({ error: guard.error }, { status: guard.code });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const existing = await prisma.position.findUnique({
    where: { id },
    select: { employerId: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (existing.employerId !== guard.employer.id) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  for (const k of [
    "title",
    "description",
    "institution",
    "department",
    "country",
    "city",
    "contactEmail",
    "website",
  ]) {
    if (typeof body[k] === "string") {
      data[k] = (body[k] as string).trim().slice(0, 10_000) || null;
    }
  }
  if (Array.isArray(body.researchTopics)) data.researchTopics = stringArray(body.researchTopics);
  if (Array.isArray(body.methods)) data.methods = stringArray(body.methods);
  if (Array.isArray(body.requirements)) data.requirements = stringArray(body.requirements);
  if (typeof body.funded === "boolean") data.funded = body.funded;
  if (typeof body.status === "string" && /^(open|closed|filled)$/.test(body.status)) {
    data.status = body.status;
  }
  if (typeof body.type === "string" && ALLOWED_TYPES.has(body.type)) {
    data.type = body.type;
  }
  if (typeof body.deadline === "string") {
    const d = new Date(body.deadline);
    data.deadline = Number.isNaN(d.getTime()) ? null : d;
  }

  const position = await prisma.position.update({
    where: { id },
    data,
    select: { id: true, title: true, status: true },
  });
  return Response.json({ status: "updated", position });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireEmployer();
  if ("error" in guard) {
    return Response.json({ error: guard.error }, { status: guard.code });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const existing = await prisma.position.findUnique({
    where: { id },
    select: { employerId: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (existing.employerId !== guard.employer.id) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  await prisma.position.update({
    where: { id },
    data: { status: "closed" },
  });
  return Response.json({ status: "closed" });
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
