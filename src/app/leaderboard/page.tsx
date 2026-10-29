import type { Metadata } from "next";
import { LeaderboardFilters } from "@/components/leaderboard/filters";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { listActiveDomains, getLeaderboard, LEADERBOARD_PAGE_SIZE } from "@/lib/services/leaderboard";
import { leaderboardQuerySchema } from "@/lib/validation";

/**
 * No metadata: the leaderboard is a live operational page served
 * without login and must not be indexed (PRD success criteria: SEO
 * content is rendered server-side, but search engines are told to
 * skip this page; sitemap lists only the welcome page).
 */
export const metadata: Metadata = {
  title: "Leaderboard · Coding Ninjas KIIT Chapter",
  description: "Member scores across the chapter's domains, updated as staff assign points.",
  robots: { index: false, follow: false },
};

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
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Leaderboard</h1>
        <p className="text-sm text-muted">
          Scores combine every selected domain per member. Rank ties settle by roll number for stable ordering.
        </p>
      </header>

      <LeaderboardFilters domains={domains} />

      <LeaderboardTable
        data={data}
        domains={new Map(domains.map((d) => [d.id, d]))}
        domainCount={selected.length}
        query={parsed.q ?? ""}
        pageParam={parsed.page}
      />

      {data.rows.length > 0 && data.page === 1 ? (
        <p className="text-center text-xs text-faint">
          Showing {Math.min(LEADERBOARD_PAGE_SIZE, data.rows.length)} of {data.totalMembers} ranked members
        </p>
      ) : null}
    </div>
  );
}
