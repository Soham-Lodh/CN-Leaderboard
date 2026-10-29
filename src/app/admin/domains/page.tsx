import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireGlobalStaffPage } from "@/lib/auth/guards";
import { listAdminDomains } from "@/lib/services/domains";
import { AdminShell } from "@/components/admin/shell";
import { Card, Badge, SectionTitle } from "@/components/ui";
import { ActionForm } from "@/components/admin/action-form";
import { createDomainAction, renameDomainAction, setDomainArchivedAction } from "../actions";

export const metadata: Metadata = { title: "Domains · Staff", robots: { index: false, follow: false } };

/** President/VP: full domain lifecycle management. */
export default async function AdminDomainsPage() {
  const ctx = await requireGlobalStaffPage();
  const domains = await listAdminDomains();

  return (
    <AdminShell
      title="Domains"
      description="Create, rename, archive and restore the chapter's domains."
      context={{
        globalRole: ctx.globalRole === "PRESIDENT" || ctx.globalRole === "VICE_PRESIDENT" ? ctx.globalRole : null,
        domains: [],
      }}
    >
      <Card>
        <SectionTitle>New domain</SectionTitle>
        <ActionForm key="create" action={createDomainAction} submitLabel="Create domain" className="mt-2 space-y-3" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Name</span>
              <input name="name" required minLength={2} maxLength={80} className="input-base" placeholder="e.g. Cyber Security" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Slug</span>
              <input name="slug" required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" className="input-base" placeholder="e.g. cyber-security" />
            </label>
          </div>
          <p className="text-xs text-muted">
            Creating a domain is a write to the live leaderboard schema — it will appear publicly once active and has staff assignments.
          </p>
        </ActionForm>
      </Card>

      <section className="space-y-3" aria-label="All domains">
        <SectionTitle>All domains ({domains.length})</SectionTitle>
        <ul className="grid gap-3">
          {domains.map((d) => (
            <li key={d.id}>
            <Card className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{d.name}</h3>
                    {d.archivedAt ? <Badge tone="muted">Archived</Badge> : <Badge tone="success">Active</Badge>}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-faint">{d.slug}</p>
                  {d.description ? <p className="mt-1 text-xs text-muted">{d.description}</p> : null}
                  <p className="mt-1 text-xs text-muted">
                    Lead: {d.lead ?? "None yet"}{d.coLead ? ` · Co-lead: ${d.coLead}` : ""} · {d.activeMembers} active members
                  </p>
                </div>
                <Link href={`/admin/domains/${d.id}`} className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-accent-dark">
                  Open <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>

              <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                <ActionForm action={renameDomainAction} submitLabel="Rename" className="space-y-2">
                  <input type="hidden" name="domainId" value={d.id} />
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={d.name}
                    aria-label={`Rename ${d.name}`}
                    className="input-base"
                  />
                </ActionForm>
                <ActionForm action={setDomainArchivedAction} submitLabel={d.archivedAt ? "Restore" : "Archive"} className="space-y-2">
                  <input type="hidden" name="domainId" value={d.id} />
                  <input type="hidden" name="archived" value={d.archivedAt ? "false" : "true"} />
                  <p className="text-xs text-muted">
                    {d.archivedAt
                      ? "Restoring makes the domain publicly visible again."
                      : "Archiving hides the domain from the public leaderboard. Members and their scores are kept."}
                  </p>
                </ActionForm>
              </div>
            </Card>
            </li>
          ))}
        </ul>
      </section>
    </AdminShell>
  );
}
