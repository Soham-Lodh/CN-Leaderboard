import "server-only";
import { prisma } from "../db";
import { adjustScoreSchema } from "../validation";
import { canAccessDomain, canAssignPoints } from "../auth/policy";
import type { StaffContext } from "../auth/session";
import { fail, ok, zodToResult, type ActionResult } from "../errors";
import { logger } from "../logger";
import { requestHash } from "../ids";
import {
  isTransientDbError,
  lockDomain,
  lockMembersSorted,
  lockMembershipsSorted,
  setTransactionTimeouts,
  TX_OPTIONS,
} from "../locking";
import { sleepMs } from "../sleep";

/**
 * Score adjustment — append-only ledger with a transactional balance
 * (PRD FR-26..29, TRD §8).
 *
 * Observable guarantees enforced here:
 *  1. ScoreEntry insert, balance increment, audit event and idempotency
 *     record commit or roll back together.
 *  2. Retrying a timed-out request with the same idempotency key and
 *     payload returns the original committed result; the same key with a
 *     different payload conflicts and applies nothing.
 *  3. Concurrent adjustments never lose points (row lock + atomic
 *     increment, never read-then-overwrite).
 *  4. Domain archive vs score race resolves consistently: scoring takes
 *     a FOR SHARE lock on the domain, archive takes FOR UPDATE.
 */
export interface AdjustScoreInput {
  membershipId: string;
  delta: number;
  reason: string | null;
  idempotencyKey: string;
  source: "MANUAL" | "IMPORT" | "CORRECTION";
}

export interface AdjustScoreResult {
  membershipId: string;
  currentPoints: number;
  balanceAfter: number;
  replayed: boolean;
}

const MAX_RETRIES = 2;

export async function validateScoreInput(raw: unknown): Promise<
  { ok: true; data: AdjustScoreInput } | { ok: false; result: ActionResult<never> }
> {
  const parsed = adjustScoreSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, result: zodToResult(parsed.error) };
  return { ok: true, data: { ...parsed.data, source: "MANUAL" } };
}

export async function adjustScore(
  ctx: StaffContext,
  input: AdjustScoreInput,
  corrId: string,
): Promise<ActionResult<AdjustScoreResult>> {
  // Global leadership administers domains and reviews scoring; only the
  // assigned domain lead/co-lead may create score events.
  // Authorize before opening the transaction.
  const membership = await prisma.domainMembership.findUnique({
    where: { id: input.membershipId },
    select: { id: true, domainId: true, status: true, member: { select: { archivedAt: true } } },
  });
  if (!membership) return fail("NOT_FOUND", "Membership not found");
  if (!canAssignPoints(ctx, membership.domainId)) {
    return fail("FORBIDDEN", "You are not assigned to this domain");
  }
  const domainId = membership.domainId;

  const hash = requestHash({
    operation: "SCORE_ADJUSTED",
    membershipId: input.membershipId,
    delta: input.delta,
    reason: input.reason,
    source: input.source,
    actor: ctx.staffAccountId,
  });

  let attempt = 0;
  for (;;) {
    try {
      const result = await runScoreTransaction(ctx, domainId, input, hash, corrId);
      return result;
    } catch (error) {
      if (error instanceof ReplaySignal) return error.result;
      if (error instanceof IdemConflictSignal) return error.result;
      if (error instanceof InternalConflictSignal) return error.result;
      if (isTransientDbError(error) && attempt < MAX_RETRIES) {
        attempt += 1;
        const jitter = new Date().getUTCMilliseconds() * (attempt + 1);
        logger.warn("scoring.retry", { corrId, attempt, domainId: domainId });
        await sleepMs(50 * attempt + jitter);
        continue;
      }
      if (isTransientDbError(error)) {
        logger.error("scoring.retry.exhausted", { corrId, domainId }, error);
        return fail("CONFLICT", "The change is taking too long under load. Please retry.");
      }
      throw error;
    }
  }
}

