/** Skeleton list while the leaderboard streams. */
export default function LeaderboardLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-8 w-44 animate-pulse rounded-md bg-surface" />
        <div className="h-4 w-72 animate-pulse rounded bg-surface" />
      </div>
      <div className="h-10 w-full animate-pulse rounded-lg bg-surface" />
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-11 w-32 animate-pulse rounded-full bg-surface" style={{ animationDelay: `${i * 70}ms` }} />
        ))}
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line bg-card">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-4 py-3">
            <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-surface" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-4 w-40 max-w-full animate-pulse rounded bg-surface" style={{ animationDelay: `${i * 60}ms` }} />
              <div className="h-3 w-24 animate-pulse rounded bg-surface" />
            </div>
            <div className="h-4 w-12 animate-pulse rounded bg-surface" />
          </li>
        ))}
      </ul>
    </div>
  );
}
