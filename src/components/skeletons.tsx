/**
 * Shared skeleton primitives used by route-level loading UIs and by
 * section-level Suspense fallbacks. Server-safe (zero client JS).
 *
 * Uses the existing design tokens (bg-surface/bg-card/border-line) and
 * respects prefers-reduced-motion via `motion-safe:animate-pulse`.
 */

export function Skeleton({
  className = "",
  delayMs = 0,
}: {
  className?: string;
  /** Stagger for large lists so rows pulse in sequence. */
  delayMs?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={`motion-safe:animate-pulse rounded bg-surface ${className}`}
      style={delayMs > 0 ? { animationDelay: `${delayMs}ms` } : undefined}
    />
  );
}

export function CardSkeleton({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return <div className={`rounded-xl border border-line bg-card ${className}`}>{children}</div>;
}

/** Title + one line of muted text (page headers, section headers). */
export function HeaderSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className={`h-8 ${wide ? "w-56" : "w-44"} max-w-full rounded-md`} />
      <Skeleton className="h-4 w-72 max-w-full rounded" />
    </div>
  );
}

/** The 3-up stat cards at the top of the admin dashboard. */
export function StatCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} className="px-5 py-5">
          <Skeleton className="h-3 w-24 rounded" delayMs={i * 70} />
          <Skeleton className="mt-2 h-7 w-16 rounded-md" delayMs={i * 70} />
        </CardSkeleton>
      ))}
    </div>
  );
}

/** Two-column card grid used for "Your domains" and similar lists. */
export function GridListSkeleton({ rows = 2, cols = 2 }: { rows?: number; cols?: 2 }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: rows * cols }).map((_, i) => (
        <li key={i}>
          <CardSkeleton className="px-5 py-4">
            <Skeleton className="h-4 w-36 max-w-full rounded" delayMs={(i % cols) * 60} />
            <Skeleton className="mt-1.5 h-3 w-24 rounded" delayMs={(i % cols) * 60} />
          </CardSkeleton>
        </li>
      ))}
    </ul>
  );
}

/** Rows inside a divide-y card, e.g. recent-activity list. */
export function DivideListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <CardSkeleton>
      <ul className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 first:pt-4 last:pb-4">
            <Skeleton className="h-4 w-40 max-w-full rounded" delayMs={i * 60} />
            <Skeleton className="h-3 w-32 shrink-0 rounded" delayMs={i * 60} />
          </li>
        ))}
      </ul>
    </CardSkeleton>
  );
}

/** Simple data table with a header row and pulsing cells. */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <CardSkeleton>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {Array.from({ length: cols }).map((_, c) => (
                <th key={c} className="px-2 py-2 text-left">
                  <Skeleton className="h-3 w-16 rounded" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c} className="px-2 py-2.5">
                    <Skeleton className={`h-3.5 ${c === 0 ? "w-28" : c % 2 === 0 ? "w-20" : "w-24"} rounded`} delayMs={r * 50} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardSkeleton>
  );
}

/**
 * The AdminShell chrome (logo, nav pills, title row) as a skeleton so
 * navigating between staff pages keeps the same frame while the
 * destination's data resolves.
 */
export function AdminShellSkeleton({
  description = true,
  children,
}: {
  /** Accessible label; nothing is rendered visually from it. */
  title?: string;
  description?: boolean;
  /** Destination-specific section skeletons. */
  children?: React.ReactNode;
}) {
  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-16 sm:px-6"
      aria-busy="true"
      aria-live="polite"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-32 rounded-md" />
          <Skeleton className="hidden h-3 w-10 rounded sm:block" />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-full" delayMs={i * 70} />
          ))}
        </div>
      </header>

      <main id="content" className="flex-1 space-y-5">
        <div className="space-y-1">
          <Skeleton className="h-7 w-48 max-w-full rounded-md" />
          {description ? <Skeleton className="h-4 w-80 max-w-full rounded" /> : null}
        </div>
        {children}
      </main>

      <footer className="mt-10 flex items-center gap-3 border-t border-line pt-4">
        <Skeleton className="h-3 w-56 rounded" />
        <Skeleton className="h-3 w-24 rounded" />
      </footer>
    </div>
  );
}
