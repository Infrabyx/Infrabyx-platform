// PR-UDF-060 (R1-D-230): no-cache presigned downloads, unit level. The S3 client answers HEAD from an
// in-memory set of objects, so only the signing is exercised; the moto and MinIO-server legs
// (storage.contract.test.ts, built-in case) GET the URL and read the headers the store returns.
import { describe, expect, it } from "vitest";
import type { BucketClass, PresignOptions } from "@infrabyx/contracts/ports";
import { ulid } from "@infrabyx/crypto";
import { MinioStorage, S3Storage } from "../s3.js";

const CC = "response-cache-control";
const EXP = "response-expires";
const BUCKETS = {
  AUDIT: "b-audit",
  REGULATED: "b-reg",
  CONFIDENTIAL: "b-conf",
  GENERAL: "b-general",
  PUBLIC_ASSETS: "b-public",
} as const;
const CREDS = { accessKeyId: "test", secretAccessKey: "test" };

/** `objects` holds `bucket/key` of what exists; HEAD answers from it. */
function stub<T extends S3Storage>(p: T, objects: Set<string>): T {
  (p as unknown as { client: { send: (c: unknown) => Promise<unknown> } }).client.send = async (
    cmd: unknown,
  ) => {
    const name = (cmd as { constructor: { name: string } }).constructor.name;
    const input = (cmd as { input: Record<string, unknown> }).input;
    if (name !== "HeadObjectCommand") throw new Error(`unexpected ${name}`);
    if (!objects.has(`${String(input.Bucket)}/${String(input.Key)}`))
      throw Object.assign(new Error("NotFound"), { name: "NotFound" });
    return { Metadata: {} };
  };
  return p;
}

function s3(objects: Set<string>) {
  return stub(
    new S3Storage({
      region: "ap-south-1",
      buckets: BUCKETS,
      kmsKeyIds: Object.fromEntries(Object.keys(BUCKETS).map((c) => [c, `k-${c}`])),
      compartmentBuckets: {
        BOARD_CONFIDENTIAL: { CONFIDENTIAL: "b-conf-board" },
        SEALED: { REGULATED: "b-reg-sealed" },
      },
      compartmentKmsKeyIds: {
        BOARD_CONFIDENTIAL: { CONFIDENTIAL: "k-conf-board" },
        SEALED: { REGULATED: "k-reg-sealed" },
      },
      credentials: CREDS,
    }),
    objects,
  );
}

const key = () => `tenant/tnt_a/docs/${ulid()}.pdf`;
const params = async (p: S3Storage, k: string, opts?: PresignOptions) =>
  new URL(await p.presign(k, "get", 60, opts)).searchParams;

describe("PR-UDF-060: no-cache presigned downloads", () => {
  it("a download from REGULATED or CONFIDENTIAL, compartments included, signs the overrides", async () => {
    const objects = new Set<string>();
    const p = s3(objects);
    for (const bucket of ["b-reg", "b-conf", "b-conf-board", "b-reg-sealed"]) {
      const k = key();
      objects.add(`${bucket}/${k}`);
      const url = await p.presign(k, "get", 60);
      expect(new URL(url).host.startsWith(`${bucket}.`)).toBe(true);
      const q = new URL(url).searchParams;
      expect(q.get(CC)).toBe("no-store, private");
      // An HTTP-date in the past, never a literal 0 (S3 refuses a value that is not a date).
      expect(q.get(EXP)).toBe("Thu, 01 Jan 1970 00:00:00 GMT");
      expect(q.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
      // SigV4 signs the whole query string: the URL without the overrides is another signature.
      expect(url).toMatch(/response-cache-control=no-store%2C%20private/);
    }
  });

  it("other classes and upload URLs are unchanged", async () => {
    const objects = new Set<string>();
    const p = s3(objects);
    for (const cls of ["GENERAL", "PUBLIC_ASSETS", "AUDIT"] as const) {
      const k = key();
      objects.add(`${BUCKETS[cls]}/${k}`);
      const q = await params(p, k);
      expect([q.get(CC), q.get(EXP)]).toEqual([null, null]);
    }
    const put = new URL(
      await p.presign(key(), "put", 60, {
        bucketClass: "REGULATED",
        contentType: "application/pdf",
      }),
    ).searchParams;
    expect([put.get(CC), put.get(EXP)]).toEqual([null, null]);
  });

  it("the class comes from the bucket the URL reads; nothing the caller passes drops the overrides", async () => {
    const p = s3(new Set());
    // Named class, no lookup: the URL reads the REGULATED bucket, so it carries the overrides.
    const named = await params(p, key(), { bucketClass: "REGULATED", contentType: "text/html" });
    expect(named.get(CC)).toBe("no-store, private");
    const sealed = await params(p, key(), { bucketClass: "REGULATED", compartment: "SEALED" });
    expect(sealed.get(CC)).toBe("no-store, private");
    // Options that are not part of the port are ignored, not passed to the signer.
    const forged = {
      bucketClass: "CONFIDENTIAL" as BucketClass,
      ResponseCacheControl: "public, max-age=31536000",
      responseCacheControl: "public",
      ResponseExpires: new Date(Date.now() + 86_400_000),
    } as PresignOptions;
    const q = await params(p, key(), forged);
    expect(q.getAll(CC)).toEqual(["no-store, private"]);
    expect(q.getAll(EXP)).toEqual(["Thu, 01 Jan 1970 00:00:00 GMT"]);
  });

  it("minio signs the same overrides", async () => {
    const objects = new Set<string>();
    const m = stub(
      new MinioStorage({
        region: "us-east-1",
        buckets: { REGULATED: "b-reg", GENERAL: "b-general" },
        endpoint: "http://127.0.0.1:9",
        credentials: CREDS,
        allowLoopbackHttp: true,
      }),
      objects,
    );
    const reg = key();
    const gen = key();
    objects.add(`b-reg/${reg}`);
    objects.add(`b-general/${gen}`);
    const q = await params(m, reg);
    expect([q.get(CC), q.get(EXP)]).toEqual(["no-store, private", "Thu, 01 Jan 1970 00:00:00 GMT"]);
    const g = await params(m, gen);
    expect([g.get(CC), g.get(EXP)]).toEqual([null, null]);
  });
});
