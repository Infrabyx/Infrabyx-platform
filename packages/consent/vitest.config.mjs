import { defineConfig, mergeConfig } from "vitest/config";
import { packageConfig } from "../../vitest.shared.mjs";

// The CMP components and their tests are .tsx (server-rendered with react-dom/server).
export default process.env.INFRABYX_TEST_INT === "1"
  ? packageConfig()
  : mergeConfig(packageConfig(), defineConfig({ test: { include: ["src/**/*.test.{ts,tsx}"] } }));
