// Port contract harness (IPB-01-15): every adapter of a port passes the same suite. PL2 adapters
// call defineContractSuite(port, factory, cases, { leg }) in their tests; PL1 runs it against the
// fakes. Cases name the method they exercise; a method the adapter declares `unsupported`
// (PL2-D-21) must throw IPB-PORT-001 with meta.reason "unsupported" instead.
import { describe, expect, it } from "vitest";
import {
  PortHealth,
  type ConsentPort,
  type FeatureFlagPort,
  type KmsPort,
  type Port,
  type PortName,
  type SecretsPort,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { CAPABILITY_LEVELS, PORT_CATALOGUE } from "@infrabyx/contracts/ports";
import { residencyAllows } from "@infrabyx/contracts/data-class";

export interface ContractCase<P> {
  name: string;
  run(port: P): Promise<void>;
  /** Port method the case exercises; checked against the adapter's capabilities. */
  method?: string;
  /** Minimal call of `method`, used to assert the typed error when it is unsupported. */
  invoke?(port: P): Promise<unknown>;
}

/** Test legs (PL2 plan §3.11); the leg is part of the suite title so reports can tell them apart. */
export type ContractLeg = "unit" | "hermetic" | "sandbox";

export interface ContractSuiteOptions {
  leg?: ContractLeg;
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
    {
      name: "retention is only ever extended, and read back (PR-FBX-27)",
      async run(p: StoragePort) {
        if (!p.extendRetention || !p.retentionOf) throw new Error("adapter lacks extendRetention");
        const key = `tenant/tnt_contract/vcip/${ULID.slice(0, 25)}X.webm`;
        const first = new Date(Date.now() + 86_400_000);
        await p.putWithRetention(key, new TextEncoder().encode("rec"), first, {
          bucketClass: "REGULATED",
        });
        const before = await p.retentionOf(key);
        expect(before.mode).toBe("COMPLIANCE");
        expect(Math.abs(Date.parse(before.retainUntil ?? "") - first.getTime())).toBeLessThan(2000);
        await expect(
          p.extendRetention(key, new Date(first.getTime() - 3_600_000)),
        ).rejects.toMatchObject({ code: "IPB-STOR-003" });
        const later = new Date(first.getTime() + 30 * 86_400_000);
        expect((await p.extendRetention(key, later)).mode).toBe("COMPLIANCE");
        expect(Date.parse((await p.retentionOf(key)).retainUntil ?? "")).toBeGreaterThan(
          first.getTime() + 29 * 86_400_000,
        );
        await p.assertImmutable(key);
        const plain = `tenant/tnt_contract/vcip/${ULID.slice(0, 25)}Y.json`;
        await p.put(plain, new TextEncoder().encode("{}"), { bucketClass: "GENERAL" });
        expect(await p.retentionOf(plain)).toEqual({ mode: null, retainUntil: null });
        await expect(p.extendRetention(plain, later)).rejects.toMatchObject({
          code: "IPB-STOR-003",
        });
      },
    },
  ] as Array<ContractCase<never>>,
  CONSENT: [
    {
      name: "latestByPrincipal gives the latest record per purpose, in the caller's tenant only (PR-LDC-14)",
      method: "latestByPrincipal",
      invoke: (p: ConsentPort) => p.latestByPrincipal?.("prn_contract_none") ?? Promise.resolve([]),
      async run(p: ConsentPort) {
        if (!p.latestByPrincipal) throw new Error("adapter lacks latestByPrincipal");
        // An approved text the adapter can cite (the pg_local test seeds it).
        const text = (p as unknown as { contractText?: { textKey: string; textVersion: string } })
          .contractText ?? { textKey: "consent.contact_form", textVersion: "1.0" };
        const ref = `prn_contract_${Date.now().toString(36)}`;
        const a = { tenantId: "tnt_contract_a" };
        const b = { tenantId: "tnt_contract_b" };
        const base = {
          principalRef: ref,
          method: "FORM" as const,
          region: "IN" as const,
          gpc: false,
          ...text,
        };
        const first = await p.recordConsent({ ...base, purposes: ["LEAD_CONTACT"] }, a);
        const second = await p.recordConsent(
          { ...base, purposes: ["LEAD_CONTACT", "MARKETING_EMAIL"] },
          a,
        );
        await p.recordConsent({ ...base, purposes: ["ANALYTICS"] }, b);
        await p.recordConsent(
          { ...base, principalRef: `${ref}_x`, purposes: ["MARKETING_SMS"] },
          a,
        );
        const got = await p.latestByPrincipal(ref, a);
        expect(got.map((x) => x.purpose)).toEqual(["LEAD_CONTACT", "MARKETING_EMAIL"]);
        expect(first.receiptId).not.toBe(second.receiptId);
        for (const x of got)
          expect(x).toMatchObject({ receiptId: second.receiptId, granted: true });
        expect((await p.latestByPrincipal(ref, b)).map((x) => x.purpose)).toEqual(["ANALYTICS"]);
        expect(await p.latestByPrincipal(`${ref}_none`, a)).toEqual([]);
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
  opts: ContractSuiteOptions = {},
): void {
  const leg = opts.leg ?? "unit";
  describe(`@IPB-01-15 ${port} port contract (tier ${PORT_CATALOGUE[port].tier}, leg ${leg})`, () => {
    it("declares port, adapter, residency and max data class", async () => {
      const p = await factory();
      expect(p.descriptor.port).toBe(port);
      expect(p.descriptor.adapter).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(["IN", "IN-ZR", "GLOBAL"]).toContain(p.descriptor.residency);
      // An adapter's residency must be able to carry its own maximum class (IPB-01-16).
      expect(residencyAllows(p.descriptor.residency, p.descriptor.maxDataClass)).toBe(true);
      for (const c of Object.values(p.descriptor.capabilities ?? {}))
        expect(CAPABILITY_LEVELS).toContain(c);
    });
    it("health() returns a PortHealth", async () => {
      const p = await factory();
      expect(PortHealth.safeParse(await p.health()).success).toBe(true);
    });
    for (const c of [
      ...((BUILT_IN_CASES[port] ?? []) as unknown as Array<ContractCase<P>>),
      ...cases,
    ]) {
      it(c.name, async () => {
        const p = await factory();
        if (c.method && p.descriptor.capabilities?.[c.method] === "unsupported") {
          if (!c.invoke) return;
          await expect(c.invoke(p)).rejects.toMatchObject({
            code: "IPB-PORT-001",
            meta: { reason: "unsupported" },
          });
          return;
        }
        await c.run(p);
      });
    }
  });
}
