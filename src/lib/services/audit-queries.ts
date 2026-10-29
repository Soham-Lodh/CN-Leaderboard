import "server-only";
import { prisma } from "../db";
import { canManageGlobal, readableDomainIds } from "../auth/policy";
import type { StaffContext } from "../auth/session";
import { fail, ok, type ActionResult } from "../errors";

/**
 * Audit reads: President/VP see everything; domain staff only see
 * events for their assigned domains. Always fresh reads — privileged
 * data is never placed in a shared cache.
 */
export interface AuditRowDto {
  id: string;
  action: string;
  actorName: string;
  targetType: string;
  targetId: string;
  domainName: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  requestId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditListResult {
  rows: AuditRowDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DomainAuditMemberRow {
  membershipId: string;
  memberId: string;
  name: string;
  rollNumber: string;
  points: number;
}

/** Current-points table for a domain audit page (scope enforced). */
export async function listDomainAuditMembers(
  ctx: StaffContext,
  domainId: string,
): Promise<ActionResult<{ domainName: string; rows: DomainAuditMemberRow[] }>> {
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, name: true },
  });
  if (!domain) return fail("NOT_FOUND", "Domain not found");
  if (!readableDomainIdsFor(ctx).has(domainId) && !canManageGlobal(ctx)) {
    return fail("FORBIDDEN", "You are not assigned to this domain");
  }

  const memberships = await prisma.domainMembership.findMany({
    where: { domainId, status: "ACTIVE", member: { archivedAt: null } },
    orderBy: [{ currentPoints: "desc" }, { member: { name: "asc" } }],
    select: {
      id: true,
      memberId: true,
      currentPoints: true,
      member: { select: { name: true, rollNumber: true } },
    },
  });

  return ok({
    domainName: domain.name,
    rows: memberships.map((m) => ({
      membershipId: m.id,
      memberId: m.memberId,
      name: m.member.name,
      rollNumber: m.member.rollNumber,
      points: m.currentPoints,
    })),
  });
}

function readableDomainIdsFor(ctx: StaffContext): Set<string> {
  return new Set(readableDomainIds(ctx, ctx.domainAssignments.map((a) => a.domainId)));
}

export async function listAuditEvents(
  ctx: StaffContext,
  domainId: string | null,
  page = 1,
  pageSize = 25,
): Promise<ActionResult<AuditListResult>> {
  if (!canManageGlobal(ctx) && !domainId) {
    // Domain staff w/ multiple assignments can pass a domain; otherwise
    // they must scope to one of their own domains.
    if (ctx.domainAssignments.length === 0) {
      return fail("FORBIDDEN", "Global leadership role required");
    }
    domainId = ctx.domainAssignments[0]?.domainId ?? null;
  } else if (domainId && !readableDomainIdsFor(ctx).has(domainId) && !canManageGlobal(ctx)) {
    return fail("FORBIDDEN", "You are not assigned to this domain");
  } else if (!domainId && canManageGlobal(ctx) && page === 1) {
    // no extra work: Presidents/VPs can read everything
  }

  const where = domainId ? { domainId } : {};

  const [total, events] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        domain: { select: { name: true } },
        beforeState: true,
        afterState: true,
        requestId: true,
        metadata: true,
        createdAt: true,
        actorStaffAccount: { select: { displayName: true, email: true } },
      },
    }),
  ]);

  return ok({
    page,
    pageSize,
    total,
    rows: events.map((e) => ({
      id: e.id,
      action: e.action,
      actorName: e.actorStaffAccount?.displayName ?? e.actorStaffAccount?.email ?? "system",
      targetType: e.targetType,
      targetId: e.targetId,
      domainName: e.domain?.name ?? null,
      beforeState: (e.beforeState ?? null) as Record<string, unknown> | null,
      afterState: (e.afterState ?? null) as Record<string, unknown> | null,
      requestId: e.requestId,
      metadata: (e.metadata ?? null) as Record<string, unknown> | null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
