// The IPB-02-44 upload corpus (`@IPB-02-AT-16`; Finbyx PR-FBX-56, R1-D-292) as contract cases a
// product runs against its own upload routes: a PNG/HTML polyglot, EICAR, an SVG with a script, a
// PDF with JavaScript (plain, and hidden in a compressed object stream behind `#xx` escapes), a
// DOCX with a VBA macro (and one with the VBA part renamed), and a zip bomb, each refused or
// neutralised; and a clean file of every type the route accepts is released. Every file is built
// here from bytes, so no binary fixture is committed.
import { deflateRawSync, deflateSync, crc32 } from "node:zlib";
import { EICAR, testPng } from "@infrabyx/fakes";
import { expect } from "vitest";
import type { ContractCase } from "./contract.js";

const enc = (s: string) => new TextEncoder().encode(s);
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A minimal PDF from object bodies, with a correct cross-reference table. */
export function corpusPdf(objects: Array<string | Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [enc("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  const offsets: number[] = [];
  let at = parts[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(at);
    const p = concat([
      enc(`${i + 1} 0 obj\n`),
      typeof body === "string" ? enc(body) : body,
      enc("\nendobj\n"),
    ]);
    parts.push(p);
    at += p.length;
  });
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(at),
    "%%EOF",
    "",
  ].join("\n");
  parts.push(enc(xref));
  return concat(parts);
}

const PAGE = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
];

/** A minimal ZIP (OOXML) with the given entries, deflated. */
export function corpusZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const data = typeof raw === "string" ? enc(raw) : raw;
    const comp = deflateRawSync(data);
    const n = enc(name);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + n.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, n.length, true);
    lh.set(n, 30);
    const ch = new Uint8Array(46 + n.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    ch.set(n, 46);
    local.push(lh, comp);
    central.push(ch);
    offset += lh.length + comp.length;
  }
  const cd = concat(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, offset, true);
  return concat([...local, cd, end]);
}

const CONTENT_TYPES = (extra = "") =>
  `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${extra}</Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Board resolution</w:t></w:r></w:p></w:body></w:document>`;

/** The corpus files (bytes and the type a client would declare). */
export const uploadCorpus = {
  cleanPng: (): CorpusFile => ({
    name: "clean.png",
    declaredType: "image/png",
    bytes: testPng(64, 48),
  }),
  /** IPB-02-AT-16: a PNG that is also an HTML page (markup after `IEND`). */
  polyglotPngHtml: (): CorpusFile => ({
    name: "polyglot.png",
    declaredType: "image/png",
    bytes: concat([
      testPng(32, 32),
      enc("<html><body><script>alert(document.domain)</script></body></html>"),
    ]),
  }),
  /** IPB-02-AT-16: the EICAR test file, declared as an image. */
  eicar: (): CorpusFile => ({ name: "eicar.png", declaredType: "image/png", bytes: EICAR }),
  cleanSvg: (): CorpusFile => ({
    name: "clean.svg",
    declaredType: "image/svg+xml",
    bytes: enc(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></svg>',
    ),
  }),
  /** IPB-02-AT-16: an SVG with a script and an event handler. */
  svgWithScript: (): CorpusFile => ({
    name: "logo.svg",
    declaredType: "image/svg+xml",
    bytes: enc(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10"/></svg>',
    ),
  }),
  cleanPdf: (): CorpusFile => ({
    name: "clean.pdf",
    declaredType: "application/pdf",
    bytes: corpusPdf(PAGE),
  }),
  /** IPB-02-AT-16: a PDF whose OpenAction runs JavaScript. */
  pdfWithJs: (): CorpusFile => ({
    name: "statement.pdf",
    declaredType: "application/pdf",
    bytes: corpusPdf([
      "<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>",
      PAGE[1]!,
      PAGE[2]!,
      "<< /S /JavaScript /JS (app.alert\\(1\\)) >>",
    ]),
  }),
  /** The same action hidden in a compressed object stream, its names spelt with `#xx` escapes. */
  pdfWithHiddenJs: (): CorpusFile => {
    const inner = enc("5 0 << /S /J#61vaScript /J#53 (app.alert\\(1\\)) >>");
    const header = "5 0 ";
    const body = deflateSync(concat([enc(header), inner.subarray(header.length)]));
    const objstm = concat([
      enc(
        `<< /Type /ObjStm /N 1 /First ${header.length} /Filter /FlateDecode /Length ${body.length} >>\nstream\n`,
      ),
      body,
      enc("\nendstream"),
    ]);
    return {
      name: "statement.pdf",
      declaredType: "application/pdf",
      bytes: corpusPdf([
        "<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R >>",
        PAGE[1]!,
        PAGE[2]!,
        objstm,
      ]),
    };
  },
  cleanDocx: (): CorpusFile => ({
    name: "clean.docx",
    declaredType: DOCX,
    bytes: corpusZip({
      "[Content_Types].xml": CONTENT_TYPES(),
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": DOCUMENT,
    }),
  }),
  /** IPB-02-AT-16: a DOCX with a VBA project. */
  docxWithMacro: (): CorpusFile => ({
    name: "resolution.docx",
    declaredType: DOCX,
    bytes: corpusZip({
      "[Content_Types].xml": CONTENT_TYPES(
        '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>',
      ),
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": DOCUMENT,
      "word/vbaProject.bin": new Uint8Array([
        0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3,
      ]),
    }),
  }),
  /** The VBA project under another name: found by its content type, not its name. */
  docxWithRenamedMacro: (): CorpusFile => ({
    name: "resolution.docx",
    declaredType: DOCX,
    bytes: corpusZip({
      "[Content_Types].xml": CONTENT_TYPES(
        '<Override PartName="/word/data1.dat" ContentType="application/vnd.ms-office.vbaProject"/>',
      ),
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": DOCUMENT,
      "word/data1.dat": new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]),
    }),
  }),
  /** IPB-02-AT-16: a small DOCX one of whose parts inflates a thousandfold. */
  zipBomb: (): CorpusFile => ({
    name: "big.docx",
    declaredType: DOCX,
    bytes: corpusZip({
      "[Content_Types].xml": CONTENT_TYPES(),
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": new Uint8Array(16 * 1024 * 1024),
    }),
  }),
};

