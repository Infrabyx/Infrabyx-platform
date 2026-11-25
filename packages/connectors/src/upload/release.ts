// `releaseUpload`: the IPB-02-44 step after the AV scan, one call per upload (PR-FBX-56, R1-D-292).
// For a file that scanned CLEAN it checks the route's allow-list, size limit and the bytes' own type,
// then applies the step its type needs and answers the bytes to store, or a refusal code
// (`UploadRelease`). It never throws for a file; only a malformed route throws.
import {
  assertScannedClean,
  MEDIA_FORMAT_MIME,
  UPLOAD_REFUSAL_CODES,
  UPLOAD_TYPES,
  UploadRoute,
  type MediaFormat,
  type MediaPort,
  type ScanProof,
  type StoredUpload,
  type UploadKind,
  type UploadRefusalReason,
  type UploadRelease,
  type UploadRouteInput,
  type UploadStep,
  type UploadType,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import { checkOoxml } from "./office.js";
import { checkPdf } from "./pdf.js";
import { KIND_SNIFFS, polyglotMarkers, RASTER_SNIFF, sniffType, trailingBytes } from "./sniff.js";

/** The sanitiser of SVG uploads: `sanitiseSvg` of `@infrabyx/brand` (allow-list, re-serialised). */
export type SvgSanitiser = (svg: Uint8Array) => { svg: string; removed: string[] };

/**
 * A PDF flattener: returns a new PDF without active content (for example by printing it to
 * PDF/A). Its output is checked again, and any active name left is a refusal.
 */
export type PdfFlattener = (pdf: Uint8Array) => Promise<Uint8Array>;

export interface UploadPipelineOptions {
  /** MEDIA (`SharpMedia`): raster re-encoding and SVG rasterising. */
  media: MediaPort;
  /** Needed for an SVG route that sanitises or rasterises; without it SVG is refused. */
  sanitiseSvg?: SvgSanitiser;
  /** Needed for a PDF route that flattens; without it an active PDF is refused. */
  flattenPdf?: PdfFlattener;
}

export interface UploadInput {
  bytes: Uint8Array;
  /** The type the client declared (its `Content-Type`, or the route's mapping of its extension). */
  declaredType: string;
  /** The AV scan of exactly these bytes, as `FileScanPort.scan` returned it. */
  scan: ScanProof;
}

const RASTER_FORMAT: Readonly<Record<string, MediaFormat>> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** The legacy (OLE compound file) Office types; every other Office type is an OOXML zip. */
const LEGACY_OFFICE: ReadonlySet<string> = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

const refuse = (reason: UploadRefusalReason, findings: string[] = []): UploadRelease => ({
  released: false,
  code: UPLOAD_REFUSAL_CODES[reason],
  reason,
  findings,
});

const stored = (bytes: Uint8Array, mime: string): StoredUpload => ({
  bytes,
  mime,
  sha256: sha256Hex(bytes),
});

/** The pipeline for one set of ports; `release` is called on every upload of every route. */
export class UploadPipeline {
  constructor(private readonly o: UploadPipelineOptions) {}

  async release(input: UploadInput, routeInput: UploadRouteInput): Promise<UploadRelease> {
    const route = UploadRoute.parse(routeInput);
    const { bytes, declaredType } = input;
    const originalSha256 = sha256Hex(bytes);
    // 1. Only a CLEAN scan of exactly these bytes releases (IPB-02-44; `assertScannedClean`).
    try {
      assertScannedClean(input.scan, originalSha256, "UPLOAD");
    } catch (e) {
      const reason = (e as { meta?: { reason?: string } }).meta?.reason;
      return refuse(reason === "hash_mismatch" ? "scan_of_other_bytes" : "not_scanned_clean");
    }
    // 2. The route's allow-list and size limit.
    if (!(route.accept as readonly string[]).includes(declaredType))
      return refuse("type_not_allowed");
    if (bytes.length > route.maxBytes) return refuse("too_large");
    const kind: UploadKind = UPLOAD_TYPES[declaredType as UploadType];
    // 3. The bytes' own type agrees with the declared one.
    const sniffed = sniffType(bytes);
    if (!KIND_SNIFFS[kind].includes(sniffed)) return refuse("type_mismatch", [sniffed]);
    const done = (
      record: StoredUpload,
      steps: UploadStep[],
      findings: string[] = [],
      viewing: StoredUpload | null = null,
    ): UploadRelease => ({
      released: true,
      kind,
      record,
      viewing,
      originalSha256,
      steps: ["sniffed", ...steps],
      findings,
    });

    switch (kind) {
      case "raster": {
        if (RASTER_SNIFF[declaredType] !== sniffed) return refuse("type_mismatch", [sniffed]);
        // A second reading as markup (IPB-02-AT-16's PNG/HTML polyglot) is refused, never stored.
        const markers = polyglotMarkers(bytes);
        if (markers.length) return refuse("polyglot", markers);
        const findings = trailingBytes(bytes, sniffed) > 0 ? ["trailing_data"] : [];
        const format = RASTER_FORMAT[declaredType]!;
        let copy: StoredUpload;
        try {
          const probe = await this.o.media.probe(bytes, declaredType);
          const [r] = await this.o.media.reencode({
            bytes,
            mime: declaredType,
            widths: [probe.width],
            formats: [format],
          });
          if (!r) return refuse("image_unreadable");
          copy = stored(r.bytes, MEDIA_FORMAT_MIME[r.format]);
        } catch (e) {
          const code = (e as { code?: string }).code;
          return refuse(code === "IPB-SEC-013" ? "too_large" : "image_unreadable");
        }
        if (route.raster.keepOriginalAsEvidence)
          return done(
            stored(bytes, declaredType),
            ["reencoded", "kept_original_as_evidence"],
            findings,
            copy,
          );
        return done(copy, ["reencoded"], findings);
      }
      case "svg": {
        if (route.svg.mode === "refuse" || !this.o.sanitiseSvg) return refuse("svg_refused");
        let clean: { svg: string; removed: string[] };
        try {
          clean = this.o.sanitiseSvg(bytes);
        } catch {
          return refuse("svg_unreadable");
        }
        const findings = clean.removed.map((r) => r.slice(0, 64));
        if (route.svg.mode === "sanitise")
          return done(
            stored(new TextEncoder().encode(clean.svg), "image/svg+xml"),
            ["svg_sanitised"],
            findings,
          );
        try {
          const [png] = await this.o.media.rasteriseSvg(clean.svg, [route.svg.size]);
          if (!png) return refuse("svg_unreadable");
          return done(
            stored(png.bytes, "image/png"),
            ["svg_sanitised", "svg_rasterised"],
            findings,
          );
        } catch {
          return refuse("svg_unreadable", findings);
        }
      }
      case "pdf": {
        const first = checkPdf(bytes);
        if (!first.ok) return refuse(first.reason);
        const activeOf = (c: { active: string[]; reported: string[] }) => [
          ...c.active,
          ...c.reported.filter((n) => (route.pdf.refuseAlso as readonly string[]).includes(n)),
        ];
        const active = activeOf(first);
        if (!active.length)
          return done(stored(bytes, "application/pdf"), ["pdf_checked"], first.reported);
        if (route.pdf.onActive === "refuse") return refuse("pdf_active_content", active);
        if (!this.o.flattenPdf) return refuse("pdf_flatten_unavailable", active);
        let flat: Uint8Array;
        try {
          flat = await this.o.flattenPdf(bytes);
        } catch {
          return refuse("pdf_flatten_failed", active);
        }
        // The flattener's output is checked again; anything active left is a refusal.
        const again = sniffType(flat) === "pdf" ? checkPdf(flat) : null;
        if (!again || !again.ok || activeOf(again).length)
          return refuse("pdf_flatten_failed", active);
        return done(stored(flat, "application/pdf"), ["pdf_checked", "pdf_flattened"], active);
      }
      case "office": {
        if (LEGACY_OFFICE.has(declaredType) !== (sniffed === "ole"))
          return refuse("type_mismatch", [sniffed]);
        if (sniffed === "ole") {
          if (!route.office.allowMacros) return refuse("office_legacy");
          return done(
            stored(bytes, declaredType),
            ["office_checked", "office_macros_allowed"],
            ["legacy_ole"],
          );
        }
        const c = checkOoxml(bytes);
        if (!c.ok) return refuse(c.reason);
        if (/macroEnabled/i.test(declaredType)) c.macros.push("macro_enabled_type");
        if (!c.macros.length) return done(stored(bytes, declaredType), ["office_checked"]);
        if (!route.office.allowMacros) return refuse("office_macros", c.macros);
        return done(
          stored(bytes, declaredType),
          ["office_checked", "office_macros_allowed"],
          c.macros,
        );
      }
    }
  }
}

/** One call: `new UploadPipeline(options).release(input, route)`. */
export function releaseUpload(
  input: UploadInput,
  route: UploadRouteInput,
  options: UploadPipelineOptions,
): Promise<UploadRelease> {
  return new UploadPipeline(options).release(input, route);
}
