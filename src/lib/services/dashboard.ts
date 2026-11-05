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

/**
 * The dashboard is rendered as independently streaming sections
 * (stats / your domains / recent activity), each with its own fetch so
 * one slow query never blocks the shell or the other sections.
 * Legacy consumers can still call getDashboardData for the combined
 * shape used before streaming (same data, same semantics).
 */

/** Pure — derived from the authenticated context, no DB access. */
export function dashboardRoleLabel(ctx: StaffContext): string {
  return ctx.globalRole
    ? ctx.globalRole === "PRESIDENT"
      ? "President"
      : "Vice President"
    : ctx.domainAssignments
          .map((a) => (a.role === "LEAD" ? "Lead" : "Co-lead"))
          .join(", ") || "Domain staff";
}

/** Domain cards + footer list: the viewer's domains with member counts. */
export async function getDashboardDomains(ctx: StaffContext): Promise<DashboardData["myDomains"]> {
  const myDomainsRaw = await prisma.domain.findMany({
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
  });

  return ctx.isGlobalLeader
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
}

/**
 * Stat cards. The total domain count is only displayed to global
 * leaders, so it is fetched only for them (member count always).
 * domainCount is null for scope staff.
 */
export async function getDashboardStats(
  ctx: StaffContext,
): Promise<{ activeMemberCount: number; domainCount: number | null }> {
  const global = ctx.isGlobalLeader;
  const [activeMemberCount, domainCount] = await Promise.all([
    prisma.domainMembership.count({ where: { status: "ACTIVE", member: { archivedAt: null } } }),
    global ? prisma.domain.count({ where: { archivedAt: null } }) : Promise.resolve(null),
  ]);
  return { activeMemberCount, domainCount };
}

/**
 * Recent audit events. Scope staff never see this section, so the
 * query is skipped entirely for them instead of fetching rows that
 * the UI then discards.
 */
export async function getDashboardRecentAudits(
  ctx: StaffContext,
): Promise<DashboardData["recentAudits"]> {
  if (!canManageGlobal(ctx)) return [];

  const recentEvents = await prisma.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, action: true, createdAt: true, domain: { select: { name: true } } },
  });

  return recentEvents.map((e) => ({
    id: e.id,
    action: e.action,
    createdAt: e.createdAt.toISOString(),
    domainName: e.domain?.name ?? null,
  }));
}

/** Combined shape, kept for compatibility (see note above). */
export async function getDashboardData(ctx: StaffContext): Promise<DashboardData> {
  const [domains, stats, recentAudits] = await Promise.all([
    getDashboardDomains(ctx),
    getDashboardStats(ctx),
    getDashboardRecentAudits(ctx),
  ]);

  return {
    global: ctx.isGlobalLeader,
    roleLabel: dashboardRoleLabel(ctx),
    domainCount: stats.domainCount ?? 0,
    activeMemberCount: stats.activeMemberCount,
    recentAudits,
    myDomains: domains,
  };
}
