// Personas per product (IPB-11-27): common personas plus the product's own, in that order.
import { PRODUCT_EMAIL_LABEL, type ProductCode } from "@infrabyx/contracts/env";
import { COMMON_PERSONAS, COMMON_SERVICE_ACCOUNTS } from "./common.js";
import { EQ_PERSONAS } from "./eq.js";
import { FBX_PERSONAS } from "./fbx.js";
import { LDC_PERSONAS } from "./ldc.js";
import { LD_PERSONAS } from "./ld.js";
import { OH_PERSONAS } from "./oh.js";
import { UDF_PERSONAS } from "./udf.js";
import { IpbError } from "@infrabyx/contracts/errors";
import type { Persona, PersonaRoles, ServiceAccount } from "./types.js";

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

/** At most this many product roles per persona. */
export const MAX_PRODUCT_ROLES = 8;

/**
 * What is wrong with a product's `personaRoles` (LDC-69, R1-D-325), or nothing: an unknown persona
 * key, a persona of the platform tenant, a role not named `<PRODUCT>_<NAME>`, a repeated role, or
 * more than `MAX_PRODUCT_ROLES` on one persona. A product role never widens a platform role: the
 * `PLT_` and `ORG_` names are not the product's, so they are refused here.
 */
export function personaRoleProblems(product: ProductCode, roles: PersonaRoles): string[] {
  const all = [...COMMON_PERSONAS, ...PRODUCT_PERSONAS[product]];
  const pattern = new RegExp(`^${product}_[A-Z0-9][A-Z0-9_]{0,47}$`);
  const out: string[] = [];
  for (const [key, list] of Object.entries(roles)) {
    const p = all.find((x) => x.key === key);
    if (!p) out.push(`${key}: no such persona for ${product}`);
    else if (p.tenant === "platform") out.push(`${key}: a platform persona takes no product role`);
    if (!Array.isArray(list) || list.length > MAX_PRODUCT_ROLES)
      out.push(`${key}: 0 to ${MAX_PRODUCT_ROLES} roles`);
    const seen = new Set<string>();
    for (const r of Array.isArray(list) ? list : []) {
      if (typeof r !== "string" || !pattern.test(r))
        out.push(`${key}: ${String(r)} is not a ${product}_ role`);
      else if (seen.has(r) || r === p?.role) out.push(`${key}: ${r} repeated`);
      seen.add(String(r));
    }
  }
  return out;
}

/**
 * `superAdminEmail` is `AUTH_SUPER_ADMIN_EMAIL`; without it the super admin keeps the placeholder.
 * `personaRoles` adds the product's own roles (LDC-69); anything `personaRoleProblems` names is
 * refused with IPB-SEED-003 before any persona is returned.
 */
export function personasFor(
  product: ProductCode,
  superAdminEmail?: string,
  personaRoles?: PersonaRoles,
): Persona[] {
  if (personaRoles) {
    const problems = personaRoleProblems(product, personaRoles);
    if (problems.length)
      throw new IpbError("IPB-SEED-003", {
        detail: `persona roles refused: ${problems.join("; ")}`,
        meta: { problems },
      });
  }
  const common = superAdminEmail
    ? COMMON_PERSONAS.map((p) => (p.key === "super_admin" ? { ...p, email: superAdminEmail } : p))
    : COMMON_PERSONAS;
  return [...common, ...PRODUCT_PERSONAS[product]].map((p) =>
    personaRoles?.[p.key]?.length ? { ...p, productRoles: [...personaRoles[p.key]!] } : p,
  );
}

/** Every role a persona is seeded with: its platform role, then its product roles. */
export const personaRolesOf = (p: Persona): string[] => [p.role, ...(p.productRoles ?? [])];

export function serviceAccountsFor(_product: ProductCode): ServiceAccount[] {
  return [...COMMON_SERVICE_ACCOUNTS];
}

/** `test.<persona>@<label>.test` (IPB-11-33); the super admin keeps its configured address (IPB-11-32). */
export function personaEmail(p: Persona, product: ProductCode): string {
  if (p.email) return p.email;
  return `${p.emailLocal ?? p.key}@${PRODUCT_EMAIL_LABEL[product]}.test`;
}
