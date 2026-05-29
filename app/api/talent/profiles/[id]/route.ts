// GET — single profile + linked papers + posted positions
// PATCH — partial update (no auth gate; spam vector until owner
//          identity ships)

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const profile = await prisma.researchProfile.findUnique({
    where: { id: ctx.params.id },
    include: {
      papers: {
        include: {
          paper: {
            select: {
              id: true,
              title: true,
              year: true,
              journal: true,
              citationCount: true,
              isOpenAccess: true,
            },
          },
        },
        orderBy: { addedAt: "desc" },
      },
      positions: {
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          type: true,
          institution: true,
          country: true,
          deadline: true,
        },
      },
    },
  });
  if (!profile) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }
  return Response.json({ profile });
}

const MUTABLE: ReadonlyArray<string> = [
  "name", "title", "institution", "department", "lab", "country",
  "website", "bio", "googleScholarId", "twitterHandle", "linkedinUrl",
  "profileType", "lookingFor", "topics", "methods", "availableFrom",
];

export async function PATCH(
  req: NextRequest,
  ctx: { params: { id: string } },
) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  for (const k of MUTABLE) {
    if (!(k in body)) continue;
    if (k === "availableFrom") {
      const v = body[k];
      data[k] = typeof v === "string" ? new Date(v) : null;
    } else if (k === "lookingFor" || k === "topics" || k === "methods") {
      data[k] = Array.isArray(body[k])
        ? (body[k] as unknown[])
            .filter((x): x is string => typeof x === "string")
            .slice(0, 30)
        : [];
    } else {
      const v = body[k];
      data[k] = typeof v === "string" ? v.trim().slice(0, 5000) || null : null;
    }
  }
  try {
    const profile = await prisma.researchProfile.update({
      where: { id: ctx.params.id },
      data,
      select: { id: true, name: true, profileType: true },
    });
    return Response.json({ status: "updated", profile });
  } catch {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }
}
