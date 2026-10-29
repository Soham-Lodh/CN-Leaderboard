import { NextRequest, NextResponse } from "next/server";
import { getLeaderboard, listActiveDomains } from "@/lib/services/leaderboard";
import { leaderboardQuerySchema } from "@/lib/validation";

/**
 * Read-only public JSON feed of the same cached leaderboard DTO the
 * page uses. Queries are validated; no auth and no writes are ever
 * accepted here (untrusted clients cannot cause cache misses at
 * attacker-chosen keys beyond normal size limits, and the response
 * body contains only public fields).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const parsed = leaderboardQuerySchema.safeParse({
    domains: url.searchParams.get("domains") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
  });
  const query = parsed.success ? parsed.data : leaderboardQuerySchema.parse({});

  const domains = await listActiveDomains();
  const selected =
    query.domains && query.domains.length > 0
      ? domains.filter((d) => query.domains!.split(",").includes(d.slug))
      : domains;

  const data = await getLeaderboard(
    selected.map((d) => d.id),
    query.q,
    query.page,
  );

  return NextResponse.json(data, {
    headers: { "s-maxage": "25", "stale-while-revalidate": "60" },
  });
}
