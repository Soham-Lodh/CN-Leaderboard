import { AdminShellSkeleton, CardSkeleton, TableSkeleton } from "@/components/skeletons";

/** Mirrors /admin/audit: domain pill nav, stats grid, ledger table. */
export default function AdminAuditLoading() {
  return (
    <AdminShellSkeleton>
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 w-24 motion-safe:animate-pulse rounded-full border border-line bg-surface" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <CardSkeleton key={i} className="px-5 py-5">
            <div className="h-3 w-24 motion-safe:animate-pulse rounded bg-surface" />
            <div className="mt-2 h-5 w-14 motion-safe:animate-pulse rounded bg-surface" />
          </CardSkeleton>
        ))}
      </div>
      <TableSkeleton rows={6} cols={4} />
    </AdminShellSkeleton>
  );
}
