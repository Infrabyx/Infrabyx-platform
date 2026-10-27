// C-24 (PL3-C-01): RS256 only to sign the Google service-account JWT assertion that FCM HTTP v1's
// OAuth 2.0 token exchange requires (RFC 7523). Never used for platform tokens; C-12 (ES256) stays
// the rule. The key comes from SECRETS and never leaves this function; it is never logged.
import { createPrivateKey, sign } from "node:crypto";
import { toBase64Url } from "./encoding.js";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export interface ServiceAccountAssertionInput {
  /** `client_email` of the service account. */
  clientEmail: string;
  /** `private_key` (PKCS#8 PEM) of the service account, read through SECRETS. */
  privateKeyPem: string;
  /** `private_key_id`, sent as `kid`. */
  privateKeyId?: string;
  scope?: string;
  audience?: string;
  /** Seconds since the epoch (tests); defaults to now. */
  now?: number;
  /** At most 3600 seconds (Google's limit). */
  lifetimeSeconds?: number;
}

/** Returns the compact JWS for `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`. */
export function signServiceAccountAssertion(i: ServiceAccountAssertionInput): string {
  const key = createPrivateKey({ key: i.privateKeyPem, format: "pem" });
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
    throw new Error("the service-account key must be RSA with at least 2048 bits");
  const iat = Math.floor(i.now ?? Date.now() / 1000);
  const life = Math.min(Math.max(i.lifetimeSeconds ?? 3600, 60), 3600);
  const header = { alg: "RS256", typ: "JWT", ...(i.privateKeyId ? { kid: i.privateKeyId } : {}) };
  const claims = {
    iss: i.clientEmail,
    scope: i.scope ?? FCM_SCOPE,
    aud: i.audience ?? GOOGLE_TOKEN_URL,
    iat,
    exp: iat + life,
  };
  const enc = (o: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));
  const input = `${enc(header)}.${enc(claims)}`;
  const sig = sign("RSA-SHA256", new TextEncoder().encode(input), key);
  return `${input}.${toBase64Url(new Uint8Array(sig))}`;
}
