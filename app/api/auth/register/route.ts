// Self-signup endpoint. Two role paths:
//   • role=user (candidate) → User + linked ResearchProfile so the
//     account immediately has a talent profile to edit
//   • role=employer → User + linked Employer
//
// Email + password are required; password is bcryptjs-hashed at
// rest (cost factor 10 — standard NextAuth default).
//
// Idempotency: returns 409 on duplicate email. No verification flow
// in v1; verifying emails is a SES-magic-link addition for later.

import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  name?: string;
  email?: string;
  password?: string;
  role?: "user" | "employer";
  orgName?: string;
  orgType?: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = (body.name ?? "").trim().slice(0, 200);
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const role = body.role === "employer" ? "employer" : "user";

  if (!name || !email || !password) {
    return Response.json(
      { error: "name, email, and password are required" },
      { status: 400 },
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "email is malformed" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json(
      { error: "password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return Response.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: passwordHash,
        role,
        // Auto-create the appropriate profile so onboarding flows
        // have something to edit.
        ...(role === "employer"
          ? {
              employer: {
                create: {
                  orgName: (body.orgName ?? name).slice(0, 200),
                  orgType:
                    body.orgType && /^(university|company|lab|hospital|other)$/.test(body.orgType)
                      ? body.orgType
                      : "university",
                },
              },
            }
          : {
              researchProfile: {
                create: {
                  name,
                  email,
                  profileType: "researcher",
                },
              },
            }),
      },
      select: { id: true, email: true, role: true },
    });
    return Response.json({ status: "created", user });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("Unique constraint")) {
      return Response.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "Failed to create account" },
      { status: 500 },
    );
  }
}
