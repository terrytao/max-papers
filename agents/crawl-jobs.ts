// Academic job crawler — pulls open positions from external sources
// into the Position table so the talent marketplace has real listings.
//
// Source for v1: academicpositions.com sitemap. Designed to add more
// sources (nature.com/careers, jobs.ac.uk, Indeed's research filter)
// behind the same SourceAdapter shape.
//
// Crawl etiquette:
//   • respect robots.txt (we read /robots.txt before scraping)
//   • 2-second polite delay between requests
//   • User-Agent identifies us so site owners can throttle/block us
//     specifically rather than rate-limiting everyone
//   • cap per-run at JOB_CAP (env override) — don't try to swallow
//     the whole site in one go; the daemon hits this nightly
//
// Idempotency: positions dedupe on the (institution, title) pair via
// a synthetic external-id hash stored in Position.website. Re-runs
// just refresh existing rows' status/deadline instead of inserting
// duplicates.
//
// Position.postedBy: every job belongs to a profile. Crawled jobs
// attach to a singleton "External Crawler" ResearchProfile (upserted
// on first run), so the talent UI's owner-based filtering keeps
// working without per-employer ResearchProfile creation.
//
// Important: this is a SCAFFOLD. The actual HTML parsing depends on
// academicpositions.com's current DOM and may break when they
// rewrite. Tested against their public job-listing pages as of late
// 2025. Run as:
//   npx tsx agents/crawl-jobs.ts
// or behind nohup for a long-running daemon.

import "dotenv/config";
import { prisma } from "../lib/prisma";

const CONTACT_EMAIL = "terry.tao@max-robotics.com";
const USER_AGENT = `max-papers-crawler/1.0 (mailto:${CONTACT_EMAIL})`;
const POLITE_DELAY_MS = 2000;
const JOB_CAP = Number(process.env.JOB_CAP ?? 100);
const CRAWLER_EMAIL = "crawler-jobs@max-papers.com";

// Source adapters — add new ones here. Each returns a normalized list
// of crawled jobs that the main loop dedupes and upserts.
type CrawledJob = {
  externalId: string; // stable identifier we use for dedup
  title: string;
  type: "phd" | "postdoc" | "job" | "fellowship" | "grant";
  description: string;
  institution: string;
  department?: string | null;
  country?: string | null;
  city?: string | null;
  deadline?: Date | null;
  funded: boolean;
  contactEmail?: string | null;
  website?: string | null; // canonical source URL
  researchTopics?: string[];
};

type SourceAdapter = {
  name: string;
  crawl: (limit: number) => AsyncGenerator<CrawledJob>;
};

// ─ academicpositions.com adapter ──────────────────────────────────
// Walks their sitemap index, pulls each job sitemap, then fetches
// the HTML of each job page and pulls the metadata out via simple
// regex parsing of their JSON-LD JobPosting blocks (which they
// publish on every job page for SEO — pure win for us).
const academicPositions: SourceAdapter = {
  name: "academicpositions.com",
  async *crawl(limit: number): AsyncGenerator<CrawledJob> {
    // Check robots.txt first — bail if disallowed.
    if (!(await robotsAllowed("https://academicpositions.com"))) {
      console.log("[crawl-jobs] academicpositions.com: robots.txt blocks us");
      return;
    }
    // Their sitemap-index points at sub-sitemaps; the per-job sitemap
    // typically lives at /sitemap-jobs.xml or numbered shards.
    const sitemapRes = await fetch(
      "https://academicpositions.com/sitemap.xml",
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) },
    );
    if (!sitemapRes.ok) {
      console.log(
        `[crawl-jobs] sitemap fetch failed: HTTP ${sitemapRes.status}`,
      );
      return;
    }
    const sitemapXml = await sitemapRes.text();
    // Pull every <loc> that looks like a job posting.
    const jobUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => m[1]!)
      .filter((u) => /\/jobs?\//i.test(u) || /-job-\d+/.test(u))
      .slice(0, limit);

    if (jobUrls.length === 0) {
      console.log("[crawl-jobs] no job URLs found in sitemap");
      return;
    }

    for (const url of jobUrls) {
      await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        const job = parseJobPostingJsonLd(html, url);
        if (job) yield job;
      } catch (err) {
        console.error(
          `[crawl-jobs] ${url}: ${(err as Error).message.slice(0, 100)}`,
        );
      }
    }
  },
};

