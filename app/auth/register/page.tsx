"use client";

// Self-signup page. POSTs /api/auth/register, then auto-signs the
// user in via NextAuth credentials so they land on the correct
// dashboard without a second password prompt.

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { Nav } from "@/components/Nav";

export default function RegisterPage() {
  const [role, setRole] = useState<"user" | "employer">("user");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState("university");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password,
        role,
        orgName: role === "employer" ? orgName : undefined,
        orgType: role === "employer" ? orgType : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? "Registration failed");
      return;
    }
    const signinRes = await signIn("credentials", {
      email,
      password,
      callbackUrl:
        role === "employer" ? "/dashboard/employer" : "/dashboard/candidate",
      redirect: false,
    });
    setLoading(false);
    if (signinRes?.url) window.location.href = signinRes.url;
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "0 20px 60px" }}>
      <Nav />
      <div style={{ padding: "60px 0 24px" }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 500,
            color: "#111",
            letterSpacing: "-.02em",
            margin: 0,
          }}
        >
          Create your account
        </h1>
        <p style={{ fontSize: 13, color: "#666", margin: "8px 0 0" }}>
          Researchers manage privacy + applications. Employers post positions
          and run the candidate pipeline.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {(
          [
            { key: "user", label: "Researcher / Candidate" },
            { key: "employer", label: "Employer / PI" },
          ] as const
        ).map((r) => {
          const active = role === r.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => setRole(r.key)}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                background: active ? "#111" : "transparent",
                color: active ? "#fff" : "#666",
                border: "0.5px solid #e8e0c8",
                cursor: "pointer",
                flex: 1,
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={inputStyle}
          />
        </Field>
        <Field label="Password (≥ 8 chars)">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            style={inputStyle}
          />
        </Field>

        {role === "employer" ? (
          <>
            <Field label="Organisation name">
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
                style={inputStyle}
              />
            </Field>
            <Field label="Organisation type">
              <select
                value={orgType}
                onChange={(e) => setOrgType(e.target.value)}
                style={inputStyle}
              >
                <option value="university">University</option>
                <option value="company">Company</option>
                <option value="lab">Lab / institute</option>
                <option value="hospital">Hospital</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </>
        ) : null}

        {error ? (
          <p style={{ fontSize: 12, color: "#c0392b", margin: 0 }}>{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 20px",
            fontSize: 13,
            background: "#111",
            color: "#fff",
            border: "none",
            cursor: loading ? "wait" : "pointer",
            marginTop: 6,
          }}
        >
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>

      <div style={{ marginTop: 18, fontSize: 12, color: "#666" }}>
        Already have an account?{" "}
        <Link
          href="/auth/signin"
          style={{ color: "#c8a84b", textDecoration: "none" }}
        >
          Sign in →
        </Link>
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
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
