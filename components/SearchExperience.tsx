"use client";

// Interactive search island. Owns the query input, suggestion chips,
// editable filter panel, AI summary, and the result list. Mounted
// inside the server-rendered app/page.tsx so the live paperCount in
// the hero stays a real DB number.
//
// Race-condition note: filter edits fire a new POST without aborting
// any in-flight request — the response from the most-recent call
// wins because setLoading/setResults always run last. Not perfect
// (a slow earlier response could overwrite a fast newer one) but
// the common case is fine. AbortController-based race-proofing is
// a follow-up if it bites.

import { useRef, useState } from "react";

interface FilterSuggestions {
  topics?: string[];
  authors?: string[];
  journals?: string[];
}

interface Filters {
  topic?: string | null;
  author?: string | null;
  afterYear?: number | null;
  journal?: string | null;
  subtopic?: string | null;
  openAccess?: boolean | null;
  suggestions?: FilterSuggestions;
}

interface Paper {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  fields: string[];
  isOpenAccess: boolean;
  citationCount: number;
  pdfUrl: string | null;
  url: string | null;
}

interface SearchResult {
  papers: Paper[];
  total: number;
  summary: string;
  filters: Filters;
}

// Right-rail talent matches — populated in parallel with the paper
// search via POST /api/talent/matches with the extracted topic.
interface MatchPosition {
  id: string;
  title: string;
  type: string;
  institution: string;
  country: string | null;
  funded: boolean;
  deadline: string | null;
  score: number;
  postedBy: { name: string; institution: string | null } | null;
}

interface MatchCandidate {
  id: string;
  name: string;
  title: string | null;
  institution: string | null;
  paperCount: number;
  totalCitations: number;
  hIndex: number;
  visibility: string;
  lookingFor: string[];
  availableFrom: string | null;
  score: number;
  topPaper: {
    title: string;
    journal: string | null;
    year: number | null;
    citationCount: number;
  } | null;
  researchTopics: string[];
}

interface TalentMatches {
  positions: MatchPosition[];
  candidates: MatchCandidate[];
  privateCandidateCount: number;
  total: number;
}

const SUGGESTIONS = [
  "papers about robots that can feel things",
  "does coffee prevent or cause cancer?",
  "latest research on sleep and memory",
  "Geoffrey Hinton neural network papers",
];

