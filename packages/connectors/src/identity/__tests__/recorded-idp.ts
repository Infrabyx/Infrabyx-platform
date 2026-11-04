// Recorded IdP answers for the IDENTITY unit tests (R1-D-77, R1-D-78): a fetch that replays the
// responses Keycloak 26 and Zitadel v4 give on the routes an adapter calls, records every request,
// and signs access tokens with a test ES256 key served as the issuer's JWKS.
// eslint-disable-next-line ipb/no-direct-crypto
import { generateKeyPairSync, sign } from "node:crypto";

export interface RecordedRequest {
  method: string;
  path: string;
  /** The request body as sent: form fields or parsed JSON. */
  form?: Record<string, string>;
  json?: unknown;
  headers: Record<string, string>;
}

export interface RecordedReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Route = [
  method: string,
  path: string | RegExp,
  reply: RecordedReply | ((req: RecordedRequest) => RecordedReply),
];

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
export const TEST_JWK = {
  ...publicKey.export({ format: "jwk" }),
  kid: "rec-1",
  alg: "ES256",
  use: "sig",
};

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** An ES256 access token signed with the key the recorded JWKS serves. */
export function signedAccessToken(payload: Record<string, unknown>): string {
  const input = `${b64({ alg: "ES256", kid: TEST_JWK.kid, typ: "JWT" })}.${b64(payload)}`;
  const sig = sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${sig.toString("base64url")}`;
}

/** A Keycloak refresh token as issued (HS512; the adapter never verifies it, only reads `sid`). */
export function keycloakRefreshToken(payload: Record<string, unknown>): string {
  return `${b64({ alg: "HS512", typ: "JWT", kid: "hs-1" })}.${b64({ typ: "Refresh", ...payload })}.c2ln`;
}

/** A fetch over `routes` (first match wins); an unmatched request answers 599 and is recorded. */
export function recordedFetch(routes: Route[]): {
  fetch: typeof fetch;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  const impl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const raw = typeof init.body === "string" ? init.body : undefined;
    const req: RecordedRequest = {
      method: (init.method ?? "GET").toUpperCase(),
      path: `${u.pathname}${u.search}`,
      headers,
      ...(raw && headers["content-type"]?.startsWith("application/x-www-form-urlencoded")
        ? { form: Object.fromEntries(new URLSearchParams(raw)) }
        : {}),
      ...(raw && headers["content-type"]?.startsWith("application/json")
        ? { json: JSON.parse(raw) as unknown }
        : {}),
    };
    calls.push(req);
    const hit = routes.find(
      ([m, p]) =>
        m === req.method && (typeof p === "string" ? p === u.pathname : p.test(u.pathname)),
    );
    const reply: RecordedReply = hit
      ? typeof hit[2] === "function"
        ? hit[2](req)
        : hit[2]
      : { status: 599, body: { error: "unrecorded", path: u.pathname } };
    return new Response(
      reply.body === undefined
        ? null
        : typeof reply.body === "string"
          ? reply.body
          : JSON.stringify(reply.body),
      {
        status: reply.status,
        headers: { "content-type": "application/json", ...(reply.headers ?? {}) },
      },
    );
  };
  return { fetch: impl as typeof fetch, calls };
}
