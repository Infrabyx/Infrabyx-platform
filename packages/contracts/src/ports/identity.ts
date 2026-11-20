// IDENTITY port (IPB-01 §01.4.4.2, IPB-02 §02.3.A). PL1 defined the verified claims and the
// provisioning calls seeds need; PL2 adds the full interface (plan §6.5).
import { z } from "zod";
import { PrincipalType, RoleSchema } from "../roles.js";
import type { Port } from "./common.js";
import { isSecretRef } from "./secrets.js";

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
  /** Authentication methods (RFC 8176), as the IdP reported them; read by the SMS exclusion. */
  amr: z.array(z.string().max(32)).max(16).optional(),
  /** Authentication context class (OIDC `acr`), as the IdP reported it. */
  acr: z.string().max(255).optional(),
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

// ---- refresh-token grant (LawDocsComply PR-LDC-03, R1-D-77) -------------------------------------
// RFC 6749 §6 with rotation: every refresh spends the presented token and returns a new one. A
// spent token presented again means it has been copied: the session it belongs to is revoked
// (its access tokens refused within 60 s, IPB-02-05; its current refresh token dead) and the call
// raises IPB-IDN-001 with `meta.reason: "refresh_reused"`. Refresh tokens are never logged, put in
// an error or stored in clear; adapters that remember them keep a SHA-256 only.

/** `meta.reason` of an IPB-IDN-001 refusal from `refreshSession`. */
export const REFRESH_REFUSAL_REASONS = ["refresh_reused", "refresh_invalid"] as const;
export type RefreshRefusalReason = (typeof REFRESH_REFUSAL_REASONS)[number];

/** Tokens from a refresh: the refresh token is always a new one (rotation is on). */
export interface RefreshedTokens {
  accessToken: string;
  idToken?: string;
  refreshToken: string;
  /** Seconds. */
  expiresIn: number;
}

/** The refresh grant and the check that proves a revoked session (contract cases, fakes). */
export interface IdentitySessionRefresh extends Port {
  /**
   * Exchange a refresh token for new tokens (PR-LDC-03, R1-D-77). Refusals: IPB-IDN-001 with
   * `refresh_reused` (a spent token: the session is revoked first) or `refresh_invalid` (expired,
   * revoked, unknown or another client's); IPB-IDN-002 when the IdP cannot be reached.
   */
  refreshSession(req: { refreshToken: string }): Promise<RefreshedTokens>;
  verifyToken(jwt: string): Promise<VerifiedClaims>;
}

export interface IdentityPort extends Port, IdentityProvisioning {
  /**
   * The refresh-token grant with rotation and reuse detection (PR-LDC-03, R1-D-77); see
   * `IdentitySessionRefresh`. Optional: an adapter without it refuses with IPB-PORT-001
   * `unsupported`.
   */
  refreshSession?(req: { refreshToken: string }): Promise<RefreshedTokens>;
  /**
   * Identity-provider brokers and domain discovery (PR-LDC-09, R1-D-78); see
   * `IdentityBrokerAdmin`. Optional: an adapter without them refuses with IPB-PORT-001
   * `unsupported`.
   */
  upsertIdentityProvider?: IdentityBrokerAdmin["upsertIdentityProvider"];
  removeIdentityProvider?: IdentityBrokerAdmin["removeIdentityProvider"];
  listIdentityProviders?: IdentityBrokerAdmin["listIdentityProviders"];
  discoverIdentityProvider?: IdentityBrokerAdmin["discoverIdentityProvider"];
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

/**
 * Claims of a verified customer request: the token's, with the device that proved it. `acr` and
 * `auth_time` are the platform's (PR-UDF-056; R1-D-244), not the IdP's: the assurance of the
 * session's latest authentication (its sign-in code or its last step-up) and when it happened.
 */
export interface VerifiedCustomerClaims extends VerifiedClaims {
  /** Thumbprint of the key that signed this request's proof. */
  jkt: string;
  deviceId: string;
  /**
   * Epoch seconds of the device session's latest authentication: its sign-in code or, if later,
   * its last step-up. A refresh is not an authentication. Set by the platform adapters.
   */
  auth_time?: number;
}

// ---- customer step-up (Udofin PR-UDF-056; R1-D-244) -------------------------------------------
// A product declares, per sensitive borrower action, the assurance it needs and how old that
// assurance may be (OIDC `acr_values` and `max_age`). A session that is too old answers in the
// RFC 9470 step-up form; the borrower then proves the registered login again with a fresh code,
// bound to the same device key, and the session's `acr` and `auth_time` move to that step-up.

/** Customer assurance levels, weakest first. `otp`: a one-time code to the account's login. */
export const CUSTOMER_ACR_VALUES = ["otp"] as const;
export const CustomerAcr = z.enum(CUSTOMER_ACR_VALUES);
export type CustomerAcr = z.infer<typeof CustomerAcr>;

/** Bounds of a policy's max age in seconds; the default is a fresh code within five minutes. */
export const CUSTOMER_STEP_UP_MAX_AGE = Object.freeze({ default: 300, min: 60, max: 3600 });

/** What one sensitive action needs: at least `acr`, proved at most `maxAgeSeconds` ago. */
export const CustomerStepUpPolicy = z.strictObject({
  acr: CustomerAcr.default("otp"),
  maxAgeSeconds: z
    .number()
    .int()
    .min(CUSTOMER_STEP_UP_MAX_AGE.min)
    .max(CUSTOMER_STEP_UP_MAX_AGE.max)
    .default(CUSTOMER_STEP_UP_MAX_AGE.default),
});
export type CustomerStepUpPolicyInput = z.input<typeof CustomerStepUpPolicy>;
export type CustomerStepUpPolicy = z.output<typeof CustomerStepUpPolicy>;

/** The default policy (e.g. downloading an original document): a fresh code within 300 s. */
export const CUSTOMER_STEP_UP_DEFAULT: Readonly<CustomerStepUpPolicy> = Object.freeze({
  acr: "otp",
  maxAgeSeconds: CUSTOMER_STEP_UP_MAX_AGE.default,
});

/** A sensitive action's name in a product's policy table, e.g. `document.original.download`. */
export const CustomerStepUpAction = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/);

