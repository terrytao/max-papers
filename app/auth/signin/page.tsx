"use client";

// Sign-in page. Credentials + (optional) Google. After successful
// signin, NextAuth redirects to the post-login URL — we send
// candidates to /dashboard/candidate and employers to
// /dashboard/employer; the choice happens server-side in the
// dashboard pages themselves via session.user.role.

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Nav } from "@/components/Nav";

// Next 14 requires Suspense around useSearchParams() in a client
// component or static prerender fails with an Html-import error.
// Default export wraps SignInForm in a boundary.
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const sp = useSearchParams();
  const callbackUrl = sp.get("callbackUrl") ?? "/dashboard/candidate";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", {
      email,
      password,
      callbackUrl,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError(res.error === "CredentialsSignin" ? "Wrong email or password" : res.error);
      return;
    }
    if (res?.url) window.location.href = res.url;
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "0 20px 60px" }}>
      <Nav />
      <div style={{ padding: "60px 0 24px" }}>
        <h1 style={titleStyle}>Sign in to maxpaper</h1>
        <p style={subtitleStyle}>Manage your talent profile or employer dashboard.</p>
      </div>

      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
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
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={inputStyle}
          />
        </Field>
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
            marginTop: 4,
          }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div style={{ marginTop: 24, fontSize: 12, color: "#666" }}>
        New here?{" "}
        <Link href="/auth/register" style={{ color: "#c8a84b", textDecoration: "none" }}>
          Create an account →
        </Link>
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: "#666" }}>
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          style={{
            padding: "8px 16px",
            fontSize: 12,
            background: "transparent",
            color: "#666",
            border: "0.5px solid #e8e0c8",
            cursor: "pointer",
          }}
        >
          Continue with Google
        </button>
        <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa" }}>
          (only available when GOOGLE_CLIENT_ID is configured)
        </span>
      </div>
    </main>
  );
}

const titleStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 500,
  color: "#111",
  letterSpacing: "-.02em",
  margin: 0,
};
const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#666",
  margin: "8px 0 0",
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
