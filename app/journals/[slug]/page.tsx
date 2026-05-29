// /journals/[slug] — wiki page for a journal. Lists top papers
// published in this journal by citation count. JSON-LD as
// schema.org/Periodical for search-engine entity recognition.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = { params: { slug: string } };

async function getJournal(slug: string) {
  return prisma.journal.findUnique({ where: { slug } });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const j = await getJournal(params.slug);
  if (!j) return { title: "Journal not found" };
  return {
    title: j.name,
    description: `${j.name} — ${j.paperCount.toLocaleString("en-US")} indexed papers on maxpaper.`,
  };
}

export default async function JournalPage({ params }: Props) {
  const j = await getJournal(params.slug);
  if (!j) notFound();

  // Journal-to-paper match is on the literal Paper.journal string —
  // see populate-entities.ts for the rationale on not adding a FK.
  const papers = await prisma.paper.findMany({
    where: { journal: j.name },
    take: 20,
    orderBy: [{ citationCount: "desc" }, { publishedAt: "desc" }],
    select: {
      id: true,
      title: true,
      authors: true,
      year: true,
      citationCount: true,
      isOpenAccess: true,
    },
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Periodical",
    name: j.name,
    issn: undefined,
    url: `https://www.max-papers.com/journals/${j.slug}`,
    description: j.description ?? undefined,
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
        <p style={kickerStyle}>Journal</p>
        <h1 style={titleStyle}>{j.name}</h1>
        <p style={{ fontSize: 13, color: "#666", margin: "8px 0 0" }}>
          {j.paperCount.toLocaleString("en-US")} indexed paper
          {j.paperCount === 1 ? "" : "s"}
          {j.impactFactor ? ` · IF ${j.impactFactor}` : ""}
        </p>
        {j.website ? (
          <p style={{ marginTop: 8 }}>
            <a
              href={j.website}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: "#c8a84b", textDecoration: "none" }}
            >
              Visit journal ↗
            </a>
          </p>
        ) : null}
        {j.description ? (
          <p
            style={{
              fontSize: 14,
              color: "#333",
              lineHeight: 1.7,
              margin: "20px 0 0",
            }}
          >
            {j.description}
          </p>
        ) : null}

        <section style={{ marginTop: 32 }}>
          <h2 style={sectionLabelStyle}>Top papers</h2>
          {papers.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
              No papers indexed under this journal yet.
            </p>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {papers.map((p) => (
                <PaperLi key={p.id} paper={p} />
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

function PaperLi({
  paper: p,
}: {
  paper: {
    id: string;
    title: string;
    authors: string[];
    year: number | null;
    citationCount: number;
    isOpenAccess: boolean;
  };
}) {
  return (
    <li
      style={{ padding: "12px 0", borderBottom: "0.5px solid #f0ebd9" }}
    >
      <Link
        href={`/papers/${p.id}`}
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: "#111",
          textDecoration: "none",
          lineHeight: 1.35,
        }}
      >
        {p.title}
      </Link>
      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
        {p.authors.slice(0, 3).join(", ")}
        {p.authors.length > 3 ? ` + ${p.authors.length - 3}` : ""}
        {p.year ? ` · ${p.year}` : ""}
        {p.citationCount > 0
          ? ` · ${p.citationCount.toLocaleString("en-US")} citations`
          : ""}
        {p.isOpenAccess ? " · open access" : ""}
      </div>
    </li>
  );
}
