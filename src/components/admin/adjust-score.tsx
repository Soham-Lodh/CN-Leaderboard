"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { adjustScoreAction } from "@/app/admin/actions";
import { MIN_DELTA, MAX_DELTA } from "@/lib/constants";

type FormState = { status: "idle" | "ok" | "error"; message: string; data?: Record<string, unknown> };

/** Compact row action; the full score form lives in a focused popup. */
export function AdjustScoreControls({ membershipId }: { membershipId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(adjustScoreAction, { status: "idle", message: "" });
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const deltaId = useId();
  const reasonId = useId();
  const deltaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setIdempotencyKey(crypto.randomUUID());
    deltaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (state.status === "ok") {
      setOpen(false);
    }
  }, [state.status]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="min-h-8 whitespace-nowrap rounded-lg bg-accent px-2.5 text-xs font-semibold text-white hover:bg-accent-dark">
        Add points
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby={`${deltaId}-title`} className="w-full max-w-sm rounded-2xl border border-line bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div><h2 id={`${deltaId}-title`} className="text-lg font-semibold">Add points</h2><p className="mt-1 text-sm text-muted">Use a positive or negative value. Reason is optional.</p></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="min-h-9 rounded-lg px-2 text-lg text-muted hover:bg-surface">×</button>
            </div>
            <form action={formAction} className="mt-5 space-y-4">
              <input type="hidden" name="membershipId" value={membershipId} />
              <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
              <label htmlFor={deltaId} className="block space-y-1 text-sm font-medium">Points change
                <input ref={deltaRef} id={deltaId} name="delta" type="number" required min={MIN_DELTA} max={MAX_DELTA} step={1} inputMode="numeric" className="input-base" placeholder="e.g. 10 or -5" />
              </label>
              <label htmlFor={reasonId} className="block space-y-1 text-sm font-medium">Reason <span className="font-normal text-muted">(optional)</span>
                <input id={reasonId} name="reason" type="text" maxLength={200} className="input-base" placeholder="Why are points being changed?" />
              </label>
              {state.status === "error" ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-lg border border-line px-4 text-sm font-medium text-muted hover:bg-surface">Cancel</button>
                <button type="submit" disabled={pending} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-60">{pending ? "Saving…" : "Save points"}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
