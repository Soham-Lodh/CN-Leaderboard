"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { useEffect, useState } from "react";

/**
 * A <Link> with per-element pending feedback (Next 15.3+ useLinkStatus).
 * While that specific navigation is in-flight the link dims and shows a
 * small inline spinner; the loading flash is debounced for 120 ms so
 * fast pre-rendered navigations never flicker.
 *
 * The destination route's loading.tsx/skeletons remain the primary
 * feedback mechanism — this only adds element-level affordance.
 */
export function PendingLink({
  href,
  children,
  className = "",
  ...rest
}: Omit<React.ComponentProps<typeof Link>, "className"> & { className?: string }) {
  const { pending } = useLinkStatus();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!pending) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 120);
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <Link
      href={href}
      className={`${className}${show ? " opacity-60" : ""}`}
      aria-busy={show ? "true" : undefined}
      {...rest}
    >
      {children}
      {show ? (
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 shrink-0 motion-safe:animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
    </Link>
  );
}
