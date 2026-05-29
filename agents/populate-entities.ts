// Wiki-entity populator. Derives Journal / Topic / Method rows from
// existing Paper.journal / fields[] / keywords[] data — zero Claude
// calls, no per-paper API spend, idempotent on re-run.
//
// What this is NOT: an Institute extractor. Affiliations aren't in
// our current OpenAlex ingest path; populating Institute needs a
// separate ingest extension. The Institute model + wiki page are
// scaffolded but Institute rows stay empty in v1.
//
// Run:  npx tsx agents/populate-entities.ts
//
// Re-runnable: existing entity rows get their paperCount refreshed
// from a clean recount; join tables (PaperTopic, PaperMethod) are
// wiped + rebuilt so deletes/edits in Paper propagate.

import "dotenv/config";
import { prisma } from "../lib/prisma";

// Cap aggressive name lengths so a runaway field name doesn't blow
// up the slug column.
const MAX_NAME_CHARS = 200;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function main() {
  console.log("[populate] starting (querying Paper rows…)");
  const startedAt = Date.now();
  const papers = await prisma.paper.findMany({
    select: { id: true, journal: true, fields: true, keywords: true },
  });
  console.log(`[populate] scanning ${papers.length.toLocaleString("en-US")} papers`);

  // Counts keyed by display-name (we keep the original casing for
  // display, slugify only for URL).
  const journalCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const methodCounts = new Map<string, number>();
  const paperToTopics = new Map<string, Set<string>>();
  const paperToMethods = new Map<string, Set<string>>();

  for (const p of papers) {
    const j = p.journal?.trim();
    if (j && j.length <= MAX_NAME_CHARS) {
      journalCounts.set(j, (journalCounts.get(j) ?? 0) + 1);
    }
    for (const raw of p.fields ?? []) {
      const t = raw.trim();
      if (!t || t.length > MAX_NAME_CHARS) continue;
      topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
      const set = paperToTopics.get(p.id) ?? new Set<string>();
      set.add(t);
      paperToTopics.set(p.id, set);
    }
    for (const raw of p.keywords ?? []) {
      const m = raw.trim();
      if (!m || m.length > MAX_NAME_CHARS) continue;
      methodCounts.set(m, (methodCounts.get(m) ?? 0) + 1);
      const set = paperToMethods.get(p.id) ?? new Set<string>();
      set.add(m);
      paperToMethods.set(p.id, set);
    }
  }

  // ── Journals ──────────────────────────────────────────────────
  console.log(`[populate] journals: ${journalCounts.size} unique`);
  const journalSlugs = new Set<string>();
  for (const [name, count] of journalCounts) {
    let slug = slugify(name);
    if (!slug) continue;
    // Handle slug collisions (two different journal names that
    // slugify to the same string) by appending a suffix.
    let candidate = slug;
    let n = 1;
    while (journalSlugs.has(candidate)) {
      candidate = `${slug}-${++n}`;
    }
    journalSlugs.add(candidate);
    await prisma.journal.upsert({
      where: { name },
      create: { name: name.slice(0, MAX_NAME_CHARS), slug: candidate, paperCount: count },
      update: { paperCount: count },
    });
  }

  // ── Topics + PaperTopic joins ─────────────────────────────────
  console.log(`[populate] topics: ${topicCounts.size} unique`);
  const topicIdByName = new Map<string, string>();
  const topicSlugs = new Set<string>();
  for (const [name, count] of topicCounts) {
    const baseSlug = slugify(name);
    if (!baseSlug) continue;
    let candidate = baseSlug;
    let n = 1;
    while (topicSlugs.has(candidate)) {
      candidate = `${baseSlug}-${++n}`;
    }
    topicSlugs.add(candidate);
    const t = await prisma.topic.upsert({
      where: { slug: candidate },
      create: { name: name.slice(0, MAX_NAME_CHARS), slug: candidate, paperCount: count },
      update: { paperCount: count, name: name.slice(0, MAX_NAME_CHARS) },
      select: { id: true },
    });
    topicIdByName.set(name, t.id);
  }

  // ── Methods ───────────────────────────────────────────────────
  console.log(`[populate] methods: ${methodCounts.size} unique`);
  const methodIdByName = new Map<string, string>();
  const methodSlugs = new Set<string>();
  for (const [name, count] of methodCounts) {
    const baseSlug = slugify(name);
    if (!baseSlug) continue;
    let candidate = baseSlug;
    let n = 1;
    while (methodSlugs.has(candidate)) {
      candidate = `${baseSlug}-${++n}`;
    }
    methodSlugs.add(candidate);
    const m = await prisma.method.upsert({
      where: { slug: candidate },
      create: { name: name.slice(0, MAX_NAME_CHARS), slug: candidate, paperCount: count },
      update: { paperCount: count, name: name.slice(0, MAX_NAME_CHARS) },
      select: { id: true },
    });
    methodIdByName.set(name, m.id);
  }

  // ── Joins (wipe + rebuild so edits propagate) ─────────────────
  console.log(`[populate] rebuilding joins…`);
  await prisma.paperTopic.deleteMany({});
  await prisma.paperMethod.deleteMany({});

  const topicJoins: Array<{ paperId: string; topicId: string }> = [];
  for (const [paperId, names] of paperToTopics) {
    for (const name of names) {
      const id = topicIdByName.get(name);
      if (id) topicJoins.push({ paperId, topicId: id });
    }
  }
  const methodJoins: Array<{ paperId: string; methodId: string }> = [];
  for (const [paperId, names] of paperToMethods) {
    for (const name of names) {
      const id = methodIdByName.get(name);
      if (id) methodJoins.push({ paperId, methodId: id });
    }
  }
  // Batch insert in 5k chunks — Postgres parameter ceiling sits at
  // 32k per statement and each row uses 2 params, so 5k is comfortably
  // under the limit.
  const CHUNK = 5000;
  for (let i = 0; i < topicJoins.length; i += CHUNK) {
    await prisma.paperTopic.createMany({
      data: topicJoins.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
  }
  for (let i = 0; i < methodJoins.length; i += CHUNK) {
    await prisma.paperMethod.createMany({
      data: methodJoins.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[populate] done. journals=${journalCounts.size} topics=${topicCounts.size} methods=${methodCounts.size} ` +
      `topicJoins=${topicJoins.length} methodJoins=${methodJoins.length} elapsed=${elapsed}s`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[populate] FATAL:", err);
  process.exit(1);
});
