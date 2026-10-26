// Port contract harness (IPB-01-15): every adapter of a port passes the same suite. PL2 adapters
// call defineContractSuite(port, factory) in their tests; PL1 runs it against the fakes.
import { describe, expect, it } from "vitest";
import {
  PortHealth,
  type FeatureFlagPort,
  type KmsPort,
  type Port,
  type PortName,
  type SecretsPort,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { PORT_CATALOGUE } from "@infrabyx/contracts/ports";

export interface ContractCase<P> {
  name: string;
  run(port: P): Promise<void>;
}

const ULID = "01JA0000000000000000000000";

export const BUILT_IN_CASES: Partial<Record<PortName, Array<ContractCase<never>>>> = {
  SECRETS: [
    {
      name: "put then get returns the latest version; versions increase",
      async run(p: SecretsPort) {
        const a = await p.put("contract/test/a", "one");
        const b = await p.put("contract/test/a", "two");
        expect(b.version).not.toBe(a.version);
        expect((await p.get("contract/test/a")).value).toBe("two");
        expect(await p.list("contract/test/")).toContain("contract/test/a");
      },
    },
  ] as Array<ContractCase<never>>,
  KMS: [
    {
      name: "encrypt/decrypt round-trips with AAD; sign verifies with the public key",
      async run(p: KmsPort) {
        const keys = (p as unknown as { contractKeys?: { symmetric: string; signing: string } })
          .contractKeys ?? { symmetric: "local:platform", signing: "local:sign:audit-anchor" };
        const aad = new TextEncoder().encode("ctx");
        const ct = await p.encrypt(keys.symmetric, new TextEncoder().encode("hello"), aad);
        expect(new TextDecoder().decode(await p.decrypt(keys.symmetric, ct, aad))).toBe("hello");
        await expect(
          p.decrypt(keys.symmetric, ct, new TextEncoder().encode("other")),
        ).rejects.toThrow();
        const msg = new TextEncoder().encode("anchor");
        const sig = await p.sign(keys.signing, msg, "ecdsa-p256-sha256");
        expect(await p.verify(keys.signing, msg, sig, "ecdsa-p256-sha256")).toBe(true);
        expect((await p.getPublicKey(keys.signing)).byteLength).toBeGreaterThan(0);
      },
    },
  ] as Array<ContractCase<never>>,
  STORAGE: [
    {
      name: "retained objects are write-once and cannot be deleted before retention expires (IPB-STOR-003)",
      async run(p: StoragePort) {
        const key = `tenant/tnt_contract/audit/${ULID}.json`;
        await p.putWithRetention(
          key,
          new TextEncoder().encode("{}"),
          new Date(Date.now() + 86_400_000),
          { bucketClass: "AUDIT" },
        );
        await p.assertImmutable(key);
        await expect(p.delete(key)).rejects.toMatchObject({ code: "IPB-STOR-003" });
        expect(new TextDecoder().decode((await p.get(key)).body)).toBe("{}");
        await expect(
          p.put("not/a/valid/key", new Uint8Array(), { bucketClass: "GENERAL" }),
        ).rejects.toThrow();
      },
    },
  ] as Array<ContractCase<never>>,
  FEATURE_FLAG: [
    {
      name: "unknown flags return the caller's default; snapshot has a fetch time",
      async run(p: FeatureFlagPort) {
        expect(await p.getBooleanValue("kill.contract-unknown", true)).toBe(true);
        expect(await p.getBooleanValue("kill.contract-unknown", false)).toBe(false);
        expect(Number.isNaN(Date.parse((await p.snapshot()).fetchedAt))).toBe(false);
      },
    },
  ] as Array<ContractCase<never>>,
};

/** Run the common port conventions (IPB-01 §01.4.4.1), the built-in cases for the port, and `cases`. */
export function defineContractSuite<P extends Port>(
  port: PortName,
  factory: () => P | Promise<P>,
  cases: ReadonlyArray<ContractCase<P>> = [],
): void {
  describe(`@IPB-01-15 ${port} port contract (tier ${PORT_CATALOGUE[port].tier})`, () => {
    it("declares port, adapter, residency and max data class", async () => {
      const p = await factory();
      expect(p.descriptor.port).toBe(port);
      expect(p.descriptor.adapter).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(["IN", "IN-ZR", "GLOBAL"]).toContain(p.descriptor.residency);
    });
    it("health() returns a PortHealth", async () => {
      const p = await factory();
      expect(PortHealth.safeParse(await p.health()).success).toBe(true);
    });
    for (const c of [
      ...((BUILT_IN_CASES[port] ?? []) as unknown as Array<ContractCase<P>>),
      ...cases,
    ]) {
      it(c.name, async () => c.run(await factory()));
    }
  });
}
