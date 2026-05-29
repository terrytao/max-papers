"use client";

// Client island for the candidate dashboard's interactive bits:
// visibility toggle, granular field-level visibility checkboxes,
// lookingFor multi-select, availability date, free-text profile
// fields. Single PATCH to /api/dashboard/candidate on Save.

import { useState } from "react";

type Profile = {
  id: string;
  title: string | null;
  institution: string | null;
  department: string | null;
  country: string | null;
  website: string | null;
  bio: string | null;
  visibility: string;
  visibilityFields: string[];
  lookingFor: string[];
  availableFrom: string | null;
  topics: string[];
};

const LOOKING_FOR_OPTIONS = [
  { key: "phd", label: "PhD position" },
  { key: "postdoc", label: "Postdoc" },
  { key: "faculty", label: "Faculty / TT" },
  { key: "industry", label: "Industry" },
  { key: "collaborator", label: "Collaborators" },
];

const VISIBILITY_FIELD_OPTIONS = [
  { key: "name", label: "Name" },
  { key: "institution", label: "Institution" },
  { key: "title", label: "Title / role" },
  { key: "bio", label: "Bio" },
  { key: "papers", label: "Linked papers" },
  { key: "topics", label: "Research topics" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website / ORCID" },
];

export function CandidateDashboardForms({ profile }: { profile: Profile }) {
  const [form, setForm] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Profile>(k: K, v: Profile[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }
  function toggleArr(field: "lookingFor" | "visibilityFields", value: string) {
    const cur = form[field];
    set(field, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/candidate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
      } else {
        setSavedAt(new Date().toLocaleTimeString());
      }
    } catch (err) {
      setError((err as Error).message ?? "Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, marginTop: 28 }}>
      {/* Privacy */}
      <section>
        <h2 style={sectionLabel}>Privacy</h2>
        <p style={helpText}>
          Coarse setting controls whether you appear in the public talent rail
          at all; the per-field checkboxes redact what does appear.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {(["private", "public", "open"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => set("visibility", v)}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                background: form.visibility === v ? "#111" : "transparent",
                color: form.visibility === v ? "#fff" : "#666",
                border: "0.5px solid #e8e0c8",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {v}
            </button>
          ))}
        </div>
        {form.visibility !== "private" ? (
          <div style={{ marginTop: 12 }}>
            <div style={smallLabel}>Fields visible to employers</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
                marginTop: 6,
              }}
            >
              {VISIBILITY_FIELD_OPTIONS.map((opt) => (
                <label
                  key={opt.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: "#555",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.visibilityFields.includes(opt.key)}
                    onChange={() => toggleArr("visibilityFields", opt.key)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* Looking for */}
      <section>
        <h2 style={sectionLabel}>Looking for</h2>
        <p style={helpText}>
          Drives match suggestions on /talent and the homepage talent rail.
        </p>
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          {LOOKING_FOR_OPTIONS.map((opt) => {
            const on = form.lookingFor.includes(opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => toggleArr("lookingFor", opt.key)}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  background: on ? "#faeeda" : "transparent",
                  color: on ? "#633806" : "#666",
                  border: `0.5px solid ${on ? "#d8b178" : "#e8e0c8"}`,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={smallLabel}>
            Available from
            <input
              type="date"
              value={form.availableFrom?.split("T")[0] ?? ""}
              onChange={(e) => set("availableFrom", e.target.value || null)}
              style={{ ...inputStyle, marginTop: 4 }}
            />
          </label>
        </div>
      </section>

      {/* Profile fields */}
      <section>
        <h2 style={sectionLabel}>Profile</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginTop: 12,
          }}
        >
          <Field label="Title">
            <input
              value={form.title ?? ""}
              onChange={(e) => set("title", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
          <Field label="Institution">
            <input
              value={form.institution ?? ""}
              onChange={(e) => set("institution", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
          <Field label="Department">
            <input
              value={form.department ?? ""}
              onChange={(e) => set("department", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
          <Field label="Country">
            <input
              value={form.country ?? ""}
              onChange={(e) => set("country", e.target.value || null)}
              style={inputStyle}
            />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Website">
              <input
                value={form.website ?? ""}
                onChange={(e) => set("website", e.target.value || null)}
                style={inputStyle}
              />
            </Field>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Bio">
              <textarea
                value={form.bio ?? ""}
                onChange={(e) => set("bio", e.target.value || null)}
                rows={3}
                style={{ ...inputStyle, fontFamily: "inherit" }}
              />
            </Field>
          </div>
        </div>
      </section>

      {/* Resume — deferred. Schema-side prep is done; S3 upload is
          a planned follow-up that needs an AWS bucket configured. */}
      <section>
        <h2 style={sectionLabel}>Resume / CV</h2>
        <p style={helpText}>
          Resume upload is coming soon. Until then, link to your CV via the
          Website field above.
        </p>
      </section>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: "10px 22px",
            fontSize: 13,
            background: "#111",
            color: "#fff",
            border: "none",
            cursor: saving ? "wait" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {savedAt ? (
          <span style={{ fontSize: 11, color: "#3b6d11" }}>Saved at {savedAt}</span>
        ) : null}
        {error ? (
          <span style={{ fontSize: 11, color: "#c0392b" }}>{error}</span>
        ) : null}
      </div>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "#c8a84b",
  margin: 0,
};
const helpText: React.CSSProperties = {
  fontSize: 12,
  color: "#888",
  margin: "6px 0 0",
};
const smallLabel: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: ".08em",
  color: "#888",
  marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "0.5px solid #e8e0c8",
  outline: "none",
  boxSizing: "border-box",
  background: "#fff",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span style={smallLabel}>{label}</span>
      {children}
    </div>
  );
}
