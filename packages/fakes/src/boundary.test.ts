// PR-FBX-48 (R1-D-181): the fakes carry no test runner, container library or database driver, so a
// product that wires them at runtime keeps vitest and its tree out of its production audit.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as fakes from "./index.js";

const SRC = new URL(".", import.meta.url).pathname;
const sources = readdirSync(SRC, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const FORBIDDEN =
  /^(vitest|@vitest\/|vite$|testcontainers|@testcontainers\/|pg$|libpg-query|@infrabyx\/testing)/;

describe("@infrabyx/fakes boundary (PR-FBX-48)", () => {
  it("no module imports a test runner, a container library or a database driver", () => {
    const offenders: string[] = [];
    for (const f of sources) {
      const text = readFileSync(join(SRC, f), "utf8");
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g))
        if (FORBIDDEN.test(m[1]!)) offenders.push(`${f}: ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("depends only on contracts, crypto and config at runtime", () => {
    const pj = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    expect(Object.keys(pj.dependencies ?? {}).sort()).toEqual([
      "@infrabyx/config",
      "@infrabyx/contracts",
      "@infrabyx/crypto",
    ]);
    expect(pj.peerDependencies).toBeUndefined();
    expect(pj.optionalDependencies).toBeUndefined();
  });

  it("exports the fakes products wire in fixture environments", () => {
    for (const name of [
      "MemoryStorage",
      "MemorySecrets",
      "MemoryIdentity",
      "MemoryFlagProvider",
      "fakeKms",
      "FakeKyc",
      "FakeAccountingSink",
      "FakeCreditBureau",
      "FakeAccountAggregator",
      "FakeDisbursementRail",
      "FakeLlm",
      "FakeTrustFeed",
      "FakeCrm",
    ])
      expect(typeof (fakes as Record<string, unknown>)[name], name).toBe("function");
  });

  it("a fake works without the harness", async () => {
    const secrets = new fakes.MemorySecrets();
    const { version } = await secrets.put("int/demo/key", "s3cret");
    expect(version).toBe("1");
    expect((await secrets.get("int/demo/key")).value).toBe("s3cret");
  });
});
