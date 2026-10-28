// The sign-in flow over the IDENTITY port (IPB-02-01, §02.4.2): authorisation code with PKCE
// (RFC 7636, S256). The port exchanges the code (`authenticate`) and verifies tokens
// (`verifyToken`); the authorisation URL is the IdP's own, built here from the API's configuration.
// The API keeps the access token in an HttpOnly cookie for the web app (a product may hand it to
// its own session layer instead); a `Bearer` header is accepted as well.
import { randomBytes, sha256, toBase64Url } from "@infrabyx/crypto";

export interface IdentityFlow {
  /** Where the browser goes to sign in; the IdP redirects back to `redirectUri` with the code. */
  authorizeUrl(o: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    persona?: string;
  }): string;
}

/** Keycloak's authorisation endpoint for the API client (the realm from `ipbRealm`). */
export class KeycloakFlow implements IdentityFlow {
  constructor(private readonly o: { baseUrl: string; realm: string; clientId: string }) {}
  authorizeUrl(o: { state: string; codeChallenge: string; redirectUri: string }): string {
    const u = new URL(
      `${this.o.baseUrl.replace(/\/$/, "")}/realms/${this.o.realm}/protocol/openid-connect/auth`,
    );
    u.searchParams.set("client_id", this.o.clientId);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid");
    u.searchParams.set("redirect_uri", o.redirectUri);
    u.searchParams.set("state", o.state);
    u.searchParams.set("code_challenge", o.codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  }
}

export interface Pkce {
  state: string;
  verifier: string;
  challenge: string;
}

/** A fresh PKCE verifier (43 characters of 32 random bytes) with its S256 challenge and a state. */
export function newPkce(): Pkce {
  const verifier = toBase64Url(randomBytes(32));
  return {
    state: toBase64Url(randomBytes(16)),
    verifier,
    challenge: toBase64Url(sha256(new TextEncoder().encode(verifier))),
  };
}

export const SESSION_COOKIE = "ibx_session";
export const PKCE_COOKIE = "ibx_pkce";
const COOKIE_NAME = /^[A-Za-z0-9_-]+$/;

/** A cookie attribute string; `Secure` on https (IPB-02 §02.4.2 session rules). */
export function cookie(
  name: string,
  value: string | null,
  o: { secure: boolean; maxAgeSeconds?: number; sameSite?: "Strict" | "Lax" },
): string {
  if (!COOKIE_NAME.test(name)) throw new Error(`invalid cookie name ${name}`);
  const parts = [
    `${name}=${value ? encodeURIComponent(value) : ""}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${o.sameSite ?? "Lax"}`,
  ];
  if (o.secure) parts.push("Secure");
  if (!value) parts.push("Max-Age=0");
  else if (o.maxAgeSeconds !== undefined)
    parts.push(`Max-Age=${Math.max(0, Math.floor(o.maxAgeSeconds))}`);
  return parts.join("; ");
}

export function cookieMap(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) {
      try {
        out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
      } catch {
        /* a malformed cookie is ignored */
      }
    }
  }
  return out;
}

/** The token of a request: the `Bearer` header first, then the session cookie. */
export function tokenFrom(headers: {
  authorization?: string | string[] | undefined;
  cookie?: string | string[] | undefined;
}): string | undefined {
  const auth = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  const m = auth ? /^Bearer\s+(\S+)$/i.exec(auth) : null;
  if (m) return m[1];
  const c = Array.isArray(headers.cookie) ? headers.cookie.join("; ") : headers.cookie;
  return cookieMap(c)[SESSION_COOKIE] || undefined;
}
