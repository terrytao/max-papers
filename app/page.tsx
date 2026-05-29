// maxpaper homepage. Server component — fetches the live paperCount
// for the hero tagline, then mounts <SearchExperience /> (client) for
// the interactive query/filter/results UI.

import { Nav } from "@/components/Nav";
import { SearchExperience } from "@/components/SearchExperience";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Real DB count whenever the ingest agent has populated rows; soft
  // "50 million+" placeholder before then so the hero doesn't
  // advertise "0 papers" while the index is warming up.
  const paperCount = await prisma.paper.count().catch(() => 0);
  const displayCount =
    paperCount > 0
      ? `${paperCount.toLocaleString("en-US")}+ research papers`
      : "50 million+ research papers";

  // Widen the page when search results are showing so the
  // 220-px filter rail + result list fit comfortably. The hero
  // itself still reads centered on the narrower column.
  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "0 20px" }}>
      <Nav />

      <div
        style={{
          padding: "48px 0 32px",
          textAlign: "center",
          borderBottom: "0.5px solid #e8e0c8",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "#c8a84b",
            marginBottom: 12,
          }}
        >
          {displayCount}
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 500,
            color: "#111",
            letterSpacing: "-.03em",
            marginBottom: 8,
            lineHeight: 1.2,
          }}
        >
          Ask science anything.
          <br />
          Get a real answer.
        </h1>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>
          Search in plain English. Free.
        </p>
        <SearchExperience />
      </div>
    </main>
  );
}
