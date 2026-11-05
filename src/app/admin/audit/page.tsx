import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { requireStaffPage } from "@/lib/auth/guards";
import { canManageGlobal, readableDomainIds } from "@/lib/auth/policy";
import { prisma } from "@/lib/db";
import { listDomainAuditMembers } from "@/lib/services/audit-queries";
import { getMembershipLedger } from "@/lib/services/scoring";
import { AdminShell } from "@/components/admin/shell";
import { Badge, Card, ScoreValue, SectionTitle } from "@/components/ui";
import { TableSkeleton } from "@/components/skeletons";

export const metadata: Metadata = { title: "Audit · Staff", robots: { index: false, follow: false } };

interface PageProps {
  searchParams: Promise<{ domain?: string; member?: string }>;
}

/**
 * Domain audit view: members with totals plus the full append-only
 * scoring ledger for one member. Scope enforced server-side — a lead
 * can never list or open another domain's history.
 *
 * The domain resolution (required for scope gating) runs first; the
 * members table and the optional ledger then stream in behind a
 * Suspense boundary so the shell and domain pills paint immediately.
 */
export default async function AdminAuditPage({ searchParams }: PageProps) {
  const ctx = await requireStaffPage();
  const params = await searchParams;

  const domains = await prisma.domain.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const visible = domains.filter((d) => canManageGlobal(ctx) || readableDomainIds(ctx, [d.id]).length > 0);
  if (visible.length === 0) {
    return (
        <AdminShell title="Score history" description="No assigned domains exist." context={{ globalRole: null, domains: [] }}>
          <Card><p className="text-sm text-muted">No active domains exist.</p></Card>
        </AdminShell>
    );
  }

  const requestedDomain = params.domain && /^[0-9a-f-]{36}$/i.test(params.domain) ? params.domain : null;
  const domainId = visible.some((d) => d.id === requestedDomain) ? requestedDomain! : visible[0]!.id;
  const domain = visible.find((d) => d.id === domainId)!;

  async function MembersAndLedger() {
    const membersResult = await listDomainAuditMembers(ctx, domainId);

    // Optional member drill-down.
    let ledger: Awaited<ReturnType<typeof getMembershipLedger>> | null = null;
    const memberIdParam = params.member;
    if (memberIdParam && membersResult.ok) {
      const membership = await prisma.domainMembership.findFirst({
        where: { memberId: memberIdParam, domainId },
        select: { id: true },
      });
      if (membership) {
        ledger = await getMembershipLedger(ctx, membership.id);
      }
    }

    return (
      <>
      {!membersResult.ok ? (
        <Card>
          <p role="alert" className="text-sm text-danger">{membersResult.message}</p>
        </Card>
      ) : membersResult.data.rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No active members in this domain yet.</p>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Members in {domain.name} with total points</caption>
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-faint">
                <th scope="col" className="px-2 py-2">Member</th>
                <th scope="col" className="w-24 px-2 py-2 text-right">Total points</th>
                <th scope="col" className="w-28 px-2 py-2 text-right">Scoring</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {membersResult.data.rows.map((row) => (
                <tr key={row.membershipId}>
                  <td className="px-2 py-2">
                    <span className="font-medium">{row.name}</span>{" "}
                    <span className="text-xs text-muted">· {row.rollNumber}</span>
                  </td>
                  <td className="table-cell-numeric px-2 py-2 font-semibold">{row.points}</td>
                  <td className="px-2 py-2 text-right">
                    <Link
                      href={`/admin/audit?domain=${domainId}&member=${row.memberId}`}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-accent-dark hover:bg-accent-soft"
                    >
                      View scoring <ArrowRight size={12} aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}

      {ledger && ledger.ok ? (
        <section aria-label={`Scoring history for ${ledger.data.memberName}`} className="space-y-2">
          <SectionTitle>
            Scoring history — {ledger.data.memberName}{" "}
            <Link href={`/admin/audit?domain=${domainId}`} className="ml-2 text-xs font-normal text-muted underline underline-offset-2">
              (close)
            </Link>
          </SectionTitle>
          {ledger.data.entries.length === 0 ? (
            <Card>
              <p className="text-sm text-muted">No score events recorded for this member yet.</p>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">Append-only score changes for {ledger.data.memberName}</caption>
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-faint">
                    <th scope="col" className="px-2 py-2">Date</th>
                    <th scope="col" className="w-24 px-2 py-2">Change</th>
                    <th scope="col" className="px-2 py-2">Reason</th>
                    <th scope="col" className="w-44 px-2 py-2">Assigned by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledger.data.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="px-2 py-2 text-xs text-muted">
                        {new Date(e.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      </td>
                      <td className="px-2 py-2">
                        <ScoreValue value={e.delta} />
                        <span className="block text-xs text-faint">total {e.balanceAfter}</span>
                      </td>
                      <td className="px-2 py-2 text-xs">{e.reason ? e.reason : <Badge tone="muted">No reason</Badge>}</td>
                      <td className="px-2 py-2 text-xs text-muted">{e.actorName}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <p className="mt-2 text-xs text-faint">Showing up to 200 events; corrections are appended as new rows.</p>
            </Card>
          )}
        </section>
      ) : ledger && !ledger.ok ? (
        <Card>
          <p role="alert" className="text-sm text-danger">{ledger.message}</p>
        </Card>
      ) : null}
      </>
    );
  }

  return (
    <AdminShell
      title="Audit"
      description="Members with total points and the append-only scoring history."
      context={{
        globalRole: ctx.globalRole === "PRESIDENT" || ctx.globalRole === "VICE_PRESIDENT" ? ctx.globalRole : null,
        domains: visible.map((d) => ({ id: d.id, name: d.name })),
      }}
    >
      <nav aria-label="Domains" className="flex flex-wrap gap-2">
        {visible.map((d) => (
          <Link
            key={d.id}
            href={`/admin/audit?domain=${d.id}`}
            aria-current={d.id === domainId ? "page" : undefined}
            className={`min-h-9 rounded-full border px-3 text-sm ${
              d.id === domainId ? "border-accent bg-accent-soft font-semibold text-accent-dark" : "border-line bg-white text-muted hover:bg-surface"
            }`}
          >
            {d.name}
          </Link>
        ))}
      </nav>

      <Suspense fallback={
        <div aria-busy="true" aria-live="polite">
          <p className="text-sm text-muted">Loading members and scoring history for {domain.name}…</p>
          <div className="sr-only">Loading</div>
          <TableSkeleton rows={6} cols={3} />
        </div>
      }>
        <MembersAndLedger />
      </Suspense>
    </AdminShell>
  );
}
