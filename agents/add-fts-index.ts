// One-shot DDL: add the GIN-on-tsvector index that makes the search
// route's full-text lookup fast.
//
// CONCURRENTLY is critical — the collect-forever daemon is writing
// to Paper continuously, and a non-CONCURRENTLY index build would
// take an ACCESS EXCLUSIVE lock and block every insert until done.
// On a 100k-row table that's a multi-minute outage.
//
// IF NOT EXISTS makes the script safe to re-run.
//
// Note: CREATE INDEX CONCURRENTLY can't run inside a transaction.
// $executeRawUnsafe is single-statement and doesn't wrap, so this
// works. If Postgres tells us the previous build failed and left
// an invalid index, drop it with:
//   DROP INDEX IF EXISTS "Paper_fts_idx";
// then re-run this.

import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  console.log("[fts-index] starting CREATE INDEX CONCURRENTLY (non-blocking; can take minutes on a large table)…");
  const t0 = Date.now();
  await prisma.$executeRawUnsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "Paper_fts_idx"
    ON "Paper"
    USING GIN (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(abstract, '')));
  `);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[fts-index] index built in ${secs}s`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[fts-index] FATAL:", err);
  process.exit(1);
});
