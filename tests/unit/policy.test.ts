import { describe, expect, it } from "vitest";
import type { StaffContext } from "@/lib/auth/session";
import { canAccessDomain, canAssignPoints, canManageGlobal, canViewAudit, canWriteDomain, readableDomainIds } from "@/lib/auth/policy";

function staff(partial: Partial<StaffContext>): StaffContext {
  return {
    staffAccountId: "00000000-0000-0000-0000-000000000001",
    email: "lead@kiit.ac.in",
    displayName: "Lead",
    globalRole: null,
    domainAssignments: [],
    isGlobalLeader: false,
    ...partial,
  };
}

describe("authorization policy (PRD §10: a lead cannot read or change another domain)", () => {
  const webDomain = "11111111-1111-1111-1111-111111111111";
  const otherDomain = "22222222-2222-2222-2222-222222222222";

  it("grants a lead exactly their assigned domain", () => {
    const ctx = staff({ domainAssignments: [{ domainId: webDomain, role: "LEAD" }] });
    expect(canAccessDomain(ctx, webDomain)).toEqual({ allowed: true, scope: "assigned", role: "LEAD" });
    expect(canAccessDomain(ctx, otherDomain)).toEqual({ allowed: false });
    expect(canWriteDomain(ctx, webDomain)).toBe(true);
    expect(canWriteDomain(ctx, otherDomain)).toBe(false);
  });

  it("never lets a plain staff member act globally", () => {
    const ctx = staff({ domainAssignments: [{ domainId: webDomain, role: "LEAD" }] });
    expect(canManageGlobal(ctx)).toBe(false);
  });

  it("grants President/VP every domain", () => {
    const president = staff({
      email: "president@kiit.ac.in",
      globalRole: "PRESIDENT",
      isGlobalLeader: true,
    });
    expect(canManageGlobal(president)).toBe(true);
    expect(canAccessDomain(president, otherDomain)).toEqual({ allowed: true, scope: "global", role: "PRESIDENT" });
    expect(canWriteDomain(president, otherDomain)).toBe(false);
    expect(canAssignPoints(president, otherDomain)).toBe(false);
    expect(canViewAudit(president)).toBe(true);

    const vp = staff({ globalRole: "VICE_PRESIDENT", isGlobalLeader: true });
    expect(canManageGlobal(vp)).toBe(true);
    expect(canAccessDomain(vp, otherDomain).allowed).toBe(true);
    expect(canAssignPoints(vp, otherDomain)).toBe(false);
  });

  it("co-leads may write inside their domain only", () => {
    const ctx = staff({ domainAssignments: [{ domainId: webDomain, role: "CO_LEAD" }] });
    expect(canWriteDomain(ctx, webDomain)).toBe(true);
    expect(canWriteDomain(ctx, otherDomain)).toBe(false);
  });

  it("keeps audit history hidden from leads and visible to globals", () => {
    const lead = staff({ domainAssignments: [{ domainId: webDomain, role: "LEAD" }] });
    const president = staff({ globalRole: "PRESIDENT", isGlobalLeader: true });
    const all = [webDomain, otherDomain];

    expect(readableDomainIds(lead, all)).toEqual([webDomain]);
    expect(readableDomainIds(president, all)).toEqual(all);
    expect(canViewAudit(lead)).toBe(false);
    expect(canViewAudit(president)).toBe(true);
  });
});
