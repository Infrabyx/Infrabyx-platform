# R1 plan: the upload pipeline after the AV scan (PR-FBX-56)

Finbyx PR-FBX-56 (its owner answers #326 (c) and #333), taken as the owner's request of 25 Nov 2026, 22:35 IST (R1-D-289 (5)); built as R1-D-292. Spec of record: IPB-02-44 (the file-upload pipeline) and its acceptance test `@IPB-02-AT-16` (the upload corpus), IPB-02 §02.6.3 (`IPB-SEC-010` to `-015`), IPB-01 MEDIA and AV ports, IPB-04-21 (the SVG sanitiser). Nothing under `docs/ipb/` or `docs/ecosystem/` is edited.

## A. What Finbyx asked for

(a) One platform step a product calls on every upload that scanned CLEAN, applying what its type needs and answering the bytes to store or a refusal code: raster images re-encoded through MEDIA (metadata stripped), with a route option `keepOriginalAsEvidence` (the original returned unchanged as the record and a re-encoded viewing copy beside it, both hashes; Finbyx #333); SVG sanitised or rasterised; PDFs checked for JavaScript and launch actions (names with `#xx` escapes and inside object streams) and flattened or refused by route; Office files refused with macros or ActiveX, and legacy OLE Office refused, unless the route allows them. (b) The IPB-02-44 corpus as `testing` contract cases. (c) Guidance for evidentiary uploads. (d) Whether STORAGE's signed download URLs carry `Content-Disposition: attachment`.

## B. Interface (minors of `contracts`, `connectors`, `testing`)

```ts
import { releaseUpload } from "@infrabyx/connectors/upload";
import { SharpMedia } from "@infrabyx/connectors/media";
import { sanitiseSvg } from "@infrabyx/brand";

const route = {
  name: "fv.photos",
  accept: ["image/jpeg", "image/png", "application/pdf"],
  maxBytes: 10 * 1024 * 1024,
  raster: { keepOriginalAsEvidence: true },
  pdf: { onActive: "refuse" },
};
const scan = await av.scan({ storageKey, sha256 }); // FILE_SCAN, before anyone reads the file
const r = await releaseUpload({ bytes, declaredType, scan }, route, {
  media: new SharpMedia(),
  sanitiseSvg: (b) => sanitiseSvg(b),
});
if (!r.released) throw new IpbError(r.code, { meta: { reason: r.reason } });
await storage.put(key, r.record.bytes, { contentType: r.record.mime, ... }); // r.record.sha256
if (r.viewing) await storage.put(viewKey, r.viewing.bytes, { ... }); // r.viewing.sha256
```

- `contracts/ports/upload.ts`: `UploadRoute` (zod; `accept`, `maxBytes`, `raster.keepOriginalAsEvidence`, `svg.mode` `refuse` by default, `pdf.onActive` `refuse` by default and `pdf.refuseAlso`, `office.allowMacros` false by default), `UPLOAD_TYPES`, `PDF_ACTIVE_NAMES`, `PDF_REPORTED_NAMES`, `UPLOAD_REFUSAL_REASONS` and their codes, `UploadRelease`, the inflation limits. `presignAttachment` and `PRESIGN_ATTACHMENT_DISPOSITION` in `ports/storage.ts`.
- `connectors/upload`: `releaseUpload` and `UploadPipeline`; `checkPdf`, `checkOoxml`, `sniffType`, `polyglotMarkers`. The SVG sanitiser and a PDF flattener are injected (`sanitiseSvg` of `@infrabyx/brand`; no reference flattener yet), so the package graph is unchanged; without them SVG and active PDFs are refused.
- `testing`: `uploadCorpus` (every file built from bytes) and `uploadCorpusContractCases()` against a product's `{ upload(file), accepts }`.
- `connectors/storage`: every presigned GET but `PUBLIC_ASSETS` signs `response-content-disposition: attachment`.

## C. The order of checks

1. The scan proof is a CLEAN scan of exactly these bytes (`assertScannedClean`): otherwise `IPB-SEC-011`, or `IPB-SEC-015` for a scan of other bytes.
2. The declared type is on the route's list (`IPB-SEC-014`) and the size within `maxBytes` (`IPB-SEC-013`).
3. The bytes' own type agrees with the declared one (`IPB-SEC-010`); a legacy Office type must be an OLE file and an OOXML type a zip.
4. Raster: markup anywhere in the bytes (a polyglot) is `IPB-SEC-010`; otherwise MEDIA re-encodes at the source width in the same format (EXIF, XMP, IPTC and ICC dropped, trailing bytes gone). The record is the copy, or with `keepOriginalAsEvidence` the unchanged original with the copy as `viewing`.
5. SVG: refused by default; `sanitise` stores the sanitiser's re-serialised output; `rasterise` stores a PNG of it.
6. PDF (rebuilt on review): every name anywhere in the file, and in whatever each stream's data decodes to (Flate, ASCII85, ASCIIHex, RunLength, PNG predictors found from the data's row structure), `#xx` decoded; encryption, LZW, Crypt, the TIFF predictor, more than 20,000 streams or decoding past the limits are refused (fail closed). `JavaScript`, `JS`, `Launch`, `RichMedia`, `XFA`, `SubmitForm` and `ImportData` are active; `OpenAction`, `AA`, `EmbeddedFile(s)`, `URI`, `GoToR` and `GoToE` are reported and refused only where the route lists them. Active: refused, or flattened by the injected flattener and checked again.
7. Office: OOXML part names, `[Content_Types].xml` and every `.rels` (a VBA part under any name, ActiveX, Excel 4 macro sheets, a macro-enabled type); every entry inflated within 256 MiB and a 200:1 ratio (a zip bomb is `IPB-SEC-013`); encrypted or damaged zips refused. Legacy OLE is refused unless macros are allowed.

## D. Tests

`packages/connectors/src/upload/__tests__/release.test.ts` (`@IPB-02-AT-16`): the corpus cases on a route accepting every type and on a narrow Finbyx-like route, re-encoding on `sharp` (metadata gone), `keepOriginalAsEvidence` (both hashes), every refusal reason, PDF names hidden in object streams, behind `#xx` and after `/Length`, the flattener path (missing, output still active, failing), Office macros, ActiveX, legacy OLE, macro-enabled types and damaged zips. `presign-no-cache.test.ts`: the attachment disposition on every class but `PUBLIC_ASSETS`, not removable by the caller.

## E. Decisions (R1-D-292, `[ASSUMED – owner review]`, owner question #208)

The injected sanitiser and flattener (no reference flattener: AT-16's "flattened, JS removed" row needs one, a follow-up); the active and reported PDF names; the polyglot markers; GIF not accepted (no re-encoding of animation); the inflation limits; legacy OLE counted as macro-bearing; the attachment disposition for every class but `PUBLIC_ASSETS`; and the answer to (c): an evidentiary upload keeps the original as the record with `keepOriginalAsEvidence`, so its SHA-256 stays the record's, and the re-encoded copy is for viewing only.

## F. Exit gate

`pnpm turbo run build lint typecheck test --filter=@infrabyx/contracts --filter=@infrabyx/connectors --filter=@infrabyx/testing`; `node scripts/ipb-check.mjs`; Prettier. Changesets: `contracts`, `connectors`, `testing` minors. Threat model §3.193; guide §7fa.
