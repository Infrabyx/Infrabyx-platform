// ESTAMP legs for the recording adapters (Udofin PR-UDF-054, R1-D-245): `shcil-estamp` and
// `digio-estamp` against their stubs (stub-shaped until the owner's accounts exist, so both stay
// `unproven` and off) and `manual-paper`, which has nothing to stub. The stamp-record contract
// cases, then what only these adapters promise: off until their flags, never a purchase, the
// stamped document checked before anything leaves, only the certificate's identifiers sent, the
// issuer's record compared, and the manual adapter making no network call at all.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DocFileRef, EstampPort } from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import {
  defineContractSuite,
  estampRecordContractCases,
  MemoryStorage,
  startDigioEstampStub,
  startShcilEstampStub,
  type DigioEstampStub,
  type ShcilEstampStub,
  type StampRecordFixtures,
} from "@infrabyx/testing";
import { DigioEstamp, mapDigioEstampStatus } from "../digio-estamp.js";
import { ManualStampPaper } from "../manual-paper.js";
import { MemoryStampRecordStore, indiaDate, rupeesToPaise } from "../record.js";
import { ShcilEstamp, mapShcilStatus, shcilVerifyRequest } from "../shcil.js";

const PREFIX = "tenant/tnt_rec/los";
const storage = new MemoryStorage();
const on = { manual: true, shcil: true, digio: true };
let shcil: ShcilEstampStub;
let dg: DigioEstampStub;
let doc: DocFileRef;
const put = async (text: string): Promise<DocFileRef> => {
  const body = Buffer.from(`%PDF-1.7\n${text}\n%%EOF\n`);
  const key = `${PREFIX}/${ulid()}.pdf`;
  await storage.put(key, body, { bucketClass: "REGULATED", contentType: "application/pdf" });
  return { storageKey: key, sha256: sha256Hex(body) };
};
beforeAll(async () => {
  shcil = await startShcilEstampStub();
  dg = await startDigioEstampStub();
  doc = await put("stamped loan agreement");
});
afterAll(async () => {
  await shcil?.close();
  await dg?.close();
});

const stores = {
  manual: new MemoryStampRecordStore(),
  shcil: new MemoryStampRecordStore(),
  digio: new MemoryStampRecordStore(),
};
const manual = () =>
  new ManualStampPaper({ enabled: () => on.manual, storage, records: stores.manual });
const shcilAdapter = () =>
  new ShcilEstamp({
    enabled: () => on.shcil,
    storage,
    records: stores.shcil,
    clientId: () => shcil.clientId,
    clientSecret: () => shcil.clientSecret,
    baseUrl: shcil.url,
    allowLoopbackHttp: true,
  });
const digio = () =>
  new DigioEstamp({
    enabled: () => on.digio,
    storage,
    records: stores.digio,
    clientId: () => dg.clientId,
    clientSecret: () => dg.clientSecret,
    baseUrl: dg.url,
    allowLoopbackHttp: true,
  });

const ISSUED = "2026-11-02T11:00:00+05:30";
let n = 0;
const number = (tag: string) => `IN-${tag}${String(++n).padStart(6, "0")}${ulid().slice(-6)}`;
const fixtures = (
  channel: StampRecordFixtures["channel"],
  bought: StampRecordFixtures["bought"],
): StampRecordFixtures => ({
  channel,
  state: "MH",
  get stampedDocument() {
    return doc;
  },
  bought,
});

describe("@IPB-01-15 ESTAMP stamp records, manual paper (no external system)", () => {
  defineContractSuite(
    "ESTAMP",
    manual,
    estampRecordContractCases(
      fixtures("PHYSICAL_PAPER", () => ({
        certificateNumber: number("PAPER"),
        issuedAt: ISSUED,
        dutyMinor: 50_000,
      })),
    ),
    { leg: "hermetic" },
  );
});

describe("@IPB-01-15 ESTAMP stamp records hermetic leg (SHCIL stub)", () => {
  defineContractSuite(
    "ESTAMP",
    shcilAdapter,
    estampRecordContractCases(
      fixtures("E_STAMP", () => {
        const certificateNumber = number("MH");
        shcil.issue({
          certificateNo: certificateNumber,
          state: "MH",
          issueDate: "2026-11-02",
          dutyPaise: 50_000,
        });
        return { certificateNumber, issuedAt: ISSUED, dutyMinor: 50_000 };
      }),
    ),
    { leg: "hermetic" },
  );
});