export function SearchExperience() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Filters | null>(null);
  const [matchMode, setMatchMode] = useState<"AND" | "OR">("AND");
  const [talent, setTalent] = useState<TalentMatches | null>(null);
  const [talentLoading, setTalentLoading] = useState(false);

  // Race-guard token shared by both async tail-fetches (summary +
  // talent) — both keyed off the same search; when a new search
  // fires, any in-flight tail responses are dropped.
  const summaryTokenRef = useRef(0);

  async function search(
    overrideFilters?: Filters,
    overrideQuery?: string,
    overrideMode?: "AND" | "OR",
  ) {
    const q = (overrideQuery ?? query).trim();
    if (!q && !overrideFilters) return;
    const mode = overrideMode ?? matchMode;
    const myToken = ++summaryTokenRef.current;
    setLoading(true);
    setSummaryLoading(false);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          filters: overrideFilters ?? null,
          matchMode: mode,
        }),
      });
      const data = (await res.json()) as Partial<SearchResult> & {
        error?: string;
      };
      if (data.error || !data.papers) {
        setResults({ papers: [], total: 0, summary: "", filters: {} });
        setLoading(false);
        return;
      }
      const initial: SearchResult = {
        papers: data.papers,
        total: data.total ?? data.papers.length,
        summary: "",
        filters: data.filters ?? {},
      };
      setResults(initial);
      setActiveFilters(initial.filters);
      setLoading(false);

      // Phase 2 (parallel): summary + talent rail. Both fire-and-forget,
      // race-safe via summaryTokenRef.
      const topic = initial.filters?.topic ?? q;

      if (initial.papers.length > 0) {
        setSummaryLoading(true);
        const sliced = initial.papers.slice(0, 3).map((p) => ({
          title: p.title,
          abstract: p.abstract,
        }));
        fetch("/api/search/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, papers: sliced }),
        })
          .then((r) => r.json())
          .then((s: { summary?: string }) => {
            if (myToken !== summaryTokenRef.current) return;
            setResults((prev) =>
              prev ? { ...prev, summary: s.summary ?? "" } : prev,
            );
          })
          .catch(() => {
            /* leave summary blank on error */
          })
          .finally(() => {
            if (myToken === summaryTokenRef.current) {
              setSummaryLoading(false);
            }
          });
      }

      // Talent matches — fire even on zero paper results; users may
      // still want to see jobs/candidates on the topic. Skip when
      // topic is empty (e.g. caller passed only year filters).
      if (topic?.trim()) {
        setTalentLoading(true);
        fetch("/api/talent/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // topics[] form (preferred) — endpoint still accepts the
          // singular `topic` shape too for back-compat with other
          // callers (MCP server, future agents).
          body: JSON.stringify({ topics: [topic] }),
        })
          .then((r) => r.json())
          .then((t: TalentMatches & { error?: string }) => {
            if (myToken !== summaryTokenRef.current) return;
            if (t.error) {
              setTalent({ positions: [], candidates: [], privateCandidateCount: 0, total: 0 });
            } else {
              setTalent({
                positions: t.positions ?? [],
                candidates: t.candidates ?? [],
                privateCandidateCount: t.privateCandidateCount ?? 0,
                total: t.total ?? 0,
              });
            }
          })
          .catch(() => {
            if (myToken === summaryTokenRef.current) {
              setTalent({ positions: [], candidates: [], privateCandidateCount: 0, total: 0 });
            }
          })
          .finally(() => {
            if (myToken === summaryTokenRef.current) {
              setTalentLoading(false);
            }
          });
      } else {
        setTalent(null);
      }
    } catch {
      setResults({ papers: [], total: 0, summary: "", filters: {} });
      setLoading(false);
    }
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    const updated: Filters = { ...(activeFilters ?? {}), [key]: value };
    setActiveFilters(updated);
    search(updated);
  }

  function pickMatchMode(mode: "AND" | "OR") {
    setMatchMode(mode);
    if (activeFilters) {
      // Re-search using current filters under the new mode.
      search(activeFilters, undefined, mode);
    }
  }

  function pickSuggestion(s: string) {
    setQuery(s);
    search(undefined, s);
  }

  function reset() {
    setActiveFilters(null);
    setResults(null);
    setQuery("");
    setMatchMode("AND");
    setTalent(null);
    setTalentLoading(false);
  }

  // Count of "real" active filters (suggestions doesn't count, falsy
  // values don't count, empty strings don't count).
  const activeCount = activeFilters
    ? (["topic", "author", "afterYear", "journal", "subtopic", "openAccess"] as const).filter(
        (k) => {
          const v = activeFilters[k];
          if (v === null || v === undefined) return false;
          if (typeof v === "string") return v.trim().length > 0;
          if (typeof v === "boolean") return v === true;
          if (typeof v === "number") return v > 0;
          return false;
        },
      ).length
    : 0;

  return (
    <>
      {/* Search input */}
      <div style={{ display: "flex", maxWidth: 600, margin: "0 auto" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value.slice(0, 500))}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="e.g. papers about robots that can feel things"
          maxLength={500}
          style={{
            flex: 1,
            padding: "12px 16px",
            fontSize: 14,
            border: "0.5px solid #ccc",
            outline: "none",
            borderRight: "none",
            background: "#fff",
          }}
        />
        <button
          onClick={() => search()}
          disabled={loading}
          style={{
            padding: "12px 24px",
            background: "#111",
            color: "#fff",
            border: "none",
            cursor: loading ? "wait" : "pointer",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {loading ? "…" : "Search"}
        </button>
      </div>

      {!results && (
        <div
          style={{
            display: "flex",
            gap: 6,
            justifyContent: "center",
            marginTop: 12,
            flexWrap: "wrap",
          }}
        >
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => pickSuggestion(s)}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                border: "0.5px solid #e8e0c8",
                background: "transparent",
                color: "#888",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {results && (
        <div
          style={{
            display: "grid",
            // 3 columns: filters | results | talent. The minmax(0,...)
            // pattern lets long content (paper abstracts) wrap instead
            // of forcing the grid to grow horizontally.
            gridTemplateColumns: "200px minmax(0, 1.2fr) minmax(0, 1fr)",
            gap: 0,
            marginTop: 24,
            textAlign: "left",
          }}
        >
          <aside
            style={{
              borderRight: "0.5px solid #e8e0c8",
              padding: "0 16px 20px 0",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "#c8a84b",
                marginBottom: 16,
              }}
            >
              ⚡ {activeCount} filter{activeCount === 1 ? "" : "s"} active
            </div>

            <FilterField
              label="Topic"
              value={activeFilters?.topic ?? ""}
              onChange={(v) => updateFilter("topic", v || null)}
              suggestions={activeFilters?.suggestions?.topics ?? []}
              onPick={(s) => updateFilter("topic", s)}
            />

            <FilterField
              label="Author"
              placeholder="Any author"
              value={activeFilters?.author ?? ""}
              onChange={(v) => updateFilter("author", v || null)}
              suggestions={activeFilters?.suggestions?.authors ?? []}
              onPick={(s) => updateFilter("author", s)}
            />

            <div style={{ marginBottom: 14 }}>
              <FieldLabel label="After year" />
              <input
                type="number"
                value={activeFilters?.afterYear ?? ""}
                onChange={(e) =>
                  updateFilter(
                    "afterYear",
                    e.target.value ? Number.parseInt(e.target.value, 10) : null,
                  )
                }
                placeholder="Any year"
                min={1900}
                max={2030}
                style={fieldInputStyle}
              />
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                {[2020, 2022, 2024, 2025].map((y) => {
                  const on = activeFilters?.afterYear === y;
                  return (
                    <button
                      key={y}
                      onClick={() => updateFilter("afterYear", on ? null : y)}
                      style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        border: "0.5px solid #e8e0c8",
                        background: on ? "#111" : "transparent",
                        color: on ? "#fff" : "#888",
                        cursor: "pointer",
                      }}
                    >
                      {y}+
                    </button>
                  );
                })}
              </div>
            </div>

            <FilterField
              label="Journal / Source"
              placeholder="Any journal"
              value={activeFilters?.journal ?? ""}
              onChange={(v) => updateFilter("journal", v || null)}
              suggestions={activeFilters?.suggestions?.journals ?? []}
              onPick={(s) => updateFilter("journal", s)}
            />

            <div style={{ marginBottom: 14 }}>
              <FieldLabel label="Access" />
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "#555",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={activeFilters?.openAccess === true}
                  onChange={(e) =>
                    updateFilter("openAccess", e.target.checked ? true : null)
                  }
                />
                Open access only
              </label>
            </div>

            <button
              onClick={reset}
              style={{
                fontSize: 11,
                color: "#aaa",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                marginTop: 8,
              }}
            >
              Clear all filters
            </button>
          </aside>

          <section style={{ padding: "0 0 20px 20px" }}>
            {/* AND / OR mode toggle. AND = every filter must match
                (precision); OR = any one filter can match (recall). */}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <span style={{ fontSize: 11, color: "#888" }}>Match:</span>
              <button
                onClick={() => pickMatchMode("AND")}
                style={modeButtonStyle(matchMode === "AND")}
              >
                AND
              </button>
              <button
                onClick={() => pickMatchMode("OR")}
                style={modeButtonStyle(matchMode === "OR")}
              >
                OR
              </button>
              <span style={{ fontSize: 11, color: "#bbb" }}>
                {matchMode === "AND"
                  ? "all filters must match"
                  : "any filter can match"}
              </span>
            </div>

            {results.summary || summaryLoading ? (
              <div
                style={{
                  padding: "12px 14px",
                  background: "#f7f4ef",
                  border: "0.5px solid #e8e0c8",
                  marginBottom: 16,
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: results.summary ? "#444" : "#999",
                  transition: "color .2s, opacity .2s",
                  opacity: results.summary ? 1 : 0.85,
                }}
              >
                {results.summary || "Generating summary…"}
                <div style={{ marginTop: 6, fontSize: 11, color: "#bbb" }}>
                  Based on {results.total.toLocaleString("en-US")} paper
                  {results.total === 1 ? "" : "s"}
                </div>
              </div>
            ) : null}

            {results.papers.length > 0 ? (
              results.papers.map((p) => <PaperRow key={p.id} paper={p} />)
            ) : (
              <div
                style={{
                  textAlign: "center",
                  padding: 60,
                  color: "#aaa",
                  fontSize: 13,
                }}
              >
                No papers found for these filters.
                <br />
                <span style={{ fontSize: 11 }}>
                  Try widening the topic or removing a filter on the left.
                </span>
              </div>
            )}
          </section>

          {/* Right rail: matching jobs + candidates for the topic */}
          <TalentRail
            talent={talent}
            loading={talentLoading}
            topic={results.filters?.topic ?? null}
          />
        </div>
      )}
    </>
  );
}

