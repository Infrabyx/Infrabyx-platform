// The tenant brand layer (LawDocsComply PR-LDC-26; R1-D-87, M57; IPB-04-24, IPB-04 §04.5): what a
// tenant may set over its product's pack, and how it is applied. Only these fields exist; the legal
// entity, terminology, policy set, consent, store identity, analytics, footer and sitemap always
// come from the pack. Pure: no storage, no database (the guards that need them are in
// `tenant-layer.ts`).
import { z } from "zod";
import { BrandPackBody, MediaRef } from "./shape.js";

/** The colour token names a pack defines; a tenant may set only these. */
export const COLOUR_TOKENS = ["primary", "accent", "surface", "on_surface"] as const;
export type ColourToken = (typeof COLOUR_TOKENS)[number];

export const TENANT_LOGIN_MESSAGE_MAX = 280;
/** Letterhead header and footer text (PR-LDC-43): plain text, at most 2,000 characters each. */
export const TENANT_LETTERHEAD_TEXT_MAX = 2000;
/**
 * Subdomain labels a tenant may never take under its product's app host (PR-LDC-43): the
 * platform's and the product's own service names, and names that read as an official channel.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = Object.freeze([
  "www",
  "app",
  "api",
  "admin",
  "auth",
  "id",
  "login",
  "sso",
  "oauth",
  "account",
  "accounts",
  "mail",
  "email",
  "smtp",
  "imap",
  "mx",
  "status",
  "help",
  "support",
  "docs",
  "static",
  "cdn",
  "assets",
  "media",
  "files",
  "storage",
  "public",
  "trust",
  "security",
  "legal",
  "billing",
  "pay",
  "payments",
  "sandbox",
  "staging",
  "dev",
  "test",
  "demo",
  "internal",
  "platform",
  "ops",
  "infrabyx",
  "ldc",
  "fbx",
  "udf",
  "eqr",
  "ld",
  "oh",
]);
export const TENANT_FROM_NAME_MAX = 80;

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "a colour as #RRGGBB");
const hostname = z
  .string()
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
    "a lower-case host name",
  );

// C0 and C1 controls (a newline is allowed only where stated), bidirectional overrides and marks
// (display spoofing), angle brackets and character references (markup).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;
const NEWLINE = /[\r\n\u2028\u2029]/;
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const MARKUP = /[<>]|&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

/** Why a value is not plain text, or null when it is. */
export function plainTextProblem(s: string, o: { multiline: boolean }): string | null {
  if (CONTROL.test(s)) return "control characters are not allowed";
  if (!o.multiline && NEWLINE.test(s)) return "a single line is required";
  if (BIDI.test(s)) return "bidirectional control characters are not allowed";
  if (MARKUP.test(s)) return "markup is not allowed (no <, > or character references)";
  return null;
}

// A scheme that runs or loads something when text is rendered as a link (PR-LDC-43): letterhead
// text is shown as text, but a renderer that auto-links must never find one.
const RUNNING_URL = /\b(?:javascript|vbscript|data|file|blob)\s*:/i;

const label = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, "one lower-case host label (a-z, 0-9, -)")
  .refine((l) => !l.startsWith("xn--"), "an internationalised (xn--) label is not allowed")
  .refine((l) => !RESERVED_SUBDOMAINS.includes(l), "this subdomain is reserved");

const plainText = (max: number, multiline: boolean) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .superRefine((s, c) => {
      const p = plainTextProblem(s, { multiline });
      if (p) c.addIssue({ code: "custom", message: p });
    });

