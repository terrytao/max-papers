"use client";

// /talent/status — set job-search intent privately. Distinct from
// /talent?tab=profile which manages the public-profile surface;
// this page is the lighter-weight "I'm looking, here's my email,
// keep me anonymous" flow.
//
// Posts /api/talent/status which upserts ResearchProfile by email
// and sets lookingFor / availableFrom / identifiers without
// flipping visibility.

import { useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";

const LOOKING_OPTIONS = [
  { key: "phd", label: "PhD position" },
  { key: "postdoc", label: "Postdoc" },
  { key: "faculty", label: "Faculty" },
  { key: "industry", label: "Industry job" },
  { key: "fellowship", label: "Fellowship" },
  { key: "internship", label: "Internship" },
];

export default function SetStatusPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [lookingFor, setLookingFor] = useState<string[]>([]);
  const [availableFrom, setAvailableFrom] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setLookingFor((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  }

  async function submit() {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email");
      return;
    }
    if (lookingFor.length === 0) {
      setError("Please pick at least one option for what you're looking for");
      return;
    }
    setStatus("saving");
    setError(null);
    // Heuristically split the identifier input: ORCID-ish vs URL vs
    // Google-Scholar id. We just store it in the right field.
    const orcid = /^\d{4}-\d{4}-\d{4}-\d{3,4}[Xx]?$/.test(identifier.trim())
      ? identifier.trim()
      : null;
    const website =
      identifier.trim() && /^https?:\/\//.test(identifier.trim())
        ? identifier.trim()
        : null;
    const googleScholarId =
      identifier.trim() && !orcid && !website
        ? identifier.trim().slice(0, 50)
        : null;
    try {
      const res = await fetch("/api/talent/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          lookingFor,
          availableFrom: availableFrom || null,
          orcid,
          website,
          googleScholarId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? "Save failed");
        return;
      }
      setStatus("ok");
    } catch (err) {
      setStatus("error");
      setError((err as Error).message ?? "Network error");
    }
  }

  if (status === "ok") {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "0 20px" }}>
        <Nav />
        <div
          style={{
            marginTop: 60,
            padding: 18,
            border: "0.5px solid #b8d9a0",
            background: "#f3faea",
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 500, color: "#27500a", margin: 0 }}>
            ✓ Status saved
          </h1>
          <p style={{ fontSize: 13, color: "#3b6d11", margin: "8px 0 0", lineHeight: 1.6 }}>
            We&apos;ll email <code style={{ background: "#eaf3de", padding: "1px 4px" }}>{email}</code>{" "}
            when one of your papers matches an open position in{" "}
            <strong>{lookingFor.join(", ")}</strong>.
          </p>
          <p style={{ fontSize: 12, color: "#666", margin: "10px 0 0" }}>
            Your name stays private. Want to flip on the public profile?{" "}
            <Link
              href="/talent?tab=profile"
              style={{ color: "#c8a84b", textDecoration: "none" }}
            >
              Open the full profile editor →
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "0 20px 60px" }}>
      <Nav />
      <div style={{ padding: "32px 0 24px" }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: "#111",
            margin: 0,
            letterSpacing: "-.02em",
          }}
        >
          Set your job status
        </h1>
        <p style={{ fontSize: 13, color: "#666", margin: "8px 0 0", lineHeight: 1.6 }}>
          Tell us what you&apos;re looking for. You&apos;ll get email
          notifications when your papers match a relevant position. Your name
          stays private unless you explicitly switch to public on{" "}
          <Link href="/talent?tab=profile" style={{ color: "#c8a84b" }}>
            the full profile editor
          </Link>
          .
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Field label="Name (private)">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            style={inputStyle}
          />
        </Field>

        <Field label="I'm looking for">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
            {LOOKING_OPTIONS.map((opt) => {
              const on = lookingFor.includes(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => toggle(opt.key)}
                  style={{
                    fontSize: 12,
                    padding: "6px 14px",
                    background: on ? "#faeeda" : "transparent",
                    color: on ? "#633806" : "#555",
                    border: `0.5px solid ${on ? "#d8b178" : "#e8e0c8"}`,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Available from">
          <input
            type="date"
            value={availableFrom}
            onChange={(e) => setAvailableFrom(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="Email for match notifications">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@university.edu"
            style={inputStyle}
          />
        </Field>

        <Field label="ORCID or arXiv author URL (so we can find your papers)">
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="0000-0000-0000-0000   or   https://arxiv.org/a/yourname"
            style={inputStyle}
          />
        </Field>

        <div
          style={{
            padding: "10px 12px",
            background: "#faf8f5",
            border: "0.5px solid #e8e0c8",
            fontSize: 12,
            color: "#666",
            lineHeight: 1.6,
          }}
        >
          Your name is <strong>not</strong> shown publicly. You only appear in
          public talent results if you flip your profile to public in{" "}
          <code style={{ background: "#fff", padding: "1px 4px", border: "0.5px solid #e8e0c8" }}>
            /talent?tab=profile
          </code>
          . This page just enables private email matching.
        </div>

        {error ? (
          <p style={{ fontSize: 12, color: "#c0392b", margin: 0 }}>{error}</p>
        ) : null}

        <button
          onClick={submit}
          disabled={status === "saving"}
          style={{
            padding: "10px 14px",
            background: "#111",
            color: "#fff",
            border: "none",
            fontSize: 13,
            fontWeight: 500,
            cursor: status === "saving" ? "wait" : "pointer",
          }}
        >
          {status === "saving"
            ? "Saving…"
            : "Save status — start receiving matches →"}
        </button>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "0.5px solid #e8e0c8",
  outline: "none",
  boxSizing: "border-box",
  background: "#fff",
  fontFamily: "inherit",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: ".08em",
          color: "#888",
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
