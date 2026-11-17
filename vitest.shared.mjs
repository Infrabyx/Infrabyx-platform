// Shared Vitest configuration for @infrabyx/* packages.
// Unit tests: src/**/*.test.ts (fast, no database).
// Integration tests: src/**/*.int.test.ts, run by `test:int` with INFRABYX_TEST_INT=1 against
// PostgreSQL 18 (Testcontainers in CI, or an existing server via IPB_TEST_PG_URL).
import { join } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest's cache directory (its results file orders the next run). Unset, Vitest's own default in
 * the package. `pnpm check:full` sets IPB_VITEST_CACHE_DIR per step so that steps running at once in
 * one package (unit, integration, contract legs) never read a results file another is writing.
 */
export function cacheDir() {
  const dir = process.env.IPB_VITEST_CACHE_DIR;
  return dir ? join(dir, process.cwd().replace(/[^a-zA-Z0-9]+/g, "_")) : undefined;
}

export function packageConfig() {
  const integration = process.env.INFRABYX_TEST_INT === "1";
  return defineConfig({
    cacheDir: cacheDir(),
    test: {
      include: integration ? ["src/**/*.int.test.ts"] : ["src/**/*.test.ts"],
      exclude: integration ? ["dist/**"] : ["src/**/*.int.test.ts", "dist/**"],
      testTimeout: integration ? 120_000 : 10_000,
      hookTimeout: integration ? 300_000 : 10_000,
      fileParallelism: !integration,
    },
  });
}