/** Open/complete the idempotency reservation and perform the scored write. */
async function runScoreTransaction(
  ctx: StaffContext,
  domainId: string,
  input: AdjustScoreInput,
  hash: string,
  corrId: string,
): Promise<ActionResult<AdjustScoreResult>> {
  return prisma.$transaction(async (tx) => {
    await setTransactionTimeouts(tx);

    // 1. Reserve the idempotency key (documented scope: actor + key + op).
    const stored = await tx.idempotencyRecord.findUnique({
      where: {
        actorStaffAccountId_key_operation: {
          actorStaffAccountId: ctx.staffAccountId,
          key: input.idempotencyKey,
          operation: "SCORE_ADJUSTED",
        },
      },
    });
    if (stored) {
      if (stored.requestHash !== hash) {
        throw new IdemConflictSignal(fail("IDEMPOTENCY_CONFLICT", "This idempotency key was used for a different request"));
      }
      if (stored.status === "COMMITTED") {
        const response = stored.response as { currentPoints: number; balanceAfter: number } | null;
        if (response) {
          throw new ReplaySignal(
            ok({
              membershipId: input.membershipId,
              currentPoints: response.currentPoints,
              balanceAfter: response.balanceAfter,
              replayed: true,
            }),
          );
        }
        throw new InternalConflictSignal(fail("CONFLICT", "Request already committed"));
      }
      // Reserved previously but never committed (e.g. prior timeout): reuse it.
    } else {
      await tx.idempotencyRecord.create({
        data: {
          actorStaffAccountId: ctx.staffAccountId,
          key: input.idempotencyKey,
          operation: "SCORE_ADJUSTED",
          requestHash: hash,
          status: "RESERVED",
        },
      });
    }

    // 2. Domain lifecycle lock — FOR SHARE blocks a concurrent archive.
    await lockDomain(tx, domainId, "share");

    // 2b. Lock the Member row BEFORE the membership row (hierarchy level
    // 4 before 5): a concurrent archive/restore of this member now
    // serializes on the member commit instead of racing this write.
    const memberId = await tx.domainMembership
      .findUnique({
        where: { id: input.membershipId },
        select: { memberId: true },
      })
      .then((m) => (m ? m.memberId : null));
    if (memberId) {
      await lockMembersSorted(tx, [memberId]);
    }

    // 3. Lock + verify target membership state.
    await lockMembershipsSorted(tx, [input.membershipId]);
    const target = await tx.domainMembership.findUnique({
      where: { id: input.membershipId },
      select: { id: true, status: true, domainId: true, currentPoints: true, member: { select: { archivedAt: true } } },
    });
    if (!target) return fail("NOT_FOUND", "Membership not found");
    if (target.status !== "ACTIVE") return fail("CONFLICT", "Membership is not active");
    if (target.member?.archivedAt) return fail("CONFLICT", "Member is archived");

    // 4. Atomic increment + ledger entry + audit, one short transaction.
    const before = target.currentPoints;
    const updated = await tx.domainMembership.update({
      where: { id: target.id },
      data: { currentPoints: { increment: input.delta }, version: { increment: 1 } },
      select: { currentPoints: true },
    });
    const balanceAfter = updated.currentPoints;

    const entry = await tx.scoreEntry.create({
      data: {
        domainMembershipId: target.id,
        delta: input.delta,
        balanceAfter,
        reason: input.reason,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        source: input.source,
        idempotencyKey: input.idempotencyKey,
      },
    });

    await tx.auditEvent.create({
      data: {
        action: "SCORE_ADJUSTED",
        targetType: "ScoreEntry",
        targetId: entry.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        domainId: domainId,
        beforeState: { points: before },
        afterState: { points: balanceAfter, delta: input.delta },
        requestId: corrId,
        metadata: { source: input.source, reason: input.reason ?? null },
      },
    });

    const responsePayload = { currentPoints: balanceAfter, balanceAfter } as const;
    await tx.idempotencyRecord.update({
      where: {
        actorStaffAccountId_key_operation: {
          actorStaffAccountId: ctx.staffAccountId,
          key: input.idempotencyKey,
          operation: "SCORE_ADJUSTED",
        },
      },
      data: { status: "COMMITTED", response: responsePayload },
    });

    return ok({
      membershipId: target.id,
      currentPoints: balanceAfter,
      balanceAfter,
      replayed: false,
    });
  }, TX_OPTIONS);
}

/** Replay across attempts is carried by signals inside the callback. */
class ReplaySignal extends Error {
  constructor(public readonly result: ActionResult<AdjustScoreResult>) {
    super("score.replay");
  }
}

class IdemConflictSignal extends Error {
  constructor(public readonly result: ActionResult<AdjustScoreResult>) {
    super("score.idempotency_conflict");
  }
}

class InternalConflictSignal extends Error {
  constructor(public readonly result: ActionResult<AdjustScoreResult>) {
    super("score.conflict");
  }
}

export interface LedgerEntryDto {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string | null;
  source: string;
  actorName: string;
  createdAt: string;
}

/** Full scoring history for one membership (staff only). */
export async function getMembershipLedger(
  ctx: StaffContext,
  membershipId: string,
): Promise<ActionResult<{ entries: LedgerEntryDto[]; memberName: string }>> {
  const membership = await prisma.domainMembership.findUnique({
    where: { id: membershipId },
    select: {
      id: true,
      domainId: true,
      member: { select: { name: true } },
    },
  });
  if (!membership) return fail("NOT_FOUND", "Membership not found");
  if (!canAccessDomain(ctx, membership.domainId).allowed) {
    return fail("FORBIDDEN", "You are not assigned to this domain");
  }

  const entries = await prisma.scoreEntry.findMany({
    where: { domainMembershipId: membershipId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      delta: true,
      balanceAfter: true,
      reason: true,
      source: true,
      createdAt: true,
      actorStaffAccount: { select: { displayName: true, email: true } },
    },
  });

  return ok({
    memberName: membership.member.name,
    entries: entries.map((e) => ({
      id: e.id,
      delta: e.delta,
      balanceAfter: e.balanceAfter,
      reason: e.reason,
      source: e.source,
      actorName: e.actorStaffAccount.displayName ?? e.actorStaffAccount.email,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
