import type { NextConfig } from "next";

/**
 * HSTS only makes sense over HTTPS; production site URLs are https, so
 * the header is emitted whenever the configured site URL says so.
 * Local dev (http://localhost) keeps working without it.
 */
const isHttpsSite = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://localhost").protocol === "https:";
  } catch {
    return false;
  }
})();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Imports are capped at 5 MB of workbook bytes; allow multipart overhead.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(isHttpsSite
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
