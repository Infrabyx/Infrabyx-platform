// PDF renderer (PR-LDC-28; dependency review R1-D-95; OWNER-QUESTIONS #117, R1-D-96): a PDF 1.7
// document (ISO 32000-1) from the same block model as `toDocx`, written here with no dependency.
// Text is set in Noto Sans (Regular, Bold, Italic, Bold Italic; SIL OFL 1.1), subset once and
// shipped with the package (`fonts/FONTS.md`), embedded whole as CIDFontType2 fonts with
// Identity-H encoding and a ToUnicode map, so text stays searchable and copyable. The fonts cover
// Latin (Basic, Latin-1, Extended-A), the usual punctuation, the euro and the rupee sign (U+20B9).
// A character the style's font lacks falls back, glyph by glyph, to Noto Sans Math's Arrows block
// (U+2190 to U+21FF; PR-LDC-36, R1-D-129), embedded only when a document uses it, so a document
// without arrows keeps its bytes.
// They carry no shaping tables: text in an Indic script is refused with `shaping_required` (send
// that document through DOCGEN, `renderPdf`, guide §7ay), and any other character the fonts lack
// with `char_unsupported`; nothing is ever replaced. The output has no JavaScript, no forms, no
// attachments, no external content and no actions other than the https link annotations the
// caller names. A4 portrait, 72 pt margins, streams Flate compressed. The same blocks and
// `created` time always give the same bytes.
// PDF/A-2b (PR-FBX-52, R1-D-248), opt-in with `pdfa: "2b"`: an XMP metadata stream on the
// catalog (pdfaid part 2, conformance B; dates from `created`, never the clock; document and
// instance ids from the content digest that also gives /ID), an sRGB output intent with an
// embedded ICC profile (`icc/ICC.md`, CC0), /ModDate equal to /CreationDate, printable link
// annotations, and a tagged structure (IPB-06-26): /Lang, /MarkInfo, a structure tree of headings,
// paragraphs, lists, tables and links in reading order, marked content with MCIDs, rules and the
// repeated table headers as artifacts. `pdfua: true` adds the PDF/UA-1 identification for
// documents whose title and heading order allow it. Without `pdfa` the output is unchanged.
import { readFileSync } from "node:fs";
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
import {
  OfficeExportError,
  createdOf,
  dropInvalidXml,
  maxBytesOf,
  xmlText,
  type OfficeProperties,
} from "./ooxml.js";
import { bundledFont, type TrueTypeFont } from "./ttf.js";

/** The block model is the DOCX one. */
export type PdfBlock = DocxBlock;
export type PdfDocument = DocxDocument;
/** Options: `creator`, a fixed `created` time, the `maxBytes` cap (default 64 MiB), PDF/A. */
export interface PdfOptions extends Omit<OfficeProperties, "title"> {
  /**
   * `"2b"`: write PDF/A-2b (ISO 19005-2, level B) with a tagged structure (PR-FBX-52). The same
   * blocks, options and `created` time still give the same bytes. Omitted: plain PDF 1.7, byte for
   * byte as before. Any other value is refused (`pdfa_invalid`).
   */
  pdfa?: "2b";
  /**
   * The document's language (BCP 47, e.g. `en-IN`) for /Lang and `dc:language`; read only with
   * `pdfa` (default `en`; not a tag: `pdfa_invalid`).
   */
  lang?: string;
  /**
   * Also claim PDF/UA-1 (ISO 14289-1) in the XMP. Needs `pdfa` (`pdfa_invalid` otherwise), a
   * title, and headings that start at level 1 and never skip a level (`block_invalid` otherwise).
   */
  pdfua?: boolean;
}

/** A BCP 47 language tag, as /Lang and `lang` take it. */
export const PDF_LANG_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

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
const STYLES = ["Regular", "Bold", "Italic", "BoldItalic"] as const;

