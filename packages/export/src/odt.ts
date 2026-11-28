// ODT writer (regulatory templates plan §7, item (b); R1-D-313): an OpenDocument 1.3 text document
// from the same block model as `toDocx`, with no dependency, so a document exports to ODT beside
// PDF and DOCX. Headings 1 to 6, paragraphs of runs (bold, italic, underline, or an https
// hyperlink), bullet and numbered lists with one nested level, tables of plain text with a
// repeated header row, and page breaks; A4 portrait, 2.54 cm margins. The same refusals as
// `toDocx`, with the same reasons. No macros, scripts, fields, images or embedded objects; the only
// external references are the https hyperlinks the caller names. The same blocks and `created`
// time always give the same bytes.
import {
  DOCX_MAX_BLOCKS,
  DOCX_MAX_LINKS,
  DOCX_MAX_TABLE_COLUMNS,
  assertHttpsUrl,
  type DocxBlock,
  type DocxDocument,
  type DocxListItem,
  type DocxOptions,
  type DocxRun,
} from "./docx.js";
import { MIME_ODT, ODF_NS, ODF_VERSION, ODF_XML_DECL, metaXml, odfText, packOdf } from "./odf.js";
import {
  ByteBudget,
  OfficeExportError,
  createdOf,
  maxBytesOf,
  xmlAttr,
  type OfficeProperties,
} from "./ooxml.js";

/** Options: `creator`, a fixed `created` time and the `maxBytes` cap (default 64 MiB). */
export type OdtOptions = DocxOptions;

const bad = (why: string) => new OfficeExportError("block_invalid", why);
function str(v: unknown, what: string): string {
  if (typeof v !== "string") throw bad(`${what} must be text`);
  return v;
}

const HEADING_PT = [16, 13, 12, 11, 11, 11] as const;

const STYLES_XML =
  ODF_XML_DECL +
  `<office:document-styles${ODF_NS} office:version="${ODF_VERSION}"><office:styles>` +
  '<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.28cm"/>' +
  '<style:text-properties fo:font-family="Calibri" fo:font-size="11pt" fo:language="en" fo:country="IN"/></style:default-style>' +
  '<style:style style:name="Standard" style:family="paragraph" style:class="text"/>' +
  HEADING_PT.map(
    (pt, i) =>
      `<style:style style:name="Heading_20_${i + 1}" style:display-name="Heading ${i + 1}" style:family="paragraph"` +
      ` style:parent-style-name="Standard" style:next-style-name="Standard" style:default-outline-level="${i + 1}" style:class="text">` +
      `<style:paragraph-properties fo:margin-top="${i === 0 ? "0.63" : "0.42"}cm" fo:margin-bottom="0.21cm" fo:keep-with-next="always"/>` +
      `<style:text-properties fo:font-size="${pt}pt" fo:font-weight="bold"${i >= 4 ? ' fo:font-style="italic"' : ""}/></style:style>`,
  ).join("") +
  '<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text">' +
  '<style:text-properties fo:color="#0563c1" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>' +
  "</office:styles><office:automatic-styles>" +
  '<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm"' +
  ' style:print-orientation="portrait" fo:margin-top="2.54cm" fo:margin-bottom="2.54cm" fo:margin-left="2.54cm" fo:margin-right="2.54cm"/></style:page-layout>' +
  '</office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>' +
  "</office:document-styles>";

/** Span styles by mask: 1 bold, 2 italic, 4 underline. */
function spanStyles(): string {
  let out = "";
  for (let m = 1; m < 8; m++)
    out +=
      `<style:style style:name="T${m}" style:family="text"><style:text-properties` +
      (m & 1
        ? ' fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"'
        : "") +
      (m & 2
        ? ' fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"'
        : "") +
      (m & 4
        ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"'
        : "") +
      "/></style:style>";
  return out;
}

const LIST_STYLES =
  '<text:list-style style:name="LB">' +
  ["•", "◦"]
    .map(
      (b, i) =>
        `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${b}">` +
        '<style:list-level-properties text:list-level-position-and-space-mode="label-alignment">' +
        `<style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="${1.27 * (i + 1)}cm"/>` +
        "</style:list-level-properties></text:list-level-style-bullet>",
    )
    .join("") +
  '</text:list-style><text:list-style style:name="LN">' +
  ["1", "a"]
    .map(
      (f, i) =>
        `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${f}">` +
        '<style:list-level-properties text:list-level-position-and-space-mode="label-alignment">' +
        `<style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="${1.27 * (i + 1)}cm"/>` +
        "</style:list-level-properties></text:list-level-style-number>",
    )
    .join("") +
  "</text:list-style>";

const PARA_STYLES =
  '<style:style style:name="PB" style:family="paragraph" style:parent-style-name="Standard">' +
  '<style:paragraph-properties fo:break-before="page"/></style:style>' +
  '<style:style style:name="PT" style:family="paragraph" style:parent-style-name="Standard">' +
  '<style:paragraph-properties fo:margin-bottom="0cm"/></style:style>' +
  '<style:style style:name="Tab" style:family="table"><style:table-properties style:width="15.92cm" table:align="left"/></style:style>' +
  '<style:style style:name="TC" style:family="table-cell"><style:table-cell-properties fo:padding="0.097cm" fo:border="0.5pt solid #000000"/></style:style>';

class Renderer {
  readonly links = new Set<string>();
  private tables = 0;
  constructor(private readonly budget: ByteBudget) {}

