import "server-only";
import { prisma } from "../db";
import { bootstrapPresidentEmail } from "../env";
import { normalizeEmail } from "../normalize";
import { recordAudit } from "../audit";

/** Idempotently provisions the first President before resolving staff access. */
export async function ensureBootstrapPresident(): Promise<void> {
  const email = bootstrapPresidentEmail();
  if (!email) return;

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.globalRoleAssignment.findFirst({
        where: { role: "PRESIDENT", revokedAt: null },
        select: { id: true },
      });
      if (existing) return;

      const staff = await tx.staffAccount.upsert({
        where: { email: normalizeEmail(email) },
        update: { status: "ACTIVE" },
        create: { email: normalizeEmail(email), status: "ACTIVE" },
      });
      const assignment = await tx.globalRoleAssignment.create({
        data: { staffAccountId: staff.id, role: "PRESIDENT" },
      });
      await recordAudit(tx, {
        action: "BOOTSTRAP_PRESIDENT_CREATED",
        targetType: "StaffAccount",
        targetId: staff.id,
        actorStaffAccountId: null,
        actorEmailSnapshot: staff.email,
        afterState: { role: "PRESIDENT", assignmentId: assignment.id },
        requestId: "bootstrap",
      });
    });
  } catch (error) {
    // Another request may have completed bootstrap concurrently.
    const president = await prisma.globalRoleAssignment.findFirst({
      where: { role: "PRESIDENT", revokedAt: null },
      select: { id: true },
    });
    if (!president) throw error;
  }
}
