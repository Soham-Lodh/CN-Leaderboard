import "server-only";
import { prisma } from "../db";
import { invalidatePublicCaches } from "../cache";
import { recordAudit } from "../audit";
import {
  lockDomain,
  lockMembersSorted,
  lockMembershipsSorted,
  setTransactionTimeouts,
  TX_OPTIONS,
} from "../locking";
import { canManageGlobal } from "../auth/policy";
import type { StaffContext } from "../auth/session";
import { fail, ok, zodToResult, type ActionResult } from "../errors";
import { ZodError } from "zod";
import { createDomainSchema, renameDomainSchema, deleteDomainSchema } from "../validation";
import { slugify } from "../normalize";

export interface AdminDomainRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  archivedAt: string | null;
  lead: string | null;
  coLead: string | null;
  activeMembers: number;
}

export async function listAdminDomains(): Promise<AdminDomainRow[]> {
  const domains = await prisma.domain.findMany({
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      archivedAt: true,
      assignments: {
        where: { revokedAt: null },
        select: { role: true, staffAccount: { select: { displayName: true, email: true } } },
      },
      _count: {
        select: {
          memberships: { where: { status: "ACTIVE", member: { archivedAt: null } } },
        },
      },
    },
  });

  return domains.map((d) => {
    const lead = d.assignments.find((a) => a.role === "LEAD");
    const coLead = d.assignments.find((a) => a.role === "CO_LEAD");
    return {
      id: d.id,
      name: d.name,
      slug: d.slug,
      description: d.description,
      archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
      lead: lead ? lead.staffAccount.displayName ?? lead.staffAccount.email : null,
      coLead: coLead ? coLead.staffAccount.displayName ?? coLead.staffAccount.email : null,
      activeMembers: d._count.memberships,
    };
  });
}

function invalidateDomainCaches(domainId?: string) {
  invalidatePublicCaches(domainId ? [domainId] : []);
}

export async function createDomain(ctx: StaffContext, raw: unknown, corrId: string): Promise<ActionResult<{ id: string; name: string; slug: string }>> {
  if (!canManageGlobal(ctx)) return fail("FORBIDDEN", "Global leadership role required");
  const parsed = createDomainSchema.safeParse(raw);
  if (!parsed.success) return zodToResult(parsed.error as ZodError);
  const { name, slug, description } = parsed.data;

  try {
    // Domain row + audit event commit together (same rule as every
    // other mutation: state and its history are one atomic fact).
    const created = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      const domain = await tx.domain.create({ data: { name, slug, description } });
      await recordAudit(tx, {
        action: "DOMAIN_CREATED" as const,
        targetType: "Domain",
        targetId: domain.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        afterState: { name, slug, description },
        requestId: corrId,
      });
      return domain;
    }, TX_OPTIONS);

    invalidateDomainCaches(created.id);
    return ok({ id: created.id, name: created.name, slug: created.slug });
  } catch (error) {
    return mapDbWriteError(error);
  }
}

export async function renameDomain(ctx: StaffContext, raw: unknown, corrId: string): Promise<ActionResult<{ id: string; name: string }>> {
  if (!canManageGlobal(ctx)) return fail("FORBIDDEN", "Global leadership role required");
  const parsed = renameDomainSchema.safeParse(raw);
  if (!parsed.success) return zodToResult(parsed.error as ZodError);
  const { domainId, name } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      await lockDomain(tx, domainId, "update");
      const domain = await tx.domain.findUnique({ where: { id: domainId } });
      if (!domain) throw new NotFoundSignal("Domain not found");
      const updated = await tx.domain.update({ where: { id: domainId }, data: { name } });
      await recordAudit(tx, {
        action: "DOMAIN_RENAMED",
        targetType: "Domain",
        targetId: domainId,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        beforeState: { name: domain.name },
        afterState: { name },
        requestId: corrId,
      });
      return updated;
    }, TX_OPTIONS);

    invalidateDomainCaches(domainId);
    return ok({ id: result.id, name: result.name });
  } catch (error) {
    if (error instanceof NotFoundSignal) return fail("NOT_FOUND", error.message);
    return mapDbWriteError(error);
  }
}

export async function setDomainArchived(
  ctx: StaffContext,
  domainId: string,
  archived: boolean,
  corrId: string,
): Promise<ActionResult<{ id: string; archivedAt: string | null }>> {
  if (!canManageGlobal(ctx)) return fail("FORBIDDEN", "Global leadership role required");
  try {
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      await lockDomain(tx, domainId, "update");
      const domain = await tx.domain.findUnique({ where: { id: domainId } });
      if (!domain) throw new NotFoundSignal("Domain not found");
      const isArchived = domain.archivedAt !== null;
      if (isArchived === archived) {
        return domain; // already in requested state: idempotent
      }

      const updated = await tx.domain.update({
        where: { id: domainId },
        data: { archivedAt: archived ? new Date() : null },
      });

      await recordAudit(tx, {
        action: archived ? "DOMAIN_ARCHIVED" : "DOMAIN_RESTORED",
        targetType: "Domain",
        targetId: domainId,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        beforeState: { archivedAt: domain.archivedAt ? domain.archivedAt.toISOString() : null },
        afterState: { archivedAt: updated.archivedAt ? updated.archivedAt.toISOString() : null },
        requestId: corrId,
      });
      return updated;
    }, TX_OPTIONS);

    invalidateDomainCaches(domainId);
    return ok({
      id: result.id,
      archivedAt: result.archivedAt ? result.archivedAt.toISOString() : null,
    });
  } catch (error) {
    if (error instanceof NotFoundSignal) return fail("NOT_FOUND", error.message);
    return mapDbWriteError(error);
  }
}

