// AUTHZ contract legs (PL2 plan §6.6). One decision table — principal × action on a tenant record
// → allow/deny — runs unchanged against Cerbos 0.57.0 (platform policy pack via the Admin API) and
// OpenFGA v1.22.0 (platform model, contextual tuples only): parity (D-04), agents never decide
// (@IPB-02-AT-11, policy leg), product scope without disclosure, PDP down gives deny.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthzPort, AuthzPrincipal, AuthzResource } from "@infrabyx/contracts/ports";
import { defineContractSuite, startService, type StartedService } from "@infrabyx/testing";
import { CerbosAuthz } from "../cerbos.js";
import { platformPolicyBundle } from "../common.js";
import { OpenFgaAuthz } from "../openfga.js";

const CERBOS_CONFIG = `
server:
  httpListenAddr: ":3592"
  adminAPI:
    enabled: true
storage:
  driver: sqlite3
  sqlite3:
    dsn: ":memory:?_fk=true"
`;
// Cerbos's documented default Admin API credentials apply when none are configured (tests only).
const CERBOS_ADMIN = { username: "cerbos", password: "cerbosAdmin" };

let cerbos: StartedService;
let fga: StartedService;
let fgaStore = "";
let fgaModel = "";

beforeAll(async () => {
  [cerbos, fga] = await Promise.all([
    startService("cerbos", {
      ports: [3592],
      files: [{ content: CERBOS_CONFIG, target: "/config/config.yaml" }],
      command: ["server", "--config=/config/config.yaml"],
      readyLog: /Starting HTTP server/,
    }),
    startService("openfga", { ports: [8080], command: ["run"], readyLog: /starting HTTP server/ }),
  ]);
  const c = cerbosAdapter();
  await c.loadPolicies(await platformPolicyBundle("cerbos"));
  fgaStore = await OpenFgaAuthz.createStore(fgaUrl(), "ipb-contract");
  const f = new OpenFgaAuthz({ apiUrl: fgaUrl(), storeId: fgaStore, allowLoopbackHttp: true });
  await f.loadPolicies(await platformPolicyBundle("openfga"));
  fgaModel =
    (f as unknown as { client: { authorizationModelId?: string } }).client.authorizationModelId ??
    "";
});
afterAll(async () => {
  await Promise.all([cerbos?.stop(), fga?.stop()]);
});

const cerbosUrl = () => `http://${cerbos.host}:${cerbos.ports[3592]}`;
const fgaUrl = () => `http://${fga.host}:${fga.ports[8080]}`;
const cerbosAdapter = () =>
  new CerbosAuthz({
    url: cerbosUrl(),
    admin: CERBOS_ADMIN,
    allowLoopbackHttp: true,
    decisionCacheSeconds: 0,
  });
const fgaAdapter = () =>
  new OpenFgaAuthz({
    apiUrl: fgaUrl(),
    storeId: fgaStore,
    authorizationModelId: fgaModel,
    allowLoopbackHttp: true,
    decisionCacheSeconds: 0,
  });

const T = { tenant_id: "tnt_a" };
const P: Record<string, AuthzPrincipal> = {
  member: { id: "usr_member", roles: ["ORG_MEMBER"], attr: T },
  maker: { id: "usr_maker", roles: ["ORG_MAKER"], attr: T },
  checker: { id: "usr_checker", roles: ["ORG_CHECKER"], attr: T },
  makerChecker: { id: "usr_maker", roles: ["ORG_MAKER", "ORG_CHECKER"], attr: T },
  admin: { id: "usr_admin", roles: ["ORG_ADMIN"], attr: T },
  owner: { id: "usr_owner", roles: ["ORG_OWNER"], attr: T },
  otherTenant: { id: "usr_b_admin", roles: ["ORG_ADMIN"], attr: { tenant_id: "tnt_b" } },
  agent: { id: "agt_drafter", roles: ["AGT_DRAFTER", "ORG_ADMIN"], attr: T },
  opsIn: {
    id: "usr_ops_ld",
    roles: ["OPS_SUPPORT"],
    attr: { tenant_id: "tnt_hub", product_scope: ["LD"] },
  },
  opsOut: {
    id: "usr_ops_udf",
    roles: ["OPS_SUPPORT"],
    attr: { tenant_id: "tnt_hub", product_scope: ["UDF"] },
  },
};
const record: AuthzResource = {
  kind: "ipb_record",
  id: "rec_1",
  attr: { tenant_id: "tnt_a", product: "LD", maker_id: "usr_maker" },
};
const ACTIONS = ["read", "update", "approve", "delete", "grant"] as const;
const Y = true;
const N = false;
/** The platform decision table (PL2-D-51). */
const TABLE: Record<keyof typeof P, readonly boolean[]> = {
  //           read update approve delete grant
  member: [Y, N, N, N, N],
  maker: [Y, Y, N, N, N],
  checker: [Y, N, Y, N, N],
  makerChecker: [Y, Y, N, N, N], // the maker never checks their own record
  admin: [Y, Y, Y, N, Y],
  owner: [Y, Y, Y, Y, Y],
  otherTenant: [N, N, N, N, N],
  agent: [Y, Y, N, N, N], // AGT_* with ORG_ADMIN still never approves, deletes or grants
  opsIn: [Y, N, N, N, N],
  opsOut: [N, N, N, N, N], // outside product_scope: denied, no disclosure
};

