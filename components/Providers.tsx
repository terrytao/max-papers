"use client";

// Wraps the app in NextAuth's SessionProvider so client components
// can use useSession. Mounted in app/layout.tsx.

import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
