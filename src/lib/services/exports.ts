import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "../db";
import { recordAudit } from "../audit";
import { canAccessDomain, canManageGlobal } from "../auth/policy";
import type { StaffContext } from "../auth/session";
import { fail, ok, type ActionResult } from "../errors";
import { escapeFormulaCell } from "../normalize";

const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface ExportWorkbook {
  bytes: Buffer;
  filename: string;
  rowCount: number;
}

/**
 * Build the .xlsx export. Columns exactly: name, rollNumber, points,
 * domain. Active memberships only; no reasons, actor emails or audit
 * data. Untrusted text that could start a formula is escaped.
 */
export async function buildDomainExport(
  ctx: StaffContext,
  domainId: string | null,
  corrId: string,
): Promise<ActionResult<ExportWorkbook>> {
  if (domainId) {
    if (!canAccessDomain(ctx, domainId).allowed) {
      return fail("FORBIDDEN", "You are not assigned to this domain");
    }
  } else if (!canManageGlobal(ctx)) {
    return fail("FORBIDDEN", "Global leadership role required for an all-domains export");
  }

  let slugPart = "all";
  if (domainId) {
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: { slug: true },
    });
    if (!domain) return fail("NOT_FOUND", "Domain not found");
    slugPart = domain.slug;
  }

  const memberships = await prisma.domainMembership.findMany({
    where: {
      status: "ACTIVE",
      ...(domainId ? { domainId } : {}),
      member: { archivedAt: null },
      domain: { archivedAt: null },
    },
    orderBy: [{ domain: { name: "asc" } }, { currentPoints: "desc" }, { member: { name: "asc" } }],
    select: {
      currentPoints: true,
      member: { select: { name: true, rollNumber: true } },
      domain: { select: { name: true } },
    },
  });

  const datePart = new Date().toISOString().slice(0, 10);
  const filename = sanitize(`leaderboard-${slugPart}-${datePart}.xlsx`);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("leaderboard");
  sheet.columns = [
    { header: "name", key: "name", width: 32 },
    { header: "rollNumber", key: "rollNumber", width: 20 },
    { header: "points", key: "points", width: 10 },
    { header: "domain", key: "domain", width: 24 },
  ];
  for (const m of memberships) {
    sheet.addRow({
      name: escapeFormulaCell(m.member.name),
      rollNumber: escapeFormulaCell(m.member.rollNumber),
      points: m.currentPoints,
      domain: escapeFormulaCell(m.domain.name),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  // Audit the export (append-only) after the workbook is materialized.
  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, {
      action: "EXPORT_CREATED",
      targetType: "Domain",
      targetId: domainId ?? "ALL",
      actorStaffAccountId: ctx.staffAccountId,
      actorEmailSnapshot: ctx.email,
      domainId,
      afterState: { rowCount: memberships.length },
      requestId: corrId,
    });
  });

  return ok({
    bytes: Buffer.from(buffer as ArrayBuffer),
    filename,
    rowCount: memberships.length,
  });
}

export function exportResponse(workbook: ExportWorkbook): Response {
  return new Response(new Uint8Array(workbook.bytes), {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${workbook.filename}"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

function sanitize(name: string): string {
  return name.replace(/[^\w .-]+/g, "_");
}
