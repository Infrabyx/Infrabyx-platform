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
