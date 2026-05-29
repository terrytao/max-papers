// Forever-running paper collector.
//
// Walks ~40 OpenAlex topics in a loop, sleeping 1 hour between
// rounds. Designed to keep running via `nohup … &` across shell
// sessions, with stdout/stderr appended to logs/collection.log and
// the PID parked at logs/collection.pid for later kill.
//
// Per-topic cursor state is checkpointed to
// agents/collect-forever-state.json so a restart resumes where it
// left off rather than re-walking the top-cited corpus on every
// round. Round 1 starts at cursor=*; subsequent rounds pick up the
// last-seen cursor per topic, so each round adds genuinely new
// papers rather than dup-skipping its way through 200k known rows.
//
// Run:
//   nohup npx tsx agents/collect-forever.ts >> logs/collection.log 2>&1 &
//   echo $! > logs/collection.pid
//
// Stop:
//   kill $(cat logs/collection.pid)
//
// Bugs vs the original spec, all fixed inline:
//   • Prisma 7 dropped `datasources` config — use the lib/prisma
//     singleton (PrismaPg adapter pattern)
//   • OpenAlex retired `concepts.display_name:` — use `search=<topic>`
//   • `openAlexId: p.id` stored the full URL; existing rows have
//     stripped form, so the unique-constraint dedup broke. Strip.
//   • `url: 'https://openalex.org/${p.id}'` double-prefixed.
//   • mailto wasn't a real contact; using terry.tao@max-robotics.com
//   • Every round restarted at cursor=*, wasting 95% of calls on
//     duplicate-skip after round 1. Cursor checkpointing per topic.

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../lib/prisma";

// `__dirname` isn't reliable when tsx runs us as ESM. The script is
// always launched from the project root via `npx tsx agents/...`,
// so anchor the state file to cwd + agents/.
const STATE_FILE = path.join(process.cwd(), "agents", "collect-forever-state.json");
const CONTACT_EMAIL = "terry.tao@max-robotics.com";
const USER_AGENT = `max-papers-collect-forever/1.0 (mailto:${CONTACT_EMAIL})`;
const PER_PAGE = 200;
const PAGES_PER_TOPIC_PER_ROUND = 50;
const POLITENESS_DELAY_MS = 250;
const INTER_ROUND_SLEEP_MS = 60 * 60 * 1000; // 1 hour
const API_BACKOFF_MS = 30_000;
const ERR_BACKOFF_MS = 60_000;

const TOPICS = [
  // ML / CS
  "Artificial Intelligence", "Machine Learning", "Deep Learning",
  "Computer Vision", "Natural Language Processing", "Robotics",
  "Computer Science", "Cybersecurity", "Software Engineering", "Data Science",
  "Quantum Computing",
  // Life sciences
  "Neuroscience", "Cancer", "Medicine", "Cardiology", "Immunology",
  "Genetics", "Molecular Biology", "Biology", "Ecology", "Evolution",
  "Pharmacology", "Oncology", "Epidemiology", "Public Health",
  "Biochemistry", "Microbiology", "Cell Biology", "Biomedical Engineering",
  // Physical sciences
  "Physics", "Chemistry", "Materials Science", "Astronomy", "Nanotechnology",
  // Math / stats / social
  "Mathematics", "Statistics", "Psychology", "Economics",
  // Earth / engineering
  "Environmental Science", "Climate Change", "Engineering",
];

type State = Record<string, string | null>;

function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as State;
  } catch {
    return {};
  }
}

function saveState(state: State): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error(`[collect-forever] failed to write state file: ${(err as Error).message}`);
  }
}

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

