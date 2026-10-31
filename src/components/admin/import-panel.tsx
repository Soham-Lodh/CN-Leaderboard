"use client";

import { useActionState, useId, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { importMembersAction } from "@/app/admin/actions";
import { Badge } from "../ui";

type PreviewRow = {
  row: number;
  name?: string;
  rollNumber?: string;
  points?: number;
  status: "ok" | "error" | "exists";
  warnings: string[];
  errors: string[];
};

type PreviewData = {
  filename: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  existsCount: number;
  globalErrors: string[];
  rows?: PreviewRow[];
};

function makeBatchKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Excel import with the PRD contract: any invalid row rejects the file
 * in full; the "import valid rows only" checkbox opts into skipping
 * them. The same batch key rides every submission of one picked file
 * so a retried upload replays instead of double-importing.
 */
export function ImportPanel({ domainId, canViewAudit = false }: { domainId: string; canViewAudit?: boolean }) {
  const [state, formAction, pending] = useActionState(importMembersAction, { status: "idle", message: "" });
  const [filePicked, setFilePicked] = useState<string | null>(null);
  const batchKey = useMemo(makeBatchKey, [filePicked]);
  const inputId = useId();

  const preview = (state.data?.preview ?? null) as PreviewData | null;
  const committedKinds = state.status === "ok";

  return (
    <form action={formAction} className="space-y-3" aria-label="Import members from Excel">
      <input type="hidden" name="domainId" value={domainId} />
      <input type="hidden" name="batchKey" value={batchKey} />
      <div>
        <label htmlFor={inputId} className="block text-sm font-medium">
          Members spreadsheet (.xlsx, up to 500 data rows, max 5 MB)
        </label>
        <input
          id={inputId}
          type="file"
          name="file"
          required
          accept=".xlsx,.xlsx"
          onChange={(e) => setFilePicked(e.target.files?.[0]?.name ?? null)}
          className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:text-sm file:font-semibold file:text-accent-dark"
        />
        <p className="mt-1 text-xs text-muted">
          Need a starting file? <a href="/admin/export/template" download className="font-medium text-accent-dark underline underline-offset-2">Download the template spreadsheet</a>.
          First row must be headers: <code className="font-mono">name</code> and <code className="font-mono">roll number</code>{" "}
          (accepts <code className="font-mono">roll number</code>, <code className="font-mono">roll_number</code>, and{" "}
          <code className="font-mono">rollno</code> spellings too). Optional columns: <code className="font-mono">points</code>{" "}
          (also <code className="font-mono">initial_points</code>, starting points for new/returned members) and{" "}
          <code className="font-mono">reason</code>. Duplicates in the file, or members already active in this domain,
          are reported and skipped. Formula cells are not allowed.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" name="skipInvalid" value="true" className="mt-0.5 h-4 w-4 accent-[#e8541e]" />
        <span>
          Import valid rows only and skip invalid ones
          <span className="block text-xs">Leave unticked to reject the whole file when any row is invalid.</span>
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {pending ? "Checking file…" : "Validate & import"}
      </button>

      {state.status !== "idle" && state.message ? (
        <p
          role="status"
          className={
            state.status === "ok"
              ? "flex items-start gap-2 text-sm font-medium text-success"
              : "flex items-start gap-2 text-sm font-medium text-danger"
          }
        >
          {state.status === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          {state.message}
        </p>
      ) : null}

      {preview && (preview.globalErrors.length > 0 || preview.rows?.some((r) => r.errors.length > 0)) ? (
        <div className="rounded-lg border border-danger/30 bg-red-50 p-3 text-xs text-danger">
          {preview.globalErrors.map((err, i) => (
            <p key={i} className="font-medium">
              {err}
            </p>
          ))}
          <ul className="mt-1 space-y-0.5">
            {preview.rows
              ?.filter((r) => r.errors.length > 0)
              .map((r) => (
                <li key={r.row}>
                  Row {r.row}: {r.errors.join("; ")}
                  {r.name ? ` (${r.name})` : ""}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {committedKinds && preview === null ? (
        <Badge tone="success">Import complete</Badge>
      ) : null}

      {pending ? (
        <p aria-live="polite" className="text-xs text-muted">
          Files are parsed server-side; this can take a few seconds for 500 rows.
        </p>
      ) : null}

      {canViewAudit ? <p className="text-xs text-faint"><Link href="/admin/audit" className="underline underline-offset-2">Audit view</Link>{" "}shows per-member reasons afterwards.</p> : null}
    </form>
  );
}
