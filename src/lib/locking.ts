import "server-only";
import { env } from "./env";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

const UUID = z.string().uuid();

/**
 * Database lock helpers — the one documented, globally consistent
 * locking protocol for every mutation service (strict 2PL, TRD §8.2).
 *
 * Lock hierarchy — every transaction that needs more than one resource
 * acquires them in exactly this order (ascending, never re-ordered,
 * never revisited):
 *
 *   1. Advisory guard locks (transaction-scoped, e.g. the last-President
 *      counter guard). Always first if used at all.
 *   2. Idempotency reservation row (via the unique index; create/wait
 *      behavior inside the services).
 *   3. Domain row — FOR UPDATE for lifecycle operations (archive,
 *      restore, rename), FOR SHARE for mutations that only require the
 *      domain not to be archived concurrently.
 *   4. Member rows — FOR UPDATE, ascending id order.
 *   5. DomainMembership rows — FOR UPDATE, ascending id order.
 *   6. GlobalRoleAssignment rows — FOR UPDATE, ascending id order.
 *   7. Writes, audit events, idempotency completion.
 *
 * Growing phase: acquire the locks above once, in order, deduplicating
 * and sorting identifiers deterministically. Shrinking phase: PostgreSQL
 * transactional row locks are held until COMMIT/ROLLBACK — they are
 * released in a single phase by ending the transaction; services never
 * "unlock mid-flight" and never run non-database work (spreadsheet
 * parsing, HTTP, user interaction) between acquiring locks and commit.
 * Every transaction sets lock_timeout and statement_timeout so no lock
 * wait is ever unlimited and no timeout can outlive the HTTP request.
 *
 * Timeout relationship (validated in lib/env.ts):
 *   LOCK_TIMEOUT_MS (2s)  <  STATEMENT_TIMEOUT_MS (8s)
 *   < Prisma transaction timeout (10s); Prisma maxWait 3s guards the
 *   connection acquisition itself.
 *
 * After waiting on a lock, services must RE-READ the locked rows before
 * making invariant-dependent decisions — never rely on pre-lock reads.
 */

/** Transaction-local Postgres timeout knobs, under the HTTP deadline. */
export async function setTransactionTimeouts(tx: Prisma.TransactionClient) {
  const { LOCK_TIMEOUT_MS, STATEMENT_TIMEOUT_MS } = env();
  // Both numbers are validated as integers by the env schema in lib/env.ts,
  // so interpolation is safe here (no caller-supplied strings involved).
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
}

/**
 * Row-level lock on a single domain row in the requested mode.
 * Mode semantics:
 *  - "update": exclusive lifecycle intent (archive/restore/rename).
 *  - "share":  the caller only needs the domain to stay un-archived;
 *              blocks a concurrent archive (which needs FOR UPDATE).
 */
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
 * Lock Member rows in ascending id order in one statement (deadlock
 * avoidance for bulk work). Duplicates removed; invalid ids ignored.
 * Positioned at level 4 of the hierarchy: before memberships, always.
 */
export async function lockMembersSorted(
  tx: Prisma.TransactionClient,
  memberIds: string[],
): Promise<void> {
  const ids = [...new Set(memberIds)]
    .filter((v) => UUID.safeParse(v).success)
    .sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "Member" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
}

/**
 * Lock the requested membership rows in ascending id order in one
 * statement (deadlock avoidance for bulk work). Positioned at level 5.
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

/** Lock global role rows for the named staff accounts (sorted). Level 6. */
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

/**
 * Constant key for the chapter-level advisory guard serializing the
 * "exactly one+ active President" invariant. Type/level locks cannot
 * express this global counter, so all global-role mutations take this
 * transaction-scoped advisory lock at hierarchy level 1 before touching
 * any other resource. Its wait is bounded by lock_timeout like any row
 * lock; the transaction releases it at commit/rollback.
 */
const PRESIDENT_GUARD_KEY = 3534457789n; // fixed numeric key, "<- last-President guard"

export async function acquirePresidentGuard(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PRESIDENT_GUARD_KEY}::bigint)`;
}

const PG_TRANSIENT_CODES = new Set([
  "40P01", // deadlock_detected
  "55P03", // lock_not_available (lock timeout)
  "40001", // serialization_failure
  "57014", // query_canceled / statement_timeout
]);

const PRISMA_TRANSIENT_CODES = new Set(["P2034"]); // Prisma tx conflict/timeout

/** Collect the P-code/SQLSTATE chain of an error (incl. wrapped causes). */
function collectCodes(error: unknown, depth = 0): string[] {
  if (depth > 4 || error === null || typeof error !== "object") return [];
  const e = error as { code?: unknown; message?: unknown; cause?: unknown };
  const codes: string[] = [];
  if (typeof e.code === "string" && e.code.length > 0) codes.push(e.code);
  const message = typeof e.message === "string" ? e.message : "";
  for (const pg of PG_TRANSIENT_CODES) {
    if (message.includes(pg)) codes.push(pg);
  }
  if (e.cause !== undefined) codes.push(...collectCodes(e.cause, depth + 1));
  return codes;
}

/**
 * True only for genuinely transient serialization/deadlock/lock-timeout
 * failures. Deliberately NOT true for arbitrary Prisma transaction
 * failures (P2028 wraps deterministic callback errors too) — blind
 * retries there would duplicate non-idempotent work.
 */
export function isTransientDbError(error: unknown): boolean {
  const codes = collectCodes(error);
  return codes.some((c) => PRISMA_TRANSIENT_CODES.has(c) || PG_TRANSIENT_CODES.has(c));
}

/** True when the failure is a unique-constraint violation (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  const codes = collectCodes(error);
  return codes.includes("P2002");
}

export const TX_OPTIONS: { maxWait: number; timeout: number } = {
  maxWait: 3000,
  timeout: 10000,
};

/**
 * Reservations older than this are treated as abandoned (e.g. process
 * crash after reserve); services reuse them instead of treating them as
 * in-flight. Committed reservations are permanent by design.
 */
export const RESERVATION_STALE_MS = 5 * 60 * 1000;
