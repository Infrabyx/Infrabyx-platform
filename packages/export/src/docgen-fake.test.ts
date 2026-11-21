// FakeDocgen with `toPdf` and `toDocx` as its renderers (Udofin PR-UDF-077, R1-D-259): real PDF
// bytes in STORAGE, PDF/A-2b claiming PDF/UA-1 for `pdfa`, the same bytes on every render. The
// wiring lives here because `@infrabyx/fakes` cannot depend on `@infrabyx/export` (export's tests
// depend on `@infrabyx/testing`, which depends on fakes).
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@infrabyx/crypto";
import {
  FakeDocgen,
  MemoryStorage,
  defineContractSuite,
  docgenContractCases,
  docgenHtmlContractCases,
  docgenStorageContractCases,
} from "@infrabyx/testing";
import { toDocx } from "./docx.js";
import { pdfIdentification, pdfUaClaimed } from "./pdf-id.js";
import { toPdf } from "./pdf.js";

const renderers = { pdf: toPdf, docx: toDocx };
const make = () => {
  const storage = new MemoryStorage();
  return { storage, p: new FakeDocgen(undefined, { storage, renderers }) };
};
const req = {
  templateId: "sanction_letter",
  data: { borrower: "Asha", amount: "₹1,25,000", tenure_months: 24 },
  format: "pdfa" as const,
  outputPrefix: "tenant/tnt_a/docs",
};

const shared = make();
defineContractSuite("DOCGEN", () => shared.p, [
  ...docgenContractCases(),
  ...docgenHtmlContractCases(),
  ...docgenStorageContractCases(shared.storage),
]);

describe("FakeDocgen rendering with toPdf (PR-UDF-077)", () => {
  it("writes PDF/A-2b claiming PDF/UA-1 for pdfa, and a plain PDF for pdf", async () => {
    const { storage, p } = make();
    const a = await p.render(req);
    const pdfa = (await storage.get(a.file.storageKey)).body;
    expect(sha256Hex(pdfa)).toBe(a.file.sha256);
    expect(pdfIdentification(pdfa)).toEqual({
      pdfa: { part: 2, conformance: "B" },
      pdfua: { part: 1 },
    });
    expect(Buffer.from(pdfa).toString("latin1")).toContain("/StructTreeRoot");
    expect(a.pageCount).toBe(1);
    const plain = await p.render({ ...req, format: "pdf" });
    const bytes = (await storage.get(plain.file.storageKey)).body;
    expect(Buffer.from(bytes.subarray(0, 8)).toString("latin1")).toBe("%PDF-1.7");
    expect(pdfIdentification(bytes)).toEqual({});
    const html = await p.renderHtml({
      html: "<title>Notice</title><h1>Notice</h1><p>Pay by 1 Dec</p>",
      format: "pdfa",
      outputPrefix: "tenant/tnt_a/notices",
    });
    expect(pdfUaClaimed((await storage.get(html.file.storageKey)).body)).toBe(true);
  });

  it("renders the same bytes twice, in another fake too", async () => {
    const one = await make().p.render(req);
    const two = make();
    expect(await two.p.render(req)).toEqual(one);
    expect(sha256Hex((await two.storage.get(one.file.storageKey)).body)).toBe(one.file.sha256);
  });

  it("writes docx through toDocx", async () => {
    const { storage, p } = make();
    const d = await p.render({ ...req, format: "docx" });
    const body = (await storage.get(d.file.storageKey)).body;
    expect(Buffer.from(body.subarray(0, 2)).toString("latin1")).toBe("PK");
    expect(d.pageCount).toBeNull();
  });
});
