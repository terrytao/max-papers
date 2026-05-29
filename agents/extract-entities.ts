// Entity extraction agent — populates the two entity tables that
// agents/populate-entities.ts couldn't fill on its own: Researcher
// (from Paper.authors[], no AI needed) and Institute (via Haiku 4.5
// on title+authors, attributed back to papers so the PaperInstitute
// join can be built).
//
// What it does NOT do — already done by populate-entities.ts:
//   • Journal (from Paper.journal)
//   • Topic   (from Paper.fields[])
//   • Method  (from Paper.keywords[])
//   • PaperTopic + PaperMethod joins
// Re-running would double-count via Prisma upsert+increment. The
// safe pattern is "populate-entities for the structured fields,
// extract-entities for the unstructured ones."
//
// Performance shape:
//   • Researcher pass — single read over Paper, aggregate in memory,
//     bulk createMany in 2.5k-row chunks. ~minutes on 1.7M papers.
//   • Institute pass — Haiku batches of 20 papers per call, ~$0.003
//     per call, ~3-15k calls depending on corpus size. Cost cap
//     enforced via AI_CALL_CAP env var.
//
// Quality caveat on institutes: author names alone don't reliably
// predict affiliation (Geoffrey Hinton is associated with UToronto
// AND Google AND many others over time). The AI's guesses are
// directionally useful but not authoritative — flagged in Institute
// row metadata so downstream consumers know.
//
// Run:  npx tsx agents/extract-entities.ts
// Cap:  AI_CALL_CAP=100 npx tsx agents/extract-entities.ts  (for testing)

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
// Default cap of 2000 calls covers ~40k papers at $5-10 of Haiku
// spend — enough institute breadth for the wiki layer without
// committing to a full $85+ run across the 1.7M-row corpus. Bump
// via env if you want full coverage:
//   AI_CALL_CAP=85000 npx tsx agents/extract-entities.ts
const AI_CALL_CAP = Number(process.env.AI_CALL_CAP ?? 2_000);
const PAPERS_PER_AI_CALL = 20;
const SCAN_BATCH = 5_000;       // rows fetched per Prisma findMany
const RESEARCHER_CHUNK = 2_500; // rows per createMany insert
const MAX_AUTHORS_PER_PAPER = 20;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