/** Unicode blocks of the Indic scripts, which need shaping (DOCGEN). */
const INDIC: ReadonlyArray<readonly [number, number]> = [
  [0x0900, 0x0dff],
  [0x1cd0, 0x1cff],
  [0xa830, 0xa83f],
  [0xa8e0, 0xa8ff],
  [0x11000, 0x1107f],
];
export function needsShaping(cp: number): boolean {
  return INDIC.some(([a, b]) => cp >= a && cp <= b);
}

interface Style {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  href?: string;
}
interface Piece {
  /** Glyph ids, the font each is in (an index of `fontAt`) and the code point each one shows. */
  gids: number[];
  fonts: number[];
  cps: number[];
  style: Style;
  width: number;
}

function bad(why: string): OfficeExportError {
  return new OfficeExportError("block_invalid", why);
}

function fontOf(s: Style): number {
  return (s.bold ? 1 : 0) + (s.italic ? 2 : 0);
}
/** The fallback font's index: Noto Sans Math, the Arrows block only (PR-LDC-36). */
const FONT_MATH = STYLES.length;
const FALLBACK_FIRST = 0x2190;
const FALLBACK_LAST = 0x21ff;
/** Font `i`: the four styles, then the fallback. */
const fontAt = (i: number): TrueTypeFont => bundledFont(i === FONT_MATH ? "Math" : STYLES[i]!);

/** Glyph ids for `text` in the style's font, arrows from the fallback; refuses the rest. */
function glyphs(text: string, style: Style): { gids: number[]; fonts: number[]; cps: number[] } {
  const own = fontOf(style);
  const f = fontAt(own);
  const gids: number[] = [];
  const fonts: number[] = [];
  const cps: number[] = [];
  for (const ch of text) {
    let cp = ch.codePointAt(0)!;
    if (cp === 9) cp = 32;
    let font = own;
    let gid = f.cmap.get(cp);
    if (gid === undefined && cp >= FALLBACK_FIRST && cp <= FALLBACK_LAST) {
      font = FONT_MATH;
      gid = fontAt(FONT_MATH).cmap.get(cp);
    }
    if (gid === undefined) {
      const hex = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
      if (needsShaping(cp))
        throw new OfficeExportError(
          "shaping_required",
          `${hex} is in an Indic script, which needs shaping: render this document through DOCGEN (renderPdf)`,
        );
      throw new OfficeExportError("char_unsupported", `${hex} is not in the PDF's fonts`);
    }
    gids.push(gid);
    fonts.push(font);
    cps.push(cp);
  }
  return { gids, fonts, cps };
}

/** The width of glyphs, each in its own font. */
function widthOf(gids: readonly number[], fonts: readonly number[], size: number): number {
  let w = 0;
  gids.forEach((g, i) => {
    const f = fontAt(fonts[i]!);
    w += (f.advance(g) * size) / f.unitsPerEm;
  });
  return w;
}

const hex4 = (g: number) => g.toString(16).toUpperCase().padStart(4, "0");
/** A PDF literal string of ASCII text (URIs). */
function asciiLit(s: string): string {
  if (!/^[\x20-\x7e]*$/.test(s)) throw bad("a link must be ASCII after URL encoding");
  return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}
/** A PDF text string in UTF-16BE (document information). */
function textString(s: string): string {
  return `<FEFF${Buffer.from(s, "utf16le").swap16().toString("hex").toUpperCase()}>`;
}

const n = (x: number) => (Math.round(x * 100) / 100).toString();

/**
 * A structure element of the tagged PDF/A (IPB-06-26). Its kids are elements, marked content (a
 * page index and an MCID) and link annotations (a page index and the link's index on that page).
 */
interface Elem {
  type: string;
  /** Extra entries of the element's dictionary (e.g. the TH scope attribute). */
  attrs?: string;
  kids: Array<Elem | { page: number; mcid: number } | { page: number; link: number }>;
}
/** Where drawn content belongs: a structure element, or an artifact (a table header repeated on a
 * later page, or a rule: an underline or a cell border). */
type Mark = Elem | "pagination" | "layout";
const isElem = (k: Elem["kids"][number]): k is Elem => "type" in k;

