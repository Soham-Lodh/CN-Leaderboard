import { CardSkeleton, Skeleton } from "@/components/skeletons";

/**
 * Root fallback: mirrors the static welcome page (centered logo, two
 * text blocks, button). Also covers any unmatched segment without a
 * closer loading boundary.
 */
export default function RootLoading() {
  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-8"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center justify-between py-6">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <Skeleton className="h-4 w-40 rounded" />
      </div>
      <main id="content" className="flex flex-1 flex-col items-center justify-center gap-10 py-16 text-center">
        <Skeleton className="h-24 w-64 max-w-full rounded-2xl" />
        <div className="w-full max-w-xl space-y-3">
          <Skeleton className="mx-auto h-9 w-72 max-w-full rounded-md" />
          <Skeleton className="mx-auto h-4 w-96 max-w-full rounded" />
          <Skeleton className="mx-auto h-4 w-80 max-w-full rounded" />
        </div>
        <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
          <Skeleton className="h-12 flex-1 rounded-full" />
          <Skeleton className="h-12 flex-1 rounded-full" />
        </div>
        <CardSkeleton className="w-full max-w-md px-5 py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40 rounded" />
              <Skeleton className="h-3 w-56 rounded" />
            </div>
          </div>
        </CardSkeleton>
      </main>
    </div>
  );
}
