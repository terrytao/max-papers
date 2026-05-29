// /researchers/[id] — SEO wiki page for a researcher.
//
// Source of truth: the Researcher model (populated by
// agents/extract-entities.ts from Paper.authors[]). Each researcher
// has a PaperResearcher join giving us their bibliography directly,
// citation sums + top fields are cached on the row at extract time
// so the page renders without aggregation.
//
// Falls back to a ResearchProfile lookup if params.id doesn't match
// a Researcher — covers links from the talent marketplace that use
// ResearchProfile.id rather than Researcher.id.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

async function getResearcher(id: string) {
  const r = await prisma.researcher.findUnique({
    where: { id },
    include: {
      papers: {
        take: 30,
        orderBy: { paper: { citationCount: "desc" } },
        include: {
          paper: {
            select: {
              id: true,
              title: true,
              year: true,
              journal: true,
              citationCount: true,
              isOpenAccess: true,
              abstract: true,
            },
          },
        },
      },
    },
  });
  if (r) return { kind: "researcher" as const, data: r };
  // ResearchProfile fallback for talent-marketplace deep links.
  const profile = await prisma.researchProfile.findUnique({
    where: { id },
    include: {
      papers: {
        take: 30,
        orderBy: { paper: { citationCount: "desc" } },
        include: {
          paper: {
            select: {
              id: true,
              title: true,
              year: true,
              journal: true,
              citationCount: true,
              isOpenAccess: true,
              abstract: true,
            },
          },
        },
      },
    },
  });
  return profile ? { kind: "profile" as const, data: profile } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await getResearcher(params.id);
  if (!r) return { title: "Researcher not found" };
  if (r.kind === "researcher") {
    const d = r.data;
    return {
      title: d.name,
      description: `${d.paperCount} papers by ${d.name}${d.institution ? ` (most-cited in ${d.institution})` : ""}. ${d.citationCount.toLocaleString()} citations on max-papers.`,
    };
  }
  const d = r.data;
  return {
    title: d.name,
    description: `${d.paperCount} papers by ${d.name}${d.institution ? ` at ${d.institution}` : ""}.`,
  };
}

export default async function ResearcherPage({ params }: Props) {
  const r = await getResearcher(params.id);
  if (!r) notFound();

  // Branch-narrow to a uniform view shape so the rest of the JSX
  // doesn't have to keep checking r.kind. Both source models expose
  // the same logical data — Researcher uses citationCount, the
  // ResearchProfile uses totalCitations; collapse them here.
  const isResearcher = r.kind === "researcher";
  const d = r.data;
  const papers = d.papers.map((pp) => pp.paper);
  const totalCitations = isResearcher
    ? r.data.citationCount
    : papers.reduce((sum, p) => sum + (p.citationCount ?? 0), 0);
  const fields = isResearcher ? r.data.fields : [];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: d.name,
    affiliation: d.institution
      ? { "@type": "Organization", name: d.institution }
      : undefined,
    url: `https://www.max-papers.com/researchers/${d.id}`,
    description: isResearcher
      ? `${d.paperCount} papers, ${totalCitations.toLocaleString()} citations indexed on maxpaper.`
      : undefined,
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 60px" }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Nav />

      <article style={{ padding: "32px 0 0" }}>
        <Link href="/researchers" style={backLinkStyle}>
          ← All researchers
        </Link>

        <div
          style={{
            marginTop: 16,
            paddingBottom: 24,
            borderBottom: "0.5px solid #e8e0c8",
          }}
        >
          <p style={kickerStyle}>Researcher</p>
          <h1 style={titleStyle}>{d.name}</h1>
          {d.institution ? (
            <p style={{ fontSize: 14, color: "#888", margin: "8px 0 12px" }}>
              {d.institution}
              {isResearcher ? (
                <span style={{ fontSize: 11, color: "#bbb", marginLeft: 8 }}>
                  (most frequent journal — institution inference is heuristic)
                </span>
              ) : null}
            </p>
          ) : null}

          <div style={{ display: "flex", gap: 26, marginTop: 12 }}>
            <Stat n={d.paperCount} label="papers" />
            <Stat n={totalCitations} label="citations" />
            {fields.length > 0 ? (
              <div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>
                  {fields.slice(0, 3).join(", ")}
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
                  fields
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <section style={{ marginTop: 28 }}>
          <h2 style={sectionLabelStyle}>Papers ({papers.length})</h2>
          {papers.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
              No papers linked yet — extraction agent may not have run for
              this profile.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {papers.map((p) => (
                <li
                  key={p.id}
                  style={{
                    padding: "14px 0",
                    borderBottom: "0.5px solid #f0ebd9",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      flexWrap: "wrap",
                      marginBottom: 4,
                    }}
                  >
                    {p.isOpenAccess ? (
                      <span
                        style={{
                          fontSize: 10,
                          padding: "2px 7px",
                          background: "#eaf3de",
                          color: "#3b6d11",
                        }}
                      >
                        Open access
                      </span>
                    ) : null}
                    <span style={{ fontSize: 11, color: "#bbb" }}>
                      {p.year ?? "—"}
                      {p.journal ? ` · ${p.journal}` : ""}
                      {p.citationCount > 0
                        ? ` · ${p.citationCount.toLocaleString("en-US")} citations`
                        : ""}
                    </span>
                  </div>
                  <Link
                    href={`/papers/${p.id}`}
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "#111",
                      textDecoration: "none",
                      display: "block",
                      marginBottom: 4,
                      lineHeight: 1.4,
                    }}
                  >
                    {p.title}
                  </Link>
                  <p
                    style={{
                      fontSize: 12,
                      color: "#666",
                      lineHeight: 1.6,
                      margin: 0,
                    }}
                  >
                    {p.abstract ? p.abstract.slice(0, 200) + "…" : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {isResearcher ? (
          <footer
            style={{
              marginTop: 36,
              paddingTop: 18,
              borderTop: "0.5px solid #e8e0c8",
              fontSize: 11,
              color: "#aaa",
              lineHeight: 1.7,
            }}
          >
            <Link
              href={`/talent/profile/${d.id}`}
              style={{
                color: "#888",
                textDecoration: "underline",
                textDecorationColor: "#e8e0c8",
              }}
            >
              Looking for this researcher in the talent marketplace? →
            </Link>
          </footer>
        ) : null}
      </article>
    </main>
  );
}

const backLinkStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  textDecoration: "none",
  letterSpacing: ".05em",
  textTransform: "uppercase",
};
const kickerStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: "#c8a84b",
  margin: 0,
};
const titleStyle: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 500,
  color: "#111",
  letterSpacing: "-.02em",
  margin: "10px 0 0",
  lineHeight: 1.25,
};
const sectionLabelStyle: React.CSSProperties = {
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
