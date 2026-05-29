// /researchers/[id] — SEO wiki page for a researcher.
//
// Resolves params.id against ResearchProfile (the talent-marketplace
// model). The older Researcher table is currently unpopulated; we
// fall back to it for completeness but in practice all hits land on
// ResearchProfile.
//
// Different framing from /talent/profile/[id] (which is the in-app
// dashboard view): this page is plain server-rendered, JSON-LD
// Person markup, optimised for Google indexing rather than the
// interactive talent flow. Same underlying row.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

async function getResearcher(id: string) {
  const profile = await prisma.researchProfile.findUnique({
    where: { id },
    include: {
      papers: {
        orderBy: { paper: { citationCount: "desc" } },
        take: 30,
        include: {
          paper: {
            select: {
              id: true,
              title: true,
              year: true,
              journal: true,
              citationCount: true,
            },
          },
        },
      },
    },
  });
  if (profile) return profile;
  // Fallback to the older Researcher model. Empty in v1 but kept so
  // links from the (future) author-extraction agent don't 404.
  const legacy = await prisma.researcher.findUnique({ where: { id } });
  return legacy
    ? {
        id: legacy.id,
        name: legacy.name,
        email: legacy.email,
        institution: legacy.institution,
        website: legacy.website,
        title: null,
        country: null,
        department: null,
        bio: null,
        topics: [],
        paperCount: legacy.paperCount,
        totalCitations: 0,
        hIndex: 0,
        orcid: null,
        papers: [] as Array<{
          paper: {
            id: string;
            title: string;
            year: number | null;
            journal: string | null;
            citationCount: number;
          };
        }>,
      }
    : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await getResearcher(params.id);
  if (!r) return { title: "Researcher not found" };
  return {
    title: r.name,
    description: `${r.title ? `${r.title} · ` : ""}${
      r.institution ?? "Independent researcher"
    } · ${r.paperCount} papers indexed on maxpaper.`,
  };
}

export default async function ResearcherPage({ params }: Props) {
  const r = await getResearcher(params.id);
  if (!r) notFound();

  // JSON-LD Person — Google + scholar.google use this for the
  // entity-recognition pass that drives knowledge-panel surfaces.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: r.name,
    affiliation: r.institution
      ? { "@type": "Organization", name: r.institution }
      : undefined,
    jobTitle: r.title ?? undefined,
    url: `https://www.max-papers.com/researchers/${r.id}`,
    sameAs: [
      r.orcid ? `https://orcid.org/${r.orcid}` : null,
      "website" in r && r.website ? r.website : null,
    ].filter(Boolean),
    description: r.bio ?? undefined,
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px" }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Nav />
      <article style={{ padding: "32px 0 48px" }}>
        <Link href="/" style={backLinkStyle}>
          ← Back to maxpaper
        </Link>
        <p style={kickerStyle}>Researcher</p>
        <h1 style={titleStyle}>{r.name}</h1>
        <p style={{ fontSize: 13, color: "#666", margin: "8px 0 0" }}>
          {r.title ? `${r.title} · ` : ""}
          {r.institution ?? "Independent"}
          {r.department ? ` · ${r.department}` : ""}
          {r.country ? ` · ${r.country}` : ""}
        </p>

        <div style={{ display: "flex", gap: 26, marginTop: 18 }}>
          <Stat n={r.paperCount} label="papers" />
          <Stat n={r.totalCitations} label="citations" />
          <Stat n={r.hIndex} label="h-index" />
        </div>

        {r.bio ? (
          <section style={{ marginTop: 28 }}>
            <h2 style={sectionLabelStyle}>About</h2>
            <p
              style={{
                fontSize: 14,
                color: "#333",
                lineHeight: 1.7,
                margin: "10px 0 0",
                whiteSpace: "pre-wrap",
              }}
            >
              {r.bio}
            </p>
          </section>
        ) : null}

        {r.topics && r.topics.length > 0 ? (
          <section style={{ marginTop: 28 }}>
            <h2 style={sectionLabelStyle}>Topics</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {r.topics.map((t: string) => (
                <span
                  key={t}
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    background: "#faf8f5",
                    color: "#555",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <section style={{ marginTop: 28 }}>
          <h2 style={sectionLabelStyle}>
            Papers{r.papers && r.papers.length > 0 ? ` (${r.papers.length})` : ""}
          </h2>
          {!r.papers || r.papers.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
              No papers linked yet.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {r.papers.map((pp) => (
                <li
                  key={pp.paper.id}
                  style={{ padding: "10px 0", borderBottom: "0.5px solid #f0ebd9" }}
                >
                  <Link
                    href={`/papers/${pp.paper.id}`}
                    style={{
                      fontSize: 13,
                      color: "#111",
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    {pp.paper.title}
                  </Link>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                    {pp.paper.year ?? "—"}
                    {pp.paper.journal ? ` · ${pp.paper.journal}` : ""}
                    {pp.paper.citationCount > 0
                      ? ` · ${pp.paper.citationCount.toLocaleString("en-US")} citations`
                      : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

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
          {r.orcid ? <div>ORCID: {r.orcid}</div> : null}
          <div>
            <Link
              href={`/talent/profile/${r.id}`}
              style={{ color: "#888", textDecoration: "underline", textDecorationColor: "#e8e0c8" }}
            >
              View talent profile →
            </Link>
          </div>
        </footer>
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
  margin: "18px 0 0",
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
          textTransform: "uppercase",
          letterSpacing: ".08em",
          color: "#888",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}
