// Shared pieces of the Office Open XML writers (`toXlsx`, `toDocx`; PR-LDC-28, M59): XML 1.0 text
// and attribute escaping, the core-properties part, package relationships and content types, and
// the size cap. Every part is built from strings this module escapes, so caller text can never add
// an element, an attribute, a formula, a field or an external reference.
import { writeZip } from "./zip.js";

/** A refused input (bad name, value, link or size), with a stable `reason` for the caller to map. */
export class OfficeExportError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "OfficeExportError";
  }
}

/** The default cap on the uncompressed size of all parts of one file (64 MiB). */
export const OFFICE_DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
/** The highest cap a caller may set (1 GiB); the ZIP writer itself stops at 4 GiB. */
export const OFFICE_MAX_BYTES_LIMIT = 1024 * 1024 * 1024;

// Characters outside the XML 1.0 `Char` production (C0 controls but tab, LF and CR; lone
// surrogates; U+FFFE and U+FFFF). With the `u` flag a lone surrogate is one code point, so it
// matches and is dropped.
const INVALID_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

/** Drop the characters XML 1.0 cannot carry. */
export function dropInvalidXml(s: string): string {
  return s.replace(INVALID_XML, "");
}

/** Escape text for element content (CR kept as a reference, so a parser does not fold it). */
export function xmlText(s: string): string {
  return dropInvalidXml(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;");
}

/** Escape text for a double-quoted attribute value. */
export function xmlAttr(s: string): string {
  return xmlText(s).replace(/"/g, "&quot;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;");
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The fixed default creation time: the ZIP writer's default entry time. */
export const OFFICE_DEFAULT_CREATED = new Date(Date.UTC(1980, 0, 1));

export interface OfficeProperties {
  /** `dc:title` in `docProps/core.xml`. */
  title?: string;
  /** `dc:creator` in `docProps/core.xml`. */
  creator?: string;
  /**
   * `dcterms:created` and `dcterms:modified`, and every ZIP entry time (default
   * 1980-01-01T00:00:00Z). Pass a fixed instant: the same input and time give the same bytes.
   */
  created?: Date;
  /** Cap on the uncompressed size of all parts (default 64 MiB, at most 1 GiB). */
  maxBytes?: number;
}

export function createdOf(o: OfficeProperties): Date {
  const d = o.created ?? OFFICE_DEFAULT_CREATED;
  if (!(d instanceof Date) || Number.isNaN(d.getTime()))
    throw new OfficeExportError("created_invalid", "created must be a valid Date");
  const y = d.getUTCFullYear();
  if (y < 1980 || y > 9999)
    throw new OfficeExportError("created_invalid", "created must be between 1980 and 9999");
  return d;
}

export function maxBytesOf(o: OfficeProperties): number {
  const m = o.maxBytes ?? OFFICE_DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(m) || m < 1 || m > OFFICE_MAX_BYTES_LIMIT)
    throw new OfficeExportError(
      "max_bytes_invalid",
      `maxBytes must be an integer from 1 to ${OFFICE_MAX_BYTES_LIMIT}`,
    );
  return m;
}

/** W3CDTF in UTC, whole seconds. */
function w3cdtf(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

export function coreXml(o: OfficeProperties, created: Date): string {
  const t = w3cdtf(created);
  return (
    XML_DECL +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    (o.title !== undefined ? `<dc:title>${xmlText(o.title)}</dc:title>` : "") +
    (o.creator !== undefined ? `<dc:creator>${xmlText(o.creator)}</dc:creator>` : "") +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${t}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${t}</dcterms:modified>` +
    "</cp:coreProperties>"
  );
}

export const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const REL_OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const REL_CORE =
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
export const CT_CORE = "application/vnd.openxmlformats-package.core-properties+xml";

export interface Rel {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}

export function relsXml(rels: readonly Rel[]): string {
  return (
    XML_DECL +
    `<Relationships xmlns="${REL_NS}">` +
    rels
      .map(
        (r) =>
          `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlAttr(r.target)}"` +
          (r.external ? ' TargetMode="External"/>' : "/>"),
      )
      .join("") +
    "</Relationships>"
  );
}

/** `[Content_Types].xml`: defaults for `.rels` and `.xml`, one override per main part. */
export function contentTypesXml(overrides: ReadonlyArray<readonly [string, string]>): string {
  return (
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    overrides
      .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
      .join("") +
    "</Types>"
  );
}

/** Counts the UTF-8 bytes of the parts as they are built and refuses past the cap. */
export class ByteBudget {
  private used = 0;
  constructor(readonly max: number) {}
  add(s: string): string {
    this.used += Buffer.byteLength(s, "utf8");
    if (this.used > this.max)
      throw new OfficeExportError(
        "too_large",
        `the file would exceed ${this.max} bytes uncompressed`,
      );
    return s;
  }
}

/** Zip the parts (path order, fixed entry time) after checking the total against the budget. */
export function packParts(parts: ReadonlyMap<string, string>, created: Date, max: number): Buffer {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const [p, xml] of parts) {
    const b = Buffer.from(xml, "utf8");
    total += b.length;
    files.set(p, b);
  }
  if (total > max)
    throw new OfficeExportError("too_large", `the file would exceed ${max} bytes uncompressed`);
  return writeZip(files, { entryTime: created });
}
