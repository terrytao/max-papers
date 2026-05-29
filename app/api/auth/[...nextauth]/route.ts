// NextAuth.js catch-all route — handles signin / signout / callback /
// session / csrf endpoints. Config in lib/auth.ts.

import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
