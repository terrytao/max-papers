"use client";

// Client island for the nav's auth link. NextAuth's getServerSession
// would work in a server-rendered nav, but Nav is reused across both
// server and client pages — easier to make the auth-aware bit a
// client island that uses useSession.

import { useSession } from "next-auth/react";

export function AuthNavLink() {
  const { data: session } = useSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (session?.user as any)?.role;
  if (!session?.user) {
    return (
      <a
        href="/auth/signin"
        style={{ fontSize: 12, color: "#888", textDecoration: "none" }}
      >
        Sign in
      </a>
    );
  }
  return (
    <a
      href={role === "employer" ? "/dashboard/employer" : "/dashboard/candidate"}
      style={{ fontSize: 12, color: "#888", textDecoration: "none" }}
    >
      Dashboard
    </a>
  );
}
