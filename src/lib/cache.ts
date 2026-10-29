import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";

/**
 * Deliberately small public cache policy (TRD §9):
 *  - active domain list: tag "domains", 60 s fallback TTL
 *  - public leaderboard aggregate: tag "leaderboard" + per-domain tags,
 *    25 s fallback TTL. Only allowlisted public DTOs are ever cached.
 * Admin/audit reads are always fresh (server authenticated, no-store).
 * Every mutation invalidates its tags immediately; TTL is only a
 * fallback for an invalidation failure.
 */

export const CACHE_TAGS = {
  domains: "domains",
  leaderboard: "leaderboard",
  domain: (domainId: string) => `domain:${domainId}`,
} as const;

export const PUBLIC_LEADERBOARD_TTL_SECONDS = 25;
export const PUBLIC_DOMAINS_TTL_SECONDS = 60;

/**
 * Create a cached public read with fixed tags + TTL. Tags passed here
 * must cover every mutation that touches the returned data; the TTL is
 * the staleness fallback if invalidation later fails.
 */
export function cachePublic<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  cacheId: string,
  tags: string[],
  ttlSeconds: number,
): (...args: TArgs) => Promise<TResult> {
  return unstable_cache(fn, [cacheId], { tags: [...tags], revalidate: ttlSeconds });
}

/**
 * Called from Server Actions immediately after a committed mutation.
 * Validated writes trigger this so authored effects are visible at
 * once; if a call here fails the short TTL still bounds staleness.
 * revalidateTag is supported from Server Actions and Route Handlers.
 */
export function invalidatePublicCaches(domainIds: string[] = []): void {
  revalidateTag(CACHE_TAGS.domains);
  revalidateTag(CACHE_TAGS.leaderboard);
  for (const id of domainIds) {
    revalidateTag(CACHE_TAGS.domain(id));
  }
}
