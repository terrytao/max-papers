// Employer dashboard. Shows stats + open-positions list with
// per-position applicant pipelines. Role-gated to "employer";
// other roles redirect to /dashboard/candidate.
//
// Stage transitions on individual applications happen via the
// inline <StageButtons /> client island per row, which PATCHes
// /api/dashboard/applications/[id].

import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";
import { StageButtons } from "@/components/dashboard/StageButtons";

export const dynamic = "force-dynamic";

export default async function EmployerDashboard() {
  const session = await getServerSession(authOptions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (session?.user as any)?.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (session?.user as any)?.role;
  if (!userId) redirect("/auth/signin?callbackUrl=/dashboard/employer");
  if (role !== "employer" && role !== "admin") redirect("/dashboard/candidate");

  const employer = await prisma.employer.findUnique({
    where: { userId },
    include: {
      positions: {
        orderBy: { createdAt: "desc" },
        include: {
          applications: {
            orderBy: { createdAt: "desc" },
            include: {
              applicant: {
                select: {
                  id: true,
                  name: true,
                  institution: true,
                  title: true,
                  totalCitations: true,
                  paperCount: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!employer) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px" }}>
        <Nav />
        <p style={{ padding: 40 }}>No employer record linked to this account.</p>
      </main>
    );
  }

  const totalApplicants = employer.positions.reduce(
    (sum, p) => sum + p.applications.length,
    0,
  );
  const inInterview = employer.positions.reduce(
    (sum, p) => sum + p.applications.filter((a) => a.stage === "interview").length,
    0,
  );
  const openCount = employer.positions.filter((p) => p.status === "open").length;

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "0 20px 60px" }}>
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
          Employer dashboard
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
          {employer.orgName}
        </h1>
        <p style={{ fontSize: 13, color: "#666", margin: "6px 0 0" }}>
          {employer.orgType.charAt(0).toUpperCase() + employer.orgType.slice(1)}
          {employer.country ? ` · ${employer.country}` : ""}
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 24,
          padding: "20px 0",
          borderBottom: "0.5px solid #e8e0c8",
        }}
      >
        <Stat n={openCount} label="open positions" />
        <Stat n={employer.positions.length} label="total positions" />
        <Stat n={totalApplicants} label="applicants" />
        <Stat n={inInterview} label="in interview" />
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={sectionLabel}>Positions ({employer.positions.length})</h2>
        {employer.positions.length === 0 ? (
          <p style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
            No positions yet. Post one via{" "}
            <Link href="/talent?tab=post" style={{ color: "#c8a84b" }}>
              the talent hub
            </Link>{" "}
            — coming soon: in-dashboard posting form.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 12 }}>
            {employer.positions.map((p) => (
              <div
                key={p.id}
                style={{
                  border: "0.5px solid #e8e0c8",
                  padding: 14,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 7px",
                      background: p.status === "open" ? "#eaf3de" : "#fde6e6",
                      color: p.status === "open" ? "#27500a" : "#7d1a1a",
                      textTransform: "uppercase",
                      letterSpacing: ".05em",
                    }}
                  >
                    {p.status}
                  </span>
                  <span style={{ fontSize: 11, color: "#888" }}>
                    {p.type.toUpperCase()}
                    {p.deadline
                      ? ` · deadline ${p.deadline.toISOString().split("T")[0]}`
                      : ""}
                  </span>
                </div>
                <Link
                  href={`/talent/positions/${p.id}`}
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    color: "#111",
                    textDecoration: "none",
                    display: "block",
                    marginTop: 6,
                  }}
                >
                  {p.title}
                </Link>
                <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                  {p.applications.length} applicant
                  {p.applications.length === 1 ? "" : "s"}
                </div>

                {p.applications.length > 0 ? (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: "12px 0 0",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {p.applications.map((a) => (
                      <li
                        key={a.id}
                        style={{
                          padding: "10px 12px",
                          background: "#faf8f5",
                          display: "flex",
                          gap: 12,
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <Link
                            href={`/researchers/${a.applicant.id}`}
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              color: "#111",
                              textDecoration: "none",
                            }}
                          >
                            {a.applicant.name}
                          </Link>
                          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                            {[a.applicant.title, a.applicant.institution]
                              .filter(Boolean)
                              .join(" · ") || "Independent"}
                            {" · "}
                            {a.applicant.paperCount} papers
                            {a.applicant.totalCitations > 0
                              ? ` · ${a.applicant.totalCitations.toLocaleString("en-US")} citations`
                              : ""}
                          </div>
                        </div>
                        <StageButtons applicationId={a.id} currentStage={a.stage} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "#c8a84b",
  margin: 0,
};

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 500, color: "#111" }}>
        {n.toLocaleString("en-US")}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: ".08em",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}
