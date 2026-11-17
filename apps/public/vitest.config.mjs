import { defineConfig } from "vitest/config";
import { cacheDir } from "../../vitest.shared.mjs";

// Unit tests: src/**/*.test.{ts,tsx}. Integration tests: src/**/*.int.test.ts with
// INFRABYX_TEST_INT=1 against IPB_TEST_PG_URL (the shared package convention, plus TSX).
const integration = process.env.INFRABYX_TEST_INT === "1";
export default defineConfig({
  cacheDir: cacheDir(),
  test: {
    include: integration ? ["src/**/*.int.test.ts"] : ["src/**/*.test.{ts,tsx}"],
    exclude: integration ? [] : ["src/**/*.int.test.ts", "src/**/*.e2e.test.ts"],
    testTimeout: integration ? 120_000 : 10_000,
    hookTimeout: integration ? 300_000 : 10_000,
    fileParallelism: !integration,
  },
});
