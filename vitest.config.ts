import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit tests run hermetically (no database, no env secrets): they cover
 * normalization, validation schemas and the pure authorization policy
 * — the "a lead cannot touch another domain" rules most valuable to
 * pin. Integration tests that need a live TEST_DATABASE_URL are skipped
 * automatically when it is not configured, so `vitest run` always
 * reports honestly (skipped ≠ passed).
 */
// Integration tests may run against the project's main DATABASE_URL
// (owner-authorized); load .env before any test module imports Prisma.
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env — unit tests run hermetically */ }

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Test runtime is plain Node, outside React Server Components.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
      "next/cache": path.resolve(__dirname, "tests/stubs/next-cache.ts"),
    },
  },
});
