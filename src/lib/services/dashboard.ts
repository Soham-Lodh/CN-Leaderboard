import "server-only";
import { prisma } from "../db";
import type { StaffContext } from "../auth/session";
import { canManageGlobal } from "../auth/policy";

/** Role-aware admin dashboard summaries. Always fresh (no cache). */
export interface DashboardData {
  global: boolean;
  roleLabel: string;
  domainCount: number;
  activeMemberCount: number;
  recentAudits: Array<{ id: string; action: string; createdAt: string; domainName: string | null }>;
  myDomains: Array<{ id: string; name: string; role: "LEAD" | "CO_LEAD" | null; members: number }>;
}

export async function getDashboardData(ctx: StaffContext): Promise<DashboardData> {
  const [domainCount, activeMembers, recentEvents, myDomainsRaw] = await Promise.all([
    prisma.domain.count({ where: { archivedAt: null } }),
    prisma.domainMembership.count({ where: { status: "ACTIVE", member: { archivedAt: null } } }),
    prisma.auditEvent.findMany({
      where: canManageGlobal(ctx)
        ? {}
        : { domainId: { in: ctx.domainAssignments.map((a) => a.domainId) } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, createdAt: true, domain: { select: { name: true } } },
    }),
    prisma.domain.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
        assignments: {
          where: { revokedAt: null, staffAccountId: ctx.staffAccountId },
          select: { role: true },
        },
      },
    }),
  ]);

  const roleLabel = ctx.globalRole
    ? ctx.globalRole === "PRESIDENT"
      ? "President"
      : "Vice President"
    : ctx.domainAssignments
          .map((a) => (a.role === "LEAD" ? "Lead" : "Co-lead"))
          .join(", ") || "Domain staff";

  const myDomains = ctx.isGlobalLeader
    ? myDomainsRaw.map((d) => ({
        id: d.id,
        name: d.name,
        role: d.assignments[0]?.role ?? null,
        members: d._count.memberships,
      }))
    : myDomainsRaw
        .filter((d) => ctx.domainAssignments.some((a) => a.domainId === d.id))
        .map((d) => ({
          id: d.id,
          name: d.name,
          role: d.assignments[0]?.role ?? null,
          members: d._count.memberships,
        }));

  return {
    global: ctx.isGlobalLeader,
    roleLabel,
    domainCount,
    activeMemberCount: activeMembers,
    recentAudits: canManageGlobal(ctx) ? recentEvents.map((e) => ({
      id: e.id,
      action: e.action,
      createdAt: e.createdAt.toISOString(),
      domainName: e.domain?.name ?? null,
    })) : [],
    myDomains,
  };
}
