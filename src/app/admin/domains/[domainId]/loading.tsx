import { AdminShellSkeleton, CardSkeleton, DivideListSkeleton, TableSkeleton } from "@/components/skeletons";

/** Mirrors /admin/domains/[domainId]: title, member tabs, member table. */
export default function AdminDomainDetailLoading() {
  return (
    <AdminShellSkeleton>
      <CardSkeleton className="px-5 py-5">
        <div className="h-3 w-40 motion-safe:animate-pulse rounded bg-surface" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="h-10 motion-safe:animate-pulse rounded bg-surface" />
          <div className="h-10 motion-safe:animate-pulse rounded bg-surface" />
        </div>
        <div className="mt-3 h-11 w-32 motion-safe:animate-pulse rounded-lg bg-surface" />
      </CardSkeleton>
      <DivideListSkeleton rows={3} />
      <TableSkeleton rows={6} cols={4} />
    </AdminShellSkeleton>
  );
}
