import "server-only";
import { prisma } from "../db";
import { env } from "../env";
import { recordAudit } from "../audit";
import { setTransactionTimeouts, lockGlobalRolesFor, TX_OPTIONS } from "../locking";
import { canManageGlobal } from "../auth/policy";
import type { StaffContext } from "../auth/session";
import { fail, ok, type ActionResult } from "../errors";
import { hasEmailSuffix, normalizeEmail } from "../normalize";

export type GlobalRole = "PRESIDENT" | "VICE_PRESIDENT";
export type DomainRole = "LEAD" | "CO_LEAD";

export interface StaffRow {
  id: string;
  email: string;
  displayName: string | null;
  status: "ACTIVE" | "REVOKED";
  globalRole: GlobalRole | null;
  globalAssignmentId: string | null;
  lastLoginAt: string | null;
  domainAssignments: Array<{ assignmentId: string; domainId: string; domainName: string; role: DomainRole }>;
}

export interface StaffOverview {
  rows: StaffRow[];
  activePresidentCount: number;
}

export async function listStaffOverview(): Promise<StaffOverview> {
  const staff = await prisma.staffAccount.findMany({
    orderBy: [{ status: "asc" }, { email: "asc" }],
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      lastLoginAt: true,
      globalRoleAssignments: { where: { revokedAt: null }, select: { id: true, role: true } },
      domainAssignments: {
        where: { revokedAt: null },
        select: { id: true, domainId: true, role: true, domain: { select: { name: true } } },
      },
    },
  });

  const rows = staff.map((s) => ({
    id: s.id,
    email: s.email,
    displayName: s.displayName,
    status: s.status,
    globalRole: s.globalRoleAssignments[0]?.role ?? null,
    globalAssignmentId: s.globalRoleAssignments[0]?.id ?? null,
    lastLoginAt: s.lastLoginAt ? s.lastLoginAt.toISOString() : null,
    domainAssignments: s.domainAssignments.map((a) => ({
      assignmentId: a.id,
      domainId: a.domainId,
      domainName: a.domain.name,
      role: a.role,
    })),
  }));

  const activePresidentCount = rows.filter((r) => r.globalRole === "PRESIDENT").length;
  return { rows, activePresidentCount };
}

/* Shared suffix check for provisioned staff emails. */
function isStaffEmail(email: string): boolean {
  return hasEmailSuffix(email, env().ALLOWED_EMAIL_DOMAIN);
}

/** Provision a staff account (no role). Safe to retry. */
export async function provisionStaff(
  ctx: StaffContext,
  rawEmail: unknown,
  corrId: string,
): Promise<ActionResult<{ id: string; email: string; created: boolean }>> {
  if (!canManageGlobal(ctx)) return fail("FORBIDDEN", "Global leadership role required");
  const email = normalizeEmail(typeof rawEmail === "string" ? rawEmail : "");
  if (!isStaffEmail(email)) {
    return fail("VALIDATION_ERROR", `Only @${env().ALLOWED_EMAIL_DOMAIN} addresses can be provisioned`);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      const existing = await tx.staffAccount.findUnique({ where: { email } });
      if (existing && existing.status === "ACTIVE") {
        return { staff: existing, created: false, reactivated: false };
      }
      const staff = existing
        ? await tx.staffAccount.update({ where: { id: existing.id }, data: { status: "ACTIVE" } })
        : await tx.staffAccount.create({ data: { email, status: "ACTIVE" } });
      await recordAudit(tx, {
        action: "STAFF_PROVISIONED",
        targetType: "StaffAccount",
        targetId: staff.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        afterState: { email, status: "ACTIVE" },
        requestId: corrId,
      });
      return { staff, created: !existing, reactivated: Boolean(existing) };
    }, TX_OPTIONS);

    return ok({ id: result.staff.id, email: result.staff.email, created: result.created });
  } catch (error) {
    const pErr = error as { code?: string };
    if (pErr?.code === "P2002") return fail("CONFLICT", "That staff account already exists");
    throw error;
  }
}

/**
 * Find-or-create the target staff account inside a transaction. New
 * appointments may provision by email (FR-20); the appointee is linked
 * on first Google sign-in.
 */
async function findOrCreateStaffForAppointment(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  email: string,
  ctx: StaffContext,
  corrId: string,
): Promise<{ id: string; email: string; isActive: boolean }> {
  const existing = await tx.staffAccount.findUnique({ where: { email } });
  if (existing) {
    if (existing.status === "REVOKED") {
      const updated = await tx.staffAccount.update({ where: { id: existing.id }, data: { status: "ACTIVE" } });
      return { id: updated.id, email: updated.email, isActive: true };
    }
    return { id: existing.id, email: existing.email, isActive: true };
  }
  const created = await tx.staffAccount.create({ data: { email, status: "ACTIVE" } });
  await recordAudit(tx, {
    action: "STAFF_PROVISIONED",
    targetType: "StaffAccount",
    targetId: created.id,
    actorStaffAccountId: ctx.staffAccountId,
    actorEmailSnapshot: ctx.email,
    requestId: corrId,
    afterState: { email },
  });
  return { id: created.id, email: created.email, isActive: true };
}