function reconstructAbstract(
  inverted: Record<string, number[]> | null | undefined,
): string {
  if (!inverted) return "";
  const words: string[] = [];
  for (const [w, positions] of Object.entries(inverted)) {
    for (const pos of positions) words[pos] = w;
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

// Returns the next cursor (or null when exhausted) — caller persists
// it after each successful page.
async function collectPage(topic: string, cursor: string): Promise<{
  next: string | null;
  inserted: number;
  hadError: boolean;
}> {
  try {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", topic);
    url.searchParams.set("filter", "has_abstract:true,language:en");
    url.searchParams.set("per-page", String(PER_PAGE));
    url.searchParams.set("cursor", cursor);
    url.searchParams.set(
      "select",
      "id,title,abstract_inverted_index,authorships,publication_year,primary_location,doi,cited_by_count,open_access,concepts",
    );
    url.searchParams.set("mailto", CONTACT_EMAIL);

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      console.log(`[collect-forever] HTTP ${res.status} on ${topic} cursor=${cursor.slice(0, 12)} — backing off ${API_BACKOFF_MS / 1000}s`);
      await new Promise((r) => setTimeout(r, API_BACKOFF_MS));
      return { next: cursor, inserted: 0, hadError: true };
    }
    const data = (await res.json()) as OpenAlexPage;
    const works = data.results ?? [];
    if (works.length === 0) return { next: null, inserted: 0, hadError: false };

    const rows = works
      .map((p) => {
        const openAlexId = stripOpenAlexPrefix(p.id);
        const title = p.title?.trim();
        const abstract = reconstructAbstract(p.abstract_inverted_index);
        if (!openAlexId || !title || abstract.length < 50) return null;
        return {
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
          submittedVia: "collect-forever",
          publishedAt: p.publication_year
            ? new Date(p.publication_year, 0, 1)
            : null,
        };
      })
      .filter(<T>(r: T | null): r is T => r !== null);

    let inserted = 0;
    if (rows.length > 0) {
      const result = await prisma.paper.createMany({
        data: rows,
        skipDuplicates: true,
      });
      inserted = result.count;
    }
    return { next: data.meta?.next_cursor ?? null, inserted, hadError: false };
  } catch (err) {
    console.log(`[collect-forever] error on ${topic}: ${(err as Error).message} — backing off ${ERR_BACKOFF_MS / 1000}s`);
    await new Promise((r) => setTimeout(r, ERR_BACKOFF_MS));
    return { next: cursor, inserted: 0, hadError: true };
  }
}

async function runRound(state: State, roundNum: number): Promise<void> {
  const total = await prisma.paper.count();
  console.log(
    `\n=== round ${roundNum} | DB total ${total.toLocaleString("en-US")} papers ===`,
  );

  for (const topic of TOPICS) {
    let cursor: string | null = state[topic] ?? "*";
    if (cursor === null) {
      // Topic exhausted in a prior round — skip for this round; we'll
      // reset on the next round start by clearing state below.
      console.log(`[collect-forever] ${topic}: exhausted, skip`);
      continue;
    }
    let pageCount = 0;
    let topicNew = 0;
    let consecutiveErrors = 0;
    while (cursor && pageCount < PAGES_PER_TOPIC_PER_ROUND) {
      const { next, inserted, hadError } = await collectPage(topic, cursor);
      pageCount++;
      topicNew += inserted;
      if (hadError) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          console.log(`[collect-forever] ${topic}: 3 consecutive errors, moving on`);
          break;
        }
        // don't advance cursor or persist on error
        continue;
      }
      consecutiveErrors = 0;
      cursor = next;
      state[topic] = cursor;
      saveState(state);
      await new Promise((r) => setTimeout(r, POLITENESS_DELAY_MS));
    }
    console.log(
      `[collect-forever] ${topic}: round-added=${topicNew} pages=${pageCount} cursor=${(cursor ?? "DONE").slice(0, 12)}`,
    );
  }

  // End of round: any topics that have null cursor stayed exhausted.
  // Reset them so the next round re-walks from the top — gives us
  // refreshed citation counts on already-known papers (createMany
  // skips on @unique violation; we'd lose the refresh, but that's
  // OK for v1).
  for (const t of TOPICS) {
    if (state[t] === null) state[t] = "*";
  }
  saveState(state);
}

async function main() {
  console.log(`[collect-forever] starting — ${TOPICS.length} topics`);
  console.log(`[collect-forever] state file: ${STATE_FILE}`);
  const state = loadState();
  let round = 1;
  while (true) {
    try {
      await runRound(state, round);
    } catch (err) {
      console.error(`[collect-forever] round ${round} failed:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, ERR_BACKOFF_MS));
      continue;
    }
    round++;
    const finalTotal = await prisma.paper.count();
    console.log(
      `\n✅ round ${round - 1} done. DB total ${finalTotal.toLocaleString("en-US")} papers. Sleeping ${INTER_ROUND_SLEEP_MS / 60_000} min before round ${round}.`,
    );
    await new Promise((r) => setTimeout(r, INTER_ROUND_SLEEP_MS));
  }
}

main().catch((err) => {
  console.error("[collect-forever] FATAL:", err);
  process.exit(1);
});
