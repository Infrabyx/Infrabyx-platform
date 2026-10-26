// Unit and integration tests as in every package; `test:contract` runs the contract legs
// (src/<port>/**/*.contract.test.ts), which may start containers.
import { defineConfig } from "vitest/config";
import { packageConfig } from "../../vitest.shared.mjs";

const contract = process.env.INFRABYX_TEST_CONTRACT === "1";
const base = packageConfig();

export default contract
  ? defineConfig({
      test: {
        include: ["src/**/*.contract.test.ts"],
        exclude: ["dist/**"],
        testTimeout: 120_000,
        hookTimeout: 300_000,
        fileParallelism: false,
      },
    })
  : defineConfig({
      test: { ...base.test, exclude: [...(base.test?.exclude ?? []), "src/**/*.contract.test.ts"] },
    });
