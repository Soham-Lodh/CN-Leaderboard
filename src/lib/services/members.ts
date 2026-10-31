import "server-only";
import { prisma } from "../db";
import { invalidatePublicCaches } from "../cache";
import { recordAudit } from "../audit";
import {
  isUniqueViolation,
  lockDomain,
  lockMembersSorted,
  lockMembershipsSorted,
  setTransactionTimeouts,
  TX_OPTIONS,
} from "../locking";
import { canAccessDomain, canManageGlobal } from "../auth/policy";
import type { StaffContext } from "../auth/session";
import { fail, zodToResult, ok, type ActionResult } from "../errors";
import { ZodError } from "zod";
import { memberInputSchema } from "../validation";
import { requestHash } from "../ids";
import { NotFoundSignal, mapDbWriteError } from "./domains";

export interface MembershipBadgeDto {
  domainId: string;
  domainName: string;
  domainSlug: string;
  status: "ACTIVE" | "REMOVED";
  points: number;
}

export interface MemberRowDto {
  id: string;
  name: string;
  rollNumber: string;
  archivedAt: string | null;
  memberships: MembershipBadgeDto[];
}

export interface PeopleListResult {
  rows: MemberRowDto[];
  page: number;
  pageSize: number;
  total: number;
}

export async function listPeople(
  ctx: StaffContext,
  q: string | undefined,
  page: number,
): Promise<PeopleListResult> {
  if (!canManageGlobal(ctx)) throw new Error("FORBIDDEN");
  const pageSize = 20;
  const search = q && q.trim().length > 0 ? { OR: [{ name: { contains: q.trim(), mode: "insensitive" as const } }, { normalizedRollNumber: { contains: q.trim().toUpperCase() } }] } : undefined;

  const [rows, total] = await Promise.all([
    prisma.member.findMany({
      where: search,
      orderBy: [{ name: "asc" }, { normalizedRollNumber: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        rollNumber: true,
        archivedAt: true,
        memberships: {
          select: {
            status: true,
            currentPoints: true,
            domain: { select: { id: true, name: true, slug: true, archivedAt: true } },
          },
        },
      },
    }),
    prisma.member.count({ where: search }),
  ]);

  return {
    page,
    pageSize,
    total,
    rows: rows.map((m) => ({
      id: m.id,
      name: m.name,
      rollNumber: m.rollNumber,
      archivedAt: m.archivedAt ? m.archivedAt.toISOString() : null,
      memberships: m.memberships
        .filter((ms) => ms.domain.archivedAt === null)
        .map((ms) => ({
          domainId: ms.domain.id,
          domainName: ms.domain.name,
          domainSlug: ms.domain.slug,
          status: ms.status,
          points: ms.currentPoints,
        })),
    })),
  };
}

export interface AddMemberResult {
  memberId: string;
  membershipId: string;
  /** An existing Member row was reused (possibly restored). */
  reusedMember: boolean;
  /** An existing REMOVED membership was restored instead of created. */
  restoredMembership: boolean;
  replayed: boolean;
}

/**
 * Add a member with a membership in one domain.
 *
 * Concurrency + idempotency:
 *  - Reserves the idempotency key (actor + key + "MEMBER_ADDED") first;
 *    a retried request with the same payload replays the committed
 *    result, a same-key/different-payload request conflicts.
 *  - Follows the lock hierarchy: domain FOR SHARE -> Member FOR UPDATE
 *    (when it exists) -> DomainMembership FOR UPDATE; state is re-read
 *    after each lock wait.
 *  - Concurrent manual adds of the same roll number resolve to one
 *    Member row; the loser's transaction retries once and restores/
 *    joins cleanly instead of surfacing a raw constraint error.
 */
export async function addMemberWithMembership(
  ctx: StaffContext,
  domainId: string,
  raw: unknown,
  corrId: string,
  idempotencyKey?: string,
): Promise<ActionResult<AddMemberResult>> {
  const access = canAccessDomain(ctx, domainId);
  if (!access.allowed) return fail("FORBIDDEN", "You are not assigned to this domain");
  const parsed = memberInputSchema.safeParse(raw);
  if (!parsed.success) return zodToResult(parsed.error as ZodError);
  const { name, rollNumber } = parsed.data;

  const keyPattern = /^[0-9a-f-]{8,72}$/i;
  const key = idempotencyKey && keyPattern.test(idempotencyKey)
    ? idempotencyKey
    : `am-${crypto.randomUUID()}`;
  const hash = requestHash({
    operation: "MEMBER_ADDED",
    actor: ctx.staffAccountId,
    domainId,
    name,
    rollNumber,
  });

  let attempt = 0;
  for (;;) {
    try {
      const result = await runAddMemberTransaction(ctx, domainId, name, rollNumber, key, hash, corrId);
      invalidatePublicCaches([domainId]);
      return result;
    } catch (error) {
      if (error instanceof NotFoundSignal) {
        return fail("NOT_FOUND", error.message);
      }
      // Two simultaneous creations race on the Member unique index; the
      // loser retries once and resolves via the winner's committed row.
      if (isUniqueViolation(error) && attempt < 1) {
        attempt += 1;
        continue;
      }
      return mapDbWriteError(error);
    }
  }
}

async function runAddMemberTransaction(
  ctx: StaffContext,
  domainId: string,
  name: string,
  rollNumber: string,
  key: string,
  hash: string,
  corrId: string,
): Promise<ActionResult<AddMemberResult>> {
  return prisma.$transaction(async (tx) => {
    await setTransactionTimeouts(tx);

    // 1. Idempotency reservation (one logical manual addition).
    const stored = await tx.idempotencyRecord.findUnique({
      where: {
        actorStaffAccountId_key_operation: {
          actorStaffAccountId: ctx.staffAccountId,
          key,
          operation: "MEMBER_ADDED",
        },
      },
    });
    if (stored) {
      if (stored.requestHash !== hash) {
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "This idempotency key was used for a different request",
        );
      }
      if (stored.status === "COMMITTED") {
        const response = stored.response as AddMemberResult | null;
        if (response) return ok({ ...response, replayed: true });
      }
      // RESERVED previously (timed out/abandoned): reuse it.
    } else {
      await tx.idempotencyRecord.create({
        data: {
          actorStaffAccountId: ctx.staffAccountId,
          key,
          operation: "MEMBER_ADDED",
          requestHash: hash,
          status: "RESERVED",
        },
      });
    }

    // 2. Domain lifecycle lock; the domain must still exist and be active.
    await lockDomain(tx, domainId, "share");
    const domain = await tx.domain.findUnique({
      where: { id: domainId },
      select: { id: true, archivedAt: true },
    });
    if (!domain) return fail("NOT_FOUND", "Domain not found");
    if (domain.archivedAt) return fail("CONFLICT", "This domain is archived. Restore it first.");

    // 3. Resolve + lock the Member row (hierarchy level 4).
    let member = await tx.member.findUnique({ where: { normalizedRollNumber: rollNumber } });
    const reusedMember = member !== null;
    if (member) {
      await lockMembersSorted(tx, [member.id]);
      // Re-read after the lock wait: an archive/restore may have landed.
      member = await tx.member.findUnique({ where: { id: member!.id } });
      if (member && member.archivedAt) {
        member = await tx.member.update({
          where: { id: member.id },
          data: { archivedAt: null, updatedById: ctx.staffAccountId },
        });
        await recordAudit(tx, {
          action: "MEMBER_RESTORED",
          targetType: "Member",
          targetId: member.id,
          actorStaffAccountId: ctx.staffAccountId,
          actorEmailSnapshot: ctx.email,
          domainId,
          requestId: corrId,
        });
      }
    }
    if (!member) {
      member = await tx.member.create({
        data: {
          name,
          rollNumber,
          normalizedRollNumber: rollNumber,
          createdById: ctx.staffAccountId,
        },
      });
      await recordAudit(tx, {
        action: "MEMBER_CREATED",
        targetType: "Member",
        targetId: member.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        domainId,
        afterState: { name, rollNumber },
        requestId: corrId,
      });
    }

    // 4. Resolve + lock the existing membership (level 5), then decide.
    const membershipId = await lockMembershipForMember(tx, domainId, member.id);
    const membership = membershipId
      ? await tx.domainMembership.findUnique({ where: { id: membershipId } })
      : null;

    if (membership?.status === "ACTIVE") {
      return fail("CONFLICT", `“${member.name}” is already an active member of this domain.`);
    }

    if (membership) {
      // Previously REMOVED: restore it — never duplicate the row.
      await tx.domainMembership.update({
        where: { id: membership.id },
        data: { status: "ACTIVE", removedAt: null, removedById: null },
      });
      await recordAudit(tx, {
        action: "MEMBERSHIP_RESTORED",
        targetType: "DomainMembership",
        targetId: membership.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        domainId,
        beforeState: { status: membership.status },
        afterState: { status: "ACTIVE" },
        requestId: corrId,
      });
      const response: AddMemberResult = {
        memberId: member.id,
        membershipId: membership.id,
        reusedMember,
        restoredMembership: true,
        replayed: false,
      };
      await markIdempotencyCommitted(tx, ctx.staffAccountId, key, response);
      return ok(response);
    }

    const created = await tx.domainMembership.create({
      data: {
        domainId,
        memberId: member.id,
        status: "ACTIVE",
        createdById: ctx.staffAccountId,
      },
    });
    await recordAudit(tx, {
      action: "MEMBERSHIP_ADDED",
      targetType: "DomainMembership",
      targetId: created.id,
      actorStaffAccountId: ctx.staffAccountId,
      actorEmailSnapshot: ctx.email,
      domainId,
      afterState: { memberId: member.id, rollNumber },
      requestId: corrId,
    });
    const response: AddMemberResult = {
      memberId: member.id,
      membershipId: created.id,
      reusedMember,
      restoredMembership: false,
      replayed: false,
    };
    await markIdempotencyCommitted(tx, ctx.staffAccountId, key, response);
    return ok(response);
  }, TX_OPTIONS);
}

