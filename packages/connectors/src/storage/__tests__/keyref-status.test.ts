// PR-UDF-068 (R1-D-239): `keyRefStatus`, unit level. The S3 client fails any call (the status is
// configuration only and never touches an object), and `DescribeKey` is replaced by a stand-in that
// answers a key state or fails as KMS does; the moto leg (storage.contract.test.ts) runs the
// built-in contract case with a real disabled moto KMS key.
import { describe, expect, it } from "vitest";
import { MinioStorage, S3Storage, type S3StorageOptions } from "../s3.js";

const LENDERS: Record<string, string> = {
  "lender:a": "arn:aws:kms:ap-south-1:111122223333:key/aaaa1111-1111-4111-8111-111111111111",
  "lender:b": "arn:aws:kms:ap-south-1:444455556666:key/bbbb2222-2222-4222-8222-222222222222",
};

function adapter(over: Partial<S3StorageOptions> = {}) {
  const described: string[] = [];
  let answer: (keyId: string) => Promise<{ KeyMetadata?: { KeyState?: string } }> = async () => ({
    KeyMetadata: { KeyState: "Enabled" },
  });
  const p = new S3Storage({
    region: "ap-south-1",
    buckets: { GENERAL: "b-general", CONFIDENTIAL: "b-conf", REGULATED: "b-reg" },
    kmsKeyIds: { GENERAL: "k-general", CONFIDENTIAL: "k-conf", REGULATED: "k-reg" },
    compartmentBuckets: { SEALED: { REGULATED: "b-reg-sealed" } },
    compartmentKmsKeyIds: { SEALED: { REGULATED: "k-reg-sealed" } },
    tenantNamedKmsKeyIds: (t, w) =>
      t !== "tnt_a"
        ? undefined
        : w.compartment
          ? { "lender:a": `k-lender-a-${w.bucketClass}.${w.compartment}` }
          : w.bucketClass === "CONFIDENTIAL" || w.bucketClass === "REGULATED"
            ? LENDERS
            : undefined,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    ...over,
  });
  (p as unknown as { client: { send: () => Promise<never> } }).client.send = async () => {
    throw new Error("keyRefStatus must not call S3");
  };
  (p as unknown as { describeKey: (k: string) => Promise<unknown> }).describeKey = async (
    keyId: string,
  ) => {
    described.push(keyId);
    return answer(keyId);
  };
  return {
    p,
    described,
    describes: (f: typeof answer) => (answer = f),
  };
}

const kmsError = (name: string, status: number) =>
  Object.assign(new Error(`${name} for arn:aws:kms:ap-south-1:111122223333:key/aaaa1111`), {
    name,
    $metadata: { httpStatusCode: status },
  });
const REG = { bucketClass: "REGULATED" } as const;
const noKeyId = (v: unknown) =>
  expect(JSON.stringify(v, Object.getOwnPropertyNames(v ?? {}))).not.toMatch(/arn:|k-lender/);

