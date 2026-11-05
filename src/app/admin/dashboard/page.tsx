import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, cache } from "react";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { requireStaffPage } from "@/lib/auth/guards";
import {
  dashboardRoleLabel,
  getDashboardDomains,
  getDashboardRecentAudits,
  getDashboardStats,
} from "@/lib/services/dashboard";
import { AdminShell } from "@/components/admin/shell";
import { Card } from "@/components/ui";
import { PendingLink } from "@/components/nav-link";
import {
  DivideListSkeleton,
  GridListSkeleton,
  Skeleton,
  StatCardsSkeleton,
} from "@/components/skeletons";

export const metadata: Metadata = {
  title: "Dashboard · Staff",
  robots: { index: false, follow: false },
};

/** Entry point for appointed staff. Fresh reads; no caching. */
export default async function AdminDashboardPage() {
  const ctx = await requireStaffPage();
  const global = ctx.isGlobalLeader;

  // Shared per-request fetcher: the stat card, the domain list and the
  // footer all resolve my-domains with one DB round trip.
  const myDomains = cache(() => getDashboardDomains(ctx));
  const roleLabel = dashboardRoleLabel(ctx);

  async function Stats() {
    const stats = await getDashboardStats(ctx);
    const domains = await myDomains();
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Active members</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{stats.activeMemberCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Domain {global ? "s created" : "s assigned"}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{domains.length}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Scope</p>
          <p className="mt-1 text-2xl font-semibold">
            {global ? "All domains" : domains.length === 1 ? domains[0]!.name : "Assigned domains"}
          </p>
        </Card>
      </div>
    );
  }

  async function YourDomains() {
    const domains = await myDomains();
    return (
      <section aria-label="Your domains" className="space-y-2">
        <h2 className="text-base font-semibold">Your domains</h2>
        {domains.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              You have no domain assignments yet. Ask the President to assign you one.
            </p>
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {domains.map((d) => (
              <Card key={d.id} className="!p-0">
                <PendingLink
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
                </PendingLink>
              </Card>
            ))}
          </ul>
        )}
      </section>
    );
  }

  async function RecentActivity() {
    const recentAudits = await getDashboardRecentAudits(ctx);
    return (
      <section aria-label="Recent activity" className="space-y-2">
        <h2 className="text-base font-semibold">Recent activity</h2>
        {recentAudits.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No activity in your visible domains yet.</p>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y divide-line text-sm">
              {recentAudits.map((e) => (
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
    );
  }

  async function FooterDomains() {
    const domains = await myDomains();
    if (domains.length === 0) return null;
    return (
      <span className="hidden sm:inline">
        Domains:{" "}
        {domains.map((d, i) => (
          <span key={d.id}>
            {i > 0 ? " · " : ""}
            {d.name}
          </span>
        ))}
      </span>
    );
  }

  return (
    <AdminShell
      title={`Welcome${ctx.displayName ? `, ${ctx.displayName.split(" ")[0]}` : ""}`}
      description={roleLabel}
      context={{
        globalRole: ctx.globalRole === "PRESIDENT" || ctx.globalRole === "VICE_PRESIDENT" ? ctx.globalRole : null,
        domains: [],
      }}
      footerRight={
        <Suspense fallback={null}>
          <FooterDomains />
        </Suspense>
      }
    >
      <Suspense fallback={<StatCardsSkeleton />}>
        <Stats />
      </Suspense>

      <Suspense fallback={
        <section aria-label="Your domains" className="space-y-2">
          <Skeleton className="h-4 w-24 rounded" />
          <GridListSkeleton />
        </section>
      }>
        <YourDomains />
      </Suspense>

      <Suspense fallback={
        <section aria-label="Recent activity" className="space-y-2">
          <Skeleton className="h-4 w-28 rounded" />
          <DivideListSkeleton />
        </section>
      }>
        <RecentActivity />
      </Suspense>

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
