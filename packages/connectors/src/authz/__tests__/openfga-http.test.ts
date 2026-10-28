// PR-FBX-05: the OpenFGA adapter speaks the OpenFGA HTTP API itself (no SDK, so no axios). A local
// stand-in server records what the adapter sends; the AUTHZ contract leg runs the real OpenFGA.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenFgaAuthz } from "../openfga.js";

interface Seen {
  method: string;
  url: string;
  auth?: string;
  body: Record<string, unknown>;
}

const seen: Seen[] = [];
let answer: (s: Seen) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
let server: Server;
let base = "";

const read = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => ok(b));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const text = await read(req);
    const s: Seen = {
      method: req.method ?? "",
      url: req.url ?? "",
      ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
    seen.push(s);
    const a = answer(s);
    res.writeHead(a.status, { "content-type": "application/json" });
    res.end(JSON.stringify(a.body));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

const owner = { id: "usr_1", roles: ["ORG_OWNER"], attr: { tenant_id: "tnt_a" } };
const doc = { kind: "document", id: "doc_1", attr: { tenant_id: "tnt_a" } };
const fga = (o: Partial<ConstructorParameters<typeof OpenFgaAuthz>[0]> = {}) =>
  new OpenFgaAuthz({ apiUrl: base, storeId: "01STORE", allowLoopbackHttp: true, ...o });

describe("PR-FBX-05 OpenFGA over HTTP", () => {
  it("creates a store, writes the model and checks with contextual tuples and the model id", async () => {
    seen.length = 0;
    answer = (s) =>
      s.url === "/stores"
        ? { status: 201, body: { id: "01STORE", name: s.body.name } }
        : s.url.endsWith("/authorization-models")
          ? { status: 201, body: { authorization_model_id: "01MODEL" } }
          : { status: 200, body: { allowed: true } };
    expect(await OpenFgaAuthz.createStore(base, "ipb")).toBe("01STORE");
    const a = fga({ presharedKey: "psk-1" });
    await a.loadPolicies({ version: "1", files: { "model.json": '{"schema_version":"1.1"}' } });
    const d = await a.check(owner, doc, "read");
    expect(d).toEqual({ allowed: true, policy: "openfga:document#read" });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "POST /stores",
      "POST /stores/01STORE/authorization-models",
      "POST /stores/01STORE/check",
    ]);
    expect(seen[0]?.auth).toBeUndefined();
    expect(seen[1]?.auth).toBe("Bearer psk-1");
    expect(seen[1]?.body).toEqual({ schema_version: "1.1" });
    const check = seen[2]!;
    expect(check.auth).toBe("Bearer psk-1");
    expect(check.body.tuple_key).toEqual({
      user: "user:usr_1",
      relation: "read",
      object: "document:doc_1",
    });
    expect(check.body.authorization_model_id).toBe("01MODEL");
    expect((check.body.contextual_tuples as { tuple_keys: unknown[] }).tuple_keys).toContainEqual({
      user: "user:usr_1",
      relation: "owner",
      object: "tenant:tnt_a",
    });
  });

  it("denies on a 4xx (unknown relation) and treats a 5xx or no answer as the PDP being down", async () => {
    answer = () => ({ status: 400, body: { code: "validation_error" } });
    expect(await fga().check(owner, doc, "nope")).toEqual({
      allowed: false,
      policy: "ipb.no_such_relation",
    });
    answer = () => ({ status: 503, body: {} });
    expect(await fga().check(owner, doc, "read")).toMatchObject({
      allowed: false,
      ref: "IPB-AUTHZ-001:openfga",
    });
    const gone = new OpenFgaAuthz({
      apiUrl: "http://127.0.0.1:1",
      storeId: "01STORE",
      allowLoopbackHttp: true,
    });
    expect(await gone.check(owner, doc, "read")).toMatchObject({ allowed: false });
  });

  it("keeps a base path in the API URL, refuses plain HTTP off loopback and a malformed store id", async () => {
    seen.length = 0;
    answer = () => ({ status: 200, body: { allowed: false } });
    await fga({ apiUrl: `${base}/fga/` }).check(owner, doc, "read");
    expect(seen[0]?.url).toBe("/fga/stores/01STORE/check");
    expect(() => new OpenFgaAuthz({ apiUrl: "http://fga.example", storeId: "s" })).toThrow(/https/);
    expect(() => fga({ storeId: "../x" })).toThrow(/store id/);
  });
});
