// Fixture adapters of the reference API (PL6 plan §8.3), used only where `apiEnv` allows them
// (local, dev, test, preview): a fixture IDENTITY that signs in synthetic personas and issues
// HMAC-signed tokens, a role-based AUTHZ for the hello module, and an in-process QUEUE. A product
// wires the real adapters from `@infrabyx/connectors` with the same ports; nothing here runs from
// staging upwards.
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import type {
  AdapterDescriptor,
  AuthzDecision,
  AuthzPort,
  AuthzPrincipal,
  AuthzResource,
  ConsumedJob,
  EnqueueOptions,
  IdentityPort,
  IdentityUser,
  PortHealth,
  ProvisionUserSpec,
  QueueJob,
  QueuePort,
  QueueStats,
  QueueSubscription,
  ResourcePlan,
  ScimOp,
  VerifiedClaims,
} from "@infrabyx/contracts/ports";
import { hmacSha256Hex, randomBytes, SecretKey, toBase64Url } from "@infrabyx/crypto";
import type { IdentityFlow } from "./identity.js";

const up = (): PortHealth => ({
  status: "up",
  latency_ms: 0,
  checked_at: new Date().toISOString(),
});

/** Synthetic personas of the fixture sign-in (seed tenants only, IPB-11-26). */
export const FIXTURE_PERSONAS = {
  owner: { tenantId: "tnt_demo", roles: ["ORG_OWNER"], label: "Demo owner" },
  admin: { tenantId: "tnt_demo", roles: ["ORG_ADMIN"], label: "Demo admin" },
  maker: { tenantId: "tnt_demo", roles: ["ORG_MAKER"], label: "Demo maker" },
  checker: { tenantId: "tnt_demo", roles: ["ORG_CHECKER"], label: "Demo checker" },
  member: { tenantId: "tnt_demo", roles: ["ORG_MEMBER"], label: "Demo member" },
  sandbox_owner: { tenantId: "tnt_sandbox", roles: ["ORG_OWNER"], label: "Sandbox owner" },
  super_admin: {
    tenantId: PLATFORM_TENANT_ID,
    roles: ["PLT_SUPER_ADMIN"],
    label: "Platform super admin",
  },
} as const;
export type FixturePersona = keyof typeof FIXTURE_PERSONAS;
export const isFixturePersona = (s: unknown): s is FixturePersona =>
  typeof s === "string" && Object.hasOwn(FIXTURE_PERSONAS, s);

/** Deterministic user id of a fixture persona (a seeded-looking `usr_` id). */
export const fixtureUserId = (p: FixturePersona): string =>
  `usr_01JFIXTURE${p
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .padEnd(16, "0")
    .slice(0, 16)}`;

const CODE_PREFIX = "fixture:";
const TOKEN_TTL_SECONDS = 3600;

const b64 = (s: string) => toBase64Url(new TextEncoder().encode(s));
const unb64 = (s: string) =>
  new TextDecoder().decode(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));

/**
 * The fixture IDENTITY: `authenticate` accepts `fixture:<persona>` as the authorisation code and
 * returns a token of `<claims>.<hmac>` signed with a per-process key, which `verifyToken` checks.
 * Provisioning and SCIM record into memory, so the seed's credentials command can run against it.
 */
export class FixtureIdentity implements IdentityPort, IdentityFlow {
  readonly descriptor: AdapterDescriptor = {
    port: "IDENTITY",
    adapter: "fixture",
    residency: "IN",
    maxDataClass: "INTERNAL",
    capabilities: { "authenticate.saml": "unsupported", "issueToken.actor": "unsupported" },
  };
  readonly users = new Map<string, IdentityUser & { password?: string }>();
  private readonly key = new SecretKey("fixture-identity", "hmac-sha-256", randomBytes(32));
  private readonly revoked = new Set<string>();

  constructor(
    private readonly o: { callbackUrl: string; now?: () => number } = { callbackUrl: "" },
  ) {}

  private get now(): number {
    return Math.floor((this.o.now?.() ?? Date.now()) / 1000);
  }

  authorizeUrl(o: { state: string; codeChallenge: string; redirectUri: string; persona?: string }) {
    const u = new URL(o.redirectUri);
    u.searchParams.set("code", `${CODE_PREFIX}${o.persona ?? "maker"}`);
    u.searchParams.set("state", o.state);
    return u.toString();
  }

