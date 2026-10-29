import "server-only";
import { env } from "./env";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

const UUID = z.string().uuid();

/**
 * Database lock helpers. PostgreSQL row locks are held until
 * transaction end; they are all acquired inside the same interactive
 * transaction in a documented deterministic order (see TRD §8.2):
 *
 *   1. idempotency reservation (unique index, no lock wait)
 *   2. Domain row — FOR SHARE by mutating operations (scores, imports,
 *      membership changes) so a concurrent archive/restore (FOR UPDATE)
 *      blocks or is blocked cleanly.
 *   3. DomainMembership rows — FOR UPDATE, ascending id order.
 *   4. GlobalRoleAssignment rows — FOR UPDATE (last-president guard).
 *   5. writes + audit + idempotency completion.
 *   6. commit releases everything together.
 */

/** Transaction-local Postgres timeout knobs, under the HTTP deadline. */
export async function setTransactionTimeouts(tx: Prisma.TransactionClient) {
  const { LOCK_TIMEOUT_MS, STATEMENT_TIMEOUT_MS } = env();
  // Both numbers are validated as integers by the env schema in lib/env.ts,
  // so interpolation is safe here (no caller-supplied strings involved).
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
}

/** Row-level lock on a single domain row in the requested mode. */
export async function lockDomain(
  tx: Prisma.TransactionClient,
  domainId: string,
  mode: "share" | "update",
): Promise<void> {
  const id = UUID.parse(domainId);
  if (mode === "share") {
    await tx.$queryRaw`SELECT id FROM "Domain" WHERE id = ${id} FOR SHARE`;
  } else {
    await tx.$queryRaw`SELECT id FROM "Domain" WHERE id = ${id} FOR UPDATE`;
  }
}

/**
 * Lock the requested membership rows in ascending id order in one
 * statement (deadlock avoidance for bulk work).
 */
export async function lockMembershipsSorted(
  tx: Prisma.TransactionClient,
  membershipIds: string[],
): Promise<void> {
  const ids = [...new Set(membershipIds)]
    .filter((v) => UUID.safeParse(v).success)
    .sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "DomainMembership" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
}

/** Lock global role rows for the named staff accounts (sorted). */
export async function lockGlobalRolesFor(
  tx: Prisma.TransactionClient,
  staffAccountIds: string[],
): Promise<void> {
  const ids = [...new Set(staffAccountIds)]
    .filter((v) => UUID.safeParse(v).success)
    .sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "GlobalRoleAssignment" WHERE "staffAccountId" = ANY(${ids}::text[]) AND "revokedAt" IS NULL ORDER BY id FOR UPDATE`;
}

const DEADLOCK_CODES = new Set(["P2034", "40P01", "55P03"]);

/** True when the failure is a recognized transient serialization/lock error. */
export function isTransientDbError(error: unknown): boolean {
  const pErr = error as { code?: string } | null;
  const code = typeof pErr?.code === "string" ? pErr.code : undefined;
  // P2034 covers conflicts/timeouts in Prisma transactions; P2028 is "tx failed" wrapper.
  return code === "P2034" || code === "P2028" || DEADLOCK_CODES.has(`SQLSTATE ${code ?? ""}`) || code === "40P01" || code === "55P03";
}

export const TX_OPTIONS: { maxWait: number; timeout: number } = {
  maxWait: 3000,
  timeout: 10000,
};