describe("PR-UDF-068: STORAGE keyRefStatus", () => {
  it("resolves from configuration alone, with no S3 or KMS call", async () => {
    const { p, described } = adapter();
    expect(await p.keyRefStatus("tnt_a", "lender:a", REG)).toEqual({ status: "resolves" });
    expect(await p.keyRefStatus("tnt_a", "lender:b", { bucketClass: "CONFIDENTIAL" })).toEqual({
      status: "resolves",
    });
    expect(await p.keyRefStatus("tnt_a", "lender:a", { ...REG, compartment: "SEALED" })).toEqual({
      status: "resolves",
    });
    expect(described).toEqual([]);
  });

  it("answers each write refusal with its fixed label", async () => {
    const { p } = adapter({
      tenantKeyRefPrefixes: (t) => (t === "tnt_c" ? { "tenant/tnt_x/vault/": "lender:a" } : {}),
    });
    const cases: Array<[string, string, Parameters<typeof p.keyRefStatus>[2], string]> = [
      ["tnt_a", "arn:aws:kms:ap-south-1:111122223333:key", REG, "key_ref_invalid"],
      ["tnt_a", "mrk-1234abcd12ab34cd56ef1234567890ab", REG, "key_ref_invalid"],
      ["tnt_a", "lender:a", { bucketClass: "GENERAL" }, "key_ref_class"],
      ["tnt_a", "lender:a", { bucketClass: "AUDIT" }, "key_ref_class"],
      ["tnt_a", "lender:z", REG, "key_ref_unknown"],
      ["tnt_b", "lender:a", REG, "key_ref_unknown"],
      ["tnt_c", "lender:a", REG, "key_ref_prefix_invalid"],
    ];
    for (const [t, ref, opts, reason] of cases)
      expect(await p.keyRefStatus(t, ref, opts)).toEqual({ status: "refused", reason });
  });

  it("refuses a shared key and a tenant with its own CMK, as a write does", async () => {
    const shared = adapter({
      tenantNamedKmsKeyIds: () => ({ "lender:a": "k-reg", "lender:b": "k-x", "lender:c": "k-x" }),
    });
    expect(await shared.p.keyRefStatus("tnt_a", "lender:a", REG)).toEqual({
      status: "refused",
      reason: "key_ref_shared",
    });
    expect(await shared.p.keyRefStatus("tnt_a", "lender:b", REG)).toEqual({
      status: "refused",
      reason: "key_ref_shared",
    });
    const cmk = adapter({ tenantKmsKeyId: (t) => (t === "tnt_a" ? "k-tenant-cmk" : undefined) });
    expect(await cmk.p.keyRefStatus("tnt_a", "lender:a", REG)).toEqual({
      status: "refused",
      reason: "key_ref_tenant_cmk",
    });
  });

  it("with describeKey reads the key's state: Enabled resolves, any other state is storage_key_unavailable", async () => {
    const { p, described, describes } = adapter();
    expect(await p.keyRefStatus("tnt_a", "lender:a", { ...REG, describeKey: true })).toEqual({
      status: "resolves",
      keyState: "Enabled",
    });
    expect(described).toEqual([LENDERS["lender:a"]]);
    for (const [state, keyState] of [
      ["Disabled", "Disabled"],
      ["PendingDeletion", "PendingDeletion"],
      ["PendingReplicaDeletion", "PendingReplicaDeletion"],
      ["SomethingNew", "Unavailable"],
      [undefined, "Unavailable"],
    ] as const) {
      describes(async () => ({ KeyMetadata: state ? { KeyState: state } : {} }));
      const a = await p.keyRefStatus("tnt_a", "lender:a", { ...REG, describeKey: true });
      expect(a).toEqual({ status: "refused", reason: "storage_key_unavailable", keyState });
      noKeyId(a);
    }
  });

  it("a key the role cannot describe is unavailable; a transient failure throws IPB-PORT-002 without the key id", async () => {
    const { p, describes } = adapter();
    for (const name of ["AccessDeniedException", "NotFoundException", "KMSInvalidStateException"]) {
      describes(async () => {
        throw kmsError(name, 400);
      });
      expect(await p.keyRefStatus("tnt_a", "lender:a", { ...REG, describeKey: true })).toEqual({
        status: "refused",
        reason: "storage_key_unavailable",
      });
    }
    describes(async () => {
      throw kmsError("ThrottlingException", 400);
    });
    const e = await p
      .keyRefStatus("tnt_a", "lender:a", { ...REG, describeKey: true })
      .catch((x: unknown) => x);
    expect(e).toMatchObject({
      code: "IPB-PORT-002",
      meta: { name: "ThrottlingException", status: 400 },
    });
    expect((e as { cause?: unknown }).cause).toBeUndefined();
    noKeyId(e);
    noKeyId((e as { meta?: unknown }).meta);
  });

  it("describes only a reference that resolves", async () => {
    const { p, described } = adapter();
    expect(await p.keyRefStatus("tnt_a", "lender:z", { ...REG, describeKey: true })).toMatchObject({
      reason: "key_ref_unknown",
    });
    expect(
      await p.keyRefStatus("tnt_a", "lender:a", { bucketClass: "GENERAL", describeKey: true }),
    ).toMatchObject({ reason: "key_ref_class" });
    expect(described).toEqual([]);
  });

  it("refuses another tenant, a malformed tenant id or class, and a location without a bucket", async () => {
    const { p } = adapter({ currentTenant: () => "tnt_a" });
    await expect(p.keyRefStatus("tnt_b", "lender:a", REG)).rejects.toMatchObject({
      code: "IPB-PORT-003",
    });
    const open = adapter();
    for (const t of ["tnt_a/../tnt_b", "TNT", ""])
      await expect(open.p.keyRefStatus(t, "lender:a", REG)).rejects.toMatchObject({
        code: "IPB-PORT-003",
      });
    await expect(
      open.p.keyRefStatus("tnt_a", "lender:a", {
        bucketClass: "CONFIDENTIAL",
        compartment: "SEALED",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001" });
    await expect(
      open.p.keyRefStatus("tnt_a", "lender:a", { bucketClass: "NOPE" as "GENERAL" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003" });
    const noReg = adapter({
      buckets: { GENERAL: "b-general", CONFIDENTIAL: "b-conf" },
      kmsKeyIds: { GENERAL: "k-general", CONFIDENTIAL: "k-conf" },
    });
    await expect(noReg.p.keyRefStatus("tnt_a", "lender:a", REG)).rejects.toMatchObject({
      code: "IPB-PORT-001",
    });
  });

  it("minio declares keyRefStatus unsupported, after the same format checks", async () => {
    const m = new MinioStorage({
      region: "us-east-1",
      buckets: { REGULATED: "b-reg" },
      endpoint: "http://127.0.0.1:9",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    expect(m.descriptor.capabilities).toMatchObject({ keyRefStatus: "unsupported" });
    await expect(m.keyRefStatus("tnt_a", "lender:a", REG)).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "unsupported" },
    });
    expect(await m.keyRefStatus("tnt_a", "Bad", REG)).toEqual({
      status: "refused",
      reason: "key_ref_invalid",
    });
  });
});
