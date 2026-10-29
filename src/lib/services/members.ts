import "server-only";
import { prisma } from "../db";
import { invalidatePublicCaches } from "../cache";
import { recordAudit } from "../audit";
import { lockDomain, lockMembershipsSorted, setTransactionTimeouts, TX_OPTIONS } from "../locking";
import { canAccessDomain, canManageGlobal } from "../auth/policy";
import type { StaffContext } from "../auth/session";
import { fail, zodToResult, ok, type ActionResult } from "../errors";
import { ZodError } from "zod";
import { memberInputSchema } from "../validation";
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

/** Add a member with a membership in one domain (creator-scoped). */
export async function addMemberWithMembership(
  ctx: StaffContext,
  domainId: string,
  raw: unknown,
  corrId: string,
): Promise<ActionResult<{ memberId: string; membershipId: string; reusedMember: boolean }>> {
  const access = canAccessDomain(ctx, domainId);
  if (!access.allowed) return fail("FORBIDDEN", "You are not assigned to this domain");
  const parsed = memberInputSchema.safeParse(raw);
  if (!parsed.success) return zodToResult(parsed.error as ZodError);
  const { name, rollNumber } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      await lockDomain(tx, domainId, "share");
      const domain = await tx.domain.findUnique({ where: { id: domainId } });
      if (!domain || domain.archivedAt) throw new NotFoundSignal("Domain not found or archived");

      let member = await tx.member.findUnique({ where: { normalizedRollNumber: rollNumber } });
      let reusedMember = member !== null;
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
      } else if (member.archivedAt) {
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
        reusedMember = true;
      }

      const membership = await tx.domainMembership.create({
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
        targetId: membership.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        domainId,
        afterState: { memberId: member.id, rollNumber },
        requestId: corrId,
      });

      return { memberId: member.id, membershipId: membership.id, reusedMember };
    }, TX_OPTIONS);

    invalidatePublicCaches([domainId]);
    return ok(result);
  } catch (error) {
    if (error instanceof NotFoundSignal) return fail("NOT_FOUND", error.message);
    return mapDbWriteError(error);
  }
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
    where: { domainId, member: { archivedAt: null } },
    select: {
      id: true,
      status: true,
      currentPoints: true,
      member: { select: { id: true, name: true, rollNumber: true } },
    },
    orderBy: [{ status: "asc" }, { currentPoints: "desc" }, { member: { name: "asc" } }],
  });
  return members
    .map((m) => ({
      membershipId: m.id,
      memberId: m.member.id,
      name: m.member.name,
      rollNumber: m.member.rollNumber,
      points: m.currentPoints,
      status: m.status,
      memberArchived: false as const,
    }))
    .filter((m) => m.status === "ACTIVE");
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
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      await lockMembershipsSorted(tx, [membershipId]);
      const membership = await tx.domainMembership.findUnique({
        where: { id: membershipId },
        include: { member: true, domain: true },
      });
      if (!membership) throw new NotFoundSignal("Membership not found");
      if (!canAccessDomain(ctx, membership.domainId).allowed) {
        throw new NotFoundSignal("Membership not found");
      }
      const before = membership.member.name;
      const updated = await tx.member.update({
        where: { id: membership.memberId },
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
      return { memberId: updated.id, name: updated.name, domainId: membership.domainId };
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
      await lockMembershipsSorted(tx, [membershipId]);
      const membership = await tx.domainMembership.findUnique({
        where: { id: membershipId },
        select: {
          id: true,
          status: true,
          domainId: true,
          memberId: true,
          member: { select: { rollNumber: true } },
        },
      });
      if (!membership || !canAccessDomain(ctx, membership.domainId).allowed) {
        throw new NotFoundSignal("Membership not found");
      }
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
      const member = await tx.member.findUnique({ where: { id: memberId } });
      if (!member) throw new NotFoundSignal("Member not found");
      if ((member.archivedAt !== null) === archived) return member;
      const updated = await tx.member.update({
        where: { id: memberId },
        data: archived ? { archivedAt: new Date() } : { archivedAt: null, updatedById: undefined },
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
