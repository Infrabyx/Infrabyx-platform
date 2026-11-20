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
import { CAPABILITY_LEVELS, PORT_CATALOGUE, promotedObjectMeta } from "@infrabyx/contracts/ports";
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
    {
      // PR-UDF-058 (R1-D-227). A leg configures, for tenant `tnt_contract` only, two named keys
      // `lender:contract` and `lender:contract-b` in `REGULATED`; an adapter without per-object
      // keys declares `put.keyRef` unsupported.
      name: "a put under a named tenant key records the reference and reads back; a bad, unknown, misplaced or changed reference is refused (PR-UDF-058)",
      method: "put.keyRef",
      invoke: (p: StoragePort) =>
        p.put(`tenant/tnt_contract/vault/${ULID.slice(0, 24)}K0.pdf`, new Uint8Array([1]), {
          bucketClass: "REGULATED",
          keyRef: "lender:contract",
        }),
      async run(p: StoragePort) {
        const enc = (s: string) => new TextEncoder().encode(s);
        const k = (n: number) => `tenant/tnt_contract/vault/${ULID.slice(0, 24)}K${n}.pdf`;
        const meta = {
          bucketClass: "REGULATED",
          contentType: "application/pdf",
          keyRef: "lender:contract",
        } as const;
        const refused = (code: string, reason: string) => ({ code, meta: { reason } });
        await p.put(k(1), enc("lender file"), meta);
        const o = await p.get(k(1));
        expect(new TextDecoder().decode(o.body)).toBe("lender file");
        expect(o.meta).toMatchObject({ bucketClass: "REGULATED", keyRef: "lender:contract" });
        await p.put(k(1), enc("second version"), meta);
        for (const other of [
          { ...meta, keyRef: "lender:contract-b" },
          { bucketClass: "REGULATED" },
        ])
          await expect(p.put(k(1), enc("x"), other as typeof meta)).rejects.toMatchObject(
            refused("IPB-PORT-003", "key_ref_changed"),
          );
        await p.put(k(2), enc("other lender"), { ...meta, keyRef: "lender:contract-b" });
        expect((await p.get(k(2))).meta.keyRef).toBe("lender:contract-b");
        for (const bad of [
          "arn:aws:kms:ap-south-1:111122223333:key",
          "1234abcd-12ab-34cd-56ef-1234567890ab",
          "Lender",
        ])
          await expect(p.put(k(3), enc("x"), { ...meta, keyRef: bad })).rejects.toMatchObject(
            refused("IPB-PORT-003", "key_ref_invalid"),
          );
        await expect(
          p.put(k(3), enc("x"), { ...meta, keyRef: "lender:unknown" }),
        ).rejects.toMatchObject(refused("IPB-PORT-001", "key_ref_unknown"));
        await expect(
          p.put(k(3), enc("x"), { bucketClass: "GENERAL", keyRef: "lender:contract" }),
        ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_class"));
        await expect(p.get(k(3))).rejects.toMatchObject({ code: "IPB-STOR-001" });
        const upload = { bucketClass: "REGULATED", contentType: "application/pdf" } as const;
        expect(
          typeof (await p.presign(k(4), "put", 60, { ...upload, keyRef: "lender:contract" })),
        ).toBe("string");
        await expect(
          p.presign(k(1), "put", 60, { ...upload, keyRef: "lender:contract-b" }),
        ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_changed"));
        expect(typeof (await p.presign(k(1), "get", 60))).toBe("string");
      },
    },
    {
      // PR-UDF-068 (R1-D-239). A leg also configures, for `tnt_contract` in `REGULATED`, a named
      // key `lender:contract-off` whose key is disabled; an adapter without per-object keys
      // declares `keyRefStatus` unsupported.
      name: "keyRefStatus answers resolves or the write's refusal label, and with describeKey the key's state, never a key id (PR-UDF-068)",
      method: "keyRefStatus",
      invoke: (p: StoragePort) =>
        p.keyRefStatus
          ? p.keyRefStatus("tnt_contract", "lender:contract", { bucketClass: "REGULATED" })
          : Promise.reject(new Error("adapter lacks keyRefStatus")),
      async run(p: StoragePort) {
        if (!p.keyRefStatus) throw new Error("adapter lacks keyRefStatus");
        const status = (
          keyRef: string,
          opts: Parameters<NonNullable<StoragePort["keyRefStatus"]>>[2],
          t = "tnt_contract",
        ) => p.keyRefStatus!(t, keyRef, opts);
        const reg = { bucketClass: "REGULATED" } as const;
        const answers = [
          await status("lender:contract", reg),
          await status("lender:contract", { ...reg, describeKey: true }),
          await status("lender:contract-b", reg),
          await status("lender:contract-off", reg),
          await status("lender:contract-off", { ...reg, describeKey: true }),
          await status("arn:aws:kms:ap-south-1:111122223333:key", reg),
          await status("Lender", reg),
          await status("lender:unknown", reg),
          await status("lender:contract", { bucketClass: "GENERAL" }),
          await status("lender:contract", reg, "tnt_other"),
        ];
        expect(answers[0]).toEqual({ status: "resolves" });
        // A store that can read the key's state reports it; one that cannot only resolves.
        expect(answers[1]!.status).toBe("resolves");
        if (answers[1]!.keyState !== undefined) expect(answers[1]!.keyState).toBe("Enabled");
        expect(answers[2]).toEqual({ status: "resolves" });
        // Without describeKey the status is the configuration's alone: no KMS call.
        expect(answers[3]).toEqual({ status: "resolves" });
        expect(answers[4]).toMatchObject({ status: "refused", reason: "storage_key_unavailable" });
        if (answers[4]!.keyState !== undefined) expect(answers[4]!.keyState).not.toBe("Enabled");
        expect(answers[5]).toEqual({ status: "refused", reason: "key_ref_invalid" });
        expect(answers[6]).toEqual({ status: "refused", reason: "key_ref_invalid" });
        expect(answers[7]).toEqual({ status: "refused", reason: "key_ref_unknown" });
        expect(answers[8]).toEqual({ status: "refused", reason: "key_ref_class" });
        // A reference resolves only in its own tenant.
        expect(answers[9]).toEqual({ status: "refused", reason: "key_ref_unknown" });
        // Fixed labels only: no key id, ARN or other field in any answer.
        for (const a of answers) {
          for (const f of Object.keys(a)) expect(["status", "reason", "keyState"]).toContain(f);
          expect(JSON.stringify(a)).not.toMatch(/arn:|key\/|[0-9a-f]{8}-[0-9a-f]{4}-/);
        }
        await expect(status("lender:contract", reg, "tnt_a/../x")).rejects.toMatchObject({
          code: "IPB-PORT-003",
        });
        // Read-only: nothing was written under the tenant.
        expect((await p.list("tenant/tnt_other/")).keys).toEqual([]);
      },
    },
    {
      // PR-UDF-066 (R1-D-240). A leg configures `lender:contract` for `tnt_contract` in `QUARANTINE`
      // as well as `REGULATED`, and has a `QUARANTINE` and an `AUDIT` bucket.
      name: "a named key in QUARANTINE: the upload is under it, and a promotion keeps it or is refused, never the class key (PR-UDF-066)",
      method: "put.keyRef",
      invoke: (p: StoragePort) =>
        p.put(`tenant/tnt_contract/inbox/${ULID.slice(0, 24)}Q0.pdf`, new Uint8Array([1]), {
          bucketClass: "QUARANTINE",
          keyRef: "lender:contract",
        }),
      async run(p: StoragePort) {
        const enc = (s: string) => new TextEncoder().encode(s);
        const k = (n: string) => `tenant/tnt_contract/inbox/${ULID.slice(0, 24)}Q${n}.pdf`;
        const refused = (code: string, reason: string) => ({ code, meta: { reason } });
        await p.put(k("1"), enc("lender upload"), {
          bucketClass: "QUARANTINE",
          contentType: "application/pdf",
          keyRef: "lender:contract",
          tags: { kind: "kyc" },
        });
        const q = await p.get(k("1"));
        expect(q.meta).toMatchObject({ bucketClass: "QUARANTINE", keyRef: "lender:contract" });
        if (p.keyRefStatus)
          expect(
            await p.keyRefStatus("tnt_contract", "lender:contract", { bucketClass: "QUARANTINE" }),
          ).toEqual({ status: "resolves" });
        // The scan is clean: the product copies the bytes to the clean class with the same reference.
        await p.put(k("2"), q.body, promotedObjectMeta(q.meta, { bucketClass: "REGULATED" }));
        const clean = await p.get(k("2"));
        expect(new TextDecoder().decode(clean.body)).toBe("lender upload");
        expect(clean.meta).toMatchObject({
          bucketClass: "REGULATED",
          keyRef: "lender:contract",
          contentType: "application/pdf",
          tags: { kind: "kyc" },
        });
        // A promotion into a class without named keys is refused, not written under its key.
        await expect(
          p.put(k("3"), q.body, promotedObjectMeta(q.meta, { bucketClass: "GENERAL" })),
        ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_class"));
        await expect(p.get(k("3"))).rejects.toMatchObject({ code: "IPB-STOR-001" });
        // AUDIT stays on platform keys.
        await expect(
          p.put(k("4"), enc("x"), { bucketClass: "AUDIT", keyRef: "lender:contract" }),
        ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_class"));
        // An overwrite of the quarantined object keeps its reference.
        await expect(p.put(k("1"), enc("x"), { bucketClass: "QUARANTINE" })).rejects.toMatchObject(
          refused("IPB-PORT-003", "key_ref_changed"),
        );
      },
    },
    {
      // PR-UDF-060 (R1-D-230). A leg has REGULATED, CONFIDENTIAL and GENERAL buckets. Where the URL
      // is HTTP (moto, MinIO, a sandbox), the store itself must answer with the signed headers.
      name: "a presigned download of a REGULATED or CONFIDENTIAL object signs no-cache response headers; a GENERAL one does not (PR-UDF-060)",
      async run(p: StoragePort) {
        const k = (c: string) => `tenant/tnt_contract/docs/${ULID.slice(0, 24)}N${c}.pdf`;
        const body = new TextEncoder().encode("statement");
        const cases = [
          ["REGULATED", "R", true],
          ["CONFIDENTIAL", "C", true],
          ["GENERAL", "G", false],
        ] as const;
        for (const [bucketClass, suffix, noCache] of cases) {
          await p.put(k(suffix), body, { bucketClass, contentType: "application/pdf" });
          const url = await p.presign(k(suffix), "get", 60);
          const q = new URL(url).searchParams;
          if (!noCache) {
            expect(q.get("response-cache-control")).toBeNull();
            expect(q.get("response-expires")).toBeNull();
          } else {
            expect(q.get("response-cache-control")).toBe("no-store, private");
            expect(Date.parse(q.get("response-expires") ?? "")).toBeLessThan(Date.now());
          }
          if (!/^https?:/.test(url)) continue;
          const r = await fetch(url);
          expect(r.status).toBe(200);
          expect(new TextDecoder().decode(await r.arrayBuffer())).toBe("statement");
          if (!noCache) continue;
          expect(r.headers.get("cache-control")).toBe("no-store, private");
          expect(Date.parse(r.headers.get("expires") ?? "")).toBeLessThan(Date.now());
        }
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
