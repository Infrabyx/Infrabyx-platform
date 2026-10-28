import { defineConfig } from "vitest/config";

// The gate journey (PL6 plan §8.2; the `reference` CI job): runs against the Compose stack's web app
// at IPB_TEST_WEB_URL with the Chromium at IPB_CHROMIUM, signing in as a seed persona from
// SEED_CREDENTIALS.md (IPB_TEST_CREDENTIALS).
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.e2e.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
