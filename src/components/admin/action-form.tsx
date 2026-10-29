"use client";

import { useActionState } from "react";
import type { AdminFormState } from "@/app/admin/actions";

/**
 * One shared wrapper per admin mutation form: state comes from the
 * server action (useActionState), the button shows pending, and only
 * this form's own result is displayed.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  className,
  successTone = "plain",
  resetOnSuccess = false,
}: {
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  successTone?: "plain" | "accent";
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle", message: "" });

  return (
    <form action={formAction} className={className}>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
        >
          {pending ? "Working…" : submitLabel}
        </button>
        {state.status !== "idle" && state.message ? (
          <p
            role="status"
            className={
              state.status === "ok"
                ? `text-sm font-medium ${successTone === "accent" ? "text-success" : "text-muted"}`
                : "text-sm font-medium text-danger"
            }
          >
            {state.message}
          </p>
        ) : null}
        {state.fields ? (
          <p className="text-xs text-danger">
            {Object.entries(state.fields)
              .map(([field, messages]) => `${field === "_" ? "" : `${field}: `}${messages.join("; ")}`)
              .join(" — ")}
          </p>
        ) : null}
      </div>
      {resetOnSuccess && state.status === "ok" ? <input type="hidden" className="reset-signal" value="1" /> : null}
    </form>
  );
}
