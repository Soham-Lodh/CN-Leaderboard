"use server";

import { revalidatePath } from "next/cache";
import { adjustScore, validateScoreInput } from "@/lib/services/scoring";
import { createDomain, renameDomain, setDomainArchived } from "@/lib/services/domains";
import {
  addMemberWithMembership,
  renameMember,
  setMembershipStatus,
  setMemberArchived,
} from "@/lib/services/members";
import { previewImport, commitImport, type ImportPreview, type ImportCommitSummary } from "@/lib/services/imports";
import {
  provisionStaff,
  appointGlobalRole,
  revokeGlobalRole,
  appointDomainRole,
  revokeDomainRole,
} from "@/lib/services/staff";
import { requireGlobalAction, requireStaffAction } from "@/lib/auth/guards";
import { newCorrelationId } from "@/lib/ids";
import { type ActionResult } from "@/lib/errors";
import { invalidatePublicCaches } from "@/lib/cache";

/**
 * Server Actions: the only write paths in the application. Each action
 * 1) re-authenticates and re-authorizes server-side (guards + service
 *    checks — client state is never trusted),
 * 2) validates its input from scratch with Zod,
 * 3) delegates to a service inside proper transactions, and
 * 4) invalidates exactly the affected public caches.
 */

export type AdminFormState = {
  status: "idle" | "ok" | "error";
  message: string;
  fields?: Record<string, string[]>;
  data?: Record<string, unknown>;
};


function toFormState(result: ActionResult<unknown>): AdminFormState {
  if (!result.ok) {
    return { status: "error", message: result.message, fields: result.fields };
  }
  return { status: "ok", message: "Done." };
}

/** Every write invalidates the public leaderboard/domain caches. */
function invalidateAfterWrite(domainId: string | null): void {
  invalidatePublicCaches(domainId ? [domainId] : []);
  revalidatePath("/leaderboard");
  revalidatePath("/admin");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/domains");
  if (domainId) revalidatePath(`/admin/domains/${domainId}`);
}

const UUID = /^[0-9a-f-]{36}$/i;

function formText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

/* ------------------------------------------------------------------ */
/* Domains (President / VP only)                                       */
/* ------------------------------------------------------------------ */

export async function createDomainAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireGlobalAction();
  if (!guard.ok) return toFormState(guard);
  const corrId = newCorrelationId();
  const result = await createDomain(guard.data, {
    name: formText(formData, "name"),
    slug: formText(formData, "slug"),
    description: formText(formData, "description") || undefined,
  }, corrId);
  if (result.ok) {
    invalidateAfterWrite(result.data.id);
    return { status: "ok", message: `Domain "${result.data.name}" created.` };
  }
  return { status: "error", message: result.message, fields: result.fields };
}

export async function renameDomainAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireGlobalAction();
  if (!guard.ok) return toFormState(guard);
  const corrId = newCorrelationId();
  const result = await renameDomain(guard.data, {
    domainId: formText(formData, "domainId"),
    name: formText(formData, "name"),
  }, corrId);
  if (result.ok) {
    invalidateAfterWrite(result.data.id);
    return { status: "ok", message: "Domain renamed." };
  }
  return { status: "error", message: result.message, fields: result.fields };
}

export async function setDomainArchivedAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireGlobalAction();
  if (!guard.ok) return toFormState(guard);
  const domainId = String(formData.get("domainId") ?? "");
  if (!UUID.test(domainId)) return { status: "error", message: "Invalid domain." };
  const archived = String(formData.get("archived") ?? "true") === "true";
  const corrId = newCorrelationId();
  const result = await setDomainArchived(guard.data, domainId, archived, corrId);
  if (result.ok) {
    invalidateAfterWrite(domainId);
    return { status: "ok", message: archived ? "Domain archived." : "Domain restored." };
  }
  return { status: "error", message: result.message };
}

/* ------------------------------------------------------------------ */
/* Members + memberships (domains staff are assigned to, or globals)   */
/* ------------------------------------------------------------------ */

