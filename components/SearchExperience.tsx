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

import { useState } from "react";

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
  const [activeFilters, setActiveFilters] = useState<Filters | null>(null);
  const [matchMode, setMatchMode] = useState<"AND" | "OR">("AND");

  async function search(
    overrideFilters?: Filters,
    overrideQuery?: string,
    overrideMode?: "AND" | "OR",
  ) {
    const q = (overrideQuery ?? query).trim();
    if (!q && !overrideFilters) return;
    const mode = overrideMode ?? matchMode;
    setLoading(true);
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
      const data = (await res.json()) as SearchResult & { error?: string };
      if (data.error) {
        setResults({ papers: [], total: 0, summary: "", filters: {} });
      } else {
        setResults(data);
        setActiveFilters(data.filters);
      }
    } catch {
      setResults({ papers: [], total: 0, summary: "", filters: {} });
    } finally {
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
            gridTemplateColumns: "220px 1fr",
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

            {results.summary ? (
              <div
                style={{
                  padding: "12px 14px",
                  background: "#f7f4ef",
                  border: "0.5px solid #e8e0c8",
                  marginBottom: 16,
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: "#444",
                }}
              >
                {results.summary}
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
        </div>
      )}
    </>
  );
}

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
