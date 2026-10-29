import Image from "next/image";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Logo({ priority = false, height = 44 }: { priority?: boolean; height?: number }) {
  return (
    <Image
      src="/branding/coding-ninjas-kiit.webp"
      alt="Coding Ninjas KIIT Chapter logo"
      width={Math.round((433 / 108) * height)}
      height={height}
      className="h-auto w-auto"
      priority={priority}
    />
  );
}

export function HeroLogo() {
  return (
    <Image
      src="/branding/coding-ninjas-kiit.webp"
      alt="Coding Ninjas KIIT Chapter — official logo"
      width={433}
      height={108}
      className="h-auto w-auto max-w-full"
      priority
      sizes="(max-width: 768px) 92vw, 736px"
    />
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-lg border border-line bg-card p-5 shadow-card", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-base font-semibold tracking-tight">
      {children}
    </h2>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export const BUTTON_STYLES = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-dark active:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-60",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-danger bg-white px-4 text-sm font-semibold text-danger transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60",
  ghost:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-surface disabled:opacity-60",
} as const;

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "muted" | "success" | "danger";
}) {
  const tones: Record<string, string> = {
    neutral: "border-line bg-surface text-ink",
    accent: "border-transparent bg-accent-soft text-accent-dark",
    muted: "border-line bg-white text-muted",
    success: "border-transparent bg-emerald-50 text-success",
    danger: "border-transparent bg-red-50 text-danger",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

/** Signed score display: color is never the only signal. */
export function ScoreValue({ value, className }: { value: number; className?: string }) {
  const tone = value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-muted";
  const text = value > 0 ? `+${value}` : value < 0 ? `\u2212${Math.abs(value)}` : "0";
  return (
    <span className={cn("tabular-nums", className)}>
      <span className={tone}>{text}</span>
      <span className="sr-only"> {value > 0 ? "positive" : value < 0 ? "negative" : "zero"} {Math.abs(value)} points</span>
    </span>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputStyles =
  "block w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink placeholder:text-faint disabled:bg-surface";

export function SkeletonRow({ columns }: { columns: number }) {
  return (
    <tr aria-hidden="true">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 w-full max-w-[140px]" />
        </td>
      ))}
    </tr>
  );
}