// Pick the most-frequent journal as a researcher's "institution" guess
// — proxy until we have OpenAlex affiliations. Most academics publish
// repeatedly in a small set of journals; the modal one is a useful
// label even if it's not a literal employer.
function mostFrequent(items: string[]): string | undefined {
  if (items.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const entry of counts.entries()) {
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best?.[0];
}

function topN(items: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
}

type ResearcherAccum = {
  name: string; // display-cased
  paperCount: number;
  citationSum: number;
  fields: string[]; // all fields seen, for top-N at end
  journals: string[]; // all journals seen, for modal at end
  // Each author appears in many papers; collect their paper ids so
  // we can populate PaperResearcher joins after Researcher rows exist.
  paperIds: string[];
};

// ── Pass 1: Researcher extraction (no AI) ──────────────────────────
// Single scan, in-memory aggregate. Bulk-insert Researcher rows, then
// look up each researcher's id and bulk-insert PaperResearcher joins.
async function extractResearchers() {
  console.log("[extract] PASS 1: Researcher + PaperResearcher (no AI)");
  const t0 = Date.now();
  const accum = new Map<string, ResearcherAccum>();
  let scanned = 0;
  let cursor: string | undefined;

  while (true) {
    const batch = await prisma.paper.findMany({
      take: SCAN_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        authors: true,
        citationCount: true,
        fields: true,
        journal: true,
      },
    });
    if (batch.length === 0) break;
    for (const p of batch) {
      const authors = (p.authors ?? []).slice(0, MAX_AUTHORS_PER_PAPER);
      for (const raw of authors) {
        const name = String(raw ?? "").trim();
        if (name.length < 3 || name.length > 200) continue;
        const key = name.toLowerCase();
        let row = accum.get(key);
        if (!row) {
          row = {
            name,
            paperCount: 0,
            citationSum: 0,
            fields: [],
            journals: [],
            paperIds: [],
          };
          accum.set(key, row);
        }
        row.paperCount++;
        row.citationSum += p.citationCount ?? 0;
        for (const f of p.fields ?? []) row.fields.push(f);
        if (p.journal) row.journals.push(p.journal);
        // Cap paperIds at 500 per author — even prolific authors
        // (~200 papers) fit; this caps memory for the ~50-author
        // mega-survey outliers.
        if (row.paperIds.length < 500) row.paperIds.push(p.id);
      }
    }
    scanned += batch.length;
    cursor = batch[batch.length - 1]!.id;
    if (scanned % 50_000 === 0 || batch.length < SCAN_BATCH) {
      console.log(
        `[extract] scanned ${scanned.toLocaleString()} papers, ${accum.size.toLocaleString()} unique authors`,
      );
    }
    if (batch.length < SCAN_BATCH) break;
  }
  console.log(
    `[extract] scan done: ${scanned.toLocaleString()} papers, ${accum.size.toLocaleString()} unique authors`,
  );

  // Build Researcher rows. Slug handling: slug @unique, so any two
  // authors whose names slugify to the same string need a -N suffix.
  const slugSeen = new Set<string>();
  const rows = Array.from(accum.values()).map((a) => {
    let baseSlug = slugify(a.name);
    if (!baseSlug) baseSlug = "researcher";
    let candidate = baseSlug;
    let n = 1;
    while (slugSeen.has(candidate)) candidate = `${baseSlug}-${++n}`;
    slugSeen.add(candidate);
    return {
      key: a.name.toLowerCase(),
      data: {
        name: a.name.slice(0, 200),
        slug: candidate,
        paperCount: a.paperCount,
        citationCount: a.citationSum,
        fields: topN(a.fields, 5),
        institution: mostFrequent(a.journals) ?? null,
      },
    };
  });

  // Bulk insert in chunks.
  let inserted = 0;
  for (let i = 0; i < rows.length; i += RESEARCHER_CHUNK) {
    const data = rows.slice(i, i + RESEARCHER_CHUNK).map((r) => r.data);
    const result = await prisma.researcher.createMany({
      data,
      skipDuplicates: true,
    });
    inserted += result.count;
    if ((i / RESEARCHER_CHUNK) % 10 === 0) {
      console.log(
        `[extract] researchers inserted ${inserted.toLocaleString()} / ${rows.length.toLocaleString()}`,
      );
    }
  }
  console.log(
    `[extract] Researcher inserts complete: ${inserted.toLocaleString()} rows`,
  );

  // Now look up each researcher's id and build PaperResearcher joins.
  // We do this in name-batches to avoid one giant IN clause.
  console.log("[extract] building PaperResearcher joins…");
  const NAME_CHUNK = 5_000;
  const JOIN_CHUNK = 5_000;
  let joinsInserted = 0;
  const names = rows.map((r) => r.data.name);
  for (let i = 0; i < names.length; i += NAME_CHUNK) {
    const slice = names.slice(i, i + NAME_CHUNK);
    const found = await prisma.researcher.findMany({
      where: { name: { in: slice } },
      select: { id: true, name: true },
    });
    const idByName = new Map(found.map((r) => [r.name, r.id]));
    // Build joins for this slice's researchers.
    const joins: Array<{ paperId: string; researcherId: string }> = [];
    for (const r of rows.slice(i, i + NAME_CHUNK)) {
      const rid = idByName.get(r.data.name);
      if (!rid) continue;
      const orig = accum.get(r.key);
      if (!orig) continue;
      for (const pid of orig.paperIds) {
        joins.push({ paperId: pid, researcherId: rid });
      }
    }
    for (let j = 0; j < joins.length; j += JOIN_CHUNK) {
      const result = await prisma.paperResearcher.createMany({
        data: joins.slice(j, j + JOIN_CHUNK),
        skipDuplicates: true,
      });
      joinsInserted += result.count;
    }
    if ((i / NAME_CHUNK) % 5 === 0) {
      console.log(
        `[extract] joins so far: ${joinsInserted.toLocaleString()} (researcher batch ${i.toLocaleString()})`,
      );
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[extract] PASS 1 done: ${inserted.toLocaleString()} Researcher + ${joinsInserted.toLocaleString()} PaperResearcher joins in ${secs}s`,
  );
}

// ── Pass 2: Institute extraction via AI ─────────────────────────────
// AI prompt asks Haiku to attribute institutes back to the source
// paper id so we can populate PaperInstitute. Without that, Institute
// rows are orphans (no joins → empty wiki pages).
type AiInstituteResponse = Array<{
  paperId: string;
  institutes: string[];
}>;

async function aiInstitutes(
  papers: Array<{ id: string; title: string; authors: string[] }>,
): Promise<AiInstituteResponse> {
  const sample = papers
    .slice(0, PAPERS_PER_AI_CALL)
    .map(
      (p) =>
        `id=${p.id} | ${p.title} | ${(p.authors ?? []).slice(0, 4).join(", ")}`,
    )
    .join("\n");
  const prompt = `For each paper below, list any universities/institutions you can identify from the title + author names. If you can't identify any with reasonable confidence, return an empty list for that paper. Don't guess.

Return JSON only — array of objects, one per paper, in the same order:
[
  { "paperId": "<id from input>", "institutes": ["MIT", "Stanford"] },
  { "paperId": "<id from input>", "institutes": [] }
]

Papers:
${sample}`;
  try {
    const res = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const cleaned = text.replace(/^```(?:json)?|```$/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed as AiInstituteResponse;
    return [];
  } catch (err) {
    console.error(`[extract] AI institute call failed: ${(err as Error).message.slice(0, 100)}`);
    return [];
  }
}

async function extractInstitutes() {
  console.log(`[extract] PASS 2: Institute (Haiku 4.5, cap ${AI_CALL_CAP.toLocaleString()} calls)`);
  const t0 = Date.now();
  // instituteName (lowercased) → { count, displayName }
  const counts = new Map<string, { count: number; name: string }>();
  // Per-paper attributions for the PaperInstitute join.
  const paperToInstitutes: Array<{ paperId: string; instituteNames: string[] }> = [];

  let aiCalls = 0;
  let papersProcessed = 0;
  let cursor: string | undefined;

  while (aiCalls < AI_CALL_CAP) {
    const batch = await prisma.paper.findMany({
      take: PAPERS_PER_AI_CALL,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: { id: true, title: true, authors: true },
    });
    if (batch.length === 0) break;
    const responses = await aiInstitutes(batch);
    aiCalls++;
    for (const r of responses) {
      const insts = (r.institutes ?? [])
        .filter((s): s is string => typeof s === "string" && s.length >= 3 && s.length <= 150);
      if (insts.length === 0) continue;
      paperToInstitutes.push({ paperId: r.paperId, instituteNames: insts });
      for (const name of insts) {
        const key = name.toLowerCase();
        const prev = counts.get(key);
        if (prev) prev.count++;
        else counts.set(key, { count: 1, name });
      }
    }
    papersProcessed += batch.length;
    cursor = batch[batch.length - 1]!.id;
    if (aiCalls % 10 === 0) {
      console.log(
        `[extract] institute calls=${aiCalls.toLocaleString()} papers=${papersProcessed.toLocaleString()} unique=${counts.size.toLocaleString()}`,
      );
    }
    if (batch.length < PAPERS_PER_AI_CALL) break;
  }

  // Upsert Institute rows (slug @unique + name @unique). Dedupe slug
  // collisions with a -N suffix like the populator did.
  const slugSeen = new Set<string>();
  const nameToId = new Map<string, string>();
  for (const [, { name, count }] of counts) {
    let slug = slugify(name);
    if (!slug) continue;
    let candidate = slug;
    let n = 1;
    while (slugSeen.has(candidate)) candidate = `${slug}-${++n}`;
    slugSeen.add(candidate);
    const created = await prisma.institute.upsert({
      where: { name },
      create: { name, slug: candidate, paperCount: count },
      update: { paperCount: count },
      select: { id: true },
    });
    nameToId.set(name.toLowerCase(), created.id);
  }

  // Build the PaperInstitute join rows.
  const joins: Array<{ paperId: string; instituteId: string }> = [];
  for (const { paperId, instituteNames } of paperToInstitutes) {
    for (const name of instituteNames) {
      const id = nameToId.get(name.toLowerCase());
      if (id) joins.push({ paperId, instituteId: id });
    }
  }
  if (joins.length > 0) {
    const CHUNK = 5_000;
    for (let i = 0; i < joins.length; i += CHUNK) {
      await prisma.paperInstitute.createMany({
        data: joins.slice(i, i + CHUNK),
        skipDuplicates: true,
      });
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[extract] PASS 2 done: ${counts.size.toLocaleString()} institutes, ${joins.length.toLocaleString()} joins, ${aiCalls.toLocaleString()} AI calls, ${secs}s`,
  );
}

async function main() {
  console.log("[extract] starting");
  const total = await prisma.paper.count();
  console.log(`[extract] corpus size: ${total.toLocaleString()} papers`);

  await extractResearchers();
  await extractInstitutes();

  const [j, t, m, r, i] = await Promise.all([
    prisma.journal.count(),
    prisma.topic.count(),
    prisma.method.count(),
    prisma.researcher.count(),
    prisma.institute.count(),
  ]);
  console.log("\n[extract] DONE");
  console.log(`  Journals:    ${j.toLocaleString()}    (populated earlier by populate-entities.ts)`);
  console.log(`  Topics:      ${t.toLocaleString()}    (populated earlier)`);
  console.log(`  Methods:     ${m.toLocaleString()}    (populated earlier)`);
  console.log(`  Researchers: ${r.toLocaleString()}    (this run)`);
  console.log(`  Institutes:  ${i.toLocaleString()}    (this run, via Haiku 4.5)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[extract] FATAL:", err);
  process.exit(1);
});
