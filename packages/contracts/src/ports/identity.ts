// IDENTITY port (IPB-01 §01.4.4.2, IPB-02 §02.3.A). PL1 defined the verified claims and the
// provisioning calls seeds need; PL2 adds the full interface (plan §6.5).
import { z } from "zod";
import { PrincipalType, RoleSchema } from "../roles.js";
import type { Port } from "./common.js";

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
  /** Session id, checked against revoked sessions (IPB-02-05). */
  sid: z.string().optional(),
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

export interface IdentityUser {
  id: string;
  email: string;
  displayName: string;
  enabled: boolean;
  tenantId: string;
  roles: string[];
  mfaEnrolled: boolean;
}

/** SCIM 2.0 operations applied to the IdP (IPB-02-05; PL2-D-27 for Keycloak). */
export type ScimOp =
  | { op: "create"; user: ProvisionUserSpec & { externalId: string } }
  | {
      op: "update";
      externalId: string;
      patch: Partial<Pick<IdentityUser, "displayName" | "enabled" | "roles">>;
    }
  | { op: "deactivate"; externalId: string };

export interface IdentityPort extends Port, IdentityProvisioning {
  /** Exchange a login assertion (authorisation code, SAML response) for tokens. */
  authenticate(assertion: {
    kind: "oidc_code" | "saml";
    value: string;
    redirectUri?: string;
    /** PKCE verifier (RFC 7636, S256); required for `oidc_code` by both platform IdPs. */
    codeVerifier?: string;
  }): Promise<{ accessToken: string; idToken?: string; refreshToken?: string; expiresIn: number }>;
  getUser(id: string): Promise<IdentityUser>;
  linkFederation(userId: string, idp: { alias: string; subject: string }): Promise<void>;
  /** Client-credentials or RFC 8693 token exchange (impersonation `act`). */
  issueToken(
    claims: { subject: string; audience: string; actor?: string },
    ttlSeconds: number,
  ): Promise<{ accessToken: string; expiresIn: number }>;
  /** Verifies with cached JWKS (24 h) under the per-issuer algorithm allow-list (C-11); IPB-IDN-001 on failure. */
  verifyToken(jwt: string): Promise<VerifiedClaims>;
  scimSync(
    ops: readonly ScimOp[],
  ): Promise<Array<{ externalId: string; ok: boolean; error?: string }>>;
  /** OIDC back-channel logout token; revokes the session it names (PR-012). */
  handleLogoutToken(jwt: string): Promise<{ sid?: string; sub?: string }>;
  /** Revoke every session of a user; old tokens fail within 60 s (IPB-02-05, PR-012). */
  revokeSessions(userId: string): Promise<{ revoked: number }>;
}
