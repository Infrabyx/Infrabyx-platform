// Shared Vitest configuration for @infrabyx/* packages.
// Unit tests: src/**/*.test.ts (fast, no database).
// Integration tests: src/**/*.int.test.ts, run by `test:int` with INFRABYX_TEST_INT=1 against
// PostgreSQL 18 (Testcontainers in CI, or an existing server via IPB_TEST_PG_URL).
import { defineConfig } from "vitest/config";

export function packageConfig() {
  const integration = process.env.INFRABYX_TEST_INT === "1";
  return defineConfig({
    test: {
      include: integration ? ["src/**/*.int.test.ts"] : ["src/**/*.test.ts"],
      exclude: integration ? ["dist/**"] : ["src/**/*.int.test.ts", "dist/**"],
      testTimeout: integration ? 120_000 : 10_000,
      hookTimeout: integration ? 300_000 : 10_000,
      fileParallelism: !integration,
    },
  });
}
