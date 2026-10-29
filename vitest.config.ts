import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit tests run hermetically (no database, no env secrets): they cover
 * normalization, validation schemas and the pure authorization policy
 * — the "a lead cannot touch another domain" rules most valuable to
 * pin. Integration tests that need a live DATABASE_URL are skipped
 * automatically when it is not configured, so `vitest run` always
 * reports honestly (skipped ≠ passed).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
