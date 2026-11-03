// The DPoP replay store on its own Redis connection (Udofin PR-UDF-032): a `jti` is claimed once
// across every store on the same Redis, the key carries a TTL, and an unreachable Redis fails the
// claim instead of allowing it. Runs on Redis 7.4 (Testcontainers).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, toHex } from "@infrabyx/crypto";
import { startService, type StartedService } from "@infrabyx/testing";
import { RedisReplayStore } from "../customer.js";

let redis: StartedService | undefined;
let url = "";
const open: RedisReplayStore[] = [];

beforeAll(async () => {
  redis = await startService("redis", { ports: [6379], readyLog: /Ready to accept connections/ });
  url = `redis://${redis.host}:${redis.ports[6379]}`;
}, 120_000);
afterAll(async () => {
  await Promise.all(open.map((s) => s.close()));
  await redis?.stop();
});

const store = (u = url, prefix = `t:${toHex(randomBytes(4))}:`) => {
  const s = RedisReplayStore.fromUrl(u, { prefix, timeoutMs: 1000 });
  open.push(s);
  return s;
};

describe("RedisReplayStore.fromUrl (PR-UDF-032)", () => {
  it("claims a jti once across replicas", async () => {
    const prefix = `t:${toHex(randomBytes(4))}:`;
    const a = store(url, prefix);
    const b = store(url, prefix);
    const exp = new Date(Date.now() + 60_000);
    expect(await a.claim("jti-1", exp)).toBe(true);
    expect(await b.claim("jti-1", exp)).toBe(false);
    expect(await b.claim("jti-2", exp)).toBe(true);
  });

  it("lets a claim expire with its proof", async () => {
    const s = store();
    expect(await s.claim("short", new Date(Date.now() + 1000))).toBe(true);
    await new Promise((r) => setTimeout(r, 1300));
    expect(await s.claim("short", new Date(Date.now() + 1000))).toBe(true);
  });

  it("fails closed when Redis is unreachable", async () => {
    const s = store("redis://127.0.0.1:9");
    await expect(s.claim("x", new Date(Date.now() + 60_000))).rejects.toThrow();
  });

  it("refuses a URL that is not Redis", () => {
    expect(() => RedisReplayStore.fromUrl("https://example.test")).toThrow(/redis:\/\//);
  });
});
