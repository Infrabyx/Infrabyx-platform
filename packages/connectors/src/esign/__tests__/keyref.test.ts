// PR-UDF-074 (R1-D-260): the ESP's signed file under the tenant's named STORAGE key, failing
// closed. Hermetic: the Leegality and Digio stubs, over a `MemoryStorage` that knows two of the
// tenant's references (and, for the prefix-map answer, maps `tenant/<tenant>/esign/` to one).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import type { DocumentRef, EsignPort, ObjectMeta, StoragePort } from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import {
  MemoryEsignEnvelopeStore,
  MemoryStorage,
  startDigioStub,
  startLeegalityStub,
  stubCredential,
  type DigioStub,
  type LeegalityStub,
} from "@infrabyx/testing";
import { DigioEsign } from "../digio.js";
import { LeegalityEsign } from "../leegality.js";

let lg: LeegalityStub;
let dg: DigioStub;
const urlToken = stubCredential();
beforeAll(async () => {
  lg = await startLeegalityStub();
  dg = await startDigioStub();
});
afterAll(async () => {
  await lg?.close();
  await dg?.close();
});

const TENANT = "tnt_k";
const LENDER = "lender:lnd_k";
const OTHER = "lender:lnd_other";
const named = (prefixes?: Record<string, string>) =>
  new MemoryStorage(undefined, {
    keyRefs: (t) => (t === TENANT ? [LENDER, OTHER] : []),
    ...(prefixes ? { keyRefPrefixes: (t: string) => (t === TENANT ? prefixes : undefined) } : {}),
  });

/** Records every write, and refuses a named-key write as a disabled or revoked key does. */
class RevokedKeyStorage extends MemoryStorage {
  readonly puts: { key: string; meta: ObjectMeta }[] = [];
  override async put(key: string, body: Uint8Array, meta: ObjectMeta): Promise<void> {
    this.puts.push({ key, meta });
    if (meta.keyRef !== undefined && key.includes("/esign/"))
      throw new IpbError("IPB-KMS-001", {
        detail: "the tenant's key cannot be used",
        meta: { reason: "storage_key_unavailable" },
      });
    return super.put(key, body, meta);
  }
}

let seq = 0;
async function pdf(storage: StoragePort): Promise<DocumentRef> {
  const body = Buffer.from(`%PDF-1.7\n% agreement ${++seq}\n%%EOF\n`);
  const storageKey = `tenant/${TENANT}/documents/01JK00000000000000000000${String(seq).padStart(2, "0")}.pdf`;
  await storage.put(storageKey, body, { bucketClass: "REGULATED", contentType: "application/pdf" });
  return { documentId: `doc_k${seq}`, sha256: sha256Hex(body), storageKey };
}

type Make = (storage: StoragePort) => { p: EsignPort; store: MemoryEsignEnvelopeStore };
const adapters: [string, Make][] = [
  [
    "leegality",
    (storage) => {
      const store = new MemoryEsignEnvelopeStore();
      const p = new LeegalityEsign({
        store,
        storage,
        authToken: () => lg.authToken,
        privateSalt: () => lg.privateSalt,
        profiles: { AADHAAR_OTP_ESIGN: "PRF-AADHAAR" },
        baseUrl: lg.url,
        allowLoopbackHttp: true,
      });
      return { p, store };
    },
  ],
  [
    "digio",
    (storage) => {
      const store = new MemoryEsignEnvelopeStore();
      const p = new DigioEsign({
        store,
        storage,
        clientId: () => dg.clientId,
        clientSecret: () => dg.clientSecret,
        webhookToken: () => urlToken,
        baseUrl: dg.url,
        allowLoopbackHttp: true,
      });
      return { p, store };
    },
  ],
];

const esignKeys = async (s: StoragePort) => (await s.list(`tenant/${TENANT}/esign/`)).keys;

