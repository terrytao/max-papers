// /browse — top 20 papers by citation count. No filters yet; faceted
// filtering (field, year range, open-access) is the next iteration.

import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function BrowsePage() {
  const papers = await prisma.paper.findMany({
    take: 20,
    orderBy: [{ citationCount: "desc" }, { publishedAt: "desc" }],
  });

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px" }}>
      <Nav />

      <div
        style={{
          padding: "32px 0 16px",
          borderBottom: "0.5px solid #e8e0c8",
        }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: "#111",
            letterSpacing: "-.02em",
            margin: 0,
          }}
        >
          Browse papers
        </h1>
        <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>
          Top {papers.length} by citation count
          {papers.length === 0 ? "" : " · most-cited first"}.
        </p>
      </div>

      <div style={{ paddingTop: 8 }}>
        {papers.length === 0 ? (
          <EmptyState />
        ) : (
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {papers.map((p) => (
              <li
                key={p.id}
                style={{
                  padding: "16px 0",
                  borderBottom: "0.5px solid #f0ebd9",
                }}
              >
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#111",
                    margin: 0,
                    lineHeight: 1.35,
                  }}
                >
                  {p.title}
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: "#888",
                    margin: "6px 0 0",
                  }}
                >
                  {p.authors.slice(0, 3).join(", ")}
                  {p.authors.length > 3 ? ` + ${p.authors.length - 3} more` : ""}
                  {p.journal ? ` · ${p.journal}` : ""}
                  {p.year ? ` · ${p.year}` : ""}
                  {p.citationCount > 0 ? ` · ${p.citationCount} citations` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: "32px 0", textAlign: "center" }}>
      <p style={{ fontSize: 13, color: "#888", margin: 0 }}>
        No papers in the database yet.
      </p>
      <p style={{ fontSize: 12, color: "#bbb", margin: "8px 0 0" }}>
        The ingest pipeline is being built. Check back soon.
      </p>
    </div>
  );
}
