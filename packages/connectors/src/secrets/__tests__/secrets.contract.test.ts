// SECRETS contract legs (PL2 plan §6.1). Hermetic: moto 5.2.4 for Secrets Manager, KMS and
// CloudTrail; OpenBao 2.7.1 in dev mode for KV v2 and the database secrets engine on PostgreSQL 18.
// Tokens and credentials are generated per run.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, toHex } from "@infrabyx/crypto";
import type { SecretsPort } from "@infrabyx/contracts/ports";
import {
  defineContractSuite,
  startPostgres,
  startService,
  type StartedService,
  type TestDatabase,
} from "@infrabyx/testing";
import { createScrubber } from "../../observability/scrub.js";
import { AwsSecretsManager } from "../aws-sm.js";
import { VaultSecrets } from "../vault.js";

const ROOT = toHex(randomBytes(16));
const VALUE = `sv-${toHex(randomBytes(12))}`;
let moto: StartedService;
let bao: StartedService;
let db: TestDatabase;
let kmsKeyId: string;
// moto 5.2.4 does not implement CloudTrail LookupEvents; this stub answers it (PL2-D-45).
let trail: Server;
const trailRequests: Array<Record<string, unknown>> = [];
const creds = { accessKeyId: "testing", secretAccessKey: "testing" };

beforeAll(async () => {
  trail = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      trailRequests.push({
        target: req.headers["x-amz-target"],
        ...(JSON.parse(body || "{}") as object),
      });
      res.setHeader("content-type", "application/x-amz-json-1.1");
      res.end(
        JSON.stringify({
          Events: [{ EventTime: 1793030400, EventName: "GetSecretValue", Username: "app-role" }],
        }),
      );
    });
  });
  await new Promise<void>((r) => trail.listen(0, "127.0.0.1", r));
  [moto, bao, db] = await Promise.all([
    startService("moto", { ports: [5000], readyLog: /Running on/ }),
    startService("openbao", {
      ports: [8200],
      command: ["server", "-dev", `-dev-root-token-id=${ROOT}`, "-dev-listen-address=0.0.0.0:8200"],
      readyLog: /post-unseal setup complete/,
      configure: (c) =>
        c
          .withAddedCapabilities("IPC_LOCK")
          .withExtraHosts([{ host: "host.docker.internal", ipAddress: "host-gateway" }]),
    }),
    startPostgres(),
  ]);
  const { KMSClient, CreateKeyCommand } = await import("@aws-sdk/client-kms");
  const kms = new KMSClient({ region: "ap-south-1", endpoint: motoUrl(), credentials: creds });
  kmsKeyId = (await kms.send(new CreateKeyCommand({ Description: "platform CMK (test)" })))
    .KeyMetadata!.KeyId!;
  // Database secrets engine on the platform PostgreSQL, reached from the container.
  const pg = new URL(db.url);
  await vaultApi("POST", "/v1/sys/mounts/database", { type: "database" });
  await vaultApi("POST", "/v1/database/config/pg", {
    plugin_name: "postgresql-database-plugin",
    connection_url: `postgresql://{{username}}:{{password}}@host.docker.internal:${pg.port}${pg.pathname}?sslmode=disable`,
    username: decodeURIComponent(pg.username),
    password: decodeURIComponent(pg.password),
    allowed_roles: ["app_ro_dynamic"],
  });
  await vaultApi("POST", "/v1/database/roles/app_ro_dynamic", {
    db_name: "pg",
    creation_statements: [
      `CREATE ROLE "{{name}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'`,
    ],
    default_ttl: "5m",
    max_ttl: "15m",
  });
});
afterAll(async () => {
  trail?.close();
  await Promise.all([moto?.stop(), bao?.stop(), db?.end()]);
});

