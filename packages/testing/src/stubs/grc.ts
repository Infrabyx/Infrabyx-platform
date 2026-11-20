// A GRC system stub on the Ecosystem Specification §9.2 generic connector contract (Finbyx
// PR-FBX-51, R1-D-220), from the shapes the `generic-grc` adapter documents as stub-shaped [VERIFY]:
// a bearer token; `GET /v1/grc/obligations?updated_since=&cursor=&limit=` answered
// `{ items, next_cursor? }` (an opaque cursor bound to its query; `400 { code: "invalid_cursor" }`
// otherwise); a POST to each resource's path with an `idempotency-key` header, answered
// `{ id, received_at }`, the same answer for the same key and body and `422 { code:
// "idempotency_key_reused" }` for another body; an incident update at or below the last one taken
// `409 { code: "out_of_order" }`; `GET /v1/grc/health`. Proves adapter logic only; test data only.
import { GRC_POST_METHODS, type GrcObligation } from "@infrabyx/contracts/ports";
import { canonicalize, randomBytes, sha256Hex, toHex } from "@infrabyx/crypto";
import { stubCredential, startStub, type StubRequest, type VendorStub } from "./http.js";

export interface GrcStub extends VendorStub {
  token: string;
  /** Test hook: the obligations the stub serves, replacing any. */
  seed(obligations: GrcObligation[]): void;
  /** Records taken so far (one per key); a keyed resend never adds one. */
  accepted(): number;
  /** POST requests received. */
  posts(): StubRequest[];
}

const PATHS = new Map<string, string>(
  Object.values(GRC_POST_METHODS).map((m) => [m.path, m.resource]),
);

export async function startGrcStub(): Promise<GrcStub> {
  const token = stubCredential();
  let obligations: GrcObligation[] = [];
  const keys = new Map<string, { body: string; answer: { id: string; received_at: string } }>();
  const incidents = new Map<string, number>();
  let accepted = 0;
  const cursorOf = (offset: number, since: string) =>
    Buffer.from(`${offset}|${since}`, "utf8").toString("base64url");

  const stub = await startStub((r) => {
    if (r.headers.authorization !== `Bearer ${token}`)
      return { status: 401, body: { error: "unauthorized" } };
    if (r.method === "GET" && r.path === "/v1/grc/health")
      return { status: 200, body: { ok: true } };
    if (r.method === "GET" && r.path === "/v1/grc/obligations") {
      const since = r.query.get("updated_since") ?? "";
      const limit = Number(r.query.get("limit") ?? "50");
      let offset = 0;
      const c = r.query.get("cursor");
      if (c !== null) {
        const [o, s] = Buffer.from(c, "base64url").toString("utf8").split("|");
        if (!/^\d+$/.test(o ?? "") || s !== since)
          return { status: 400, body: { code: "invalid_cursor" } };
        offset = Number(o);
      }
      const t = since ? Date.parse(since) : -Infinity;
      const all = obligations.filter((x) => Date.parse(x.updated_at) >= t);
      const items = all.slice(offset, offset + limit);
      return {
        status: 200,
        body: {
          // The text never travels on this contract; the stub adds a field the adapter must drop.
          items: items.map((x) => ({ ...x, internal_note: "stub" })),
          ...(offset + limit < all.length ? { next_cursor: cursorOf(offset + limit, since) } : {}),
        },
      };
    }
    const resource = PATHS.get(r.path);
    if (r.method === "POST" && resource) {
      const key = r.headers["idempotency-key"];
      if (!key) return { status: 400, body: { code: "idempotency_key_missing" } };
      const data = r.json<Record<string, unknown>>();
      const body = sha256Hex(canonicalize(data));
      const prior = keys.get(`${resource}|${key}`);
      if (prior)
        return prior.body === body
          ? { status: 200, body: prior.answer }
          : { status: 422, body: { code: "idempotency_key_reused" } };
      if (resource === "Incident") {
        const id = String(data.incident_id);
        const seq = Number(data.update_seq);
        const last = incidents.get(id);
        if (last !== undefined && seq <= last)
          return { status: 409, body: { code: "out_of_order" } };
        incidents.set(id, seq);
      }
      const answer = { id: `rec_${toHex(randomBytes(8))}`, received_at: new Date().toISOString() };
      keys.set(`${resource}|${key}`, { body, answer });
      accepted++;
      return { status: 201, body: answer };
    }
    return { status: 404, body: { error: "no route" } };
  });
  return {
    ...stub,
    token,
    seed(o) {
      obligations = [...o].sort(
        (a, b) =>
          a.updated_at.localeCompare(b.updated_at) ||
          a.obligation_ref.localeCompare(b.obligation_ref),
      );
    },
    accepted: () => accepted,
    posts: () => stub.requests.filter((q) => q.method === "POST"),
  };
}
