import "server-only";
import { prisma } from "../db";
import { cachePublic, CACHE_TAGS, PUBLIC_DOMAINS_TTL_SECONDS, PUBLIC_LEADERBOARD_TTL_SECONDS } from "../cache";
import { normalizeRollNumber } from "../normalize";

/**
 * Public leaderboard reads. Everything here is manually mapped to a
 * strict public DTO: name, roll number, rank, points and an optional
 * scores-only per-domain breakdown. No reasons, actor data, audit
 * fields or internal statuses ever enter these results.
 */

export const LEADERBOARD_PAGE_SIZE = 50;

export interface PublicDomain {
  id: string;
  name: string;
  slug: string;
}

export interface PublicScoreBreakdown {
  domainId: string;
  points: number;
}

export interface PublicLeaderboardRow {
  memberId: string;
  name: string;
  rollNumber: string;
  points: number;
  rank: number;
  breakdown: PublicScoreBreakdown[];
}

export interface LeaderboardData {
  page: number;
  pageSize: number;
  totalMembers: number;
  totalPages: number;
  rows: PublicLeaderboardRow[];
}

async function listActiveDomainsUncached(): Promise<PublicDomain[]> {
  return prisma.domain.findMany({
    where: { archivedAt: null },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, slug: true },
  });
}

export const listActiveDomains: () => Promise<PublicDomain[]> = cachePublic(
  listActiveDomainsUncached,
  "public-domains",
  [CACHE_TAGS.domains],
  PUBLIC_DOMAINS_TTL_SECONDS,
);

interface AggRow {
  rank: number;
  member_id: string;
  points: number;
  name: string;
  roll: string;
  total: number;
}

async function getLeaderboardUncached(
  domainIds: string[],
  q: string | undefined,
  page: number,
): Promise<LeaderboardData> {
  const ids = domainIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0 || page < 1) {
    return { page: 1, pageSize: LEADERBOARD_PAGE_SIZE, totalMembers: 0, totalPages: 0, rows: [] };
  }

  // Search matches normalized name text or normalized roll number.
  const searchLike = q && q.trim().length > 0 ? `%${q.trim().replace(/\s+/g, "")}%` : null;
  const rollLike = searchLike ? `%${normalizeRollNumber(q!.trim())}%` : null;
  const hasSearch = searchLike !== null && rollLike !== null;

  // Search terms are always passed as bound parameters — never string-
  // interpolated into SQL — so a crafted search string is inert.
  const searchClause = hasSearch
    ? `WHERE name ILIKE $2 OR "normalizedRollNumber" ILIKE $3`
    : "";
  const args: unknown[] = hasSearch ? [ids, searchLike, rollLike] : [ids];

  const rowsAndTotal = await prisma.$queryRawUnsafe<AggRow[]>(
    `WITH selected AS (
       SELECT dm."memberId" AS member_id, dm."currentPoints" AS points
       FROM "DomainMembership" dm
       JOIN "Domain" d ON d.id = dm."domainId" AND d."archivedAt" IS NULL
       JOIN "Member" m ON m.id = dm."memberId" AND m."archivedAt" IS NULL
       WHERE dm.status = 'ACTIVE' AND dm."domainId" = ANY($1::text[])
     ), agg AS (
       SELECT member_id, SUM(points)::int AS points FROM selected GROUP BY member_id
     ), filtered AS (
       SELECT agg.member_id, agg.points, mem.name, mem."normalizedRollNumber" AS roll
       FROM agg
       JOIN "Member" mem ON mem.id::text = agg.member_id AND mem."archivedAt" IS NULL
       ${searchClause}
     ), ranked AS (
       SELECT *, ROW_NUMBER() OVER (
         ORDER BY points DESC, roll ASC, name ASC, member_id ASC
       ) AS rank
       FROM filtered
     )
     SELECT rank::int, member_id, points, name, roll, COUNT(*) OVER ()::int AS total
     FROM ranked
     LIMIT ${LEADERBOARD_PAGE_SIZE} OFFSET ${(page - 1) * LEADERBOARD_PAGE_SIZE}`,
    ...args,
  );

  // Compact scores-only breakdown when more than one domain is selected.
  const breakdownRows =
    ids.length > 1
      ? await prisma.$queryRaw<{ member_id: string; domain_id: string; points: number }[]>`
      SELECT s.member_id AS member_id, s.domain_id AS domain_id, SUM(s.points)::int AS points
      FROM (
        SELECT dm."memberId" AS member_id, dm."domainId" AS domain_id, dm."currentPoints" AS points
        FROM "DomainMembership" dm
        JOIN "Domain" d ON d.id = dm."domainId" AND d."archivedAt" IS NULL
        JOIN "Member" m ON m.id = dm."memberId" AND m."archivedAt" IS NULL
        WHERE dm.status = 'ACTIVE' AND dm."domainId" = ANY(${ids}::text[])
      ) s
      GROUP BY 1, 2`
      : [];

  const breakdownByMember = new Map<string, PublicScoreBreakdown[]>();
  for (const b of breakdownRows) {
    const list = breakdownByMember.get(b.member_id) ?? [];
    list.push({ domainId: b.domain_id, points: b.points });
    breakdownByMember.set(b.member_id, list);
  }

  const totalMembers = rowsAndTotal[0]?.total ?? 0;
  const rows: PublicLeaderboardRow[] = rowsAndTotal.map((r) => ({
    memberId: r.member_id,
    name: r.name,
    rollNumber: r.roll,
    points: r.points,
    rank: r.rank,
    breakdown: breakdownByMember.get(r.member_id) ?? [],
  }));

  return {
    page,
    pageSize: LEADERBOARD_PAGE_SIZE,
    totalMembers,
    totalPages: Math.max(1, Math.ceil(totalMembers / LEADERBOARD_PAGE_SIZE)),
    rows,
  };
}

/**
 * Cached public leaderboard. unstable_cache includes the call arguments
 * in the cache key so domain set/mode/page are distinct entries; tags
 * allow immediate invalidation after mutations and the TTL only bounds
 * staleness as a fallback.
 */
export function getLeaderboard(
  domainIds: string[],
  q: string | undefined,
  page: number,
) {
  const cached = cachePublic(
    getLeaderboardUncached,
    "public-leaderboard",
    [CACHE_TAGS.leaderboard, ...domainIds.map((d) => CACHE_TAGS.domain(d))],
    PUBLIC_LEADERBOARD_TTL_SECONDS,
  );
  return cached(domainIds, q, page);
}
