import type { Metadata, Viewport } from "next";
import { siteUrl } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Coding Ninjas KIIT Chapter",
    template: "%s — Coding Ninjas KIIT Chapter",
  },
  description:
    "Member contribution leaderboard of the Coding Ninjas KIIT Chapter: browse scores across chapter domains openly and transparently.",
  applicationName: "Coding Ninjas KIIT Chapter",
  openGraph: {
    siteName: "Coding Ninjas KIIT Chapter",
    type: "website",
    locale: "en_IN",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3 focus:shadow"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
