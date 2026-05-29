"use client";

// Small reusable JSON-POST form for the talent hub. Drives both the
// "create profile" and "post position" tabs — the field set comes
// from the parent, the submit + status handling is shared here.

import { useState } from "react";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "email" | "textarea" | "tags" | "select" | "date" | "checkbox";
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

export function SubmitForm({
  endpoint,
  method = "POST",
  fields,
  submitLabel,
  successMessage,
  successHrefKey,
}: {
  endpoint: string;
  method?: "POST" | "PATCH";
  fields: Field[];
  submitLabel: string;
  successMessage: string;
  // Key into the response object whose value is a URL to link to
  // on success (e.g. "url" → response.url).
  successHrefKey?: string;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">(
    "idle",
  );
  const [responseLink, setResponseLink] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function set(name: string, v: string | boolean) {
    setValues((s) => ({ ...s, [name]: v }));
  }

  async function submit() {
    setStatus("saving");
    setErrorMsg(null);
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (v === undefined || v === "") continue;
      if (f.type === "tags") {
        body[f.name] = String(v)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (f.type === "checkbox") {
        body[f.name] = Boolean(v);
      } else {
        body[f.name] = v;
      }
    }
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error ?? "Submit failed");
        return;
      }
      setStatus("ok");
      if (successHrefKey && typeof data[successHrefKey] === "string") {
        setResponseLink(data[successHrefKey]);
      } else if (data.profile?.id) {
        setResponseLink(`/talent?tab=profile&profileId=${data.profile.id}`);
      } else if (data.position?.id) {
        setResponseLink(`/talent/positions/${data.position.id}`);
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg((err as Error).message ?? "Network error");
    }
  }

  if (status === "ok") {
    return (
      <div
        style={{
          padding: 16,
          border: "0.5px solid #e8e0c8",
          background: "#faf8f5",
          fontSize: 13,
          color: "#444",
        }}
      >
        <div style={{ marginBottom: 8 }}>✅ {successMessage}</div>
        {responseLink ? (
          <a
            href={responseLink}
            style={{
              fontSize: 12,
              color: "#c8a84b",
              textDecoration: "none",
            }}
          >
            View →
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {fields.map((f) => (
        <div key={f.name}>
          <label
            style={{
              display: "block",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              color: "#bbb",
              marginBottom: 4,
            }}
          >
            {f.label} {f.required ? "*" : ""}
          </label>
          {f.type === "textarea" ? (
            <textarea
              placeholder={f.placeholder}
              value={String(values[f.name] ?? "")}
              onChange={(e) => set(f.name, e.target.value)}
              rows={4}
              style={inputStyle}
            />
          ) : f.type === "select" ? (
            <select
              value={String(values[f.name] ?? "")}
              onChange={(e) => set(f.name, e.target.value)}
              style={inputStyle}
            >
              <option value="">— pick one —</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : f.type === "checkbox" ? (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "#555",
              }}
            >
              <input
                type="checkbox"
                checked={Boolean(values[f.name])}
                onChange={(e) => set(f.name, e.target.checked)}
              />
              {f.placeholder ?? f.label}
            </label>
          ) : (
            <input
              type={f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
              placeholder={f.placeholder}
              value={String(values[f.name] ?? "")}
              onChange={(e) => set(f.name, e.target.value)}
              style={inputStyle}
            />
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
        <button
          onClick={submit}
          disabled={status === "saving"}
          style={{
            padding: "10px 20px",
            fontSize: 13,
            background: "#111",
            color: "#fff",
            border: "none",
            cursor: status === "saving" ? "wait" : "pointer",
          }}
        >
          {status === "saving" ? "Saving…" : submitLabel}
        </button>
        {errorMsg ? (
          <span style={{ fontSize: 12, color: "#c0392b" }}>{errorMsg}</span>
        ) : null}
      </div>
    </div>
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
