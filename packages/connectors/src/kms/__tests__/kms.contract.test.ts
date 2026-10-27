// KMS contract legs (PL2 plan §6.2). Hermetic: LocalStack 4.12.0 for AWS KMS (it signs
// MessageType DIGEST correctly, PL2-D-29) and OpenBao 2.7.1 Transit. Re-runs the PL1 field
// envelope and the @IPB-02-AT-15 anchor signature path against both adapters.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService, verifyAnchorFile, type AnchorFile } from "@infrabyx/audit";
import type { KmsPort, StoragePort } from "@infrabyx/contracts/ports";
import { randomBytes, sha256, toHex } from "@infrabyx/crypto";
import { FieldCrypto } from "@infrabyx/tenancy";
import {
  MemoryStorage,
  defineContractSuite,
  startPostgres,
  startService,
  withTenant,
  type StartedService,
  type TestDatabase,
} from "@infrabyx/testing";
import { AwsKms } from "../aws-kms.js";
import { kmsContext } from "../common.js";
import { VaultTransit } from "../vault-transit.js";

const ROOT = toHex(randomBytes(16));
const creds = { accessKeyId: "test", secretAccessKey: "test" };
let ls: StartedService;
let bao: StartedService;
let db: TestDatabase;
const keys: Record<"aws" | "vault", { symmetric: string; signing: string }> = {
  aws: { symmetric: "", signing: "" },
  vault: { symmetric: "platform", signing: "anchor-signing" },
};

