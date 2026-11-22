// PR-UDF-080 (R1-D-269): a STORAGE integrity failure has its own code, unit level. A local HTTP
// server plays S3 so the SDK's own response checksum validation runs; the moto and MinIO-server legs
// (storage.contract.test.ts, `storageIntegrityContractCases`) tamper with real objects.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toProblem } from "@infrabyx/contracts/errors";
import { sha256, sha256Hex, ulid } from "@infrabyx/crypto";
import { tripsBreaker } from "../../core/router.js";
import { MinioStorage, S3Storage } from "../s3.js";

const CREDS = { accessKeyId: "test", secretAccessKey: "test" };
const BODY = Buffer.from("sanction letter");
const sha = (b: Buffer, enc: "hex" | "base64") =>
  enc === "hex" ? sha256Hex(b) : Buffer.from(sha256(b)).toString("base64");

/** How the fake S3 answers a GET: the metadata hash and the checksum header it sends. */
let answer: { metaSha?: string; checksum?: string } = {};
let server: Server;
let endpoint = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const headers: Record<string, string> = {
      "content-type": "application/pdf",
      "content-length": String(BODY.length),
      "last-modified": new Date().toUTCString(),
      etag: '"e"',
    };
    if (answer.metaSha) headers["x-amz-meta-sha256"] = answer.metaSha;
    if (req.method === "GET" && answer.checksum) headers["x-amz-checksum-sha256"] = answer.checksum;
    res.writeHead(200, headers);
    res.end(req.method === "GET" ? BODY : undefined);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const s3 = () =>
  new S3Storage({
    region: "ap-south-1",
    buckets: { REGULATED: "b-reg" },
    kmsKeyIds: { REGULATED: "k-reg" },
    endpoint,
    credentials: CREDS,
    forcePathStyle: true,
  });
const minio = () =>
  new MinioStorage({
    region: "us-east-1",
    buckets: { REGULATED: "b-reg" },
    endpoint,
    credentials: CREDS,
    allowLoopbackHttp: true,
  });
const key = () => `tenant/tnt_a/vault/${ulid()}.pdf`;

/** The refusal, checked to carry the fixed detail and label only. */
async function refusal(p: Promise<unknown>, k: string) {
  const e = (await p.then(
    () => {
      throw new Error("the read returned bytes");
    },
    (x: unknown) => x,
  )) as { code: string; meta?: unknown; cause?: unknown; message: string; detail?: string };
  expect(e).toMatchObject({ code: "IPB-STOR-005", meta: { reason: "hash_mismatch" } });
  expect(e.meta).toEqual({ reason: "hash_mismatch" });
  expect(e.cause).toBeUndefined();
  expect(`${e.message} ${e.detail ?? ""}`).not.toMatch(
    new RegExp(`${k}|b-reg|${sha(BODY, "hex")}|Checksum mismatch`),
  );
  expect(toProblem(e)).toMatchObject({
    status: 500,
    code: "IPB-STOR-005",
    reason: "hash_mismatch",
  });
  expect(tripsBreaker(e)).toBe(false);
}

describe("PR-UDF-080: STORAGE integrity is IPB-STOR-005, not IPB-PORT-002", () => {
  for (const [name, make] of [
    ["s3", s3],
    ["minio", minio],
  ] as const) {
    it(`${name}: bytes that do not match the SHA-256 recorded at write`, async () => {
      answer = { metaSha: sha(Buffer.from("the original"), "hex") };
      const k = key();
      await refusal(make().get(k), k);
    });

    it(`${name}: a checksum S3 returns that disagrees with the bytes (the SDK's validation)`, async () => {
      answer = { checksum: sha(Buffer.from("other bytes"), "base64") };
      const k = key();
      await refusal(make().get(k), k);
    });

    it(`${name}: matching bytes read as before`, async () => {
      answer = { metaSha: sha(BODY, "hex"), checksum: sha(BODY, "base64") };
      const o = await make().get(key());
      expect(Buffer.from(o.body).equals(BODY)).toBe(true);
      expect(o.meta.sha256).toBe(sha(BODY, "hex"));
    });
  }

  it("an unreachable store is still IPB-PORT-002, retried as an outage", async () => {
    const down = new S3Storage({
      region: "ap-south-1",
      buckets: { REGULATED: "b-reg" },
      kmsKeyIds: { REGULATED: "k-reg" },
      endpoint: "http://127.0.0.1:9",
      credentials: CREDS,
      forcePathStyle: true,
    });
    const e = await down.get(key()).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: "IPB-PORT-002" });
    expect(toProblem(e).status).toBe(503);
    expect(tripsBreaker(e)).toBe(true);
  });
});