const motoUrl = () => `http://${moto.host}:${moto.ports[5000]}`;
const baoUrl = () => `http://${bao.host}:${bao.ports[8200]}`;
async function vaultApi(method: string, path: string, body?: unknown) {
  const r = await fetch(`${baoUrl()}${path}`, {
    method,
    headers: { "X-Vault-Token": ROOT, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
}

const aws = () =>
  AwsSecretsManager.create({
    region: "ap-south-1",
    kmsKeyId,
    endpoint: motoUrl(),
    cloudTrailEndpoint: `http://127.0.0.1:${(trail.address() as AddressInfo).port}`,
    credentials: creds,
  });
const vault = () =>
  new VaultSecrets({
    address: baoUrl(),
    auth: { kind: "token", token: ROOT },
    allowLoopbackHttp: true,
    dynamic: { "secrets/test/db/app_ro": { role: "app_ro_dynamic" } },
  });

const cases = (prefix: string) => [
  {
    name: "versions are pinned: an old version stays readable after a new put (rotation overlap)",
    async run(p: SecretsPort) {
      const a = await p.put(`${prefix}/pin`, "one");
      await p.rotate(`${prefix}/pin`, async (cur) => `${cur.value}-two`);
      expect((await p.get(`${prefix}/pin`)).value).toBe("one-two");
      expect((await p.get(`${prefix}/pin`, a.version)).value).toBe("one");
    },
  },
  {
    name: "metadata round-trips; data class is SECRET",
    async run(p: SecretsPort) {
      await p.put(`${prefix}/meta`, "v", { owner: "PLT_SECURITY_OFFICER", rotationDays: 180 });
      expect((await p.get(`${prefix}/meta`)).meta).toMatchObject({
        owner: "PLT_SECURITY_OFFICER",
        rotationDays: 180,
        dataClass: "SECRET",
      });
    },
  },
  {
    name: "list by prefix returns only that prefix; a missing secret is IPB-PORT-001 not_found",
    async run(p: SecretsPort) {
      await p.put(`${prefix}/list/a`, "1");
      await p.put(`${prefix}/list/b/c`, "2");
      await p.put(`${prefix}/other`, "3");
      expect(await p.list(`${prefix}/list/`)).toEqual([`${prefix}/list/a`, `${prefix}/list/b/c`]);
      await expect(p.get(`${prefix}/none`)).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { reason: "not_found" },
      });
    },
  },
  {
    name: "no secret value reaches errors, or telemetry after the scrubber",
    async run(p: SecretsPort) {
      await p.put(`${prefix}/scrub`, VALUE);
      const v = await p.get(`${prefix}/scrub`);
      const err = await p.get(`${prefix}/scrub-missing`).catch((e: Error) => e);
      expect(
        JSON.stringify({ msg: String(err), meta: (err as { meta?: unknown }).meta }),
      ).not.toContain(VALUE);
      // The scrubber redacts credential-named keys before any export (IPB-02-23).
      const attrs = createScrubber().attrs({ secret: v.value, nested: { token: v.value } });
      expect(JSON.stringify(attrs)).not.toContain(VALUE);
    },
  },
  {
    name: "lease returns a value with an expiry",
    method: "lease",
    async run(p: SecretsPort) {
      await p.put(`${prefix}/lease`, "static");
      const l = await p.lease(`${prefix}/lease`, 60);
      expect(l.value).toBe("static");
      expect(Date.parse(l.expiresAt)).toBeGreaterThan(Date.now());
    },
  },
  {
    name: "audit lists operations on a secret, or is declared unsupported",
    method: "audit",
    invoke: (p: SecretsPort) => p.audit(`${prefix}/pin`),
    async run(p: SecretsPort) {
      expect(Array.isArray(await p.audit(`${prefix}/pin`))).toBe(true);
    },
  },
];

describe("@IPB-01-15 SECRETS hermetic leg: aws-sm on moto 5.2.4", () => {
  defineContractSuite("SECRETS", aws, cases("secrets/test/aws"), { leg: "hermetic" });

  it("audit looks up CloudTrail events by the secret ARN (CloudTrail stub)", async () => {
    const a = await aws();
    await a.put("secrets/test/aws/audited", "v");
    expect(await a.audit("secrets/test/aws/audited")).toEqual([
      { at: new Date(1793030400 * 1000).toISOString(), actor: "app-role", op: "GetSecretValue" },
    ]);
    const req = trailRequests.at(-1) as {
      target: string;
      LookupAttributes: Array<{ AttributeValue: string }>;
    };
    expect(req.target).toMatch(/CloudTrail_20131101.LookupEvents$/);
    expect(req.LookupAttributes[0]?.AttributeValue).toMatch(
      /^arn:aws:secretsmanager:ap-south-1:\d+:secret:secrets\/test\/aws\/audited-/,
    );
  });

  it("new secrets use the platform CMK, never the AWS-managed key (C-18)", async () => {
    await (await aws()).put("secrets/test/aws/cmk", "v");
    const { SecretsManagerClient, DescribeSecretCommand } =
      await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({
      region: "ap-south-1",
      endpoint: motoUrl(),
      credentials: creds,
    });
    expect(
      (await sm.send(new DescribeSecretCommand({ SecretId: "secrets/test/aws/cmk" }))).KmsKeyId,
    ).toContain(kmsKeyId);
  });

  it("refuses a region outside India and a missing CMK at creation", async () => {
    await expect(
      AwsSecretsManager.create({ region: "us-east-1", kmsKeyId: "k" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-005" });
    await expect(
      AwsSecretsManager.create({ region: "ap-south-1", kmsKeyId: "" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-005" });
  });
});

describe("@IPB-01-15 SECRETS hermetic leg: vault on OpenBao 2.7.1", () => {
  defineContractSuite("SECRETS", vault, cases("secrets/test/vault"), { leg: "hermetic" });

  it("lease issues dynamic PostgreSQL credentials that can log in", async () => {
    const l = await vault().lease("secrets/test/db/app_ro", 120);
    const { username, password } = JSON.parse(l.value) as { username: string; password: string };
    expect(username).toMatch(/^v-/);
    expect(Date.parse(l.expiresAt) - Date.now()).toBeLessThanOrEqual(120_000);
    const pg = await import("pg");
    const u = new URL(db.url);
    u.username = encodeURIComponent(username);
    u.password = encodeURIComponent(password);
    const c = new pg.default.Client({ connectionString: u.toString() });
    await c.connect();
    expect((await c.query("select current_user as u")).rows[0].u).toBe(username);
    await c.end();
  });

  it("a wrong token is refused without leaking the path's value", async () => {
    const bad = new VaultSecrets({
      address: baoUrl(),
      auth: { kind: "token", token: "wrong" },
      allowLoopbackHttp: true,
    });
    await expect(bad.get("secrets/test/vault/pin")).rejects.toMatchObject({ code: "IPB-PORT-001" });
  });
});
