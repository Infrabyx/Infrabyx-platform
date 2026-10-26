import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import type { Port, PortHealth } from "@infrabyx/contracts/ports";
import { TEST_IMAGES } from "../containers.js";
import { defineContractSuite } from "../contract.js";
import { startFaultProxy } from "./fault-proxy.js";
import { sandboxLeg } from "./sandbox.js";

describe("fault-injection proxy (@IPB-01-AT-08 helper)", () => {
  let upstream: ReturnType<typeof createServer>;
  let target = "";
  beforeAll(async () => {
    upstream = createServer((req, res) => {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ path: req.url, method: req.method }));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => upstream.close(() => r())));

  it("fails the first N requests, then forwards", async () => {
    const proxy = await startFaultProxy(target, { failFirst: 2, status: 502 });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++)
      codes.push((await fetch(`${proxy.url}/v1/orders`, { method: "POST", body: "{}" })).status);
    expect(codes).toEqual([502, 502, 201]);
    expect(proxy.requests).toBe(3);
    proxy.setPlan({ delayMs: 50 });
    const t0 = Date.now();
    const r = await fetch(`${proxy.url}/x`);
    expect(r.status).toBe(201);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
    await proxy.close();
  });
});

describe("sandbox-leg gate (IPB-DEV-04)", () => {
  it("is unavailable without its variables and names only what is missing", async () => {
    const leg = await sandboxLeg("razorpay", ["CONTRACT_TEST_NEVER_SET_KEY"]);
    expect(leg.available).toBe(false);
    expect(leg.missing).toEqual(["CONTRACT_TEST_NEVER_SET_KEY"]);
  });
  it("fails instead of skipping when IPB_TEST_SANDBOX_REQUIRED=true", async () => {
    vi.stubEnv("IPB_TEST_SANDBOX_REQUIRED", "true");
    try {
      await expect(sandboxLeg("razorpay", ["CONTRACT_TEST_NEVER_SET_KEY"])).rejects.toThrow(
        /missing IPB_TEST_SANDBOX_CONTRACT_TEST_NEVER_SET_KEY/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("pinned test images", () => {
  it("infra/docker/TEST_IMAGES.md lists exactly the images in TEST_IMAGES", () => {
    const md = readFileSync(
      new URL("../../../../infra/docker/TEST_IMAGES.md", import.meta.url),
      "utf8",
    );
    for (const [name, img] of Object.entries(TEST_IMAGES)) {
      expect(md, name).toContain(`| \`${name}\``);
      expect(md, name).toContain(img.image);
      expect(img.image, name).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
    const rows = md.split("\n").filter((l) => /^\| `[a-z]+`/.test(l));
    expect(rows.length).toBe(Object.keys(TEST_IMAGES).length);
  });
});

// A fake adapter that declares `replay` unsupported: the harness asserts the typed error (PL2-D-21).
const up = (): PortHealth => ({
  status: "up",
  latency_ms: 0,
  checked_at: new Date().toISOString(),
});
class ReplayLess implements Port {
  readonly descriptor = {
    port: "QUEUE",
    adapter: "replayless",
    residency: "IN",
    maxDataClass: "INTERNAL",
    capabilities: { replay: "unsupported" },
  } as const;
  async health() {
    return up();
  }
  async replay(): Promise<never> {
    throw new PortError("IPB-PORT-001", "QUEUE", {
      adapter: "replayless",
      meta: { reason: "unsupported" },
    });
  }
}
defineContractSuite<ReplayLess>(
  "QUEUE",
  () => new ReplayLess(),
  [
    {
      name: "replay re-delivers DLQ jobs",
      method: "replay",
      run: async () => {
        throw new Error("must not run for an unsupported method");
      },
      invoke: (p) => p.replay(),
    },
  ],
  { leg: "unit" },
);

describe("ipb/port-data-class mirrors the contracts", () => {
  it("PORT_DEFAULTS in the ESLint plugin equals PORT_DEFAULT_DATA_CLASS", async () => {
    const pluginPath = "../../eslint/index.mjs";
    const plugin = (await import(pluginPath)) as { PORT_DEFAULTS: Record<string, string> };
    const { PORT_DEFAULT_DATA_CLASS } = await import("@infrabyx/contracts/ports");
    expect(plugin.PORT_DEFAULTS).toEqual({ ...PORT_DEFAULT_DATA_CLASS });
  });
});
