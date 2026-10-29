import type { Metadata } from "next";
import { requireGlobalStaffPage } from "@/lib/auth/guards";
import { listStaffOverview } from "@/lib/services/staff";
import { prisma } from "@/lib/db";
import { AdminShell } from "@/components/admin/shell";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { ActionForm } from "@/components/admin/action-form";
import {
  provisionStaffAction,
  appointGlobalRoleAction,
  revokeGlobalRoleAction,
  appointDomainRoleAction,
  revokeDomainRoleAction,
} from "../actions";

export const metadata: Metadata = { title: "Staff · Admin", robots: { index: false, follow: false } };

/** President/VP: provision staff, appoint/revoke roles. */
export default async function AdminStaffPage() {
  const ctx = await requireGlobalStaffPage();
  const overview = await listStaffOverview();
  const domains = await prisma.domain.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const isSelf = (id: string) => id === ctx.staffAccountId;

  return (
    <AdminShell
      title="Staff"
      description="Provision institutional emails, appoint President/VP, and assign domain leads. Every change is audited."
      context={{
        globalRole: ctx.globalRole === "PRESIDENT" || ctx.globalRole === "VICE_PRESIDENT" ? ctx.globalRole : null,
        domains: [],
      }}
    >
      <Card>
        <SectionTitle>Provision a staff account</SectionTitle>
        <ActionForm action={provisionStaffAction} submitLabel="Provision" className="mt-2 space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Institutional email</span>
            <input name="email" type="email" required maxLength={120} className="input-base max-w-md" placeholder="name@kiit.ac.in" />
          </label>
          <p className="text-xs text-muted">
            Provisioning only creates the staff record — the person gains access after they sign in with Google and an active role is assigned.
          </p>
        </ActionForm>
      </Card>

      <Card>
        <SectionTitle>Appoint President / Vice President</SectionTitle>
        <ActionForm action={appointGlobalRoleAction} submitLabel="Appoint" className="mt-2 space-y-3">
          <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Institutional email</span>
              <input name="email" type="email" required maxLength={120} className="input-base" placeholder="name@kiit.ac.in" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Role</span>
              <select name="role" required className="input-base">
                <option value="VICE_PRESIDENT">Vice President</option>
                <option value="PRESIDENT">President</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">
            The last active President cannot be revoked while they hold the role, protecting chapter continuity.
          </p>
        </ActionForm>
      </Card>

      <Card>
        <SectionTitle>Assign domain lead / co-lead</SectionTitle>
        <ActionForm action={appointDomainRoleAction} submitLabel="Assign" className="mt-2 space-y-3">
          <div className="grid gap-3 sm:max-w-2xl sm:grid-cols-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Institutional email</span>
              <input name="email" type="email" required maxLength={120} className="input-base" placeholder="name@kiit.ac.in" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Domain</span>
              <select name="domainId" required className="input-base">
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Role</span>
              <select name="role" className="input-base">
                <option value="LEAD">Lead</option>
                <option value="CO_LEAD">Co-lead</option>
              </select>
            </label>
          </div>
        </ActionForm>
      </Card>

      <section aria-label="Staff roster" className="space-y-2">
        <SectionTitle>Roster ({overview.rows.length})</SectionTitle>
        <ul className="grid gap-3">
          {overview.rows.map((s) => (
            <li key={s.id}>
              <Card className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{s.displayName ?? s.email}</span>
                      {s.globalRole ? <Badge tone="accent">{s.globalRole === "PRESIDENT" ? "President" : "Vice President"}</Badge> : null}
                      {s.status === "REVOKED" ? <Badge tone="muted">Revoked</Badge> : null}
                      {isSelf(s.id) ? <Badge tone="neutral">You</Badge> : null}
                    </div>
                    <p className="text-xs text-muted">
                      {s.email}
                      {s.lastLoginAt ? ` · last sign-in ${new Date(s.lastLoginAt).toLocaleString("en-IN", { dateStyle: "medium" })}` : " · never signed in"}
                    </p>
                    {s.domainAssignments.length > 0 ? (
                      <p className="mt-1 text-xs text-muted">
                        {s.domainAssignments.map((a) => `${a.role === "LEAD" ? "Lead" : "Co-lead"} of ${a.domainName}`).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-line pt-2">
                  {s.domainAssignments.map((a) => (
                    <ActionForm
                      key={a.assignmentId}
                      action={revokeDomainRoleAction}
                      submitLabel={`Revoke ${a.role === "LEAD" ? "Lead" : "Co-lead"} (${a.domainName})`}
                      className="inline-flex"
                    >
                      <input type="hidden" name="assignmentId" value={a.assignmentId} />
                    </ActionForm>
                  ))}
                  {s.globalRole && s.globalAssignmentId ? (
                    <ActionForm action={revokeGlobalRoleAction} submitLabel={`Revoke ${s.globalRole === "PRESIDENT" ? "President" : "VP"}`} className="inline-flex">
                      <input type="hidden" name="assignmentId" value={s.globalAssignmentId} />
                    </ActionForm>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </AdminShell>
  );
}
