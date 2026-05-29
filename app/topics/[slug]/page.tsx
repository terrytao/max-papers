// /topics/[slug] — wiki page for a research topic. Lists top
// papers tagged with this topic via the PaperTopic join, plus
// co-occurring topics so the SEO surface forms a real graph.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = { params: { slug: string } };

async function getTopic(slug: string) {
  return prisma.topic.findUnique({ where: { slug } });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTopic(params.slug);
  if (!t) return { title: "Topic not found" };
  return {
    title: t.name,
    description: `${t.name} — ${t.paperCount.toLocaleString("en-US")} research papers indexed on maxpaper.`,
  };
}

export default async function TopicPage({ params }: Props) {
  const topic = await getTopic(params.slug);
  if (!topic) notFound();

  const papers = await prisma.paperTopic.findMany({
    where: { topicId: topic.id },
    take: 20,
    orderBy: { paper: { citationCount: "desc" } },
    include: {
      paper: {
        select: {
          id: true,
          title: true,
          authors: true,
          year: true,
          journal: true,
          citationCount: true,
          isOpenAccess: true,
        },
      },
    },
  });

  // Co-occurring topics: distinct topics that share papers with this
  // one, ranked by overlap. Caps at 12 for the related-topics chip
  // row. One raw query to avoid the round-trip explosion of doing
  // it through Prisma's findMany.
  const related = await prisma.$queryRaw<
    Array<{ id: string; name: string; slug: string; co: bigint }>
  >`
    SELECT t.id, t.name, t.slug, COUNT(*) AS co
    FROM "PaperTopic" pt
    JOIN "PaperTopic" pt2 ON pt2."paperId" = pt."paperId" AND pt2."topicId" <> pt."topicId"
    JOIN "Topic" t ON t.id = pt2."topicId"
    WHERE pt."topicId" = ${topic.id}
    GROUP BY t.id, t.name, t.slug
    ORDER BY co DESC
    LIMIT 12
  `;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: topic.name,
    url: `https://www.max-papers.com/topics/${topic.slug}`,
    description: topic.description ?? undefined,
    inDefinedTermSet: "https://www.max-papers.com/topics",
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
        <Link href="/" style={backLinkStyle}>← Back to maxpaper</Link>
        <p style={kickerStyle}>Topic</p>
        <h1 style={titleStyle}>{topic.name}</h1>
        <p style={{ fontSize: 13, color: "#666", margin: "8px 0 0" }}>
          {topic.paperCount.toLocaleString("en-US")} indexed paper
          {topic.paperCount === 1 ? "" : "s"} in this topic.
        </p>
        {topic.description ? (
          <p
            style={{
              fontSize: 14,
              color: "#333",
              lineHeight: 1.7,
              margin: "20px 0 0",
            }}
          >
            {topic.description}
          </p>
        ) : null}

        {related.length > 0 ? (
          <section style={{ marginTop: 28 }}>
            <h2 style={sectionLabelStyle}>Related topics</h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 10,
              }}
            >
              {related.map((r) => (
                <Link
                  key={r.id}
                  href={`/topics/${r.slug}`}
                  style={{
                    fontSize: 11,
                    padding: "3px 9px",
                    background: "#faf8f5",
                    border: "0.5px solid #e8e0c8",
                    color: "#555",
                    textDecoration: "none",
                  }}
                >
                  {r.name} · {Number(r.co)}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section style={{ marginTop: 32 }}>
          <h2 style={sectionLabelStyle}>Top papers</h2>
          {papers.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
              No papers indexed for this topic yet.
            </p>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {papers.map((pt) => (
                <li
                  key={pt.paper.id}
                  style={{ padding: "12px 0", borderBottom: "0.5px solid #f0ebd9" }}
                >
                  <Link
                    href={`/papers/${pt.paper.id}`}
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "#111",
                      textDecoration: "none",
                      lineHeight: 1.35,
                    }}
                  >
                    {pt.paper.title}
                  </Link>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                    {pt.paper.authors.slice(0, 3).join(", ")}
                    {pt.paper.authors.length > 3
                      ? ` + ${pt.paper.authors.length - 3}`
                      : ""}
                    {pt.paper.journal ? ` · ${pt.paper.journal}` : ""}
                    {pt.paper.year ? ` · ${pt.paper.year}` : ""}
                    {pt.paper.citationCount > 0
                      ? ` · ${pt.paper.citationCount.toLocaleString("en-US")} citations`
                      : ""}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
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
