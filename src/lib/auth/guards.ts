import "server-only";
import { redirect } from "next/navigation";
import { getAuthContext, type StaffContext } from "./session";
import { canAccessDomain, canManageGlobal } from "./policy";
import { fail, zodToResult, type ActionResult, AppErrorCode } from "../errors";
import { ZodError, type ZodTypeAny } from "zod";
import { logger } from "../logger";
import { newCorrelationId } from "../ids";

/**
 * Shared server-side authorization guards. Every admin page and every
 * mutation path must pass one of these before doing any work.
 * Middleware/proxy checks are a routing aid only — these run inside
 * the request after the session is verified server-side.
 */

/** For pages: redirect unappointed/unauthenticated users to the entry gate. */
export async function requireStaffPage(): Promise<StaffContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect("/admin?denied=1");
  }
  return ctx;
}

/** For pages: require President/VP (global). */
export async function requireGlobalStaffPage(): Promise<StaffContext> {
  const ctx = await requireStaffPage();
  if (!canManageGlobal(ctx)) {
    redirect("/admin/forbidden");
  }
  return ctx;
}

/** For pages: require global access OR an active assignment in this domain. */
export async function requireDomainManagerPage(domainId: string): Promise<StaffContext> {
  const ctx = await requireStaffPage();
  if (!canAccessDomain(ctx, domainId).allowed) {
    redirect("/admin/forbidden");
  }
  return ctx;
}

/**
 * For Server Actions / Route Handlers: never redirect — return a typed result.
 */
export async function requireStaffAction(): Promise<
  ActionResult<StaffContext>
> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("UNAUTHENTICATED", "Sign in to continue");
  return { ok: true, data: ctx };
}

export async function requireGlobalAction(): Promise<ActionResult<StaffContext>> {
  const ctx = await requireStaffAction();
  if (!ctx.ok) return ctx;
  if (!canManageGlobal(ctx.data)) return fail("FORBIDDEN", "Global leadership role required");
  return ctx;
}

export async function requireDomainManagerAction(domainId: string): Promise<
  ActionResult<{ ctx: StaffContext }>
> {
  const ctx = await requireStaffAction();
  if (!ctx.ok) return ctx;
  if (!canAccessDomain(ctx.data, domainId).allowed) {
    return fail("FORBIDDEN", "You are not assigned to this domain");
  }
  return { ok: true, data: { ctx: ctx.data } };
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 40;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Best-effort, process-local rate limiting for mutation endpoints.
 * Verified against a shared instance setup it is a speed-bump, not a
 * guarantee; the authoritative controls remain validation + authorization.
 */
export function rateLimited(key: string, max = RATE_LIMIT_MAX): AppErrorCode | null {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > max) {
    logger.warn("rate.limit.hit", { key });
    return "RATE_LIMITED";
  }
  return null;
}

/**
 * Parse + validate an action payload safely, returning a typed result
 * instead of throwing ZodError across the server/client boundary.
 */
export function parseOrValidate<Schema extends ZodTypeAny>(
  schema: Schema,
  raw: unknown,
): { ok: true; data: Schema["_output"] } | { ok: false; result: ActionResult<never> } {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, result: zodToResult(parsed.error as ZodError) };
  }
  return { ok: true, data: parsed.data };
}

/** Wrap a Server Action with a correlation ID + structured error boundary. */
export async function runGuardedAction<T>(action: string, fn: (corrId: string) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const corrId = newCorrelationId();
  try {
    const result = await fn(corrId);
    return result;
  } catch (error) {
    logger.error("action.failed", { corrId, action }, error);
    return fail("INTERNAL_ERROR", "Unexpected error. Please retry.");
  }
}
