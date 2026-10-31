"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { adjustScoreAction } from "@/app/admin/actions";
import { MIN_DELTA, MAX_DELTA } from "@/lib/constants";
import { Modal } from "./modal";

type FormState = { status: "idle" | "ok" | "error"; message: string; data?: Record<string, unknown> };

function isIdempotencyConflict(state: FormState): boolean {
  return state.status === "error" && (state.data?.code as string | undefined) === "IDEMPOTENCY_CONFLICT";
}

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
  }, [open]);

  useEffect(() => {
    if (state.status === "ok") setOpen(false);
    if (isIdempotencyConflict(state)) {
      // The stored key belongs to a different payload (e.g. the user
      // edited the delta after an error); regenerate for this intent.
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [state]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="min-h-8 whitespace-nowrap rounded-lg bg-accent px-2.5 text-xs font-semibold text-white hover:bg-accent-dark">
        Add points
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add points" description="Use a positive or negative value. Reason is optional.">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <label htmlFor={deltaId} className="block space-y-1 text-sm font-medium">Points change
            <input ref={deltaRef} id={deltaId} name="delta" type="number" required min={MIN_DELTA} max={MAX_DELTA} step={1} inputMode="numeric" className="input-base" placeholder="e.g. 10 or -5" />
          </label>
          <label htmlFor={reasonId} className="block space-y-1 text-sm font-medium">Reason <span className="font-normal text-muted">(optional)</span>
            <input id={reasonId} name="reason" type="text" maxLength={200} className="input-base" placeholder="Why are points being changed?" />
          </label>
          {state.status === "error" && state.message ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-lg border border-line px-4 text-sm font-medium text-muted hover:bg-surface">Cancel</button>
            <button type="submit" disabled={pending} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-60">{pending ? "Saving…" : "Save points"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