export async function addMemberAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireStaffAction();
  if (!guard.ok) return toFormState(guard);
  const domainId = String(formData.get("domainId") ?? "");
  if (!UUID.test(domainId)) return { status: "error", message: "Invalid domain." };
  const corrId = newCorrelationId();
  const result = await addMemberWithMembership(guard.data, domainId, {
    name: formText(formData, "name"),
    rollNumber: formText(formData, "rollNumber"),
  }, corrId);
  if (result.ok) {
    invalidateAfterWrite(domainId);
    return {
      status: "ok",
      message: result.data.reusedMember ? "Existing member returned to this domain." : "Member added.",
    };
  }
  return { status: "error", message: result.message, fields: result.fields };
}

export async function renameMemberAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireStaffAction();
  if (!guard.ok) return toFormState(guard);
  const corrId = newCorrelationId();
  const result = await renameMember(guard.data, String(formData.get("membershipId") ?? ""), formText(formData, "name"), corrId);
  if (result.ok) {
    invalidateAfterWrite(null);
    return { status: "ok", message: "Member name updated." };
  }
  return { status: "error", message: result.message, fields: result.fields };
}

export async function setMembershipStatusAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireStaffAction();
  if (!guard.ok) return toFormState(guard);
  const remove = String(formData.get("remove") ?? "true") === "true";
  const corrId = newCorrelationId();
  const result = await setMembershipStatus(guard.data, String(formData.get("membershipId") ?? ""), remove, corrId);
  if (result.ok) {
    invalidateAfterWrite(null);
    return { status: "ok", message: remove ? "Member removed from domain." : "Member restored." };
  }
  return { status: "error", message: result.message };
}

/** President/VP only: archive or restore the member record itself. */
export async function setMemberArchivedAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireGlobalAction();
  if (!guard.ok) return toFormState(guard);
  const archived = String(formData.get("archived") ?? "true") === "true";
  const corrId = newCorrelationId();
  const result = await setMemberArchived(guard.data, String(formData.get("memberId") ?? ""), archived, corrId);
  if (result.ok) {
    invalidateAfterWrite(null);
    return { status: "ok", message: archived ? "Member archived." : "Member restored." };
  }
  return { status: "error", message: result.message };
}

/* ------------------------------------------------------------------ */
/* Scores                                                              */
/* ------------------------------------------------------------------ */

export async function adjustScoreAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireStaffAction();
  if (!guard.ok) return toFormState(guard);

  const parsed = await validateScoreInput({
    membershipId: formData.get("membershipId"),
    delta: Number(formData.get("delta")),
    reason: formData.get("reason") || undefined,
    idempotencyKey: formData.get("idempotencyKey"),
    source: "MANUAL",
  });
  if (!parsed.ok) return { status: "error", message: parsed.result.ok ? "Validation failed" : parsed.result.message, fields: parsed.result.ok ? undefined : parsed.result.fields };

  const corrId = newCorrelationId();
  const result = await adjustScore(guard.data, parsed.data, corrId);
  if (result.ok) {
    invalidateAfterWrite(null);
    return {
      status: "ok",
      message: result.data.replayed ? "Already recorded — no duplicate created." : "Points recorded.",
      data: { total: result.data.currentPoints },
    };
  }
  return { status: "error", message: result.message, fields: result.fields };
}

/* ------------------------------------------------------------------ */
/* Spreadsheets                                                        */
/* ------------------------------------------------------------------ */

export type ImportOutcome =
  | { kind: "preview"; preview: ImportPreview }
  | { kind: "committed"; summary: ImportCommitSummary }
  | null;

/**
 * Import members. One submission is one validated pass:
 *  - clean file          → committed immediately,
 *  - invalid rows, no    → rejected in full with a per-row error list
 *    "skipInvalid" box     (nothing written),
 *  - invalid rows, with  → valid rows committed, invalid skipped and
 *    the box               reported.
 * The client keeps one batch key per file so a retried submission
 * replays the same summary instead of double-importing.
 */
