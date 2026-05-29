// Talent-marketplace matching engine.
//
// Given a Position (posted by a PI) and a candidate ResearchProfile,
// produce a 0-100 score across five axes:
//
//   1. Topic overlap     (35 pts) — shared keywords/fields between
//                                    candidate papers and position
//   2. Citation signal   (25 pts) — candidate paper abstracts that
//                                    quote distinctive phrases from
//                                    the PI's papers
//   3. Method overlap    (15 pts) — shared method tags (RL, MRI,
//                                    contrastive learning, …)
//   4. Venue quality     (10 pts) — candidate publications in
//                                    top-tier vs niche venues
//   5. Field match       (10 pts) — at least one overlapping field
//                                    classification
//   6. Publication count ( 5 pts) — basic "has done research" signal
//
// Two fixes vs the original sketch:
//
//  • Keywords arrays from OpenAlex ingest are mostly empty. We fall
//    back to fields + tokenised title words so the topic-overlap
//    score isn't permanently zero.
//
//  • Naive title-fragment matching ("first 3 words of title" in
//    abstract) produces wild false positives — half the corpus
//    starts with "a study of", "deep learning for", "machine
//    learning in". We require the fragment to be ≥18 chars after
//    leading stopwords are dropped, so it's actually distinctive.
//    Generic titles contribute 0 citation-signal points instead of
//    matching everything.

import { prisma } from "@/lib/prisma";
import { sendMatchNotification } from "@/lib/notifications/email";

// Words that, if a title leads with them, get stripped before we
// search abstracts for the title — otherwise generic phrasing
// dominates the citation score.
const TITLE_LEAD_STOPWORDS = new Set([
  "a", "an", "the",
  "on", "of", "for", "with", "in", "to", "from", "into",
  "deep", "machine", "neural", "novel", "new", "improving", "improved",
  "study", "studies", "analysis", "review", "survey", "evaluation",
  "evaluating", "exploring", "investigating", "understanding",
  "towards", "toward", "using", "via", "based",
]);

// Minimum length of the distinctive title-prefix we'll search for
// inside candidate abstracts. Shorter than this and we're matching
// noise.
const MIN_DISTINCTIVE_TITLE_CHARS = 18;

const TOP_VENUES = ["nature", "science", "cell", "lancet", "nejm", "jama"];
const GOOD_VENUES = [
  "ieee", "acm", "neurips", "icml", "cvpr", "iccv", "icra", "iros",
  "aaai", "ijcai", "kdd", "www", "siggraph", "pnas",
];

// Pull a distinctive prefix from a title — drop leading stopwords,
// then take everything up to char N (or the whole title if short).
// Returns null if there's nothing distinctive left.
function distinctiveTitleFragment(title: string): string | null {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let start = 0;
  while (start < words.length && TITLE_LEAD_STOPWORDS.has(words[start]!)) {
    start++;
  }
  const tail = words.slice(start).join(" ");
  if (tail.length < MIN_DISTINCTIVE_TITLE_CHARS) return null;
  return tail.slice(0, 60);
}

// Collect topic-ish tokens from a paper: keywords first (when
// populated), then fields, then a token-cleaned title as fallback.
function paperTopicTokens(paper: {
  keywords: string[];
  fields: string[];
  title: string;
}): Set<string> {
  const out = new Set<string>();
  for (const k of paper.keywords) out.add(k.toLowerCase());
  for (const f of paper.fields) out.add(f.toLowerCase());
  // Fallback: distinctive title words (skip generic leads).
  for (const w of paper.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !TITLE_LEAD_STOPWORDS.has(w))) {
    out.add(w);
  }
  return out;
}

type ScoredMatch = {
  positionId: string;
  profileId: string;
  score: number;
  topicScore: number;
  citationScore: number;
  methodScore: number;
  venueScore: number;
  reasons: string[];
  sharedTopics: string[];
  sharedMethods: string[];
  citedPapers: string[];
};

