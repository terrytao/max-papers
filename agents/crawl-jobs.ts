// Academic job crawler — pulls open positions from listing pages
// on multiple academic job boards into the Position table. Each
// source URL is a *listing* page (many jobs visible at once); we
// fetch it, strip HTML to text, ask Haiku 4.5 to pull out structured
// job rows, dedupe on (institution, title), and insert as Position
// rows owned by a singleton "crawler" ResearchProfile.
//
// This replaces an earlier per-job JSON-LD scaffold that only worked
// for academicpositions.com's individual job pages. Listing-page
// extraction trades reliability per-source for breadth: we get rows
// from 5+ boards immediately, even ones that don't expose
// JobPosting microdata on listings.
//
// Cost shape: ~8 sources × 1 Haiku call ≈ $0.04/run.
//
// Run:    npx tsx agents/crawl-jobs.ts
// Cron:   nohup npx tsx agents/crawl-jobs.ts >> logs/crawl-jobs.log 2>&1 &
//         echo $! > logs/crawl-jobs.pid
//
// Etiquette:
//   • robots.txt check per source — skip if blocked
//   • 2s polite delay between sources
//   • mailto in User-Agent so site owners can throttle us
//     specifically rather than blanket-blocking
//
// Schema additions handled in this commit:
//   Position.source     String? @default("manual")
//   Position.sourceUrl  String?

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";

const CONTACT_EMAIL = "terry.tao@max-robotics.com";
const USER_AGENT = `Mozilla/5.0 (compatible; max-papers-crawler/1.0; +mailto:${CONTACT_EMAIL})`;
const POLITE_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 30_000;
// Bumped from 6000 → 18000 chars after diagnosing why jobs.ac.uk +
// EURAXESS extracted 0 jobs in the previous run: their listing
// pages serve 100-160KB of text content, and at 6000 chars Claude
// only saw the nav + first 1-2 jobs. ~18KB ≈ 4.5K tokens — enough
// for 5-10 job rows from a typical listing without blowing the
// Haiku context cheaply.
const MAX_TEXT_CHARS = 18_000;
const CRAWLER_EMAIL = "crawler-jobs@max-papers.com";
const MODEL = "claude-haiku-4-5-20251001";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Sources updated after live-checking each candidate against our
// user-agent. Dropped:
//   • academicpositions.com  (HTTP 403 — UA-blocked)
//   • nature.com/naturecareers (robots.txt disallow)
//   • findaphd.com           (HTTP 403)
//   • findapostdoc.com       (HTTP 403)
//   • higheredjobs.com       (200 but JS-rendered; 94 bytes of text)
// Kept (serve real text content via static HTML):
//   • jobs.ac.uk             (158 KB of listing text)
//   • euraxess.ec.europa.eu  (100 KB)
//   • academicjobsonline.org (5 KB; smaller but real)
const SOURCES: string[] = [
  "https://www.jobs.ac.uk/search/?type=phd",
  "https://www.jobs.ac.uk/search/?type=postdoc",
  "https://euraxess.ec.europa.eu/jobs/search",
  "https://academicjobsonline.org/ajo/jobs",
];

type CrawledJob = {
  title: string;
  type: "phd" | "postdoc" | "faculty" | "job" | "fellowship";
  institution: string;
  department?: string | null;
  country?: string | null;
  city?: string | null;
  description?: string;
  researchTopics?: string[];
  funded?: boolean;
  deadline?: string | null; // YYYY-MM-DD
  contactEmail?: string | null;
  website?: string | null;
};

async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) {
      console.log(`[crawl-jobs] ${url}: HTTP ${res.status}`);
      return "";
    }
    const html = await res.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&[a-z]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT_CHARS);
  } catch (err) {
    console.log(`[crawl-jobs] ${url}: ${(err as Error).message.slice(0, 80)}`);
    return "";
  }
}

// Cheap robots.txt check — read the file, look for a Disallow under
// our UA or *. Not a full parser; conservative reads.
async function robotsAllowed(originUrl: string): Promise<boolean> {
  try {
    const origin = new URL(originUrl).origin;
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return true;
    const txt = await res.text();
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
    return true;
  }
}

