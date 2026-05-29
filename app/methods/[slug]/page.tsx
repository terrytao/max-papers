// /methods/[slug] — wiki page for a research method (e.g. fMRI,
// CRISPR, contrastive learning). Mirror of /topics/[slug] but on
// the PaperMethod join.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = { params: { slug: string } };

async function getMethod(slug: string) {
  return prisma.method.findUnique({ where: { slug } });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = await getMethod(params.slug);
  if (!m) return { title: "Method not found" };
  return {
    title: m.name,
    description: `${m.name} — ${m.paperCount.toLocaleString("en-US")} indexed papers using this method on maxpaper.`,
  };
}

export default async function MethodPage({ params }: Props) {
  const method = await getMethod(params.slug);
  if (!method) notFound();

  const papers = await prisma.paperMethod.findMany({
    where: { methodId: method.id },
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
        },
      },
    },
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: method.name,
    url: `https://www.max-papers.com/methods/${method.slug}`,
    description: method.description ?? undefined,
    inDefinedTermSet: "https://www.max-papers.com/methods",
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
        <p style={kickerStyle}>Method</p>
        <h1 style={titleStyle}>{method.name}</h1>
        <p style={{ fontSize: 13, color: "#666", margin: "8px 0 0" }}>
          {method.paperCount.toLocaleString("en-US")} indexed paper
          {method.paperCount === 1 ? "" : "s"} using this method.
        </p>
        {method.description ? (
          <p
            style={{
              fontSize: 14,
              color: "#333",
              lineHeight: 1.7,
              margin: "20px 0 0",
            }}
          >
            {method.description}
          </p>
        ) : null}
        <section style={{ marginTop: 32 }}>
          <h2 style={sectionLabelStyle}>Top papers using this method</h2>
          {papers.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
              No papers indexed for this method yet.
            </p>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {papers.map((pm) => (
                <li
                  key={pm.paper.id}
                  style={{ padding: "12px 0", borderBottom: "0.5px solid #f0ebd9" }}
                >
                  <Link
                    href={`/papers/${pm.paper.id}`}
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "#111",
                      textDecoration: "none",
                      lineHeight: 1.35,
                    }}
                  >
                    {pm.paper.title}
                  </Link>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                    {pm.paper.authors.slice(0, 3).join(", ")}
                    {pm.paper.authors.length > 3 ? ` + ${pm.paper.authors.length - 3}` : ""}
                    {pm.paper.journal ? ` · ${pm.paper.journal}` : ""}
                    {pm.paper.year ? ` · ${pm.paper.year}` : ""}
                    {pm.paper.citationCount > 0
                      ? ` · ${pm.paper.citationCount.toLocaleString("en-US")} citations`
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
  fontSize: 11, color: "#888", textDecoration: "none",
  letterSpacing: ".05em", textTransform: "uppercase",
};
const kickerStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, letterSpacing: ".18em",
  textTransform: "uppercase", color: "#c8a84b", margin: "18px 0 0",
};
const titleStyle: React.CSSProperties = {
  fontSize: 26, fontWeight: 500, color: "#111",
  letterSpacing: "-.02em", margin: "10px 0 0", lineHeight: 1.25,
};
const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 500, letterSpacing: ".08em",
  textTransform: "uppercase", color: "#c8a84b", margin: 0,
};
