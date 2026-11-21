// The PR-FBX-29 fakes against their contract cases (R1-D-52).
import { describe, expect, it } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import { MemoryStorage, pdfFixture } from "@infrabyx/fakes";
import { sha256Hex } from "@infrabyx/crypto";
import { defineContractSuite } from "../contract.js";
import {
  FakeDocgen,
  FakeEsign,
  FakeEstamp,
  FakeMandates,
  FakePayouts,
  FakePdf,
  CONTRACT_AUTH,
  docgenContractCases,
  docgenHtmlContractCases,
  docgenStorageContractCases,
  type FakeDocgenDocument,
  type FakeDocgenPdfOptions,
  esignFakeCases,
  esignFakeStorageCases,
  estampContractCases,
  estampDdeContractCases,
  ESTAMP_DDE_FAKE_FIXTURES,
  mandateContractCases,
  payoutsContractCases,
  pdfContractCases,
} from "./documents-money.js";

defineContractSuite("ESTAMP", () => new FakeEstamp(), estampContractCases());
describe("ESTAMP DDE on the fake (R1-D-62)", () => {
  defineContractSuite(
    "ESTAMP",
    () => new FakeEstamp(),
    estampDdeContractCases(ESTAMP_DDE_FAKE_FIXTURES),
  );
});
defineContractSuite("PAYOUTS", () => new FakePayouts(), payoutsContractCases());
defineContractSuite("DOCGEN", () => new FakeDocgen(), [
  ...docgenContractCases(),
  ...docgenHtmlContractCases(),
]);
defineContractSuite("PDF", () => new FakePdf(), pdfContractCases());

describe("FakeDocgen writing real files to STORAGE (PR-UDF-077, R1-D-259)", () => {
  const seen: Array<{ doc: FakeDocgenDocument; o: FakeDocgenPdfOptions }> = [];
  /** A real (small) PDF of the document's text; `@infrabyx/export`'s `toPdf` in products. */
  const pdf = (doc: FakeDocgenDocument, o: FakeDocgenPdfOptions) => {
    seen.push({ doc, o });
    const lines = doc.blocks.map((b) => (b.type === "heading" ? b.text : b.runs.join("")));
    return pdfFixture([lines.join("\n")]);
  };
  const docx = (d: FakeDocgenDocument) => new TextEncoder().encode(`DOCX ${d.title}`);
  const make = (withDocx = false) => {
    const storage = new MemoryStorage();
    const p = new FakeDocgen(undefined, {
      storage,
      renderers: withDocx ? { pdf, docx } : { pdf },
    });
    return { storage, p };
  };
  const shared = make();
  defineContractSuite("DOCGEN", () => shared.p, [
    ...docgenContractCases(),
    ...docgenHtmlContractCases(),
    ...docgenStorageContractCases(shared.storage),
  ]);
  const req = {
    templateId: "sanction_letter",
    data: { name: "Asha <b>", amount: 125000, city: "पुणे" },
    format: "pdfa" as const,
    outputPrefix: "tenant/tnt_a/docs",
  };

  it("lays out the template, sorted fields and printable text, and asks for PDF/A-2b with PDF/UA", async () => {
    const { storage, p } = make();
    seen.length = 0;
    const r = await p.render(req);
    expect(seen[0]!.o).toEqual({ pdfa: "2b", pdfua: true, lang: "en" });
    expect(seen[0]!.doc).toEqual({
      title: "sanction_letter v3",
      blocks: [
        { type: "heading", level: 1, text: "sanction_letter v3" },
        { type: "paragraph", runs: ["amount: 125000"] },
        { type: "paragraph", runs: ["city: ????"] },
        { type: "paragraph", runs: ["name: Asha <b>"] },
      ],
    });
    expect(r.file.storageKey).toMatch(/^tenant\/tnt_a\/docs\/0[0-9A-F]{25}\.pdf$/);
    const o = await storage.get(r.file.storageKey);
    expect(sha256Hex(o.body)).toBe(r.file.sha256);
    expect(o.meta).toMatchObject({ bucketClass: "CONFIDENTIAL", contentType: "application/pdf" });
    expect(r).toMatchObject({ format: "pdfa", templateVersion: "3", pageCount: 1 });
    await p.render({ ...req, format: "pdf" });
    expect(seen[1]!.o).toEqual({});
  });

  it("gives the same key and bytes for the same request, and others for other data", async () => {
    const { p } = make();
    const a = await p.render(req);
    expect(await p.render(req)).toEqual(a);
    expect((await p.render({ ...req, data: { name: "B" } })).file.sha256).not.toBe(a.file.sha256);
  });

  it("writes html as an escaped page and docx only with a docx renderer", async () => {
    const { storage, p } = make();
    const h = await p.render({ ...req, format: "html" });
    expect(h.pageCount).toBeNull();
    const page = new TextDecoder().decode((await storage.get(h.file.storageKey)).body);
    expect(page).toContain("<p>name: Asha &#60;b&#62;</p>");
    expect(h.file.storageKey.endsWith(".html")).toBe(true);
    await expect(p.render({ ...req, format: "docx" })).rejects.toBeInstanceOf(PortError);
    const w = make(true);
    const d = await w.p.render({ ...req, format: "docx" });
    expect(d.file.storageKey.endsWith(".docx")).toBe(true);
    expect((await w.storage.get(d.file.storageKey)).meta.contentType).toMatch(/wordprocessingml/);
  });

  it("reads an HTML page's title and blocks, never its head, scripts or styles", async () => {
    const { p } = make();
    seen.length = 0;
    await p.renderHtml({
      html: "<html><head><title>KFS &amp; terms</title><style>p{}</style></head><body><script>alert(1)</script><h1>Key facts</h1><p>Rate: 18&#37;</p><p>Fee: &#8377;500</p></body></html>",
      format: "pdfa",
      outputPrefix: "tenant/tnt_a/kfs",
    });
    expect(seen[0]!.doc).toEqual({
      title: "KFS & terms",
      blocks: [
        { type: "heading", level: 1, text: "KFS & terms" },
        { type: "paragraph", runs: ["Key facts"] },
        { type: "paragraph", runs: ["Rate: 18%"] },
        { type: "paragraph", runs: ["Fee: ₹500"] },
      ],
    });
  });

  it("refuses a prefix that is not tenant/<tenant>/<module>, writing nothing", async () => {
    const { storage, p } = make();
    await expect(
      p.render({ ...req, outputPrefix: "tenant/tnt_a/docs/sub" }),
    ).rejects.toBeInstanceOf(PortError);
    expect(storage.objects.size).toBe(0);
  });
});

