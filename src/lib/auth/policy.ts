import type { StaffContext } from "./session";

/**
 * Pure authorization rules — the single source of truth for what each
 * staff role may do. Unit-tested in tests/unit/policy.test.ts and
 * enforced by the guards and services below; UI hiding is not a control.
 */
import type { DomainRole, GlobalRole } from "@prisma/client";

export interface DomainRef {
  id: string;
}

export type DomainAccess =
  | { allowed: true; scope: "global" | "assigned"; role: GlobalRole | DomainRole }
  | { allowed: false };

/** President/VP have global access to every domain. */
export function canManageGlobal(ctx: StaffContext): boolean {
  return ctx.isGlobalLeader;
}

/**
 * Domain access for a specific domain id. Global leaders always pass;
 * domain staff pass only via an ACTIVE assignment for that domain.
 */
export function canAccessDomain(ctx: StaffContext, domainId: string): DomainAccess {
  if (ctx.isGlobalLeader && ctx.globalRole) {
    return { allowed: true, scope: "global", role: ctx.globalRole };
  }
  const assignment = ctx.domainAssignments.find((a) => a.domainId === domainId);
  if (assignment) {
    return { allowed: true, scope: "assigned", role: assignment.role };
  }
  return { allowed: false };
}

/** Domain-scoped writes (scores, membership changes, import/export). */
export function canWriteDomain(ctx: StaffContext, domainId: string): boolean {
  return !ctx.isGlobalLeader && canAccessDomain(ctx, domainId).allowed;
}

export function canAssignPoints(ctx: StaffContext, domainId: string): boolean {
  return !ctx.isGlobalLeader && canAccessDomain(ctx, domainId).allowed;
}

export function canViewAudit(ctx: StaffContext): boolean {
  return ctx.isGlobalLeader;
}

/**
 * Which domain ids the context may read audit history for: all domains
 * for global leaders, only assigned domains for scope staff.
 */
export function readableDomainIds(ctx: StaffContext, allDomainIds: string[]): string[] {
  if (ctx.isGlobalLeader) return allDomainIds;
  return allDomainIds.filter((id) => ctx.domainAssignments.some((a) => a.domainId === id));
}
