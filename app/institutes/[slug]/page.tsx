// /institutes/[slug] — wiki page for a research institute.
//
// Note: Institute rows are intentionally empty in v1 — affiliations
// aren't in our current OpenAlex ingest. The page renders an empty
// state instead of 404-ing so links from internal places (future
// extraction agent, talent profiles) don't break. When affiliations
// land, the same page lights up with real content.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = { params: { slug: string } };

async function getInstitute(slug: string) {
  return prisma.institute.findUnique({ where: { slug } });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const i = await getInstitute(params.slug);
  if (!i) return { title: "Institute not found" };
  return {
    title: i.name,
    description: `${i.name}${i.country ? ` (${i.country})` : ""} — ${i.paperCount.toLocaleString("en-US")} indexed papers on maxpaper.`,
  };
}

export default async function InstitutePage({ params }: Props) {
  const inst = await getInstitute(params.slug);
  if (!inst) notFound();

  const papers = await prisma.paperInstitute.findMany({
    where: { instituteId: inst.id },
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
    "@type": inst.type === "company" ? "Organization" : "EducationalOrganization",
    name: inst.name,
    alternateName: inst.shortName ?? undefined,
    url: inst.website ?? `https://www.max-papers.com/institutes/${inst.slug}`,
    address:
      inst.country || inst.city
        ? {
            "@type": "PostalAddress",
            addressCountry: inst.country ?? undefined,
            addressLocality: inst.city ?? undefined,
          }
        : undefined,
    description: inst.description ?? undefined,
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
        <p style={kickerStyle}>Institute</p>
        <h1 style={titleStyle}>{inst.name}</h1>
        <p style={{ fontSize: 13, color: "#666", margin: "8px 0 0" }}>
          {inst.type ? `${inst.type} · ` : ""}
          {inst.city ? `${inst.city}, ` : ""}
          {inst.country ?? ""}
          {inst.paperCount > 0
            ? ` · ${inst.paperCount.toLocaleString("en-US")} indexed papers`
            : ""}
        </p>
        {inst.website ? (
          <p style={{ marginTop: 8 }}>
            <a
              href={inst.website}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: "#c8a84b", textDecoration: "none" }}
            >
              Visit institute ↗
            </a>
          </p>
        ) : null}
        {inst.description ? (
          <p style={{ fontSize: 14, color: "#333", lineHeight: 1.7, margin: "20px 0 0" }}>
            {inst.description}
          </p>
        ) : null}

        <section style={{ marginTop: 32 }}>
          <h2 style={sectionLabelStyle}>Top papers</h2>
          {papers.length === 0 ? (
            <p style={{ fontSize: 13, color: "#888", marginTop: 10 }}>
              No papers attached to this institute yet — author-affiliation
              ingest is a planned extension. Check back when it lands.
            </p>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {papers.map((pi) => (
                <li
                  key={pi.paper.id}
                  style={{ padding: "12px 0", borderBottom: "0.5px solid #f0ebd9" }}
                >
                  <Link
                    href={`/papers/${pi.paper.id}`}
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "#111",
                      textDecoration: "none",
                      lineHeight: 1.35,
                    }}
                  >
                    {pi.paper.title}
                  </Link>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                    {pi.paper.authors.slice(0, 3).join(", ")}
                    {pi.paper.authors.length > 3 ? ` + ${pi.paper.authors.length - 3}` : ""}
                    {pi.paper.journal ? ` · ${pi.paper.journal}` : ""}
                    {pi.paper.year ? ` · ${pi.paper.year}` : ""}
                    {pi.paper.citationCount > 0
                      ? ` · ${pi.paper.citationCount.toLocaleString("en-US")} citations`
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
