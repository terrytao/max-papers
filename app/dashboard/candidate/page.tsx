// Candidate dashboard. Server-component shell pulls the
// ResearchProfile (auto-created at registration time) + the user's
// applications, then mounts <CandidateDashboardForms /> for the
// interactive bits (visibility toggle, lookingFor multiselect,
// freeform fields).
//
// Auth gate: redirect to /auth/signin if no session. Role isn't
// strictly checked here — researchers ARE the default role, and
// employers landing here see their auto-created profile + empty
// applications list (harmless).

import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";
import { CandidateDashboardForms } from "@/components/dashboard/CandidateDashboardForms";

export const dynamic = "force-dynamic";

export default async function CandidateDashboard() {
  const session = await getServerSession(authOptions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (session?.user as any)?.id;
  if (!userId) redirect("/auth/signin?callbackUrl=/dashboard/candidate");

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
              status: true,
              deadline: true,
            },
          },
        },
      },
    },
  });

  if (!profile) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 60px" }}>
        <Nav />
        <div style={{ padding: "40px 0" }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 500,
              color: "#111",
              margin: 0,
            }}
          >
            No researcher profile yet
          </h1>
          <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
            Your account doesn&apos;t have a linked researcher profile. Try
            signing out and re-registering, or contact support.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "0 20px 60px" }}>
      <Nav />
      <header style={{ padding: "32px 0 16px", borderBottom: "0.5px solid #e8e0c8" }}>
        <p
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "#c8a84b",
            margin: 0,
          }}
        >
          Candidate dashboard
        </p>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 500,
            color: "#111",
            letterSpacing: "-.02em",
            margin: "10px 0 0",
          }}
        >
          {profile.name}
        </h1>
        <p style={{ fontSize: 13, color: "#666", margin: "6px 0 0" }}>
          {profile.title ? `${profile.title} · ` : ""}
          {profile.institution ?? "Independent"}
          {profile.country ? ` · ${profile.country}` : ""}
        </p>
      </header>

      <CandidateDashboardForms
        profile={{
          id: profile.id,
          title: profile.title,
          institution: profile.institution,
          department: profile.department,
          country: profile.country,
          website: profile.website,
          bio: profile.bio,
          visibility: profile.visibility,
          visibilityFields: profile.visibilityFields,
          lookingFor: profile.lookingFor,
          availableFrom: profile.availableFrom?.toISOString() ?? null,
          topics: profile.topics,
        }}
      />

      <section style={{ marginTop: 32 }}>
        <h2
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "#c8a84b",
            margin: 0,
          }}
        >
          Your applications ({profile.applications.length})
        </h2>
        {profile.applications.length === 0 ? (
          <p style={{ fontSize: 13, color: "#888", margin: "10px 0 0" }}>
            No applications yet. Browse{" "}
            <Link href="/talent?tab=browse" style={{ color: "#c8a84b" }}>
              open positions
            </Link>{" "}
            and apply through the talent hub.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
            {profile.applications.map((a) => (
              <li
                key={a.id}
                style={{
                  padding: "12px 0",
                  borderBottom: "0.5px solid #f0ebd9",
                }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 7px",
                      background: stageColor(a.stage).bg,
                      color: stageColor(a.stage).fg,
                      textTransform: "uppercase",
                      letterSpacing: ".05em",
                    }}
                  >
                    {a.stage}
                  </span>
                  <span style={{ fontSize: 11, color: "#bbb" }}>
                    {a.position.institution} · {a.position.type.toUpperCase()}
                  </span>
                </div>
                <Link
                  href={`/talent/positions/${a.position.id}`}
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#111",
                    textDecoration: "none",
                    display: "block",
                    marginTop: 4,
                  }}
                >
                  {a.position.title}
                </Link>
                <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                  Applied {a.createdAt.toISOString().split("T")[0]}
                  {a.position.deadline
                    ? ` · deadline ${a.position.deadline.toISOString().split("T")[0]}`
                    : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function stageColor(stage: string): { bg: string; fg: string } {
  switch (stage) {
    case "shortlisted":
      return { bg: "#e6f1fb", fg: "#0c447c" };
    case "interview":
      return { bg: "#faeeda", fg: "#633806" };
    case "offer":
      return { bg: "#eaf3de", fg: "#27500a" };
    case "rejected":
      return { bg: "#fde6e6", fg: "#7d1a1a" };
    default:
      return { bg: "#faf8f5", fg: "#666" };
  }
}