describe("the PAYMENTS mandate lifecycle fake (PR-FBX-29)", () => {
  for (const c of mandateContractCases()) it(c.name, () => c.run(new FakeMandates()));
  it("becomes active with a UMRN once the bank registers it", async () => {
    const m = new FakeMandates();
    const r = await m.registerMandate(
      {
        customerRef: "cus_1",
        channel: "UPI_AUTOPAY",
        maxAmountMinor: 10_000_00,
        frequency: "MONTHLY",
        startDate: "2026-12-01",
        debtorAccountRef: "bac_1",
        authorisation: CONTRACT_AUTH,
      },
      "mandate-key-0001",
    );
    expect(r.authorisationUrl).toBeTruthy();
    expect(m.confirm(r.mandateId).umrn).toMatch(/^FAKE/);
    expect((await m.mandateStatus(r.mandateId)).state).toBe("active");
  });
});

describe("the ESIGN fake (PR-FBX-29)", () => {
  for (const c of esignFakeCases()) it(c.name, () => c.run(new FakeEsign()));
});

describe("the ESIGN fake over STORAGE (PR-UDF-070)", () => {
  const storage = new MemoryStorage();
  for (const c of esignFakeStorageCases(storage))
    it(c.name, () => c.run(new FakeEsign({ storage })), 30_000);
});

describe("payouts and DDE settle only through the bank or the utility", () => {
  it("settles with a UTR, fails a closed account and returns the money", async () => {
    const p = new FakePayouts({ balanceMinor: 10_000, closedAccounts: ["000999999999"] });
    const ok = await p.createBeneficiary({
      beneficiaryRef: "c1",
      name: "A",
      ifsc: "HDFC0000001",
      account: "000123456789",
    });
    const bad = await p.createBeneficiary({
      beneficiaryRef: "c2",
      name: "B",
      ifsc: "HDFC0000001",
      account: "000999999999",
    });
    const spec = { mode: "IMPS" as const, purposeRef: "ln_1", authorisation: CONTRACT_AUTH };
    const a = await p.payout(
      { ...spec, beneficiaryId: ok.beneficiaryId, amountMinor: 4_000 },
      "payout-key-0001",
    );
    const b = await p.payout(
      { ...spec, beneficiaryId: bad.beneficiaryId, amountMinor: 4_000 },
      "payout-key-0002",
    );
    expect(a.state).toBe("accepted");
    expect(p.settle(a.payoutId)).toMatchObject({ state: "settled" });
    expect((await p.getStatus(a.payoutId)).utr).toBeTruthy();
    expect(p.settle(b.payoutId)).toMatchObject({
      state: "failed",
      failureReason: "account closed",
    });
    expect((await p.balance()).availableMinor).toBe(6_000);
    await expect(
      p.payout({ ...spec, beneficiaryId: ok.beneficiaryId, amountMinor: 9_000 }, "payout-key-0003"),
    ).rejects.toMatchObject({ code: "IPB-PORT-002" });
  });

  it("executes a DDE once every executant signs, then serves the executed document", async () => {
    const e = new FakeEstamp();
    const party = (r: string) => ({ partyRef: r, name: r });
    const c = await e.purchase(
      {
        state: "MH",
        instrument: "loan_agreement",
        dutyMinor: 50_000,
        considerationMinor: 50_000_000,
        firstParty: party("p1"),
        secondParty: party("p2"),
        purchaser: party("p1"),
        outputPrefix: "tenant/tnt_a/dms",
        authorisation: CONTRACT_AUTH,
      },
      "estamp-key-0001",
    );
    const d = await e.ddeRegister(
      {
        document: c.file!,
        certificateId: c.certificateId,
        executants: [party("p1"), party("p2")],
        outputPrefix: "tenant/tnt_a/dms",
      },
      "dde-key-0001",
    );
    await expect(e.ddeDownloadExecuted(d.ddeId)).rejects.toThrow();
    e.execute(d.ddeId, "p1");
    e.execute(d.ddeId, "p2");
    expect((await e.ddeStatus(d.ddeId)).state).toBe("executed");
    expect((await e.ddeDownloadExecuted(d.ddeId)).sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await e.covers("WB", "loan_agreement")).toBe(false);
  });
});
