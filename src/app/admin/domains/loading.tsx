import { AdminShellSkeleton, CardSkeleton, GridListSkeleton } from "@/components/skeletons";

/** Mirrors /admin/domains: lead cards grid + domain management cards. */
export default function AdminDomainsLoading() {
  return (
    <AdminShellSkeleton>
      <CardSkeleton className="px-5 py-5">
        <div className="h-3 w-32 motion-safe:animate-pulse rounded bg-surface" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="h-10 motion-safe:animate-pulse rounded bg-surface" />
          <div className="h-10 motion-safe:animate-pulse rounded bg-surface" />
        </div>
        <div className="mt-3 h-11 w-32 motion-safe:animate-pulse rounded-lg bg-surface" />
      </CardSkeleton>
      <GridListSkeleton rows={3} />
    </AdminShellSkeleton>
  );
}
