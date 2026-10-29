import { describe, expect, it } from "vitest";
import {
  MAX_DELTA,
  MIN_DELTA,
  MAX_REASON_LENGTH,
  NORMALIZED_ROLL_LIMIT,
  NAME_LIMIT,
  hasEmailSuffix,
  normalizeEmail,
  normalizeName,
  normalizeRollNumber,
  slugify,
  escapeFormulaCell,
} from "@/lib/normalize";

describe("normalizeRollNumber", () => {
  it("upper-cases, strips separators and collapses hyphen runs", () => {
    expect(normalizeRollNumber("  cs 2202 001 ")).toBe("CS-2202-001");
    expect(normalizeRollNumber("Cs-2202001")).toBe("CS-2202001");
    expect(normalizeRollNumber("2105234")).toBe("2105234");
    expect(normalizeRollNumber("---a--b---")).toBe("A-B");
  });

  it("keeps only alphanumerics and hyphens", () => {
    expect(normalizeRollNumber("abc/123@x#")).toBe("ABC-123-X");
  });
});

describe("email + name helpers", () => {
  it("normalizes email casing/trim", () => {
    expect(normalizeEmail(" Riya.K@KIIT.ac.in ")).toBe("riya.k@kiit.ac.in");
  });

  it("matches exact domain suffix only", () => {
    expect(hasEmailSuffix("a@kiit.ac.in", "kiit.ac.in")).toBe(true);
    expect(hasEmailSuffix("a@evil-kiit.ac.in", "kiit.ac.in")).toBe(false);
    expect(hasEmailSuffix("a@kiit.ac.in.evil.com", "kiit.ac.in")).toBe(false);
  });

  it("collapses whitespace in names", () => {
    expect(normalizeName("  Riya   Sharma ")).toBe("Riya Sharma");
  });
});

describe("limits exposed to validation/shared code", () => {
  it("matches the PRD scoring rules", () => {
    expect(MIN_DELTA).toBe(-1000);
    expect(MAX_DELTA).toBe(1000);
    expect(MAX_REASON_LENGTH).toBe(200);
    expect(NORMALIZED_ROLL_LIMIT).toBeGreaterThan(0);
    expect(NAME_LIMIT).toBeGreaterThan(0);
  });
});

describe("slugify", () => {
  it("produces lowercase alphanumeric slugs", () => {
    expect(slugify("Design and Branding")).toBe("design-and-branding");
    expect(slugify("  --Weird__Slug!! ")).toBe("weird-slug");
  });
});

describe("escapeFormulaCell", () => {
  it("neutralizes spreadsheet formula injection", () => {
    for (const danger of ["=cmd()", "+1+2", "-1", "@SUM(1)", "\tjailbreak", "\rx"]) {
      const escaped = escapeFormulaCell(danger);
      expect(escaped.startsWith("=")).toBe(false);
      expect(escaped.startsWith("+")).toBe(false);
      expect(escaped.startsWith("-")).toBe(false);
      expect(escaped.startsWith("@")).toBe(false);
      expect(escaped.startsWith("\t")).toBe(false);
      expect(escaped.startsWith("\r")).toBe(false);
    }
    expect(escapeFormulaCell("safe name")).toBe("safe name");
  });
});
