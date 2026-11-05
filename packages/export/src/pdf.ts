// PDF renderer (PR-LDC-28, wave 7; dependency review R1-D-95): a PDF 1.7 document (ISO 32000-1)
// from the same block model as `toDocx`, written here with no dependency. Text is set in the
// standard Helvetica fonts (Helvetica, -Bold, -Oblique, -BoldOblique) with WinAnsiEncoding, so no
// font is embedded and the text is limited to the WinAnsi set (Latin-1 plus the typographic
// characters of 0x80 to 0x9F, such as the euro sign, dashes, curly quotes and the bullet); any
// other character is refused (`char_unsupported`), never replaced. Embedded Unicode fonts (for
// Indic scripts or the rupee sign) need a font-shaping dependency and a new review. The output
// has no JavaScript, no forms, no attachments, no external content and no actions other than the
// https link annotations the caller names. A4 portrait, 72 pt margins, content streams Flate
// compressed. The same blocks and `created` time always give the same bytes.
import { deflateSync } from "node:zlib";
import { sha256Hex } from "@infrabyx/crypto";
import {
  DOCX_MAX_BLOCKS,
  DOCX_MAX_LINKS,
  DOCX_MAX_TABLE_COLUMNS,
  assertHttpsUrl,
  type DocxBlock,
  type DocxDocument,
  type DocxListItem,
  type DocxRun,
} from "./docx.js";
import { OfficeExportError, createdOf, maxBytesOf, type OfficeProperties } from "./ooxml.js";

/** The block model is the DOCX one. */
export type PdfBlock = DocxBlock;
export type PdfDocument = DocxDocument;
/** Options: `creator`, a fixed `created` time and the `maxBytes` cap (default 64 MiB). */
export type PdfOptions = Omit<OfficeProperties, "title">;

export const PDF_MAX_PAGES = 10_000;

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 72;
const TEXT_W = PAGE_W - 2 * MARGIN;
const BODY = 10.5;
const LEAD = 1.35;
const HEADING_SIZES = [20, 16, 14, 12, 12, 12] as const;
const INDENT = 18;
const CELL_PAD = 4;
const FONTS = [
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
] as const;

// Unicode to WinAnsi for 0x80 to 0x9F (PDF 32000-1 Annex D); 0xA0 to 0xFF are Latin-1 itself.
const WIN_ANSI_HIGH: Readonly<Record<number, number>> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

// Helvetica advance widths (1/1000 em) for 0x20 to 0x7E, from the standard AFM. Other codes take
// 0.6 em, and bold text is measured 8% wider: line breaks may come early, never late.
const ASCII_W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

interface Style {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  href?: string;
}
interface Piece {
  bytes: number[];
  style: Style;
  width: number;
}

function bad(why: string): OfficeExportError {
  return new OfficeExportError("block_invalid", why);
}

/** WinAnsi bytes of `s`; tabs become a space; anything else outside WinAnsi is refused. */
function winAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp === 9) out.push(32);
    else if (cp >= 32 && cp <= 126) out.push(cp);
    else if (cp >= 0xa0 && cp <= 0xff) out.push(cp);
    else if (WIN_ANSI_HIGH[cp] !== undefined) out.push(WIN_ANSI_HIGH[cp]!);
    else
      throw new OfficeExportError(
        "char_unsupported",
        `U+${cp.toString(16).toUpperCase().padStart(4, "0")} is outside the PDF's WinAnsi character set`,
      );
  }
  return out;
}

function widthOf(bytes: readonly number[], size: number, bold: boolean): number {
  let w = 0;
  for (const b of bytes) w += b >= 32 && b <= 126 ? ASCII_W[b - 32]! : 600;
  return (w * size * (bold ? 1.08 : 1)) / 1000;
}

function fontOf(s: Style): number {
  return (s.bold ? 1 : 0) + (s.italic ? 2 : 0);
}

