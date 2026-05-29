// GET — single position + ranked matches (top 20 by score)

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const position = await prisma.position.findUnique({
    where: { id: ctx.params.id },
    include: {
      postedBy: {
        select: { id: true, name: true, institution: true, profileType: true },
      },
      matches: {
        take: 20,
        orderBy: { score: "desc" },
        include: {
          profile: {
            select: {
              id: true,
              name: true,
              title: true,
              institution: true,
              country: true,
              paperCount: true,
              totalCitations: true,
              hIndex: true,
            },
          },
        },
      },
    },
  });
  if (!position) {
    return Response.json({ error: "Position not found" }, { status: 404 });
  }
  return Response.json({ position });
}
