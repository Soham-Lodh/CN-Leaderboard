# Loading UX & Navigation Audit

Audit of navigation responsiveness, route loading and streaming across the
app (Next.js 15.5 / React 19 App Router). Route map differs from earlier
assumptions — the app's pages are `/` (static welcome), `/leaderboard`,
`/admin` (staff gate), `/admin/dashboard`, `/admin/domains`,
`/admin/domains/[domainId]`, `/admin/staff`, `/admin/activity`,
`/admin/audit`, `/admin/forbidden`, plus `/api/leaderboard` and `/auth/*`
route handlers. There are no `/dashboard`, `/profile` or `/sheets` pages in
this application; those requirements map onto the pages above.

| ID | File / function | Cause | Severity | Change | Status |
|--------|------------------|-------|----------|--------|--------|
| UX-1 | All route segments (no `loading.tsx` except `/leaderboard`) | App Router keeps the previous page fully visible while it fetches the entire next RSC payload; with no loading boundary the swap happens only after all awaits complete, so navigation feels frozen ("stuck on previous page") | Critical | Route-level `loading.tsx` for `/`, `/admin` (generic chrome skeleton), `/admin/dashboard`, `/admin/domains`, `/admin/domains/[domainId]`, `/admin/staff`, `/admin/activity`, `/admin/audit`, mirroring each destination's real layout with shared `src/components/skeletons.tsx` primitives; destination-specific shapes (stat cards, grids, tables) | Confirmed, fixed |
| UX-2 | `src/app/admin/dashboard/page.tsx`, `src/lib/services/dashboard.ts` | Page awaited the whole dashboard aggregate (`getDashboardData`) before returning any JSX; a slow query delayed the whole page | High | Split into `getDashboardDomains`, `getDashboardStats`, `getDashboardRecentAudits` + pure `dashboardRoleLabel`; page renders shell immediately and streams Stats / Your domains / Recent activity behind independent Suspense boundaries; per-request `cache()` dedupes the domains fetch across stat cards, list and footer; leads no longer run the audit-event query the UI would discard | Confirmed, fixed |
| UX-3 | `src/app/leaderboard/page.tsx` | Header waited for `listActiveDomains` + `getLeaderboard` before returning JSX | Medium | Header paints immediately; filters + standings stream behind one Suspense boundary keyed on the parsed query so filter/pagination changes re-show the skeleton | Confirmed, fixed |
| UX-4 | `src/app/admin/staff/page.tsx` | Two independent reads (staff overview, domains) awaited sequentially | Medium | `Promise.all` | Confirmed, fixed |
| UX-5 | `src/app/admin/activity/page.tsx` | Domain list and event page awaited sequentially | Medium | `Promise.all` | Confirmed, fixed |
| UX-6 | `src/app/admin/audit/page.tsx` | Members table (+ optional member ledger) blocked the shell after the domain gate | Medium | Domain/scope resolution stays first (security); members + ledger now stream behind a Suspense boundary so shell and domain pills paint first | Confirmed, fixed |
| UX-7 | `src/components/admin/shell.tsx` | Nav links gave no pending feedback in segments that resolve near-instantly | Low | New `PendingLink` client component (`useLinkStatus`, Next 15.5 ≥ 15.3, 120 ms debounce) used for logo + all admin nav links and the dashboard's domain-card links; footer domain list now accepts a pre-wrapped Suspense node (`footerRight`) so streaming pages keep the same chrome | Confirmed, fixed |
| UX-8 | `src/middleware.ts` | Supabase `auth.getUser()` ran for every matched request including public pages (`/`, `/leaderboard`) that never read auth in render — an extra network round trip per page view for anonymous visitors | High | Matcher narrowed to `/admin`, `/admin/:path*`, `/auth/:path*`, `/api/:path*`; authorization still enforced server-side by page guards and route handlers; cookie refresh, chunked-cookie handling and callbacks unchanged | Confirmed, fixed (matcher covered by `tests/unit/middleware.test.ts`; behavior verified against route handlers) |
| BUG-9 | `src/lib/services/leaderboard.ts` `getLeaderboardUncached` | COUNT query's first CTE selected `dm."memberId"` without the `AS member_id` alias; the next CTE referenced lowercase `member_id` → Postgres `42703 column "member_id" does not exist`; **leaderboard standings were failing at runtime** (error surfaced via error boundary, only the header rendered) | Critical | Added the missing alias; standings render again (0.02–0.03 s warm on prod server) | Confirmed, fixed (found during browser verification) |
| UX-10 | No error boundary | A runtime render failure left partial/blank content with no recovery action | Medium | `src/app/error.tsx` client boundary: digest display, "Try again" reset, Go-home link | Confirmed, fixed |
| UX-11 | Dev-server compilation | First-hop delays in `next dev` (6–7 s) are compilation, not production latency; measured prod route times are 20–200 ms | Info | Documented; prod numbers reported separately | Confirmed (not a code defect) |

Not problems (checked, no defect):
* Root layout is fully static (no `getCurrentProfile()` call) — the app shell never waits for profile data; there is no global navbar component that could block it.
* `src/app/admin/domains/[domainId]/page.tsx` sequential awaits are security-ordered (domain check → access guard → members) and were left as-is intentionally.
* `src/app/admin/page.tsx` gate redirect: fetches only what the decision needs.
* Existing leaderboard service caching, tags, invalidation, personalization isolation: untouched.
* No `router.events`, no `force-dynamic` removals, no business-logic changes, no new dependencies, no artificial delays left in code.