const tableCases = (name: string) => [
  {
    name: `${name}: the platform decision table holds (parity, PL2-D-51)`,
    async run(p: AuthzPort) {
      const got: Record<string, boolean[]> = {};
      for (const [who, principal] of Object.entries(P))
        got[who] = await Promise.all(
          ACTIONS.map(async (a) => (await p.check(principal, record, a)).allowed),
        );
      expect(got).toEqual(TABLE);
    },
  },
  {
    name: `${name}: @IPB-02-AT-11 an agent is denied approve, sign, disburse, delete and grant`,
    async run(p: AuthzPort) {
      for (const a of ["approve", "sign", "disburse", "delete", "grant"])
        expect((await p.check(P.agent!, record, a)).allowed, a).toBe(false);
    },
  },
  {
    name: `${name}: checkBatch agrees with check`,
    async run(p: AuthzPort) {
      const [r] = await p.checkBatch(P.checker!, [{ resource: record, actions: [...ACTIONS] }]);
      expect(ACTIONS.map((a) => r!.decisions[a]!.allowed)).toEqual(TABLE.checker);
    },
  },
  {
    name: `${name}: an unknown resource kind or action is denied`,
    async run(p: AuthzPort) {
      expect((await p.check(P.owner!, { ...record, kind: "unknown_kind" }, "read")).allowed).toBe(
        false,
      );
      expect((await p.check(P.owner!, record, "export_all")).allowed).toBe(false);
    },
  },
];

describe("@IPB-01-15 AUTHZ hermetic leg: cerbos 0.57.0", () => {
  defineContractSuite("AUTHZ", cerbosAdapter, tableCases("cerbos"), { leg: "hermetic" });

  it("planResources: a tenant member gets a conditional plan, an agent asking to approve gets always_denied", async () => {
    const c = cerbosAdapter();
    expect((await c.planResources(P.member!, "ipb_record", "read")).kind).toBe("conditional");
    expect(await c.planResources(P.agent!, "ipb_record", "approve")).toEqual({
      kind: "always_denied",
    });
  });

  it("a PDP outage is a deny with IPB-AUTHZ-001, never an allow", async () => {
    const down = new CerbosAuthz({ url: "http://127.0.0.1:9", allowLoopbackHttp: true });
    expect(await down.check(P.owner!, record, "read")).toMatchObject({
      allowed: false,
      ref: "IPB-AUTHZ-001:cerbos",
    });
    expect((await down.health()).status).toBe("down");
  });

  it("allow decisions are cached for at most 5 s; denials are never cached", async () => {
    let t = 0;
    const c = new CerbosAuthz({
      url: cerbosUrl(),
      allowLoopbackHttp: true,
      decisionCacheSeconds: 5,
      now: () => t,
    });
    expect((await c.check(P.member!, record, "read")).policy).not.toBe("cache");
    expect((await c.check(P.member!, record, "read")).policy).toBe("cache");
    t += 5_001;
    expect((await c.check(P.member!, record, "read")).policy).not.toBe("cache");
    await c.check(P.member!, record, "update");
    expect((await c.check(P.member!, record, "update")).policy).not.toBe("cache");
    expect(
      () => new CerbosAuthz({ url: cerbosUrl(), allowLoopbackHttp: true, decisionCacheSeconds: 6 }),
    ).toThrow(/5 s/);
  });
});

describe("@IPB-01-15 AUTHZ hermetic leg: openfga v1.22.0", () => {
  defineContractSuite(
    "AUTHZ",
    fgaAdapter,
    [
      ...tableCases("openfga"),
      {
        name: "planResources is declared unsupported",
        method: "planResources",
        invoke: (p: AuthzPort) => p.planResources(P.member!, "ipb_record", "read"),
        async run() {},
      },
    ],
    { leg: "hermetic" },
  );

  it("stores no tuples: decisions come from contextual tuples only (PL2-D-52)", async () => {
    const r = await fetch(`${fgaUrl()}/stores/${fgaStore}/read`, { method: "POST", body: "{}" });
    expect(((await r.json()) as { tuples: unknown[] }).tuples).toEqual([]);
  });

  it("a PDP outage is a deny with IPB-AUTHZ-001, never an allow", async () => {
    const down = new OpenFgaAuthz({
      apiUrl: "http://127.0.0.1:9",
      storeId: "01JA0000000000000000000000",
      allowLoopbackHttp: true,
    });
    expect(await down.check(P.owner!, record, "read")).toMatchObject({
      allowed: false,
      ref: "IPB-AUTHZ-001:openfga",
    });
  });
});