/** Appoint a President or Vice President. Guarded by the last-President rule. */
export async function appointGlobalRole(
  ctx: StaffContext,
  rawEmail: unknown,
  role: GlobalRole,
  corrId: string,
): Promise<ActionResult<{ staffId: string; role: GlobalRole }>> {
  if (!canManageGlobal(ctx)) return fail("FORBIDDEN", "Global leadership role required");
  const email = normalizeEmail(typeof rawEmail === "string" ? rawEmail : "");
  if (!isStaffEmail(email)) {
    return fail("VALIDATION_ERROR", "Institutional email required");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      const target = await findOrCreateStaffForAppointment(tx, email, ctx, corrId);
      const existingActive = await tx.globalRoleAssignment.findFirst({
        where: { staffAccountId: target.id, revokedAt: null },
      });
      if (existingActive) {
        if (existingActive.role === role) {
          throw new ConflictSignal(`${role === "PRESIDENT" ? "President" : "Vice President"} already holds this role`);
        }
        await tx.globalRoleAssignment.update({
          where: { id: existingActive.id },
          data: { revokedAt: new Date(), revokedById: ctx.staffAccountId },
        });
        await recordAudit(tx, {
          action: "GLOBAL_ROLE_REVOKED",
          targetType: "GlobalRoleAssignment",
          targetId: existingActive.id,
          actorStaffAccountId: ctx.staffAccountId,
          actorEmailSnapshot: ctx.email,
          beforeState: { role: existingActive.role, staffAccountId: target.id },
          requestId: corrId,
        });
      }
      const created = await tx.globalRoleAssignment.create({
        data: { staffAccountId: target.id, role, appointedById: ctx.staffAccountId },
      });
      await recordAudit(tx, {
        action: "GLOBAL_ROLE_ASSIGNED",
        targetType: "GlobalRoleAssignment",
        targetId: created.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        afterState: { role, staffAccountId: target.id, staffEmail: email },
        requestId: corrId,
      });
      return { staffId: target.id, role };
    }, TX_OPTIONS);
    return ok(result);
  } catch (error) {
    if (error instanceof ConflictSignal) return fail("CONFLICT", error.message);
    const pErr = error as { code?: string };
    if (pErr?.code === "P2002") {
      return fail("CONFLICT", "Staff already holds an active global role");
    }
    throw error;
  }
}

/**
 * Revoke an active global role. A revoked President can never leave the
 * chapter with zero active Presidents; the check runs under row locks
 * on all active global role rows.
 */
export async function revokeGlobalRole(
  ctx: StaffContext,
  assignmentId: string,
  corrId: string,
): Promise<ActionResult<{ revoked: true; activePresidents: number }>> {
  if (!canManageGlobal(ctx)) return fail("FORBIDDEN", "Global leadership role required");
  if (!/^[0-9a-f-]{36}$/i.test(assignmentId)) return fail("VALIDATION_ERROR", "Invalid assignment");

  try {
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      const assignment = await tx.globalRoleAssignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, staffAccountId: true, role: true, revokedAt: true },
      });
      if (!assignment) throw new NotFoundSignal("Assignment not found");
      if (assignment.revokedAt) {
        return { revoked: true, activePresidents: -1, alreadyRevoked: true };
      }

      const active = await tx.globalRoleAssignment.findMany({
        where: { revokedAt: null },
        select: { id: true, staffAccountId: true, role: true },
      });
      await lockGlobalRolesFor(tx, active.map((a) => a.staffAccountId));

      const presidentIds = active.filter((a) => a.role === "PRESIDENT");
      if (assignment.role === "PRESIDENT" && presidentIds.length <= 1) {
        throw new ConflictSignal(
          "The last active President cannot be removed. Appoint a replacement first.",
        );
      }

      await tx.globalRoleAssignment.update({
        where: { id: assignmentId },
        data: { revokedAt: new Date(), revokedById: ctx.staffAccountId },
      });
      await recordAudit(tx, {
        action: "GLOBAL_ROLE_REVOKED",
        targetType: "GlobalRoleAssignment",
        targetId: assignmentId,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        beforeState: { role: assignment.role, staffAccountId: assignment.staffAccountId },
        requestId: corrId,
      });

      const remaining = await tx.globalRoleAssignment.count({
        where: { revokedAt: null, role: "PRESIDENT" },
      });
      return { revoked: true, activePresidents: remaining, alreadyRevoked: false };
    }, TX_OPTIONS);

    return ok({ revoked: true as const, activePresidents: result.activePresidents });
  } catch (error) {
    if (error instanceof ConflictSignal) return fail("CONFLICT", error.message);
    if (error instanceof NotFoundSignal) return fail("NOT_FOUND", error.message);
    throw error;
  }
}

