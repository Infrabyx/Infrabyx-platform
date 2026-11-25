// `releaseUpload` (IPB-02-44, `@IPB-02-AT-16`; PR-FBX-56, R1-D-292) on the reference MEDIA adapter
// (`sharp`), with the platform's upload corpus from `@infrabyx/testing`.
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@infrabyx/crypto";
import {
  EICAR,
  corpusPdf,
  corpusZip,
  DOCX,
  testPng,
  uploadCorpus,
  uploadCorpusContractCases,
  type CorpusFile,
  type CorpusOutcome,
} from "@infrabyx/testing";
import type { ScanProof, UploadRouteInput } from "@infrabyx/contracts/ports";
import { SharpMedia } from "../../media/sharp.js";
import { checkPdf } from "../pdf.js";
import { releaseUpload, type SvgSanitiser, type UploadPipelineOptions } from "../release.js";

const media = new SharpMedia();
const enc = (s: string) => new TextEncoder().encode(s);
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

/** What a CLEAN scan of these bytes returns (EICAR scans INFECTED, as every engine reports it). */
const scanOf = (bytes: Uint8Array): ScanProof => ({
  verdict: latin1(bytes).includes(latin1(EICAR)) ? "INFECTED" : "CLEAN",
  file: { storageKey: "tenant/tnt_t/quarantine/upload", sha256: sha256Hex(bytes) },
});

/** A stand-in for `sanitiseSvg` of `@infrabyx/brand` (the pipeline takes the sanitiser injected). */
const sanitiseSvg: SvgSanitiser = (b) => {
  const s = new TextDecoder().decode(b);
  if (!/^<svg/.test(s)) throw new Error("not svg");
  const removed: string[] = [];
  const svg = s
    .replace(/<script[\s\S]*?<\/script>/gi, () => (removed.push("<script>"), ""))
    .replace(/\s+on[a-z]+="[^"]*"/gi, () => (removed.push("event attribute"), ""));
  return { svg, removed };
};

const ALL: UploadRouteInput = {
  name: "kyc.documents",
  accept: ["image/png", "image/jpeg", "image/svg+xml", "application/pdf", DOCX],
  maxBytes: 32 * 1024 * 1024,
  svg: { mode: "sanitise" },
};

const run = (
  f: CorpusFile,
  route: UploadRouteInput = ALL,
  o: Partial<UploadPipelineOptions> = {},
) =>
  releaseUpload({ bytes: f.bytes, declaredType: f.declaredType, scan: scanOf(f.bytes) }, route, {
    media,
    sanitiseSvg,
    ...o,
  });

const outcome = async (f: CorpusFile, route: UploadRouteInput = ALL): Promise<CorpusOutcome> => {
  const r = await run(f, route);
  return r.released
    ? { refused: false, bytes: r.record.bytes, mime: r.record.mime }
    : { refused: true, code: r.code };
};

describe("@IPB-02-AT-16 the upload corpus on a route accepting every corpus type", () => {
  for (const c of uploadCorpusContractCases())
    it(c.name, () => c.run({ upload: (f) => outcome(f), accepts: ALL.accept }));
});

describe("@IPB-02-AT-16 the upload corpus on a narrow route (Finbyx: images and PDFs, no SVG)", () => {
  const narrow: UploadRouteInput = {
    name: "fv.photos",
    accept: ["image/png", "image/jpeg", "application/pdf"],
    maxBytes: 8 * 1024 * 1024,
  };
  for (const c of uploadCorpusContractCases())
    it(c.name, () => c.run({ upload: (f) => outcome(f, narrow), accepts: narrow.accept }));
});

