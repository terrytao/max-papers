// Shared top nav — used by every page including the homepage so the
// link set stays in one place. Server component; the sign-in /
// dashboard link is a client island (<AuthNavLink />) so the rest
// of the nav stays static.

import { AuthNavLink } from "./AuthNavLink";

export function Nav() {
  return (
    <nav
      style={{
        borderBottom: "0.5px solid #e8e0c8",
        padding: "12px 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 0,
      }}
    >
      <a
        href="/"
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: "#111",
          letterSpacing: "-.01em",
          textDecoration: "none",
        }}
      >
        maxpaper
      </a>
      <div style={{ display: "flex", gap: 20 }}>
        <a href="/browse" style={{ fontSize: 12, color: "#888", textDecoration: "none" }}>
          Browse
        </a>
        <a href="/researchers" style={{ fontSize: 12, color: "#888", textDecoration: "none" }}>
          Researchers
        </a>
        <a href="/talent" style={{ fontSize: 12, color: "#888", textDecoration: "none" }}>
          Talent
        </a>
        <a href="/developer" style={{ fontSize: 12, color: "#888", textDecoration: "none" }}>
          Developer
        </a>
        <AuthNavLink />
      </div>
    </nav>
  );
}
