// `pdfIdentification` and `pdfUaClaimed` (Udofin PR-UDF-077, R1-D-259): the claim in the catalog's
// XMP, from `toPdf` and from hand-built files (object streams, Flate metadata, attribute form,
// incremental updates), and never a throw on a damaged file.
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { OfficeExportError } from "./ooxml.js";
import { pdfIdentification, pdfUaClaimed } from "./pdf-id.js";
import { toPdf, type PdfDocument } from "./pdf.js";

const DOC: PdfDocument = {
  title: "Key Fact Statement",
  blocks: [
    { type: "heading", level: 1, text: "Key Fact Statement" },
    { type: "paragraph", runs: ["Loan amount: ₹1,25,000"] },
  ],
};
const created = new Date("2026-11-21T00:00:00Z");

/** A PDF of `objects` (1-based, bodies as given) with a classic xref; the reader needs none. */
function pdf(objects: Array<string | Buffer>): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n", "latin1")];
  objects.forEach((o, i) =>
    parts.push(
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      typeof o === "string" ? Buffer.from(o, "latin1") : o,
      Buffer.from("\nendobj\n", "latin1"),
    ),
  );
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"));
  return Buffer.concat(parts);
}
const stream = (dict: string, body: Buffer) =>
  Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${body.length} >>\nstream\n`, "latin1"),
    body,
    Buffer.from("\nendstream", "latin1"),
  ]);
const xmp = (props: string, ns = "") =>
  Buffer.from(
    `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">` +
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ${ns}>` +
      `${props}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="r"?>`,
    "utf8",
  );
const A_NS = 'xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"';
const UA_NS = 'xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"';

describe("pdfIdentification (PR-UDF-077)", () => {
  it("reads PDF/A-2b and PDF/UA-1 from toPdf's metadata, and PDF/A alone without pdfua", () => {
    const ua = toPdf(DOC, { created, pdfa: "2b", pdfua: true });
    expect(pdfIdentification(ua)).toEqual({
      pdfa: { part: 2, conformance: "B" },
      pdfua: { part: 1 },
    });
    expect(pdfUaClaimed(ua)).toBe(true);
    const a = toPdf(DOC, { created, pdfa: "2b" });
    expect(pdfIdentification(a)).toEqual({ pdfa: { part: 2, conformance: "B" } });
    expect(pdfUaClaimed(a)).toBe(false);
    expect(pdfIdentification(toPdf(DOC, { created }))).toEqual({});
  });

  it("claims nothing for a file that is not a PDF, and refuses one over maxBytes", () => {
    expect(pdfIdentification(new Uint8Array())).toEqual({});
    expect(pdfIdentification(Buffer.from("<x:xmpmeta pdfuaid:part='1'/>"))).toEqual({});
    const ua = toPdf(DOC, { created, pdfa: "2b", pdfua: true });
    const reason = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof OfficeExportError ? e.reason : "other";
      }
      return "none";
    };
    expect(reason(() => pdfIdentification(ua, { maxBytes: ua.length - 1 }))).toBe("too_large");
    expect(reason(() => pdfUaClaimed(ua, { maxBytes: 0 }))).toBe("max_bytes_invalid");
    expect(pdfUaClaimed(ua, { maxBytes: ua.length })).toBe(true);
  });

  it("follows a catalog in an object stream to Flate metadata in attribute form, any prefix", () => {
    const meta = xmp(
      "",
      'xmlns:a="http://www.aiim.org/pdfa/ns/id/" xmlns:u="http://www.aiim.org/pdfua/ns/id/" a:part="3" a:conformance="u" u:part="2"',
    );
    const objs = "<< /Type /Pages /Kids [] /Count 0 >>";
    const catalog = "<< /Type /Catalog /Pages 2 0 R /Metadata 4 0 R >>";
    const header = `2 0 1 ${objs.length + 1} `;
    const inner = Buffer.from(header + objs + " " + catalog, "latin1");
    const file = pdf([
      stream(`/Type /ObjStm /N 2 /First ${header.length} /Filter /FlateDecode`, deflateSync(inner)),
      "<< >>",
      "null",
      Buffer.concat([
        Buffer.from(
          `<< /Type /Metadata /Subtype /XML /Filter [/FlateDecode] /Length 5 0 R >>\nstream\n`,
        ),
        deflateSync(meta),
        Buffer.from("\nendstream"),
      ]),
      String(deflateSync(meta).length),
    ]);
    expect(pdfIdentification(file)).toEqual({
      pdfa: { part: 3, conformance: "U" },
      pdfua: { part: 2 },
    });
  });

  it("counts only the catalog's metadata, the last definition of it, and no other filter", () => {
    const claimed = xmp(
      "<pdfaid:part>2</pdfaid:part><pdfuaid:part>1</pdfuaid:part>",
      `${A_NS} ${UA_NS}`,
    );
    const plain = xmp("<dc:format>application/pdf</dc:format>");
    // An image's metadata claims PDF/UA; the catalog's does not.
    const image = pdf([
      "<< /Type /Catalog /Pages 2 0 R /Metadata 3 0 R >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
      stream("/Type /Metadata /Subtype /XML", plain),
      stream("/Type /Metadata /Subtype /XML", claimed),
    ]);
    expect(pdfIdentification(image)).toEqual({});
    // An incremental update redefines object 3 without the claim.
    const base = pdf([
      "<< /Type /Catalog /Pages 2 0 R /Metadata 3 0 R >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
      stream("/Type /Metadata /Subtype /XML", claimed),
    ]);
    expect(pdfUaClaimed(base)).toBe(true);
    const updated = Buffer.concat([
      base,
      Buffer.from("3 0 obj\n", "latin1"),
      stream("/Type /Metadata /Subtype /XML", plain),
      Buffer.from("\nendobj\n%%EOF\n", "latin1"),
    ]);
    expect(pdfUaClaimed(updated)).toBe(false);
    const hex = pdf([
      "<< /Type /Catalog /Pages 2 0 R /Metadata 3 0 R >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
      stream(
        "/Type /Metadata /Subtype /XML /Filter /ASCIIHexDecode",
        Buffer.from(claimed.toString("hex")),
      ),
    ]);
    expect(pdfIdentification(hex)).toEqual({});
  });

  it("refuses a malformed part or conformance as no claim", () => {
    const file = (props: string) =>
      pdf([
        "<< /Type /Catalog /Pages 2 0 R /Metadata 3 0 R >>",
        "<< /Type /Pages /Kids [] /Count 0 >>",
        stream("/Type /Metadata /Subtype /XML", xmp(props, `${A_NS} ${UA_NS}`)),
      ]);
    expect(
      pdfIdentification(file("<pdfaid:part>7</pdfaid:part><pdfuaid:part>3</pdfuaid:part>")),
    ).toEqual({});
    expect(
      pdfIdentification(
        file("<pdfaid:part>2</pdfaid:part><pdfaid:conformance>BB</pdfaid:conformance>"),
      ),
    ).toEqual({
      pdfa: { part: 2 },
    });
    // The extension schema's text names the prefix but makes no claim.
    expect(pdfIdentification(file("<pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix>"))).toEqual({});
  });

  it("never throws on a truncated or damaged file", () => {
    const ua = toPdf(DOC, { created, pdfa: "2b", pdfua: true });
    for (let n = 0; n < ua.length; n += 97)
      expect(() => pdfIdentification(ua.subarray(0, n))).not.toThrow();
    let seed = 7;
    for (let i = 0; i < 200; i++) {
      const b = Buffer.from(ua);
      for (let k = 0; k < 16; k++) {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        b[seed % b.length] = seed & 0xff;
      }
      expect(() => pdfIdentification(b)).not.toThrow();
    }
  });

  it("stays linear on a file of repeated catalog and object-stream keys", () => {
    const junk = Buffer.from(
      "%PDF-1.7\n" + "/Type /Catalog /Type /ObjStm ".repeat(300_000),
      "latin1",
    );
    const t = Date.now();
    expect(pdfIdentification(junk)).toEqual({});
    expect(Date.now() - t).toBeLessThan(5_000);
  });
});
