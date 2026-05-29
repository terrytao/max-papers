// /talent/profile/[id] — researcher profile detail.
// Shows core identity, citation metrics, linked papers, and any
// positions this profile has POSTED.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

async function getProfile(id: string) {
  return prisma.researchProfile.findUnique({
    where: { id },
    include: {
      papers: {
        orderBy: { addedAt: "desc" },
        take: 50,
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
      },
      positions: {
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProfile(params.id);
  if (!p) return { title: "Researcher not found" };
  return {
    title: p.name,
    description: `${p.title ? `${p.title} · ` : ""}${
      p.institution ?? "Independent researcher"
    } · ${p.paperCount} papers, ${p.totalCitations} citations`,
  };
}

export default async function ProfilePage({ params }: Props) {
  const profile = await getProfile(params.id);
  if (!profile) notFound();

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px" }}>
      <Nav />
      <article style={{ padding: "32px 0 48px" }}>
        <Link
          href="/talent"
          style={{
            fontSize: 11,
            color: "#888",
            textDecoration: "none",
            letterSpacing: ".05em",
            textTransform: "uppercase",
          }}
        >
          ← Back to talent
        </Link>

        <h1
          style={{
            fontSize: 24,
            fontWeight: 500,
            color: "#111",
            margin: "16px 0 0",
            lineHeight: 1.25,
          }}
        >
          {profile.name}
        </h1>
        <p style={{ fontSize: 13, color: "#666", margin: "6px 0 0" }}>
          {profile.title ? `${profile.title} · ` : ""}
          {profile.institution ?? "Independent"}
          {profile.department ? ` · ${profile.department}` : ""}
          {profile.country ? ` · ${profile.country}` : ""}
        </p>

        <div style={{ display: "flex", gap: 26, marginTop: 18 }}>
          <Stat n={profile.paperCount} label="papers" />
          <Stat n={profile.totalCitations} label="citations" />
          <Stat n={profile.hIndex} label="h-index" />
        </div>

        {profile.bio ? (
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
              {profile.bio}
            </p>
          </section>
        ) : null}

        {profile.topics.length > 0 ? (
          <section style={{ marginTop: 28 }}>
            <h2 style={sectionLabelStyle}>Topics</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {profile.topics.map((t) => (
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
          <h2 style={sectionLabelStyle}>Papers ({profile.papers.length})</h2>
          {profile.papers.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
              No papers linked yet.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {profile.papers.map((pp) => (
                <li
                  key={pp.id}
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

        {profile.positions.length > 0 ? (
          <section style={{ marginTop: 32 }}>
            <h2 style={sectionLabelStyle}>Open positions posted</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {profile.positions.map((p) => (
                <li
                  key={p.id}
                  style={{ padding: "10px 0", borderBottom: "0.5px solid #f0ebd9" }}
                >
                  <Link
                    href={`/talent/positions/${p.id}`}
                    style={{
                      fontSize: 13,
                      color: "#111",
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    {p.title}
                  </Link>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                    {p.type.toUpperCase()} · {p.institution}
                    {p.country ? ` · ${p.country}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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
          <div>
            Profile id: <code>{profile.id}</code>
          </div>
          {profile.orcid ? <div>ORCID: {profile.orcid}</div> : null}
          {profile.website ? (
            <div>
              Website:{" "}
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#555" }}
              >
                {profile.website}
              </a>
            </div>
          ) : null}
        </footer>
      </article>
    </main>
  );
}

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
