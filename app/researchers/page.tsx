// /researchers — top 20 researchers by paperCount. Profile pages
// (per-researcher) aren't built yet; names are plain text for now.

import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function ResearchersPage() {
  const people = await prisma.researcher.findMany({
    take: 20,
    orderBy: [{ paperCount: "desc" }, { name: "asc" }],
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
          Researchers
        </h1>
        <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>
          {people.length === 0
            ? "No researchers indexed yet."
            : `Top ${people.length} by paper count.`}
        </p>
      </div>

      <div style={{ paddingTop: 8 }}>
        {people.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center" }}>
            <p style={{ fontSize: 13, color: "#888", margin: 0 }}>
              The researcher index is empty.
            </p>
            <p style={{ fontSize: 12, color: "#bbb", margin: "8px 0 0" }}>
              Researchers are extracted from paper authors during ingest.
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {people.map((r) => (
              <li
                key={r.id}
                style={{
                  padding: "14px 0",
                  borderBottom: "0.5px solid #f0ebd9",
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontSize: 14, color: "#111", fontWeight: 500 }}>
                    {r.website ? (
                      <a
                        href={r.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        {r.name}
                      </a>
                    ) : (
                      r.name
                    )}
                  </div>
                  {r.institution ? (
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                      {r.institution}
                    </div>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#888",
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.paperCount} paper{r.paperCount === 1 ? "" : "s"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
