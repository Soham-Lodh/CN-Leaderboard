/**
 * Normalization and small validation helpers used across validation,
 * services and tests. All rules live here so tests cover one place.
 */
import { z } from "zod";
import { MAX_REASON_LENGTH, MAX_DELTA, MIN_DELTA } from "./constants";

export { MAX_REASON_LENGTH, MAX_DELTA, MIN_DELTA };

/** Lowercase + trim; collapses internal whitespace runs in one span. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when the (already normalized) email ends in `@<domain>`. */
export function hasEmailSuffix(normalizedEmail: string, domain: string): boolean {
  return domain.split(",").some((d) => normalizedEmail.endsWith(`@${d.trim().toLowerCase().replace(/^@/, "")}`));
}

export const institutionalEmailSchema = (domain: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .endsWith(`@${domain.toLowerCase()}`, {
      message: `Only @${domain} addresses are permitted`,
    });

/**
 * See PRD §7.1: comparison key for roll numbers. Uppercase alphanumerics
 * with single hyphens; all other characters removed; trimmed.
 * `CS2202001` and `cs 2202 001` normalize to the same value.
 */
export function normalizeRollNumber(roll: string): string {
  const cleaned = roll.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "-");
  return cleaned
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export const NORMALIZED_ROLL_LIMIT = 60;
export const NAME_LIMIT = 120;

/** Safe slug: lowercase, alphanumerics and single hyphens. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Escape for Excel/CSV formula injection on untrusted text. */
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function escapeFormulaCell(value: string): string {
  const first = value.charAt(0);
  if (FORMULA_PREFIXES.has(first)) {
    return `'${value}`;
  }
  return value;
}

/** True when a spreadsheet cell contains a formula rather than a literal. */
export interface SheetCellLike {
  type?: number;
  value: unknown;
  formula?: unknown;
  result?: unknown;
}

type CellValueType = { stringValue?: string; error?: unknown };

export function cellIsFormula(cell: SheetCellLike): boolean {
  if (typeof cell.formula === "string" && cell.formula.length > 0) return true;
  const v = cell.value as CellValueType | string | number | boolean | null;
  if (v && typeof v === "object") {
    if ("formula" in (v as Record<string, unknown>)) return true;
    if ("sharedFormula" in (v as Record<string, unknown>)) return true;
    if ("richText" in (v as Record<string, unknown>)) return false;
  }
  return false;
}

/**
 * Spreadsheet header contract (import/export must match exactly).
 * Required columns: name, roll number. Optional: points, reason.
 * Recognized spellings per column — case/whitespace/underscore
 * variations are normalized away.
 */
export type ImportColumn = "name" | "rollNumber" | "points" | "reason";

export const IMPORT_HEADER_ALIASES: Readonly<Record<string, ImportColumn>> = {
  name: "name",
  "full name": "name",
  membername: "name",
  rollnumber: "rollNumber",
  "roll number": "rollNumber",
  roll_no: "rollNumber",
  rollno: "rollNumber",
  roll: "rollNumber",
  points: "points",
  initial_points: "points",
  reason: "reason",
};

/**
 * Map a raw spreadsheet header cell to the canonical column name.
 * Returns null for unrecognized headers.
 */
export function mapImportHeader(rawCell: unknown): ImportColumn | null {
  let text: string;
  if (typeof rawCell === "string") {
    text = rawCell;
  } else if (rawCell === null || rawCell === undefined || typeof rawCell !== "object") {
    return null;
  } else if (
    "text" in (rawCell as Record<string, unknown>) &&
    typeof (rawCell as { text?: unknown }).text === "string"
  ) {
    text = (rawCell as { text: string }).text;
  } else {
    return null;
  }
  const flat = text.trim().toLowerCase();
  if (flat.length === 0) return null;
  const squeezed = flat.replace(/[\s_-]+/g, "");
  return IMPORT_HEADER_ALIASES[flat] ?? IMPORT_HEADER_ALIASES[squeezed] ?? null;
}

/** Import column labels, used by UI instructions and the template file. */
export const IMPORT_COLUMNS: Array<{ column: ImportColumn; label: string; required: boolean }> = [
  { column: "name", label: "name", required: true },
  { column: "rollNumber", label: "roll number", required: true },
  { column: "points", label: "points", required: false },
  { column: "reason", label: "reason", required: false },
];

/** Deterministic JSON serialization for canonical request hashes. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}