interface Page {
  ops: string[];
  links: Array<{ rect: [number, number, number, number]; href: string }>;
  /** The structure element of each MCID on the page (tagged only). */
  mcids: Elem[];
  /** The marked-content sequence open on the page (tagged only). */
  open?: Mark | undefined;
}

class Layout {
  readonly pages: Page[] = [];
  private y = 0;
  private links = 0;
  private bytes = 0;
  /** Glyphs drawn per font (`fontAt` index), with the code point each one shows (ToUnicode). */
  readonly used = new Map<number, Map<number, number>>();
  /** The structure tree (written only when `tagged`), the open elements, and an override of
   * where text goes (a list label, a repeated table header). */
  readonly root: Elem = { type: "Document", kids: [] };
  private readonly stack: Elem[] = [this.root];
  private override: Mark | undefined;
  private lastLink: { style: Style; elem: Elem; parent: Elem } | undefined;
  constructor(
    private readonly max: number,
    private readonly tagged = false,
  ) {
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
  /** An operation inside the marked content of `m` when tagged; as it is otherwise. */
  private mark(m: Mark, s: string): void {
    if (this.tagged && this.page.open !== m) {
      this.close();
      if (m === "layout") this.op("/Artifact BMC");
      else if (m === "pagination") this.op("/Artifact << /Type /Pagination >> BDC");
      else {
        const mcid = this.page.mcids.length;
        this.page.mcids.push(m);
        m.kids.push({ page: this.pages.length - 1, mcid });
        this.op(`/${m.type} << /MCID ${mcid} >> BDC`);
      }
      this.page.open = m;
    }
    this.op(s);
  }
  /** End the page's open marked-content sequence (tagged only). */
  close(): void {
    if (this.page.open === undefined) return;
    this.op("EMC");
    this.page.open = undefined;
  }
  private get cur(): Elem {
    return this.stack.at(-1)!;
  }
  /** Open a structure element inside the current one. */
  begin(type: string, attrs = ""): Elem {
    const e: Elem = { type, kids: [], ...(attrs ? { attrs } : {}) };
    this.cur.kids.push(e);
    this.stack.push(e);
    return e;
  }
  end(): void {
    this.stack.pop();
  }
  /** Run `f` with the text it draws going to `m` instead of the current element. */
  as(m: Mark | undefined, f: () => void): void {
    const saved = this.override;
    if (m !== undefined) this.override = m;
    f();
    this.override = saved;
  }
  /** The Link element of a run: one per run, inside the element its text goes to. */
  private linkFor(style: Style, parent: Elem): Elem {
    const l = this.lastLink;
    if (l && l.style === style && l.parent === parent && parent.kids.at(-1) === l.elem)
      return l.elem;
    const elem: Elem = { type: "Link", kids: [] };
    parent.kids.push(elem);
    this.lastLink = { style, elem, parent };
    return elem;
  }
  newPage(): void {
    if (this.pages.length >= PDF_MAX_PAGES)
      throw new OfficeExportError("too_many_pages", `at most ${PDF_MAX_PAGES} pages`);
    if (this.pages.length) this.close();
    this.pages.push({ ops: [], links: [], mcids: [] });
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
  runs(
    pieces: Piece[],
    x: number,
    width: number,
    size: number,
    prefix?: Piece,
    label?: Elem,
  ): void {
    const lines = wrap(pieces, width, size);
    const lead = size * LEAD;
    lines.forEach((line, i) => {
      this.ensure(lead);
      this.y -= lead;
      if (i === 0 && prefix)
        this.as(label, () =>
          this.draw(prefix, x - INDENT * 0.75, this.y + lead - size * 1.1, size),
        );
      let cx = x;
      for (const p of line) {
        this.draw(p, cx, this.y + lead - size * 1.1, size);
        cx += p.width;
      }
    });
  }

  /** One piece at a baseline, one text object per run of glyphs in the same font. */
  draw(p: Piece, x: number, base: number, size: number): void {
    if (!p.gids.length) return;
    let target = this.override ?? this.cur;
    const link =
      p.style.href !== undefined && typeof target === "object"
        ? this.linkFor(p.style, target)
        : undefined;
    if (link) target = link;
    let cx = x;
    for (let i = 0; i < p.gids.length;) {
      const f = p.fonts[i]!;
      let j = i;
      while (j < p.gids.length && p.fonts[j] === f) j++;
      const gids = p.gids.slice(i, j);
      const used = this.used.get(f) ?? new Map<number, number>();
      this.used.set(f, used);
      gids.forEach((g, k) => used.set(g, p.cps[i + k]!));
      this.mark(
        target,
        `BT /F${f + 1} ${n(size)} Tf ${n(cx)} ${n(base)} Td <${gids.map(hex4).join("")}> Tj ET`,
      );
      cx += widthOf(gids, p.fonts.slice(i, j), size);
      i = j;
    }
    if (p.style.underline || p.style.href)
      this.mark(
        "layout",
        `${n(size / 18)} w ${n(x)} ${n(base - 1.5)} m ${n(x + p.width)} ${n(base - 1.5)} l S`,
      );
    if (p.style.href) {
      if (++this.links > DOCX_MAX_LINKS)
        throw new OfficeExportError("too_many_links", `at most ${DOCX_MAX_LINKS} hyperlinks`);
      this.page.links.push({ rect: [x, base - 3, x + p.width, base + size], href: p.style.href });
      link?.kids.push({ page: this.pages.length - 1, link: this.page.links.length - 1 });
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
    // `cell` is TH or TD; omitted for the header repeated on a later page (an artifact).
    const drawRow = (cells: Piece[][][], cell?: "TH" | "TD") => {
      const h = heightOf(cells);
      const top = this.y;
      if (cell) this.begin("TR");
      cells.forEach((lines, ci) => {
        const x0 = MARGIN + ci * cw;
        this.mark("layout", `0.5 w ${n(x0)} ${n(top - h)} ${n(cw)} ${n(h)} re S`);
        if (cell) this.begin(cell, cell === "TH" ? "/A << /O /Table /Scope /Column >>" : "");
        this.as(cell ? undefined : "pagination", () =>
          lines.forEach((line, li) => {
            let cx = x0 + CELL_PAD;
            const base = top - CELL_PAD - li * lead - size * 1.05;
            for (const p of line) {
              this.draw(p, cx, base, size);
              cx += p.width;
            }
          }),
        );
        if (cell) this.end();
      });
      if (cell) this.end();
      this.y -= h;
    };
    if (heightOf(head) * 2 > usable) throw bad("a table header is too tall for a page");
    this.ensure(heightOf(head) + (rows.length ? heightOf(cellLines(rows[0]!, false)) : 0));
    this.begin("THead");
    drawRow(head, "TH");
    this.end();
    this.begin("TBody");
    for (const r of rows) {
      const cells = cellLines(r, false);
      const h = heightOf(cells);
      if (h + heightOf(head) > usable) throw bad("a table row is too tall for a page");
      if (h > this.room()) {
        this.newPage();
        drawRow(head);
      }
      drawRow(cells, "TD");
    }
    this.end();
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
      const g = glyphs(word, style);
      out.push({ ...g, style, width: widthOf(g.gids, g.fonts, size) });
    }
  }
  return out;
}

/** Greedy line breaking; a word wider than the line is broken by characters. */
function wrap(pieces: Piece[], width: number, size: number): Piece[][] {
  const lines: Piece[][] = [[]];
  let used = 0;
  const push = (p: Piece) => {
    const last = p.cps.length - (p.cps.at(-1) === 32 ? 1 : 0);
    const visible = widthOf(p.gids.slice(0, last), p.fonts, size);
    if (used > 0 && used + visible > width) {
      lines.push([]);
      used = 0;
    }
    if (visible > width) {
      // Break an over-long word into chunks that fit.
      let chunk: Piece = { gids: [], fonts: [], cps: [], style: p.style, width: 0 };
      p.gids.forEach((g, i) => {
        const next = widthOf([...chunk.gids, g], [...chunk.fonts, p.fonts[i]!], size);
        if (chunk.gids.length && next > width) {
          lines.at(-1)!.push(chunk);
          lines.push([]);
          used = 0;
          chunk = { gids: [], fonts: [], cps: [], style: p.style, width: 0 };
        }
        chunk.gids.push(g);
        chunk.fonts.push(p.fonts[i]!);
        chunk.cps.push(p.cps[i]!);
        chunk.width = widthOf(chunk.gids, chunk.fonts, size);
      });
      lines.at(-1)!.push(chunk);
      used = chunk.width;
      return;
    }
    const w = widthOf(p.gids, p.fonts, size);
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
  layout.begin("L", numbered ? "/A << /O /List /ListNumbering /Decimal >>" : "");
  items.forEach((item, i) => {
    const runs = Array.isArray(item) ? item : (item as { runs: readonly DocxRun[] }).runs;
    const nested = Array.isArray(item) ? undefined : (item as { items?: unknown }).items;
    if (!Array.isArray(runs)) throw bad("a list item needs runs");
    const marker = numbered ? `${i + 1}.` : level === 0 ? "•" : "-";
    const plain: Style = { bold: false, italic: false, underline: false };
    const g = glyphs(marker, plain);
    const prefix: Piece = { ...g, style: plain, width: widthOf(g.gids, g.fonts, BODY) };
    const x = MARGIN + INDENT * (level + 1);
    layout.begin("LI");
    const label = layout.begin("Lbl");
    layout.end();
    layout.begin("LBody");
    layout.runs(piecesOf(runs), x, TEXT_W - INDENT * (level + 1), BODY, prefix, label);
    if (nested !== undefined) {
      if (level > 0) throw bad("lists nest one level only");
      if (!Array.isArray(nested)) throw bad("nested items must be an array");
      listItems(layout, nested as DocxListItem[], numbered, level + 1);
    }
    layout.end();
    layout.end();
  });
  layout.end();
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
      layout.begin(`H${b.level}`);
      layout.runs(piecesOf([{ text: b.text, bold: true }], size), MARGIN, TEXT_W, size);
      layout.end();
      layout.gap(size * 0.25);
      return;
    }
    case "paragraph":
      if (!Array.isArray(b.runs)) throw bad("a paragraph needs runs");
      layout.begin("P");
      layout.runs(piecesOf(b.runs), MARGIN, TEXT_W, BODY);
      layout.end();
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
      layout.begin("Table");
      layout.table(b.header, b.rows, 9);
      layout.end();
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

/** A Flate-compressed stream object. */
function stream(dict: string, data: Buffer): Buffer {
  const z = deflateSync(data, { level: 9 });
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
    z,
    Buffer.from("\nendstream", "latin1"),
  ]);
}

/**
 * Embed a bundled font whole as a Type0 font over a CIDFontType2 (Identity-H, CID = glyph id),
 * with the widths and a ToUnicode map of the glyphs used; returns the Type0 font's object number.
 */
function embedFont(
  add: (body: Buffer | string) => number,
  f: TrueTypeFont,
  used: ReadonlyMap<number, number>,
): number {
  const k = 1000 / f.unitsPerEm;
  const gids = [...used.keys()].sort((a, b) => a - b);
  const file = add(stream(`/Length1 ${f.bytes.length}`, f.bytes));
  const flags = 32 + (f.italicAngle !== 0 ? 64 : 0);
  const descriptor = add(
    `<< /Type /FontDescriptor /FontName /${f.postScriptName} /Flags ${flags} ` +
      `/FontBBox [${f.bbox.map((v) => Math.round(v * k)).join(" ")}] /ItalicAngle ${f.italicAngle} ` +
      `/Ascent ${Math.round(f.ascent * k)} /Descent ${Math.round(f.descent * k)} ` +
      `/CapHeight ${Math.round(f.capHeight * k)} /StemV 80 /FontFile2 ${file} 0 R >>`,
  );
  const widths = gids.map((g) => `${g} [${Math.round(f.advance(g) * k)}]`).join(" ");
  const cid = add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.postScriptName} ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${descriptor} 0 R /CIDToGIDMap /Identity /DW 1000 /W [${widths}] >>`,
  );
  const map = gids.map((g) => {
    const u = Buffer.from(String.fromCodePoint(used.get(g)!), "utf16le").swap16();
    return `<${hex4(g)}> <${u.toString("hex").toUpperCase()}>`;
  });
  const chunks: string[] = [];
  for (let i = 0; i < map.length; i += 100) {
    const part = map.slice(i, i + 100);
    chunks.push(`${part.length} beginbfchar\n${part.join("\n")}\nendbfchar`);
  }
  const cmap =
    "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n" +
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
    "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n" +
    "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" +
    chunks.join("\n") +
    "\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
  const toUnicode = add(stream("", Buffer.from(cmap, "latin1")));
  return add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /${f.postScriptName} /Encoding /Identity-H ` +
      `/DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
  );
}

/** A PDF date, D:YYYYMMDDHHmmSSZ. */
function pdfDate(d: Date): string {
  return `D:${d.toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`;
}
/** The same instant as `pdfDate`, in the XMP form (whole seconds, UTC). */
function xmpDate(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

/** The bundled sRGB profile of the PDF/A output intent (`icc/ICC.md`), read once. */
let srgb: Buffer | undefined;
function srgbProfile(): Buffer {
  srgb ??= readFileSync(new URL("../icc/sRGB-v2-magic.icc", import.meta.url));
  return srgb;
}

/** What the PDF/A options resolve to; `undefined` for plain PDF. */
interface PdfA {
  lang: string;
  ua: boolean;
}
function pdfaOf(doc: PdfDocument, o: PdfOptions): PdfA | undefined {
  if (o.pdfa === undefined) {
    if (o.pdfua) throw new OfficeExportError("pdfa_invalid", "pdfua needs pdfa");
    return undefined;
  }
  if (o.pdfa !== "2b") throw new OfficeExportError("pdfa_invalid", 'pdfa is "2b"');
  const lang = o.lang ?? "en";
  if (typeof lang !== "string" || !PDF_LANG_TAG.test(lang))
    throw new OfficeExportError("pdfa_invalid", "lang is a BCP 47 tag");
  for (const [k, v] of [
    ["title", doc.title],
    ["creator", o.creator],
  ] as const)
    if (v !== undefined && dropInvalidXml(v) !== v)
      throw bad(`the ${k} has characters XMP metadata cannot carry`);
  const ua = o.pdfua === true;
  if (ua) {
    if (!doc.title?.trim()) throw bad("PDF/UA needs a title");
    let last = 0;
    for (const b of doc.blocks)
      if (typeof b === "object" && b !== null && b.type === "heading") {
        if (b.level > last + 1)
          throw bad(
            `PDF/UA headings start at level 1 and skip no level (H${b.level} after H${last})`,
          );
        last = b.level;
      }
  }
  return { lang, ua };
}

/** The XMP metadata packet of a PDF/A file: every entry from the document and `created`. */
function xmp(doc: PdfDocument, o: PdfOptions, a: PdfA, created: Date, id: string): Buffer {
  const date = xmpDate(created);
  const uuid = `uuid:${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
  const props = [
    "<pdfaid:part>2</pdfaid:part>",
    "<pdfaid:conformance>B</pdfaid:conformance>",
    ...(a.ua ? ["<pdfuaid:part>1</pdfuaid:part>"] : []),
    "<dc:format>application/pdf</dc:format>",
    ...(doc.title !== undefined
      ? [
          `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(doc.title)}</rdf:li></rdf:Alt></dc:title>`,
        ]
      : []),
    `<dc:language><rdf:Bag><rdf:li>${a.lang}</rdf:li></rdf:Bag></dc:language>`,
    `<xmp:CreateDate>${date}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${date}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${date}</xmp:MetadataDate>`,
    ...(o.creator !== undefined
      ? [`<xmp:CreatorTool>${xmlText(o.creator)}</xmp:CreatorTool>`]
      : []),
    "<pdf:Producer>Infrabyx export</pdf:Producer>",
    `<xmpMM:DocumentID>${uuid}</xmpMM:DocumentID>`,
    `<xmpMM:InstanceID>${uuid}</xmpMM:InstanceID>`,
  ];
  // pdfuaid is not one of PDF/A-2's predefined schemas, so it is described in an extension schema.
  const extension = a.ua
    ? '<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" ' +
      'xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">\n' +
      '<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">' +
      "<pdfaSchema:schema>PDF/UA Universal Accessibility Schema</pdfaSchema:schema>" +
      "<pdfaSchema:namespaceURI>http://www.aiim.org/pdfua/ns/id/</pdfaSchema:namespaceURI>" +
      "<pdfaSchema:prefix>pdfuaid</pdfaSchema:prefix>" +
      '<pdfaSchema:property><rdf:Seq><rdf:li rdf:parseType="Resource">' +
      "<pdfaProperty:name>part</pdfaProperty:name><pdfaProperty:valueType>Integer</pdfaProperty:valueType>" +
      "<pdfaProperty:category>internal</pdfaProperty:category>" +
      "<pdfaProperty:description>Part of ISO 14289 the file conforms to</pdfaProperty:description>" +
      "</rdf:li></rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas>\n</rdf:Description>\n"
    : "";
  const packet =
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" ' +
    (a.ua ? 'xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" ' : "") +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" ' +
    'xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">\n' +
    props.join("\n") +
    "\n</rdf:Description>\n" +
    extension +
    "</rdf:RDF>\n</x:xmpmeta>\n" +
    '<?xpacket end="r"?>';
  return Buffer.from(packet, "utf8");
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
  const pdfa = pdfaOf(doc, o);
  const layout = new Layout(max, pdfa !== undefined);
  for (const b of doc.blocks) block(layout, b);
  layout.close();

  // Objects: 1 catalog, 2 pages, then the info, the fonts used, and per page its page, contents
  // and links. PDF/A then adds the structure tree, the output intent and, last, the metadata.
  const objs: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objs.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    return objs.length;
  };
  add(""); // catalog, filled below
  add(""); // pages, filled below
  const info: string[] = [`/Producer (Infrabyx export)`, `/CreationDate (${pdfDate(created)})`];
  if (pdfa) info.push(`/ModDate (${pdfDate(created)})`);
  if (doc.title !== undefined) info.push(`/Title ${textString(doc.title)}`);
  if (o.creator !== undefined) info.push(`/Creator ${textString(o.creator)}`);
  const infoId = add(`<< ${info.join(" ")} >>`);
  const fontRefs: string[] = [];
  for (const [idx, used] of [...layout.used].sort((a, b) => a[0] - b[0]))
    fontRefs.push(`/F${idx + 1} ${embedFont(add, fontAt(idx), used)} 0 R`);
  const fonts = fontRefs.join(" ");
  const kids: number[] = [];
  // Per page, the object numbers of its link annotations (PDF/A: their OBJR and StructParent).
  const annots: number[][] = [];
  let parentKey = layout.pages.length;
  layout.pages.forEach((p, pi) => {
    const stream = deflateSync(Buffer.from(p.ops.join("\n"), "latin1"), { level: 9 });
    const pageId = objs.length + 1;
    const contentsId = pageId + 1;
    const linkIds = p.links.map((_, i) => contentsId + 1 + i);
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] ` +
        `/Resources << /Font << ${fonts} >> >> /Contents ${contentsId} 0 R` +
        (linkIds.length ? ` /Annots [${linkIds.map((id) => `${id} 0 R`).join(" ")}]` : "") +
        (pdfa ? ` /StructParents ${pi} /Tabs /S` : "") +
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
          (pdfa ? `/F 4 /StructParent ${parentKey++} /Contents ${textString(l.href)} ` : "") +
          `/A << /S /URI /URI ${asciiLit(l.href)} >> >>`,
      );
    kids.push(pageId);
    annots.push(linkIds);
  });
  let catalog = "<< /Type /Catalog /Pages 2 0 R >>";
  if (pdfa) {
    // The structure tree: elements in reading order, numbered before they are written so that
    // parents and kids can refer to each other.
    const elems: Elem[] = [];
    const parentOf = new Map<Elem, Elem>();
    const walk = (e: Elem) => {
      elems.push(e);
      for (const k of e.kids)
        if (isElem(k)) {
          parentOf.set(k, e);
          walk(k);
        }
    };
    walk(layout.root);
    const rootId = add(""); // StructTreeRoot, filled below
    const idOf = new Map(elems.map((e, i) => [e, rootId + 1 + i]));
    const ref = (e: Elem) => `${idOf.get(e)} 0 R`;
    const linkOf: Elem[] = [];
    for (const e of elems) {
      const k = e.kids.map((kid) => {
        if (isElem(kid)) return ref(kid);
        if ("mcid" in kid) return `<< /Type /MCR /Pg ${kids[kid.page]} 0 R /MCID ${kid.mcid} >>`;
        const obj = annots[kid.page]![kid.link]!;
        linkOf[obj] = e;
        return `<< /Type /OBJR /Pg ${kids[kid.page]} 0 R /Obj ${obj} 0 R >>`;
      });
      const parent = parentOf.get(e);
      add(
        `<< /Type /StructElem /S /${e.type} /P ${parent ? ref(parent) : `${rootId} 0 R`}` +
          `${e.attrs ? ` ${e.attrs}` : ""} /K [${k.join(" ")}] >>`,
      );
    }
    // The parent tree: per page, the element of each MCID; per link annotation, its Link element.
    const nums: string[] = layout.pages.map(
      (p, pi) => `${pi} ${add(`[${p.mcids.map(ref).join(" ")}]`)} 0 R`,
    );
    annots.flat().forEach((obj, i) => nums.push(`${layout.pages.length + i} ${ref(linkOf[obj]!)}`));
    const parentTree = add(`<< /Nums [${nums.join(" ")}] >>`);
    objs[rootId - 1] = Buffer.from(
      `<< /Type /StructTreeRoot /K ${ref(layout.root)} /ParentTree ${parentTree} 0 R ` +
        `/ParentTreeNextKey ${parentKey} >>`,
      "latin1",
    );
    const profile = add(stream("/N 3", srgbProfile()));
    const intent = add(
      "<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) " +
        `/RegistryName (http://www.color.org) /Info (sRGB IEC61966-2.1) /DestOutputProfile ${profile} 0 R >>`,
    );
    // The metadata is the last object, written once the content digest is known.
    const metadataId = objs.length + 1;
    catalog =
      `<< /Type /Catalog /Pages 2 0 R /Metadata ${metadataId} 0 R /OutputIntents [${intent} 0 R] ` +
      `/StructTreeRoot ${rootId} 0 R /MarkInfo << /Marked true >> /Lang ${asciiLit(pdfa.lang)}` +
      (doc.title !== undefined ? " /ViewerPreferences << /DisplayDocTitle true >>" : "") +
      " >>";
  }
  objs[0] = Buffer.from(catalog, "latin1");
  objs[1] = Buffer.from(
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`,
    "latin1",
  );

  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = parts[0]!.length;
  const offsets: number[] = [];
  const write = (body: Buffer, i: number) => {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    parts.push(chunk);
    offset += chunk.length;
  };
  objs.forEach(write);
  // The content digest: every byte before the metadata, which is itself derived from the digest.
  const bodyHash = sha256Hex(Buffer.concat(parts)).slice(0, 32);
  if (pdfa) {
    // Uncompressed, so that any reader finds the packet.
    const meta = xmp(doc, o, pdfa, created, bodyHash);
    const body = Buffer.concat([
      Buffer.from(`<< /Type /Metadata /Subtype /XML /Length ${meta.length} >>\nstream\n`, "latin1"),
      meta,
      Buffer.from("\nendstream", "latin1"),
    ]);
    write(body, add(body) - 1);
  }
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
