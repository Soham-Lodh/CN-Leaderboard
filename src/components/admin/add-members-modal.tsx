"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { addMemberAction } from "@/app/admin/actions";
import { Modal } from "./modal";
import { ImportPanel } from "./import-panel";
import { ActionForm } from "./action-form";

function makeIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `add-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * "Add members" toolbar button opening one modal with two tabs:
 *  - Manual: name + roll number form (idempotent, one key per logical
 *    addition; a conflict regenerates a fresh key),
 *  - Excel: upload spreadsheet with the full sheet requirements listed.
 * Keeping both flows in a popup removes the always-expanded form
 * section that crowded the member table.
 */
export function AddMembersButton({ domainId }: { domainId: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"manual" | "excel">("manual");
  const [idempotencyKey, setIdempotencyKey] = useState(makeIdempotencyKey);

  const tabs = [
    { id: "manual" as const, label: "Manual details" },
    { id: "excel" as const, label: "Excel upload" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTab("manual");
          setOpen(true);
        }}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
      >
        <Plus size={16} aria-hidden="true" />
        Add members
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add members"
        description="Add members one by one or import a whole spreadsheet."
      >
        <div
          role="tablist"
          aria-label="Member addition methods"
          className="mb-4 flex rounded-lg border border-line bg-surface p-1"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              id={`add-members-tab-${t.id}`}
              aria-controls={`add-members-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`min-h-10 flex-1 rounded-md px-3 text-sm font-semibold transition-colors ${
                tab === t.id ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "manual" ? (
          <div
            id="add-members-panel-manual"
            role="tabpanel"
            aria-labelledby="add-members-tab-manual"
          >
            <ActionForm
              action={addMemberAction}
              submitLabel="Add member"
              className="space-y-4"
              onSuccess={() => {
                setOpen(false);
                setIdempotencyKey(makeIdempotencyKey());
              }}
              onIdempotencyConflict={() => setIdempotencyKey(makeIdempotencyKey())}
            >
              <input type="hidden" name="domainId" value={domainId} />
              <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
              <label className="block space-y-1">
                <span className="text-sm font-medium">Name</span>
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="off"
                  className="input-base"
                  placeholder="Full name"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Roll number</span>
                <input
                  name="rollNumber"
                  required
                  maxLength={40}
                  autoComplete="off"
                  className="input-base"
                  placeholder="e.g. CS2202001"
                />
              </label>
              <p className="text-xs text-muted">
                Existing chapter members are re-used instead of duplicated; a previously removed
                member’s slot in this domain is restored.
              </p>
            </ActionForm>
          </div>
        ) : (
          <div
            id="add-members-panel-excel"
            role="tabpanel"
            aria-labelledby="add-members-tab-excel"
          >
            <ImportPanel domainId={domainId} />
          </div>
        )}
      </Modal>
    </>
  );
}
