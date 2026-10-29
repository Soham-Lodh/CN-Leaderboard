import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "../db";
import { invalidatePublicCaches } from "../cache";
import { recordAudit } from "../audit";
import { isTransientDbError, lockDomain, lockMembershipsSorted, setTransactionTimeouts, TX_OPTIONS } from "../locking";
import { canAccessDomain } from "../auth/policy";
import type { StaffContext } from "../auth/session";
import { fail, ok, type ActionResult } from "../errors";
import { requestHash, sha256Hex } from "../ids";
import { cellIsFormula, normalizeRollNumber, type SheetCellLike } from "../normalize";
import { MAX_REASON_LENGTH, MIN_DELTA, MAX_DELTA } from "../normalize";
import { MAX_IMPORT_ROWS } from "../constants";
import { sleepMs } from "../sleep";

/**
 * Excel import for one domain (PRD FR-34..39, TRD §10.1). Parsing and
 * pure validation happen before any database transaction; commit is
 * idempotent by (actor, batch key) and re-parses the uploaded bytes so
 * nothing latent from the client is trusted.
 */

export interface ImportRowResult {
  row: number;
  name: string | null;
  rollNumber: string | null;
  points: number;
  reason: string | null;
  status: "ok" | "error" | "exists";
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  filename: string;
  contentHash: string;
  rows: ImportRowResult[];
  validCount: number;
  invalidCount: number;
  existsCount: number;
  globalErrors: string[];
}

export interface ImportCommitSummary {
  created: number;
  reactivated: number;
  skipped: number;
  invalid: number;
  scoredRows: number;
}

function domainScoped(ctx: StaffContext, domainId: string): boolean {
  return canAccessDomain(ctx, domainId).allowed;
}

/** Preview a workbook: parse + validate + annotate existing memberships. */
export async function previewImport(
  ctx: StaffContext,
  domainId: string,
  rawFile: unknown,
): Promise<ActionResult<ImportPreview>> {
  if (!domainScoped(ctx, domainId)) {
    return fail("FORBIDDEN", "You are not assigned to this domain");
  }
  const file = await parseRawFile(rawFile);
  if (!file.ok) return fail("VALIDATION_ERROR", file.error);

  const parsed = parseWorkbook(file.bytes);
  if (!parsed.ok) return fail("VALIDATION_ERROR", parsed.error);

  const rolls = [...new Set(parsed.rows.map((r) => normalizeRollNumber(r.rollNumber ?? "")).filter((r) => r.length > 0))];
  if (parsed.globalErrors.length > 0) {
    return fail("VALIDATION_ERROR", parsed.globalErrors.join(" "));
  }
  if (ctx.isGlobalLeader && parsed.rows.some((r) => r.status !== "error" && r.points !== 0)) {
    return fail("FORBIDDEN", "Presidents and Vice Presidents cannot assign points through imports");
  }

  const memberships = rolls.length
    ? await prisma.domainMembership.findMany({
        where: { domainId, member: { normalizedRollNumber: { in: rolls } } },
        select: { status: true, member: { select: { normalizedRollNumber: true, archivedAt: true } } },
      })
    : [];
  const membershipByRoll = new Map(
    memberships.map((m) => [m.member.normalizedRollNumber, m] as const),
  );

  const rows: ImportRowResult[] = parsed.rows.map((r) => {
    const roll = normalizeRollNumber(r.rollNumber ?? "");
    const warnings: string[] = [];
    let status: ImportRowResult["status"] = r.status;
    if (r.status === "ok" && roll.length > 0) {
      const existing = membershipByRoll.get(roll);
      if (existing?.status === "ACTIVE") {
        status = "exists";
        warnings.push("Already an active member of this domain; will be skipped");
      } else if (existing?.status === "REMOVED") {
        warnings.push("Will be re-added to this domain");
      } else if (existing?.member.archivedAt) {
        warnings.push("Archived member record will be restored");
      }
    }
    return { ...r, warnings, status };
  });

  const validCount = rows.filter((r) => r.status === "ok").length;
  const invalidCount = rows.filter((r) => r.status === "error").length;
  const existsCount = rows.filter((r) => r.status === "exists").length;

  return ok({
    filename: file.safeName,
    contentHash: sha256Hex(file.bytes.toString("base64")),
    rows,
    validCount,
    invalidCount,
    existsCount,
    globalErrors: parsed.globalErrors,
  });
}

