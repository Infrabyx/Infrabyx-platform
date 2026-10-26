// ESLint flat config — infrabyx-platform
// Custom IPB rules live in infra/policy/eslint (IPB-01 §01.4.2 puts policy under infra/policy).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import ipb from "./infra/policy/eslint/index.mjs";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/coverage/**"],
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
    ],
    rules: { "ipb/no-process-env": "off" },
  },
);
