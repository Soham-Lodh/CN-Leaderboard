"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Root error boundary: a failed render never leaves an indefinite
 * skeleton — it surfaces a recoverable message with a retry action.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced with the digest so the operator can correlate it with
    // the server-side log; nothing sensitive is shown to the user.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted">
        This section could not be loaded. Your other pages are unaffected — try again, or go back.
      </p>
      {error.digest ? <p className="text-xs text-faint">Reference: {error.digest}</p> : null}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-dark"
        >
          Try again
        </button>
        <Link href="/" className="min-h-11 inline-flex items-center rounded-full border border-line bg-white px-5 text-sm font-medium text-muted hover:bg-surface hover:text-ink">
          Go home
        </Link>
      </div>
    </div>
  );
}
