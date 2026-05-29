// Periodic cache cleanup. Wire to a cron (Amplify scheduled job,
// Vercel cron, or a plain `curl` from a system timer) to delete
// expired SearchCache rows. Without this, the table grows until
// hot-query traffic stops; safe but wastes Neon storage.
//
// Auth: gated by CRON_SECRET env var when set. In dev (env unset)
// the endpoint is open so a local hit works without ceremony. In
// prod, set CRON_SECRET to a random string and call:
//   GET /api/cron/cleanup-cache?secret=<value>

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.nextUrl.searchParams.get("secret") !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await prisma.searchCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return Response.json({ deleted: result.count });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message ?? "cleanup failed" },
      { status: 500 },
    );
  }
}