/** Commit an import. Idempotent by (actor, batch key) + content hash. */
export async function commitImport(
  ctx: StaffContext,
  domainId: string,
  batchKey: string,
  rawFile: unknown,
  skipInvalid: boolean,
  corrId: string,
): Promise<ActionResult<ImportCommitSummary>> {
  if (!domainScoped(ctx, domainId)) {
    return fail("FORBIDDEN", "You are not assigned to this domain");
  }
  if (!/^[\w-]{8,72}$/.test(batchKey)) {
    return fail("VALIDATION_ERROR", "Invalid batch key");
  }
  const file = await parseRawFile(rawFile);
  if (!file.ok) return fail("VALIDATION_ERROR", file.error);

  const parsed = parseWorkbook(file.bytes);
  if (!parsed.ok) return fail("VALIDATION_ERROR", parsed.error);
  if (parsed.globalErrors.length > 0) {
    return fail("VALIDATION_ERROR", parsed.globalErrors.join(" "));
  }
  const hasUnacceptable = parsed.rows.some((r) => r.status === "error");
  if (hasUnacceptable && !skipInvalid) {
    return fail(
      "VALIDATION_ERROR",
      "The file has invalid or duplicate rows; fix them or choose to import valid rows only.",
    );
  }

  let attempt = 0;
  for (;;) {
    try {
      const summary = await runImportTransaction(
        ctx, domainId, batchKey, file, parsed, skipInvalid, corrId,
      );
      invalidatePublicCaches([domainId]);
      return summary;
    } catch (error) {
      if (error instanceof StoredSummarySignal) return error.result;
      if (error instanceof ImportConflictSignal) return error.result;
      if (isTransientDbError(error) && attempt < 2) {
        attempt += 1;
        await sleepMs(60 * attempt);
        continue;
      }
      throw error;
    }
  }
}

class StoredSummarySignal extends Error {
  constructor(public readonly result: ActionResult<ImportCommitSummary>) {
    super("import.replay");
  }
}

class ImportConflictSignal extends Error {
  constructor(public readonly result: ActionResult<ImportCommitSummary>) {
    super("import.conflict");
  }
}

