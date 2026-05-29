// Topic-focused paper collector.
//
// Counterpart to agents/ingest-papers.ts: where that one grabbed the
// global top-cited 2024+ corpus (skewing heavily medical), this one
// fills domain holes by pulling per-topic via OpenAlex's
// concepts.display_name filter. 100 papers per topic, 5 topics, so
// ~500 papers per run.
//
// Designed to be re-run safely — upserts on openAlexId, so a second
// run only refreshes the citation count on existing rows.
//
// Run:  npx tsx agents/collect-papers.ts

import "dotenv/config";
import { prisma } from "../lib/prisma";

type OpenAlexWork = {
  id?: string;
  doi?: string | null;
  title?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: Array<{ author?: { display_name?: string } }>;
  publication_year?: number | null;
  primary_location?: { source?: { display_name?: string | null } | null } | null;
  cited_by_count?: number | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null;
  concepts?: Array<{ display_name?: string | null }>;
};

type OpenAlexPage = {
  results?: OpenAlexWork[];
  meta?: { next_cursor?: string | null };
};

const CONTACT_EMAIL = "terry.tao@max-robotics.com";
const USER_AGENT = `max-papers-collect/1.0 (mailto:${CONTACT_EMAIL})`;

function reconstructAbstract(
  inverted: Record<string, number[]> | null | undefined,
): string {
  if (!inverted) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  return words.filter(Boolean).join(" ").slice(0, 5000);
}

function stripOpenAlexPrefix(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.replace(/^https?:\/\/openalex\.org\//i, "") || null;
}

function stripDoiPrefix(doi: string | null | undefined): string | null {
  if (!doi) return null;
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase() || null;
}

async function collectFromOpenAlex(topic: string, limit: number): Promise<number> {
  console.log(`[collect] topic="${topic}" target=${limit}`);
  let collected = 0;
  let cursor: string | null = "*";
  let pages = 0;

  while (collected < limit && cursor) {
    pages++;
    const url = new URL("https://api.openalex.org/works");
    // OpenAlex deprecated `concepts.display_name` — use the `search`
    // param (full-text across title + abstract) plus the structured
    // filter for has_abstract / language. Sort is implicit
    // "relevance_score desc" when `search` is set, which is the
    // right thing for topic-focused collection.
    url.searchParams.set("search", topic);
    url.searchParams.set("filter", "has_abstract:true,language:en");
    url.searchParams.set("per-page", "50");
    url.searchParams.set("cursor", cursor);
    url.searchParams.set(
      "select",
      "id,title,abstract_inverted_index,authorships,publication_year,primary_location,doi,cited_by_count,open_access,concepts",
    );
    url.searchParams.set("mailto", CONTACT_EMAIL);

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[collect] ${topic}: HTTP ${res.status} on page ${pages}, stopping`);
      break;
    }
    const data = (await res.json()) as OpenAlexPage;
    const works = data.results ?? [];
    if (works.length === 0) {
      console.log(`[collect] ${topic}: empty page, done`);
      break;
    }

    for (const p of works) {
      if (collected >= limit) break;
      const title = p.title?.trim();
      const openAlexId = stripOpenAlexPrefix(p.id);
      if (!title || !openAlexId) continue;
      const abstract = reconstructAbstract(p.abstract_inverted_index);
      if (abstract.length < 50) continue;
      try {
        await prisma.paper.upsert({
          where: { openAlexId },
          create: {
            title: title.slice(0, 1000),
            abstract,
            authors: (p.authorships ?? [])
              .map((a) => a.author?.display_name?.trim())
              .filter((n): n is string => !!n)
              .slice(0, 30),
            year: p.publication_year ?? null,
            journal: p.primary_location?.source?.display_name ?? null,
            doi: stripDoiPrefix(p.doi),
            openAlexId,
            url: p.id ?? null,
            pdfUrl: p.open_access?.oa_url ?? null,
            isOpenAccess: !!p.open_access?.is_oa,
            citationCount: p.cited_by_count ?? 0,
            fields: (p.concepts ?? [])
              .slice(0, 5)
              .map((c) => c.display_name?.trim())
              .filter((n): n is string => !!n),
            keywords: (p.concepts ?? [])
              .slice(0, 10)
              .map((c) => c.display_name?.trim().toLowerCase())
              .filter((n): n is string => !!n),
            submittedVia: "collect-agent",
            publishedAt: p.publication_year
              ? new Date(p.publication_year, 0, 1)
              : null,
          },
          update: {
            citationCount: p.cited_by_count ?? 0,
          },
        });
        collected++;
        if (collected % 50 === 0) {
          console.log(`[collect] ${topic}: ${collected}/${limit}`);
        }
      } catch (err) {
        const msg = (err as Error).message ?? "";
        if (!msg.includes("Unique constraint")) {
          console.error(`[collect] ${topic}: error saving paper:`, msg.slice(0, 200));
        }
      }
    }

    cursor = data.meta?.next_cursor ?? null;
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[collect] ${topic}: DONE collected=${collected} pages=${pages}`);
  return collected;
}

async function main() {
  console.log("[collect] starting topic-focused paper collection");

  const topics = [
    "Robotics",
    "Artificial Intelligence",
    "Machine Learning",
    "Computer Vision",
    "Natural Language Processing",
  ];

  const startedAt = Date.now();
  let total = 0;
  for (const topic of topics) {
    total += await collectFromOpenAlex(topic, 100);
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`\n[collect] total=${total} elapsed=${elapsed}s`);
  const dbCount = await prisma.paper.count();
  console.log(`[collect] DB now has ${dbCount.toLocaleString("en-US")} papers`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[collect] FATAL:", err);
  process.exit(1);
});
