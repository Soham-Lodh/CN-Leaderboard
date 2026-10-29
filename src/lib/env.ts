import "server-only";
import { z } from "zod";

/**
 * Validated environment. Import this module to guarantee a fully
 * configured runtime. Missing required variables fail loudly with a
 * list of what is missing (no partial configuration).
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  ALLOWED_EMAIL_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^@?[a-z0-9.-]+(?:\s*,\s*@?[a-z0-9.-]+)*$/, "use comma-separated domains like kiit.ac.in,gmail.com")
    .transform((v) => v.split(",").map((d) => d.trim().replace(/^@/, "").toLowerCase()).filter(Boolean).join(",")),
  // The first account is a President, not a generic administrator.
  BOOTSTRAP_PRESIDENT_EMAIL: z.union([z.string().trim().email(), z.literal("")]).default(""),
  BOOTSTRAP_SECRET: z.union([z.string().min(1), z.literal("")]).default(""),
  LOCK_TIMEOUT_MS: z.preprocess((v) => v === undefined || v === "" ? 2000 : Number(v), z.number().int().min(200).max(30_000)),
  STATEMENT_TIMEOUT_MS: z.preprocess((v) => v === undefined || v === "" ? 8000 : Number(v), z.number().int().min(500).max(60_000)),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = Object.keys(envSchema.shape).filter((k) => !process.env[k]);
    const detail = missing.length > 0 ? ` Missing entirely: ${missing.join(", ")}.` : "";
    throw new Error(
      `Invalid environment configuration.${detail} See .env.example for the required variables.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Public site URL without trailing slash. */
export function siteUrl(): string {
  return env().NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
}

/** Institutional email domain, lowercase, without '@'. */
export function institutionDomain(): string {
  return env().ALLOWED_EMAIL_DOMAIN;
}

export function institutionDomains(): string[] {
  return env().ALLOWED_EMAIL_DOMAIN.split(",").filter(Boolean);
}

export function bootstrapPresidentEmail(): string | null {
  const value = (env().BOOTSTRAP_PRESIDENT_EMAIL ?? "").trim().toLowerCase();
  return value || null;
}