export interface CorpusFile {
  name: string;
  declaredType: string;
  bytes: Uint8Array;
}

/** What a product's upload route did with one file. */
export type CorpusOutcome =
  | { refused: true; code: string }
  | { refused: false; bytes: Uint8Array; mime: string; viewing?: Uint8Array };

export interface UploadCorpusSubject {
  /** Runs the product's whole upload route on one file: the AV scan, then `releaseUpload`. */
  upload(file: CorpusFile): Promise<CorpusOutcome>;
  /** The declared types the route accepts; a clean file of each must be released. */
  accepts: readonly string[];
}

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

/**
 * The IPB-02-AT-16 cases for one upload route. Each malicious file is refused with its code, or (an
 * SVG or a PDF) neutralised: stored without the script or the action.
 */
export function uploadCorpusContractCases(): Array<ContractCase<UploadCorpusSubject>> {
  const refusedWith = (o: CorpusOutcome, codes: string[]) => {
    expect(o.refused, "the file was released").toBe(true);
    if (o.refused) expect(codes).toContain(o.code);
  };
  return [
    {
      name: "@IPB-02-AT-16 a PNG/HTML polyglot is refused (IPB-SEC-010), or IPB-SEC-014 where PNG is not accepted",
      async run(s) {
        const o = await s.upload(uploadCorpus.polyglotPngHtml());
        refusedWith(
          o,
          s.accepts.includes("image/png") ? ["IPB-SEC-010"] : ["IPB-SEC-014", "IPB-SEC-010"],
        );
      },
    },
    {
      name: "@IPB-02-AT-16 the EICAR test file is refused as malware (IPB-SEC-011)",
      async run(s) {
        refusedWith(await s.upload(uploadCorpus.eicar()), ["IPB-SEC-011"]);
      },
    },
    {
      name: "@IPB-02-AT-16 an SVG with a script is sanitised (no script, no handler) or refused",
      async run(s) {
        const o = await s.upload(uploadCorpus.svgWithScript());
        if (o.refused) expect(["IPB-SEC-012", "IPB-SEC-014"]).toContain(o.code);
        else expect(latin1(o.bytes)).not.toMatch(/<script|onload|alert/i);
      },
    },
    ...(["pdfWithJs", "pdfWithHiddenJs"] as const).map((k) => ({
      name: `@IPB-02-AT-16 a PDF with JavaScript (${k === "pdfWithJs" ? "plain" : "in a compressed object stream, #xx escapes"}) is flattened (no JavaScript left) or refused (IPB-SEC-012)`,
      async run(s: UploadCorpusSubject) {
        const o = await s.upload(uploadCorpus[k]());
        if (o.refused) expect(["IPB-SEC-012", "IPB-SEC-014"]).toContain(o.code);
        else expect(latin1(o.bytes)).not.toMatch(/\/J(avaScript|S)\b|#61vaScript|J#53/);
      },
    })),
    ...(["docxWithMacro", "docxWithRenamedMacro"] as const).map((k) => ({
      name: `@IPB-02-AT-16 a DOCX with a VBA macro${k === "docxWithRenamedMacro" ? " under another part name" : ""} is refused (IPB-SEC-012)`,
      async run(s: UploadCorpusSubject) {
        const o = await s.upload(uploadCorpus[k]());
        refusedWith(o, s.accepts.includes(DOCX) ? ["IPB-SEC-012"] : ["IPB-SEC-014"]);
      },
    })),
    {
      name: "@IPB-02-AT-16 a zip bomb is refused (IPB-SEC-013)",
      async run(s) {
        const o = await s.upload(uploadCorpus.zipBomb());
        refusedWith(o, s.accepts.includes(DOCX) ? ["IPB-SEC-013"] : ["IPB-SEC-014", "IPB-SEC-013"]);
      },
    },
    {
      name: "a clean file of every accepted type is released",
      async run(s) {
        const clean: Record<string, CorpusFile> = {
          "image/png": uploadCorpus.cleanPng(),
          "image/svg+xml": uploadCorpus.cleanSvg(),
          "application/pdf": uploadCorpus.cleanPdf(),
          [DOCX]: uploadCorpus.cleanDocx(),
        };
        for (const t of s.accepts) {
          const f = clean[t];
          if (!f) continue;
          const o = await s.upload(f);
          expect(o.refused, `a clean ${t} was refused`).toBe(false);
        }
      },
    },
  ];
}
