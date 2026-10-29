"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, Pencil, UserMinus, UserPlus } from "lucide-react";
import { renameMemberAction, setMembershipStatusAction } from "@/app/admin/actions";

type FormState = { status: "idle" | "ok" | "error"; message: string };

/** Edit (rename) + remove/restore for one membership row. */
export function MemberRowControls({
  membershipId,
  memberId,
  name,
  removed,
  canViewScoreHistory,
}: {
  membershipId: string;
  memberId: string;
  name: string;
  removed: boolean;
  canViewScoreHistory: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-end gap-1 text-xs">
      <RenameForm membershipId={membershipId} current={name} open={open} setOpen={setOpen} />

      <RemoveForm membershipId={membershipId} remove={!removed} />

      {canViewScoreHistory ? (
        <Link href={`/admin/audit?member=${memberId}`} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-medium text-accent-dark hover:bg-accent-soft" title="View scoring history">
          <Eye size={12} aria-hidden="true" />
          Audit
        </Link>
      ) : null}
    </div>
  );
}

function RenameForm({
  membershipId,
  current,
  open,
  setOpen,
}: {
  membershipId: string;
  current: string;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(renameMemberAction, {
    status: "idle",
    message: "",
  });
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-medium text-muted hover:bg-surface"
      >
        <Pencil size={12} aria-hidden="true" />
        Rename
      </button>
    );
  }
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="membershipId" value={membershipId} />
      <input name="name" required minLength={2} maxLength={120} defaultValue={current} className="w-40 min-h-8 rounded-lg border border-line px-2 text-xs" aria-label="Member name" />
      <button type="submit" disabled={pending} className="min-h-8 rounded-lg bg-accent px-2 font-semibold text-white disabled:opacity-60">
        {pending ? "…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="min-h-8 rounded-lg px-2 font-medium text-muted hover:bg-surface">
        Cancel
      </button>
      {state.status === "error" ? <span className="text-danger">{state.message}</span> : null}
    </form>
  );
}

function RemoveForm({ membershipId, remove }: { membershipId: string; remove: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(setMembershipStatusAction, {
    status: "idle",
    message: "",
  });
  return (
    <form action={formAction} className="inline-flex">
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="remove" value={remove ? "true" : "false"} />
      <button
        type="submit"
        disabled={pending}
        title="Never deletes points — the row is flagged out of the domain"
        className={`inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-medium hover:bg-surface ${
          remove ? "text-danger" : "text-success"
        } disabled:opacity-60`}
      >
        {remove ? <UserMinus size={12} aria-hidden="true" /> : <UserPlus size={12} aria-hidden="true" />}
        {pending ? "…" : remove ? "Remove" : "Restore"}
      </button>
      {state.status === "error" ? <span className="text-xs text-danger">{state.message}</span> : null}
    </form>
  );
}