  private run(r: DocxRun): string {
    if (typeof r === "string") return odfText(r);
    if (typeof r !== "object" || r === null) throw bad("a run must be text or an object");
    const text = odfText(str(r.text, "run text"));
    const href = r.href === undefined ? undefined : assertHttpsUrl(r.href);
    const mask = (r.bold ? 1 : 0) | (r.italic ? 2 : 0) | (r.underline ? 4 : 0);
    const span = mask ? `<text:span text:style-name="T${mask}">${text}</text:span>` : text;
    if (href === undefined) return span;
    if (!this.links.has(href)) {
      if (this.links.size >= DOCX_MAX_LINKS)
        throw new OfficeExportError("too_many_links", `at most ${DOCX_MAX_LINKS} hyperlinks`);
      this.links.add(href);
    }
    return `<text:a xlink:type="simple" xlink:href="${xmlAttr(href)}" text:style-name="Internet_20_link">${span}</text:a>`;
  }

  private runs(rs: unknown, what: string): string {
    if (!Array.isArray(rs)) throw bad(`${what} must be an array of runs`);
    return rs.map((r: DocxRun) => this.run(r)).join("");
  }

  private listItem(item: DocxListItem): string {
    const p = (runs: unknown) =>
      `<text:p text:style-name="Standard">${this.runs(runs, "a list item")}</text:p>`;
    if (Array.isArray(item)) return `<text:list-item>${p(item)}</text:list-item>`;
    if (typeof item !== "object" || item === null)
      throw bad("a list item must be runs or an object");
    const { runs, items } = item as { runs: unknown; items?: unknown };
    let xml = p(runs);
    if (items !== undefined) {
      if (!Array.isArray(items)) throw bad("nested list items must be an array");
      if (items.length > 0)
        xml += `<text:list>${items.map((sub) => `<text:list-item>${p(sub)}</text:list-item>`).join("")}</text:list>`;
    }
    return `<text:list-item>${xml}</text:list-item>`;
  }

  private table(header: unknown, rows: unknown): string {
    if (!Array.isArray(header) || header.length === 0)
      throw bad("a table needs a header row of at least one cell");
    if (header.length > DOCX_MAX_TABLE_COLUMNS)
      throw bad(`a table has at most ${DOCX_MAX_TABLE_COLUMNS} columns`);
    if (!Array.isArray(rows)) throw bad("table rows must be an array");
    const n = header.length;
    const tc = (text: unknown, bold: boolean) => {
      const t = odfText(str(text, "a table cell"));
      return (
        '<table:table-cell table:style-name="TC" office:value-type="string"><text:p text:style-name="PT">' +
        (bold ? `<text:span text:style-name="T1">${t}</text:span>` : t) +
        "</text:p></table:table-cell>"
      );
    };
    this.tables += 1;
    let xml = this.budget.add(
      `<table:table table:name="Table${this.tables}" table:style-name="Tab">` +
        `<table:table-column table:number-columns-repeated="${n}"/>` +
        `<table:table-header-rows><table:table-row>${header.map((h) => tc(h, true)).join("")}</table:table-row></table:table-header-rows>`,
    );
    rows.forEach((row: unknown, i: number) => {
      if (!Array.isArray(row) || row.length !== n)
        throw bad(`table row ${i + 1} must have ${n} cells, as the header has`);
      xml += this.budget.add(
        `<table:table-row>${row.map((c) => tc(c, false)).join("")}</table:table-row>`,
      );
    });
    return xml + this.budget.add("</table:table>");
  }

  block(b: DocxBlock): string {
    if (typeof b !== "object" || b === null) throw bad("a block must be an object");
    switch (b.type) {
      case "heading": {
        if (!Number.isInteger(b.level) || b.level < 1 || b.level > 6)
          throw bad("a heading level is 1 to 6");
        return `<text:h text:style-name="Heading_20_${b.level}" text:outline-level="${b.level}">${odfText(str(b.text, "a heading"))}</text:h>`;
      }
      case "paragraph":
        return `<text:p text:style-name="Standard">${this.runs(b.runs, "a paragraph")}</text:p>`;
      case "bulletList":
      case "numberedList": {
        if (!Array.isArray(b.items) || b.items.length === 0)
          throw bad("a list needs at least one item");
        const style = b.type === "bulletList" ? "LB" : "LN";
        return `<text:list text:style-name="${style}">${b.items.map((it) => this.listItem(it)).join("")}</text:list>`;
      }
      case "table":
        return this.table(b.header, b.rows);
      case "pageBreak":
        return '<text:p text:style-name="PB"/>';
      default:
        throw bad(`unknown block type ${JSON.stringify((b as { type?: unknown }).type)}`);
    }
  }
}

/**
 * Render a document as ODT. Refuses (`OfficeExportError`) what `toDocx` refuses: an unknown block,
 * a heading level outside 1 to 6, a hyperlink that is not https, a table row of the wrong width,
 * more than 100 000 blocks, or parts over `maxBytes` uncompressed (default 64 MiB).
 */
export function toOdt(doc: DocxDocument, o: OdtOptions = {}): Buffer {
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
  for (const b of doc.blocks) body += b?.type === "table" ? r.block(b) : budget.add(r.block(b));
  const content =
    ODF_XML_DECL +
    `<office:document-content${ODF_NS} office:version="${ODF_VERSION}">` +
    `<office:automatic-styles>${spanStyles()}${LIST_STYLES}${PARA_STYLES}</office:automatic-styles>` +
    `<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const parts = new Map<string, string>([
    ["content.xml", content],
    ["meta.xml", metaXml(props, created)],
    ["styles.xml", STYLES_XML],
  ]);
  return packOdf(MIME_ODT, parts, created, max);
}