/** Lock the (domain, member) membership row, returning its id, if any. */
async function lockMembershipForMember(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  domainId: string,
  memberId: string,
): Promise<string | null> {
  const found = await tx.domainMembership.findUnique({
    where: { domainId_memberId: { domainId, memberId } },
    select: { id: true },
  });
  if (!found) return null;
  await lockMembershipsSorted(tx, [found.id]);
  return found.id;
}

async function markIdempotencyCommitted(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  actorStaffAccountId: string,
  key: string,
  response: AddMemberResult,
): Promise<void> {
  await tx.idempotencyRecord.update({
    where: {
      actorStaffAccountId_key_operation: {
        actorStaffAccountId,
        key,
        operation: "MEMBER_ADDED",
      },
    },
    data: { status: "COMMITTED", response: response as unknown as object },
  });
}

export interface DomainMemberRow {
  membershipId: string;
  memberId: string;
  name: string;
  rollNumber: string;
  points: number;
  status: "ACTIVE" | "REMOVED";
  memberArchived: boolean;
}

export async function listDomainMembers(domainId: string): Promise<DomainMemberRow[]> {
  const members = await prisma.domainMembership.findMany({
    where: { domainId },
    select: {
      id: true,
      status: true,
      currentPoints: true,
      member: { select: { id: true, name: true, rollNumber: true, archivedAt: true } },
    },
    orderBy: [{ status: "asc" }, { currentPoints: "desc" }, { member: { name: "asc" } }],
  });
  return members
    .filter((m) => m.member.archivedAt === null)
    .map((m) => ({
      membershipId: m.id,
      memberId: m.member.id,
      name: m.member.name,
      rollNumber: m.member.rollNumber,
      points: m.currentPoints,
      status: m.status,
      memberArchived: false as const,
    }));
}

