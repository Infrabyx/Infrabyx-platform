// ESLint flat config — infrabyx-platform
// Custom IPB rules ship as @infrabyx/testing/eslint so products install the same rules (PL1-D-02 / D-05).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import ipb from "./packages/testing/eslint/index.mjs";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.generated.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,mts,cts,js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    plugins: { ipb },
    rules: {
      // IPB-01-14: vendor SDKs only inside packages/connectors
      "ipb/vendor-import": "error",
      // IPB-01-09 / IPB-01-11: a module never imports another module's schema
      "ipb/schema-boundary": "error",
      // IPB-01-19: process.env only inside packages/config
      "ipb/no-process-env": "error",
      // IPB-12-05: cryptography only through packages/crypto (PL1-C-01)
      "ipb/no-direct-crypto": "error",
      // IPB-01-16 / PL2-D-03: data class may only be raised; payload schemas fully annotated
      "ipb/port-data-class": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Repo tooling (not shipped) may read process.env.
    files: [
      "scripts/**",
      "infra/policy/**",
      "eslint.config.mjs",
      "vitest.shared.mjs",
      "**/*.config.{ts,mts,js,mjs}",
      // Integration-test infrastructure (excluded from builds) reads IPB_TEST_PG_URL.
      "packages/*/src/__tests__/**",
    ],
    rules: { "ipb/no-process-env": "off" },
  },
);
