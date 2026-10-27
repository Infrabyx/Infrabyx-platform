// The brand pack body (IPB-04 §04.3.2; Ecosystem §5.4 shared shape `tenancy/brand_pack/1.0.0`).
// Hosts travel beside the body (the draft host list on the revision, the published map in
// `brand.host`). Media are references (STORAGE keys plus sha256), never inline binaries.
import { z } from "zod";

export const HOST_ROLES = ["APP", "PUBLIC", "API", "SANDBOX_API", "MAIL"] as const;
export const BRAND_PRODUCTS = ["LD", "LDC", "EQ", "FBX", "UDF", "OH", "GRP"] as const;
export type BrandProduct = (typeof BRAND_PRODUCTS)[number];

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "a colour as #RRGGBB");
const hostname = z
  .string()
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
    "a lower-case host name",
  );

export const MediaRef = z
  .object({
    key: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    content_type: z.string().min(1),
  })
  .strict();
export type MediaRef = z.infer<typeof MediaRef>;

export const HostEntry = z
  .object({ host: hostname, role: z.enum(HOST_ROLES), verified: z.boolean().default(false) })
  .strict();
export type HostEntry = z.infer<typeof HostEntry>;

/** Fields whose change needs a PLT_LEGAL_REVIEWER before publish (Ecosystem §13). */
export const LEGAL_FIELDS = [
  "legal_entity",
  "policy_set_id",
  "consent_config",
  "email_identity",
  "store_identity",
] as const;

export const BrandPackBody = z
  .object({
    app_name: z.string().min(1).max(60),
    terminology_override: z
      .record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().min(1).max(40))
      .default({}),
    legal_entity: z
      .object({
        name: z.string().min(1),
        cin: z
          .string()
          .regex(/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/, "a 21-character CIN")
          .optional(),
        gstin: z
          .string()
          .regex(/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/, "a 15-character GSTIN")
          .optional(),
        registered_office: z.string().min(1),
        entity_type: z.enum([
          "PRIVATE_LIMITED",
          "PUBLIC_LIMITED",
          "LLP",
          "PARTNERSHIP",
          "PROPRIETORSHIP",
          "OTHER",
        ]),
      })
      .strict(),
    tokens: z
      .object({
        colour: z
          .object({
            primary: hex,
            accent: hex,
            surface: hex.default("#FFFFFF"),
            on_surface: hex.default("#111827"),
          })
          .strict(),
        font: z
          .object({
            sans: z.string().min(1),
            mono: z.string().min(1),
            serif: z.string().min(1).nullable().default(null),
          })
          .strict(),
        density: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
        radius: z.enum(["none", "sm", "md", "lg"]).default("md"),
      })
      .strict(),
    logo: z
      .object({
        svg: MediaRef,
        /** PNG sizes from an uploaded PNG master until a raster library is approved (#43). */
        png: z.partialRecord(z.enum(["32", "64", "180", "192", "512"]), MediaRef).default({}),
        dark_variant: MediaRef.optional(),
      })
      .strict()
      .optional(),
    og_default: MediaRef.optional(),
    policy_set_id: z
      .string()
      .regex(/^pol_[0-7][0-9A-HJKMNP-TV-Z]{25}$/)
      .optional(),
    consent_config: z
      .object({
        region_default: z.string().min(2),
        regions: z.array(z.string().min(2)).min(1),
        categories: z.array(z.enum(["necessary", "functional", "analytics", "marketing"])).min(1),
        style: z.enum(["bottom_sheet", "modal", "bar"]).default("bottom_sheet"),
        cmp_notice_version: z.string().min(1),
      })
      .strict()
      .optional(),
    email_identity: z
      .object({
        from_name: z.string().min(1),
        from_address: z.email(),
        reply_to: z.email().optional(),
        dkim_selector: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    store_identity: z
      .object({
        ios_bundle_id: z.string().min(1).optional(),
        android_package: z.string().min(1).optional(),
        store_listing_name: z.string().min(1).optional(),
        developer_account_owner: z.enum(["INFRABYX", "PARTNER"]).optional(),
      })
      .strict()
      .optional(),
    /** O-2: no tag manager and no analytics adapter at launch; only `none` is accepted. */
    analytics: z
      .object({ tag_manager_adapter: z.literal("none"), analytics_adapter: z.literal("none") })
      .strict()
      .default({ tag_manager_adapter: "none", analytics_adapter: "none" }),
    footer_id: z.string().min(1).optional(),
    sitemap: z
      .object({
        include_blog: z.boolean().default(false),
        include_resources: z.boolean().default(true),
      })
      .strict()
      .default({ include_blog: false, include_resources: true }),
  })
  .strict();
export type BrandPackBody = z.infer<typeof BrandPackBody>;
export type BrandPackBodyInput = z.input<typeof BrandPackBody>;

/** The email domain the identity sends from. */
export const emailDomain = (b: BrandPackBody): string | null =>
  b.email_identity ? b.email_identity.from_address.split("@")[1]!.toLowerCase() : null;

/** Which legal-class fields differ between two bodies (a new pack counts every one present). */
export function changedLegalFields(prev: BrandPackBody | null, next: BrandPackBody): string[] {
  return LEGAL_FIELDS.filter(
    (f) => JSON.stringify(prev?.[f] ?? null) !== JSON.stringify(next[f] ?? null),
  );
}
