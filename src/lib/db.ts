import "server-only";
import { PrismaClient } from "@prisma/client";

// PrismaClient reads `url`/`directUrl` from prisma/schema.prisma.
// DATABASE_URL is the pooled (pgbouncer) URL used at runtime; the Prisma
// CLI uses DIRECT_URL for migrations (see .env.example).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Keep transactions/queries bounded; raw per-transaction timeouts are
    // set with SET LOCAL inside src/lib/locking.ts.
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = PrismaClient;
