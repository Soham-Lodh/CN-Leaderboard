import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroLogo } from "@/components/ui";
import { siteUrl } from "@/lib/env";

/**
 * Public welcome page. Fully static — no database reads. Metadata is
 * indexable; the leaderboard deliberately is not (PRD §10).
 */
export const metadata: Metadata = {
  title: "Coding Ninjas KIIT Chapter",
  description: "Chapter member leaderboard across our domains — ranks, points, and achievements updated as staff assign points.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Coding Ninjas KIIT Chapter",
    description: "Chapter member leaderboard across our domains — ranks, points, and achievements updated as staff assign points.",
    type: "website",
    url: "/",
    images: [{ url: "/branding/coding-ninjas-kiit.webp", width: 1200, height: 630, alt: "Coding Ninjas KIIT Chapter" }],
  },
  twitter: { card: "summary_large_image", title: "Coding Ninjas KIIT Chapter", description: "Chapter member leaderboard across our domains — ranks, points, and achievements updated as staff assign points.", images: ["/branding/coding-ninjas-kiit.webp"] },
};

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span aria-hidden="true" />
        <span className="text-sm text-muted">KIIT Chapter, Bhubaneswar</span>
      </header>

      <main id="content" className="flex flex-1 flex-col items-center justify-center gap-10 py-16 text-center">
        <div className="w-full max-w-2xl">
          <HeroLogo />
        </div>

        <div className="max-w-xl space-y-4">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Building coders, together
          </h1>
          <p className="text-pretty text-base leading-relaxed text-muted sm:text-lg">
            The Coding Ninjas KIIT Chapter recognizes member contributions across
            ten domains — from competitive programming to design and public
            relations. Browse how our Coding Ninjas practically contribute.
          </p>
        </div>

        <Link
          href="/leaderboard"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-colors hover:bg-accent-dark"
        >
          View Leaderboard
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-faint">
        <p>Coding Ninjas KIIT Chapter · Bhubaneswar, Odisha</p>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Coding Ninjas KIIT Chapter",
              url: siteUrl(),
            }),
          }}
        />
      </footer>
    </div>
  );
}
