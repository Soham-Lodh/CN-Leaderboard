import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Official Supabase OAuth callback (Route Handler variant of the
 * documented PKCE pattern): exchanges the ?code param for a session,
 * with cookies written onto the redirect response. Any failure lands
 * back on the /admin gate with a generic error flag.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  // Only a relative same-site path may be honoured as a redirect target.
  const rawNext = request.nextUrl.searchParams.get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/admin";

  let response = NextResponse.redirect(`${origin}/admin?denied=error`);

  const supabase = createServerClient(env().NEXT_PUBLIC_SUPABASE_URL, env().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.redirect(`${origin}${next}`);
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  if (!code) {
    return response;
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    logger.warn("auth.oauth_callback_failed", { message: error.message });
    return NextResponse.redirect(`${origin}/admin?denied=error`);
  }
  // Session cookies (set in setAll above) ride along on the redirect.
  return response;
}
