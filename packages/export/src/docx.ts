// DOCX renderer (PR-LDC-28, M59): a WordprocessingML document (ECMA-376 Part 1) from a small block
// model, written over the package's own ZIP writer with no dependency. Blocks: headings 1 to 6,
// paragraphs of runs (bold, italic, underline, or an https hyperlink), bullet and numbered lists
// with one nested level, tables of plain text with a repeated header row, and page breaks. Every
// text is XML-escaped and stripped of characters XML 1.0 cannot carry. The output has no macros,
// no fields, no images and no external part other than the https hyperlinks the caller names, so
// a document opens without prompts. A4 portrait, 2.54 cm margins. The same blocks and `created`
// time always give the same bytes.
import {
  ByteBudget,
  CT_CORE,
  OfficeExportError,
  REL_CORE,
  REL_OFFICE,
  XML_DECL,
  contentTypesXml,
  coreXml,
  createdOf,
  dropInvalidXml,
  maxBytesOf,
  packParts,
  relsXml,
  xmlText,
  type OfficeProperties,
  type Rel,
} from "./ooxml.js";

/** One run of text. `href` makes it a hyperlink (https only, no user name or password). */
export interface DocxTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  href?: string;
}
/** A plain string is a run with no formatting. */
export type DocxRun = string | DocxTextRun;

/** A list item: its runs, or its runs and one nested level of items. */
export type DocxListItem =
  readonly DocxRun[] | { runs: readonly DocxRun[]; items?: ReadonlyArray<readonly DocxRun[]> };

export type DocxBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; runs: readonly DocxRun[] }
  | { type: "bulletList"; items: readonly DocxListItem[] }
  | { type: "numberedList"; items: readonly DocxListItem[] }
  | { type: "table"; header: readonly string[]; rows: ReadonlyArray<readonly string[]> }
  | { type: "pageBreak" };

export interface DocxDocument {
  /** `dc:title` in `docProps/core.xml`. */
  title?: string;
  blocks: readonly DocxBlock[];
}

/** Options: `creator`, a fixed `created` time and the `maxBytes` cap (default 64 MiB). */
export type DocxOptions = Omit<OfficeProperties, "title">;

/** Blocks per document, and Word's limit of 63 table columns. */
export const DOCX_MAX_BLOCKS = 100_000;
export const DOCX_MAX_TABLE_COLUMNS = 63;
/** Hyperlinks per document. */
export const DOCX_MAX_LINKS = 10_000;

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CT_DOCUMENT =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const CT_STYLES = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml";
const CT_NUMBERING = "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml";
// A4 portrait in twentieths of a point, 1440 (2.54 cm) margins; the text width the tables fill.
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1440;
const TEXT_W = PAGE_W - 2 * MARGIN;