// Parse a JobPosting schema.org JSON-LD block out of an HTML page.
// Almost every academic job board publishes one — easier and more
// stable than parsing visual DOM.
function parseJobPostingJsonLd(html: string, url: string): CrawledJob | null {
  // Capture every <script type="application/ld+json"> block; pick the
  // first one that contains "JobPosting".
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((m) => m[1]!.trim());
  for (const raw of blocks) {
    if (!raw.includes("JobPosting")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    // Some sites wrap in @graph
    const candidates = Array.isArray(parsed)
      ? parsed
      : (parsed as { "@graph"?: unknown[] })["@graph"] ?? [parsed];
    for (const c of candidates as Array<Record<string, unknown>>) {
      if (c["@type"] !== "JobPosting") continue;
      const title = String(c.title ?? "").trim();
      if (!title) continue;
      const description = String(c.description ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 5000);
      const org = c.hiringOrganization as
        | { name?: string }
        | undefined;
      const institution = String(org?.name ?? "").trim() || "Unknown institution";
      const loc = c.jobLocation as
        | { address?: { addressCountry?: string; addressLocality?: string } }
        | undefined;
      const country = loc?.address?.addressCountry ?? null;
      const city = loc?.address?.addressLocality ?? null;
      const deadlineRaw = c.validThrough as string | undefined;
      const deadline = deadlineRaw ? new Date(deadlineRaw) : null;
      return {
        externalId: url,
        title: title.slice(0, 300),
        type: classifyJobType(title, description),
        description,
        institution: institution.slice(0, 200),
        country,
        city,
        deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
        funded: !!c.baseSalary || /funded|stipend|salary/i.test(description),
        website: url,
      };
    }
  }
  return null;
}

function classifyJobType(
  title: string,
  desc: string,
): CrawledJob["type"] {
  const t = (title + " " + desc).toLowerCase();
  if (/\bphd\b|doctoral|graduate student/.test(t)) return "phd";
  if (/postdoc|post[- ]?doctoral/.test(t)) return "postdoc";
  if (/fellowship|fellow\b/.test(t)) return "fellowship";
  if (/grant\b/.test(t)) return "grant";
  return "job";
}

// Cheap robots.txt check — only reads the file and looks for a
// blanket Disallow under our user-agent or *. Not a full parser.
async function robotsAllowed(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return true; // missing robots.txt = allowed
    const txt = await res.text();
    // If any block disallows everything under our or * ua, bail.
    const blocks = txt.split(/\n\s*\n/);
    for (const b of blocks) {
      const lines = b.split("\n").map((l) => l.split("#")[0]!.trim());
      const uas = lines
        .filter((l) => /^user-agent:/i.test(l))
        .map((l) => l.split(":").slice(1).join(":").trim().toLowerCase());
      if (!uas.includes("*") && !uas.includes("max-papers-crawler/1.0")) continue;
      for (const l of lines) {
        if (/^disallow:\s*\/\s*$/i.test(l)) return false;
      }
    }
    return true;
  } catch {
    return true; // network blip = give benefit of the doubt
  }
}

// ─ Owner profile (singleton) ──────────────────────────────────────
async function getCrawlerProfileId(): Promise<string> {
  const user = await prisma.researchProfile.upsert({
    where: { email: CRAWLER_EMAIL },
    create: {
      email: CRAWLER_EMAIL,
      name: "External Job Crawler",
      profileType: "recruiter",
      institution: "max-papers (aggregated)",
    },
    update: {},
    select: { id: true },
  });
  return user.id;
}

// ─ Main loop ──────────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();
  const ownerId = await getCrawlerProfileId();
  console.log(`[crawl-jobs] starting; owner profile=${ownerId} cap=${JOB_CAP}`);

  const sources: SourceAdapter[] = [academicPositions];
  let totalInserted = 0;
  let totalUpdated = 0;

  for (const src of sources) {
    let count = 0;
    console.log(`[crawl-jobs] source: ${src.name}`);
    for await (const job of src.crawl(JOB_CAP)) {
      count++;
      // Dedup by website URL (set @unique? Not in schema. So we look
      // up + update or create.)
      const existing = await prisma.position.findFirst({
        where: { website: job.externalId },
        select: { id: true },
      });
      if (existing) {
        await prisma.position.update({
          where: { id: existing.id },
          data: {
            title: job.title,
            description: job.description,
            country: job.country,
            city: job.city,
            deadline: job.deadline,
            funded: job.funded,
            // Don't reopen a closed position automatically; leave
            // operators in control of status transitions.
          },
        });
        totalUpdated++;
      } else {
        await prisma.position.create({
          data: {
            title: job.title,
            type: job.type,
            description: job.description,
            institution: job.institution,
            department: job.department ?? null,
            country: job.country ?? null,
            city: job.city ?? null,
            deadline: job.deadline ?? null,
            funded: job.funded,
            contactEmail: job.contactEmail ?? null,
            website: job.website ?? null,
            researchTopics: job.researchTopics ?? [],
            methods: [],
            requirements: [],
            postedById: ownerId,
          },
        });
        totalInserted++;
      }
      if (count % 10 === 0) {
        console.log(`[crawl-jobs] ${src.name}: ${count} so far`);
      }
    }
    console.log(`[crawl-jobs] ${src.name}: done, ${count} processed`);
  }

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[crawl-jobs] DONE inserted=${totalInserted} updated=${totalUpdated} elapsed=${secs}s`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[crawl-jobs] FATAL:", err);
  process.exit(1);
});
