// ESTAMP legs for `nesl-dde` (owner answer #100, R1-D-62). Hermetic: the NeSL DDE stub, whose
// shapes are stub-shaped until the owner's NeSL account exists; the adapter stays `unproven` and
// off. The DDE contract cases, the stamp-purchase methods refused as `unsupported` (no purchase
// adapter is approved), then what only the adapter keeps: off until its flag, the document checked
// against its SHA-256 before it leaves, and a callback that is only a trigger.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocFileRef } from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import {
  defineContractSuite,
  estampDdeContractCases,
  MemoryStorage,
  startNeslDdeStub,
  type DdeFixtures,
  type NeslDdeStub,
} from "@infrabyx/testing";
import {
  MemoryDdeRecordStore,
  NeslDde,
  mapNeslDdeState,
  mapNeslNotStampable,
  neslNonStampable,
  neslSigners,
} from "../nesl-dde.js";

const PREFIX = "tenant/tnt_dde/los";
let stub: NeslDdeStub;
let enabled = true;
const token = "u".repeat(48);
const storage = new MemoryStorage();
const records = new MemoryDdeRecordStore();
const put = async (text: string): Promise<DocFileRef> => {
  const body = Buffer.from(`%PDF-1.7\n${text}\n%%EOF\n`);
  const key = `${PREFIX}/${ulid()}.pdf`;
  await storage.put(key, body, { bucketClass: "REGULATED", contentType: "application/pdf" });
  return { storageKey: key, sha256: sha256Hex(body) };
};
let docs: { a: DocFileRef; b: DocFileRef };
beforeAll(async () => {
  stub = await startNeslDdeStub();
  docs = { a: await put("loan agreement"), b: await put("another agreement") };
});
afterAll(async () => stub?.close());

const make = () =>
  new NeslDde({
    enabled: () => enabled,
    storage,
    records,
    clientId: () => stub.clientId,
    clientSecret: () => stub.clientSecret,
    webhookToken: () => token,
    baseUrl: stub.url,
    allowLoopbackHttp: true,
  });

const fixtures: DdeFixtures = {
  get document() {
    return docs.a;
  },
  get otherDocument() {
    return docs.b;
  },
  certificateId: async () => "IN-MH00000000000001",
  outputPrefix: PREFIX,
  execute: (_p, ddeId, partyRef) => stub.execute(ddeId, partyRef),
};

const reg = (document: DocFileRef) => ({
  document,
  certificateId: "IN-MH00000000000002",
  executants: [{ partyRef: "p1", name: "Party p1" }],
  outputPrefix: PREFIX,
});

const nsReg = (
  document: DocFileRef,
  notStampable: { reason: "NOT_AN_INSTRUMENT" | "ACKNOWLEDGEMENT" | "OTHER"; note?: string },
) => ({
  document,
  notStampable,
  executants: [{ partyRef: "p1", name: "Party p1" }],
  outputPrefix: PREFIX,
});

describe("@IPB-01-15 ESTAMP DDE hermetic leg (NeSL stub)", () => {
  defineContractSuite("ESTAMP", make, estampDdeContractCases(fixtures), { leg: "hermetic" });
});

describe("R1-D-62 the NeSL DDE adapter", () => {
  it("is off until int.estamp.nesl_dde.enabled: nothing reaches NeSL and health is down", async () => {
    const before = stub.requests.length;
    enabled = false;
    try {
      await expect(make().ddeRegister(reg(docs.a), "dde-off-00001")).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { reason: "adapter_disabled" },
      });
      expect((await make().health()).status).toBe("down");
    } finally {
      enabled = true;
    }
    expect(stub.requests.length).toBe(before);
  });

  it("buys no stamp duty: covers nothing, and the purchase methods are unsupported", async () => {
    const p = make();
    expect(await p.covers()).toBe(false);
    for (const call of [() => p.purchase(), () => p.quoteDuty(), () => p.verify()])
      await expect(call()).rejects.toMatchObject({ meta: { reason: "unsupported" } });
    expect(p.descriptor.capabilities?.purchase).toBe("unsupported");
  });

  it("refuses a stored document whose bytes no longer match its SHA-256, before NeSL", async () => {
    const before = stub.requests.filter((r) => r.method === "POST").length;
    await expect(
      make().ddeRegister(reg({ ...docs.a, sha256: "0".repeat(64) }), "dde-hash-00001"),
    ).rejects.toMatchObject({ meta: { reason: "hash_mismatch" } });
    expect(stub.requests.filter((r) => r.method === "POST").length).toBe(before);
  });

  it("takes a callback only with our secret, and returns the record read back from NeSL", async () => {
    const p = make();
    const d = await p.ddeRegister(reg(docs.a), "dde-hook-00001");
    const body = new TextEncoder().encode(JSON.stringify({ dde_id: d.ddeId, status: "EXECUTED" }));
    await expect(p.handleDdeWebhook(body, {}, { query: "ipb_token=wrong" })).rejects.toMatchObject({
      code: "IPB-API-018",
    });
    const back = await p.handleDdeWebhook(body, {}, { query: `ipb_token=${token}` });
    expect(back.state).toBe("pending_execution");
    await expect(
      p.handleDdeWebhook(
        new TextEncoder().encode(JSON.stringify({ dde_id: "DDE999999999999" })),
        {},
        { query: `ipb_token=${token}` },
      ),
    ).rejects.toMatchObject({ code: "IPB-API-018" });
  });

  it("maps the stub-shaped statuses conservatively", () => {
    expect(mapNeslDdeState("PARTIALLY_EXECUTED")).toBe("pending_execution");
    expect(mapNeslDdeState("executed")).toBe("executed");
    expect(() => mapNeslDdeState("SOMETHING_NEW")).toThrow();
  });
});