describe("@IPB-01-15 ESTAMP stamp records hermetic leg (Digio e-stamp stub)", () => {
  defineContractSuite(
    "ESTAMP",
    digio,
    estampRecordContractCases(
      fixtures("E_STAMP", () => {
        const certificateNumber = number("DG");
        const id = dg.issue({
          certificateNo: certificateNumber,
          state: "MH",
          issueDate: "2026-11-02",
          dutyPaise: 50_000,
        });
        return { certificateNumber, issuedAt: ISSUED, dutyMinor: 50_000, vendorCertificateId: id };
      }),
    ),
    { leg: "hermetic" },
  );
});

const record = (over: Record<string, unknown> = {}) => ({
  channel: "E_STAMP",
  state: "MH",
  instrument: "5(h)",
  certificateNumber: number("X"),
  dutyMinor: 50_000,
  issuedAt: ISSUED,
  purchaser: { partyRef: "p1", name: "Asha Rao" },
  stampedDocument: doc,
  recordedBy: { principalId: "usr_ops_1", principalType: "user" },
  ...over,
});
const paper = (over: Record<string, unknown> = {}) =>
  record({
    channel: "PHYSICAL_PAPER",
    vendorLicence: "SV-MUM-0042",
    certificateDocumentId: "doc_stamp_scan_9",
    ...over,
  });
const rec = (p: EstampPort, r: unknown, k = `rec-${ulid()}`) => p.recordCertificate!(r as never, k);
const requests = () => shcil.requests.length + dg.requests.length;

