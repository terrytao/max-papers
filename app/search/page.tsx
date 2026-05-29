// /search?q=… — keyword search across Paper.title, abstract, authors,
// and keywords. Sorted by citationCount desc. Server component;
// direct Prisma query, no API route in between.
//
// AI-powered semantic search (Claude + RAG) is the next layer on top
// — for v1 this is the simple keyword baseline so the form on the
// homepage stops 404-ing.

import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = (searchParams.q ?? "").trim().slice(0, 200);

  const results = q
    ? await prisma.paper.findMany({
        where: {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { abstract: { contains: q, mode: "insensitive" } },
            { authors: { has: q } },
            { keywords: { has: q } },
          ],
        },
        take: 20,
        orderBy: [{ citationCount: "desc" }, { publishedAt: "desc" }],
      })
    : [];

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px" }}>
      <Nav />
      <SearchHeader q={q} />
      <div style={{ paddingTop: 24 }}>
        {!q ? (
          <p style={{ fontSize: 13, color: "#888" }}>
            Type a query above to search.
          </p>
        ) : results.length === 0 ? (
          <p style={{ fontSize: 13, color: "#888" }}>
            No papers found for &ldquo;{q}&rdquo;. The database is still
            being populated — try a broader query, or check back soon.
          </p>
        ) : (
          <>
            <p
              style={{
                fontSize: 11,
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: ".1em",
                marginBottom: 18,
              }}
            >
              {results.length} result{results.length === 1 ? "" : "s"}
            </p>
            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {results.map((p) => (
                <PaperRow key={p.id} paper={p} />
              ))}
            </ol>
          </>
        )}
      </div>
    </main>
  );
}

function SearchHeader({ q }: { q: string }) {
  return (
    <div style={{ padding: "24px 0 16px", borderBottom: "0.5px solid #e8e0c8" }}>
      <form
        action="/search"
        method="GET"
        style={{ display: "flex", border: "0.5px solid #e8e0c8" }}
      >
        <input
          type="text"
          name="q"
          defaultValue={q}
          autoComplete="off"
          placeholder="Search papers…"
          style={{
            flex: 1,
            padding: "10px 14px",
            fontSize: 13,
            border: "none",
            outline: "none",
            background: "#fff",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "10px 22px",
            background: "#111",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          Search
        </button>
      </form>
    </div>
  );
}

type PaperPreview = {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  citationCount: number;
  url: string | null;
  pdfUrl: string | null;
  arxivId: string | null;
  doi: string | null;
  isOpenAccess: boolean;
};

function PaperRow({ paper: p }: { paper: PaperPreview }) {
  const authors = p.authors.slice(0, 4).join(", ");
  const moreAuthors = p.authors.length > 4 ? ` + ${p.authors.length - 4} more` : "";
  const abstract =
    p.abstract.length > 280 ? p.abstract.slice(0, 280) + "…" : p.abstract;
  return (
    <li
      style={{
        padding: "16px 0",
        borderBottom: "0.5px solid #f0ebd9",
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 500, color: "#111", margin: 0, lineHeight: 1.35 }}>
        <a
          href={`/papers/${p.id}`}
          style={{ color: "inherit", textDecoration: "none" }}
        >
          {p.title}
        </a>
      </h3>
      <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>
        {authors}
        {moreAuthors}
        {p.journal ? ` · ${p.journal}` : ""}
        {p.year ? ` · ${p.year}` : ""}
        {p.citationCount > 0 ? ` · ${p.citationCount} citations` : ""}
        {p.isOpenAccess ? ` · open access` : ""}
      </p>
      <p style={{ fontSize: 12, color: "#444", margin: "8px 0 0", lineHeight: 1.55 }}>
        {abstract}
      </p>
    </li>
  );
}