export async function calculateMatch(
  positionId: string,
  profileId: string,
): Promise<ScoredMatch | null> {
  const [position, profile] = await Promise.all([
    prisma.position.findUnique({
      where: { id: positionId },
      include: {
        postedBy: {
          include: { papers: { include: { paper: true } } },
        },
      },
    }),
    prisma.researchProfile.findUnique({
      where: { id: profileId },
      include: { papers: { include: { paper: true } } },
    }),
  ]);
  if (!position || !profile) return null;

  const piPapers = position.postedBy.papers.map((pp) => pp.paper);
  const candPapers = profile.papers.map((pp) => pp.paper);

  // ── 1. Topic overlap (max 35) ─────────────────────────────────
  const posTopics = new Set<string>(
    [
      ...position.researchTopics,
      ...piPapers.flatMap((p) => Array.from(paperTopicTokens(p))),
    ].map((t) => t.toLowerCase()),
  );
  const candTopics = new Set<string>(
    [
      ...profile.topics,
      ...candPapers.flatMap((p) => Array.from(paperTopicTokens(p))),
    ].map((t) => t.toLowerCase()),
  );
  const sharedTopics = Array.from(posTopics).filter((t) => candTopics.has(t));
  const topicScore = Math.min(35, sharedTopics.length * 4);

  // ── 2. Citation signal (max 25) ───────────────────────────────
  // Distinctive title fragment from each PI paper, searched as a
  // substring inside each candidate abstract. Avoids the false-
  // positive blowup of matching short generic prefixes.
  const citedPapers: string[] = [];
  const piFragments: Array<{ frag: string; title: string }> = [];
  for (const p of piPapers) {
    const frag = distinctiveTitleFragment(p.title);
    if (frag) piFragments.push({ frag, title: p.title });
  }
  for (const cp of candPapers) {
    const abstract = cp.abstract.toLowerCase();
    for (const { frag, title } of piFragments) {
      if (abstract.includes(frag) && !citedPapers.includes(title)) {
        citedPapers.push(title);
      }
    }
  }
  const citationScore = Math.min(25, citedPapers.length * 8);

  // ── 3. Method overlap (max 15) ────────────────────────────────
  const posMethods = new Set(position.methods.map((m) => m.toLowerCase()));
  const candMethods = new Set(profile.methods.map((m) => m.toLowerCase()));
  const sharedMethods = Array.from(posMethods).filter((m) =>
    candMethods.has(m),
  );
  const methodScore = Math.min(15, sharedMethods.length * 3);

  // ── 4. Venue quality (max 10) ─────────────────────────────────
  let venueScore = 0;
  for (const p of candPapers) {
    const j = (p.journal ?? "").toLowerCase();
    if (TOP_VENUES.some((v) => j.includes(v))) venueScore += 3;
    else if (GOOD_VENUES.some((v) => j.includes(v))) venueScore += 2;
    else if (p.citationCount > 100) venueScore += 1;
  }
  venueScore = Math.min(10, venueScore);

  // ── 5. Field match (max 10) ───────────────────────────────────
  const posFields = new Set(
    piPapers.flatMap((p) => p.fields.map((f) => f.toLowerCase())),
  );
  const candFields = new Set(
    candPapers.flatMap((p) => p.fields.map((f) => f.toLowerCase())),
  );
  const fieldMatch = Array.from(posFields).some((f) => candFields.has(f));
  const fieldScore = fieldMatch ? 10 : 0;

  // ── 6. Publication count (max 5) ──────────────────────────────
  const pubScore = Math.min(5, candPapers.length);

  const total =
    topicScore + citationScore + methodScore + venueScore + fieldScore + pubScore;

  const reasons: string[] = [];
  if (sharedTopics.length > 0) {
    reasons.push(
      `Shared research topics: ${sharedTopics.slice(0, 3).join(", ")}`,
    );
  }
  if (citedPapers.length > 0) {
    reasons.push(
      `Work overlaps with ${citedPapers.length} of the lab's papers`,
    );
  }
  if (sharedMethods.length > 0) {
    reasons.push(`Shared methods: ${sharedMethods.slice(0, 2).join(", ")}`);
  }
  if (venueScore >= 6) {
    reasons.push("Published in top-tier venues");
  }
  if (candPapers.length > 3) {
    reasons.push(
      `${candPapers.length} publications demonstrate strong research output`,
    );
  }

  return {
    positionId,
    profileId,
    score: Math.round(total),
    topicScore,
    citationScore,
    methodScore,
    venueScore,
    reasons,
    sharedTopics: sharedTopics.slice(0, 20),
    sharedMethods: sharedMethods.slice(0, 20),
    citedPapers: citedPapers.slice(0, 10),
  };
}