async function runImportTransaction(
  ctx: StaffContext,
  domainId: string,
  batchKey: string,
  file: RawFileResult,
  parsed: ParsedWorkbook,
  skipInvalid: boolean,
  corrId: string,
): Promise<ActionResult<ImportCommitSummary>> {
  const operation = "IMPORT_COMMIT";
  const hash = requestHash({
    operation,
    domainId,
    skipInvalid,
    contentHash: sha256Hex(file.bytes.toString("base64")),
  });

  return prisma.$transaction(async (tx) => {
    await setTransactionTimeouts(tx);

    // 1. Idempotency reservation for the whole batch.
    const existing = await tx.idempotencyRecord.findUnique({
      where: {
        actorStaffAccountId_key_operation: {
          actorStaffAccountId: ctx.staffAccountId,
          key: batchKey,
          operation,
        },
      },
    });
    if (existing && existing.requestHash !== hash) {
      throw new ImportConflictSignal(
        fail("IDEMPOTENCY_CONFLICT", "This batch key was already used for a different import"),
      );
    }
    if (existing?.status === "COMMITTED") {
      const stored = existing.response as ImportCommitSummary | null;
      if (stored) throw new StoredSummarySignal(ok(stored));
    }
    if (!existing) {
      await tx.idempotencyRecord.create({
        data: {
          actorStaffAccountId: ctx.staffAccountId,
          key: batchKey,
          operation,
          requestHash: hash,
          status: "RESERVED",
        },
      });
    }

    // 2. Domain lifecycle check under a shared lock.
    await lockDomain(tx, domainId, "share");
    const domain = await tx.domain.findUnique({
      where: { id: domainId },
      select: { id: true, archivedAt: true },
    });
    if (!domain) return fail("NOT_FOUND", "Domain not found");
    if (domain.archivedAt) {
      return fail("CONFLICT", "Archive was completed during preview; restore the domain first");
    }

    const okRows = [...parsed.rows]
      .filter((r) => r.status === "ok")
      .sort((a, b) =>
        normalizeRollNumber(a.rollNumber ?? "") < normalizeRollNumber(b.rollNumber ?? "") ? -1 : 1,
      );
    const rolls = [...new Set(okRows.map((r) => normalizeRollNumber(r.rollNumber ?? "")))];

    const existingMembers = rolls.length
      ? await tx.member.findMany({
          where: { normalizedRollNumber: { in: rolls } },
          select: { id: true, name: true, rollNumber: true, normalizedRollNumber: true, archivedAt: true },
        })
      : [];
    const memberByRoll = new Map(existingMembers.map((m) => [m.normalizedRollNumber, m] as const));

    const domainMemberships = rolls.length
      ? await tx.domainMembership.findMany({
          where: { domainId, member: { normalizedRollNumber: { in: rolls } } },
          select: {
            id: true,
            status: true,
            currentPoints: true,
            member: { select: { normalizedRollNumber: true } },
          },
        })
      : [];
    const membershipByRoll = new Map(
      domainMemberships.map((m) => [m.member.normalizedRollNumber, m] as const),
    );

    let created = 0;
    let reactivated = 0;
    let skipped = 0;
    const invalid = parsed.rows.filter((r) => r.status === "error").length;
    let scoredRows = 0;

    /** Point updates queued for the locked flush below. */
    const pointUpdates: Array<{ membershipId: string; delta: number; reason: string | null }> = [];

    for (const row of okRows) {
      const roll = normalizeRollNumber(row.rollNumber ?? "");
      let member = memberByRoll.get(roll);

      if (member?.archivedAt) {
        member = await tx.member.update({
          where: { id: member.id },
          data: { archivedAt: null, updatedById: ctx.staffAccountId },
        });
        await recordAudit(tx, {
          action: "MEMBER_RESTORED",
          targetType: "Member",
          targetId: member.id,
          actorStaffAccountId: ctx.staffAccountId,
          actorEmailSnapshot: ctx.email,
          domainId,
          requestId: corrId,
        });
      }

      const membership = membershipByRoll.get(roll);
      if (membership?.status === "ACTIVE") {
        skipped += 1;
        continue;
      }

      if (membership && membership.status === "REMOVED") {
        await tx.domainMembership.update({
          where: { id: membership.id },
          data: { status: "ACTIVE", removedAt: null, removedById: null },
        });
        await recordAudit(tx, {
          action: "MEMBERSHIP_RESTORED",
          targetType: "DomainMembership",
          targetId: membership.id,
          actorStaffAccountId: ctx.staffAccountId,
          actorEmailSnapshot: ctx.email,
          domainId,
          requestId: corrId,
        });
        reactivated += 1;
        if (row.points !== 0) {
          pointUpdates.push({
            membershipId: membership.id,
            delta: row.points,
            reason: row.reason,
          });
        }
        continue;
      }

      if (!member) {
        member = await tx.member.create({
          data: {
            name: row.name ?? roll,
            rollNumber: row.rollNumber ?? roll,
            normalizedRollNumber: roll,
            createdById: ctx.staffAccountId,
          },
        });
        memberByRoll.set(roll, member);
        await recordAudit(tx, {
          action: "MEMBER_CREATED",
          targetType: "Member",
          targetId: member.id,
          actorStaffAccountId: ctx.staffAccountId,
          actorEmailSnapshot: ctx.email,
          domainId,
          afterState: { name: member.name, rollNumber: member.rollNumber },
          requestId: corrId,
        });
      }

      const newMembership = await tx.domainMembership.create({
        data: { domainId, memberId: member.id, status: "ACTIVE", createdById: ctx.staffAccountId },
      });
      await recordAudit(tx, {
        action: "MEMBERSHIP_ADDED",
        targetType: "DomainMembership",
        targetId: newMembership.id,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        domainId,
        requestId: corrId,
      });
      created += 1;
      if (row.points !== 0) {
        pointUpdates.push({
          membershipId: newMembership.id,
          delta: row.points,
          reason: row.reason,
        });
      }
    }

    // Nonzero starting points → ledger entries in the same transaction.
    // Memberships that pre-existed are locked in ascending id order first.
    const existingUpdateIds = pointUpdates
      .map((p) => p.membershipId)
      .filter((id) => domainMemberships.some((m) => m.id === id));
    await lockMembershipsSorted(tx, existingUpdateIds);

    for (const p of pointUpdates) {
      const updated = await tx.domainMembership.update({
        where: { id: p.membershipId },
        data: { currentPoints: { increment: p.delta }, version: { increment: 1 } },
        select: { currentPoints: true },
      });
      await tx.scoreEntry.create({
        data: {
          domainMembershipId: p.membershipId,
          delta: p.delta,
          balanceAfter: updated.currentPoints,
          reason: p.reason,
          actorStaffAccountId: ctx.staffAccountId,
          actorEmailSnapshot: ctx.email,
          source: "IMPORT",
          idempotencyKey: `${batchKey}:${p.membershipId.slice(0, 12)}`,
        },
      });
      await recordAudit(tx, {
        action: "SCORE_ADJUSTED",
        targetType: "DomainMembership",
        targetId: p.membershipId,
        actorStaffAccountId: ctx.staffAccountId,
        actorEmailSnapshot: ctx.email,
        domainId,
        afterState: { delta: p.delta, points: updated.currentPoints, source: "IMPORT" },
        requestId: corrId,
        metadata: { source: "IMPORT", reason: p.reason },
      });
      scoredRows += 1;
    }

    const summary: ImportCommitSummary = { created, reactivated, skipped, invalid, scoredRows };

    await tx.importBatch.create({
      data: {
        domainId,
        actorStaffAccountId: ctx.staffAccountId,
        filename: file.safeName,
        contentHash: sha256Hex(file.bytes.toString("base64")),
        status: skipInvalid ? "COMPLETED_PARTIAL" : "COMPLETED",
        membershipsCreated: created,
        membershipsReactivated: reactivated,
        rowsSkipped: skipped,
        rowsInvalid: invalid,
      },
    });

    await recordAudit(tx, {
      action: "IMPORT_COMPLETED",
      targetType: "ImportBatch",
      targetId: domainId,
      actorStaffAccountId: ctx.staffAccountId,
      actorEmailSnapshot: ctx.email,
      domainId,
      afterState: summary as unknown as Record<string, unknown>,
      requestId: corrId,
    });

    await tx.idempotencyRecord.update({
      where: {
        actorStaffAccountId_key_operation: {
          actorStaffAccountId: ctx.staffAccountId,
          key: batchKey,
          operation,
        },
      },
      data: { status: "COMMITTED", response: summary as unknown as object },
    });

    return ok(summary);
  }, TX_OPTIONS);
}

