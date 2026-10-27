import { defineConfig } from "vitest/config";

// The end-to-end and accessibility gate (`a11y` CI job): runs against a started site at
// IPB_TEST_CONSOLE_URL with the Chromium at IPB_CHROMIUM (PL5 plan §11).
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.e2e.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
