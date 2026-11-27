import { describe, expect, it } from "vitest";
import { blockedFiles } from "./precommit-guard.mjs";

describe("@IPB-11-AT-04 pre-commit guard (IPB-11-09)", () => {
  it("rejects .env files and SEED_CREDENTIALS.md, allows .env.example", () => {
    expect(
      blockedFiles([
        ".env",
        ".env.local",
        "apps/api/.env.prod.local",
        "SEED_CREDENTIALS.md",
        "x/SEED_CREDENTIALS.md",
        ".env.example",
        "src/env.ts",
        "docs/env.md",
      ]),
    ).toEqual([
      ".env",
      ".env.local",
      "apps/api/.env.prod.local",
      "SEED_CREDENTIALS.md",
      "x/SEED_CREDENTIALS.md",
    ]);
  });
});

describe("the local-file SECRETS store (LDC-65)", () => {
  it("is refused wherever it is", () => {
    expect(
      blockedFiles([
        ".infrabyx/local-secrets.json",
        "apps/api/local-secrets.json",
        "x/secrets.json",
      ]),
    ).toEqual([".infrabyx/local-secrets.json", "apps/api/local-secrets.json"]);
  });
});
