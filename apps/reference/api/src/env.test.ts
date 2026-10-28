import { describe, expect, it } from "vitest";
import { validateEnv } from "@infrabyx/config/env";
import { apiEnvSchema, checkApiEnv } from "./env.js";

const base = {
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  DB_URL: "postgres://app@localhost:5432/ref",
};

async function load(source: Record<string, string>) {
  const r = await validateEnv(apiEnvSchema, { source, guards: [] });
  if (!r.ok) throw new Error(r.failures.map((f) => `${f.name}: ${f.reason}`).join("; "));
  return checkApiEnv(r.values);
}

describe("apiEnv (IPB-11 §11.4)", () => {
  it("accepts fixtures in local and defaults the product and port", async () => {
    const v = await load({ ...base, APP_FIXTURE_ADAPTERS: "true" });
    expect(v.APP_PRODUCT).toBe("LD");
    expect(v.APP_PORT).toBe(3000);
  });
  it("refuses fixtures from staging upwards", async () => {
    await expect(
      load({ ...base, APP_ENV: "staging", APP_FIXTURE_ADAPTERS: "true" }),
    ).rejects.toThrow(/refused in staging/);
  });
  it("needs every real adapter when fixtures are off", async () => {
    await expect(load(base)).rejects.toThrow(/AUTH_BASE_URL.*QUEUE_REDIS_URL/);
  });
});
