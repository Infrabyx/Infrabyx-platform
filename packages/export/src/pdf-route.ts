// PDF routing for vernacular documents (OWNER-QUESTIONS #117, R1-D-96). `toPdf` sets Latin text
// and the rupee sign with its bundled fonts but cannot shape Indic scripts (conjuncts, matras,
// reordering). A KFS or a notice in the borrower's language goes through the DOCGEN port instead:
// `blocksToHtml` writes the same blocks as a self-contained HTML page (no script, no external
// resource, a CSP that forbids fetching anything), and the DOCGEN adapter (Gotenberg's Chromium,
// with Noto Sans Devanagari and Gurmukhi installed) shapes and prints it. `renderPdf` picks the
// path: in-process when the fonts can show every character, DOCGEN when any text needs shaping.
import type { DocgenPort, RenderedDocument } from "@infrabyx/contracts/ports";
import type { PortCall } from "@infrabyx/contracts/ports";
import { assertHttpsUrl, type DocxDocument, type DocxListItem, type DocxRun } from "./docx.js";
import { OfficeExportError } from "./ooxml.js";
import { needsShaping, toPdf, type PdfOptions } from "./pdf.js";

/** Whether any text of the document is in an Indic script (and so needs DOCGEN). */
export function pdfNeedsShaping(doc: DocxDocument): boolean {
  const texts: string[] = [];
  const runs = (rs: readonly DocxRun[]) => {
    for (const r of rs) texts.push(typeof r === "string" ? r : r.text);
  };
  const items = (is: readonly DocxListItem[]) => {
    for (const it of is) {
      if (Array.isArray(it)) runs(it);
      else {
        const o = it as { runs: readonly DocxRun[]; items?: ReadonlyArray<readonly DocxRun[]> };
        runs(o.runs);
        for (const sub of o.items ?? []) runs(sub);
      }
    }
  };
  if (doc.title) texts.push(doc.title);
  for (const b of doc.blocks) {
    if (b.type === "heading") texts.push(b.text);
    else if (b.type === "paragraph") runs(b.runs);
    else if (b.type === "bulletList" || b.type === "numberedList") items(b.items);
    else if (b.type === "table") texts.push(...b.header, ...b.rows.flat());
  }
  for (const t of texts)
    if (typeof t === "string")
      for (const ch of t) if (needsShaping(ch.codePointAt(0)!)) return true;
  return false;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function runsHtml(rs: readonly DocxRun[]): string {
  return rs
    .map((r) => {
      const run = typeof r === "string" ? { text: r } : r;
      let h = esc(run.text).replace(/\r\n?|\n/g, "<br>");
      if (run.bold) h = `<b>${h}</b>`;
      if (run.italic) h = `<i>${h}</i>`;
      if (run.underline) h = `<u>${h}</u>`;
      if (run.href !== undefined) h = `<a href="${esc(assertHttpsUrl(run.href))}">${h}</a>`;
      return h;
    })
    .join("");
}

function listHtml(items: readonly DocxListItem[], tag: "ul" | "ol"): string {
  const li = items.map((it) => {
    if (Array.isArray(it)) return `<li>${runsHtml(it)}</li>`;
    const o = it as { runs: readonly DocxRun[]; items?: ReadonlyArray<readonly DocxRun[]> };
    const sub = o.items?.length
      ? `<${tag}>${o.items.map((s) => `<li>${runsHtml(s)}</li>`).join("")}</${tag}>`
      : "";
    return `<li>${runsHtml(o.runs)}${sub}</li>`;
  });
  return `<${tag}>${li.join("")}</${tag}>`;
}

/**
 * The blocks as one self-contained HTML page for DOCGEN's `renderHtml`: A4, 2.54 cm margins,
 * Noto Sans with the Indic Noto families first, the table header repeated on each page, no script
 * and no external resource (the CSP forbids any fetch). `lang` is the document's language (BCP 47,
 * e.g. `hi`, `pa`), which the renderer uses to choose fonts and shaping.
 */
export function blocksToHtml(doc: DocxDocument, o: { lang: string }): string {
  if (!LANG.test(o.lang)) throw new OfficeExportError("block_invalid", "lang is a BCP 47 tag");
  const body = doc.blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
          return `<h${b.level}>${esc(b.text)}</h${b.level}>`;
        case "paragraph":
          return `<p>${runsHtml(b.runs)}</p>`;
        case "bulletList":
          return listHtml(b.items, "ul");
        case "numberedList":
          return listHtml(b.items, "ol");
        case "table":
          return (
            `<table><thead><tr>${b.header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>` +
            `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
          );
        case "pageBreak":
          return '<div class="page-break"></div>';
        default:
          throw new OfficeExportError("block_invalid", "unknown block type");
      }
    })
    .join("\n");
  const title = doc.title !== undefined ? `<title>${esc(doc.title)}</title>` : "";
  return (
    `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
    title +
    "<style>@page{size:A4;margin:2.54cm}" +
    "body{font-family:'Noto Sans Devanagari','Noto Sans Gurmukhi','Noto Sans',sans-serif;font-size:10.5pt;line-height:1.35}" +
    "table{border-collapse:collapse;width:100%;font-size:9pt}th,td{border:0.5pt solid #000;padding:4pt;text-align:left;vertical-align:top}" +
    "thead{display:table-header-group}tr{break-inside:avoid}.page-break{break-after:page}</style>" +
    `</head><body>\n${body}\n</body></html>`
  );
}

export type PdfRoute =
  { via: "inline"; pdf: Buffer } | { via: "docgen"; document: RenderedDocument };

/**
 * A PDF of `doc` on the right path: `toPdf` in process when its fonts can show every character;
 * DOCGEN (`renderHtml`, format `pdf` or `pdfa`) when any text is in an Indic script. The DOCGEN
 * path needs the port, the document's `lang` and the STORAGE `outputPrefix` it writes to.
 */
export async function renderPdf(
  doc: DocxDocument,
  o: PdfOptions & {
    docgen?: DocgenPort;
    lang?: string;
    outputPrefix?: string;
    format?: "pdf" | "pdfa";
    call?: PortCall;
  } = {},
): Promise<PdfRoute> {
  if (!pdfNeedsShaping(doc)) {
    const { docgen: _d, lang: _l, outputPrefix: _p, format: _f, call: _c, ...pdf } = o;
    return { via: "inline", pdf: toPdf(doc, pdf) };
  }
  if (!o.docgen || !o.lang || !o.outputPrefix)
    throw new OfficeExportError(
      "shaping_required",
      "the document has Indic text: pass docgen, lang and outputPrefix to render it through DOCGEN",
    );
  const document = await o.docgen.renderHtml(
    {
      html: blocksToHtml(doc, { lang: o.lang }),
      format: o.format ?? "pdf",
      outputPrefix: o.outputPrefix,
    },
    o.call,
  );
  return { via: "docgen", document };
}