const lsUrl = () => `http://${ls.host}:${ls.ports[4566]}`;
const baoUrl = () => `http://${bao.host}:${bao.ports[8200]}`;
async function vaultApi(method: string, path: string, body?: unknown) {
  const r = await fetch(`${baoUrl()}${path}`, {
    method,
    headers: { "X-Vault-Token": ROOT, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`);
}

beforeAll(async () => {
  [ls, bao, db] = await Promise.all([
    startService("localstack", { ports: [4566], env: { SERVICES: "kms" }, readyLog: /Ready\./ }),
    startService("openbao", {
      ports: [8200],
      command: ["server", "-dev", `-dev-root-token-id=${ROOT}`, "-dev-listen-address=0.0.0.0:8200"],
      readyLog: /post-unseal setup complete/,
      configure: (c) => c.withAddedCapabilities("IPC_LOCK"),
    }),
    startPostgres(),
  ]);
  const { KMSClient, CreateKeyCommand } = await import("@aws-sdk/client-kms");
  const kms = new KMSClient({ region: "ap-south-1", endpoint: lsUrl(), credentials: creds });
  keys.aws.symmetric = (await kms.send(new CreateKeyCommand({}))).KeyMetadata!.KeyId!;
  keys.aws.signing = (
    await kms.send(new CreateKeyCommand({ KeySpec: "ECC_NIST_P256", KeyUsage: "SIGN_VERIFY" }))
  ).KeyMetadata!.KeyId!;
  await vaultApi("POST", "/v1/sys/mounts/transit", { type: "transit" });
  await vaultApi("POST", "/v1/transit/keys/platform", { type: "aes256-gcm96" });
  await vaultApi("POST", "/v1/transit/keys/anchor-signing", { type: "ecdsa-p256" });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_k', 'LD', 'K'), ('tnt_ka', 'LD', 'KA'), ('tnt_kv', 'LD', 'KV')",
  );
});
afterAll(async () => {
  await Promise.all([ls?.stop(), bao?.stop(), db?.end()]);
});

const withKeys = <P extends KmsPort>(p: P, k: { symmetric: string; signing: string }) =>
  Object.assign(p, { contractKeys: k });
const aws = async () =>
  withKeys(
    await AwsKms.create({ region: "ap-south-1", endpoint: lsUrl(), credentials: creds }),
    keys.aws,
  );
const vault = async () =>
  withKeys(
    new VaultTransit({
      address: baoUrl(),
      auth: { kind: "token", token: ROOT },
      allowLoopbackHttp: true,
    }),
    keys.vault,
  );

const cases = (k: () => { symmetric: string; signing: string }, anchorTenant: string) => [
  {
    name: "a wrong AAD, or a missing one, is refused with IPB-KMS-001 (integrity)",
    async run(p: KmsPort) {
      const aad = kmsContext({ tenant_id: "tnt_k", purpose: "field" });
      const ct = await p.encrypt(k().symmetric, new TextEncoder().encode("x"), aad);
      for (const bad of [kmsContext({ tenant_id: "tnt_other", purpose: "field" }), undefined])
        await expect(p.decrypt(k().symmetric, ct, bad)).rejects.toMatchObject({
          code: "IPB-KMS-001",
          meta: { reason: "integrity" },
        });
    },
  },
  {
    name: "a data key bound to its AAD round-trips; the plaintext key is 32 bytes",
    async run(p: KmsPort) {
      const aad = kmsContext({ tenant_id: "tnt_k", purpose: "field" });
      const dk = await p.generateDataKey(k().symmetric, aad);
      expect(dk.plaintext.byteLength).toBe(32);
      expect(toHex(await p.decrypt(k().symmetric, dk.ciphertext, aad))).toBe(toHex(dk.plaintext));
    },
  },
  {
    name: "data keys need the C-14 context; a wrong tenant or purpose fails closed (PL2-D-50)",
    async run(p: KmsPort) {
      await expect(p.generateDataKey(k().symmetric)).rejects.toMatchObject({
        code: "IPB-PORT-003",
      });
      await expect(
        p.generateDataKey(k().symmetric, new TextEncoder().encode('{"tenant_id":"tnt_k"}')),
      ).rejects.toMatchObject({ code: "IPB-PORT-003" });
      const dk = await p.generateDataKey(
        k().symmetric,
        kmsContext({ tenant_id: "tnt_k", purpose: "field" }),
      );
      for (const bad of [
        { tenant_id: "tnt_x", purpose: "field" },
        { tenant_id: "tnt_k", purpose: "health" },
      ] as const)
        await expect(
          p.decrypt(k().symmetric, dk.ciphertext, kmsContext(bad)),
        ).rejects.toMatchObject({
          code: "IPB-KMS-001",
          meta: { reason: "integrity" },
        });
    },
  },
  {
    name: "PL1 field encryption round-trips through the adapter and binds the field location",
    async run(p: KmsPort) {
      const fc = new FieldCrypto({ kms: p, keyIdFor: () => k().symmetric });
      const at = { table: "cases.party", column: "pan", rowId: "pty_1" };
      const sealed = await fc.encryptField("tnt_k", "REGULATED", "ABCDE1234F", at);
      expect(fc.formatVersion(sealed)).toBe(2);
      expect(await fc.decryptFieldText("tnt_k", sealed, at)).toBe("ABCDE1234F");
      await expect(
        fc.decryptFieldText("tnt_k", sealed, { ...at, rowId: "pty_2" }),
      ).rejects.toThrow();
    },
  },
  {
    name: "only ecdsa-p256-sha256 signs; listAlgorithms names the approved set",
    async run(p: KmsPort) {
      await expect(
        p.sign(k().signing, new Uint8Array([1]), "rsa-pss-sha256"),
      ).rejects.toMatchObject({
        code: "IPB-PORT-001",
      });
      expect(await p.listAlgorithms()).toEqual(["aes-256-gcm", "ecdsa-p256-sha256"]);
      expect(
        await p.verify(
          k().signing,
          new Uint8Array([1]),
          new Uint8Array([0x30, 0]),
          "ecdsa-p256-sha256",
        ),
      ).toBe(false);
    },
  },
  {
    name: "tenant keys are created once per tenant (C-15)",
    async run(p: KmsPort) {
      const a = await p.createTenantKey("tnt_k");
      expect((await p.createTenantKey("tnt_k")).keyId).toBe(a.keyId);
      const ct = await p.encrypt(
        a.keyId,
        new TextEncoder().encode("r"),
        kmsContext({ tenant_id: "tnt_k", purpose: "field" }),
      );
      expect(ct.byteLength).toBeGreaterThan(0);
      await expect(p.createTenantKey("bad tenant")).rejects.toMatchObject({ code: "IPB-PORT-003" });
    },
  },
  {
    name: "key deletion is scheduled exactly 30 days ahead, never sooner (C-15)",
    method: "scheduleKeyDeletion",
    invoke: (p: KmsPort) => p.scheduleKeyDeletion("x", 30),
    async run(p: KmsPort) {
      await expect(p.scheduleKeyDeletion(k().symmetric, 7)).rejects.toMatchObject({
        code: "IPB-PORT-003",
      });
      const { keyId } = await p.createTenantKey(`tnt_del_${toHex(randomBytes(3))}`);
      const { deletionDate } = await p.scheduleKeyDeletion(keyId, 30);
      expect(Date.parse(deletionDate) - Date.now()).toBeGreaterThan(29 * 86_400_000);
      await expect(p.encrypt(keyId, new Uint8Array([1]))).rejects.toThrow();
    },
  },
  {
    name: "@IPB-02-AT-15 anchors signed through the adapter verify with the public key alone",
    async run(p: KmsPort) {
      const storage = new MemoryStorage();
      const svc = new AuditService({
        kernel: db.kernel,
        sink: db.audit,
        product: "LD",
        storage: storage as unknown as StoragePort,
        kms: p,
        anchorKeyId: k().signing,
      });
      const c = withTenant(anchorTenant);
      await db.kernel.mutate(c, (tx) =>
        db.audit.record(tx, {
          action: "cases.case.update",
          resourceType: "case",
          resourceId: `r_${toHex(randomBytes(3))}`,
          after: { v: 1 },
        }),
      );
      const today = new Date().toISOString().slice(0, 10);
      const file = await svc.writeAnchor(
        withTenant(anchorTenant, ["SVC_AUDIT"], {
          principal: { id: "svc_audit", type: "service" },
        }),
        today,
      );
      const pub = await p.getPublicKey(k().signing);
      expect(verifyAnchorFile(file, pub)).toBe(true);
      expect(verifyAnchorFile({ ...file, head_hash: "0".repeat(64) } as AnchorFile, pub)).toBe(
        false,
      );
      // The adapter's own verify agrees with the public-key check.
      const msg = new TextEncoder().encode("anchor");
      const sig = await p.sign(k().signing, msg, "ecdsa-p256-sha256");
      expect(await p.verify(k().signing, msg, sig, "ecdsa-p256-sha256")).toBe(true);
      expect(await p.verify(k().signing, sha256(msg), sig, "ecdsa-p256-sha256")).toBe(false);
    },
  },
];

describe("@IPB-01-15 KMS hermetic leg: aws-kms on LocalStack 4.12.0", () => {
  defineContractSuite(
    "KMS",
    aws,
    cases(() => keys.aws, "tnt_ka"),
    { leg: "hermetic" },
  );

  it("refuses a region outside India at creation", async () => {
    await expect(AwsKms.create({ region: "eu-west-1" })).rejects.toMatchObject({
      code: "IPB-PORT-005",
    });
  });

  it("an unreachable KMS fails closed with IPB-KMS-001 (no plaintext fallback)", async () => {
    const down = await AwsKms.create({
      region: "ap-south-1",
      endpoint: "http://127.0.0.1:9",
      credentials: creds,
    });
    await expect(down.decrypt(keys.aws.symmetric, new Uint8Array(64))).rejects.toMatchObject({
      code: "IPB-KMS-001",
      meta: { reason: "unavailable" },
    });
    expect((await down.health()).status).toBe("down");
  });
});

describe("@IPB-01-15 KMS hermetic leg: vault-transit on OpenBao 2.7.1", () => {
  defineContractSuite(
    "KMS",
    vault,
    cases(() => keys.vault, "tnt_kv"),
    { leg: "hermetic" },
  );

  it("signatures from a rotated key version still verify", async () => {
    const v = await vault();
    const msg = new TextEncoder().encode("before rotation");
    const sig = await v.sign("anchor-signing", msg, "ecdsa-p256-sha256");
    await vaultApi("POST", "/v1/transit/keys/anchor-signing/rotate");
    expect(await v.verify("anchor-signing", msg, sig, "ecdsa-p256-sha256")).toBe(true);
  });
});
