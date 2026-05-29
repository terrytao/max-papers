// /researchers — top 50 researchers by paper count. Each row links
// to /researchers/[id] for the wiki detail page. Populated by
// agents/extract-entities.ts from Paper.authors[].

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function ResearchersPage() {
  const people = await prisma.researcher.findMany({
    take: 50,
    orderBy: [{ paperCount: "desc" }, { citationCount: "desc" }],
    select: {
      id: true,
      name: true,
      institution: true,
      paperCount: true,
      citationCount: true,
      fields: true,
    },
  });

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 60px" }}>
      <Nav />

      <div
        style={{
          padding: "32px 0 16px",
          borderBottom: "0.5px solid #e8e0c8",
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "#c8a84b",
            margin: 0,
          }}
        >
          Researchers
        </p>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: "#111",
            letterSpacing: "-.02em",
            margin: "10px 0 0",
          }}
        >
          Top researchers by paper count
        </h1>
        <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>
          {people.length === 0
            ? "No researchers indexed yet."
            : `${people.length.toLocaleString()} shown.`}
        </p>
      </div>

      <div style={{ paddingTop: 8 }}>
        {people.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center" }}>
            <p style={{ fontSize: 13, color: "#888", margin: 0 }}>
              The researcher index is empty.
            </p>
            <p style={{ fontSize: 12, color: "#bbb", margin: "8px 0 0" }}>
              Researchers are extracted from paper authors via{" "}
              <code>agents/extract-entities.ts</code>.
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {people.map((r) => (
              <li
                key={r.id}
                style={{
                  padding: 0,
                  borderBottom: "0.5px solid #f0ebd9",
                }}
              >
                <Link
                  href={`/researchers/${r.id}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 16,
                    padding: "14px 0",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        color: "#111",
                        fontWeight: 500,
                        marginBottom: 3,
                      }}
                    >
                      {r.name}
                    </div>
                    {r.institution ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: "#888",
                          marginBottom: 4,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.institution}
                      </div>
                    ) : null}
                    {r.fields.length > 0 ? (
                      <div style={{ fontSize: 11, color: "#bbb" }}>
                        {r.fields.slice(0, 3).join(" · ")}
                      </div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 500, color: "#111" }}>
                      {r.paperCount.toLocaleString("en-US")}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#bbb",
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        marginBottom: 4,
                      }}
                    >
                      papers
                    </div>
                    {r.citationCount > 0 ? (
                      <div style={{ fontSize: 11, color: "#888" }}>
                        {r.citationCount.toLocaleString("en-US")} citations
                      </div>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
