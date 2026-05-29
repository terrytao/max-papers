// /talent/positions/[id] — position detail + ranked candidates.
//
// Server component; one Prisma read pulling the position, its poster,
// and the top 20 Match rows with their candidate profiles. notFound()
// when the id doesn't resolve.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";
import {
  ScoreRing,
  BreakdownBar,
  ReasonPills,
} from "@/components/talent/MatchCard";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

async function getPosition(id: string) {
  return prisma.position.findUnique({
    where: { id },
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
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getPosition(params.id);
  if (!p) return { title: "Position not found" };
  return {
    title: p.title,
    description: `${p.type.toUpperCase()} at ${p.institution}. ${p.description.slice(0, 140)}`,
  };
}

export default async function PositionPage({ params }: Props) {
  const position = await getPosition(params.id);
  if (!position) notFound();

  const deadlineISO = position.deadline
    ? position.deadline.toISOString().split("T")[0]
    : null;

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "0 20px" }}>
      <Nav />
      <article style={{ padding: "32px 0 48px" }}>
        <Link
          href="/talent?tab=browse"
          style={{
            fontSize: 11,
            color: "#888",
            textDecoration: "none",
            letterSpacing: ".05em",
            textTransform: "uppercase",
          }}
        >
          ← Back to positions
        </Link>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 16,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 10,
              padding: "2px 7px",
              background: "#e6f1fb",
              color: "#185fa5",
              textTransform: "uppercase",
              letterSpacing: ".05em",
            }}
          >
            {position.type}
          </span>
          {position.funded ? (
            <span
              style={{
                fontSize: 10,
                padding: "2px 7px",
                background: "#eaf3de",
                color: "#3b6d11",
              }}
            >
              Funded
            </span>
          ) : null}
          {position.status !== "open" ? (
            <span
              style={{
                fontSize: 10,
                padding: "2px 7px",
                background: "#fde6e6",
                color: "#c0392b",
                textTransform: "uppercase",
              }}
            >
              {position.status}
            </span>
          ) : null}
          <span style={{ fontSize: 11, color: "#bbb" }}>
            {position.institution}
            {position.country ? ` · ${position.country}` : ""}
            {deadlineISO ? ` · deadline ${deadlineISO}` : ""}
          </span>
        </div>

        <h1
          style={{
            fontSize: 24,
            fontWeight: 500,
            color: "#111",
            margin: "10px 0 0",
            lineHeight: 1.3,
          }}
        >
          {position.title}
        </h1>

        <p style={{ fontSize: 12, color: "#666", margin: "10px 0 0" }}>
          Posted by{" "}
          <Link
            href={`/talent/profile/${position.postedBy.id}`}
            style={{ color: "#111", textDecoration: "underline", textDecorationColor: "#c8a84b" }}
          >
            {position.postedBy.name}
          </Link>
          {position.postedBy.institution ? ` · ${position.postedBy.institution}` : ""}
        </p>

        {position.researchTopics.length > 0 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {position.researchTopics.map((t) => (
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
        ) : null}

        <section style={{ marginTop: 28 }}>
          <h2 style={sectionLabelStyle}>Description</h2>
          <p
            style={{
              fontSize: 14,
              color: "#333",
              lineHeight: 1.7,
              margin: "10px 0 0",
              whiteSpace: "pre-wrap",
            }}
          >
            {position.description}
          </p>
        </section>

        {position.requirements.length > 0 ? (
          <section style={{ marginTop: 28 }}>
            <h2 style={sectionLabelStyle}>Requirements</h2>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, color: "#444" }}>
              {position.requirements.map((r) => (
                <li key={r} style={{ marginBottom: 4 }}>
                  {r}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section style={{ marginTop: 28 }}>
          <h2 style={sectionLabelStyle}>Details</h2>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "180px 1fr",
              gap: 6,
              fontSize: 13,
              margin: "10px 0 0",
              color: "#444",
            }}
          >
            <Row k="Department" v={position.department} />
            <Row k="Lab" v={position.lab} />
            <Row k="Location" v={position.city ? `${position.city}${position.country ? ", " + position.country : ""}` : position.country} />
            <Row k="Salary" v={position.salary} />
            <Row k="Start date" v={position.startDate?.toISOString().split("T")[0] ?? null} />
            <Row k="Duration" v={position.duration} />
            <Row k="Contact" v={position.contactEmail} />
            <Row k="Website" v={position.website} link />
          </dl>
        </section>

        <section style={{ marginTop: 32 }}>
          <h2 style={sectionLabelStyle}>Top matches</h2>
          {position.matches.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
              No matched candidates yet. The matching engine runs when a
              position is posted; if it just was, refresh in a moment.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              {position.matches.map((m) => (
                <Link
                  key={m.id}
                  href={`/talent/profile/${m.profile.id}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "72px 1fr",
                    gap: 16,
                    padding: 14,
                    border: "0.5px solid #e8e0c8",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <ScoreRing score={m.score} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#111" }}>
                      {m.profile.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                      {m.profile.title ? `${m.profile.title} · ` : ""}
                      {m.profile.institution ?? "Independent"}
                      {m.profile.country ? ` · ${m.profile.country}` : ""}
                      {" · "}
                      {m.profile.paperCount} papers · {m.profile.totalCitations.toLocaleString("en-US")} citations
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <BreakdownBar
                        topicScore={m.topicScore}
                        citationScore={m.citationScore}
                        methodScore={m.methodScore}
                        venueScore={m.venueScore}
                      />
                    </div>
                    <ReasonPills reasons={m.reasons} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
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

function Row({ k, v, link }: { k: string; v: string | null | undefined; link?: boolean }) {
  if (!v) return null;
  return (
    <>
      <dt style={{ color: "#888" }}>{k}</dt>
      <dd style={{ margin: 0 }}>
        {link ? (
          <a href={v} target="_blank" rel="noopener noreferrer" style={{ color: "#111" }}>
            {v}
          </a>
        ) : (
          v
        )}
      </dd>
    </>
  );
}