export const TenantLayerBody = z
  .object({
    /** Overrides of the pack's colour tokens; an unknown token name is refused. */
    colour: z
      .object({
        primary: hex.optional(),
        accent: hex.optional(),
        surface: hex.optional(),
        on_surface: hex.optional(),
      })
      .strict()
      .optional(),
    /** A sanitised SVG logo (`TenantBrandLayers.uploadSvg`), with its rasterised PNGs. */
    logo: BrandPackBody.shape.logo,
    /** A sanitised SVG favicon (`icon.svg`); the logo serves when absent. */
    favicon: MediaRef.optional(),
    /** The letterhead asset (PDF, PNG, JPEG or a sanitised SVG) in the tenant's own storage. */
    letterhead: MediaRef.optional(),
    /** Sender identity; the address's domain must be a verified email domain (IPB-04-28). */
    email_identity: z
      .object({
        from_name: plainText(TENANT_FROM_NAME_MAX, false).refine(
          (s) => !/["@]/.test(s),
          "a display name without quotes or an address",
        ),
        from_address: z.email(),
      })
      .strict()
      .optional(),
    /** The tenant's own host; unique group-wide across pack hosts and tenant domains. */
    domain: hostname.optional(),
    /** Shown on the login screen as plain text. */
    login_message: plainText(TENANT_LOGIN_MESSAGE_MAX, true).optional(),
    /** Letterhead header and footer as plain text (PR-LDC-43), beside or instead of the asset. */
    letterhead_text: z
      .object({
        header: plainText(TENANT_LETTERHEAD_TEXT_MAX, true)
          .refine((t) => !RUNNING_URL.test(t), "no javascript:, data: or similar links")
          .optional(),
        footer: plainText(TENANT_LETTERHEAD_TEXT_MAX, true)
          .refine((t) => !RUNNING_URL.test(t), "no javascript:, data: or similar links")
          .optional(),
      })
      .strict()
      .refine((t) => t.header !== undefined || t.footer !== undefined, "a header or a footer")
      .optional(),
    /** The cover of generated PDFs (PR-LDC-43): an asset checked like the letterhead. */
    cover: MediaRef.optional(),
    /**
     * A host label under the product's app host (PR-LDC-43): `acme` serves `acme.<app host>`.
     * Unique group-wide like a domain; DNS and certificates are the product's deployment.
     */
    subdomain: label.optional(),
  })
  .strict();
export type TenantLayerBody = z.infer<typeof TenantLayerBody>;
export type TenantLayerBodyInput = z.input<typeof TenantLayerBody>;

/** The fields a layer sets, in a stable order (the checker's diff and the ledger). */
export const layerFields = (l: TenantLayerBody): string[] =>
  (Object.keys(TenantLayerBody.shape) as (keyof TenantLayerBody)[]).filter(
    (k) => l[k] !== undefined && !(k === "colour" && !Object.keys(l.colour ?? {}).length),
  );

/** The colour set a layer produces over a pack's. */
export function layerColours(
  pack: BrandPackBody["tokens"]["colour"],
  layer: TenantLayerBody | null,
): BrandPackBody["tokens"]["colour"] {
  const out = { ...pack };
  for (const k of COLOUR_TOKENS) {
    const v = layer?.colour?.[k];
    if (v) out[k] = v;
  }
  return out;
}

/**
 * The pack body with the layer applied: colours, logo and email identity from the layer when set;
 * everything else, including the legal entity and terminology, from the pack. A tenant identity
 * replaces the pack's reply-to and DKIM selector, which belong to the pack's own domain.
 */
export function applyTenantLayer(
  pack: BrandPackBody,
  layer: TenantLayerBody | null,
  o: { colours?: boolean } = {},
): BrandPackBody {
  if (!layer) return pack;
  return BrandPackBody.parse({
    ...pack,
    tokens: {
      ...pack.tokens,
      colour: o.colours === false ? pack.tokens.colour : layerColours(pack.tokens.colour, layer),
    },
    logo: layer.logo ?? pack.logo,
    email_identity: layer.email_identity
      ? {
          from_name: layer.email_identity.from_name,
          from_address: layer.email_identity.from_address,
        }
      : pack.email_identity,
  });
}

/** The email domain a layer sends from, lower case. */
export const layerEmailDomain = (l: TenantLayerBody): string | null =>
  l.email_identity ? l.email_identity.from_address.split("@")[1]!.toLowerCase() : null;
