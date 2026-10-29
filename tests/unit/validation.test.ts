import { describe, expect, it } from "vitest";
import {
  adjustScoreSchema,
  createDomainSchema,
  importRowSchema,
  leaderboardQuerySchema,
  reasonSchema,
} from "@/lib/validation";

describe("adjustScoreSchema (PRD §7)", () => {
  const base = {
    membershipId: "11111111-1111-1111-1111-111111111111",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
  };

  it("accepts a valid signed delta with optional reason", () => {
    const parsed = adjustScoreSchema.safeParse({ ...base, delta: 10, reason: "Contest win" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reason).toBe("Contest win");
    }
  });

  it("rejects zero, out-of-range and non-integer deltas", () => {
    for (const delta of [0, 1001, -1001, 1.5, Number.NaN, "10" as unknown]) {
      expect(adjustScoreSchema.safeParse({ ...base, delta }).success).toBe(false);
    }
  });

  it("accepts negative deltas within range", () => {
    expect(adjustScoreSchema.safeParse({ ...base, delta: -1000, reason: undefined }).success).toBe(true);
  });

  it("rejects reasons longer than 200 chars and empty idempotency keys", () => {
    expect(adjustScoreSchema.safeParse({ ...base, delta: 5, reason: "x".repeat(201) }).success).toBe(false);
    expect(adjustScoreSchema.safeParse({ ...base, delta: 5, idempotencyKey: "short" }).success).toBe(false);
  });
});

describe("createDomainSchema", () => {
  it("normalizes casing but rejects malformed slugs and short names", () => {
    const ok = createDomainSchema.safeParse({ name: "Cyber Security", slug: "Cyber" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.slug).toBe("cyber");
    expect(createDomainSchema.safeParse({ name: "Cyber Security", slug: "cyber--2" }).success).toBe(false);
    expect(createDomainSchema.safeParse({ name: "Cyber Security", slug: "cyber security" }).success).toBe(false);
    expect(createDomainSchema.safeParse({ name: "X", slug: "cyber" }).success).toBe(false);
    expect(createDomainSchema.safeParse({ name: "Cyber Security", slug: "cyber-security" }).success).toBe(true);
  });
});

describe("reasonSchema", () => {
  it("maps empty/undefined to null and trims", () => {
    expect(reasonSchema.parse("  ")).toBeNull();
    expect(reasonSchema.parse(undefined)).toBeNull();
    expect(reasonSchema.parse("  hello ")).toBe("hello");
  });
});

describe("importRowSchema", () => {
  it("requires name + roll, accepts zero or in-range initial points", () => {
    expect(importRowSchema.safeParse({ name: "Riya Sharma", rollNumber: "cs2202001", points: 0 }).success).toBe(true);
    expect(importRowSchema.safeParse({ name: "Riya Sharma", rollNumber: "2202001", points: 25 }).success).toBe(true);
    expect(importRowSchema.safeParse({ name: "Riya Sharma", rollNumber: "2202001", points: 2500 }).success).toBe(false);
  });
});

describe("leaderboardQuerySchema", () => {
  it("coerces page, caps lengths and normalizes empty search", () => {
    expect(leaderboardQuerySchema.parse({ page: "3" }).page).toBe(3);
    expect(leaderboardQuerySchema.parse({ q: "   " }).q).toBeUndefined();
    expect(leaderboardQuerySchema.safeParse({ page: "501" }).success).toBe(false);
    const long = "x".repeat(2001);
    expect(leaderboardQuerySchema.safeParse({ domains: long }).success).toBe(false);
  });
});
