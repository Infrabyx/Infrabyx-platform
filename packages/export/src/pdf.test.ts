// PDF renderer (PR-LDC-28, R1-D-95): structure, determinism, the WinAnsi limit, links and limits.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
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
