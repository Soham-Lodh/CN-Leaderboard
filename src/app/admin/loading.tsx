import { AdminShellSkeleton, CardSkeleton } from "@/components/skeletons";

/**
 * Generic staff-area skeleton. Covers the /admin gate and any admin
 * segment without its own loading.tsx; page-specific skeletons below
 * mirror their exact destination layouts.
 */
export default function AdminLoading() {
  return (
    <AdminShellSkeleton>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <CardSkeleton key={i} className="px-5 py-5">
            <div className="motion-safe:animate-pulse space-y-3">
              <div className="h-3 w-32 rounded bg-surface" />
              <div className="h-10 w-64 rounded bg-surface" />
              <div className="h-10 w-24 rounded-lg bg-surface" />
            </div>
          </CardSkeleton>
        ))}
      </div>
    </AdminShellSkeleton>
  );
}
