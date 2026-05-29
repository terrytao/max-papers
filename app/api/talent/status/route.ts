// POST /api/talent/status — register a researcher's job-search intent
// without making their profile public. Upserts ResearchProfile by
// email, sets lookingFor + availableFrom + identifiers, but keeps
// visibility="private" so the profile stays out of the public talent
// rail. Notification emails will fire (via lib/notifications/email)
// when matches accrue once we wire that hook.
//
// Anonymous + open per the v1 talent-write trust model. Same spam
// caveat as /api/talent/profiles: anyone can claim any email until
// auth + verification ship; the cost is bounded since we only set
// fields, not delete anything.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_LOOKING_FOR = new Set([
  "phd",
  "postdoc",
  "faculty",
  "industry",
  "fellowship",
  "internship",
]);

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return Response.json({ error: "email is required" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "email is malformed" }, { status: 400 });
  }

  const name =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim().slice(0, 200)
      : email.split("@")[0]!; // fallback so the upsert has a name

  const lookingFor = Array.isArray(body.lookingFor)
    ? body.lookingFor
        .filter((v): v is string => typeof v === "string")
        .map((s) => s.toLowerCase())
        .filter((s) => ALLOWED_LOOKING_FOR.has(s))
        .slice(0, 6)
    : [];

  const availableFrom = (() => {
    if (typeof body.availableFrom !== "string") return null;
    const d = new Date(body.availableFrom);
    return Number.isNaN(d.getTime()) ? null : d;
  })();

  // Optional identifiers — stored on the profile for the (future)
  // paper-linker to find their bibliography.
  const orcid =
    typeof body.orcid === "string" ? body.orcid.trim().slice(0, 50) || null : null;
  const website =
    typeof body.website === "string"
      ? body.website.trim().slice(0, 500) || null
      : null;
  const googleScholarId =
    typeof body.googleScholarId === "string"
      ? body.googleScholarId.trim().slice(0, 100) || null
      : null;

  try {
    const profile = await prisma.researchProfile.upsert({
      where: { email },
      create: {
        name,
        email,
        lookingFor,
        availableFrom,
        orcid,
        website,
        googleScholarId,
        // Default private — this endpoint is for private intent.
        visibility: "private",
      },
      update: {
        // Only overwrite name if caller supplied a real one.
        ...(typeof body.name === "string" && body.name.trim().length > 0
          ? { name }
          : {}),
        lookingFor,
        availableFrom,
        ...(orcid ? { orcid } : {}),
        ...(website ? { website } : {}),
        ...(googleScholarId ? { googleScholarId } : {}),
      },
      select: { id: true, name: true, email: true, lookingFor: true },
    });
    return Response.json({ status: "saved", profile });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message ?? "Failed to save status" },
      { status: 500 },
    );
  }
}