/**
 * Validate and freeze a product's policy table at boot, so a typo fails at start rather than at
 * the borrower's request. Entries may leave out `acr` and `maxAgeSeconds` (the defaults).
 */
export function customerStepUpPolicies<K extends string>(
  table: Readonly<Record<K, CustomerStepUpPolicyInput>>,
): Readonly<Record<K, Readonly<CustomerStepUpPolicy>>> {
  const out = {} as Record<K, Readonly<CustomerStepUpPolicy>>;
  for (const [action, input] of Object.entries(table) as Array<[K, CustomerStepUpPolicyInput]>) {
    if (!CustomerStepUpAction.safeParse(action).success)
      throw new TypeError(`customerStepUpPolicies: "${action}" is not an action name`);
    const p = CustomerStepUpPolicy.safeParse(input);
    if (!p.success)
      throw new TypeError(
        `customerStepUpPolicies: ${action}: ${p.error.issues[0]?.path.join(".") || "policy"} ${p.error.issues[0]?.message ?? "is invalid"}`,
      );
    out[action] = Object.freeze(p.data);
  }
  return Object.freeze(out);
}

/** A step-up the borrower completed on one device session. */
export interface CustomerStepUp {
  deviceId: string;
  acr: CustomerAcr;
  /** When the step-up was proved (ISO 8601); the session's `auth_time` from now on. */
  authTime: string;
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
  /**
   * Verify `Authorization: DPoP <token>` with the request's `DPoP` proof. `fresh` reads the
   * device past the adapter's short device cache (PR-UDF-056): use it on a route that checks a
   * step-up, so a step-up confirmed on another replica counts at once (and a revoked device is
   * refused at once).
   */
  verifyRequest(req: {
    authorization: string;
    dpopProof: string;
    method: string;
    url: string;
    fresh?: boolean;
  }): Promise<VerifiedCustomerClaims>;
  listDevices(tenantId: string, userId: string): Promise<CustomerDevice[]>;
  /**
   * The customer unbinds the device: it is signed out (its tokens are refused within 60 s and its
   * refresh token is dead) and deleted at once (owner answer #86).
   */
  revokeDevice(tenantId: string, userId: string, deviceId: string): Promise<void>;
  /** The customer closed the account: every device is signed out and deleted at once. */
  forgetDevices(tenantId: string, userId: string): Promise<void>;
  /**
   * Start moving the account's login to a new one (Udofin PR-UDF-034; REQ-KYC-44): one code to
   * the current login and one to the new, which must belong to no account. Optional: an adapter
   * without it refuses with IPB-PORT-001 `unsupported`.
   */
  startLoginChange?(req: {
    tenantId: string;
    userId: string;
    channel: CustomerOtpChannel;
    currentLogin: string;
    newLogin: string;
    dpopProof: string;
    locale?: string;
  }): Promise<CustomerChallenge>;
  /** Finish it with both codes from the same device key; the account keeps its id and devices. */
  confirmLoginChange?(req: {
    tenantId: string;
    userId: string;
    channel: CustomerOtpChannel;
    challengeId: string;
    currentLogin: string;
    newLogin: string;
    oldCode: string;
    newCode: string;
    dpopProof: string;
  }): Promise<void>;
  /**
   * Free a login for a new account (the account closed): devices forgotten, the verified email
   * deleted (ledgered, reason `account_closed`; R1-D-235), the account disabled, its id kept.
   */
  retireLogin?(req: {
    tenantId: string;
    userId: string;
    channel: CustomerOtpChannel;
    login: string;
  }): Promise<void>;
  /**
   * Start proving an email address for a signed-in customer (Udofin PR-UDF-055; R1-D-224): a
   * one-time code goes to `email` through NOTIFY, guarded like a sign-in code; the proof is by the
   * customer's device key. Optional: an adapter or a store without it refuses with IPB-PORT-001
   * `unsupported`; off until `int.identity.customer.email_capture.enabled` (IPB-PORT-001
   * `disabled`).
   */
  startEmailVerification?(req: {
    tenantId: string;
    userId: string;
    email: string;
    dpopProof: string;
    locale?: string;
  }): Promise<CustomerChallenge>;
  /** Finish it with the code, from the same device key; the address is recorded on the account. */
  confirmEmailVerification?(req: {
    tenantId: string;
    userId: string;
    challengeId: string;
    email: string;
    code: string;
    dpopProof: string;
  }): Promise<VerifiedCustomerEmail>;
  /** The account's verified email address and when it was verified, or null. */
  verifiedEmail?(tenantId: string, userId: string): Promise<VerifiedCustomerEmail | null>;
  /**
   * Delete the account's verified email on the borrower's erasure request (owner answer #161 (3);
   * R1-D-235): one ledgered transaction, reason `erasure_request` with `requestRef` (1 to 128 of
   * `[A-Za-z0-9_.:-]`), never the address; whether or not the capture is on. Idempotent: `erased`
   * is false when there was nothing to delete. Optional: an adapter or a store without it refuses
   * with IPB-PORT-001 `unsupported`.
   */
  eraseVerifiedEmail?(req: {
    tenantId: string;
    userId: string;
    requestRef: string;
  }): Promise<{ erased: boolean }>;
  /**
   * Start a step-up on one signed-in device session (Udofin PR-UDF-056; R1-D-244): a fresh
   * one-time code to the account's registered `login` (it must be this account's) through NOTIFY,
   * guarded like a sign-in code; the proof is by the key of the active device `deviceId`.
   * Optional: an adapter or a store without it refuses with IPB-PORT-001 `unsupported`.
   */
  startStepUp?(req: {
    tenantId: string;
    userId: string;
    deviceId: string;
    channel: CustomerOtpChannel;
    login: string;
    dpopProof: string;
    locale?: string;
  }): Promise<CustomerChallenge>;
  /**
   * Finish it with the code, from the same device key and for the same device: the session's
   * `acr` and `auth_time` become the step-up's (ledgered). Wrong code: IPB-IDN-001 `code`.
   */
  confirmStepUp?(req: {
    tenantId: string;
    userId: string;
    deviceId: string;
    challengeId: string;
    code: string;
    dpopProof: string;
  }): Promise<CustomerStepUp>;
}