/** Rename a member; any domain manager of a domain the member is active in may act. */
export async function renameMember(
  ctx: StaffContext,
  membershipId: string,
  rawName: unknown,
  corrId: string,
): Promise<ActionResult<{ memberId: string; name: string }>> {
  const parsed = memberInputSchema.shape.name.safeParse(rawName);
  if (!parsed.success) return zodToResult(parsed.error as ZodError);
  if (!/^[0-9a-f-]{36}$/i.test(membershipId)) return fail("VALIDATION_ERROR", "Invalid membership id");

  try {
    // Resolve membership -> member first (plain read for authorization).
    const membership = await prisma.domainMembership.findUnique({
      where: { id: membershipId },
      select: { id: true, domainId: true, memberId: true },
    });
    if (!membership || !canAccessDomain(ctx, membership.domainId).allowed) {
      return fail("NOT_FOUND", "Membership not found");
    }

    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      // Lock the Member row (level 4): two renames through different
      // memberships of the same member serialize here (no lost update).
      await lockMembersSorted(tx, [membership.memberId]);
      await lockMembershipsSorted(tx, [membership.id]);
      const member = await tx.member.findUnique({ where: { id: membership.memberId } });
      if (!member) throw new NotFoundSignal("Member not found");
      const before = member.name;
      const updated = await tx.member.update({
        where: { id: member.id },
        data: { name: parsed.data, updatedById: ctx.staffAccountId },
      });
      await recordAudit(tx, {
        action: "MEMBER_UPDATED",
        targetType: "Member",
        targetId: updated.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        domainId: membership.domainId,
        beforeState: { name: before },
        afterState: { name: parsed.data },
        requestId: corrId,
      });
      return { memberId: updated.id, name: updated.name };
    }, TX_OPTIONS);

    invalidatePublicCaches([]);
    return ok({ memberId: result.memberId, name: result.name });
  } catch (error) {
    if (error instanceof NotFoundSignal) return fail("NOT_FOUND", "Membership not found");
    return mapDbWriteError(error);
  }
}

