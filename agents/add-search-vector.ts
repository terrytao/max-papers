// Prod-safe migration. Run order avoids any long lock while collect-forever writes.
// Run with: npx tsx agents/add-search-vector.ts  (BEFORE deploying the route change)
import "dotenv/config";
import { prisma } from "../lib/prisma";

const TSV = `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(abstract,''))`;

async function main() {
  const t0 = Date.now();
  console.log("[search-vector] 1/5 add nullable column (metadata-only, no lock)…");
  await prisma.$executeRawUnsafe(`ALTER TABLE "Paper" ADD COLUMN IF NOT EXISTS search_vector tsvector;`);

  console.log("[search-vector] 2/5 maintenance trigger…");
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION paper_search_vector_update() RETURNS trigger AS $$
    BEGIN NEW.search_vector := ${TSV}; RETURN NEW; END $$ LANGUAGE plpgsql;`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS paper_search_vector_trg ON "Paper";`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER paper_search_vector_trg
    BEFORE INSERT OR UPDATE OF title, abstract ON "Paper"
    FOR EACH ROW EXECUTE FUNCTION paper_search_vector_update();`);

  console.log("[search-vector] 3/5 batched backfill…");
  let total = 0;
  for (;;) {
    const n = await prisma.$executeRawUnsafe(`
      UPDATE "Paper" SET search_vector = ${TSV}
      WHERE id IN (SELECT id FROM "Paper" WHERE search_vector IS NULL LIMIT 20000);`);
    total += n;
    if (n > 0) console.log(`[search-vector]   …${total} rows`);
    if (n === 0) break;
  }

  console.log("[search-vector] 4/5 GIN index on search_vector (CONCURRENTLY, minutes)…");
  await prisma.$executeRawUnsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "Paper_search_vector_idx"
    ON "Paper" USING GIN (search_vector);`);

  console.log("[search-vector] 5/5 pg_trgm + author trigram index…");
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  // Postgres rejects both array_to_string() and (text[]::text) in index
  // expressions because they're catalogued STABLE not IMMUTABLE. Wrap
  // in our own SQL function — array_to_string is deterministic over
  // inputs (no time/user/locale dependency) so the IMMUTABLE label is
  // safe in this narrow case.
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION paper_authors_text(text[]) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
    $$ SELECT array_to_string($1, ' ') $$;`);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "Paper_authors_trgm_idx"
    ON "Paper" USING GIN (paper_authors_text(authors) gin_trgm_ops);`);

  console.log(`[search-vector] done in ${((Date.now()-t0)/1000).toFixed(1)}s (${total} rows).`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("[search-vector] FATAL:", e); process.exit(1); });
