import { AdminShellSkeleton, TableSkeleton } from "@/components/skeletons";

/** Mirrors /admin/activity: filter card + event table. */
export default function AdminActivityLoading() {
  return (
    <AdminShellSkeleton>
      <div className="rounded-xl border border-line bg-card px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="h-10 motion-safe:animate-pulse rounded bg-surface" />
          <div className="h-10 motion-safe:animate-pulse rounded bg-surface" />
          <div className="h-11 w-24 motion-safe:animate-pulse self-end rounded-lg bg-surface" />
        </div>
      </div>
      <TableSkeleton rows={8} cols={5} />
    </AdminShellSkeleton>
  );
}
