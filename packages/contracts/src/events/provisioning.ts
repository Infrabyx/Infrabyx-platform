// Provisioning events of Ecosystem Spec §6.29 (all regulated messages, §3.6), for the Operations
// Hub provisioning adapter (LawDocsComply PR-LDC-11; R1-plan M38; R1-D-68, R1-D-70):
// - `TenantProvisioned` (N11): the Hub's approved provisioning request;
// - `ProvisioningRequested` (N13, v1.3): a product asks the Hub to provision a provisional tenant;
// - `ProvisioningFailed` (N13, v1.3): the Hub will not provision a request, and why.
// v1.3 is PR-040, signed off by the owner on 4 Nov 2026 (OWNER-QUESTIONS #105). The Spec names the
// payload fields but publishes no schema yet, so the field names below are the Spec's words in
// snake case, checked against the Hub's registry schemas when they are published ([VERIFY]);
// unknown fields pass through untouched.
import { z } from "zod";

export const TENANT_PROVISIONED_TYPE = "in.infrabyx.ops.TenantProvisioned.v1";

/** `TenantProvisioned.product` takes the long forms (Spec §6 code table `product`). */
export const PROVISIONING_PRODUCTS = {
  FINBYX: "FBX",
  UDOFIN: "UDF",
  EQUATOR: "EQ",
  LAWDOCSCOMPLY: "LDC",
  LAWDOCS: "LD",
  OPERATIONS_HUB: "OH",
} as const;
export type ProvisioningProduct = keyof typeof PROVISIONING_PRODUCTS;

export const PROVISIONING_ENVIRONMENTS = ["SANDBOX", "UAT", "PRODUCTION"] as const;
export type ProvisioningEnvironment = (typeof PROVISIONING_ENVIRONMENTS)[number];

export const TenantProvisionedData = z
  .object({
    provisioning_request_id: z.string().min(1).max(128),
    org_id: z.string().min(1).max(128),
    product: z.enum(Object.keys(PROVISIONING_PRODUCTS) as [ProvisioningProduct]),
    environment: z.enum(PROVISIONING_ENVIRONMENTS),
    deployment_model: z.enum(["SAAS", "DEDICATED", "ON_PREM"]).optional(),
    legal_entities: z
      .array(
        z
          .object({ legal_entity_id: z.string().optional(), name: z.string().min(1).max(200) })
          .loose(),
      )
      .optional(),
    plan_ref: z.string().min(1).max(128).optional(),
    entitlement_ref: z.string().min(1).max(128).optional(),
    residency: z.enum(["IN", "IN-ZR", "GLOBAL"]).optional(),
    msa_ref: z.string().min(1).max(200).optional(),
    dpa_ref: z.string().min(1).max(200).optional(),
    out_clause_matrix_ref: z.string().min(1).max(200).optional(),
    /** Business contact data under `legalbasis = CONTRACT_PERFORMANCE_VENDOR`; never a password. */
    first_admin_email: z.email().max(254).optional(),
    /** Spec v1.3 (PR-040): the provisional tenant id, when the request came from the product. */
    provisional_tenant_id: z
      .string()
      .regex(/^tnt_[0-9A-HJKMNP-TV-Z]{26}$/)
      .optional(),
  })
  .loose();
export type TenantProvisionedData = z.infer<typeof TenantProvisionedData>;

/** Spec v1.3 §6.29: a product's request to the Hub (N13; regulated, signed by the product). */
export const PROVISIONING_REQUESTED_TYPE = "in.infrabyx.ops.ProvisioningRequested.v1";
/** Spec v1.3 §6.29: the Hub's refusal or abandonment of a request (N13; regulated, signed by OH). */
export const PROVISIONING_FAILED_TYPE = "in.infrabyx.ops.ProvisioningFailed.v1";

/** Spec v1.3 §6.29 code table `provisioning_failure_reason`. */
export const PROVISIONING_FAILURE_REASONS = [
  "DUPLICATE_ORG",
  "KYB_FAILED",
  "PLAN_UNAVAILABLE",
  "RESIDENCY_UNAVAILABLE",
  "CONTRACT_MISSING",
  "REJECTED_BY_CHECKER",
  "EXPIRED",
  "PRODUCT_FAILED",
  "OTHER",
] as const;
export type ProvisioningFailureReason = (typeof PROVISIONING_FAILURE_REASONS)[number];
/** The reasons for which `retryable` is true (Spec v1.3 §6.29); for every other it is false. */
export const RETRYABLE_PROVISIONING_FAILURES: ReadonlySet<ProvisioningFailureReason> = new Set([
  "PLAN_UNAVAILABLE",
  "RESIDENCY_UNAVAILABLE",
  "EXPIRED",
  "PRODUCT_FAILED",
]);
/**
 * Spec v1.3 §6.29 retention: a provisional tenant whose request failed or expired is purged by the
 * requesting product, with its first-admin contact data, within 30 days of `failed_at` (unless a
 * retry under a new request id is open), and the purge is ledgered (DPDP Act 2023 s.8(7)).
 */
export const PROVISIONAL_TENANT_PURGE_DAYS = 30;

const TENANT_ID = z.string().regex(/^tnt_[0-9A-HJKMNP-TV-Z]{26}$/);
const REQUEST_ID = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "a UUIDv7");

export const ProvisioningRequestedData = z
  .object({
    provisioning_request_id: REQUEST_ID,
    provisional_tenant_id: TENANT_ID,
    product: z.enum(Object.keys(PROVISIONING_PRODUCTS) as [ProvisioningProduct]),
    environment: z.enum(PROVISIONING_ENVIRONMENTS),
    plan_id: z.string().min(1).max(128),
    modules: z.array(z.string().min(1).max(64)).max(64),
    home_cell: z.string().min(1).max(64),
    org_name: z.string().min(1).max(200),
    /** CIN, LLPIN or GSTIN where known: a business identifier only. */
    org_ref: z.string().min(1).max(32).optional(),
    /** The requester's acceptance of the terms, by reference. */
    consent_ref: z.string().min(1).max(128),
    /** Business contact data under `legalbasis = CONTRACT_PERFORMANCE_VENDOR`; never a password. */
    first_admin_email: z.email().max(254).optional(),
    requested_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ProvisioningRequestedData = z.infer<typeof ProvisioningRequestedData>;

export const ProvisioningFailedData = z
  .object({
    provisioning_request_id: z.string().min(1).max(128),
    provisional_tenant_id: TENANT_ID,
    product: z.enum(Object.keys(PROVISIONING_PRODUCTS) as [ProvisioningProduct]),
    environment: z.enum(PROVISIONING_ENVIRONMENTS),
    reason_code: z.enum(PROVISIONING_FAILURE_REASONS),
    retryable: z.boolean(),
    /** At most 500 characters and no personal data (Spec v1.3 §6.29). */
    detail: z.string().max(500).optional(),
    failed_at: z.iso.datetime({ offset: true }),
  })
  .loose()
  .superRefine((d, ctx) => {
    if (d.retryable !== RETRYABLE_PROVISIONING_FAILURES.has(d.reason_code))
      ctx.addIssue({
        code: "custom",
        path: ["retryable"],
        message: `retryable must be ${!d.retryable} for ${d.reason_code} (Spec v1.3 §6.29)`,
      });
  });
export type ProvisioningFailedData = z.infer<typeof ProvisioningFailedData>;