describe("releaseUpload: raster images", () => {
  it("re-encodes through MEDIA: metadata and trailing bytes are gone, the record is the new copy", async () => {
    const png = testPng(40, 30);
    const r = await run({ name: "a.png", declaredType: "image/png", bytes: png });
    expect(r).toMatchObject({
      released: true,
      kind: "raster",
      steps: ["sniffed", "reencoded"],
      viewing: null,
    });
    if (!r.released) return;
    expect(r.record.mime).toBe("image/png");
    expect(r.record.sha256).toBe(sha256Hex(r.record.bytes));
    expect(r.originalSha256).toBe(sha256Hex(png));
    // testPng carries a tEXt chunk; the re-encoded copy does not.
    expect(latin1(png)).toContain("tEXt");
    expect(latin1(r.record.bytes)).not.toContain("tEXt");
  });

  it("keepOriginalAsEvidence: the original, unchanged, is the record and a re-encoded viewing copy is beside it, both hashed (Finbyx #333)", async () => {
    const png = testPng(40, 30);
    const r = await run(
      { name: "fv.png", declaredType: "image/png", bytes: png },
      { ...ALL, raster: { keepOriginalAsEvidence: true } },
    );
    expect(r.released).toBe(true);
    if (!r.released) return;
    expect(r.steps).toEqual(["sniffed", "reencoded", "kept_original_as_evidence"]);
    expect(r.record.bytes).toBe(png);
    expect(r.record.sha256).toBe(sha256Hex(png));
    expect(r.record.sha256).toBe(r.originalSha256);
    expect(r.viewing).not.toBeNull();
    expect(r.viewing!.sha256).toBe(sha256Hex(r.viewing!.bytes));
    expect(r.viewing!.sha256).not.toBe(r.record.sha256);
    expect(latin1(r.viewing!.bytes)).not.toContain("tEXt");
  });

  it("refuses a declared type the bytes are not (IPB-SEC-010), and a type the route does not accept (IPB-SEC-014)", async () => {
    const png = testPng(8, 8);
    expect(await run({ name: "x.jpg", declaredType: "image/jpeg", bytes: png })).toMatchObject({
      released: false,
      code: "IPB-SEC-010",
      reason: "type_mismatch",
    });
    expect(await run({ name: "x.pdf", declaredType: "application/pdf", bytes: png })).toMatchObject(
      { code: "IPB-SEC-010" },
    );
    expect(await run({ name: "x.webp", declaredType: "image/webp", bytes: png })).toMatchObject({
      code: "IPB-SEC-014",
      reason: "type_not_allowed",
    });
    expect(
      await run({ name: "x.html", declaredType: "text/html", bytes: enc("<html>") }),
    ).toMatchObject({ code: "IPB-SEC-014" });
  });

  it("refuses above the route's size limit (IPB-SEC-013)", async () => {
    const png = testPng(64, 64);
    expect(
      await run(
        { name: "a.png", declaredType: "image/png", bytes: png },
        { ...ALL, maxBytes: 100 },
      ),
    ).toMatchObject({ code: "IPB-SEC-013", reason: "too_large" });
  });

  it("refuses a file whose scan is not CLEAN or is of other bytes", async () => {
    const png = testPng(8, 8);
    const opts = { media, sanitiseSvg };
    for (const verdict of ["ERROR", "INFECTED", "PENDING"])
      expect(
        await releaseUpload(
          { bytes: png, declaredType: "image/png", scan: { ...scanOf(png), verdict } },
          ALL,
          opts,
        ),
      ).toMatchObject({ released: false, code: "IPB-SEC-011", reason: "not_scanned_clean" });
    expect(
      await releaseUpload(
        { bytes: png, declaredType: "image/png", scan: scanOf(testPng(9, 9)) },
        ALL,
        opts,
      ),
    ).toMatchObject({ code: "IPB-SEC-015", reason: "scan_of_other_bytes" });
  });
});

describe("releaseUpload: SVG", () => {
  it("sanitises by default on a sanitising route; refuses on the default route; rasterises when asked", async () => {
    const f = uploadCorpus.svgWithScript();
    const s = await run(f);
    expect(s).toMatchObject({ released: true, kind: "svg", steps: ["sniffed", "svg_sanitised"] });
    if (s.released) expect(s.findings).toContain("<script>");
    expect(await run(f, { name: "plain", accept: ["image/svg+xml"], maxBytes: 1e6 })).toMatchObject(
      { code: "IPB-SEC-012", reason: "svg_refused" },
    );
    expect(await run(f, ALL, { sanitiseSvg: undefined as never })).toMatchObject({
      code: "IPB-SEC-012",
      reason: "svg_refused",
    });
    const r = await run(f, { ...ALL, svg: { mode: "rasterise", size: 64 } });
    expect(r).toMatchObject({
      released: true,
      steps: ["sniffed", "svg_sanitised", "svg_rasterised"],
    });
    if (r.released) expect(r.record.mime).toBe("image/png");
  });
});