  private sign(claims: VerifiedClaims): string {
    const body = b64(JSON.stringify(claims));
    return `${body}.${hmacSha256Hex(this.key, body)}`;
  }

  private claimsFor(persona: FixturePersona, sid: string): VerifiedClaims {
    const p = FIXTURE_PERSONAS[persona];
    const iat = this.now;
    return {
      sub: fixtureUserId(persona),
      tid: p.tenantId,
      typ: "user",
      roles: [...p.roles],
      mfa: true,
      sid,
      iat,
      exp: iat + TOKEN_TTL_SECONDS,
    };
  }

  async health(): Promise<PortHealth> {
    return up();
  }

  async authenticate(assertion: { kind: "oidc_code" | "saml"; value: string }) {
    if (assertion.kind !== "oidc_code" || !assertion.value.startsWith(CODE_PREFIX))
      throw new PortError("IPB-IDN-001", "IDENTITY", {
        adapter: "fixture",
        detail: "unknown code",
      });
    const persona = assertion.value.slice(CODE_PREFIX.length);
    if (!isFixturePersona(persona))
      throw new PortError("IPB-IDN-001", "IDENTITY", {
        adapter: "fixture",
        detail: `unknown persona ${persona}`,
      });
    const sid = toBase64Url(randomBytes(12));
    return { accessToken: this.sign(this.claimsFor(persona, sid)), expiresIn: TOKEN_TTL_SECONDS };
  }

  async verifyToken(jwt: string): Promise<VerifiedClaims> {
    const [body, mac] = jwt.split(".");
    if (!body || !mac || hmacSha256Hex(this.key, body) !== mac)
      throw new PortError("IPB-IDN-001", "IDENTITY", {
        adapter: "fixture",
        detail: "bad signature",
      });
    const claims = JSON.parse(unb64(body)) as VerifiedClaims;
    if (claims.exp <= this.now || (claims.sid && this.revoked.has(claims.sid)))
      throw new PortError("IPB-IDN-001", "IDENTITY", { adapter: "fixture", detail: "expired" });
    return claims;
  }

  async getUser(id: string): Promise<IdentityUser> {
    const u = this.users.get(id);
    if (!u) throw new IpbError("IPB-SEC-005", { detail: `no user ${id}` });
    return u;
  }

  async linkFederation(): Promise<void> {}

  async issueToken(claims: { subject: string; audience: string }, ttlSeconds: number) {
    const iat = this.now;
    const c: VerifiedClaims = {
      sub: claims.subject,
      tid: PLATFORM_TENANT_ID,
      typ: "service",
      roles: [],
      iat,
      exp: iat + ttlSeconds,
    };
    return { accessToken: this.sign(c), expiresIn: ttlSeconds };
  }

  async scimSync(ops: readonly ScimOp[]) {
    return ops.map((op) => ({
      externalId: op.op === "create" ? op.user.externalId : op.externalId,
      ok: true,
    }));
  }

  async handleLogoutToken(): Promise<{ sid?: string; sub?: string }> {
    return {};
  }

  async revokeSessions(userId: string): Promise<{ revoked: number }> {
    this.revoked.add(userId);
    return { revoked: 1 };
  }

  async provisionUser(spec: ProvisionUserSpec): Promise<{ id: string }> {
    const id = `usr_fixture_${this.users.size + 1}`;
    this.users.set(id, {
      id,
      email: spec.email,
      displayName: spec.displayName,
      enabled: true,
      tenantId: spec.tenantId,
      roles: [...spec.roles],
      mfaEnrolled: false,
      ...(spec.password ? { password: spec.password.value } : {}),
    });
    return { id };
  }

  async setPassword(email: string, password: string): Promise<void> {
    for (const u of this.users.values()) if (u.email === email) u.password = password;
  }
}

export const HELLO_RESOURCE = "hello_greeting";
const WRITERS = ["ORG_MAKER", "ORG_ADMIN", "ORG_OWNER"];
const READERS = [...WRITERS, "ORG_CHECKER", "ORG_MEMBER", "ORG_AUDITOR_RO"];
const LOCKED_VERBS = new Set(["approve", "sign", "disburse", "delete", "grant"]);