function TalentRail({
  talent,
  loading,
  topic,
}: {
  talent: TalentMatches | null;
  loading: boolean;
  topic: string | null;
}) {
  return (
    <aside style={{ padding: "0 0 20px 20px", borderLeft: "0.5px solid #e8e0c8" }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "#c8a84b",
          marginBottom: 12,
        }}
      >
        Talent · {topic ?? "—"}
      </div>

      <h3 style={railSectionLabel}>
        {talent ? `${talent.positions.length} matching positions` : "Open positions"}
      </h3>
      {loading && !talent ? (
        <p style={railPlaceholder}>Loading positions…</p>
      ) : !talent || talent.positions.length === 0 ? (
        <p style={railPlaceholder}>No open positions match this topic yet.</p>
      ) : (
        <ul style={railList}>
          {talent.positions.slice(0, 3).map((p) => (
            <li key={p.id} style={{ marginBottom: 8 }}>
              <PositionCard p={p} />
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ ...railSectionLabel, marginTop: 22 }}>
        Candidates — openly looking
      </h3>
      {loading && !talent ? (
        <p style={railPlaceholder}>Loading candidates…</p>
      ) : !talent || talent.candidates.length === 0 ? (
        <p style={railPlaceholder}>
          No public candidates yet for this topic.
        </p>
      ) : (
        <div>
          {talent.candidates.map((c) => (
            <CandidateCard key={c.id} c={c} />
          ))}
        </div>
      )}

      {/* Private aggregate — count only, no PII. */}
      {talent && talent.privateCandidateCount > 0 ? (
        <div
          style={{
            border: "0.5px solid #e8e0c8",
            padding: "12px 14px",
            background: "#faf8f5",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 8,
            marginTop: 8,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>
              {talent.privateCandidateCount} more researcher
              {talent.privateCandidateCount !== 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
              publish on this topic but prefer private outreach
            </div>
          </div>
          <div
            style={{
              fontSize: 10,
              color: "#aaa",
              textAlign: "right",
              flexShrink: 0,
              lineHeight: 1.4,
            }}
          >
            Notified automatically
            <br />
            when strong match found
          </div>
        </div>
      ) : null}

      {/* Always-on CTA. Talent hub uses tabs internally, so route to
          ?tab=profile rather than the not-yet-built /talent/apply. */}
      <div
        style={{
          textAlign: "center",
          padding: "10px 12px",
          border: "0.5px dashed #e8e0c8",
          marginTop: 16,
          fontSize: 11,
          color: "#666",
          lineHeight: 1.6,
        }}
      >
        Author on this topic?{" "}
        <a
          href="/talent?tab=profile"
          style={{
            color: "#c8a84b",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          Set your status →
        </a>
      </div>
    </aside>
  );
}

function PositionCard({ p }: { p: MatchPosition }) {
  const scoreColor = p.score >= 80 ? "#27500a" : "#854f0b";
  const barColor = p.score >= 80 ? "#3b6d11" : "#854f0b";
  return (
    <a
      href={`/talent/positions/${p.id}`}
      style={{
        display: "block",
        textDecoration: "none",
        border: "0.5px solid #e8e0c8",
        padding: "10px 12px",
        color: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: "#111", lineHeight: 1.3 }}>
            {p.title}
          </div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
            {(p.postedBy?.institution ?? p.postedBy?.name) ?? "—"}
            {p.country ? ` · ${p.country}` : ""}
          </div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, color: scoreColor, flexShrink: 0 }}>
          {p.score}%
        </div>
      </div>
      <div
        style={{
          height: 3,
          background: "#f0ebd9",
          margin: "6px 0",
        }}
      >
        <div style={{ width: `${p.score}%`, height: "100%", background: barColor }} />
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {p.funded ? (
          <span
            style={{
              fontSize: 10,
              padding: "2px 7px",
              background: "#eaf3de",
              color: "#27500a",
            }}
          >
            Funded
          </span>
        ) : null}
        <span
          style={{
            fontSize: 10,
            padding: "2px 7px",
            background: "#faeeda",
            color: "#633806",
          }}
        >
          {p.type}
        </span>
        {p.deadline ? (
          <span style={{ fontSize: 10, color: "#888" }}>
            Due{" "}
            {new Date(p.deadline).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        ) : null}
      </div>
    </a>
  );
}

function CandidateCard({ c }: { c: MatchCandidate }) {
  const initials = c.name
    .split(/\s+/)
    .map((n) => n[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const scoreColor = c.score >= 80 ? "#27500a" : "#854f0b";
  const barColor = c.score >= 80 ? "#3b6d11" : "#854f0b";
  return (
    <div
      style={{
        border: "0.5px solid #e8e0c8",
        padding: 12,
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "#e6f1fb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 500,
            color: "#0c447c",
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#111" }}>
                {c.name}
              </div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 1 }}>
                {[c.title, c.institution].filter(Boolean).join(" · ") || "Independent"}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: scoreColor }}>
                {c.score}%
              </div>
              <div style={{ fontSize: 9, color: "#aaa" }}>match</div>
            </div>
          </div>

          <div style={{ height: 3, background: "#f0ebd9", margin: "5px 0" }}>
            <div style={{ width: `${c.score}%`, height: "100%", background: barColor }} />
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
            {c.lookingFor.map((lf) => (
              <span
                key={lf}
                style={{
                  fontSize: 10,
                  padding: "2px 7px",
                  background: "#faeeda",
                  color: "#633806",
                }}
              >
                Seeking {lf}
              </span>
            ))}
            {c.availableFrom ? (
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 7px",
                  background: "#eaf3de",
                  color: "#27500a",
                }}
              >
                Available{" "}
                {new Date(c.availableFrom) < new Date()
                  ? "now"
                  : new Date(c.availableFrom).toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                    })}
              </span>
            ) : null}
          </div>

          <div
            style={{
              padding: "7px 10px",
              background: "#faf8f5",
              fontSize: 11,
              color: "#666",
              lineHeight: 1.6,
              marginBottom: 6,
            }}
          >
            {c.paperCount} papers · {c.totalCitations.toLocaleString("en-US")}{" "}
            citations
            {c.hIndex > 0 ? ` · h-index ${c.hIndex}` : ""}
            {c.topPaper ? (
              <>
                <br />
                Top:{" "}
                <span style={{ color: "#111" }}>
                  {c.topPaper.title.length > 60
                    ? c.topPaper.title.slice(0, 60) + "…"
                    : c.topPaper.title}
                </span>
                {c.topPaper.journal
                  ? ` (${c.topPaper.journal}${c.topPaper.year ? ` ${c.topPaper.year}` : ""}`
                  : ""}
                {c.topPaper.citationCount > 0
                  ? `${c.topPaper.journal ? ", " : " ("}${c.topPaper.citationCount} citations)`
                  : c.topPaper.journal
                    ? ")"
                    : ""}
              </>
            ) : null}
          </div>

          {c.researchTopics.length > 0 ? (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
              {c.researchTopics.slice(0, 4).map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 10,
                    padding: "2px 7px",
                    background: "#e6f1fb",
                    color: "#0c447c",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 6 }}>
            <a
              href={`/researchers/${c.id}`}
              style={{
                fontSize: 11,
                padding: "4px 12px",
                background: "#111",
                color: "#fff",
                textDecoration: "none",
              }}
            >
              View profile →
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent("Research opportunity")}&body=${encodeURIComponent("I found your profile on max-papers.com")}`}
              style={{
                fontSize: 11,
                padding: "4px 12px",
                background: "transparent",
                color: "#666",
                border: "0.5px solid #e8e0c8",
                textDecoration: "none",
              }}
            >
              Contact
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

const railSectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: ".05em",
  textTransform: "uppercase",
  color: "#888",
  margin: "0 0 10px",
};
const railList: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 0,
};
const railPlaceholder: React.CSSProperties = {
  fontSize: 12,
  color: "#aaa",
  margin: 0,
};
const fieldInputStyle = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 12,
  border: "0.5px solid #e8e0c8",
  outline: "none",
  boxSizing: "border-box" as const,
  background: "#fff",
};

function modeButtonStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "3px 10px",
    background: active ? "#111" : "transparent",
    color: active ? "#fff" : "#888",
    border: "0.5px solid #e8e0c8",
    cursor: "pointer",
  };
}

function FieldLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: ".07em",
        color: "#bbb",
        marginBottom: 5,
      }}
    >
      {label}
    </div>
  );
}

function FilterField({
  label,
  value,
  placeholder,
  onChange,
  suggestions,
  onPick,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  suggestions: string[];
  onPick: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <FieldLabel label={label} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={fieldInputStyle}
      />
      {suggestions.length > 0 ? (
        <div style={{ marginTop: 4 }}>
          {suggestions.slice(0, 4).map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              style={{
                fontSize: 10,
                padding: "2px 7px",
                border: "0.5px solid #e8e0c8",
                background: "transparent",
                color: "#888",
                cursor: "pointer",
                margin: "3px 3px 0 0",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PaperRow({ paper }: { paper: Paper }) {
  return (
    <div
      style={{ padding: "14px 0", borderBottom: "0.5px solid #e8e0c8" }}
    >
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 4,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {paper.fields[0] ? (
          <span
            style={{
              fontSize: 10,
              padding: "2px 7px",
              background: "#e6f1fb",
              color: "#185fa5",
            }}
          >
            {paper.fields[0]}
          </span>
        ) : null}
        {paper.isOpenAccess ? (
          <span
            style={{
              fontSize: 10,
              padding: "2px 7px",
              background: "#eaf3de",
              color: "#3b6d11",
            }}
          >
            Open access
          </span>
        ) : null}
        <span style={{ fontSize: 11, color: "#bbb" }}>
          {paper.year ?? "—"}
          {paper.journal ? ` · ${paper.journal}` : ""}
          {paper.citationCount > 0 ? ` · ${paper.citationCount} citations` : ""}
        </span>
      </div>
      <a
        href={`/papers/${paper.id}`}
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: "#111",
          textDecoration: "none",
          display: "block",
          marginBottom: 4,
          lineHeight: 1.4,
        }}
      >
        {paper.title}
      </a>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>
        {paper.authors.slice(0, 3).join(", ")}
        {paper.authors.length > 3 ? ` + ${paper.authors.length - 3}` : ""}
      </div>
      <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6 }}>
        {(paper.abstract ?? "").slice(0, 200)}…
      </div>
      {paper.pdfUrl ? (
        <a
          href={paper.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 11,
            color: "#c8a84b",
            textDecoration: "none",
            marginTop: 4,
            display: "inline-block",
          }}
        >
          PDF →
        </a>
      ) : null}
    </div>
  );
}
