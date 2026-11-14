// PR-LDC-60 (R1-D-158): separately keyed compartments, unit level. The S3 client is replaced by an
// in-memory stand-in that records each write's bucket and KMS key, so the bucket and key choices
// are checked without a store; the moto leg (storage.contract.test.ts) runs them end to end.
import { describe, expect, it } from "vitest";
import { ulid } from "@infrabyx/crypto";
import { S3Storage, type S3StorageOptions } from "../s3.js";

interface Put {
  Bucket: string;
  Key: string;
  SSEKMSKeyId?: string;
  ServerSideEncryption?: string;
}

/** An adapter whose client keeps objects in memory and records every PutObject. */
function adapter(over: Partial<S3StorageOptions> = {}) {
  const store = new Map<string, { body: Uint8Array; ct?: string }>();
  const puts: Put[] = [];
  const p = new S3Storage({
    region: "ap-south-1",
    buckets: { GENERAL: "b-general", CONFIDENTIAL: "b-conf", REGULATED: "b-reg" },
    kmsKeyIds: { GENERAL: "k-general", CONFIDENTIAL: "k-conf", REGULATED: "k-reg" },
    compartmentBuckets: {
      BOARD_CONFIDENTIAL: { CONFIDENTIAL: "b-conf-board" },
      SEALED: { CONFIDENTIAL: "b-conf-sealed", REGULATED: "b-reg-sealed" },
    },
    compartmentKmsKeyIds: {
      BOARD_CONFIDENTIAL: { CONFIDENTIAL: "k-conf-board" },
      SEALED: { CONFIDENTIAL: "k-conf-sealed", REGULATED: "k-reg-sealed" },
    },
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    ...over,
  });
  const notFound = () => Object.assign(new Error("NotFound"), { name: "NotFound" });
  (p as unknown as { client: { send: (c: unknown) => Promise<unknown> } }).client.send = async (
    cmd: unknown,
  ) => {
    const name = (cmd as { constructor: { name: string } }).constructor.name;
    const input = (cmd as { input: Record<string, unknown> }).input;
    const id = `${String(input.Bucket)}/${String(input.Key)}`;
    if (name === "HeadObjectCommand") {
      if (!store.has(id)) throw notFound();
      return { Metadata: {} };
    }
    if (name === "PutObjectCommand") {
      puts.push(input as unknown as Put);
      store.set(id, { body: input.Body as Uint8Array, ct: input.ContentType as string });
      return {};
    }
    if (name === "GetObjectCommand") {
      const o = store.get(id);
      if (!o) throw notFound();
      return {
        Body: { transformToByteArray: async () => o.body },
        ContentType: o.ct,
        Metadata: {},
      };
    }
    if (name === "ListObjectsV2Command")
      return {
        Contents: [...store.keys()]
          .filter((k) => k.startsWith(`${String(input.Bucket)}/${String(input.Prefix)}`))
          .map((k) => ({ Key: k.slice(String(input.Bucket).length + 1) })),
      };
    throw new Error(`unexpected ${name}`);
  };
  return { p, puts };
}

const enc = (s: string) => new TextEncoder().encode(s);
const key = (t = "tnt_a") => `tenant/${t}/board/${ulid()}.pdf`;