/** A PDF literal string of WinAnsi bytes. */
function lit(bytes: readonly number[]): string {
  let out = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b >= 32 && b <= 126) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, "0")}`;
  }
  return `${out})`;
}

const n = (x: number) => (Math.round(x * 100) / 100).toString();

interface Page {
  ops: string[];
  links: Array<{ rect: [number, number, number, number]; href: string }>;
}

class Layout {
  readonly pages: Page[] = [];
  private y = 0;
  private links = 0;
  private bytes = 0;
  constructor(private readonly max: number) {
    this.newPage();
  }
  private get page(): Page {
    return this.pages.at(-1)!;
  }
  private op(s: string): void {
    this.bytes += s.length + 1;
    if (this.bytes > this.max)
      throw new OfficeExportError("too_large", `the PDF would exceed ${this.max} bytes`);
    this.page.ops.push(s);
  }
  newPage(): void {
    if (this.pages.length >= PDF_MAX_PAGES)
      throw new OfficeExportError("too_many_pages", `at most ${PDF_MAX_PAGES} pages`);
    this.pages.push({ ops: [], links: [] });
    this.y = PAGE_H - MARGIN;
  }
  get atTop(): boolean {
    return this.y === PAGE_H - MARGIN;
  }
  /** Start a new page unless `h` points still fit. */
  ensure(h: number): void {
    if (this.y - h < MARGIN && !this.atTop) this.newPage();
  }
  gap(h: number): void {
    this.y -= h;
  }
  room(): number {
    return this.y - MARGIN;
  }

  /** Lay out runs from `x` within `width`; returns the height used. */
  runs(pieces: Piece[], x: number, width: number, size: number, prefix?: Piece): void {
    const lines = wrap(pieces, width, size);
    const lead = size * LEAD;
    lines.forEach((line, i) => {
      this.ensure(lead);
      this.y -= lead;
      if (i === 0 && prefix) this.draw(prefix, x - INDENT * 0.75, this.y + lead - size * 1.1, size);
      let cx = x;
      for (const p of line) {
        this.draw(p, cx, this.y + lead - size * 1.1, size);
        cx += p.width;
      }
    });
  }

  /** One piece at a baseline. */
  draw(p: Piece, x: number, base: number, size: number): void {
    if (!p.bytes.length) return;
    this.op(
      `BT /F${fontOf(p.style) + 1} ${n(size)} Tf ${n(x)} ${n(base)} Td ${lit(p.bytes)} Tj ET`,
    );
    if (p.style.underline || p.style.href)
      this.op(
        `${n(size / 18)} w ${n(x)} ${n(base - 1.5)} m ${n(x + p.width)} ${n(base - 1.5)} l S`,
      );
    if (p.style.href) {
      if (++this.links > DOCX_MAX_LINKS)
        throw new OfficeExportError("too_many_links", `at most ${DOCX_MAX_LINKS} hyperlinks`);
      this.page.links.push({ rect: [x, base - 3, x + p.width, base + size], href: p.style.href });
    }
  }

  /** A table cell grid: lines of each cell are laid out by the caller's measure. */
  table(header: readonly string[], rows: ReadonlyArray<readonly string[]>, size: number): void {
    const cols = header.length;
    const cw = TEXT_W / cols;
    const lead = size * LEAD;
    const cellLines = (row: readonly string[], bold: boolean) =>
      row.map((c) => wrap(piecesOf([{ text: c, bold }]), cw - 2 * CELL_PAD, size));
    const head = cellLines(header, true);
    const heightOf = (cells: Piece[][][]) =>
      Math.max(1, ...cells.map((l) => l.length)) * lead + 2 * CELL_PAD;
    const usable = PAGE_H - 2 * MARGIN;
    const drawRow = (cells: Piece[][][]) => {
      const h = heightOf(cells);
      const top = this.y;
      cells.forEach((lines, ci) => {
        const x0 = MARGIN + ci * cw;
        this.op(`0.5 w ${n(x0)} ${n(top - h)} ${n(cw)} ${n(h)} re S`);
        lines.forEach((line, li) => {
          let cx = x0 + CELL_PAD;
          const base = top - CELL_PAD - li * lead - size * 1.05;
          for (const p of line) {
            this.draw(p, cx, base, size);
            cx += p.width;
          }
        });
      });
      this.y -= h;
    };
    if (heightOf(head) * 2 > usable) throw bad("a table header is too tall for a page");
    this.ensure(heightOf(head) + (rows.length ? heightOf(cellLines(rows[0]!, false)) : 0));
    drawRow(head);
    for (const r of rows) {
      const cells = cellLines(r, false);
      const h = heightOf(cells);
      if (h + heightOf(head) > usable) throw bad("a table row is too tall for a page");
      if (h > this.room()) {
        this.newPage();
        drawRow(head);
      }
      drawRow(cells);
    }
  }
}

/** Split runs into words (each keeps its trailing space) with their style and width. */
function piecesOf(runs: readonly DocxRun[], size = BODY): Piece[] {
  const out: Piece[] = [];
  for (const r of runs) {
    const run = typeof r === "string" ? { text: r } : r;
    if (typeof run !== "object" || run === null || typeof run.text !== "string")
      throw bad("a run must be text or { text }");
    const style: Style = {
      bold: run.bold === true,
      italic: run.italic === true,
      underline: run.underline === true,
      ...(run.href !== undefined ? { href: assertHttpsUrl(run.href) } : {}),
    };
    // Line breaks in a run become spaces: a paragraph is one flow of text.
    for (const word of run.text.replace(/\r\n?|\n/g, " ").split(/(?<= )/)) {
      if (!word) continue;
      const bytes = winAnsi(word);
      out.push({ bytes, style, width: widthOf(bytes, size, style.bold) });
    }
  }
  return out;
}

/** Greedy line breaking; a word wider than the line is broken by characters. */
function wrap(pieces: Piece[], width: number, size: number): Piece[][] {
  const lines: Piece[][] = [[]];
  let used = 0;
  const push = (p: Piece) => {
    const trimmed = p.bytes.at(-1) === 32 ? p.bytes.slice(0, -1) : p.bytes;
    const visible = widthOf(trimmed, size, p.style.bold);
    if (used > 0 && used + visible > width) {
      lines.push([]);
      used = 0;
    }
    if (visible > width) {
      // Break an over-long word into chunks that fit.
      let chunk: number[] = [];
      for (const b of p.bytes) {
        if (chunk.length && widthOf([...chunk, b], size, p.style.bold) > width) {
          const w = widthOf(chunk, size, p.style.bold);
          lines.at(-1)!.push({ bytes: chunk, style: p.style, width: w });
          lines.push([]);
          used = 0;
          chunk = [];
        }
        chunk.push(b);
      }
      const w = widthOf(chunk, size, p.style.bold);
      lines.at(-1)!.push({ bytes: chunk, style: p.style, width: w });
      used = w;
      return;
    }
    const w = widthOf(p.bytes, size, p.style.bold);
    lines.at(-1)!.push({ ...p, width: w });
    used += w;
  };
  for (const p of pieces) push(p);
  return lines.filter((l, i) => l.length || i === 0);
}

function listItems(
  layout: Layout,
  items: readonly DocxListItem[],
  numbered: boolean,
  level: number,
): void {
  items.forEach((item, i) => {
    const runs = Array.isArray(item) ? item : (item as { runs: readonly DocxRun[] }).runs;
    const nested = Array.isArray(item) ? undefined : (item as { items?: unknown }).items;
    if (!Array.isArray(runs)) throw bad("a list item needs runs");
    const marker = numbered ? `${i + 1}.` : level === 0 ? "•" : "-";
    const bytes = winAnsi(marker);
    const prefix: Piece = {
      bytes,
      style: { bold: false, italic: false, underline: false },
      width: widthOf(bytes, BODY, false),
    };
    const x = MARGIN + INDENT * (level + 1);
    layout.runs(piecesOf(runs), x, TEXT_W - INDENT * (level + 1), BODY, prefix);
    if (nested !== undefined) {
      if (level > 0) throw bad("lists nest one level only");
      if (!Array.isArray(nested)) throw bad("nested items must be an array");
      listItems(layout, nested as DocxListItem[], numbered, level + 1);
    }
  });
}

function block(layout: Layout, b: PdfBlock): void {
  if (typeof b !== "object" || b === null) throw bad("a block must be an object");
  switch (b.type) {
    case "heading": {
      if (![1, 2, 3, 4, 5, 6].includes(b.level)) throw bad("a heading level is 1 to 6");
      if (typeof b.text !== "string") throw bad("a heading needs text");
      const size = HEADING_SIZES[b.level - 1]!;
      layout.ensure(size * LEAD * 2);
      if (!layout.atTop) layout.gap(size * 0.5);
      layout.runs(piecesOf([{ text: b.text, bold: true }], size), MARGIN, TEXT_W, size);
      layout.gap(size * 0.25);
      return;
    }
    case "paragraph":
      if (!Array.isArray(b.runs)) throw bad("a paragraph needs runs");
      layout.runs(piecesOf(b.runs), MARGIN, TEXT_W, BODY);
      layout.gap(BODY * 0.5);
      return;
    case "bulletList":
    case "numberedList":
      if (!Array.isArray(b.items)) throw bad("a list needs items");
      listItems(layout, b.items, b.type === "numberedList", 0);
      layout.gap(BODY * 0.5);
      return;
    case "table": {
      if (!Array.isArray(b.header) || !b.header.length) throw bad("a table needs a header row");
      if (b.header.length > DOCX_MAX_TABLE_COLUMNS)
        throw bad(`a table has at most ${DOCX_MAX_TABLE_COLUMNS} columns`);
      if (!Array.isArray(b.rows)) throw bad("a table needs rows");
      for (const r of b.rows)
        if (!Array.isArray(r) || r.length !== b.header.length)
          throw bad("every table row has as many cells as the header");
      for (const c of [...b.header, ...b.rows.flat()])
        if (typeof c !== "string") throw bad("table cells are text");
      layout.table(b.header, b.rows, 9);
      layout.gap(BODY * 0.5);
      return;
    }
    case "pageBreak":
      if (!layout.atTop) layout.newPage();
      return;
    default:
      throw bad(`unknown block type ${JSON.stringify((b as { type?: unknown }).type)}`);
  }
}

/** A PDF date, D:YYYYMMDDHHmmSSZ. */
function pdfDate(d: Date): string {
  return `D:${d.toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`;
}

/** Render `doc` as a PDF file. */
export function toPdf(doc: PdfDocument, o: PdfOptions = {}): Buffer {
  if (typeof doc !== "object" || doc === null || !Array.isArray(doc.blocks))
    throw bad("a document needs a blocks array");
  if (doc.blocks.length > DOCX_MAX_BLOCKS)
    throw new OfficeExportError("too_many_blocks", `at most ${DOCX_MAX_BLOCKS} blocks`);
  if (doc.title !== undefined && typeof doc.title !== "string") throw bad("the title must be text");
  if (o.creator !== undefined && typeof o.creator !== "string")
    throw bad("the creator must be text");
  const created = createdOf(o);
  const max = maxBytesOf(o);
  const layout = new Layout(max);
  for (const b of doc.blocks) block(layout, b);

  // Objects: 1 catalog, 2 pages, 3 to 6 fonts, 7 info, then per page: page, contents, links.
  const objs: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objs.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    return objs.length;
  };
  add(""); // catalog, filled below
  add(""); // pages, filled below
  for (const f of FONTS)
    add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`);
  const info: string[] = [`/Producer (Infrabyx export)`, `/CreationDate (${pdfDate(created)})`];
  if (doc.title !== undefined) info.push(`/Title ${lit(winAnsi(doc.title))}`);
  if (o.creator !== undefined) info.push(`/Creator ${lit(winAnsi(o.creator))}`);
  const infoId = add(`<< ${info.join(" ")} >>`);
  const fonts = FONTS.map((_, i) => `/F${i + 1} ${i + 3} 0 R`).join(" ");
  const kids: number[] = [];
  for (const p of layout.pages) {
    const stream = deflateSync(Buffer.from(p.ops.join("\n"), "latin1"), { level: 9 });
    const pageId = objs.length + 1;
    const contentsId = pageId + 1;
    const linkIds = p.links.map((_, i) => contentsId + 1 + i);
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] ` +
        `/Resources << /Font << ${fonts} >> >> /Contents ${contentsId} 0 R` +
        (linkIds.length ? ` /Annots [${linkIds.map((id) => `${id} 0 R`).join(" ")}]` : "") +
        " >>",
    );
    add(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
        stream,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
    for (const l of p.links)
      add(
        `<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(n).join(" ")}] /Border [0 0 0] ` +
          `/A << /S /URI /URI ${lit(winAnsi(l.href))} >> >>`,
      );
    kids.push(pageId);
  }
  objs[0] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1");
  objs[1] = Buffer.from(
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`,
    "latin1",
  );

  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = parts[0]!.length;
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    parts.push(chunk);
    offset += chunk.length;
  });
  const bodyHash = sha256Hex(Buffer.concat(parts)).slice(0, 32);
  const xref =
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((x) => `${String(x).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoId} 0 R ` +
    `/ID [<${bodyHash}> <${bodyHash}>] >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  const out = Buffer.concat(parts);
  if (out.length > max)
    throw new OfficeExportError("too_large", `the PDF would exceed ${max} bytes`);
  return out;
}
