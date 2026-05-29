// /talent — research talent marketplace hub. Server component with
// four tabs driven by ?tab=matches|browse|profile|post.
//
// Auth note: in v1 there's no login, so "my matches" / "my profile"
// require a ?profileId=<cuid> in the URL. Users bookmark their own
// view after creating a profile. This is honest scaffolding rather
// than fake auth — fix when real auth ships.

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/prisma";
import { SubmitForm, type Field } from "@/components/talent/SubmitForm";
import {
  ScoreRing,
  BreakdownBar,
  ReasonPills,
} from "@/components/talent/MatchCard";

export const dynamic = "force-dynamic";

type TabKey = "matches" | "browse" | "profile" | "post";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "matches", label: "My matches" },
  { key: "browse", label: "Browse positions" },
  { key: "profile", label: "My profile" },
  { key: "post", label: "Post position" },
];

export default async function TalentHub({
  searchParams,
}: {
  searchParams: { tab?: string; profileId?: string };
}) {
  const tab: TabKey = (TABS.find((t) => t.key === searchParams.tab)?.key ??
    "matches") as TabKey;
  const profileId = searchParams.profileId?.trim() || null;

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "0 20px" }}>
      <Nav />
      <header style={{ padding: "32px 0 18px", borderBottom: "0.5px solid #e8e0c8" }}>
        <p
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "#c8a84b",
            margin: 0,
          }}
        >
          Research talent
        </p>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 500,
            color: "#111",
            letterSpacing: "-.02em",
            margin: "10px 0 0",
            lineHeight: 1.25,
          }}
        >
          Matches between researchers and open positions
        </h1>
        <p style={{ fontSize: 13, color: "#666", margin: "8px 0 0" }}>
          Profiles + positions are auto-matched by paper overlap, citation
          signal, methods, venues, and field.
        </p>
      </header>

      <nav
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "0.5px solid #e8e0c8",
          marginTop: 18,
        }}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          const href = profileId
            ? `/talent?tab=${t.key}&profileId=${profileId}`
            : `/talent?tab=${t.key}`;
          return (
            <Link
              key={t.key}
              href={href}
              style={{
                padding: "10px 14px",
                fontSize: 12,
                color: active ? "#111" : "#888",
                background: "transparent",
                textDecoration: "none",
                borderBottom: active ? "2px solid #111" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <section style={{ paddingTop: 24, paddingBottom: 60 }}>
        {tab === "matches" ? (
          <MatchesTab profileId={profileId} />
        ) : tab === "browse" ? (
          <BrowseTab />
        ) : tab === "profile" ? (
          <ProfileTab profileId={profileId} />
        ) : (
          <PostTab profileId={profileId} />
        )}
      </section>
    </main>
  );
}

// ── tab: My matches ────────────────────────────────────────────────
async function MatchesTab({ profileId }: { profileId: string | null }) {
  if (!profileId) {
    return (
      <Hint>
        Add <code>?profileId=YOUR_CUID</code> to the URL to see your matches.
        Don&apos;t have a profile yet? Create one in{" "}
        <Link href="/talent?tab=profile" style={{ color: "#c8a84b" }}>
          My profile
        </Link>
        .
      </Hint>
    );
  }
  const matches = await prisma.match.findMany({
    where: { profileId, score: { gte: 30 } },
    take: 20,
    orderBy: { score: "desc" },
    include: {
      position: {
        include: {
          postedBy: { select: { id: true, name: true, institution: true } },
        },
      },
    },
  });
  if (matches.length === 0) {
    return (
      <Hint>
        No matches yet — either no open positions in your area, or the matching
        engine hasn&apos;t scored your profile against a position yet. Matches
        are computed when a new position is posted.
      </Hint>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {matches.map((m) => (
        <Link
          key={m.id}
          href={`/talent/positions/${m.position.id}`}
          style={{
            display: "grid",
            gridTemplateColumns: "72px 1fr",
            gap: 16,
            padding: 16,
            border: "0.5px solid #e8e0c8",
            background: "#fff",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <ScoreRing score={m.score} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "#111" }}>
              {m.position.title}
            </div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
              {m.position.type.toUpperCase()} · {m.position.institution}
              {m.position.country ? ` · ${m.position.country}` : ""}
              {m.position.deadline
                ? ` · deadline ${m.position.deadline.toISOString().split("T")[0]}`
                : ""}
            </div>
            <div style={{ marginTop: 10 }}>
              <BreakdownBar
                topicScore={m.topicScore}
                citationScore={m.citationScore}
                methodScore={m.methodScore}
                venueScore={m.venueScore}
              />
            </div>
            <ReasonPills reasons={m.reasons} />
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── tab: Browse positions ──────────────────────────────────────────
async function BrowseTab() {
  const positions = await prisma.position.findMany({
    where: { status: "open" },
    take: 30,
    orderBy: [
      { deadline: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    include: {
      postedBy: { select: { id: true, name: true, institution: true } },
    },
  });
  if (positions.length === 0) {
    return (
      <Hint>
        No open positions yet. Be the first —{" "}
        <Link href="/talent?tab=post" style={{ color: "#c8a84b" }}>
          post a position
        </Link>
        .
      </Hint>
    );
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {positions.map((p) => (
        <li
          key={p.id}
          style={{ padding: "14px 0", borderBottom: "0.5px solid #f0ebd9" }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontSize: 10,
                padding: "2px 7px",
                background: "#e6f1fb",
                color: "#185fa5",
                textTransform: "uppercase",
                letterSpacing: ".05em",
              }}
            >
              {p.type}
            </span>
            {p.funded ? (
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 7px",
                  background: "#eaf3de",
                  color: "#3b6d11",
                }}
              >
                Funded
              </span>
            ) : null}
            <span style={{ fontSize: 11, color: "#bbb" }}>
              {p.institution}
              {p.country ? ` · ${p.country}` : ""}
              {p.deadline
                ? ` · deadline ${p.deadline.toISOString().split("T")[0]}`
                : ""}
            </span>
          </div>
          <Link
            href={`/talent/positions/${p.id}`}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#111",
              textDecoration: "none",
            }}
          >
            {p.title}
          </Link>
          {p.researchTopics.length > 0 ? (
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                marginTop: 6,
              }}
            >
              {p.researchTopics.slice(0, 5).map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 11,
                    padding: "2px 7px",
                    background: "#faf8f5",
                    color: "#888",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ── tab: My profile ────────────────────────────────────────────────
async function ProfileTab({ profileId }: { profileId: string | null }) {
  if (profileId) {
    const profile = await prisma.researchProfile.findUnique({
      where: { id: profileId },
      include: {
        papers: { include: { paper: { select: { id: true, title: true } } } },
        positions: { where: { status: "open" } },
      },
    });
    if (!profile) {
      return (
        <Hint>
          No profile found for that id. Create one below.
          <CreateProfileForm />
        </Hint>
      );
    }
    return (
      <div>
        <div
          style={{
            padding: 16,
            border: "0.5px solid #e8e0c8",
            background: "#fff",
            marginBottom: 18,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 500, color: "#111" }}>
            {profile.name}
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
            {profile.title ? `${profile.title} · ` : ""}
            {profile.institution ?? "Independent"}
            {profile.country ? ` · ${profile.country}` : ""}
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 14 }}>
            <Stat n={profile.paperCount} label="papers" />
            <Stat n={profile.totalCitations} label="citations" />
            <Stat n={profile.hIndex} label="h-index" />
          </div>
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 14 }}>
            Profile id: <code>{profile.id}</code>
          </div>
          <Link
            href={`/talent/profile/${profile.id}`}
            style={{
              fontSize: 12,
              color: "#c8a84b",
              textDecoration: "none",
              marginTop: 8,
              display: "inline-block",
            }}
          >
            View public profile →
          </Link>
        </div>
        {profile.papers.length === 0 ? (
          <Hint>
            No papers linked yet. POST a paperId to{" "}
            <code>/api/talent/profiles/{profile.id}/papers</code> to link papers
            to your profile — the matching engine uses them to score positions.
          </Hint>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      <Hint>
        Create a profile below. You&apos;ll get back a profile id; bookmark{" "}
        <code>/talent?profileId=YOUR_ID</code> to come back to your matches.
      </Hint>
      <CreateProfileForm />
    </div>
  );
}

// ── tab: Post position ─────────────────────────────────────────────
async function PostTab({ profileId }: { profileId: string | null }) {
  if (!profileId) {
    return (
      <Hint>
        You need a profile to post a position (it gets attached as{" "}
        <code>postedById</code>). Create one in{" "}
        <Link href="/talent?tab=profile" style={{ color: "#c8a84b" }}>
          My profile
        </Link>{" "}
        first, then come back with{" "}
        <code>?profileId=YOUR_CUID</code> in the URL.
      </Hint>
    );
  }
  return (
    <div>
      <Hint>
        Posting as profile <code>{profileId}</code>. The matching engine fires
        automatically when you submit — open candidates appear on the position
        page within a few seconds.
      </Hint>
      <PostPositionForm profileId={profileId} />
    </div>
  );
}

// ── shared bits ────────────────────────────────────────────────────
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 14,
        background: "#faf8f5",
        border: "0.5px solid #e8e0c8",
        fontSize: 13,
        color: "#666",
        lineHeight: 1.7,
        marginBottom: 18,
      }}
    >
      {children}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 500, color: "#111" }}>
        {n.toLocaleString("en-US")}
      </div>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: ".08em",
          color: "#888",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

const PROFILE_FIELDS: Field[] = [
  { name: "name", label: "Name", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "title", label: "Title (PhD student / Postdoc / PI / …)" },
  { name: "institution", label: "Institution" },
  { name: "department", label: "Department" },
  { name: "lab", label: "Lab" },
  { name: "country", label: "Country" },
  {
    name: "profileType",
    label: "Profile type",
    type: "select",
    options: ["researcher", "pi", "recruiter", "student"],
  },
  { name: "topics", label: "Research topics (comma-separated)", type: "tags" },
  { name: "methods", label: "Methods (comma-separated)", type: "tags" },
  { name: "lookingFor", label: "Looking for (comma-separated)", type: "tags" },
  { name: "bio", label: "Bio", type: "textarea" },
];

function CreateProfileForm() {
  return (
    <SubmitForm
      endpoint="/api/talent/profiles"
      fields={PROFILE_FIELDS}
      submitLabel="Create profile"
      successMessage="Profile created. Bookmark the link below."
    />
  );
}

function PostPositionForm({ profileId }: { profileId: string }) {
  const fields: Field[] = [
    { name: "title", label: "Position title", required: true },
    {
      name: "type",
      label: "Type",
      type: "select",
      required: true,
      options: ["phd", "postdoc", "job", "fellowship", "grant"],
    },
    { name: "description", label: "Description", type: "textarea", required: true },
    { name: "institution", label: "Institution", required: true },
    { name: "department", label: "Department" },
    { name: "lab", label: "Lab" },
    { name: "country", label: "Country" },
    { name: "city", label: "City" },
    {
      name: "researchTopics",
      label: "Research topics (comma-separated)",
      type: "tags",
    },
    { name: "methods", label: "Methods (comma-separated)", type: "tags" },
    { name: "requirements", label: "Requirements (comma-separated)", type: "tags" },
    { name: "funded", label: "Funded", type: "checkbox", placeholder: "Position is funded" },
    { name: "salary", label: "Salary / stipend" },
    { name: "deadline", label: "Application deadline", type: "date" },
    { name: "startDate", label: "Start date", type: "date" },
    { name: "duration", label: "Duration (e.g. 3 years)" },
    { name: "contactEmail", label: "Contact email", type: "email" },
    { name: "website", label: "Position website" },
    // Hidden as a fixed value via a one-off field — we splat profileId
    // into the body before submit through the URL form post pattern.
    { name: "postedById", label: "Posted by (profile id)", required: true, placeholder: profileId },
  ];
  return (
    <SubmitForm
      endpoint="/api/talent/positions"
      fields={fields}
      submitLabel="Post position"
      successMessage="Position is live. Matching is running in the background."
      successHrefKey="url"
    />
  );
}
