import type { Metadata } from "next";
import { Suspense } from "react";
import { LeaderboardFilters } from "@/components/leaderboard/filters";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { listActiveDomains, getLeaderboard, LEADERBOARD_PAGE_SIZE } from "@/lib/services/leaderboard";
import { leaderboardQuerySchema } from "@/lib/validation";

/**
 * The leaderboard is a live operational page served
 * without login and must not be indexed (PRD success criteria: SEO
 * content is rendered server-side, but search engines are told to
 * skip this page; sitemap lists only the welcome page).
 */
export const metadata: Metadata = {
  title: "Leaderboard · Coding Ninjas KIIT Chapter",
  description: "Member scores across the chapter's domains, updated as staff assign points.",
  robots: { index: false, follow: false },
};

/**
 * Header paints immediately; the filter + standings section streams in
 * behind a Suspense boundary. The key re-arms the fallback on filter or
 * pagination changes so navigating within the leaderboard shows the
 * same skeleton shape instead of a frozen stale table.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = {
    domains: typeof params.domains === "string" ? params.domains : undefined,
    q: typeof params.q === "string" ? params.q : undefined,
    page: typeof params.page === "string" ? params.page : undefined,
  };
  const query = leaderboardQuerySchema.safeParse(raw);
  const parsed = query.success ? query.data : leaderboardQuerySchema.parse({});

  async function Standings() {
    // Unvalidated slugs never reach SQL: they are only matched against
    // the freshly cached active-domain list.
    const domains = await listActiveDomains();
    const selected =
      parsed.domains && parsed.domains.length > 0
        ? domains.filter((d) => parsed.domains!.split(",").includes(d.slug))
        : domains;
    const data = await getLeaderboard(
      selected.map((d) => d.id),
      parsed.q,
      parsed.page,
    );

    return (
      <>
        <LeaderboardFilters domains={domains} />

        <LeaderboardTable
          data={data}
          domains={new Map(domains.map((d) => [d.id, d]))}
          domainCount={selected.length}
          query={parsed.q ?? ""}
          pageParam={parsed.page}
          selectedSlugs={parsed.domains && parsed.domains.length > 0 ? parsed.domains.split(",") : []}
        />

        {data.rows.length > 0 && data.page === 1 ? (
          <p className="text-center text-xs text-faint">
            Showing {Math.min(LEADERBOARD_PAGE_SIZE, data.rows.length)} of {data.totalMembers} ranked members
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Leaderboard</h1>
        <p className="text-sm text-muted">
          Scores combine every selected domain per member. Rank ties settle by roll number for stable ordering.
        </p>
      </header>

      <Suspense
        key={`${parsed.domains ?? "all"}|${parsed.q ?? ""}|${parsed.page ?? 1}`}
        fallback={
          <div aria-busy="true" aria-live="polite">
            <FiltersSkeleton />
            <TableRowsSkeleton />
          </div>
        }
      >
        <Standings />
      </Suspense>
    </div>
  );
}


function FiltersSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-10 w-full motion-safe:animate-pulse rounded-lg bg-surface" />
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-11 w-32 motion-safe:animate-pulse rounded-full bg-surface" style={{ animationDelay: `${i * 70}ms` }} />
        ))}
      </div>
    </div>
  );
}

function TableRowsSkeleton() {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-card">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 px-4 py-3">
          {}
          <div className="h-7 w-7 shrink-0 motion-safe:animate-pulse rounded-full bg-surface" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-4 w-40 max-w-full motion-safe:animate-pulse rounded bg-surface" style={{ animationDelay: `${i * 60}ms` }} />
            <div className="h-3 w-24 motion-safe:animate-pulse rounded bg-surface" />
          </div>
          <div className="h-4 w-12 motion-safe:animate-pulse rounded bg-surface" />
        </li>
      ))}
    </ul>
  );
}

