import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, FileUp } from "lucide-react";
import { requireDomainManagerPage } from "@/lib/auth/guards";
import { listDomainMembers } from "@/lib/services/members";
import { prisma } from "@/lib/db";
import { StaffContext } from "@/lib/auth/session";
import { AdminShell } from "@/components/admin/shell";
import { Card, Badge, SectionTitle } from "@/components/ui";
import { ActionForm } from "@/components/admin/action-form";
import { ImportPanel } from "@/components/admin/import-panel";
import { AdjustScoreControls } from "@/components/admin/adjust-score";
import { MemberRowControls } from "@/components/admin/member-controls";
import { addMemberAction } from "../../actions";

interface PageProps {
  params: Promise<{ domainId: string }>;
}

export const metadata: Metadata = { title: "Domain members · Staff", robots: { index: false, follow: false } };

export default async function AdminDomainPage({ params }: PageProps) {
  const { domainId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(domainId)) notFound();

  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    select: { id: true, name: true, slug: true, archivedAt: true },
  });
  if (!domain) notFound();

  const ctx: StaffContext = await requireDomainManagerPage(domainId);
  const members = await listDomainMembers(domainId);

  const exportHref = `/admin/export?domain=${domain.slug}`;
  const isGlobal = ctx.isGlobalLeader;

  return (
    <AdminShell
      title={domain.name}
      description={`${domain.archivedAt ? "Archived — hidden from the public leaderboard. " : ""}${members.length} active members. Points include every committed event.`}
      context={{
        globalRole: isGlobal ? ctx.globalRole : null,
        domains: [{ id: domain.id, name: domain.name }],
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <SectionTitle>Add a member</SectionTitle>
          <ActionForm action={addMemberAction} submitLabel="Add member" className="mt-2 space-y-3">
            <input type="hidden" name="domainId" value={domain.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm font-medium">Name</span>
                <input name="name" required minLength={2} maxLength={120} className="input-base" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Roll number</span>
                <input name="rollNumber" required maxLength={40} className="input-base" />
              </label>
            </div>
            <p className="text-xs text-muted">Existing chapter members are re-used rather than duplicated.</p>
          </ActionForm>
        </Card>

        <Card>
          <SectionTitle>Spreadsheets</SectionTitle>
          <div className="mt-3 space-y-4">
            <ImportPanel domainId={domain.id} canViewAudit={isGlobal} />
            <a
              href={exportHref}
              download
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-accent-soft"
            >
              <Download size={15} aria-hidden="true" />
              Export this domain (.xlsx)
            </a>
            {isGlobal ? (
              <p className="text-xs text-muted">
                Need all domains in one file? Use{" "}
                <a href="/admin/export?domain=all" download className="font-medium text-accent-dark underline underline-offset-2">
                  the all-domains export
                </a>
                .
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      <section aria-label="Domain members" className="space-y-2">
        <SectionTitle>Members ({members.length})</SectionTitle>
        {members.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No members yet — add one above or import from a spreadsheet.</p>
          </Card>
        ) : (
          <Card>
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">Domain members with points and scoring controls</caption>
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-faint">
                  <th scope="col" className="w-10 px-2 py-2">#</th>
                  <th scope="col" className="px-2 py-2">Name</th>
                  <th scope="col" className="w-32 px-2 py-2">Roll</th>
                  <th scope="col" className="w-24 px-2 py-2 text-right">Points</th>
                  {!isGlobal ? <th scope="col" className="w-64 px-2 py-2 text-right">Assign points</th> : null}
                  <th scope="col" className="w-48 px-2 py-2 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.map((m, i) => (
                  <tr key={m.membershipId} className="align-top">
                    <td className="px-2 py-2 text-xs tabular-nums text-faint">{i + 1}</td>
                    <td className="px-2 py-2 font-medium">{m.name}</td>
                    <td className="px-2 py-2 text-xs text-muted">{m.rollNumber}</td>
                    <td className="table-cell-numeric px-2 py-2 font-semibold">{m.points}</td>
                    {!isGlobal ? <td className="px-2 py-2"><AdjustScoreControls membershipId={m.membershipId} /></td> : null}
                    <td className="px-2 py-2">
                      <MemberRowControls
                        membershipId={m.membershipId}
                        memberId={m.memberId}
                        name={m.name}
                        removed={m.status !== "ACTIVE"}
                        canViewScoreHistory
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <p className="flex items-center gap-2 text-xs text-faint">
        <FileUp size={13} aria-hidden="true" />
        {isGlobal
          ? "Review score changes, reasons, and assigners from the leadership audit view."
          : "You can manage members and assign positive or negative points in this domain."}
      </p>
      <Badge tone="muted">Domain {domain.slug}</Badge>
    </AdminShell>
  );
}
