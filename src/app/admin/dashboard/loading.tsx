import { AdminShellSkeleton, GridListSkeleton, DivideListSkeleton, StatCardsSkeleton } from "@/components/skeletons";

/** Mirrors /admin/dashboard: 3 stat cards, domain grid, activity list. */
export default function AdminDashboardLoading() {
  return (
    <AdminShellSkeleton>
      <StatCardsSkeleton />
      <div className="space-y-2">
        <div className="h-4 w-24 motion-safe:animate-pulse rounded bg-surface" />
        <GridListSkeleton />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-28 motion-safe:animate-pulse rounded bg-surface" />
        <DivideListSkeleton />
      </div>
    </AdminShellSkeleton>
  );
}
