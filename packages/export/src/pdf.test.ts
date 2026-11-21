// PDF renderer (PR-LDC-28, R1-D-95): structure, determinism, the WinAnsi limit, links and limits;
// PDF/A-2b and tagging (PR-FBX-52, R1-D-248; veraPDF runs in src/__tests__/pdfa.int.test.ts).
import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@infrabyx/crypto";
import { OfficeExportError } from "./ooxml.js";
import { toPdf, type PdfDocument } from "./pdf.js";
import { blocksToHtml, pdfNeedsShaping, renderPdf } from "./pdf-route.js";
import { bundledFont } from "./ttf.js";

const T = new Date("2026-11-04T00:00:00Z");
const DOC: PdfDocument = {
  title: "Report",
  blocks: [
    { type: "heading", level: 1, text: "Quarterly report" },
    {
      type: "paragraph",
      runs: [
        "Plain, ",
        { text: "bold", bold: true },
        " and ",
        { text: "a link", href: "https://example.com/x" },
      ],
    },
    { type: "bulletList", items: [["one"], { runs: ["two"], items: [["two a"]] }] },
    {
      type: "table",
      header: ["Name", "Amount"],
      rows: Array.from({ length: 150 }, (_, i) => [`Row ${i + 1}`, "€1,000.00 – “ok”"]),
    },
    { type: "pageBreak" },
    { type: "paragraph", runs: ["(the end) \\ done ₹500"] },
  ],
};
const reason = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof OfficeExportError ? e.reason : String(e);
  }
};
const latin = (b: Buffer) => b.toString("latin1");
/** The decompressed content streams, in order. */
function contents(pdf: Buffer): string[] {
  const out: string[] = [];
  const s = latin(pdf);
  // Page content streams only (font files and ToUnicode maps have other dictionaries).
  const re = /<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const start = m.index + m[0].length;
    out.push(latin(inflateSync(pdf.subarray(start, start + Number(m[1])))));
  }
  return out;
}

const STYLES = ["Regular", "Bold", "Italic", "BoldItalic"] as const;
const reverse = STYLES.map((st) => {
  const m = new Map<number, number>();
  for (const [cp, g] of bundledFont(st).cmap) if (!m.has(g)) m.set(g, cp);
  return m;
});
/** The text a content stream shows, decoded through each font's character map. */
const shown = (c: string) =>
  [...c.matchAll(/\/F(\d) [\d.]+ Tf [^<]*<([0-9A-F]*)> Tj/g)]
    .map(([, f, hex]) =>
      String.fromCodePoint(
        ...(hex!.match(/.{4}/g) ?? []).map((g) => reverse[Number(f) - 1]!.get(parseInt(g, 16))!),
      ),
    )
    .join("");