// ------------------------------------------------------------------
// File + workbook parsing (pure functions, no DB access)
// ------------------------------------------------------------------

interface RawFileResult {
  ok: true;
  bytes: Buffer;
  name: string;
  safeName: string;
}

type ParseFileResult =
  | RawFileResult
  | { ok: false; error: string };

async function parseRawFile(rawFile: unknown): Promise<ParseFileResult> {
  if (
    typeof rawFile === "object" &&
    rawFile !== null &&
    "arrayBuffer" in (rawFile as File) &&
    "name" in (rawFile as File)
  ) {
    const f = rawFile as File;
    const bytes = Buffer.from(await f.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) {
      return { ok: false, error: "Maximum file size is 5 MB" };
    }
    const cleanName = f.name.replace(/[^\w .-]+/g, "_").slice(0, 120);
    if (!cleanName.toLowerCase().endsWith(".xlsx")) {
      return { ok: false, error: "Only .xlsx files are accepted" };
    }
    if (!bytes.subarray(0, 2).equals(Buffer.from("PK"))) {
      return { ok: false, error: "The file is not a valid .xlsx workbook" };
    }
    return { ok: true, bytes, name: cleanName, safeName: cleanName };
  }
  return { ok: false, error: "A .xlsx file upload is required" };
}

interface ParserRow {
  row: number;
  name: string | null;
  rollNumber: string | null;
  points: number;
  reason: string | null;
  status: "ok" | "error";
  errors: string[];
}

interface ParsedWorkbook {
  ok: true;
  rows: ParserRow[];
  globalErrors: string[];
}

type ParseWorkbookResult =
  | ParsedWorkbook
  | { ok: false; error: string };

const HEADER_ALIASES: Record<string, string> = {
  name: "name",
  rollnumber: "rollNumber",
  "roll number": "rollNumber",
  roll: "rollNumber",
  points: "points",
  initial_points: "points",
  reason: "reason",
};

function headerKey(rawCell: ExcelJS.CellValue): ImportColumn | null {
  let text: string;
  if (typeof rawCell === "string") text = rawCell;
  else if (rawCell === null || rawCell === undefined) return null;
  else if (typeof rawCell === "object" && rawCell !== null && "text" in rawCell && typeof rawCell.text === "string") text = rawCell.text;
  else return null;
  const key = text.trim().toLowerCase().replace(/\s+/g, "");
  return (HEADER_ALIASES[key] ?? HEADER_ALIASES[text.trim().toLowerCase()] ?? null) as ImportColumn | null;
}

type ImportColumn = "name" | "rollNumber" | "points" | "reason";