/** An email address a customer proved with a one-time code (PR-UDF-055; R1-D-224). */
export interface VerifiedCustomerEmail {
  /** Lower case. */
  email: string;
  verifiedAt: string;
}

// ---- identity-provider brokers (LawDocsComply PR-LDC-09, R1-D-78) ------------------------------
// A tenant's own SSO: an OIDC or SAML identity provider brokered by the product's realm (Keycloak)
// or organisation (Zitadel), and the email domains that lead to it. The client secret is given by
// SECRETS reference only (`secret://<adapter>/<path>#<key>`) and resolved by the adapter; a literal
// secret is refused by the schema, and no secret is ever returned. Every change is an admin action
// the product puts behind maker-checker (R3); the adapter only executes the approved change.

/** Broker alias: lower case, unique in the realm or organisation, owned by one tenant. */
export const IdpAlias = z.string().regex(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/);

/** An email domain, lower case (`example.in`, `mail.example.co.in`). */
export const EmailDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

/** A domain the product has verified the tenant controls (DNS or similar); only these route. */
export const VerifiedDomain = z.strictObject({
  domain: EmailDomain,
  verifiedAt: z.iso.datetime({ offset: true }),
});
export type VerifiedDomain = z.infer<typeof VerifiedDomain>;

/**
 * The IdP's discovery or metadata URL. Adapters require `https:` (a loopback `http:` URL only
 * with their test-only `allowLoopbackHttp`).
 */
