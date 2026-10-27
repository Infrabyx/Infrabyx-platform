// Google OAuth access tokens from a service-account key (C-24; PL3-C-01, widened to Vertex AI by
// PL4-C-01). `@infrabyx/crypto` signs the RS256 assertion; this module exchanges it at Google's
// token endpoint and caches the access token until 5 minutes before it expires. Concurrent callers
// share one exchange. Neither the key nor the token is ever logged. Keyless workload identity
// federation replaces this once the platform runs on a cloud that supports it: the adapters then
// take an access-token provider instead.
import { GOOGLE_TOKEN_URL, signServiceAccountAssertion } from "@infrabyx/crypto";
import { vendorError } from "../messaging/common.js";
import { createEgress } from "./http.js";

export interface GoogleServiceAccountTokenOptions {
  /** The port and adapter the token serves, for errors and the egress allow-list. */
  port: string;
  adapter: string;
  clientEmail: string;
  /** The PKCS#8 PEM key, read through SECRETS at each exchange. */
  privateKey: () => Promise<string> | string;
  privateKeyId?: string;
  /** One of `GOOGLE_ASSERTION_SCOPES` (`FCM_SCOPE`, `VERTEX_SCOPE`). */
  scope: string;
  /** Tests only: the token-endpoint stub. */
  tokenUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

const REFRESH_EARLY_MS = 5 * 60_000;

/** An access-token provider: `() => Promise<string>`, cached until shortly before expiry. */
export function googleServiceAccountToken(
  o: GoogleServiceAccountTokenOptions,
): () => Promise<string> {
  const egress = createEgress({
    port: o.port,
    adapter: o.adapter,
    allow: ["oauth2.googleapis.com"],
    retries: 1,
    ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
  });
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  const exchange = async (now: number): Promise<string> => {
    const assertion = signServiceAccountAssertion({
      clientEmail: o.clientEmail,
      privateKeyPem: await o.privateKey(),
      ...(o.privateKeyId ? { privateKeyId: o.privateKeyId } : {}),
      scope: o.scope,
      now: Math.floor(now / 1000),
    });
    const res = await egress(o.tokenUrl ?? GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (res.status !== 200)
      throw vendorError(o.port, o.adapter, res.status, "Google token endpoint");
    const t = res.json() as { access_token?: string; expires_in?: number };
    if (!t.access_token)
      throw vendorError(o.port, o.adapter, 502, "Google token endpoint gave no token");
    cached = { token: t.access_token, expiresAt: now + (t.expires_in ?? 3600) * 1000 };
    return t.access_token;
  };

  return async () => {
    const now = o.now?.() ?? Date.now();
    if (cached && now < cached.expiresAt - REFRESH_EARLY_MS) return cached.token;
    inflight ??= exchange(now).finally(() => {
      inflight = null;
    });
    return inflight;
  };
}
