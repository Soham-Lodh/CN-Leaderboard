import { ZodError } from "zod";

/**
 * Typed action results shared by every Server Action and Route Handler.
 * Database or internal errors never leak through to the browser; callers
 * receive one of the standardized outcome codes.
 */
export const ACTION_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type AppErrorCode = (typeof ACTION_CODES)[number];

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: AppErrorCode;
      message: string;
      fields?: Record<string, string[]>;
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  code: AppErrorCode,
  message: string,
  fields?: Record<string, string[]>,
): ActionResult<never> {
  return { ok: false, code, message, ...(fields ? { fields } : {}) };
}

/** Map a ZodError into a standardized validation result. */
export function zodToResult(error: ZodError): ActionResult<never> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    (fields[key] ??= []).push(issue.message);
  }
  return fail("VALIDATION_ERROR", "Validation failed", fields);
}
