import { AdminShellSkeleton, CardSkeleton, DivideListSkeleton } from "@/components/skeletons";

/** Mirrors /admin/staff: provision card, appoint cards, overview list. */
export default function AdminStaffLoading() {
  return (
    <AdminShellSkeleton>
      <CardSkeleton className="px-5 py-5">
        <div className="h-3 w-40 motion-safe:animate-pulse rounded bg-surface" />
        <div className="mt-3 h-10 w-64 motion-safe:animate-pulse rounded bg-surface" />
        <div className="mt-3 h-11 w-28 motion-safe:animate-pulse rounded-lg bg-surface" />
      </CardSkeleton>
      <CardSkeleton className="px-5 py-5">
        <div className="h-3 w-48 motion-safe:animate-pulse rounded bg-surface" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="h-10 motion-safe:animate-pulse rounded bg-surface" />
          <div className="h-10 motion-safe:animate-pulse rounded bg-surface" />
        </div>
        <div className="mt-3 h-11 w-28 motion-safe:animate-pulse rounded-lg bg-surface" />
      </CardSkeleton>
      <DivideListSkeleton rows={5} />
    </AdminShellSkeleton>
  );
}