export async function appointDomainRole(
  ctx: StaffContext,
  domainId: string,
  rawEmail: unknown,
  role: DomainRole,
  corrId: string,
): Promise<ActionResult<{ assignmentId: string; staffId: string }>> {
  if (!canManageGlobal(ctx)) return fail("FORBIDDEN", "Global leadership role required");
  const email = normalizeEmail(typeof rawEmail === "string" ? rawEmail : "");
  if (!/^[0-9a-f-]{36}$/i.test(domainId)) return fail("VALIDATION_ERROR", "Invalid domain");
  if (!hasEmailSuffix(email, env().ALLOWED_EMAIL_DOMAIN)) {
    return fail("VALIDATION_ERROR", "Institutional email required");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      await tx.$queryRaw`SELECT id FROM "Domain" WHERE id = ${domainId} FOR UPDATE`;
      const domain = await tx.domain.findUnique({ where: { id: domainId }, select: { id: true } });
      if (!domain) throw new NotFoundSignal("Domain not found");

      const target = await findOrCreateStaffForAppointment(tx, email, ctx, corrId);
      const sameStaffActive = await tx.domainAssignment.findFirst({
        where: { domainId, staffAccountId: target.id, revokedAt: null },
      });
      if (sameStaffActive) {
        throw new ConflictSignal("That person already holds an active role in this domain");
      }
      const roleActive = await tx.domainAssignment.findFirst({
        where: { domainId, role, revokedAt: null },
      });
      if (roleActive) {
        await tx.domainAssignment.update({
          where: { id: roleActive.id },
          data: { revokedAt: new Date(), revokedById: ctx.staffAccountId },
        });
        await recordAudit(tx, {
          action: "DOMAIN_ROLE_REVOKED",
          targetType: "DomainAssignment",
          targetId: roleActive.id,
          actorStaffAccountId: ctx.staffAccountId,
          actorEmailSnapshot: ctx.email,
          domainId,
          beforeState: { role, staffAccountId: roleActive.staffAccountId },
          requestId: corrId,
        });
      }
      const created = await tx.domainAssignment.create({
        data: { domainId, staffAccountId: target.id, role, appointedById: ctx.staffAccountId },
      });
      await recordAudit(tx, {
        action: "DOMAIN_ROLE_ASSIGNED",
        targetType: "DomainAssignment",
        targetId: created.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        domainId,
        afterState: { role, staffAccountId: target.id, staffEmail: email },
        requestId: corrId,
      });
      return { assignmentId: created.id, staffId: target.id };
    }, TX_OPTIONS);
    return ok(result);
  } catch (error) {
    if (error instanceof ConflictSignal) return fail("CONFLICT", error.message);
    if (error instanceof NotFoundSignal) return fail("NOT_FOUND", error.message);
    const code = (error as { code?: string }).code;
    if (code === "P2002") return fail("CONFLICT", "That domain role is already active");
    return fail("INTERNAL_ERROR", "Could not update the domain role. Please retry.");
  }
}

export async function revokeDomainRole(
  ctx: StaffContext,
  assignmentId: string,
  corrId: string,
): Promise<ActionResult<{ revoked: true }>> {
  if (!canManageGlobal(ctx)) return fail("FORBIDDEN", "Global leadership role required");
  if (!/^[0-9a-f-]{36}$/i.test(assignmentId)) return fail("VALIDATION_ERROR", "Invalid assignment");

  try {
    await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      const assignment = await tx.domainAssignment.findUnique({ where: { id: assignmentId } });
      if (!assignment) throw new NotFoundSignal("Assignment not found");
      if (assignment.revokedAt) return;
      await tx.domainAssignment.update({
        where: { id: assignmentId },
        data: { revokedAt: new Date(), revokedById: ctx.staffAccountId },
      });
      await recordAudit(tx, {
        action: "DOMAIN_ROLE_REVOKED",
        targetType: "DomainAssignment",
        targetId: assignmentId,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        domainId: assignment.domainId,
        beforeState: { role: assignment.role, staffAccountId: assignment.staffAccountId },
        requestId: corrId,
      });
    }, TX_OPTIONS);
    return ok({ revoked: true });
  } catch (error) {
    if (error instanceof NotFoundSignal) return fail("NOT_FOUND", error.message);
    return fail("INTERNAL_ERROR", "Could not revoke the domain role. Please retry.");
  }
}

class ConflictSignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictSignal";
  }
}

class NotFoundSignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundSignal";
  }
}