for (const [name, make] of adapters)
  describe(`@IPB-01-15 PR-UDF-074 ${name}: the signed file under the tenant's named key`, () => {
    const stub = () => (name === "leegality" ? lg : dg);
    async function completed(storage: StoragePort) {
      const { p, store } = make(storage);
      const { envelopeId } = await p.createEnvelope(
        await pdf(storage),
        [
          {
            ref: "usr_k1",
            name: "Signer K",
            email: "signer.k@example.test",
            method: "AADHAAR_OTP_ESIGN",
          },
        ],
        "parallel",
        [],
      );
      stub().sign((await store.get(envelopeId))!.vendorRef, 0);
      return { p, envelopeId };
    }

    it("writes the signed PDF to REGULATED under the named key", async () => {
      const storage = named();
      const { p, envelopeId } = await completed(storage);
      const out = await p.downloadSigned(envelopeId, { keyRef: LENDER });
      const o = await storage.get(out.storageKey);
      expect(o.meta).toMatchObject({ bucketClass: "REGULATED", keyRef: LENDER });
      expect(sha256Hex(o.body)).toBe(out.sha256);
      // Without the option, as before: the class key.
      const again = await p.downloadSigned(envelopeId);
      expect((await storage.get(again.storageKey)).meta).not.toHaveProperty("keyRef");
    });

    it("an unknown reference fails the download and writes nothing (no class-key fallback)", async () => {
      const storage = named();
      const { p, envelopeId } = await completed(storage);
      const before = await esignKeys(storage);
      await expect(
        p.downloadSigned(envelopeId, { keyRef: "lender:lnd_none" }),
      ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "key_ref_unknown" } });
      expect(await esignKeys(storage)).toEqual(before);
    });

    it("a malformed reference is refused before the ESP is called", async () => {
      const storage = named();
      const { p, envelopeId } = await completed(storage);
      const requests = stub().requests.length;
      for (const keyRef of ["arn:aws:kms:ap-south-1:111122223333:key/abc", "Lender", ""])
        await expect(p.downloadSigned(envelopeId, { keyRef })).rejects.toMatchObject({
          code: "IPB-PORT-003",
          meta: { reason: "key_ref_invalid" },
        });
      expect(stub().requests.length).toBe(requests);
      expect(await esignKeys(storage)).toEqual([]);
    });

    it("a disabled or revoked key (IPB-KMS-001) fails the download; it is not retried without the key", async () => {
      const storage = new RevokedKeyStorage(undefined, {
        keyRefs: (t) => (t === TENANT ? [LENDER] : []),
      });
      const { p, envelopeId } = await completed(storage);
      await expect(p.downloadSigned(envelopeId, { keyRef: LENDER })).rejects.toMatchObject({
        code: "IPB-KMS-001",
        meta: { reason: "storage_key_unavailable" },
      });
      const esignPuts = storage.puts.filter((w) => w.key.includes("/esign/"));
      expect(esignPuts.map((w) => w.meta.keyRef)).toEqual([LENDER]);
      expect(await esignKeys(storage)).toEqual([]);
    });

    it("the prefix-map answer: tenant/<tenant>/esign/ gives every signed file the lender's key; another name is refused", async () => {
      const storage = named({ [`tenant/${TENANT}/esign/`]: LENDER });
      const { p, envelopeId } = await completed(storage);
      const plain = await p.downloadSigned(envelopeId);
      expect((await storage.get(plain.storageKey)).meta.keyRef).toBe(LENDER);
      const same = await p.downloadSigned(envelopeId, { keyRef: LENDER });
      expect((await storage.get(same.storageKey)).meta.keyRef).toBe(LENDER);
      await expect(p.downloadSigned(envelopeId, { keyRef: OTHER })).rejects.toMatchObject({
        code: "IPB-PORT-003",
        meta: { reason: "key_ref_prefix_conflict" },
      });
      expect(await esignKeys(storage)).toHaveLength(2);
    });
  });
