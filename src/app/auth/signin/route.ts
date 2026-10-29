import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/**
 * Kicks off Google OAuth via Supabase Auth: sets the PKCE verifier
 * cookies and redirects to Google. The callback route exchanges the
 * code for a session.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const rawNext = request.nextUrl.searchParams.get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/admin";
  const callbackUrl = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const response = NextResponse.redirect(`${origin}/admin?denied=error`);

  const supabase = createServerClient(env().NEXT_PUBLIC_SUPABASE_URL, env().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl },
  });

  if (error || !data.url) {
    return response;
  }
  // Supabase writes the PKCE verifier cookie onto `response`. Preserve it
  // when switching the response target to Google's OAuth URL.
  const redirectResponse = NextResponse.redirect(data.url);
  for (const cookie of response.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }
  return redirectResponse;
}