const HEADING_SIZES = [32, 26, 24, 22, 22, 22] as const; // half-points
const STYLES = (() => {
  const headings = HEADING_SIZES.map(
    (sz, i) =>
      `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/>` +
      `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${i === 0 ? 360 : 240}" w:after="120"/>` +
      `<w:outlineLvl w:val="${i}"/></w:pPr>` +
      `<w:rPr><w:b/>${i >= 4 ? "<w:i/>" : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`,
  ).join("");
  return (
    XML_DECL +
    `<w:styles xmlns:w="${W}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    "</w:docDefaults>" +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    headings +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
    '<w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/>' +
    '<w:basedOn w:val="ListParagraph"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/>' +
    '<w:basedOn w:val="ListParagraph"/></w:style>' +
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">' +
    '<w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>' +
    '<w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/>' +
    '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>' +
    '<w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>' +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>' +
    '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>' +
    '<w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/>' +
    '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
    "<w:tblPr><w:tblBorders>" +
    ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
      .join("") +
    "</w:tblBorders></w:tblPr></w:style>" +
    "</w:styles>"
  );
})();

function lvl(ilvl: number, fmt: string, text: string): string {
  const left = 720 * (ilvl + 1);
  const font =
    fmt === "bullet"
      ? '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:hint="default"/></w:rPr>'
      : "";
  return (
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>` +
    `<w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>${font}</w:lvl>`
  );
}

// abstractNum 0 is bullets, 1 is numbers; num 1 is every bullet list, and each numbered list has its
// own num (2, 3, ...) restarting at 1.
function numberingXml(numberedLists: number): string {
  let nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
  for (let i = 0; i < numberedLists; i++)
    nums +=
      `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/>` +
      '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' +
      '<w:lvlOverride w:ilvl="1"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';
  return (
    XML_DECL +
    `<w:numbering xmlns:w="${W}">` +
    '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
    lvl(0, "bullet", "•") +
    lvl(1, "bullet", "◦") +
    "</w:abstractNum>" +
    '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' +
    lvl(0, "decimal", "%1.") +
    lvl(1, "lowerLetter", "%2.") +
    "</w:abstractNum>" +
    nums +
    "</w:numbering>"
  );
}

/** Refuse anything but an absolute https URL with a host and no credentials; return its form. */
export function assertHttpsUrl(href: unknown): string {
  let u: URL;
  try {
    u = new URL(String(href));
  } catch {
    throw new OfficeExportError("link_invalid", `hyperlink ${JSON.stringify(href)} is not a URL`);
  }
  if (typeof href !== "string" || u.protocol !== "https:" || u.hostname === "")
    throw new OfficeExportError(
      "link_invalid",
      `hyperlink ${JSON.stringify(href)} is not an https URL`,
    );
  if (u.username !== "" || u.password !== "")
    throw new OfficeExportError(
      "link_invalid",
      "a hyperlink may not carry a user name or password",
    );
  return u.href;
}

function bad(why: string): OfficeExportError {
  return new OfficeExportError("block_invalid", why);
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string") throw bad(`${what} must be text`);
  return v;
}

/** `<w:t>` pieces with line breaks and tabs as elements; CR LF and CR count as one line break. */
function textXml(s: string): string {
  const parts = dropInvalidXml(s)
    .replace(/\r\n?/g, "\n")
    .split(/(\n|\t)/);
  return parts
    .map((p) =>
      p === "\n"
        ? "<w:br/>"
        : p === "\t"
          ? "<w:tab/>"
          : p === ""
            ? ""
            : `<w:t xml:space="preserve">${xmlText(p)}</w:t>`,
    )
    .join("");
}

class Renderer {
  readonly links = new Map<string, string>(); // normalised URL → relationship id
  numberedLists = 0;
  constructor(private readonly budget: ByteBudget) {}

  private run(r: DocxRun): string {
    if (typeof r === "string") return `<w:r>${textXml(r)}</w:r>`;
    if (typeof r !== "object" || r === null) throw bad("a run must be text or an object");
    const text = str(r.text, "run text");
    const href = r.href === undefined ? undefined : assertHttpsUrl(r.href);
    const rPr =
      (href !== undefined ? '<w:rStyle w:val="Hyperlink"/>' : "") +
      (r.bold ? "<w:b/>" : "") +
      (r.italic ? "<w:i/>" : "") +
      (r.underline ? '<w:u w:val="single"/>' : "");
    const xml = `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}${textXml(text)}</w:r>`;
    if (href === undefined) return xml;
    let id = this.links.get(href);
    if (id === undefined) {
      if (this.links.size >= DOCX_MAX_LINKS)
        throw new OfficeExportError("too_many_links", `at most ${DOCX_MAX_LINKS} hyperlinks`);
      id = `rId${this.links.size + 3}`;
      this.links.set(href, id);
    }
    return `<w:hyperlink r:id="${id}" w:history="1">${xml}</w:hyperlink>`;
  }

  private runs(rs: unknown, what: string): string {
    if (!Array.isArray(rs)) throw bad(`${what} must be an array of runs`);
    return rs.map((r: DocxRun) => this.run(r)).join("");
  }

  private listItem(item: DocxListItem, numId: number): string {
    const p = (runs: unknown, ilvl: number) =>
      `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/>` +
      `<w:numId w:val="${numId}"/></w:numPr></w:pPr>${this.runs(runs, "a list item")}</w:p>`;
    if (Array.isArray(item)) return p(item, 0);
    if (typeof item !== "object" || item === null)
      throw bad("a list item must be runs or an object");
    const { runs, items } = item as { runs: unknown; items?: unknown };
    let xml = p(runs, 0);
    if (items !== undefined) {
      if (!Array.isArray(items)) throw bad("nested list items must be an array");
      for (const sub of items) xml += p(sub, 1);
    }
    return xml;
  }

  private table(header: unknown, rows: unknown): string {
    if (!Array.isArray(header) || header.length === 0)
      throw bad("a table needs a header row of at least one cell");
    if (header.length > DOCX_MAX_TABLE_COLUMNS)
      throw bad(`a table has at most ${DOCX_MAX_TABLE_COLUMNS} columns`);
    if (!Array.isArray(rows)) throw bad("table rows must be an array");
    const n = header.length;
    const w = Math.floor(TEXT_W / n);
    const tc = (text: unknown, bold: boolean) =>
      `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr><w:p>` +
      `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}${textXml(str(text, "a table cell"))}</w:r>` +
      "</w:p></w:tc>";
    let xml = this.budget.add(
      '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>' +
        `<w:tblW w:w="${w * n}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
        '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>' +
        `</w:tblPr><w:tblGrid>${`<w:gridCol w:w="${w}"/>`.repeat(n)}</w:tblGrid>` +
        `<w:tr><w:trPr><w:tblHeader/></w:trPr>${header.map((h) => tc(h, true)).join("")}</w:tr>`,
    );
    rows.forEach((row: unknown, i: number) => {
      if (!Array.isArray(row) || row.length !== n)
        throw bad(`table row ${i + 1} must have ${n} cells, as the header has`);
      xml += this.budget.add(`<w:tr>${row.map((c) => tc(c, false)).join("")}</w:tr>`);
    });
    return xml + this.budget.add("</w:tbl>");
  }

  block(b: DocxBlock): string {
    if (typeof b !== "object" || b === null) throw bad("a block must be an object");
    switch (b.type) {
      case "heading": {
        if (!Number.isInteger(b.level) || b.level < 1 || b.level > 6)
          throw bad("a heading level is 1 to 6");
        return `<w:p><w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr><w:r>${textXml(str(b.text, "a heading"))}</w:r></w:p>`;
      }
      case "paragraph":
        return `<w:p>${this.runs(b.runs, "a paragraph")}</w:p>`;
      case "bulletList":
      case "numberedList": {
        if (!Array.isArray(b.items) || b.items.length === 0)
          throw bad("a list needs at least one item");
        const numId = b.type === "bulletList" ? 1 : 2 + this.numberedLists++;
        return b.items.map((it) => this.listItem(it, numId)).join("");
      }
      case "table":
        return this.table(b.header, b.rows);
      case "pageBreak":
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      default:
        throw bad(`unknown block type ${JSON.stringify((b as { type?: unknown }).type)}`);
    }
  }
}

/**
 * Render a document. Refuses (`OfficeExportError`) an unknown block, a heading level outside 1 to
 * 6, a hyperlink that is not https, a table row of the wrong width, more than 100 000 blocks, or
 * parts over `maxBytes` uncompressed (default 64 MiB).
 */
export function toDocx(doc: DocxDocument, o: DocxOptions = {}): Buffer {
  if (typeof doc !== "object" || doc === null || !Array.isArray(doc.blocks))
    throw bad("a document needs a blocks array");
  if (doc.blocks.length > DOCX_MAX_BLOCKS)
    throw new OfficeExportError("too_many_blocks", `at most ${DOCX_MAX_BLOCKS} blocks`);
  if (doc.title !== undefined) str(doc.title, "the title");
  const props: OfficeProperties = { ...o };
  if (doc.title !== undefined) props.title = doc.title;
  const created = createdOf(props);
  const max = maxBytesOf(props);
  const budget = new ByteBudget(max);
  const r = new Renderer(budget);
  let body = "";
  doc.blocks.forEach((b, i) => {
    // A table counts against the budget row by row as it is built; other blocks when done.
    body += b?.type === "table" ? r.block(b) : budget.add(r.block(b));
    // Word joins adjacent tables and wants a paragraph after a final one.
    if (b?.type === "table" && (i === doc.blocks.length - 1 || doc.blocks[i + 1]?.type === "table"))
      body += "<w:p/>";
  });
  const document =
    XML_DECL +
    `<w:document xmlns:w="${W}" xmlns:r="${REL_OFFICE}"><w:body>${body}` +
    `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/>` +
    `<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}"` +
    ' w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const rels: Rel[] = [
    { id: "rId1", type: `${REL_OFFICE}/styles`, target: "styles.xml" },
    { id: "rId2", type: `${REL_OFFICE}/numbering`, target: "numbering.xml" },
    ...[...r.links].map(([href, id]) => ({
      id,
      type: `${REL_OFFICE}/hyperlink`,
      target: href,
      external: true,
    })),
  ];
  const parts = new Map<string, string>([
    [
      "[Content_Types].xml",
      contentTypesXml([
        ["/word/document.xml", CT_DOCUMENT],
        ["/word/styles.xml", CT_STYLES],
        ["/word/numbering.xml", CT_NUMBERING],
        ["/docProps/core.xml", CT_CORE],
      ]),
    ],
    [
      "_rels/.rels",
      relsXml([
        { id: "rId1", type: `${REL_OFFICE}/officeDocument`, target: "word/document.xml" },
        { id: "rId2", type: REL_CORE, target: "docProps/core.xml" },
      ]),
    ],
    ["docProps/core.xml", coreXml(props, created)],
    ["word/document.xml", document],
    ["word/styles.xml", STYLES],
    ["word/numbering.xml", numberingXml(r.numberedLists)],
    ["word/_rels/document.xml.rels", relsXml(rels)],
  ]);
  return packParts(parts, created, max);
}
