// C-24 (PL3-C-01, widened by PL4-C-01): RS256 only to sign the Google service-account JWT
// assertion that Google's OAuth 2.0 token exchange requires (RFC 7523), for FCM HTTP v1 and for
// Vertex AI. Never used for platform tokens; C-12 (ES256) stays the rule. The scope must be one
// of the approved Google scopes and the audience Google's token endpoint, so the signer cannot
// mint anything else. The key comes from SECRETS and never leaves this function; it is never
// logged. Keyless workload identity federation replaces it once the platform runs on a cloud that
// supports it.
import { createPrivateKey, sign } from "node:crypto";
import { toBase64Url } from "./encoding.js";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Vertex AI (Gemini, embeddings, Imagen) accepts the cloud-platform scope (PL4-C-01). */
export const VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
/** The only scopes C-24 may sign for (owner approvals PL3-C-01 and PL4-C-01). */
export const GOOGLE_ASSERTION_SCOPES: readonly string[] = [FCM_SCOPE, VERTEX_SCOPE];

export interface ServiceAccountAssertionInput {
  /** `client_email` of the service account. */
  clientEmail: string;
  /** `private_key` (PKCS#8 PEM) of the service account, read through SECRETS. */
  privateKeyPem: string;
  /** `private_key_id`, sent as `kid`. */
  privateKeyId?: string;
  /** One of `GOOGLE_ASSERTION_SCOPES`; defaults to the FCM scope. */
  scope?: string;
  /** Google's token endpoint; no other audience is accepted. */
  audience?: string;
  /** Seconds since the epoch (tests); defaults to now. */
  now?: number;
  /** At most 3600 seconds (Google's limit). */
  lifetimeSeconds?: number;
}

/** Returns the compact JWS for `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`. */
export function signServiceAccountAssertion(i: ServiceAccountAssertionInput): string {
  const scope = i.scope ?? FCM_SCOPE;
  if (!GOOGLE_ASSERTION_SCOPES.includes(scope))
    throw new Error("C-24 signs only for the approved Google scopes");
  if ((i.audience ?? GOOGLE_TOKEN_URL) !== GOOGLE_TOKEN_URL)
    throw new Error("C-24 assertions are only for Google's token endpoint");
  const key = createPrivateKey({ key: i.privateKeyPem, format: "pem" });
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
    throw new Error("the service-account key must be RSA with at least 2048 bits");
  const iat = Math.floor(i.now ?? Date.now() / 1000);
  const life = Math.min(Math.max(i.lifetimeSeconds ?? 3600, 60), 3600);
  const header = { alg: "RS256", typ: "JWT", ...(i.privateKeyId ? { kid: i.privateKeyId } : {}) };
  const claims = {
    iss: i.clientEmail,
    scope,
    aud: GOOGLE_TOKEN_URL,
    iat,
    exp: iat + life,
  };
  const enc = (o: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc(header)}.${enc(claims)}`;
  const sig = sign("RSA-SHA256", new TextEncoder().encode(input), key);
  return `${input}.${toBase64Url(new Uint8Array(sig))}`;
}
