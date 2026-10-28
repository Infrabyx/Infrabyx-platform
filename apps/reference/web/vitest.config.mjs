import { defineConfig } from "vitest/config";

// Unit tests: src/**/*.test.{ts,tsx}. The gate journey (`*.e2e.test.ts`) runs from
// vitest.e2e.config.mjs in the `reference` job against the Compose stack.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.int.test.ts", "src/**/*.e2e.test.ts"],
    testTimeout: 10_000,
  },
});