async function extractJobs(text: string, sourceUrl: string): Promise<CrawledJob[]> {
  if (!text || text.length < 200) return [];
  const prompt = `Extract academic job listings from this text. Return JSON array only, no other text.

Source: ${sourceUrl}
Text: ${text}

Return an array (empty [] if no real positions found). Don't make up jobs that aren't in the text. Maximum 10 jobs per call. Each object:
{
  "title": "PhD position in ...",
  "type": "phd" | "postdoc" | "faculty" | "job" | "fellowship",
  "institution": "MIT",
  "department": "Computer Science" | null,
  "country": "USA" | null,
  "city": "Cambridge" | null,
  "description": "brief 1-2 sentence summary",
  "researchTopics": ["machine learning", "robotics"],
  "funded": true | false,
  "deadline": "2026-08-01" | null,
  "contactEmail": "email@inst.edu" | null,
  "website": "https://institution.edu/job-page" | null
}`;
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      // Bumped from 1500 → 3000 after EURAXESS returned 10 jobs that
      // got truncated mid-string at ~5KB output. 10 jobs × ~250 tokens
      // each ≈ 2500 tokens, with headroom.
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const out = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const cleaned = out.replace(/^```(?:json)?|```$/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed as CrawledJob[];
  } catch (err) {
    console.error(
      `[crawl-jobs] extractJobs failed: ${(err as Error).message.slice(0, 120)}`,
    );
    return [];
  }
}

async function getCrawlerProfileId(): Promise<string> {
  const profile = await prisma.researchProfile.upsert({
    where: { email: CRAWLER_EMAIL },
    create: {
      email: CRAWLER_EMAIL,
      name: "max-papers crawler",
      profileType: "system",
      institution: "max-papers (aggregated)",
    },
    update: {},
    select: { id: true },
  });
  return profile.id;
}

async function saveJobs(
  jobs: CrawledJob[],
  sourceUrl: string,
  ownerId: string,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const job of jobs) {
    const title = (job.title ?? "").trim();
    const institution = (job.institution ?? "").trim();
    if (!title || !institution) continue;
    if (title.length > 300 || institution.length > 200) continue;

    // Dedup on (institution, title) case-insensitive.
    const existing = await prisma.position.findFirst({
      where: {
        title: { equals: title, mode: "insensitive" },
        institution: { equals: institution, mode: "insensitive" },
      },
      select: { id: true },
    });

    if (existing) {
      // Refresh metadata that may have shifted (deadline, funding,
      // contact). Don't reopen a closed position.
      await prisma.position.update({
        where: { id: existing.id },
        data: {
          description: (job.description ?? "").slice(0, 5000) || undefined,
          country: job.country ?? undefined,
          city: job.city ?? undefined,
          researchTopics: job.researchTopics ?? undefined,
          funded: job.funded ?? undefined,
          deadline: parseDeadline(job.deadline),
          contactEmail: job.contactEmail ?? undefined,
          website: job.website ?? undefined,
          sourceUrl,
        },
      });
      updated++;
      continue;
    }

    try {
      await prisma.position.create({
        data: {
          title: title.slice(0, 300),
          type: normalizeType(job.type),
          description: (job.description ?? "").slice(0, 5000),
          institution: institution.slice(0, 200),
          department: job.department ?? null,
          country: job.country ?? null,
          city: job.city ?? null,
          researchTopics: (job.researchTopics ?? []).slice(0, 20),
          methods: [],
          requirements: [],
          funded: !!job.funded,
          deadline: parseDeadline(job.deadline),
          contactEmail: job.contactEmail ?? null,
          website: job.website ?? null,
          status: "open",
          postedById: ownerId,
          source: "crawled",
          sourceUrl,
        },
      });
      inserted++;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!msg.includes("Unique constraint")) {
        console.error(`[crawl-jobs] save error: ${msg.slice(0, 120)}`);
      }
    }
  }
  return { inserted, updated };
}

function normalizeType(t: string | undefined): CrawledJob["type"] {
  const lower = (t ?? "").toLowerCase();
  if (lower === "phd" || lower === "postdoc" || lower === "faculty" || lower === "fellowship") {
    return lower;
  }
  return "job";
}

function parseDeadline(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  console.log(`[crawl-jobs] starting, ${SOURCES.length} sources`);
  const startedAt = Date.now();
  const ownerId = await getCrawlerProfileId();
  console.log(`[crawl-jobs] owner profile=${ownerId}`);

  let totalInserted = 0;
  let totalUpdated = 0;

  for (const url of SOURCES) {
    console.log(`\n[crawl-jobs] ${url}`);
    if (!(await robotsAllowed(url))) {
      console.log("[crawl-jobs]   robots.txt blocks us — skip");
      continue;
    }
    const text = await fetchPage(url);
    if (!text) {
      console.log("[crawl-jobs]   no content — skip");
      continue;
    }
    const jobs = await extractJobs(text, url);
    console.log(`[crawl-jobs]   extracted ${jobs.length} candidates`);
    const { inserted, updated } = await saveJobs(jobs, url, ownerId);
    console.log(`[crawl-jobs]   inserted=${inserted} updated=${updated}`);
    totalInserted += inserted;
    totalUpdated += updated;
    await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
  }

  const total = await prisma.position.count();
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\n[crawl-jobs] DONE inserted=${totalInserted} updated=${totalUpdated} totalPositions=${total} elapsed=${elapsed}s`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[crawl-jobs] FATAL:", err);
  process.exit(1);
});
