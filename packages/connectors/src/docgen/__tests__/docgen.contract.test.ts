// DOCGEN contract leg (#120, R1-D-100; R1-plan M71). Hermetic: the pinned Gotenberg image (Chromium
// and LibreOffice, fonts-noto-core). The generic `renderHtml` cases, then Hindi and Punjabi: the PDF
// must embed Noto Sans Devanagari and Noto Sans Gurmukhi, so the text is shaped with real fonts
// (no missing-glyph boxes from a fallback font). The storage cases (PR-UDF-077, R1-D-259) check
// that each PDF and PDF/A is in STORAGE with the bytes' own SHA-256.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import {
  defineContractSuite,
  docgenContractCases,
  docgenHtmlContractCases,
  docgenStorageContractCases,
  MemoryStorage,
  startService,
  type StartedService,
} from "@infrabyx/testing";
import { DocxtemplaterDocgen } from "../docxtemplater.js";
import { GotenbergDocgen } from "../gotenberg.js";

let gb: StartedService;
const storage = new MemoryStorage();
let adapter: GotenbergDocgen;

beforeAll(async () => {
  gb = await startService("gotenberg", {
    ports: [3000],
    readyHttp: { path: "/health", port: 3000 },
  });
  adapter = new GotenbergDocgen({
    baseUrl:
      gb.url ?? `http://${gb.host === "localhost" ? "127.0.0.1" : gb.host}:${gb.ports[3000]}`,
    storage,
    enabled: () => true,
    allowLoopbackHttp: true,
  });
}, 240_000);
afterAll(async () => gb?.stop());

defineContractSuite(
  "DOCGEN",
  () => adapter,
  [...docgenHtmlContractCases(), ...docgenStorageContractCases(storage)],
  { leg: "hermetic" },
);

describe("DOCGEN gotenberg: vernacular documents (#120)", () => {
  it("renders Hindi and Punjabi with Noto Sans Devanagari and Gurmukhi embedded", async () => {
    const html =
      `<!doctype html><html lang="hi"><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
      `<style>body{font-family:'Noto Sans Devanagari','Noto Sans Gurmukhi','Noto Sans',sans-serif}</style></head><body>` +
      `<h1>मुख्य तथ्य विवरण</h1><p>ऋण राशि: ₹1,25,000; ब्याज दर: 18% वार्षिक</p>` +
      `<p lang="pa">ਮੁੱਖ ਤੱਥ ਬਿਆਨ: ਕਰਜ਼ੇ ਦੀ ਰਕਮ ₹1,25,000</p></body></html>`;
    const r = await adapter.renderHtml({ html, format: "pdf", outputPrefix: "tenant/tnt_a/kfs" });
    const pdf = Buffer.from((await storage.get(r.file.storageKey)).body).toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toMatch(/NotoSansDevanagari/);
    expect(pdf).toMatch(/NotoSansGurmukhi/);
    expect(r.pageCount).toBe(1);
  }, 120_000);
});

// Item (c), R1-D-314: the template adapter with Gotenberg's LibreOffice route as its converter.
// A one-field template, `{name}`, written here: the generic DOCGEN cases render it to PDF and the
// HTML route to PDF/A.
const require = createRequire(import.meta.url);
const PizZip = require("pizzip") as new () => {
  file(name: string, data: string): unknown;
  generate(o: { type: "nodebuffer" }): Buffer;
};
function oneFieldDocx(): Buffer {
  const z = new PizZip();
  z.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  z.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  z.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">Sanction letter for {name}</w:t></w:r></w:p></w:body></w:document>',
  );
  return z.generate({ type: "nodebuffer" });
}

describe("@IPB-01-15 DOCGEN docxtemplater with the Gotenberg converter (item (c))", () => {
  let templ: DocxtemplaterDocgen;
  beforeAll(async () => {
    const bytes = oneFieldDocx();
    const file = {
      storageKey: `tenant/tnt_contract/templates/${ulid()}.docx`,
      sha256: sha256Hex(bytes),
    };
    await storage.put(file.storageKey, bytes, {
      bucketClass: "GENERAL",
      contentType: "application/octet-stream",
      sha256: file.sha256,
    });
    const t = { templateId: "sanction_letter", version: "1.0.0", file };
    templ = new DocxtemplaterDocgen({
      storage,
      templates: {
        list: async () => [t],
        get: async (_x, id) => (id === t.templateId ? t : undefined),
      },
      converter: {
        convertDocx: (d, f) => adapter.convertDocx(d, f),
        renderHtml: (r, c) => adapter.renderHtml(r, c),
      },
    });
  }, 240_000);
  defineContractSuite("DOCGEN", () => templ, docgenContractCases("sanction_letter"), {
    leg: "hermetic",
  });
});
