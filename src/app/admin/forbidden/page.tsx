import type { Metadata } from "next";
import Link from "next/link";
import { HeroLogo } from "@/components/ui";

export const metadata: Metadata = {
  title: "No access · Staff",
  robots: { index: false, follow: false },
};

/**
 * 403 surface for authenticated staff who lack the role a page needs
 * (unauthenticated users are redirected to the /admin entry gate).
 */
export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-sm font-medium text-muted">403 — no access</p>
      <h1 className="text-2xl font-semibold tracking-tight">You don’t have access to this page</h1>
      <p className="max-w-md text-sm text-muted">
        This area is limited to specific leadership roles. If you believe you should have access,
        ask a chapter President or Vice President.
      </p>
      <div className="w-full max-w-md">
        <HeroLogo />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/admin/dashboard"
          className="min-h-11 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
        >
          Back to your dashboard
        </Link>
        <Link
          href="/leaderboard"
          className="min-h-11 rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-accent-soft"
        >
          Public leaderboard
        </Link>
      </div>
    </div>
  );
}