const IdpUrl = z.url({ protocol: /^https?$/ }).max(2048);

const brokerBase = {
  tenantId: z.string().min(1).max(64),
  alias: IdpAlias,
  displayName: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  domains: z.array(VerifiedDomain).max(50).default([]),
};

export const IdentityProviderSpec = z.discriminatedUnion("protocol", [
  z.strictObject({
    ...brokerBase,
    protocol: z.literal("oidc"),
    /** `…/.well-known/openid-configuration` of the tenant's IdP. */
    discoveryUrl: IdpUrl.refine(
      (u) => new URL(u).pathname.endsWith("/.well-known/openid-configuration"),
      { message: "an OpenID discovery URL (…/.well-known/openid-configuration)" },
    ),
    clientId: z.string().min(1).max(255),
    /** `secret://<adapter>/<path>#<key>`; never the secret itself. */
    clientSecretRef: z.string().refine(isSecretRef, {
      message: "a SECRETS reference (secret://<adapter>/<path>#<key>)",
    }),
    scopes: z
      .array(z.string().regex(/^[\x21\x23-\x5b\x5d-\x7e]{1,64}$/))
      .min(1)
      .max(20)
      .default(["openid", "email", "profile"]),
  }),
  z.strictObject({
    ...brokerBase,
    protocol: z.literal("saml"),
    /** The IdP's SAML 2.0 metadata document. */
    metadataUrl: IdpUrl,
  }),
]);
/** What a product passes: defaults (`enabled`, `domains`, `scopes`) may be left out. */
export type IdentityProviderSpec = z.input<typeof IdentityProviderSpec>;
export type IdentityProviderConfig = z.output<typeof IdentityProviderSpec>;

/** A broker as the port reports it: never a secret. */
export interface IdentityProviderInfo {
  tenantId: string;
  alias: string;
  protocol: "oidc" | "saml";
  displayName: string;
  enabled: boolean;
  domains: VerifiedDomain[];
  discoveryUrl?: string;
  clientId?: string;
  metadataUrl?: string;
}

/**
 * Broker management and domain discovery (PR-LDC-09, R1-D-78). Refusals: a malformed spec before
 * any call (schema error); IPB-PORT-004 (`meta.reason` `alias_taken`: the alias belongs to another
 * tenant or was configured by hand; `domain_taken`: a domain already routes to another broker);
 * IPB-PORT-001 when the adapter has no SECRETS resolver or its admin credentials lack the right.
 */
export interface IdentityBrokerAdmin extends Port {
  /** Create or update the tenant's broker `alias`; `created` is false for an update. */
  upsertIdentityProvider(spec: IdentityProviderSpec): Promise<{ alias: string; created: boolean }>;
  /** Remove the tenant's broker; false when it does not exist or is another tenant's. */
  removeIdentityProvider(tenantId: string, alias: string): Promise<{ removed: boolean }>;
  listIdentityProviders(tenantId: string): Promise<IdentityProviderInfo[]>;
  /**
   * The enabled broker a sign-in email's domain routes to, by verified domain; null when none
   * (or the input is not an email address). The product then starts the login with that alias.
   */
  discoverIdentityProvider(email: string): Promise<{ tenantId: string; alias: string } | null>;
}

/** The domain part of an email address, normalised; null when the input is not one. */
export function emailDomainOf(email: string): string | null {
  const at = email.trim().lastIndexOf("@");
  if (at < 1) return null;
  const d = EmailDomain.safeParse(email.trim().slice(at + 1));
  return d.success ? d.data : null;
}

/** The adapters' URL rule: `https:`, or `http:` on a loopback host when tests allow it. */
export function idpUrlAllowed(url: string, allowLoopbackHttp = false): boolean {
  const u = new URL(url);
  if (u.protocol === "https:") return true;
  return allowLoopbackHttp && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}
