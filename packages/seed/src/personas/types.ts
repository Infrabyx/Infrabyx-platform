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
}

export interface ServiceAccount {
  key: string;
  label: string;
  role: string;
  /** `<product>-<suffix>` client id. */
  clientSuffix: string;
}