describe("R1-D-245 the recording ESTAMP adapters", () => {
  it("are off until their flags: nothing leaves and health is down", async () => {
    const before = requests();
    Object.assign(on, { manual: false, shcil: false, digio: false });
    try {
      for (const [p, r] of [
        [manual(), paper()],
        [shcilAdapter(), record()],
        [digio(), record({ vendorCertificateId: "EST000000000001" })],
      ] as const) {
        await expect(rec(p, r)).rejects.toMatchObject({ meta: { reason: "adapter_disabled" } });
        expect((await p.health()).status).toBe("down");
      }
    } finally {
      Object.assign(on, { manual: true, shcil: true, digio: true });
    }
    expect(requests()).toBe(before);
  });

  it("never buy: purchase is refused purchase_not_permitted before anything leaves", async () => {
    const before = requests();
    for (const p of [manual(), shcilAdapter(), digio()]) {
      await expect(p.purchase()).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { reason: "purchase_not_permitted" },
      });
      expect(await p.covers()).toBe(false);
      for (const call of [() => p.quoteDuty(), () => p.handleWebhook()])
        await expect(call()).rejects.toMatchObject({ meta: { reason: "unsupported" } });
      expect(p.descriptor.capabilities).toMatchObject({
        purchase: "unsupported",
        recordCertificate: "native",
      });
      expect(p.descriptor).toMatchObject({ residency: "IN", maxDataClass: "REGULATED" });
    }
    expect(requests()).toBe(before);
  });

  it("refuse a stamped document whose bytes no longer match, and a future issue time, before the issuer", async () => {
    const before = requests();
    await expect(
      rec(shcilAdapter(), record({ stampedDocument: { ...doc, sha256: "0".repeat(64) } })),
    ).rejects.toMatchObject({ meta: { reason: "hash_mismatch" } });
    await expect(
      rec(shcilAdapter(), record({ issuedAt: new Date(Date.now() + 3_600_000).toISOString() })),
    ).rejects.toMatchObject({ meta: { reason: "invalid_request" } });
    expect(requests()).toBe(before);
  });

  it("SHCIL: only the number, State and issue date leave; the issuer's record is compared", async () => {
    const certificateNumber = number("MH");
    shcil.issue({
      certificateNo: certificateNumber,
      state: "MH",
      issueDate: "2026-11-02",
      dutyPaise: 50_000,
    });
    const c = await rec(shcilAdapter(), record({ certificateNumber }));
    expect(c).toMatchObject({ verification: "ISSUER_READBACK", state: "issued" });
    expect(c.vendorCertificateId).toMatch(/^SHCIL-REF-/);
    const sent = shcil.requests.at(-1)!;
    expect(sent.json()).toEqual({
      certificate_no: certificateNumber,
      state_code: "MH",
      issue_date: "2026-11-02",
    });
    expect(sent.body.toString()).not.toContain("Asha");

    const other = number("MH");
    shcil.issue({ certificateNo: other, state: "MH", issueDate: "2026-11-02", dutyPaise: 40_000 });
    await expect(rec(shcilAdapter(), record({ certificateNumber: other }))).rejects.toMatchObject({
      meta: { reason: "certificate_mismatch" },
    });
    await expect(rec(shcilAdapter(), record())).rejects.toMatchObject({
      meta: { reason: "certificate_not_found" },
    });
    await expect(
      rec(
        shcilAdapter(),
        record({ channel: "FRANKING", vendorLicence: "FR-1", certificateDocumentId: "doc_x1" }),
      ),
    ).rejects.toMatchObject({ meta: { reason: "channel_unsupported" } });

    // A certificate SHCIL cancels reads back cancelled, and a cancelled one is not recorded.
    shcil.cancel(certificateNumber);
    expect((await shcilAdapter().verify(c.certificateId)).state).toBe("cancelled");
    const gone = number("MH");
    shcil.issue({ certificateNo: gone, state: "MH", issueDate: "2026-11-02", dutyPaise: 50_000 });
    shcil.cancel(gone);
    await expect(rec(shcilAdapter(), record({ certificateNumber: gone }))).rejects.toMatchObject({
      meta: { reason: "certificate_not_usable" },
    });
  });

  it("Digio: reads a stamp back by Digio's id only, and never orders or affixes one", async () => {
    await expect(rec(digio(), record())).rejects.toMatchObject({
      meta: { reason: "invalid_request" },
    });
    const certificateNumber = number("DG");
    const id = dg.issue({
      certificateNo: certificateNumber,
      state: "MH",
      issueDate: "2026-11-02",
      dutyPaise: 50_000,
    });
    const before = dg.requests.length;
    const c = await rec(digio(), record({ certificateNumber, vendorCertificateId: id }));
    expect(c).toMatchObject({ vendorCertificateId: id, verification: "ISSUER_READBACK" });
    expect(dg.requests.slice(before).map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET /v2/client/estamp/${id}`,
    ]);
    const wrong = dg.issue({
      certificateNo: number("DG"),
      state: "KA",
      issueDate: "2026-11-02",
      dutyPaise: 50_000,
    });
    await expect(
      rec(digio(), record({ certificateNumber: number("DG"), vendorCertificateId: wrong })),
    ).rejects.toMatchObject({ meta: { reason: "certificate_mismatch" } });
    dg.cancel(id);
    expect((await digio().verify(c.certificateId)).state).toBe("cancelled");
    expect(dg.requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("manual paper: makes no network call, keeps no name, and takes paper and franking only", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const p = manual();
      const c = await rec(p, paper());
      expect(c).toMatchObject({
        verification: "MANUAL_RECORD",
        channel: "PHYSICAL_PAPER",
        vendorLicence: "SV-MUM-0042",
        certificateDocumentId: "doc_stamp_scan_9",
      });
      expect(JSON.stringify(c)).not.toContain("Asha");
      const f = await rec(p, paper({ channel: "FRANKING", vendorLicence: "FR-MUM-7" }));
      expect(f.channel).toBe("FRANKING");
      await expect(rec(p, record())).rejects.toMatchObject({
        meta: { reason: "channel_unsupported" },
      });
      // Paper without its scan or the vendor's licence is refused.
      await expect(rec(p, paper({ certificateDocumentId: undefined }))).rejects.toMatchObject({
        meta: { reason: "invalid_request" },
      });
      expect((await p.verify(c.certificateId)).state).toBe("issued");
      await p.attach(c.certificateId, "doc_loan_1");
      expect((await p.health()).status).toBe("up");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("maps the stub-shaped vendor facts conservatively", () => {
    expect(mapShcilStatus("locked")).toBe("issued");
    expect(mapShcilStatus("CANCELLED")).toBe("cancelled");
    expect(() => mapShcilStatus("PENDING_PAYMENT")).toThrow();
    expect(mapDigioEstampStatus("attached")).toBe("issued");
    expect(() => mapDigioEstampStatus("reserved")).toThrow();
    expect(rupeesToPaise("500.00")).toBe(50_000);
    expect(rupeesToPaise("500.5")).toBe(50_050);
    expect(rupeesToPaise(500)).toBe(50_000);
    expect(rupeesToPaise("5e2")).toBeNull();
    expect(rupeesToPaise("-1")).toBeNull();
    expect(indiaDate("2026-11-02T20:00:00Z")).toBe("2026-11-03");
    expect(
      shcilVerifyRequest({
        certificateNumber: "IN-MH1",
        state: "MH",
        issuedAt: "2026-11-02T00:10:00+05:30",
      }),
    ).toEqual({ certificate_no: "IN-MH1", state_code: "MH", issue_date: "2026-11-02" });
  });
});