describe("toPdf", () => {
  const pdf = toPdf(DOC, { created: T, creator: "Infrabyx" });
  const s = latin(pdf);

  it("is a PDF 1.7 file whose cross-reference table points at each object", () => {
    expect(s.startsWith("%PDF-1.7\n")).toBe(true);
    expect(s.endsWith("%%EOF\n")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]);
    expect(s.slice(startxref, startxref + 5)).toBe("xref\n");
    const [, count] = /xref\n0 (\d+)\n/.exec(s)!;
    const entries = s
      .slice(startxref)
      .split("\n")
      .slice(3, 2 + Number(count));
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10));
      expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(s).toContain("/Title <FEFF005200650070006F00720074>");
    expect(s).toMatch(/\/CreationDate \(D:20261104000000Z\)/);
  });

  it("lays text out on A4 pages, the table header repeated on each page it spans", () => {
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)![1]);
    expect(pages).toBeGreaterThanOrEqual(4);
    expect(s).toContain("/MediaBox [0 0 595.28 841.89]");
    const streams = contents(pdf);
    expect(streams).toHaveLength(pages);
    expect(shown(streams[0]!)).toContain("Quarterly report");
    const withHeader = streams.filter((c) => shown(c).includes("NameAmount"));
    // Every page but the last (after the page break) carries the table and its header.
    expect(withHeader.length).toBe(pages - 1);
    // WinAnsi: the euro sign is 0x80, the en dash 0x96, curly quotes 0x93 and 0x94.
    expect(shown(streams[0]!)).toContain("€1,000.00 – “ok”");
    // Parentheses and backslashes are escaped; the page break starts the last page.
    expect(shown(streams.at(-1)!)).toBe("(the end) \\ done ₹500");
  });

  it("adds a link annotation for an https run, and no JavaScript, forms or attachments", () => {
    expect(s).toContain("/Subtype /Link");
    expect(s).toContain("/URI (https://example.com/x)");
    for (const k of ["/JavaScript", "/JS", "/AcroForm", "/EmbeddedFile", "/Launch", "/OpenAction"])
      expect(s).not.toContain(k);
    expect(
      reason(() =>
        toPdf({
          blocks: [{ type: "paragraph", runs: [{ text: "x", href: "http://example.com" }] }],
        }),
      ),
    ).toBe("link_invalid");
  });

  it("gives the same bytes for the same blocks and time", () => {
    expect(toPdf(DOC, { created: T, creator: "Infrabyx" }).equals(pdf)).toBe(true);
    expect(toPdf({ blocks: [] }).equals(toPdf({ blocks: [] }))).toBe(true);
  });

  it("embeds Noto Sans as CID fonts with a ToUnicode map, only the styles used", () => {
    expect(s).toContain("/Subtype /CIDFontType2");
    expect(s).toContain("/Encoding /Identity-H");
    expect(s).toContain("/BaseFont /NotoSans-Regular");
    expect(s).toContain("/BaseFont /NotoSans-Bold");
    expect(s).not.toContain("/BaseFont /NotoSans-BoldItalic");
    expect((s.match(/\/FontFile2/g) ?? []).length).toBe(2);
    expect((s.match(/\/ToUnicode/g) ?? []).length).toBe(2);
  });

  it("shows the rupee sign, and refuses what the fonts cannot show instead of replacing it", () => {
    const one = (t: string) => () => toPdf({ blocks: [{ type: "paragraph", runs: [t] }] });
    expect(reason(one("₹ 1,25,000 and Łódź"))).toBeNull();
    expect(reason(one("नमस्ते"))).toBe("shaping_required");
    expect(reason(one("ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ"))).toBe("shaping_required");
    expect(reason(one("مرحبا"))).toBe("char_unsupported");
    expect(reason(one("你好"))).toBe("char_unsupported");
  });

  it("draws arrows from the Noto Sans Math fallback, glyph by glyph, only when used (PR-LDC-36)", () => {
    expect(s).not.toContain("NotoSansMath");
    const doc: PdfDocument = {
      blocks: [
        { type: "paragraph", runs: ["Filed → Accepted ⇒ Closed ↔ ↩"] },
        { type: "paragraph", runs: [{ text: "Step A→B", bold: true }] },
      ],
    };
    const out = toPdf(doc, { created: T });
    const text = out.toString("latin1");
    expect(text).toContain("/BaseFont /NotoSansMath-Regular");
    expect((text.match(/\/FontFile2/g) ?? []).length).toBe(3);
    const math = bundledFont("Math");
    for (const cp of [0x2190, 0x2192, 0x21d2, 0x21d4, 0x21a9, 0x21ff])
      expect(math.cmap.has(cp)).toBe(true);
    expect(math.cmap.has(0x41)).toBe(false);
    // The bold word "A→B" switches font inside the word: Bold, then the fallback, then Bold.
    const ops = [...text.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
      .map((m) => {
        try {
          return inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
        } catch {
          return "";
        }
      })
      .join("\n");
    expect(ops).toMatch(
      /\/F2 [\d.]+ Tf [\d.]+ [\d.]+ Td <[0-9A-F]+> Tj ET\nBT \/F5 [\d.]+ Tf [\d.]+ [\d.]+ Td <[0-9A-F]{4}> Tj ET\nBT \/F2 /,
    );
    // ToUnicode keeps the arrows searchable.
    expect(ops).toContain("<2192>");
    expect(ops).toContain("<21D2>");
    expect(toPdf(doc, { created: T }).equals(out)).toBe(true);
    // Outside the Arrows block nothing falls back.
    expect(reason(() => toPdf({ blocks: [{ type: "paragraph", runs: ["∀x"] }] }))).toBe(
      "char_unsupported",
    );
  });

  it("refuses bad blocks and keeps to the size cap", () => {
    const one = (b: unknown) => () => toPdf({ blocks: [b as never] });
    expect(reason(one({ type: "heading", level: 7, text: "x" }))).toBe("block_invalid");
    expect(reason(one({ type: "table", header: ["a"], rows: [["a", "b"]] }))).toBe("block_invalid");
    expect(reason(one({ type: "table", header: [], rows: [] }))).toBe("block_invalid");
    expect(reason(one({ type: "image" }))).toBe("block_invalid");
    expect(
      reason(
        one({
          type: "bulletList",
          items: [{ runs: ["a"], items: [{ runs: ["b"], items: [["c"]] }] }],
        }),
      ),
    ).toBe("block_invalid");
    expect(reason(() => toPdf({ blocks: new Array(100_001) }))).toBe("too_many_blocks");
    expect(reason(() => toPdf(DOC, { maxBytes: 2_000 }))).toBe("too_large");
  });
});

