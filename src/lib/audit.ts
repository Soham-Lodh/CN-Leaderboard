import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Append-only audit events. Services never update/delete audit rows
 * (also blocked by DB triggers); corrections create compensating entries.
 */
export const AUDIT_ACTIONS = [
  "DOMAIN_CREATED",
  "DOMAIN_RENAMED",
  "DOMAIN_ARCHIVED",
  "DOMAIN_RESTORED",
  "MEMBER_CREATED",
  "MEMBER_UPDATED",
  "MEMBER_ARCHIVED",
  "MEMBER_RESTORED",
  "MEMBERSHIP_ADDED",
  "MEMBERSHIP_REMOVED",
  "MEMBERSHIP_RESTORED",
  "STAFF_PROVISIONED",
  "STAFF_REVOKED",
  "GLOBAL_ROLE_ASSIGNED",
  "GLOBAL_ROLE_REVOKED",
  "DOMAIN_ROLE_ASSIGNED",
  "DOMAIN_ROLE_REVOKED",
  "SCORE_ADJUSTED",
  "SCORE_IMPORTS_COMMITTED",
  "IMPORT_COMPLETED",
  "EXPORT_CREATED",
  "BOOTSTRAP_PRESIDENT_CREATED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditRecordInput {
  action: AuditAction;
  targetType: string;
  targetId: string;
  actorStaffAccountId: string | null;
  actorEmailSnapshot?: string | null;
  domainId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  requestId: string;
  metadata?: Record<string, unknown> | null;
}

/** Insert one audit event using a transaction client (co-commits with the write). */
export async function recordAudit(tx: Prisma.TransactionClient, input: AuditRecordInput) {
  await tx.auditEvent.create({
    data: {
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      actorStaffAccountId: input.actorStaffAccountId,
      actorEmailSnapshot: input.actorEmailSnapshot ?? null,
      domainId: input.domainId ?? null,
      beforeState: input.beforeState as Prisma.InputJsonValue | undefined,
      afterState: input.afterState as Prisma.InputJsonValue | undefined,
      requestId: input.requestId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