const MIN_SCORE_TO_SAVE = 30;
const TOP_N_TO_SAVE = 20;

// Score every researcher profile that has at least one linked paper
// against the given position, then upsert the top 20 with score ≥ 30
// as Match rows. Returns the top N for the caller to show inline.
//
// Cost note: this is O(profiles) DB roundtrips because calculateMatch
// hydrates each profile's papers separately. Fine while profile
// count is small (~hundreds); for tens of thousands of profiles
// we'd batch the include via prisma.researchProfile.findMany with
// the same include shape and score in memory.
export async function matchPosition(positionId: string): Promise<ScoredMatch[]> {
  const profiles = await prisma.researchProfile.findMany({
    where: { papers: { some: {} } },
    select: { id: true },
  });

  const scored: ScoredMatch[] = [];
  for (const p of profiles) {
    const m = await calculateMatch(positionId, p.id);
    if (m && m.score >= MIN_SCORE_TO_SAVE) scored.push(m);
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_N_TO_SAVE);

  for (const m of top) {
    await prisma.match.upsert({
      where: {
        positionId_profileId: {
          positionId: m.positionId,
          profileId: m.profileId,
        },
      },
      create: {
        positionId: m.positionId,
        profileId: m.profileId,
        score: m.score,
        topicScore: m.topicScore,
        citationScore: m.citationScore,
        methodScore: m.methodScore,
        venueScore: m.venueScore,
        reasons: m.reasons,
        sharedTopics: m.sharedTopics,
        sharedMethods: m.sharedMethods,
        citedPapers: m.citedPapers,
      },
      update: {
        score: m.score,
        topicScore: m.topicScore,
        citationScore: m.citationScore,
        methodScore: m.methodScore,
        venueScore: m.venueScore,
        reasons: m.reasons,
        sharedTopics: m.sharedTopics,
        sharedMethods: m.sharedMethods,
        citedPapers: m.citedPapers,
      },
    });
  }

  // Fire notification emails for new matches (notified = false).
  // We only email NEW matches — re-runs of matchPosition refresh the
  // score on existing rows but don't re-notify, to avoid spamming
  // candidates every time the engine retunes.
  void notifyNewMatches(top.map((m) => ({ positionId: m.positionId, profileId: m.profileId })));

  return top;
}

// Fire-and-forget notification dispatch. Looks up which Match rows
// haven't been notified yet, sends emails, then flips notified=true.
// Failures are logged but don't propagate — never break matching on a
// downstream email blip.
async function notifyNewMatches(
  matches: Array<{ positionId: string; profileId: string }>,
): Promise<void> {
  if (matches.length === 0) return;
  try {
    const rows = await prisma.match.findMany({
      where: {
        OR: matches,
        notified: false,
      },
      include: {
        position: {
          select: {
            id: true,
            title: true,
            institution: true,
            postedBy: { select: { name: true, email: true } },
          },
        },
        profile: { select: { id: true, name: true, email: true } },
      },
    });
    for (const m of rows) {
      try {
        await sendMatchNotification({
          candidate: { name: m.profile.name, email: m.profile.email },
          pi: { name: m.position.postedBy.name, email: m.position.postedBy.email },
          positionTitle: m.position.title,
          positionInstitution: m.position.institution,
          positionId: m.position.id,
          candidateId: m.profile.id,
          score: m.score,
          reasons: m.reasons,
        });
        await prisma.match.update({
          where: { id: m.id },
          data: { notified: true },
        });
      } catch (err) {
        console.error(
          `[matching] notification failed for match ${m.id}:`,
          (err as Error).message,
        );
      }
    }
  } catch (err) {
    console.error(
      `[matching] notifyNewMatches batch failed:`,
      (err as Error).message,
    );
  }
}