describe("renderPdf and blocksToHtml (Indic text through DOCGEN, #117)", () => {
  const hindi: PdfDocument = {
    title: "मुख्य तथ्य विवरण",
    blocks: [
      { type: "heading", level: 1, text: "मुख्य तथ्य विवरण" },
      {
        type: "paragraph",
        runs: ["ऋण राशि: ₹1,25,000 <b>&", { text: "link", href: "https://example.com/?a=1&b=2" }],
      },
      { type: "table", header: ["शुल्क", "राशि"], rows: [["प्रसंस्करण", "₹500"]] },
      { type: "pageBreak" },
    ],
  };
  const calls: unknown[] = [];
  const docgen = {
    async renderHtml(req: unknown) {
      calls.push(req);
      return {
        file: {
          key: "out/kfs.pdf",
          sha256: "0".repeat(64),
          bytes: 1,
          contentType: "application/pdf",
        },
        format: "pdf",
        pageCount: 2,
        templateVersion: null,
        adapter: "fake",
      };
    },
  } as never;

  it("sends a document with Indic text to DOCGEN, and renders the rest in process", async () => {
    expect(pdfNeedsShaping(hindi)).toBe(true);
    expect(pdfNeedsShaping(DOC)).toBe(false);
    const r = await renderPdf(hindi, { docgen, lang: "hi", outputPrefix: "tnt_a/kfs/" });
    expect(r.via).toBe("docgen");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ format: "pdf", outputPrefix: "tnt_a/kfs/" });
    const inline = await renderPdf(DOC, { created: T, creator: "Infrabyx" });
    expect(
      inline.via === "inline" && inline.pdf.equals(toPdf(DOC, { created: T, creator: "Infrabyx" })),
    ).toBe(true);
    await expect(renderPdf(hindi)).rejects.toMatchObject({ reason: "shaping_required" });
  });

  it("writes a self-contained, escaped HTML page that fetches nothing", () => {
    const html = blocksToHtml(hindi, { lang: "hi" });
    expect(html).toContain('<html lang="hi">');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("&lt;b&gt;&amp;");
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).toContain("thead{display:table-header-group}");
    expect(html).not.toMatch(/<script|<img|<link|@import|url\(/);
    expect(reason(() => blocksToHtml(hindi, { lang: 'hi"><script>' }))).toBe("block_invalid");
  });
});

