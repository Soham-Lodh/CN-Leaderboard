import { z } from "zod";
import {
  MAX_DELTA,
  MIN_DELTA,
  MAX_REASON_LENGTH,
  NAME_LIMIT,
  NORMALIZED_ROLL_LIMIT,
  institutionalEmailSchema,
  normalizeName,
  normalizeRollNumber,
} from "./normalize";

export const DOMAIN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const domainNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(80);

export const domainSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(80)
  .regex(DOMAIN_SLUG, "Use lowercase letters, numbers and hyphens");

export const memberNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(NAME_LIMIT)
  .transform(normalizeName);

export const rawRollSchema = z
  .string()
  .trim()
  .min(1)
  .max(NORMALIZED_ROLL_LIMIT + 20)
  .transform(normalizeRollNumber)
  .refine((v) => v.length > 0 && v.length <= NORMALIZED_ROLL_LIMIT, {
    message: `Normalized roll number must be 1-${NORMALIZED_ROLL_LIMIT} characters`,
  });

export const reasonSchema = z
  .string()
  .max(MAX_REASON_LENGTH, `Reason must be at most ${MAX_REASON_LENGTH} characters`)
  .transform((v) => v.trim())
  .refine((v) => v.length <= MAX_REASON_LENGTH, {
    message: `Reason must be at most ${MAX_REASON_LENGTH} characters`,
  })
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

export const deltaSchema = z
  .number()
  .int()
  .min(MIN_DELTA, `Delta must be at least ${MIN_DELTA}`)
  .max(MAX_DELTA, `Delta must be at most ${MAX_DELTA}`)
  .refine((v) => v !== 0, "Delta must not be zero");

export const adjustScoreSchema = z.object({
  membershipId: z.string().uuid(),
  delta: deltaSchema,
  reason: reasonSchema,
  idempotencyKey: z.string().trim().min(8).max(72).uuid(),
});

export const createDomainSchema = z.object({
  name: domainNameSchema,
  slug: domainSlugSchema,
  description: z.string().trim().max(280).optional().transform((v) => (v && v.length ? v : null)),
});

export const renameDomainSchema = z.object({
  domainId: z.string().uuid(),
  name: domainNameSchema,
});

/**
 * Hard delete of a domain. confirmName must match the domain's exact
 * current name (checked against the locked row in the service) so a
 * stray click can never erase a domain.
 */
export const deleteDomainSchema = z.object({
  domainId: z.string().uuid(),
  confirmName: z.string().trim().min(1).max(80),
});

export const memberInputSchema = z.object({
  name: memberNameSchema,
  rollNumber: rawRollSchema,
});

/** A single validated member row as seen by import and by add-member forms. */
export const importRowSchema = z.object({
  name: memberNameSchema,
  rollNumber: rawRollSchema,
  points: z
    .number()
    .int()
    .refine((v) => v === 0 || (v >= MIN_DELTA && v <= MAX_DELTA), {
      message: `Nonzero initial points must be between ${MIN_DELTA} and ${MAX_DELTA}`,
    }),
  reason: reasonSchema,
});

export const staffEmailSchemaFor = (domain: string) =>
  institutionalEmailSchema(domain);

/** Querystring schema for the public leaderboard. */
export const leaderboardQuerySchema = z.object({
  domains: z.string().max(2000).optional(),
  q: z.string().trim().max(80).optional().transform((v) => (v && v.length ? v : undefined)),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(1),
  breakdown: z
    .enum(["", "1"])
    .optional()
    .transform((v) => v === "1"),
});
