import Link from "next/link";
import { Activity, LayoutDashboard, ShieldCheck, Users } from "lucide-react";
import { Logo } from "../ui";

/** Admin chrome. Nav links are convenience only; guards enforce access. */
export function AdminShell({
  children,
  context,
  title,
  description,
}: {
  children: React.ReactNode;
  context: { globalRole: "PRESIDENT" | "VICE_PRESIDENT" | null; domains: Array<{ id: string; name: string }> };
  title: string;
  description?: string;
}) {
  const global = context.globalRole !== null;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <Link href="/admin/dashboard" className="flex items-center gap-3">
          <Logo height={32} />
          <span className="hidden text-xs font-medium uppercase tracking-wide text-faint sm:inline">Staff</span>
        </Link>
        <nav aria-label="Admin" className="flex flex-wrap items-center gap-1 text-sm">
          <Link
            href="/admin/dashboard"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 font-medium text-muted hover:bg-surface hover:text-ink"
          >
            <LayoutDashboard size={14} aria-hidden="true" />
            Dashboard
          </Link>
          {global ? (
            <>
              <Link
                href="/admin/domains"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 font-medium text-muted hover:bg-surface hover:text-ink"
              >
                <Users size={14} aria-hidden="true" />
                Domains
              </Link>
              <Link
                href="/admin/staff"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 font-medium text-muted hover:bg-surface hover:text-ink"
              >
                <ShieldCheck size={14} aria-hidden="true" />
                Staff
              </Link>
              <Link href="/admin/activity" className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 font-medium text-muted hover:bg-surface hover:text-ink">
                <Activity size={14} aria-hidden="true" />
                Activity
              </Link>
            </>
          ) : null}
        </nav>
      </header>

      <main id="content" className="flex-1 space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
        </div>
        {children}
      </main>

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-faint">
        <span>{global ? "Leadership activity is recorded for oversight. " : "Signed in "} {new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })} IST</span>
        {context.domains.length > 0 ? (
          <span className="hidden sm:inline">
            Domains:{" "}
            {context.domains.map((d, i) => (
              <span key={d.id}>
                {i > 0 ? " · " : ""}
                {d.name}
              </span>
            ))}
          </span>
        ) : null}
      </footer>
    </div>
  );
}