describe("toPdf PDF/A-2b, tagged (PR-FBX-52, R1-D-248; IPB-06-26)", () => {
  const A = { created: T, creator: "Infrabyx", pdfa: "2b", lang: "en-IN" } as const;
  const pdf = toPdf(DOC, A);
  const s = latin(pdf);
  /** The XMP packet and the offset of its object. */
  const metadata = (b: Buffer) => {
    const t = latin(b);
    const m = /(\d+) 0 obj\n<< \/Type \/Metadata \/Subtype \/XML \/Length (\d+) >>\nstream\n/.exec(
      t,
    )!;
    const start = m.index + m[0].length;
    return { at: m.index, xml: b.subarray(start, start + Number(m[2])).toString("utf8") };
  };

  it("leaves the default output byte for byte as @infrabyx/export 1.8.5 wrote it", () => {
    // SHA-256 of 1.8.5's output on Node 24.22.1 (its zlib): products' PDFs do not change unless
    // they ask for PDF/A.
    expect(sha256Hex(toPdf(DOC, { created: T, creator: "Infrabyx" }))).toBe(
      "26318a0549d7c6744d5eb256284182f1aa7fcbc2f7f9b371122549c5effa138f",
    );
    expect(sha256Hex(toPdf({ blocks: [] }))).toBe(
      "3266f351cdcd1c5b678d1c2808ec6667e95aad0852485301a47b58e8bad8dcc5",
    );
    const arrows: PdfDocument = {
      blocks: [
        { type: "paragraph", runs: ["Filed → Accepted ⇒ Closed ↔ ↩"] },
        { type: "paragraph", runs: [{ text: "Step A→B", bold: true }] },
        {
          type: "numberedList",
          items: [["x"], ["y", { text: "it", italic: true, underline: true }]],
        },
      ],
    };
    expect(sha256Hex(toPdf(arrows, { created: T }))).toBe(
      "e3578323ac29a5d358c42d74dc50f7b7648de9bf0120c06f067528a17b7105d1",
    );
    // `lang` alone changes nothing: it is read in PDF/A mode only.
    expect(
      toPdf(DOC, { created: T, creator: "Infrabyx", lang: "hi" }).equals(
        toPdf(DOC, { created: T, creator: "Infrabyx" }),
      ),
    ).toBe(true);
    expect(s).not.toBe(latin(toPdf(DOC, { created: T, creator: "Infrabyx" })));
  });

  it("writes XMP metadata from the document and `created`, consistent with /Info, never the clock", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2031-07-01T12:34:56Z"));
      expect(toPdf(DOC, A).equals(pdf)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    const { at, xml } = metadata(pdf);
    for (const t of [
      "<pdfaid:part>2</pdfaid:part>",
      "<pdfaid:conformance>B</pdfaid:conformance>",
      "<dc:format>application/pdf</dc:format>",
      '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Report</rdf:li></rdf:Alt></dc:title>',
      "<dc:language><rdf:Bag><rdf:li>en-IN</rdf:li></rdf:Bag></dc:language>",
      "<xmp:CreateDate>2026-11-04T00:00:00Z</xmp:CreateDate>",
      "<xmp:ModifyDate>2026-11-04T00:00:00Z</xmp:ModifyDate>",
      "<xmp:MetadataDate>2026-11-04T00:00:00Z</xmp:MetadataDate>",
      "<xmp:CreatorTool>Infrabyx</xmp:CreatorTool>",
      "<pdf:Producer>Infrabyx export</pdf:Producer>",
    ])
      expect(xml).toContain(t);
    expect(xml).not.toContain("pdfuaid");
    expect(s).toContain(
      "/Producer (Infrabyx export) /CreationDate (D:20261104000000Z) /ModDate (D:20261104000000Z)",
    );
    // The ids are the content digest: the /ID pair and the XMP document and instance ids, all
    // from every byte before the metadata object (which is the last object).
    const id = /\/ID \[<([0-9a-f]{32})> <\1>\]/.exec(s)![1]!;
    expect(sha256Hex(pdf.subarray(0, at)).slice(0, 32)).toBe(id);
    const uuid = id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "uuid:$1-$2-$3-$4-$5");
    expect(xml).toContain(`<xmpMM:DocumentID>${uuid}</xmpMM:DocumentID>`);
    expect(xml).toContain(`<xmpMM:InstanceID>${uuid}</xmpMM:InstanceID>`);
    expect(s.slice(at)).toMatch(/^\d+ 0 obj\n<< \/Type \/Metadata[\s\S]*?endobj\nxref\n/);
    expect(s).toMatch(
      /<< \/Type \/Catalog \/Pages 2 0 R \/Metadata \d+ 0 R \/OutputIntents \[\d+ 0 R\] \/StructTreeRoot \d+ 0 R \/MarkInfo << \/Marked true >> \/Lang \(en-IN\) \/ViewerPreferences << \/DisplayDocTitle true >> >>/,
    );
  });

  it("embeds the bundled sRGB profile as the output intent, every font, and printable links", () => {
    expect(s.startsWith("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")).toBe(true);
    expect(s).toMatch(
      /<< \/Type \/OutputIntent \/S \/GTS_PDFA1 \/OutputConditionIdentifier \(sRGB IEC61966-2\.1\) .*\/DestOutputProfile \d+ 0 R >>/,
    );
    const icc = /<< \/N 3 \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/.exec(s)!;
    const start = icc.index + icc[0].length;
    const profile = inflateSync(pdf.subarray(start, start + Number(icc[1])));
    expect(sha256Hex(profile)).toBe(
      "af4efe28f6d311799865f325ba39184a2e978b113ca74124d60af7de22b105f4",
    );
    expect(profile.toString("latin1", 12, 20)).toBe("mntrRGB ");
    const fonts = (s.match(/\/Subtype \/CIDFontType2/g) ?? []).length;
    expect(fonts).toBeGreaterThan(0);
    expect((s.match(/\/FontFile2/g) ?? []).length).toBe(fonts);
    expect(s).toMatch(
      /\/Subtype \/Link \/Rect \[[^\]]*\] \/Border \[0 0 0\] \/F 4 \/StructParent \d+ \/Contents <FEFF[0-9A-F]+> \/A << \/S \/URI \/URI \(https:\/\/example\.com\/x\) >>/,
    );
    for (const k of ["/JavaScript", "/JS", "/AcroForm", "/EmbeddedFile", "/Launch", "/Encrypt"])
      expect(s).not.toContain(k);
  });

  it("tags every drawing: text in structure elements with MCIDs, rules and repeated headers as artifacts", () => {
    const streams = contents(pdf);
    expect(streams.length).toBeGreaterThanOrEqual(4);
    streams.forEach((c, page) => {
      let open = 0;
      const mcids: number[] = [];
      for (const line of c.split("\n")) {
        const m = /^\/(\w+) << \/MCID (\d+) >> BDC$/.exec(line);
        if (m || line === "/Artifact BMC" || line === "/Artifact << /Type /Pagination >> BDC") {
          expect(open, `page ${page}: nested marked content`).toBe(0);
          open = 1;
          if (m) mcids.push(Number(m[2]));
        } else if (line === "EMC") {
          expect(open).toBe(1);
          open = 0;
        } else expect(open, `page ${page}: untagged ${line}`).toBe(1);
      }
      expect(open).toBe(0);
      expect(mcids).toEqual(mcids.map((_, i) => i));
      // The table header repeated on later pages is a pagination artifact.
      if (page > 0 && page < streams.length - 1)
        expect(c).toContain("/Artifact << /Type /Pagination >> BDC");
    });
    expect(streams[0]).toMatch(/\/H1 << \/MCID 0 >> BDC\nBT /);
    for (const t of [
      "/S /Document",
      "/S /H1",
      "/S /P",
      "/S /Link",
      "/S /L",
      "/S /LI",
      "/S /Lbl",
      "/S /LBody",
      "/S /Table",
      "/S /THead",
      "/S /TBody",
      "/S /TR",
      "/S /TD",
    ])
      expect(s).toContain(t);
    expect(
      (s.match(/\/S \/TH \/P \d+ 0 R \/A << \/O \/Table \/Scope \/Column >>/g) ?? []).length,
    ).toBe(2);
    expect((s.match(/\/S \/TR /g) ?? []).length).toBe(151);
    // One Link element per linked run, holding its text and its annotation (one per word).
    expect((s.match(/\/S \/Link /g) ?? []).length).toBe(1);
    expect((s.match(/<< \/Type \/OBJR \/Pg \d+ 0 R \/Obj \d+ 0 R >>/g) ?? []).length).toBe(2);
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)![1]);
    expect(s).toContain(`/ParentTreeNextKey ${pages + 2}`);
    expect((s.match(/\/StructParents \d+ \/Tabs \/S/g) ?? []).length).toBe(pages);
  });

  it("gives the same bytes twice; another `created` changes only the dates and the ids", () => {
    expect(toPdf(DOC, A).equals(pdf)).toBe(true);
    const other = toPdf(DOC, { ...A, created: new Date("2027-03-31T18:30:00Z") });
    expect(other.length).toBe(pdf.length);
    const allowed: Array<[number, number]> = [];
    for (const re of [
      /\/(CreationDate|ModDate) \(D:\d{14}Z\)/g,
      /<xmp:(Create|Modify|Metadata)Date>[^<]+</g,
      /uuid:[0-9a-f-]{36}/g,
      /\/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]/g,
    ])
      for (const m of s.matchAll(re)) allowed.push([m.index, m.index + m[0].length]);
    let changed = 0;
    for (let i = 0; i < pdf.length; i++)
      if (pdf[i] !== other[i]) {
        changed++;
        expect(
          allowed.some(([a, b]) => i >= a && i < b),
          `byte ${i}`,
        ).toBe(true);
      }
    expect(changed).toBeGreaterThan(0);
    expect(latin(other)).toContain("<xmp:CreateDate>2027-03-31T18:30:00Z</xmp:CreateDate>");
  });

  it("claims PDF/UA-1 on request, for a titled document whose headings skip no level", () => {
    const ua = toPdf(DOC, { ...A, pdfua: true });
    const { xml } = metadata(ua);
    expect(xml).toContain("<pdfuaid:part>1</pdfuaid:part>");
    expect(xml).toContain(
      "<pdfaSchema:namespaceURI>http://www.aiim.org/pdfua/ns/id/</pdfaSchema:namespaceURI>",
    );
    const headed = (title: string | undefined, ...levels: number[]): PdfDocument => ({
      ...(title !== undefined ? { title } : {}),
      blocks: levels.map((level) => ({ type: "heading", level: level as 1, text: "x" })),
    });
    const ok = { pdfa: "2b", pdfua: true } as const;
    expect(reason(() => toPdf(headed("T", 1, 2, 3, 2, 1, 2), ok))).toBeNull();
    expect(reason(() => toPdf(headed("T", 2), ok))).toBe("block_invalid");
    expect(reason(() => toPdf(headed("T", 1, 3), ok))).toBe("block_invalid");
    expect(reason(() => toPdf(headed(undefined, 1), ok))).toBe("block_invalid");
    expect(reason(() => toPdf(headed(" ", 1), ok))).toBe("block_invalid");
  });

  it("refuses options and text that PDF/A cannot honour", () => {
    expect(reason(() => toPdf(DOC, { pdfa: "1b" as never }))).toBe("pdfa_invalid");
    expect(reason(() => toPdf(DOC, { pdfa: "2b", lang: "en_IN" }))).toBe("pdfa_invalid");
    expect(reason(() => toPdf(DOC, { pdfua: true }))).toBe("pdfa_invalid");
    expect(reason(() => toPdf({ title: "a\u0001b", blocks: [] }, { pdfa: "2b" }))).toBe(
      "block_invalid",
    );
    expect(reason(() => toPdf(DOC, { pdfa: "2b", creator: "\uffff" }))).toBe("block_invalid");
    expect(reason(() => toPdf(DOC, { pdfa: "2b", maxBytes: 2_000 }))).toBe("too_large");
    expect(reason(() => toPdf({ blocks: [] }, { pdfa: "2b" }))).toBeNull();
    expect(latin(toPdf({ blocks: [] }, { pdfa: "2b" }))).toContain("/Lang (en)");
  });

  it("renderPdf passes PDF/A through on the in-process path", async () => {
    const r = await renderPdf(DOC, { ...A, format: "pdfa" });
    expect(r.via === "inline" && r.pdf.equals(pdf)).toBe(true);
  });
});
