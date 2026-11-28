// Shared pieces of the OpenDocument writers (`toOds`, `toOdt`; regulatory templates plan §7, item
// (b); R1-D-313): OpenDocument 1.3 packages (OASIS ODF 1.3 Part 2) with `mimetype` as the first
// entry, stored, then the manifest, content, styles, meta and settings parts; text written with
// ODF's own white-space elements so that tabs, line breaks and runs of spaces survive (Part 3
// §6.1.2 collapses plain white space); the size cap. Nothing here writes a macro, a script, an
// embedded object, an image or a field, and the only external reference a part can hold is an
// https hyperlink `toOdt` checked. Not exported from the package.
import { OfficeExportError, dropInvalidXml, xmlText, type OfficeProperties } from "./ooxml.js";
import { writeZip } from "./zip.js";

export const ODF_VERSION = "1.3";
export const MIME_ODS = "application/vnd.oasis.opendocument.spreadsheet";
export const MIME_ODT = "application/vnd.oasis.opendocument.text";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';
export { XML_DECL as ODF_XML_DECL };

/** The namespaces every part declares (a part may use only some). */
export const ODF_NS =
  ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
  ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"' +
  ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"' +
  ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"' +
  ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"' +
  ' xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"' +
  ' xmlns:xlink="http://www.w3.org/1999/xlink"' +
  ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
  ' xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"' +
  ' xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';

/** A run of spaces as ODF keeps it: one literal space only between two other characters. */
function spaces(n: number, between: boolean): string {
  if (n === 1 && between) return " ";
  return n === 1 ? "<text:s/>" : `<text:s text:c="${n}"/>`;
}

/**
 * Text for a `<text:p>`, `<text:h>` or `<text:span>`: XML-escaped, stripped of characters XML 1.0
 * cannot carry, with `<text:line-break/>` (CR LF and CR count as one), `<text:tab/>` and
 * `<text:s/>` so that what is written is what reads back.
 */
export function odfText(s: string): string {
  const t = dropInvalidXml(s).replace(/\r\n?/g, "\n");
  let out = "";
  let i = 0;
  while (i < t.length) {
    const ch = t[i]!;
    if (ch === "\n") {
      out += "<text:line-break/>";
      i += 1;
    } else if (ch === "\t") {
      out += "<text:tab/>";
      i += 1;
    } else if (ch === " ") {
      let j = i;
      while (t[j] === " ") j += 1;
      const before = i > 0 && !/[\s]/.test(t[i - 1]!);
      const after = j < t.length && !/[\s]/.test(t[j]!);
      out += spaces(j - i, before && after);
      i = j;
    } else {
      let j = i;
      while (j < t.length && !/[ \t\n]/.test(t[j]!)) j += 1;
      out += xmlText(t.slice(i, j));
      i = j;
    }
  }
  return out;
}

export function manifestXml(mime: string, parts: readonly string[]): string {
  return (
    XML_DECL +
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"' +
    ` manifest:version="${ODF_VERSION}">` +
    `<manifest:file-entry manifest:full-path="/" manifest:version="${ODF_VERSION}" manifest:media-type="${mime}"/>` +
    parts
      .map((p) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="text/xml"/>`)
      .join("") +
    "</manifest:manifest>"
  );
}

export function metaXml(o: OfficeProperties, created: Date): string {
  const t = created.toISOString().slice(0, 19);
  return (
    XML_DECL +
    `<office:document-meta${ODF_NS} office:version="${ODF_VERSION}"><office:meta>` +
    "<meta:generator>@infrabyx/export</meta:generator>" +
    (o.title !== undefined ? `<dc:title>${xmlText(dropInvalidXml(o.title))}</dc:title>` : "") +
    (o.creator !== undefined
      ? `<meta:initial-creator>${xmlText(dropInvalidXml(o.creator))}</meta:initial-creator>`
      : "") +
    `<meta:creation-date>${t}</meta:creation-date><dc:date>${t}</dc:date>` +
    "</office:meta></office:document-meta>"
  );
}

/** Zip an OpenDocument package: `mimetype` first and stored, then the parts in path order. */
export function packOdf(
  mime: string,
  parts: ReadonlyMap<string, string>,
  created: Date,
  max: number,
): Buffer {
  const files = new Map<string, Uint8Array>([["mimetype", Buffer.from(mime, "ascii")]]);
  const all = new Map(parts);
  all.set("META-INF/manifest.xml", manifestXml(mime, [...parts.keys()].sort()));
  let total = 0;
  for (const [p, xml] of all) {
    const b = Buffer.from(xml, "utf8");
    total += b.length;
    files.set(p, b);
  }
  if (total > max)
    throw new OfficeExportError("too_large", `the file would exceed ${max} bytes uncompressed`);
  return writeZip(files, { entryTime: created, firstStored: "mimetype" });
}

/** A refusal of something the OpenDocument writer cannot carry as the caller asked. */
export const odfUnsupported = (what: string) =>
  new OfficeExportError("ods_unsupported", `ODS cannot carry ${what}; export it as XLSX instead`);