/** Remove a membership; other-domain memberships untouched, ledger kept. */
export async function setMembershipStatus(
  ctx: StaffContext,
  membershipId: string,
  remove: boolean,
  corrId: string,
): Promise<ActionResult<{ membershipId: string; status: "ACTIVE" | "REMOVED" }>> {
  if (!/^[0-9a-f-]{36}$/i.test(membershipId)) return fail("VALIDATION_ERROR", "Invalid membership id");
  try {
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      // Pre-read for authorization, then lock (level 5) and re-read.
      const found = await tx.domainMembership.findUnique({
        where: { id: membershipId },
        select: { id: true, domainId: true },
      });
      if (!found || !canAccessDomain(ctx, found.domainId).allowed) {
        throw new NotFoundSignal("Membership not found");
      }
      await lockMembershipsSorted(tx, [found.id]);
      const membership = await tx.domainMembership.findUnique({
        where: { id: found.id },
        select: {
          id: true,
          status: true,
          domainId: true,
          memberId: true,
          member: { select: { rollNumber: true } },
        },
      });
      if (!membership) throw new NotFoundSignal("Membership not found");
      const target: "ACTIVE" | "REMOVED" = remove ? "REMOVED" : "ACTIVE";
      if (membership.status === target) {
        return { membershipId: membership.id, status: membership.status, domainId: membership.domainId };
      }
      await tx.domainMembership.update({
        where: { id: membership.id },
        data: remove
          ? { status: "REMOVED", removedAt: new Date(), removedById: ctx.staffAccountId }
          : { status: "ACTIVE", removedAt: null, removedById: null },
      });
      await recordAudit(tx, {
        action: remove ? "MEMBERSHIP_REMOVED" : "MEMBERSHIP_RESTORED",
        targetType: "DomainMembership",
        targetId: membership.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        domainId: membership.domainId,
        beforeState: { status: membership.status },
        afterState: { status: target },
        requestId: corrId,
      });
      return {
        membershipId: membership.id,
        status: target,
        domainId: membership.domainId as string,
      };
    }, TX_OPTIONS);

    invalidatePublicCaches([result.domainId]);
    return ok({ membershipId: result.membershipId, status: result.status });
  } catch (error) {
    if (error instanceof NotFoundSignal) return fail("NOT_FOUND", "Membership not found");
    return mapDbWriteError(error);
  }
}

/** Archive/restore the member record (President/VP only). */
export async function setMemberArchived(
  ctx: StaffContext,
  memberId: string,
  archived: boolean,
  corrId: string,
): Promise<ActionResult<{ memberId: string; archivedAt: string | null }>> {
  if (!canManageGlobal(ctx)) return fail("FORBIDDEN", "Global leadership role required");
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) return fail("VALIDATION_ERROR", "Invalid member id");
  try {
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      // Lock the Member row (level 4) and re-read: archive vs score/
      // membership mutations now serialize deterministically.
      await lockMembersSorted(tx, [memberId]);
      const member = await tx.member.findUnique({ where: { id: memberId } });
      if (!member) throw new NotFoundSignal("Member not found");
      if ((member.archivedAt !== null) === archived) return member; // idempotent
      const updated = await tx.member.update({
        where: { id: memberId },
        data: archived ? { archivedAt: new Date() } : { archivedAt: null },
      });
      await recordAudit(tx, {
        action: archived ? "MEMBER_ARCHIVED" : "MEMBER_RESTORED",
        targetType: "Member",
        targetId: memberId,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        beforeState: { archivedAt: member.archivedAt ? member.archivedAt.toISOString() : null },
        afterState: { archivedAt: updated.archivedAt ? updated.archivedAt.toISOString() : null },
        requestId: corrId,
      });
      return updated;
    }, TX_OPTIONS);

    invalidatePublicCaches([]);
    return ok({ memberId, archivedAt: result.archivedAt ? result.archivedAt.toISOString() : null });
  } catch (error) {
    if (error instanceof NotFoundSignal) return fail("NOT_FOUND", "Member not found");
    return mapDbWriteError(error);
  }
}
