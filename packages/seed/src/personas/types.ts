import type { ProductCode } from "@infrabyx/contracts/env";

export type SeedTenant = "platform" | "demo" | "sandbox";

export interface Persona {
  /** Stable key; vault path segment and natural key. */
  key: string;
  label: string;
  role: string;
  tenant: SeedTenant;
  /** Local part of `<local>@<product label>.test`, or a fixed address (super admin only). */
  emailLocal?: string;
  email?: string;
  productScope?: readonly ProductCode[];
  /** MFA always required, in every environment (IPB-11-37). */
  mfaAlways?: boolean;
  /**
   * The product's own roles for this persona (LDC-69, R1-D-325), seeded beside `role`: each named
   * `<PRODUCT>_…`, never on a platform-tenant persona. Set by the product through `personaRoles`.
   */
  productRoles?: readonly string[];
}

/**
 * A product's own roles per persona key (LDC-69): `{ "test.compliance_head": ["LDC_COMPLIANCE_HEAD"] }`.
 * The product exports it from its seed adapters module (`seedAdapters.personaRoles`).
 */
export type PersonaRoles = Readonly<Record<string, readonly string[]>>;

export interface ServiceAccount {
  key: string;
  label: string;
  role: string;
  /** `<product>-<suffix>` client id. */
  clientSuffix: string;
}
