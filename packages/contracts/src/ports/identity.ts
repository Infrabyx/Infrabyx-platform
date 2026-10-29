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

// ---- customer sign-in (OWNER-QUESTIONS #84 (b), R1-D-19) --------------------------------------
// End users who are not staff (borrowers, clients, parties) sign in with a one-time code, in a
// customer realm (Keycloak) or organisation (Zitadel) of their product, separate from every staff
// realm. Tokens are the IdP's, bound to a per-device ES256 key by DPoP (RFC 9449): each request
// carries a proof made with that key, and the platform verifies it (R1-D-18). Codes go out through
// NOTIFY (`CustomerOtpSender`), never through an IdP's own vendor credentials, and are never
// stored in clear or logged.

export const CUSTOMER_OTP_CHANNELS = ["sms", "whatsapp", "email"] as const;
export const CustomerOtpChannel = z.enum(CUSTOMER_OTP_CHANNELS);
export type CustomerOtpChannel = z.infer<typeof CustomerOtpChannel>;

/** E.164 mobile number (`+91…`) for SMS and WhatsApp. */
export const CustomerPhone = z.string().regex(/^\+[1-9][0-9]{6,14}$/);
/** Email login, compared lowercased. */
export const CustomerEmail = z.email().max(254);

/** The login a customer proves: a mobile number, or an email address for the `email` channel. */
export function customerLogin(channel: CustomerOtpChannel, login: string): string {
  const v = login.trim();
  return channel === "email" ? CustomerEmail.parse(v.toLowerCase()) : CustomerPhone.parse(v);
}

/** One code to deliver. `to` is the login being proven; it is never stored by the sender. */
export interface CustomerOtpMessage {
  tenantId: string;
  /** The IdP user id; NOTIFY records the delivery against `cus:<userId>`. */
  userId: string;
  channel: CustomerOtpChannel;
  to: string;
  code: string;
  expiresAt: Date;
  locale?: string;
  /** Stable per challenge, so a retried send is the same message. */
  idempotencyKey: string;
}

/** Delivery of one-time codes; `@infrabyx/notify` provides the NOTIFY implementation. */
export interface CustomerOtpSender {
  send(message: CustomerOtpMessage): Promise<void>;
}

/** Where the device's sign-in and refresh proofs point: the IdP's token endpoint. */
export interface DpopTarget {
  htm: "POST";
  htu: string;
}

export interface CustomerChallenge {
  /** Opaque; the device sends it back with the code. */
  challengeId: string;
  expiresAt: string;
  /** No new code is sent for this account before this instant. */
  resendAfter: string;
}

export interface CustomerDevice {
  /** `dev_…` */
  id: string;
  /** RFC 7638 thumbprint of the device's DPoP key. */
  jkt: string;
  label?: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt?: string;
}

export interface CustomerSession {
  tokenType: "DPoP";
  accessToken: string;
  refreshToken: string;
  /** Seconds. */
  expiresIn: number;
  device: CustomerDevice;
}

/** Claims of a verified customer request: the token's, with the device that proved it. */
export interface VerifiedCustomerClaims extends VerifiedClaims {
  /** Thumbprint of the key that signed this request's proof. */
  jkt: string;
  deviceId: string;
}

/**
 * Customer sign-in through the IDENTITY port. Refusals: `IPB-IDN-001` (code, challenge, token or
 * proof; `meta.reason` says which), `IPB-SEC-019` (rate limit or lockout; `meta.retryAfterSeconds`),
 * `IPB-IDN-002` (IdP unavailable for new sessions).
 */
export interface CustomerIdentityPort extends Port {
  /** The target of the proofs sent with `startChallenge`, `verifyChallenge` and `refreshSession`. */
  readonly signInProofTarget: DpopTarget;
  /** Find or create the account for `login` in `tenantId`, then issue a code and deliver it. */
  startChallenge(req: {
    tenantId: string;
    channel: CustomerOtpChannel;
    login: string;
    dpopProof: string;
    locale?: string;
  }): Promise<CustomerChallenge>;
  /** Check the code; the proof's key (the same as at `startChallenge`) becomes the device key. */
  verifyChallenge(req: {
    tenantId: string;
    challengeId: string;
    code: string;
    dpopProof: string;
    deviceLabel?: string;
  }): Promise<CustomerSession>;
  /** Rotate the refresh token; the proof must be by the device's key. */
  refreshSession(req: {
    tenantId: string;
    refreshToken: string;
    dpopProof: string;
  }): Promise<CustomerSession>;
  /** Verify `Authorization: DPoP <token>` with the request's `DPoP` proof. */
  verifyRequest(req: {
    authorization: string;
    dpopProof: string;
    method: string;
    url: string;
  }): Promise<VerifiedCustomerClaims>;
  listDevices(tenantId: string, userId: string): Promise<CustomerDevice[]>;
  /**
   * The customer unbinds the device: it is signed out (its tokens are refused within 60 s and its
   * refresh token is dead) and deleted at once (owner answer #86).
   */
  revokeDevice(tenantId: string, userId: string, deviceId: string): Promise<void>;
  /** The customer closed the account: every device is signed out and deleted at once. */
  forgetDevices(tenantId: string, userId: string): Promise<void>;
}
