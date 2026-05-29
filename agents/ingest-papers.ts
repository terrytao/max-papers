// Multi-field paper ingest agent for maxpaper.
//
// Source for v1: OpenAlex (https://api.openalex.org). Free, polite
// service that already aggregates CrossRef, PubMed, arXiv, MAG, and
// hundreds of journal feeds across every field — Computer Science,
// Medicine, Physics, Biology, Economics, Mathematics, etc. One
// source covers what the max-robotics agent needed four sources for,
// because that agent had to filter to robotics-only post-hoc.
//
// arXiv direct (cs.* + math.* + stat.*) is a planned Phase 2 addition
// for early-stage preprints that haven't been picked up by OpenAlex
// yet — usually a 1-3 week lag.
//
// Strategy:
//   1. Cursor-paginate OpenAlex `/works` sorted by cited_by_count desc,
//      filtered to recent English articles with abstracts.
//   2. Normalize each Work to the Paper schema, reconstructing the
//      abstract from OpenAlex's inverted-index encoding.
//   3. Batch-insert via createMany({ skipDuplicates: true }) — the
//      three @unique columns (doi, arxivId, openAlexId) handle
//      dedup at the database level.
//   4. Stop when TARGET new rows are inserted or OpenAlex runs out.
//
// Run:    npx tsx agents/ingest-papers.ts
// First-run target:  10,000 papers
// Daily target:      1,000 papers (env override: TARGET=1000)
//
// Researcher rows are NOT populated here — that's a follow-up
// aggregation pass once we have enough Paper data to make the
// dedupe worth doing on the right axis (name+institution).

import "dotenv/config";
import { prisma } from "../lib/prisma";

const TARGET = Number(process.env.TARGET ?? 10_000);
const PER_PAGE = 200;
const POLITENESS_DELAY_MS = 250;
const CONTACT_EMAIL = "terry.tao@max-robotics.com";
const USER_AGENT = `max-papers-ingest/1.0 (mailto:${CONTACT_EMAIL})`;

// OpenAlex Work — only the fields we actually consume.
type OpenAlexWork = {
  id?: string;
  doi?: string | null;
  display_name?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: Array<{ author?: { display_name?: string } }>;
  publication_year?: number | null;
  publication_date?: string | null;
  primary_location?: { source?: { display_name?: string | null } | null } | null;
  primary_topic?: { field?: { display_name?: string | null } | null } | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null;
  cited_by_count?: number | null;
  keywords?: Array<{ display_name?: string | null }> | null;
};

type OpenAlexPage = {
  results?: OpenAlexWork[];
  meta?: { next_cursor?: string | null; count?: number };
};

async function fetchOpenAlexPage(cursor: string): Promise<OpenAlexPage> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set(
    "filter",
    [
      "type:article",
      "has_abstract:true",
      "language:en",
      "from_publication_date:2024-01-01",
    ].join(","),
  );
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("cursor", cursor);
  url.searchParams.set("mailto", CONTACT_EMAIL);
  url.searchParams.set("sort", "cited_by_count:desc");
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`OpenAlex ${res.status} ${res.statusText} — ${await res.text().catch(() => "")}`);
  }
  return res.json() as Promise<OpenAlexPage>;
}

// OpenAlex stores abstracts as { word: [positions] } to dodge
// publisher copyright on long-form text. Rebuild the sentence by
// placing each word at its first position.
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

function stripDoiPrefix(doi: string | null | undefined): string | null {
  if (!doi) return null;
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase() || null;
}

function stripOpenAlexPrefix(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.replace(/^https?:\/\/openalex\.org\//i, "") || null;
}

type PaperRow = {
  title: string;
  abstract: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  openAlexId: string | null;
  url: string | null;
  pdfUrl: string | null;
  isOpenAccess: boolean;
  citationCount: number;
  fields: string[];
  keywords: string[];
  submittedVia: string;
  publishedAt: Date | null;
};

function mapWork(w: OpenAlexWork): PaperRow | null {
  const title = w.display_name?.trim();
  const abstract = reconstructAbstract(w.abstract_inverted_index);
  const openAlexId = stripOpenAlexPrefix(w.id);
  // Need at least an OpenAlex id + title to be worth storing.
  if (!openAlexId || !title) return null;
  // Reject papers with no abstract — they have no signal for search.
  if (abstract.length < 50) return null;
  const authors = (w.authorships ?? [])
    .map((a) => a.author?.display_name?.trim())
    .filter((n): n is string => !!n)
    .slice(0, 30);
  const keywords = (w.keywords ?? [])
    .map((k) => k.display_name?.trim())
    .filter((n): n is string => !!n)
    .slice(0, 20);
  const field = w.primary_topic?.field?.display_name?.trim();
  return {
    title: title.slice(0, 1000),
    abstract,
    authors,
    year: w.publication_year ?? null,
    journal: w.primary_location?.source?.display_name ?? null,
    doi: stripDoiPrefix(w.doi),
    openAlexId,
    url: w.id ?? null,
    pdfUrl: w.open_access?.oa_url ?? null,
    isOpenAccess: !!w.open_access?.is_oa,
    citationCount: w.cited_by_count ?? 0,
    fields: field ? [field] : [],
    keywords,
    submittedVia: "openalex-agent",
    publishedAt: w.publication_date ? new Date(w.publication_date) : null,
  };
}

async function main() {
  const startedAt = Date.now();
  console.log(`[ingest] target=${TARGET.toLocaleString()} papers from OpenAlex`);
  console.log(`[ingest] contact=${CONTACT_EMAIL} (polite-pool)`);

  let cursor: string = "*";
  let inserted = 0;
  let skipped = 0;
  let pages = 0;

  while (inserted < TARGET) {
    let page: OpenAlexPage;
    try {
      page = await fetchOpenAlexPage(cursor);
    } catch (err) {
      console.error(`[ingest] page fetch failed:`, (err as Error).message);
      // One retry after a 5s backoff, then bail.
      await new Promise((r) => setTimeout(r, 5_000));
      try {
        page = await fetchOpenAlexPage(cursor);
      } catch (err2) {
        console.error(`[ingest] retry also failed, stopping:`, (err2 as Error).message);
        break;
      }
    }
    pages++;
    const works = page.results ?? [];
    if (works.length === 0) {
      console.log(`[ingest] page ${pages} returned 0 results — done`);
      break;
    }
    const rows = works
      .map(mapWork)
      .filter((r): r is PaperRow => r !== null);

    if (rows.length === 0) {
      console.log(`[ingest] page ${pages} → 0 valid rows after filtering`);
    } else {
      const result = await prisma.paper.createMany({
        data: rows,
        skipDuplicates: true,
      });
      inserted += result.count;
      skipped += rows.length - result.count;
      console.log(
        `[ingest] page ${pages} → +${result.count} (total ${inserted}/${TARGET}, dup-skip ${skipped})`,
      );
    }

    const nextCursor = page.meta?.next_cursor;
    if (!nextCursor) {
      console.log(`[ingest] no next cursor — OpenAlex exhausted at page ${pages}`);
      break;
    }
    cursor = nextCursor;
    await new Promise((r) => setTimeout(r, POLITENESS_DELAY_MS));
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[ingest] DONE inserted=${inserted} skipped=${skipped} pages=${pages} elapsed=${elapsed}s`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[ingest] FATAL:", err);
  process.exit(1);
});