export async function importMembersAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireStaffAction();
  if (!guard.ok) return toFormState(guard);

  const domainId = String(formData.get("domainId") ?? "");
  if (!UUID.test(domainId)) return { status: "error", message: "Invalid domain." };

  const batchKey = String(formData.get("batchKey") ?? "");
  if (!/^[\w-]{8,72}$/.test(batchKey)) {
    return { status: "error", message: "Pick the file and submit again." };
  }
  const skipInvalid = String(formData.get("skipInvalid") ?? "") === "true";
  const corrId = newCorrelationId();

  if (!skipInvalid) {
    // Preview first so invalid rows are listed with nothing written.
    const preview = await previewImport(guard.data, domainId, formData);
    if (preview.ok) {
      if (preview.data.invalidCount > 0) {
        revalidatePath(`/admin/domains/${domainId}`);
        return {
          status: "error",
          message: "Import rejected: the file has invalid rows. Fix them, or tick “Import valid rows only”.",
          data: { preview: preview.data },
        };
      }
      if (preview.data.rows.length === 0 && preview.data.existsCount === 0) {
        return { status: "error", message: "No member rows found in this file." };
      }
    }
    // Clean (or not-found) previews continue into the commit below.
  }

  const committed = await commitImport(guard.data, domainId, batchKey, formData.get("file"), skipInvalid, corrId);
  if (committed.ok) {
    invalidateAfterWrite(domainId);
    const s = committed.data;
    return {
      status: "ok",
      message: `Imported ${s.created} new member row${s.created === 1 ? "" : "s"} (${s.reactivated} restored, ${s.skipped} skipped, ${s.scoredRows} scored).`,
      data: { summary: s },
    };
  }
  return {
    status: "error",
    message: committed.message,
    fields: committed.fields,
    data: { code: committed.code, kind: "import" },
  };
}

/* ------------------------------------------------------------------ */
/* Staff appointments (President / VP only)                            */
/* ------------------------------------------------------------------ */

export async function provisionStaffAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireGlobalAction();
  if (!guard.ok) return toFormState(guard);
  const corrId = newCorrelationId();
  const result = await provisionStaff(guard.data, formData.get("email"), corrId);
  if (result.ok) {
    return {
      status: "ok",
      message: result.data.created
        ? `${result.data.email} provisioned. Now appoint a role.`
        : `${result.data.email} already exists.`,
    };
  }
  return { status: "error", message: result.message, fields: result.fields };
}

export async function appointGlobalRoleAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireGlobalAction();
  if (!guard.ok) return toFormState(guard);
  const role = String(formData.get("role") ?? "");
  if (role !== "PRESIDENT" && role !== "VICE_PRESIDENT") {
    return { status: "error", message: "Choose a role." };
  }
  const corrId = newCorrelationId();
  const result = await appointGlobalRole(
    guard.data,
    formData.get("email"),
    role as "PRESIDENT" | "VICE_PRESIDENT",
    corrId,
  );
  if (result.ok) return { status: "ok", message: `${role === "PRESIDENT" ? "President" : "Vice President"} appointed.` };
  return { status: "error", message: result.message, fields: result.fields };
}

export async function revokeGlobalRoleAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireGlobalAction();
  if (!guard.ok) return toFormState(guard);
  const corrId = newCorrelationId();
  const result = await revokeGlobalRole(guard.data, String(formData.get("assignmentId") ?? ""), corrId);
  if (result.ok) return { status: "ok", message: "Global role revoked." };
  return { status: "error", message: result.message };
}

export async function appointDomainRoleAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireGlobalAction();
  if (!guard.ok) return toFormState(guard);
  const role = String(formData.get("role") ?? "LEAD") === "CO_LEAD" ? "CO_LEAD" : "LEAD";
  const corrId = newCorrelationId();
  const result = await appointDomainRole(
    guard.data,
    String(formData.get("domainId") ?? ""),
    formData.get("email"),
    role as "LEAD" | "CO_LEAD",
    corrId,
  );
  if (result.ok) return { status: "ok", message: `${role === "LEAD" ? "Lead" : "Co-lead"} appointed.` };
  return { status: "error", message: result.message, fields: result.fields };
}

export async function revokeDomainRoleAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const guard = await requireGlobalAction();
  if (!guard.ok) return toFormState(guard);
  const corrId = newCorrelationId();
  const result = await revokeDomainRole(guard.data, String(formData.get("assignmentId") ?? ""), corrId);
  if (result.ok) return { status: "ok", message: "Domain assignment revoked." };
  return { status: "error", message: result.message };
}
