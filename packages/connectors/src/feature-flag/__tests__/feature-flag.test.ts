import { describe, expect, it } from "vitest";
import { FlagService, MemorySnapshotStore } from "@infrabyx/config/flags";
import { assertHashedContext } from "../context.js";
import { UnleashFlags } from "../unleash.js";

describe("FEATURE_FLAG adapters (PL2 plan §6.4)", () => {
  it("contexts carry C-21 hashes only", () => {
    expect(() =>
      assertHashedContext("x", { tenantKey: "0".repeat(32), userKey: "f".repeat(32) }),
    ).not.toThrow();
    expect(() => assertHashedContext("x", { userKey: "usr_1" })).toThrow(
      expect.objectContaining({ code: "IPB-PORT-003" }),
    );
  });

  it("unleash refuses plain HTTP outside loopback tests", async () => {
    await expect(
      UnleashFlags.start(
        { url: "http://flags.internal", appName: "a", environment: "dev", clientToken: "t" },
        10,
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-018" });
  });

  it("an unsynchronised client is unavailable, so kill switches go to the safe state", async () => {
    const a = await UnleashFlags.start(
      {
        url: "http://127.0.0.1:9",
        appName: "a",
        environment: "dev",
        clientToken: "t",
        allowLoopbackHttp: true,
      },
      10,
    );
    try {
      expect((await a.health()).status).toBe("down");
      const flags = new FlagService({ provider: a, snapshots: new MemorySnapshotStore() });
      expect(await flags.evaluate("kill.payments")).toMatchObject({
        value: true,
        source: "safe-state",
      });
      await expect(a.listFlags()).rejects.toMatchObject({ code: "IPB-PORT-001" });
    } finally {
      a.stop();
    }
  });
});
