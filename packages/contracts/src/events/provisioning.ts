// `TenantProvisioned` (Ecosystem Spec v1.2 §6.29, N11; a regulated message): the Operations Hub's
// approved provisioning request, consumed by the provisioning adapter (LawDocsComply PR-LDC-11;
// R1-plan M38; R1-D-68). The Spec names the payload's fields but publishes no schema yet, so the
// field names below are the Spec's words in snake case and are checked against the Hub's
// registry schema when it is published ([VERIFY]); unknown fields pass through untouched.
// `provisional_tenant_id` is PR-040's v1.3 addition, optional until v1.3 is signed off.
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
    /** PR-040 (v1.3): the provisional tenant id the product already holds. */
    provisional_tenant_id: z
      .string()
      .regex(/^tnt_[0-9A-HJKMNP-TV-Z]{26}$/)
      .optional(),
  })
  .loose();
export type TenantProvisionedData = z.infer<typeof TenantProvisionedData>;
