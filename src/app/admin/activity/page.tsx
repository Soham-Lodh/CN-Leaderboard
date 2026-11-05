import type { Metadata } from "next";
import { requireGlobalStaffPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { AdminShell } from "@/components/admin/shell";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Leadership activity · Staff", robots: { index: false, follow: false } };

const roles = ["PRESIDENT", "VICE_PRESIDENT", "LEAD", "CO_LEAD"] as const;

export default async function LeadershipActivityPage({ searchParams }: { searchParams: Promise<{ domain?: string; role?: string }> }) {
  const ctx = await requireGlobalStaffPage();
  const params = await searchParams;
  const selectedRole = roles.includes(params.role as (typeof roles)[number]) ? params.role! : "";
  // The domain list and the event page are independent reads.
  const [domains, events] = await Promise.all([
    prisma.domain.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.auditEvent.findMany({
    where: {
      domainId: params.domain || undefined,
      ...(selectedRole === "PRESIDENT" || selectedRole === "VICE_PRESIDENT"
        ? { actorStaffAccount: { globalRoleAssignments: { some: { role: selectedRole as "PRESIDENT" | "VICE_PRESIDENT", revokedAt: null } } } }
        : selectedRole
          ? { actorStaffAccount: { domainAssignments: { some: { role: selectedRole as "LEAD" | "CO_LEAD", revokedAt: null } } } }
          : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
      select: { id: true, action: true, targetType: true, targetId: true, createdAt: true, domain: { select: { name: true } }, actorEmailSnapshot: true, metadata: true, beforeState: true, afterState: true },
    }),
  ]);
  return <AdminShell title="Leadership activity" description="All recorded work by Presidents, Vice Presidents, leads, and co-leads." context={{ globalRole: ctx.globalRole, domains: domains.map((d) => ({ id: d.id, name: d.name })) }}>
    <Card>
      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" method="get">
        <label className="space-y-1 text-sm"><span className="block font-medium">Domain</span><select name="domain" defaultValue={params.domain ?? ""} className="input-base"><option value="">All domains</option>{domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="block font-medium">Role</span><select name="role" defaultValue={selectedRole} className="input-base"><option value="">All roles</option>{roles.map((role) => <option key={role} value={role}>{role.replace("_", " ")}</option>)}</select></label>
        <button className="min-h-11 self-end rounded-lg bg-accent px-4 text-sm font-semibold text-white" type="submit">Filter</button>
      </form>
    </Card>
    <Card><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase tracking-wide text-faint"><th className="px-2 py-2">When</th><th className="px-2 py-2">Actor</th><th className="px-2 py-2">Action</th><th className="px-2 py-2">Domain</th><th className="px-2 py-2">Target</th></tr></thead><tbody className="divide-y divide-line">{events.map((event) => <tr key={event.id}><td className="px-2 py-2 text-xs text-muted">{event.createdAt.toLocaleString("en-IN")}</td><td className="px-2 py-2">{event.actorEmailSnapshot ?? "System"}</td><td className="px-2 py-2 font-medium">{event.action.replace(/_/g, " ")}</td><td className="px-2 py-2">{event.domain?.name ?? "Global"}</td><td className="px-2 py-2 text-xs text-muted">{event.targetType} · {event.targetId}</td></tr>)}</tbody></table></div>{events.length === 0 ? <p className="text-sm text-muted">No activity matches these filters.</p> : null}</Card>
  </AdminShell>;
}
