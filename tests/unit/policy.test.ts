import { describe, expect, it } from "vitest";
import type { StaffContext } from "@/lib/auth/session";
import { canAccessDomain, canAssignPoints, canManageGlobal, canViewAudit, canWriteDomain, readableDomainIds, canAppointGlobalRole, canRevokeGlobalRole, canAppointDomainRole, canManageMembers } from "@/lib/auth/policy";

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

  it("global-role matrix: presidents manage presidents+VPs, VPs manage VPs only", () => {
    const president = staff({ globalRole: "PRESIDENT", isGlobalLeader: true });
    const vp = staff({ globalRole: "VICE_PRESIDENT", isGlobalLeader: true });
    const lead = staff({ domainAssignments: [{ domainId: webDomain, role: "LEAD" }] });

    expect(canAppointGlobalRole(president, "PRESIDENT")).toBe(true);
    expect(canAppointGlobalRole(president, "VICE_PRESIDENT")).toBe(true);
    expect(canRevokeGlobalRole(president, "PRESIDENT")).toBe(true);

    expect(canAppointGlobalRole(vp, "VICE_PRESIDENT")).toBe(true);
    expect(canAppointGlobalRole(vp, "PRESIDENT")).toBe(false);
    expect(canRevokeGlobalRole(vp, "PRESIDENT")).toBe(false);

    expect(canAppointGlobalRole(lead, "VICE_PRESIDENT")).toBe(false);
    expect(canRevokeGlobalRole(lead, "VICE_PRESIDENT")).toBe(false);
  });

  it("domain leadership (lead/co-lead) is appointable by global leaders only", () => {
    const president = staff({ globalRole: "PRESIDENT", isGlobalLeader: true });
    const vp = staff({ globalRole: "VICE_PRESIDENT", isGlobalLeader: true });
    const lead = staff({ domainAssignments: [{ domainId: webDomain, role: "LEAD" }] });

    expect(canAppointDomainRole(president)).toBe(true);
    expect(canAppointDomainRole(vp)).toBe(true);
    expect(canAppointDomainRole(lead)).toBe(false);
  });

  it("member management: globals anywhere, leads/co-leads own domain only", () => {
    const vp = staff({ globalRole: "VICE_PRESIDENT", isGlobalLeader: true });
    const lead = staff({ domainAssignments: [{ domainId: webDomain, role: "LEAD" }] });
    const coLead = staff({ domainAssignments: [{ domainId: otherDomain, role: "CO_LEAD" }] });

    expect(canManageMembers(vp, webDomain)).toBe(true);
    expect(canManageMembers(vp, otherDomain)).toBe(true);
    expect(canManageMembers(lead, webDomain)).toBe(true);
    expect(canManageMembers(lead, otherDomain)).toBe(false);
    expect(canManageMembers(coLead, otherDomain)).toBe(true);
    expect(canManageMembers(coLead, webDomain)).toBe(false);
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
