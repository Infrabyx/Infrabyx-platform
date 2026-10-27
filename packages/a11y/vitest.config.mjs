import { defineConfig, mergeConfig } from "vitest/config";
import { packageConfig } from "../../vitest.shared.mjs";

// The browser suite launches Chromium; give it room on a cold runner.
export default mergeConfig(packageConfig(), defineConfig({ test: { testTimeout: 30_000 } }));
