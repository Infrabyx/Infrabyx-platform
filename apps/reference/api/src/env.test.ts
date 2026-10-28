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
  it("keeps the named ports on fixtures only where fixtures run", async () => {
    const real = {
      ...base,
      AUTH_BASE_URL: "http://127.0.0.1:58080",
      AUTH_REALM: "r",
      AUTH_CLIENT_ID: "c",
      AUTH_CLIENT_SECRET: "s",
      AUTH_ADMIN_CLIENT_ID: "a",
      AUTH_ADMIN_CLIENT_SECRET: "s2",
      AUTH_AUDIENCE: "c",
      AUTHZ_CERBOS_URL: "http://127.0.0.1:53592",
      STORAGE_BUCKET_PREFIX: "ipb-local",
      QUEUE_REDIS_URL: "redis://127.0.0.1:56379",
      WORKFLOW_TEMPORAL_ADDRESS: "127.0.0.1:57233",
    };
    const v = await load({ ...real, APP_FIXTURE_PORTS: "LLM,KMS,TRUST" });
    expect(v.APP_FIXTURE_PORTS).toEqual(["LLM", "KMS", "TRUST"]);
    expect(v.WORKFLOW_TASK_QUEUE_PREFIX).toBe("ipb-");
    await expect(load({ ...real, WORKFLOW_TEMPORAL_ADDRESS: "http://x" })).rejects.toThrow(
      /WORKFLOW_TEMPORAL_ADDRESS/,
    );
    await expect(load({ ...real, APP_FIXTURE_PORTS: "STORAGE" })).rejects.toThrow(
      /APP_FIXTURE_PORTS/,
    );
    // Above the fixture environments the refusal comes after parsing (secret references aside).
    expect(() => checkApiEnv({ ...v, APP_ENV: "staging", APP_FIXTURE_ADAPTERS: false })).toThrow(
      /APP_FIXTURE_PORTS is refused in staging/,
    );
  });
  it("needs every real adapter when fixtures are off", async () => {
    await expect(load(base)).rejects.toThrow(/AUTH_BASE_URL.*WORKFLOW_TEMPORAL_ADDRESS/);
  });
});
