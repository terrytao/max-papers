// /papers/[id] — single paper detail page.
//
// Server component; one Prisma read by primary key. notFound() fires
// when the id doesn't resolve (clean 404 via Next's not-found handler
// rather than an exception). generateMetadata gives the page a real
// <title> + description so shared links preview properly.

import { notFound } from "next/navigation";
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

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px" }}>
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
            {paper.journal ? ` · ${paper.journal}` : ""}
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
              {paper.fields.map((f) => (
                <span
                  key={`f-${f}`}
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    border: "0.5px solid #e8e0c8",
                    color: "#555",
                  }}
                >
                  {f}
                </span>
              ))}
              {paper.keywords.map((k) => (
                <span
                  key={`k-${k}`}
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    background: "#faf8f5",
                    color: "#888",
                  }}
                >
                  {k}
                </span>
              ))}
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
