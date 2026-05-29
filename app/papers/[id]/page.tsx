// /papers/[id] — single paper detail page.
//
// Server component; one Prisma read by primary key. notFound() fires
// when the id doesn't resolve (clean 404 via Next's not-found handler
// rather than an exception). generateMetadata gives the page a real
// <title> + description so shared links preview properly.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = { params: { id: string } };

async function getPaper(id: string) {
  return prisma.paper.findUnique({ where: { id } });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const paper = await getPaper(params.id);
  if (!paper) return { title: "Paper not found" };
  const firstAuthor = paper.authors[0];
  const byline =
    firstAuthor && paper.authors.length > 1
      ? `${firstAuthor} et al.`
      : firstAuthor ?? "";
  const summary = paper.abstract.slice(0, 160).replace(/\s+/g, " ").trim();
  return {
    title: paper.title,
    description: byline ? `${byline} — ${summary}` : summary,
  };
}

export default async function PaperPage({ params }: Props) {
  const paper = await getPaper(params.id);
  if (!paper) notFound();

  const externalUrl = paper.url ?? null;
  const arxivUrl = paper.arxivId ? `https://arxiv.org/abs/${paper.arxivId}` : null;
  const doiUrl = paper.doi ? `https://doi.org/${paper.doi}` : null;
  const dateLine = paper.publishedAt
    ? paper.publishedAt.toISOString().split("T")[0]
    : paper.year
      ? String(paper.year)
      : null;

  // Wiki-entity lookups for inline links — N+1 by row but each is a
  // unique-index hit so it's cheap. If this hot-path matters later,
  // batch into one $queryRaw.
  const [journalRow, topicRows, methodRows] = await Promise.all([
    paper.journal
      ? prisma.journal.findUnique({
          where: { name: paper.journal },
          select: { slug: true },
        })
      : Promise.resolve(null),
    paper.fields.length > 0
      ? prisma.topic.findMany({
          where: { name: { in: paper.fields } },
          select: { name: true, slug: true },
        })
      : Promise.resolve([]),
    paper.keywords.length > 0
      ? prisma.method.findMany({
          where: { name: { in: paper.keywords } },
          select: { name: true, slug: true },
        })
      : Promise.resolve([]),
  ]);
  const topicSlugByName = new Map(topicRows.map((t) => [t.name, t.slug]));
  const methodSlugByName = new Map(methodRows.map((m) => [m.name, m.slug]));

  // JSON-LD: ScholarlyArticle. Google's Article structured-data
  // surface picks this up; helps with rich-result eligibility.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    headline: paper.title,
    abstract: paper.abstract.slice(0, 5000),
    author: paper.authors.slice(0, 30).map((name) => ({
      "@type": "Person",
      name,
    })),
    datePublished: paper.publishedAt?.toISOString().split("T")[0] ?? undefined,
    isAccessibleForFree: paper.isOpenAccess,
    citation: paper.citationCount,
    sameAs: [externalUrl, arxivUrl, doiUrl].filter(Boolean),
    isPartOf: paper.journal
      ? {
          "@type": "Periodical",
          name: paper.journal,
          url: journalRow
            ? `https://www.max-papers.com/journals/${journalRow.slug}`
            : undefined,
        }
      : undefined,
    keywords: [...paper.fields, ...paper.keywords].slice(0, 20).join(", "),
    url: `https://www.max-papers.com/papers/${paper.id}`,
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
        <a
          href="/"
          style={{
            fontSize: 11,
            color: "#888",
            textDecoration: "none",
            letterSpacing: ".05em",
            textTransform: "uppercase",
          }}
        >
          ← Back to search
        </a>

        {/* Badge row */}
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 18,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {paper.fields[0] ? (
            <span
              style={{
                fontSize: 10,
                padding: "2px 7px",
                background: "#e6f1fb",
                color: "#185fa5",
              }}
            >
              {paper.fields[0]}
            </span>
          ) : null}
          {paper.isOpenAccess ? (
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
            {dateLine ?? "Date unknown"}
            {paper.journal ? (
              <>
                {" · "}
                {journalRow ? (
                  <Link
                    href={`/journals/${journalRow.slug}`}
                    style={{ color: "#888", textDecoration: "underline", textDecorationColor: "#e8e0c8" }}
                  >
                    {paper.journal}
                  </Link>
                ) : (
                  paper.journal
                )}
              </>
            ) : null}
            {paper.citationCount > 0
              ? ` · ${paper.citationCount.toLocaleString("en-US")} citations`
              : ""}
          </span>
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: 24,
            fontWeight: 500,
            color: "#111",
            letterSpacing: "-.02em",
            lineHeight: 1.3,
            margin: "12px 0 0",
          }}
        >
          {paper.title}
        </h1>

        {/* Authors */}
        {paper.authors.length > 0 ? (
          <p
            style={{
              fontSize: 13,
              color: "#555",
              margin: "10px 0 0",
              lineHeight: 1.5,
            }}
          >
            {paper.authors.join(", ")}
          </p>
        ) : null}

        {/* Action buttons */}
        {externalUrl || paper.pdfUrl || arxivUrl || doiUrl ? (
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 18,
              flexWrap: "wrap",
            }}
          >
            {externalUrl ? (
              <ActionLink href={externalUrl} primary>
                View source ↗
              </ActionLink>
            ) : null}
            {paper.pdfUrl ? <ActionLink href={paper.pdfUrl}>PDF ↗</ActionLink> : null}
            {arxivUrl ? <ActionLink href={arxivUrl}>arXiv ↗</ActionLink> : null}
            {doiUrl ? <ActionLink href={doiUrl}>DOI ↗</ActionLink> : null}
          </div>
        ) : null}

        {/* Abstract */}
        <section style={{ marginTop: 28 }}>
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
            Abstract
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "#333",
              lineHeight: 1.7,
              margin: "10px 0 0",
              whiteSpace: "pre-wrap",
            }}
          >
            {paper.abstract || "No abstract available."}
          </p>
        </section>

        {/* Keywords / fields */}
        {paper.keywords.length > 0 || paper.fields.length > 1 ? (
          <section style={{ marginTop: 28 }}>
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
              Topics
            </h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 10,
              }}
            >
              {paper.fields.map((f) => {
                const slug = topicSlugByName.get(f);
                const baseStyle: React.CSSProperties = {
                  fontSize: 11,
                  padding: "3px 8px",
                  border: "0.5px solid #e8e0c8",
                  color: "#555",
                  textDecoration: "none",
                };
                return slug ? (
                  <Link key={`f-${f}`} href={`/topics/${slug}`} style={baseStyle}>
                    {f}
                  </Link>
                ) : (
                  <span key={`f-${f}`} style={baseStyle}>{f}</span>
                );
              })}
              {paper.keywords.map((k) => {
                const slug = methodSlugByName.get(k);
                const baseStyle: React.CSSProperties = {
                  fontSize: 11,
                  padding: "3px 8px",
                  background: "#faf8f5",
                  color: "#888",
                  textDecoration: "none",
                };
                return slug ? (
                  <Link key={`k-${k}`} href={`/methods/${slug}`} style={baseStyle}>
                    {k}
                  </Link>
                ) : (
                  <span key={`k-${k}`} style={baseStyle}>{k}</span>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Footer metadata */}
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
          {paper.doi ? (
            <div>
              DOI: <code style={{ color: "#555" }}>{paper.doi}</code>
            </div>
          ) : null}
          {paper.arxivId ? (
            <div>
              arXiv: <code style={{ color: "#555" }}>{paper.arxivId}</code>
            </div>
          ) : null}
          {paper.openAlexId ? (
            <div>
              OpenAlex: <code style={{ color: "#555" }}>{paper.openAlexId}</code>
            </div>
          ) : null}
          <div>
            Indexed via {paper.submittedVia ?? "unknown source"} on{" "}
            {paper.createdAt.toISOString().split("T")[0]}.
          </div>
        </footer>
      </article>
    </main>
  );
}

function ActionLink({
  href,
  children,
  primary,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        fontSize: 12,
        padding: "7px 14px",
        background: primary ? "#111" : "#fff",
        color: primary ? "#fff" : "#111",
        border: primary ? "0.5px solid #111" : "0.5px solid #e8e0c8",
        textDecoration: "none",
        cursor: "pointer",
      }}
    >
      {children}
    </a>
  );
}
