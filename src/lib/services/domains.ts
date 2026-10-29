import "server-only";
import { prisma } from "../db";
import { invalidatePublicCaches } from "../cache";
import { recordAudit } from "../audit";
import { lockDomain, setTransactionTimeouts, TX_OPTIONS } from "../locking";
import { canManageGlobal } from "../auth/policy";
import type { StaffContext } from "../auth/session";
import { fail, ok, zodToResult, type ActionResult } from "../errors";
import { ZodError } from "zod";
import { createDomainSchema, renameDomainSchema } from "../validation";
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
    const created = await prisma.$transaction(async (tx) => {
      await setTransactionTimeouts(tx);
      return tx.domain.create({ data: { name, slug, description } });
    }, TX_OPTIONS);

    // Record audit event in its own short transaction (append-only).
    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, {
        action: "DOMAIN_CREATED" as const,
        targetType: "Domain",
        targetId: created.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        afterState: { name, slug, description },
        requestId: corrId,
      });
    });

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