/**
 * Hard delete of a domain (President/VP only). Unlike archiving this
 * is irreversible:
 *
 *   - memberships, staff assignments and import batches are erased;
 *   - members that end up with no other membership are erased with it;
 *   - score entries of THIS domain are erased (the domain's ledger);
 *   - audit history is preserved but unlinked: the AuditEvent FK uses
 *     ON DELETE SET NULL, and a DOMAIN_DELETED tombstone event carries
 *     the full before-state. Both facts rely on the trigger gate of
 *     migration 20261030000000: the append-only guards stay in force
 *     for every normal code path and permit mutation only inside a
 *     transaction that has set the transaction-scoped GUC
 *     app.history_delete_bypass = 'DOMAIN_DELETE'. SET LOCAL binds the
 *     value to this transaction, so it can never leak to another
 *     session and is cleared at commit/rollback.
 *
 * No idempotency reservation: deletion is terminal, a replay reports
 * NOT_FOUND. Lock hierarchy per lib/locking.ts: domain FOR UPDATE (3),
 * members sorted (4), memberships sorted (5); rows are re-read after
 * locking before any decision is made.
 */
class ConfirmMismatch extends Error {}

export async function deleteDomain(
  ctx: StaffContext,
  domainId: string,
  confirmName: string,
  corrId: string,
): Promise<
  ActionResult<{
    deleted: true;
    scoreEntriesDeleted: number;
    membershipsDeleted: number;
    membersDeleted: number;
    assignmentsDeleted: number;
    importBatchesDeleted: number;
  }>
> {
  if (!canManageGlobal(ctx)) return fail("FORBIDDEN", "Global leadership role required");
  const parsed = deleteDomainSchema.safeParse({ domainId, confirmName });
  if (!parsed.success) return zodToResult(parsed.error as ZodError);

  try {
    const result = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      await lockDomain(tx, domainId, "update");
      const domain = await tx.domain.findUnique({ where: { id: domainId } });
      if (!domain) throw new NotFoundSignal("Domain not found");
      if (parsed.data.confirmName !== domain.name) {
        throw new ConfirmMismatch(); // the caller typed the wrong name
      }

      const membershipRows = await tx.domainMembership.findMany({
        where: { domainId },
        select: { id: true, memberId: true },
      });
      const memberIds = [...new Set(membershipRows.map((m) => m.memberId))].sort();

      await lockMembersSorted(tx, memberIds);
      await lockMembershipsSorted(tx, membershipRows.map((m) => m.id));

      await tx.$executeRawUnsafe("SET LOCAL app.history_delete_bypass = 'DOMAIN_DELETE'");

      const scoreDeleted = await tx.scoreEntry.deleteMany({
        where: { domainMembership: { domainId } },
      });
      await tx.domainMembership.deleteMany({ where: { domainId } });

      // Members left without any membership anywhere are erased too;
      // members still enrolled in other domains are untouched.
      let membersDeleted = 0;
      if (memberIds.length > 0) {
        const stillElsewhere = await tx.domainMembership.findMany({
          where: { memberId: { in: memberIds }, domainId: { not: domainId } },
          select: { memberId: true },
        });
        const elsewhere = new Set(stillElsewhere.map((m) => m.memberId));
        const orphans = memberIds.filter((id) => !elsewhere.has(id));
        if (orphans.length > 0) {
          membersDeleted = (await tx.member.deleteMany({ where: { id: { in: orphans } } })).count;
        }
      }

      const assignmentsDeleted = await tx.domainAssignment.deleteMany({ where: { domainId } });
      const importBatchesDeleted = await tx.importBatch.deleteMany({ where: { domainId } });

      // The domain row itself; AuditEvent FK unlinks preserved history.
      await tx.domain.delete({ where: { id: domainId } });

      // Tombstone audit event (inserts are always permitted).
      await recordAudit(tx, {
        action: "DOMAIN_DELETED",
        targetType: "Domain",
        targetId: domainId,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        beforeState: {
          name: domain.name,
          slug: domain.slug,
          description: domain.description,
          archivedAt: domain.archivedAt ? domain.archivedAt.toISOString() : null,
        },
        afterState: null,
        requestId: corrId,
        metadata: {
          scoreEntriesDeleted: scoreDeleted.count,
          membershipsDeleted: membershipRows.length,
          membersDeleted,
          assignmentsDeleted: assignmentsDeleted.count,
          importBatchesDeleted: importBatchesDeleted.count,
        },
      });

      return {
        deleted: true as const,
        scoreEntriesDeleted: scoreDeleted.count,
        membershipsDeleted: membershipRows.length,
        membersDeleted,
        assignmentsDeleted: assignmentsDeleted.count,
        importBatchesDeleted: importBatchesDeleted.count,
      };
    }, TX_OPTIONS);

    invalidateDomainCaches(domainId);
    return ok(result);
  } catch (error) {
    if (error instanceof NotFoundSignal) return fail("NOT_FOUND", error.message);
    if (error instanceof ConfirmMismatch) {
      return fail("CONFLICT", "Confirmation does not match the exact domain name");
    }
    return mapDbWriteError(error);
  }
}

export class NotFoundSignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundSignal";
  }
}

/** Map known Prisma constraint errors to safe action results. */
export function mapDbWriteError(error: unknown): ActionResult<never> {
  const pErr = error as { code?: string; meta?: { target?: string[] } } | null;
  if (pErr?.code === "P2002") {
    const target = pErr.meta?.target?.join(",") ?? "";
    if (target.includes("name") || target.includes("slug")) {
      return fail("CONFLICT", "A domain with that name or slug already exists");
    }
    return fail("CONFLICT", "That record already exists");
  }
  throw error; // logged by the action wrapper
}

export { slugify };
