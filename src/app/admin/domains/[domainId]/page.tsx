import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, FileUp } from "lucide-react";
import { requireDomainManagerPage } from "@/lib/auth/guards";
import { listDomainMembers } from "@/lib/services/members";
import { prisma } from "@/lib/db";
import { StaffContext } from "@/lib/auth/session";
import { AdminShell } from "@/components/admin/shell";
import { Card, Badge, SectionTitle } from "@/components/ui";
import { AddMembersButton } from "@/components/admin/add-members-modal";
import { AdjustScoreControls } from "@/components/admin/adjust-score";
import { MemberRowControls } from "@/components/admin/member-controls";

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
      {/* Toolbar: compact actions above the table; all add/import flows
          live in popups so the page never overflows. */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <AddMembersButton domainId={domain.id} />
        <a
          href={exportHref}
          download
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-accent-soft"
        >
          <Download size={15} aria-hidden="true" />
          Export (.xlsx)
        </a>
        {isGlobal ? (
          <span className="text-xs text-muted">
            Need all domains in one file?{" "}
            <a href="/admin/export?domain=all" download className="font-medium text-accent-dark underline underline-offset-2">
              All-domains export
            </a>
          </span>
        ) : null}
      </div>

      <section aria-label="Domain members" className="space-y-2">
        <SectionTitle>Members ({members.length})</SectionTitle>
        {members.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              No members yet — use “Add members” above or import from a spreadsheet.
            </p>
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            {/* min-w keeps columns usable on narrow screens; the card
                scrolls horizontally instead of overflowing the page. */}
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Domain members with points and scoring controls</caption>
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-faint">
                  <th scope="col" className="w-10 px-2 py-2">#</th>
                  <th scope="col" className="px-2 py-2">Name</th>
                  <th scope="col" className="w-32 px-2 py-2">Roll</th>
                  <th scope="col" className="w-24 px-2 py-2 text-right">Points</th>
                  {!isGlobal ? <th scope="col" className="w-32 px-2 py-2 text-right sm:w-40">Assign points</th> : null}
                  <th scope="col" className="w-40 px-2 py-2 text-right sm:w-48">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {members.map((m, i) => (
                  <tr key={m.membershipId} className="align-top">
                    <td className="px-2 py-2 text-xs tabular-nums text-faint">{i + 1}</td>
                    <td className="break-words px-2 py-2 font-medium">{m.name}</td>
                    <td className="px-2 py-2 text-xs text-muted">{m.rollNumber}</td>
                    <td className="table-cell-numeric px-2 py-2 font-semibold">{m.points}</td>
                    {!isGlobal ? <td className="px-2 py-2 text-right"><AdjustScoreControls membershipId={m.membershipId} /></td> : null}
                    <td className="px-2 py-2 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        <MemberRowControls
                          membershipId={m.membershipId}
                          memberId={m.memberId}
                          name={m.name}
                          removed={m.status !== "ACTIVE"}
                          canViewScoreHistory
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* Excel requirements live inside the Add members popup. Rendering
          the ImportPanel instance here would duplicate the flow, but the
          failing-parse diagnostics belonged to the import surface — they
          are surfaced from the Excel tab only. */}
      <ImportRequirementsNote />
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

function ImportRequirementsNote() {
  return (
    <p className="text-xs text-faint">
      Spreadsheet requirements (columns, limits, error handling) are listed in the “Add members → Excel upload” popup.
    </p>
  );
}
