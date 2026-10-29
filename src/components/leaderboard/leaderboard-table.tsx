import Link from "next/link";
import { SectionTitle, ScoreValue } from "../ui";
import type { LeaderboardData, PublicDomain } from "@/lib/services/leaderboard";

/**
 * Server-rendered table. Only rank/name/roll/points labels enter the
 * DOM — nothing from audit, staff or reason fields is referenced here.
 */
export function LeaderboardTable({
  data,
  domains,
  domainCount,
  query,
  pageParam,
}: {
  data: LeaderboardData;
  domains: Map<string, PublicDomain>;
  domainCount: number;
  query: string;
  pageParam: number;
}) {
  const breakdown = domainCount > 1;
  const keepQuery = (page: number) => {
    const value = query ? `&q=${encodeURIComponent(query)}` : "";
    return `?page=${page}${value}`;
  };

  if (data.rows.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-card px-6 py-16 text-center">
        <p className="text-sm font-medium">No members ranked yet</p>
        <p className="mt-1 text-sm text-muted">
          {query ? "Try a different search." : "Points appear here once staff assign them."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 overflow-hidden rounded-xl border border-line bg-card shadow-card sm:space-y-0">
      <table className="w-full text-sm sm:divide-y sm:divide-line">
        <caption className="sr-only">Leaderboard: rank, member name, roll number and total points</caption>
        <thead className="hidden sm:table-header-group">
          <tr className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-faint">
            <th scope="col" className="w-20 px-4 py-3">Rank</th>
            <th scope="col" className="px-4 py-3">Member</th>
            <th scope="col" className="w-28 px-4 py-3 text-right">Points</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line sm:divide-y-0">
          {data.rows.map((row) => (
            <tr key={row.memberId} className="block px-4 py-3 sm:table-row sm:px-0 sm:py-0 hover:bg-surface/60 transition-colors">
              <td className="inline-flex items-center gap-1 pb-1 pl-0 pr-1 sm:table-cell sm:w-20 sm:px-4 sm:py-3">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface text-xs font-semibold tabular-nums">
                  {row.rank}
                </span>
              </td>
              <td className="sm:px-4 sm:py-3">
                <span className="block text-sm font-medium">{row.name}</span>
                <span className="block text-xs text-muted sm:hidden">Roll {row.rollNumber}</span>
                <span className="hidden text-xs text-muted sm:block">Roll {row.rollNumber}</span>
                {breakdown && row.breakdown.length > 0 ? (
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-dashed border-line pt-1.5 text-xs text-muted sm:hidden">
                    {row.breakdown.map((score) => (
                      <li key={score.domainId} className="whitespace-nowrap">
                        {domains.get(score.domainId)?.name ?? "Domain"}: {score.points}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </td>
              <td className="sm:w-28 sm:px-4 sm:py-3 sm:text-right">
                <span className="text-xs text-muted sm:hidden">Points </span>
                <span className="font-semibold tabular-nums">{row.points}</span>
                {breakdown && row.breakdown.length > 0 ? (
                  <ul className="mt-1 flex flex-wrap justify-end gap-x-3 border-t border-dashed border-line pt-1.5 text-xs">
                    {row.breakdown.map((score) => (
                      <li key={score.domainId} className="whitespace-nowrap text-muted">
                        <span className="text-faint sm:hidden">{domains.get(score.domainId)?.name}</span>
                        <ScoreValue value={score.points} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.totalPages > 1 ? (
        <nav aria-label="Leaderboard pages" className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
          {pageParam > 1 ? (
            <Link href={keepQuery(pageParam - 1)} className="min-h-11 rounded-lg px-3 font-medium text-accent-dark hover:bg-surface">
              Previous
            </Link>
          ) : (
            <span className="px-3 opacity-40" aria-hidden="true">Previous</span>
          )}
          <span className="text-xs text-muted">
            Page {data.page} of {data.totalPages} · {data.totalMembers} members
          </span>
          {pageParam < data.totalPages ? (
            <Link href={keepQuery(pageParam + 1)} className="min-h-11 rounded-lg px-3 font-medium text-accent-dark hover:bg-surface">
              Next
            </Link>
          ) : (
            <span className="px-3 opacity-40" aria-hidden="true">Next</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}

export { SectionTitle };
