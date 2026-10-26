// IDENTITY port — PL1 defines verified token claims and the provisioning call seeds need
// (decision D-02). The full interface lands with the Keycloak adapter in PL2.
import { z } from "zod";
import { PrincipalType, RoleSchema } from "../roles.js";

/** Claims of a token already verified by the IDENTITY adapter. The tenancy context is built only from these. */
export const VerifiedClaims = z.object({
  sub: z.string().min(1),
  /** Tenant id (`tid`). */
  tid: z.string().min(1),
  /** Legal entity id, when the session is entity-scoped. */
  ent: z.string().optional(),
  typ: PrincipalType,
  roles: z.array(RoleSchema),
  product_scope: z.array(z.string()).optional(),
  /** RFC 8693 actor claim, present during impersonation (IPB-02 §02.4.2). */
  act: z.object({ sub: z.string(), sid: z.string() }).optional(),
  /** Break-glass grant id when the token was issued under break-glass (IPB-02 §02.4.2). */
  bg: z.string().optional(),
  mfa: z.boolean().optional(),
  exp: z.number().int(),
  iat: z.number().int(),
});
export type VerifiedClaims = z.infer<typeof VerifiedClaims>;

export interface ProvisionUserSpec {
  email: string;
  displayName: string;
  tenantId: string;
  roles: string[];
  /** Initial password; `temporary` forces a change on first login (IPB-11-37). */
  password?: { value: string; temporary: boolean };
  mfaRequired: boolean;
}

export interface IdentityProvisioning {
  provisionUser(spec: ProvisionUserSpec): Promise<{ id: string }>;
  setPassword(email: string, password: string, temporary: boolean): Promise<void>;
}