describe("R1-D-84 the NeSL DDE signer trail and not-stampable registration (PR-FBX-35)", () => {
  const posts = () => stub.requests.filter((r) => r.method === "POST");

  it("sends NeSL a reason code in place of a stamp reference, and the note for OTHER only", async () => {
    const before = posts().length;
    const p = make();
    const a = await p.ddeRegister(nsReg(docs.a, { reason: "ACKNOWLEDGEMENT" }), "dde-ns-000001");
    expect(a.notStampableReason).toBe("ACKNOWLEDGEMENT");
    const b = await p.ddeRegister(
      nsReg(docs.a, { reason: "OTHER", note: "a borrower's declaration" }),
      "dde-ns-000002",
    );
    expect(b.notStampableReason).toBe("OTHER");
    const sent = posts()
      .slice(before)
      .map((r) => r.json<Record<string, unknown>>());
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toHaveProperty("stamp_ref");
    expect(sent[0]!.non_stampable).toEqual({ reason_code: "ACKNOWLEDGEMENT" });
    expect(sent[1]!.non_stampable).toEqual({
      reason_code: "OTHERS",
      remarks: "a borrower's declaration",
    });
    // A note given with another reason stays home.
    expect(neslNonStampable({ reason: "NOT_AN_INSTRUMENT", note: "internal" })).toEqual({
      reason_code: "NOT_AN_INSTRUMENT",
    });
  });

  it("refuses a not-stampable registration with an e-stamp or a duty before anything reaches NeSL", async () => {
    const before = stub.requests.length;
    const ns = { reason: "ACKNOWLEDGEMENT" as const };
    await expect(
      make().ddeRegister({ ...reg(docs.a), notStampable: ns }, "dde-ns-000003"),
    ).rejects.toThrow(/no e-stamp certificate/);
    await expect(
      make().ddeRegister({ ...nsReg(docs.a, ns), dutyMinor: 10_000 } as never, "dde-ns-000004"),
    ).rejects.toThrow();
    expect(stub.requests.length).toBe(before);
  });

  it("keeps each signer's evidence without the executant's name, and fails closed on a partial trail", async () => {
    const p = make();
    const d = await p.ddeRegister(
      { ...reg(docs.a), executants: [{ partyRef: "p1", name: "Asha Rao" }] },
      "dde-trail-0001",
    );
    stub.execute(d.ddeId, "p1", { sign_mode: "DSC", ip_address: "2001:db8::7" });
    const done = await p.ddeStatus(d.ddeId);
    expect(done.signers).toEqual([
      {
        signerRef: "p1",
        signedAt: expect.stringMatching(/Z$/),
        method: "DSC",
        espTransactionId: `ESP-${d.ddeId}-1`,
        signerIp: "2001:db8::7",
      },
    ]);
    expect(JSON.stringify(done)).not.toContain("Asha");

    for (const [key, evidence, msg] of [
      ["dde-trail-0002", { sign_mode: "VIDEO" }, /signing mode/],
      ["dde-trail-0003", { signed_at: null }, /signing time/],
      ["dde-trail-0004", { esp_txn_id: null, ip_address: null }, /transaction id or an IP/],
      ["dde-trail-0005", { ip_address: "not-an-ip" }, /IP address/],
    ] as const) {
      const r = await p.ddeRegister(reg(docs.a), key);
      stub.execute(r.ddeId, "p1", evidence);
      await expect(p.ddeStatus(r.ddeId)).rejects.toThrow(msg);
    }
  });

  it("maps the stub-shaped stamping conservatively", () => {
    expect(mapNeslNotStampable({})).toBeNull();
    expect(mapNeslNotStampable({ stamp_ref: "IN-MH1" })).toBeNull();
    expect(mapNeslNotStampable({ non_stampable: { reason_code: "others" } })).toBe("OTHER");
    expect(() => mapNeslNotStampable({ non_stampable: { reason_code: "EXEMPT" } })).toThrow();
    expect(() =>
      mapNeslNotStampable({ stamp_ref: "IN-MH1", non_stampable: { reason_code: "OTHERS" } }),
    ).toThrow();
    expect(neslSigners({ executants: [{ ref: "p1", status: "PENDING" }] })).toEqual([]);
  });
});
