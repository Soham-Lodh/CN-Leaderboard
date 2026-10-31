import Link from "next/link";
import { HeroLogo } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-sm font-medium text-muted">404 — not found</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page does not exist</h1>
      <div className="w-full max-w-xl">
        <HeroLogo />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="min-h-11 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
        >
          Go home
        </Link>
        <Link
          href="/leaderboard"
          className="min-h-11 rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-accent-soft"
        >
          Leaderboard
        </Link>
      </div>
    </div>
  );
}
