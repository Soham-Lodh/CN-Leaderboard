
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },

      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresh the session and update cookies when necessary.
  try {
    await supabase.auth.getUser();
  } catch {
    // Auth provider outages must not break public pages. Protected pages
    // will resolve as unauthenticated and redirect through their guards.
  }

  const path = request.nextUrl.pathname;

  // Prevent shared caching of sensitive routes.
  if (
    path.startsWith("/admin") ||
    path.startsWith("/auth") ||
    path.startsWith("/api")
  ) {
    response.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0"
    );
  }

  return response;
}

/**
 * Session refresh runs only where authentication is actually used:
 * the staff area, the OAuth entry/exit/auth callback routes, and API
 * routes that resolve the caller themselves.
 *
 * Public pages (welcome, leaderboard) never read auth in their render,
 * so refreshing Supabase sessions on those requests added a network
 * round trip per page view for anonymous visitors (the majority of
 * traffic) with no benefit. Protected pages still verify server-side
 * (page guards + route handlers), so authorization is unchanged.
 */
export const config = {
  matcher: ["/admin", "/admin/:path*", "/auth/:path*", "/api/:path*"],
};
