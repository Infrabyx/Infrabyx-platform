// PDF renderer (PR-LDC-28, R1-D-95): structure, determinism, the WinAnsi limit, links and limits.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { OfficeExportError } from "./ooxml.js";
import { toPdf, type PdfDocument } from "./pdf.js";

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
    { type: "paragraph", runs: ["(the end) \\ done"] },
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
  const re = /\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const start = m.index + m[0].length;
    out.push(latin(inflateSync(pdf.subarray(start, start + Number(m[1])))));
  }
  return out;
}

/** The shown strings of a content stream, joined, still escaped as in the PDF. */
const shown = (c: string) => [...c.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]).join("");

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
    expect(s).toMatch(/\/Title \(Report\)/);
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
    expect(shown(streams[0]!)).toContain("\\2001,000.00 \\226 \\223ok\\224");
    // Parentheses and backslashes are escaped; the page break starts the last page.
    expect(shown(streams.at(-1)!)).toBe("\\(the end\\) \\\\ done");
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

  it("refuses characters outside WinAnsi instead of replacing them", () => {
    expect(reason(() => toPdf({ blocks: [{ type: "paragraph", runs: ["₹ 500"] }] }))).toBe(
      "char_unsupported",
    );
    expect(reason(() => toPdf({ blocks: [{ type: "heading", level: 1, text: "नमस्ते" }] }))).toBe(
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
