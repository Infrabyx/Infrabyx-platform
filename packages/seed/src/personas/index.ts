// Personas per product (IPB-11-27): common personas plus the product's own, in that order.
import { PRODUCT_EMAIL_LABEL, type ProductCode } from "@infrabyx/contracts/env";
import { COMMON_PERSONAS, COMMON_SERVICE_ACCOUNTS } from "./common.js";
import { EQ_PERSONAS } from "./eq.js";
import { FBX_PERSONAS } from "./fbx.js";
import { LDC_PERSONAS } from "./ldc.js";
import { LD_PERSONAS } from "./ld.js";
import { OH_PERSONAS } from "./oh.js";
import { UDF_PERSONAS } from "./udf.js";
import type { Persona, ServiceAccount } from "./types.js";

export * from "./types.js";
export { COMMON_PERSONAS, COMMON_SERVICE_ACCOUNTS, SUPER_ADMIN_EMAIL } from "./common.js";

export const PRODUCT_PERSONAS: Readonly<Record<ProductCode, readonly Persona[]>> = {
  LD: LD_PERSONAS,
  LDC: LDC_PERSONAS,
  EQ: EQ_PERSONAS,
  FBX: FBX_PERSONAS,
  UDF: UDF_PERSONAS,
  OH: OH_PERSONAS,
};

export function personasFor(product: ProductCode): Persona[] {
  return [...COMMON_PERSONAS, ...PRODUCT_PERSONAS[product]];
}

export function serviceAccountsFor(_product: ProductCode): ServiceAccount[] {
  return [...COMMON_SERVICE_ACCOUNTS];
}

/** `test.<persona>@<label>.test` (IPB-11-33); the super admin keeps its real address (IPB-11-32). */
export function personaEmail(p: Persona, product: ProductCode): string {
  if (p.email) return p.email;
  return `${p.emailLocal ?? p.key}@${PRODUCT_EMAIL_LABEL[product]}.test`;
}
