// Prisma 7 client singleton.
//
// Prisma 7 dropped `url = env(...)` inside schema.prisma — the runtime
// connection has to be passed to the constructor via an adapter. For
// direct Postgres (Neon) that's @prisma/adapter-pg.
//
// Cached on globalThis in dev so Next.js' HMR doesn't open a new
// connection per file change.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required (set in max-papers/.env)");
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
