import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogIn } from "lucide-react";
import { getVerifiedUser, getAuthContext } from "@/lib/auth/session";
import { Card, HeroLogo, BUTTON_STYLES } from "@/components/ui";
import { GATE_MESSAGES } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Staff sign-in · Coding Ninjas KIIT Chapter",
  description: "Administration entry for appointed chapter staff.",
  robots: { index: false, follow: false },
};

/**
 * Staff entry gate. Unauthenticated visitors here see the sign-in
 * button; authenticated-but-unappointed identities see a clear
 * refusal. There is no member login on this website.
 */
export default async function AdminGatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const denied = typeof params.denied === "string" ? (params.denied as keyof typeof GATE_MESSAGES) : null;
  const user = await getVerifiedUser();
  const context = user ? await getAuthContext() : null;

  if (context) {
    redirect("/admin/dashboard");
  }

  const rejection = denied && GATE_MESSAGES[denied] ? GATE_MESSAGES[denied] : user ? GATE_MESSAGES.not_appointed : null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-8 px-6 py-12">
      <div className="w-full max-w-md">
        <HeroLogo />
      </div>

      <Card className="w-full space-y-5 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Staff administration</h1>
        <p className="text-sm text-muted">
          This area is for chapter staff with a verified institutional academic account, appointed by the President.
        </p>
        {rejection ? (
          <p
            className="rounded-lg border border-danger/40 bg-red-50 px-4 py-3 text-sm font-medium text-danger"
            role="alert"
          >
            {rejection}
          </p>
        ) : null}
        <a href="/auth/signin?next=/admin" className={`${BUTTON_STYLES.primary} w-full`}>
          <LogIn size={16} aria-hidden="true" />
          Staff sign-in with Google
        </a>
        <p className="text-xs text-faint">
          Chapter members do not use this page: the{" "}
          <Link href="/leaderboard" className="text-accent-dark underline underline-offset-2">
            leaderboard
          </Link>{" "}
          needs no login.
        </p>
      </Card>
    </div>
  );
}
