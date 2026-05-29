// GET — return the signed-in employer's stats: positions count,
// total applicants across positions, current open positions list
// with applicant counts per position. Role-gated to "employer";
// other roles get 403.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (session?.user as any)?.id ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (session?.user as any)?.role;
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (role !== "employer" && role !== "admin") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const employer = await prisma.employer.findUnique({
    where: { userId },
    include: {
      positions: {
        orderBy: { createdAt: "desc" },
        include: {
          applications: {
            select: { id: true, stage: true, status: true },
          },
          _count: { select: { applications: true } },
        },
      },
    },
  });
  if (!employer) {
    return Response.json({ error: "No employer record" }, { status: 404 });
  }

  const totalApplicants = employer.positions.reduce(
    (sum, p) => sum + p._count.applications,
    0,
  );
  const inInterview = employer.positions.reduce(
    (sum, p) => sum + p.applications.filter((a) => a.stage === "interview").length,
    0,
  );

  return Response.json({
    employer: {
      id: employer.id,
      orgName: employer.orgName,
      orgType: employer.orgType,
      country: employer.country,
    },
    stats: {
      positions: employer.positions.length,
      openPositions: employer.positions.filter((p) => p.status === "open").length,
      totalApplicants,
      inInterview,
    },
    positions: employer.positions.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      status: p.status,
      deadline: p.deadline,
      applicantCount: p._count.applications,
      stages: p.applications.reduce<Record<string, number>>((acc, a) => {
        acc[a.stage] = (acc[a.stage] ?? 0) + 1;
        return acc;
      }, {}),
    })),
  });
}
