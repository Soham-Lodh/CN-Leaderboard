import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/** POST-only sign-out: clears the Supabase session and returns to the gate. */
export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const response = NextResponse.redirect(`${origin}/admin`, { status: 303 });

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

  await supabase.auth.signOut();
  return response;
}

/** GET on sign-out is not a valid action; browsers may pre-fetch. Stay safe. */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(request.nextUrl.origin + "/admin", { status: 303 });
}