const allowed = (p: AuthzPrincipal, r: AuthzResource, action: string): boolean => {
  if (r.kind !== HELLO_RESOURCE) return false;
  const agent = p.roles.some((x) => x.startsWith("AGT_"));
  if (agent && LOCKED_VERBS.has(action)) return false;
  const has = (roles: readonly string[]) => roles.some((x) => p.roles.includes(x));
  switch (action) {
    case "read":
      return has(READERS) || agent;
    case "create":
    case "retract":
      return has(WRITERS) || agent;
    case "delete":
      return has(["ORG_OWNER"]);
    default:
      return false;
  }
};

/** The fixture AUTHZ of the hello module: the Cerbos policy's rules, by role, deny by default. */
export class FixtureHelloAuthz implements AuthzPort {
  readonly descriptor: AdapterDescriptor = {
    port: "AUTHZ",
    adapter: "fixture_hello_roles",
    residency: "IN",
    maxDataClass: "INTERNAL",
  };
  async health(): Promise<PortHealth> {
    return up();
  }
  async check(p: AuthzPrincipal, r: AuthzResource, action: string): Promise<AuthzDecision> {
    return { allowed: allowed(p, r, action), policy: "fixture_hello_roles" };
  }
  async checkBatch(
    p: AuthzPrincipal,
    items: ReadonlyArray<{ resource: AuthzResource; actions: readonly string[] }>,
  ) {
    return items.map((i) => ({
      resourceId: i.resource.id,
      decisions: Object.fromEntries(
        i.actions.map((a) => [a, { allowed: allowed(p, i.resource, a) }]),
      ) as Record<string, AuthzDecision>,
    }));
  }
  async planResources(): Promise<ResourcePlan> {
    return { kind: "always_denied" };
  }
  async loadPolicies(): Promise<void> {}
  async explain(d: AuthzDecision): Promise<string> {
    return d.allowed ? "the role allows the action" : "no role allows the action";
  }
}

/** An in-process QUEUE: jobs run on the registered consumer, idempotency keys de-duplicate. */
export class MemoryQueue implements QueuePort {
  readonly descriptor: AdapterDescriptor = {
    port: "QUEUE",
    adapter: "memory",
    residency: "IN",
    maxDataClass: "INTERNAL",
  };
  private readonly handlers = new Map<string, (job: ConsumedJob) => Promise<void>>();
  private readonly seen = new Map<string, string>();
  readonly jobs: Array<{ queue: string; job: ConsumedJob }> = [];
  readonly dlq: Array<{ queue: string; jobId: string; reason: string }> = [];
  private counter = 0;

  async health(): Promise<PortHealth> {
    return up();
  }
  async enqueue(queue: string, job: QueueJob, opts: EnqueueOptions = {}) {
    const key = opts.idempotencyKey ? `${queue}:${opts.idempotencyKey}` : undefined;
    const prior = key ? this.seen.get(key) : undefined;
    if (prior) return { id: prior };
    const id = `mq_${++this.counter}`;
    if (key) this.seen.set(key, id);
    const consumed: ConsumedJob = { ...job, id, attempt: 1 };
    this.jobs.push({ queue, job: consumed });
    const h = this.handlers.get(queue);
    if (h)
      await h(consumed).catch((e: Error) => this.dlq.push({ queue, jobId: id, reason: e.message }));
    return { id };
  }
  async schedule(queue: string, _cron: string, job: QueueJob) {
    return this.enqueue(queue, job);
  }
  async consume(
    queue: string,
    handler: (job: ConsumedJob) => Promise<void>,
  ): Promise<QueueSubscription> {
    this.handlers.set(queue, handler);
    return { close: async () => void this.handlers.delete(queue) };
  }
  async moveToDLQ(queue: string, jobId: string, reason: string): Promise<void> {
    this.dlq.push({ queue, jobId, reason });
  }
  async replay(): Promise<{ replayed: number }> {
    return { replayed: 0 };
  }
  async stats(queue: string): Promise<QueueStats> {
    const dlq = this.dlq.filter((j) => j.queue === queue).length;
    return { waiting: 0, active: 0, delayed: 0, failed: dlq, dlq };
  }
}
