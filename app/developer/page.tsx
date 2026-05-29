// /developer — landing page for the (future) public API. No
// endpoints exist yet; this is the placeholder so the nav link
// stops 404-ing. The actual REST + MCP surface gets built once
// there's enough data in the DB to be worth searching.

import { prisma } from "@/lib/prisma";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function DeveloperPage() {
  const [paperCount, researcherCount] = await Promise.all([
    prisma.paper.count().catch(() => 0),
    prisma.researcher.count().catch(() => 0),
  ]);

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "0 20px" }}>
      <Nav />

      <div style={{ padding: "32px 0 16px", borderBottom: "0.5px solid #e8e0c8" }}>
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
          For developers
        </p>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: "#111",
            letterSpacing: "-.02em",
            margin: "10px 0 0",
            lineHeight: 1.25,
          }}
        >
          Build with maxpaper
        </h1>
        <p style={{ fontSize: 13, color: "#666", margin: "10px 0 0" }}>
          A public API for the maxpaper index is in early development.
          Below is what currently lives in the database.
        </p>
      </div>

      <div
        style={{
          padding: "24px 0",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          borderBottom: "0.5px solid #e8e0c8",
        }}
      >
        <Stat n={paperCount} label="papers" />
        <Stat n={researcherCount} label="researchers" />
      </div>

      <section style={{ padding: "32px 0 0" }}>
        <h2
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "#111",
            margin: 0,
          }}
        >
          Planned endpoints
        </h2>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "12px 0 0",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <Endpoint method="GET" path="/api/papers/search" what="Keyword + filter search" />
          <Endpoint method="GET" path="/api/papers/:id" what="Single paper detail" />
          <Endpoint method="GET" path="/api/researchers/search" what="Researcher lookup" />
          <Endpoint method="POST" path="/api/papers/submit" what="Submit an arXiv URL — auto-ingested" />
          <Endpoint method="POST" path="/api/errors/report" what="Flag bad metadata for review" />
        </ul>
        <p style={{ fontSize: 11, color: "#bbb", marginTop: 16 }}>
          None of these endpoints are live yet — when they ship, an OpenAPI
          spec will be served at <code>/openapi.json</code> for one-click
          import into ChatGPT GPT Actions and similar tools.
        </p>
      </section>
    </main>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p style={{ fontSize: 28, fontWeight: 500, color: "#111", margin: 0, letterSpacing: "-.02em" }}>
        {n.toLocaleString("en-US")}
      </p>
      <p
        style={{
          fontSize: 11,
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: ".1em",
          margin: "6px 0 0",
        }}
      >
        {label}
      </p>
    </div>
  );
}

function Endpoint({
  method,
  path,
  what,
}: {
  method: "GET" | "POST";
  path: string;
  what: string;
}) {
  return (
    <li
      style={{
        display: "flex",
        gap: 12,
        alignItems: "baseline",
        fontSize: 12,
      }}
    >
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 10,
          color: method === "POST" ? "#0891b2" : "#c8a84b",
          letterSpacing: ".05em",
          minWidth: 40,
        }}
      >
        {method}
      </span>
      <code
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "#111",
        }}
      >
        {path}
      </code>
      <span style={{ color: "#888" }}>— {what}</span>
    </li>
  );
}
