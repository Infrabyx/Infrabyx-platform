import { defineConfig, mergeConfig } from "vitest/config";
import { packageConfig } from "../../vitest.shared.mjs";

// The browser suite launches Chromium; a cold start on a busy CI runner can take well over the
// default 10 s, so tests and the launch hook get room.
export default mergeConfig(
  packageConfig(),
  defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } }),
);
