import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemorySecrets } from "@infrabyx/testing";
import { CachedSecrets } from "../cache.js";
import { checkPath } from "../common.js";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

describe("SECRETS cache (IPB-01 SECRETS failover, plan §6.1)", () => {
  it("serves from memory for 15 min, keeps serving after a failed refresh while reporting down, never past 24 h", async () => {
    let t = 0;
    const inner = new MemorySecrets();
    await inner.put("secrets/test/x", "v1");
    let reads = 0;
    const flaky = Object.create(inner) as MemorySecrets & { down: boolean };
    flaky.down = false;
    flaky.get = async (p: string, v?: string) => {
      reads++;
      if (flaky.down) throw new Error("store unreachable");
      return inner.get(p, v);
    };
    const c = new CachedSecrets(flaky, { now: () => t });
    expect((await c.get("secrets/test/x")).value).toBe("v1");
    t += 899_000;
    await c.get("secrets/test/x");
    expect(reads).toBe(1);
    flaky.down = true;
    t += 2_000; // cache expired, refresh fails
    expect((await c.get("secrets/test/x")).value).toBe("v1");
    expect((await c.health()).status).toBe("down");
    t += 24 * 3_600_000; // older than 24 h
    await expect(c.get("secrets/test/x")).rejects.toThrow(/unreachable/);
    flaky.down = false;
    expect((await c.get("secrets/test/x")).value).toBe("v1");
    expect((await c.health()).status).toBe("up");
  });

  it("a write invalidates the cached value", async () => {
    const c = new CachedSecrets(new MemorySecrets());
    await c.put("secrets/test/y", "a");
    expect((await c.get("secrets/test/y")).value).toBe("a");
    await c.put("secrets/test/y", "b");
    expect((await c.get("secrets/test/y")).value).toBe("b");
  });

  it("paths are validated and kept inside the configured prefix", () => {
    expect(() =>
      checkPath("x", "secrets/dev/payments/razorpay/key_secret", "secrets/dev/"),
    ).not.toThrow();
    for (const bad of ["secrets/prod/a", "../etc", "secrets//a", "secrets/dev/", "/abs"])
      expect(() => checkPath("x", bad, "secrets/dev/")).toThrow(
        expect.objectContaining({ code: "IPB-PORT-003" }),
      );
  });
});

describe("@IPB-01-AT-19 secrets never from process.env (connectors in scope)", () => {
  it("a connector file reading process.env fails the no-process-env lint, naming the file", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const filePath = `${repoRoot}packages/connectors/src/payments/razorpay.ts`;
    const [r] = await eslint.lintText("export const key = process.env.RAZORPAY_KEY;\n", {
      filePath,
    });
    expect(r?.filePath).toBe(filePath);
    expect(r?.messages.map((m) => m.ruleId)).toContain("ipb/no-process-env");
  });
});
