import { defineConfig, mergeConfig } from "vitest/config";
import { packageConfig } from "../../vitest.shared.mjs";

// Components and their tests are .tsx (server-rendered with react-dom/server).
export default mergeConfig(
  packageConfig(),
  defineConfig({ test: { include: ["src/**/*.test.{ts,tsx}"] } }),
);