describe("PR-LDC-60: storage compartments", () => {
  it("a compartment object goes to its own bucket under its own key, and reads back with it", async () => {
    const { p, puts } = adapter();
    const board = key();
    const general = key();
    await p.put(board, enc("minutes"), {
      bucketClass: "CONFIDENTIAL",
      compartment: "BOARD_CONFIDENTIAL",
    });
    await p.put(general, enc("memo"), { bucketClass: "CONFIDENTIAL" });
    await p.putWithRetention(key(), enc("order"), new Date(Date.now() + 86_400_000), {
      bucketClass: "REGULATED",
      compartment: "SEALED",
    });
    expect(puts.map((x) => [x.Bucket, x.SSEKMSKeyId, x.ServerSideEncryption])).toEqual([
      ["b-conf-board", "k-conf-board", "aws:kms"],
      ["b-conf", "k-conf", "aws:kms"],
      ["b-reg-sealed", "k-reg-sealed", "aws:kms"],
    ]);
    expect((await p.get(board)).meta).toMatchObject({
      bucketClass: "CONFIDENTIAL",
      compartment: "BOARD_CONFIDENTIAL",
    });
    expect((await p.get(general)).meta.compartment).toBeUndefined();
    const listed: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await p.list("tenant/tnt_a/board", cursor);
      listed.push(...page.keys);
      cursor = page.cursor;
    } while (cursor);
    expect(listed).toEqual(expect.arrayContaining([board, general]));
  });

  it("an object never moves between compartments or out of one", async () => {
    const { p } = adapter();
    const k = key();
    await p.put(k, enc("a"), { bucketClass: "CONFIDENTIAL", compartment: "BOARD_CONFIDENTIAL" });
    for (const meta of [
      { bucketClass: "CONFIDENTIAL" as const },
      { bucketClass: "CONFIDENTIAL" as const, compartment: "SEALED" as const },
    ])
      await expect(p.put(k, enc("b"), meta)).rejects.toMatchObject({ code: "IPB-PORT-003" });
    await expect(
      p.presign(k, "put", 60, {
        bucketClass: "CONFIDENTIAL",
        contentType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003" });
  });

  it("a compartment outside CONFIDENTIAL and REGULATED, or without a bucket, is refused", async () => {
    const { p, puts } = adapter();
    await expect(
      p.put(key(), enc("x"), { bucketClass: "GENERAL", compartment: "SEALED" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003" });
    await expect(
      p.put(key(), enc("x"), { bucketClass: "REGULATED", compartment: "BOARD_CONFIDENTIAL" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001" });
    expect(puts).toEqual([]);
  });

  it("refuses to start with a shared bucket, a shared key or a compartment bucket without a key", () => {
    const refused = (over: Partial<S3StorageOptions>) =>
      expect(() => adapter(over)).toThrow(expect.objectContaining({ code: "IPB-PORT-001" }));
    refused({ compartmentBuckets: { BOARD_CONFIDENTIAL: { CONFIDENTIAL: "b-conf" } } });
    refused({
      compartmentBuckets: {
        BOARD_CONFIDENTIAL: { CONFIDENTIAL: "b-x" },
        SEALED: { CONFIDENTIAL: "b-x" },
      },
    });
    refused({ compartmentKmsKeyIds: { BOARD_CONFIDENTIAL: { CONFIDENTIAL: "k-conf" } } });
    refused({
      compartmentKmsKeyIds: {
        BOARD_CONFIDENTIAL: { CONFIDENTIAL: "k-same" },
        SEALED: { CONFIDENTIAL: "k-same", REGULATED: "k-reg-sealed" },
      },
    });
    refused({ compartmentKmsKeyIds: {} });
    refused({
      compartmentBuckets: { SEALED: { GENERAL: "b-gen-sealed" } as never },
      compartmentKmsKeyIds: { SEALED: { GENERAL: "k-gen-sealed" } as never },
    });
  });

  it("a tenant with its own CMK needs a separate key per compartment; a shared one is refused", async () => {
    // A single-key tenant function (written before compartments) answers with its general key.
    const legacy = adapter({ tenantKmsKeyId: (t) => (t === "tnt_cmk" ? "t-general" : undefined) });
    await expect(
      legacy.p.put(key("tnt_cmk"), enc("x"), {
        bucketClass: "CONFIDENTIAL",
        compartment: "BOARD_CONFIDENTIAL",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001" });
    // A function that knows compartments but has none for this one.
    const partial = adapter({
      tenantKmsKeyId: (t, w) => (t !== "tnt_cmk" ? undefined : w?.compartment ? undefined : "t-g"),
    });
    await expect(
      partial.p.put(key("tnt_cmk"), enc("x"), {
        bucketClass: "CONFIDENTIAL",
        compartment: "SEALED",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001" });
    // Two compartments on one tenant key.
    const shared = adapter({
      tenantKmsKeyId: (t, w) =>
        t !== "tnt_cmk" ? undefined : w?.compartment ? "t-compartments" : "t-general",
    });
    await expect(
      shared.p.put(key("tnt_cmk"), enc("x"), {
        bucketClass: "CONFIDENTIAL",
        compartment: "SEALED",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001" });
    // One key per compartment: used; other tenants get the platform compartment key.
    const good = adapter({
      tenantKmsKeyId: (t, w) =>
        t !== "tnt_cmk" ? undefined : w?.compartment ? `t-${w.compartment}` : "t-general",
    });
    await good.p.put(key("tnt_cmk"), enc("x"), {
      bucketClass: "CONFIDENTIAL",
      compartment: "BOARD_CONFIDENTIAL",
    });
    await good.p.put(key("tnt_cmk"), enc("x"), { bucketClass: "CONFIDENTIAL" });
    await good.p.put(key("tnt_a"), enc("x"), {
      bucketClass: "CONFIDENTIAL",
      compartment: "BOARD_CONFIDENTIAL",
    });
    expect(good.puts.map((x) => x.SSEKMSKeyId)).toEqual([
      "t-BOARD_CONFIDENTIAL",
      "t-general",
      "k-conf-board",
    ]);
  });

  it("an upload URL into a compartment names its bucket and signs its key header", async () => {
    const { p } = adapter({ endpoint: "http://127.0.0.1:9", forcePathStyle: true });
    const url = new URL(
      await p.presign(key(), "put", 60, {
        bucketClass: "CONFIDENTIAL",
        compartment: "BOARD_CONFIDENTIAL",
        contentType: "application/pdf",
      }),
    );
    expect(url.pathname.startsWith("/b-conf-board/")).toBe(true);
    // The key is a signed header: the uploader must send exactly the compartment's key.
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
      expect.arrayContaining(["content-type", "x-amz-server-side-encryption-aws-kms-key-id"]),
    );
  });
});
