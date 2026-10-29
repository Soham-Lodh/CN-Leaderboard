import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { requireStaffPage } from "@/lib/auth/guards";
import { getDashboardData } from "@/lib/services/dashboard";
import { AdminShell } from "@/components/admin/shell";
import { Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "Dashboard · Staff",
  robots: { index: false, follow: false },
};

/** Entry point for appointed staff. Fresh reads; no caching. */
export default async function AdminDashboardPage() {
  const ctx = await requireStaffPage();
  const data = await getDashboardData(ctx);

  return (
    <AdminShell
      title={`Welcome${ctx.displayName ? `, ${ctx.displayName.split(" ")[0]}` : ""}`}
      description={data.roleLabel}
      context={{
        globalRole: ctx.globalRole === "PRESIDENT" || ctx.globalRole === "VICE_PRESIDENT" ? ctx.globalRole : null,
        domains: data.myDomains.map((d) => ({ id: d.id, name: d.name })),
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Active members</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data.activeMemberCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Domain {data.global ? "s created" : "s assigned"}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{data.myDomains.length}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Scope</p>
          <p className="mt-1 text-2xl font-semibold">
            {data.global ? "All domains" : data.myDomains.length === 1 ? data.myDomains[0]!.name : "Assigned domains"}
          </p>
        </Card>
      </div>

      <section aria-label="Your domains" className="space-y-2">
        <h2 className="text-base font-semibold">Your domains</h2>
        {data.myDomains.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              You have no domain assignments yet. Ask the President to assign you one.
            </p>
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.myDomains.map((d) => (
              <Card key={d.id} className="!p-0">
                <Link
                  href={`/admin/domains/${d.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 px-5 py-4"
                >
                  <span>
                    <span className="block text-sm font-semibold">{d.name}</span>
                    <span className="block text-xs text-muted">
                      {d.role ? (d.role === "LEAD" ? "Lead" : "Co-lead") : "Viewer"} · {d.members} members
                    </span>
                  </span>
                  <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-faint" />
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Recent activity" className="space-y-2">
        <h2 className="text-base font-semibold">Recent activity</h2>
        {data.recentAudits.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No activity in your visible domains yet.</p>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-line text-sm">
              {data.recentAudits.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="font-medium">{e.action.replace(/_/g, " ").toLowerCase()}</span>
                  <span className="text-xs text-faint">
                    {e.domainName ? `${e.domainName} · ` : ""}
                    {new Date(e.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <p className="flex items-center gap-2 text-xs text-faint">
        <FileSpreadsheet size={13} aria-hidden="true" />
        Import and export spreadsheets run per domain — from the domain page.
        <Link href="/admin/domains" className="ml-1 inline-flex items-center text-accent-dark">
          Open domains <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </p>
    </AdminShell>
  );
}