describe("releaseUpload: PDF", () => {
  it("passes a clean PDF unchanged and reports OpenAction, AA and attachments without refusing them", async () => {
    const pdf = corpusPdf([
      "<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] /Names << /EmbeddedFiles 4 0 R >> >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /AA << >> >>",
      "<< /Names [] >>",
    ]);
    const r = await run({ name: "a.pdf", declaredType: "application/pdf", bytes: pdf });
    expect(r).toMatchObject({ released: true, steps: ["sniffed", "pdf_checked"] });
    if (r.released) {
      expect(r.record.bytes).toBe(pdf);
      expect(r.findings).toEqual(expect.arrayContaining(["OpenAction", "AA", "EmbeddedFiles"]));
    }
    // A route may treat a reported name as active.
    expect(
      await run(
        { name: "a.pdf", declaredType: "application/pdf", bytes: pdf },
        { ...ALL, pdf: { refuseAlso: ["EmbeddedFiles"] } },
      ),
    ).toMatchObject({ code: "IPB-SEC-012", findings: ["EmbeddedFiles"] });
  });

  it.each([
    ["Launch", "<< /S /Launch /F (cmd.exe) >>"],
    ["SubmitForm", "<< /S /SubmitForm /F (https://x.test) >>"],
    ["XFA", "<< /XFA 9 0 R >>"],
    ["RichMedia", "<< /Subtype /RichMedia >>"],
  ])("refuses %s (IPB-SEC-012)", async (name, obj) => {
    const pdf = corpusPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
      obj,
    ]);
    expect(await run({ name: "a.pdf", declaredType: "application/pdf", bytes: pdf })).toMatchObject(
      { code: "IPB-SEC-012", reason: "pdf_active_content", findings: [name] },
    );
  });

  it("finds JavaScript inside a compressed object stream and behind #xx escapes", () => {
    expect(checkPdf(uploadCorpus.pdfWithHiddenJs().bytes)).toMatchObject({
      ok: true,
      active: ["JavaScript", "JS"],
    });
  });

  it("an object hidden after a stream's /Length is still read", () => {
    const pdf = corpusPdf([
      "<< /Type /Catalog >>",
      enc("<< /Length 3 >>\nstream\nabc 9 0 obj << /S /JavaScript >> endobj\nendstream"),
    ]);
    expect(checkPdf(pdf)).toMatchObject({ ok: true, active: ["JavaScript"] });
  });

  it("fails closed: encrypted, an object stream it cannot decode, an object stream that inflates too far", () => {
    expect(checkPdf(corpusPdf(["<< /Type /Catalog >>", "<< /Encrypt 3 0 R >>"]))).toEqual({
      ok: false,
      reason: "pdf_encrypted",
    });
    expect(
      checkPdf(
        corpusPdf([
          enc("<< /Type /ObjStm /Filter /LZWDecode /Length 3 >>\nstream\nabc\nendstream"),
        ]),
      ),
    ).toEqual({ ok: false, reason: "pdf_unreadable" });
  });

  it("flattens through the route's flattener and checks its output again", async () => {
    const f = uploadCorpus.pdfWithJs();
    const route = { ...ALL, pdf: { onActive: "flatten" as const } };
    expect(await run(f, route)).toMatchObject({
      code: "IPB-SEC-012",
      reason: "pdf_flatten_unavailable",
    });
    const clean = corpusPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
    ]);
    const ok = await run(f, route, { flattenPdf: async () => clean });
    expect(ok).toMatchObject({
      released: true,
      steps: ["sniffed", "pdf_checked", "pdf_flattened"],
    });
    if (ok.released) expect(ok.record.sha256).toBe(sha256Hex(clean));
    expect(await run(f, route, { flattenPdf: async (b) => b })).toMatchObject({
      code: "IPB-SEC-012",
      reason: "pdf_flatten_failed",
    });
    expect(
      await run(f, route, {
        flattenPdf: async () => {
          throw new Error("down");
        },
      }),
    ).toMatchObject({ reason: "pdf_flatten_failed" });
  });
});

describe("releaseUpload: Office", () => {
  it("passes a clean DOCX; refuses macros, ActiveX and legacy OLE unless the route allows macros", async () => {
    expect(await run(uploadCorpus.cleanDocx())).toMatchObject({
      released: true,
      steps: ["sniffed", "office_checked"],
    });
    const activex = corpusZip({
      "[Content_Types].xml": "<Types/>",
      "word/activeX/activeX1.xml": "<ax/>",
    });
    expect(await run({ name: "a.docx", declaredType: DOCX, bytes: activex })).toMatchObject({
      code: "IPB-SEC-012",
      reason: "office_macros",
      findings: ["activex"],
    });
    const allow = { ...ALL, office: { allowMacros: true } };
    expect(await run(uploadCorpus.docxWithMacro(), allow)).toMatchObject({
      released: true,
      steps: ["sniffed", "office_checked", "office_macros_allowed"],
    });
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    const legacy = { ...ALL, accept: [...ALL.accept, "application/msword" as const] };
    expect(
      await run({ name: "a.doc", declaredType: "application/msword", bytes: ole }, legacy),
    ).toMatchObject({ code: "IPB-SEC-012", reason: "office_legacy" });
    expect(
      await run(
        { name: "a.doc", declaredType: "application/msword", bytes: ole },
        { ...legacy, office: { allowMacros: true } },
      ),
    ).toMatchObject({ released: true });
    // An OLE file declared as DOCX, and a DOCX declared as .doc, are type mismatches.
    expect(await run({ name: "a.docx", declaredType: DOCX, bytes: ole })).toMatchObject({
      code: "IPB-SEC-010",
    });
    expect(
      await run({ ...uploadCorpus.cleanDocx(), declaredType: "application/msword" }, legacy),
    ).toMatchObject({ code: "IPB-SEC-010" });
  });

  it("refuses a macro-enabled type even without a VBA part, and a damaged zip", async () => {
    const xlsm = "application/vnd.ms-excel.sheet.macroEnabled.12" as const;
    const route = { ...ALL, accept: [xlsm] };
    expect(await run({ ...uploadCorpus.cleanDocx(), declaredType: xlsm }, route)).toMatchObject({
      code: "IPB-SEC-012",
      reason: "office_macros",
    });
    const broken = uploadCorpus.cleanDocx().bytes.slice(0, 60);
    expect(await run({ name: "a.docx", declaredType: DOCX, bytes: broken })).toMatchObject({
      code: "IPB-SEC-010",
      reason: "office_unreadable",
    });
  });
});
