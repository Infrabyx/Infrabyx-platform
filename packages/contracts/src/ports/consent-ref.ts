// The consent reference a port call carries (Udofin PR-UDF-049, PR-UDF-050; R1-D-203, R1-D-204):
// the platform's purpose-consent receipt (`cpr_<ULID>`, `@infrabyx/consent` `PurposeConsents`) or
// a product's own consent artefact (`{ kind, id }`), so a product with its own purpose-consent
// ledger does not mint a second id. The Ecosystem Spec makes the capturing product the owner of
// the artefact and its `consentref` (Part 5.2 row 29, Principle 5).
//
// What the platform verifies for a product artefact is its shape only, here, before anything
// leaves: it cannot look the artefact up, so the product asserts by passing it that the artefact
// exists, is granted, names the purpose, the RE and the categories, is unexpired and not withdrawn,
// and the reference is echoed on the answer so the product's own ledger records it
// ([ASSUMED – owner review] #153). The same holds for a `cpr_` (the port checks its format; the
// product checks it with `PurposeConsents`). Neither form is sent to a vendor.
//
// A product reference holds no personal data: its `kind` is a fixed label and its `id` a bounded
// identifier, and both are refused when they hold a run of 10 or more digits standing alone (a
// mobile, account, Aadhaar or VID number; digits inside a run of letters and digits, as in a ULID,
// are part of that run), anything `findAadhaarLike` finds anywhere (grouped forms included), or a
// PAN-shaped run standing alone.
import { z } from "zod";
import { findAadhaarLike } from "../aadhaar.js";
import { ULID_PATTERN } from "../ids.js";

/** The platform's purpose-consent receipt, `cpr_<ULID>` (unchanged since PR-FBX-26). */
export const CONSENT_RECEIPT_REF_REGEX = new RegExp(`^cpr_${ULID_PATTERN}$`);
export const ConsentReceiptRef = z.string().regex(CONSENT_RECEIPT_REF_REGEX);

/** One to four dot-separated segments, each `[a-z][a-z0-9_]*`, e.g. `udf.purpose_consent`. */
export const PRODUCT_CONSENT_KIND_REGEX = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,3}$/;
/** Letters, digits, `.`, `_` and `-`, starting and ending with a letter or digit. */
export const PRODUCT_CONSENT_ID_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
export const PRODUCT_CONSENT_KIND_MAX = 64;
export const PRODUCT_CONSENT_ID_MAX = 128;

/** Kinds kept for the platform's own artefacts: a `cpr_` (or `cns_`) goes as the plain string. */
export const RESERVED_CONSENT_KINDS = ["cpr", "cns"] as const;

/** The fixed label of each way a product reference is refused (the Zod issue's message). */
export const PRODUCT_CONSENT_REF_REFUSALS = [
  "consent_kind_invalid",
  "consent_kind_reserved",
  "consent_id_invalid",
  "consent_id_platform",
  "consent_ref_digits",
  "consent_ref_aadhaar_like",
  "consent_ref_pan_like",
] as const;
export type ProductConsentRefRefusal = (typeof PRODUCT_CONSENT_REF_REFUSALS)[number];

const LONG_DIGIT_RUN = /(?<![A-Za-z0-9])[0-9]{10,}(?![A-Za-z0-9])/;
const PAN_SHAPED = /(?<![A-Za-z0-9])[A-Z]{5}[0-9]{4}[A-Z](?![A-Za-z0-9])/;

/**
 * Why `{ kind, id }` is not an acceptable product consent reference, as a fixed label, or
 * `undefined` when it is. The Zod schema below reports the same labels.
 */
export function productConsentRefProblem(
  kind: string,
  id: string,
): ProductConsentRefRefusal | undefined {
  if (
    kind.length < 3 ||
    kind.length > PRODUCT_CONSENT_KIND_MAX ||
    !PRODUCT_CONSENT_KIND_REGEX.test(kind)
  )
    return "consent_kind_invalid";
  if ((RESERVED_CONSENT_KINDS as readonly string[]).includes(kind.split(".")[0]!))
    return "consent_kind_reserved";
  if (id.length < 3 || id.length > PRODUCT_CONSENT_ID_MAX || !PRODUCT_CONSENT_ID_REGEX.test(id))
    return "consent_id_invalid";
  if (/^(?:cpr|cns)_/.test(id)) return "consent_id_platform";
  for (const part of [kind, id]) {
    if (LONG_DIGIT_RUN.test(part)) return "consent_ref_digits";
    if (findAadhaarLike(part).length > 0) return "consent_ref_aadhaar_like";
    if (PAN_SHAPED.test(part)) return "consent_ref_pan_like";
  }
  return undefined;
}

/** A product's own consent artefact: which ledger (`kind`) and its id there. */
export const ProductConsentRef = z
  .object({
    kind: z.string().max(PRODUCT_CONSENT_KIND_MAX),
    id: z.string().max(PRODUCT_CONSENT_ID_MAX),
  })
  .strict()
  .superRefine((r, ctx) => {
    const problem = productConsentRefProblem(r.kind, r.id);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
export type ProductConsentRef = z.infer<typeof ProductConsentRef>;

/** What a port's `consentRef` accepts: a `cpr_` receipt, or a product's own artefact. */
export const PortConsentRef = z.union([ConsentReceiptRef, ProductConsentRef]);
export type PortConsentRef = z.input<typeof PortConsentRef>;

export function isProductConsentRef(ref: PortConsentRef): ref is ProductConsentRef {
  return typeof ref === "object" && ref !== null;
}

/**
 * The reference as text: a `cpr_` unchanged, a product artefact as `<kind>:<id>`. Unambiguous,
 * since neither part holds a colon and a `cpr_` never does. What a result's `consentRef` carries.
 */
export function consentRefText(ref: PortConsentRef): string {
  return isProductConsentRef(ref) ? `${ref.kind}:${ref.id}` : ref;
}

/** Reads `consentRefText`'s answer back, or `undefined` when it is neither form. */
export function parseConsentRefText(text: string): PortConsentRef | undefined {
  if (CONSENT_RECEIPT_REF_REGEX.test(text)) return text;
  const at = text.indexOf(":");
  if (at < 0) return undefined;
  const ref = { kind: text.slice(0, at), id: text.slice(at + 1) };
  return productConsentRefProblem(ref.kind, ref.id) === undefined ? ref : undefined;
}

/**
 * What an answer echoes of the request's consent: `consentRef` as text, and `productConsentRef`
 * (a copy) only when the product form was used, so a `cpr_` answer is exactly as before.
 */
export function consentRefEcho(ref: PortConsentRef): {
  consentRef: string;
  productConsentRef?: ProductConsentRef;
} {
  return isProductConsentRef(ref)
    ? { consentRef: consentRefText(ref), productConsentRef: { kind: ref.kind, id: ref.id } }
    : { consentRef: ref };
}