function parseWorkbook(bytes: Buffer): ParseWorkbookResult {
  const workbook = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet;
  try {
    workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const loaded = workbook.worksheets[0];
    if (!loaded) return { ok: false, error: "The workbook has no worksheets" };
    sheet = loaded;
  } catch {
    return { ok: false, error: "The file could not be read as an .xlsx workbook" };
  }

  const globalErrors: string[] = [];
  if (sheet.rowCount - 1 > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `Maximum ${MAX_IMPORT_ROWS} data rows per import (the sheet has ${sheet.rowCount - 1})`,
    };
  }

  const headerRow = sheet.getRow(1);
  const columnMap = new Map<number, ImportColumn>();
  let gotName = false;
  let gotRoll = false;
  headerRow.eachCell((cell, col) => {
    const mapped = headerKey(cell.value);
    if (!mapped) return;
    columnMap.set(col, mapped);
    if (mapped === "name") gotName = true;
    if (mapped === "rollNumber") gotRoll = true;
  });
  if (!gotName || !gotRoll) {
    return { ok: false, error: "Header row must contain name and rollNumber columns" };
  }

  const seenRolls = new Map<string, number>();
  const rows: ParserRow[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const nameCell = cellFor(row, columnMap, "name");
    const rollCell = cellFor(row, columnMap, "rollNumber");
    const pointsCell = cellFor(row, columnMap, "points");
    const reasonCell = cellFor(row, columnMap, "reason");

    const mostlyBlank =
      isEmpty(nameCell) && isEmpty(rollCell) && isEmpty(pointsCell) && isEmpty(reasonCell);
    if (mostlyBlank) return;

    const errors: string[] = [];

    for (const cell of [nameCell, rollCell, pointsCell, reasonCell]) {
      if (cell && cellIsFormula(cell)) {
        errors.push("Formula cells are not allowed");
        break;
      }
    }

    const nameText = textOf(nameCell);
    if (!nameText || nameText.trim().length < 2) {
      errors.push("Name is required");
    } else if (nameText.trim().length > 120) {
      errors.push("Name must be at most 120 characters");
    }

    const rollText = textOf(rollCell);
    const roll = rollText ? normalizeRollNumber(rollText) : "";
    if (!rollText || rollText.trim().length === 0) {
      errors.push("Roll number is required");
    } else if (roll.length === 0) {
      errors.push("Roll number has no usable characters");
    } else if (roll.length > 60) {
      errors.push("Roll number is too long");
    }

    let points = 0;
    if (!isEmpty(pointsCell)) {
      const rawPoints = pointsCell?.value;
      const numText =
        rawPoints === undefined || rawPoints === null ? "" : String(rawPoints).trim();
      if (numText === "") {
        errors.push("Points must be a whole number");
      } else if (!/^[+-]?\d+$/.test(numText)) {
        errors.push("Points must be a whole number (decimals and text are rejected)");
      } else {
        points = Number(numText);
        if (points !== 0 && (points < MIN_DELTA || points > MAX_DELTA)) {
          errors.push(`Nonzero points must be between ${MIN_DELTA} and ${MAX_DELTA}`);
        }
      }
    }

    let reason: string | null = null;
    if (!isEmpty(reasonCell)) {
      const raw = textOf(reasonCell) ?? "";
      const trimmed = raw.trim();
      if (trimmed.length > MAX_REASON_LENGTH) {
        errors.push(`Reason must be at most ${MAX_REASON_LENGTH} characters`);
      } else {
        reason = trimmed.length > 0 ? trimmed : null;
      }
    }

    if (roll.length > 0 && roll.length <= 60) {
      const firstAt = seenRolls.get(roll);
      if (firstAt !== undefined) {
        errors.push(`Duplicate of row ${firstAt} in this file`);
      } else {
        seenRolls.set(roll, rowNumber);
      }
    }

    rows.push({
      row: rowNumber,
      name: nameText ? nameText.trim() : null,
      rollNumber: rollText ? rollText.trim() : null,
      points,
      reason,
      status: errors.length > 0 ? "error" : "ok",
      errors,
    });
  });

  if (rows.length === 0) {
    globalErrors.push("No data rows found");
    return { ok: false, error: "No data rows found" };
  }

  return { ok: true, rows, globalErrors };
}

function cellFor(
  row: ExcelJS.Row,
  columnMap: Map<number, ImportColumn>,
  field: ImportColumn,
): SheetCellLike | null {
  for (const [col, mapped] of columnMap.entries()) {
    if (mapped === field) {
      return row.getCell(col) as unknown as SheetCellLike;
    }
  }
  return null;
}

function isEmpty(cell: SheetCellLike | null): boolean {
  if (!cell) return true;
  const v = cell.value;
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function textOf(cell: SheetCellLike | null): string | null {
  if (!cell || isEmpty(cell)) return null;
  const v = cell.value;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && v !== null && "text" in v && typeof (v as { text: unknown }).text === "string") {
    return (v as { text: string }).text;
  }
  return null;
}
