// Transaction kernel (PL1 plan §3.2): every mutation runs in one transaction with the verified
// context applied through SET LOCAL (IPB-01 §01.4.6, IPB-02-13), and the commit fails unless the
// audit ledger was written in that transaction (IPB-02-51, IPB-MOD-003).
import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import {
  AGENT_FORBIDDEN_VERBS,
  OUTBOX_DISPATCH_ACTION,
  SERVICE_READER_ROLES,
} from "@infrabyx/contracts/roles";
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutateOptions,
  MutationKernel,
  QueryResult,
  ReadOptions,
  Tx,
  UnitOutcome,
} from "@infrabyx/contracts/kernel";
import {
  assertValidContext,
  isAgentPrincipal,
  isSupportContext,
  serviceReaderRole,
} from "./context.js";
import { KernelGuardError } from "./errors.js";
import { isExternalGated } from "./external-gate.js";
import {
  moduleGuard,
  refusalOf,
  scopeRefusal,
  type GrantScope,
  type ScopeRefusal,
} from "./scope-guard.js";
import {
  bindSupportGrant,
  supportGateOf,
  type LiveSupportGrant,
  type SupportGate,
} from "./support-gate.js";

/** Minimal pool surface (pg.Pool satisfies it). */
export interface PoolLike {
  connect(): Promise<pg.PoolClient>;
}

export interface PgKernelOptions {
  pool: PoolLike;
  /** Role assumed with SET LOCAL ROLE for every transaction; RLS-subject (IPB-01 §01.4.6). */
  role?: string;
  readRole?: string;
  /**
   * The ledger the kernel writes its own refusals to (LawDocsComply PR-LDC-08 (c); R1-D-75): a
   * scoped break-glass context that leaves its scope is refused and ledgered in the tenant it
   * touched, and so is a support principal's (R1-D-76). Without it, a scoped grant's context and
   * a support principal's use of its grant are refused outright.
   */
  audit?: AuditSink;
}

/** Ledger actions of the kernel's scope refusals (R1-D-75). */
export const BREAKGLASS_SCOPE_REFUSED_ACTION = "security.breakglass.scope_refused";
export const SUPPORT_SCOPE_REFUSED_ACTION = "security.support_access.scope_refused";

// Statements the callback may not run: session-level SET/RESET, role switches, set_config with
// is_local = false, writes to the kernel's own settings, and trigger bypass (IPB-09 §09.4.6.3).
const FORBIDDEN: Array<[RegExp, string]> = [
  [/^\s*(?:set|reset)\s+(?!local\b)/i, "session-level SET/RESET; use SET LOCAL"],
  [
    /\bset\s+local\s+(?:role|session\s+authorization)\b/i,
    "role switch inside a kernel transaction",
  ],
  [/\bset\s+local\s+app\./i, "app.* settings are set by the kernel from the verified context"],
  [/\bset_config\s*\(\s*'app\./i, "app.* settings are set by the kernel from the verified context"],
  [/\bset_config\s*\([^)]*,\s*false\s*\)/i, "set_config with is_local = false"],
  [/\bsession_replication_role\b/i, "session_replication_role bypasses triggers"],
  [
    /^\s*(?:begin|commit|rollback|start\s+transaction|savepoint|release)\b/i,
    "transaction control belongs to the kernel",
  ],
];

export function assertAllowedStatement(text: string): void {
  for (const [re, why] of FORBIDDEN)
    if (re.test(text)) throw new KernelGuardError(`refused statement: ${why}`);
}

/** Most units one transaction may open (a batch is cut into transactions of at most this). */
export const MAX_UNITS_PER_TX = 100_000;

class PgTx implements Tx {
  private _audited = false;
  private units = 0;
  private depth = 0;
  constructor(
    private readonly client: pg.PoolClient,
    readonly ctx: KernelContext,
    private readonly readOnly = false,
    /** A scoped grant's module guard (R1-D-75), run on every statement. */
    private readonly guard?: (text: string) => void,
  ) {}

  async unit<T>(fn: (tx: Tx) => Promise<T>): Promise<UnitOutcome<T>> {
    if (this.readOnly) throw new KernelGuardError("units are for mutations");
    if (++this.units > MAX_UNITS_PER_TX)
      throw new KernelGuardError(`a transaction opens at most ${MAX_UNITS_PER_TX} units`);
    const name = `ipb_unit_${this.depth}`;
    const auditedBefore = this._audited;
    this.depth++;
    await this.client.query(`savepoint ${name}`);
    try {
      const value = await fn(this);
      await this.client.query(`release savepoint ${name}`);
      return { ok: true, value };
    } catch (error) {
      // A failed rollback (a broken connection) fails the whole transaction.
      await this.client.query(`rollback to savepoint ${name}`);
      await this.client.query(`release savepoint ${name}`);
      // The unit's ledger entries are gone with it; the commit check must not count them.
      this._audited = auditedBefore;
      return { ok: false, error };
    } finally {
      this.depth--;
    }
  }
  async query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    assertAllowedStatement(text);
    this.guard?.(text);
    const r = await this.client.query(text, params as unknown[] | undefined);
    return { rows: r.rows as R[], rowCount: r.rowCount };
  }
  markAudited(): void {
    this._audited = true;
  }
  get audited(): boolean {
    return this._audited;
  }
  /** Kernel only: apply a context's `app.*` settings to this transaction. */
  async applyContext(ctx: KernelContext, m: MutateOptions): Promise<void> {
    await applySettings(this.client, ctx, m);
  }
}

/**
 * A mutation joined to an ambient one (PR-UDF-033 (1), PR-FBX-21 (1); R1-D-48): its own context and
 * ledger check, on the ambient transaction's connection, inside a kernel unit.
 */
class JoinedTx implements Tx {
  private _audited = false;
  constructor(
    private readonly parent: PgTx,
    readonly ctx: KernelContext,
  ) {}
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    return this.parent.query<R>(text, params);
  }
  markAudited(): void {
    this._audited = true;
    this.parent.markAudited();
  }
  get audited(): boolean {
    return this._audited;
  }
  async unit<T>(fn: (tx: Tx) => Promise<T>): Promise<UnitOutcome<T>> {
    const before = this._audited;
    const out = await this.parent.unit(() => fn(this));
    if (!out.ok) this._audited = before;
    return out;
  }
}

interface AmbientScope {
  tx: PgTx;
  ctx: KernelContext;
  opts: MutateOptions;
  /** Tokens of the open joined calls, innermost last; the first is the ambient call's own. */
  stack: symbol[];
}
interface AmbientFrame {
  scope: AmbientScope;
  token: symbol;
}

async function applySettings(
  client: pg.PoolClient,
  ctx: KernelContext,
  m: MutateOptions,
): Promise<void> {
  await client.query(
    `select set_config('app.tenant_id', $1, true), set_config('app.entity_id', $2, true),
            set_config('app.actor_id', $3, true), set_config('app.trace_id', $4, true),
            set_config('app.scope', $5, true), set_config('app.breakglass', $6, true),
            set_config('app.action', $7, true), set_config('app.reason', $8, true),
            set_config('app.branch_id', $9, true), set_config('app.branch_ids', $10, true),
            set_config('app.branch_scope', $11, true), set_config('app.external_grant', $12, true)`,
    [
      ctx.tenantId,
      ctx.entityId ?? "",
      ctx.principal.id,
      ctx.traceId ?? "",
      ctx.scope ?? "tenant",
      ctx.breakGlassGrantId ?? "",
      m.action ?? "",
      m.reason ?? "",
      ctx.branchId ?? "",
      (ctx.branchIds ?? []).join(","),
      ctx.allBranches ? "all" : ctx.branchIds?.length ? "listed" : "none",
      ctx.externalGrantId ?? "",
    ],
  );
}

/**
 * The context a transaction's code sees (R1-D-87): the caller's, with `sandbox` replaced by what
 * the kernel read from the tenant row, or removed when it read nothing (the ports then fail closed).
 * A caller-supplied `sandbox` never survives into `tx.ctx`.
 */
export function withKernelSandbox(
  ctx: KernelContext,
  sandbox: boolean | null | undefined,
): KernelContext {
  const out: KernelContext = { ...ctx };
  delete out.sandbox;
  if (typeof sandbox === "boolean") out.sandbox = sandbox;
  return out;
}

/** The only action a service reader may commit: the ledger entry for its cross-tenant read. */
export const SERVICE_READ_ACTION = "platform.service_read";
/** The only action an external principal commits: the ledger entry for its read (R1-D-29). */
export const EXTERNAL_READ_ACTION = "platform.external_read";
/** The SELECT-only role an external principal reads as (tenancy/0010). */
export const EXTERNAL_DB_ROLE = "app_external";

const isExternal = (ctx: KernelContext): boolean => ctx.principal.type === "external";

function assertExternalGated(ctx: KernelContext, fn: object): void {
  if (isExternal(ctx) && !isExternalGated(fn))
    throw new IpbError("IPB-SEC-005", {
      detail: "an external principal reads through ExternalReads, which ledgers every read",
    });
}

/** Mutation guard (IPB-02-09, IPB-02-10): no writes while impersonating; agents never approve, sign, disburse, delete or grant. */
export function assertMayMutate(ctx: KernelContext, opts: MutateOptions = {}): void {
  if (ctx.act) {
    throw new IpbError("IPB-SEC-003", { detail: "impersonation sessions are read-only" });
  }
  if (isExternal(ctx) && opts.action !== EXTERNAL_READ_ACTION) {
    throw new IpbError("IPB-SEC-005", {
      detail: "an external principal only reads",
      meta: { action: opts.action ?? null },
    });
  }
  const verb = opts.action?.split(".").at(-1);
  const reader = serviceReaderRole(ctx);
  // A service reader writes only the ledger entry that records its own read, in a tenant context;
  // it never mutates in platform scope and never approves, signs, disburses, deletes or grants.
  // The outbox relay may also mark one tenant's outbox rows dispatched (R1-D-01); the database
  // role it then runs as is granted nothing else.
  const relayDispatch =
    reader === "SVC_OUTBOX_RELAY" && OUTBOX_DISPATCH_ACTION.test(opts.action ?? "");
  if (
    reader &&
    (ctx.scope === "platform" || (opts.action !== SERVICE_READ_ACTION && !relayDispatch))
  ) {
    throw new IpbError("IPB-SEC-005", {
      detail: `${reader} is read-only`,
      meta: { action: opts.action ?? null },
    });
  }
  if (
    verb &&
    isAgentPrincipal(ctx) &&
    (AGENT_FORBIDDEN_VERBS as readonly string[]).includes(verb)
  ) {
    throw new IpbError("IPB-SEC-004", {
      detail: `agents may not ${verb}`,
      meta: { action: opts.action },
    });
  }
}

export class PgKernel implements MutationKernel {
  private readonly pool: PoolLike;
  private readonly role: string;
  private readonly readRole: string;
  private readonly audit: AuditSink | undefined;
  private readonly ambientFrame = new AsyncLocalStorage<AmbientFrame>();

  constructor(opts: PgKernelOptions) {
    this.pool = opts.pool;
    this.role = opts.role ?? "app_rw";
    this.readRole = opts.readRole ?? this.role;
    this.audit = opts.audit;
  }

  async mutate<T>(
    ctx: KernelContext,
    fn: (tx: Tx) => Promise<T>,
    opts: MutateOptions = {},
  ): Promise<T> {
    assertValidContext(ctx);
    assertMayMutate(ctx, opts);
    assertExternalGated(ctx, fn);
    // The outbox relay's dispatch runs as its own database role, granted only the registered
    // outbox tables and the ledger append (R1-D-01); every other mutation runs as the app role.
    const role =
      serviceReaderRole(ctx) === "SVC_OUTBOX_RELAY"
        ? SERVICE_READER_ROLES.SVC_OUTBOX_RELAY.dbRole
        : this.role;
    if (opts.reason !== undefined && (opts.reason.length < 1 || opts.reason.length > 500))
      throw new RangeError("a mutation's reason has 1 to 500 characters");
    const frame = this.ambientFrame.getStore();
    if (frame) return this.joined(frame, ctx, role, fn, opts);
    return this.run(
      ctx,
      role,
      false,
      opts,
      async (tx) => {
        const r = await fn(tx);
        if (!tx.audited) {
          throw new IpbError("IPB-MOD-003", {
            detail: `mutation${opts.action ? ` ${opts.action}` : ""} wrote no audit ledger entry`,
          });
        }
        return r;
      },
      isSupportContext(ctx) ? supportGateOf(fn) : undefined,
    );
  }

  /**
   * A mutation that every `mutate` on this kernel made within `fn` joins (Udofin PR-UDF-033 (1),
   * Finbyx PR-FBX-21 (1); R1-D-48): a service that opens its own mutation then runs in the caller's
   * transaction, so `idempotent(tx, …)` can wrap a handler whose services each call `mutate`. Each
   * joined call runs in a kernel unit (a savepoint) with its own `app.*` settings and its own ledger
   * check: when it throws, only its writes roll back and the error reaches its caller; the ambient
   * settings are restored after it. A joined call must be the ambient one's tenant, principal,
   * scope and break-glass grant, runs as the app role, and joined calls run one at a time. Reads
   * are not joined: `read` keeps its own read-only transaction.
   */
  async ambient<T>(
    ctx: KernelContext,
    fn: (tx: Tx) => Promise<T>,
    opts: MutateOptions = {},
  ): Promise<T> {
    if (this.ambientFrame.getStore())
      throw new KernelGuardError("an ambient mutation is already open");
    if (isExternal(ctx) || serviceReaderRole(ctx))
      throw new IpbError("IPB-SEC-005", {
        detail: "external principals and service readers do not open ambient mutations",
      });
    return this.mutate(
      ctx,
      async (tx) => {
        const token = Symbol("ambient");
        const scope: AmbientScope = { tx: tx as PgTx, ctx, opts, stack: [token] };
        return this.ambientFrame.run({ scope, token }, () => fn(tx));
      },
      opts,
    );
  }

  private async joined<T>(
    frame: AmbientFrame,
    ctx: KernelContext,
    role: string,
    fn: (tx: Tx) => Promise<T>,
    opts: MutateOptions,
  ): Promise<T> {
    const { scope } = frame;
    if (scope.stack.at(-1) !== frame.token)
      throw new KernelGuardError("mutations joined to an ambient one run one at a time");
    const a = scope.ctx;
    if (
      ctx.tenantId !== a.tenantId ||
      ctx.principal.id !== a.principal.id ||
      (ctx.scope ?? "tenant") !== (a.scope ?? "tenant") ||
      (ctx.breakGlassGrantId ?? "") !== (a.breakGlassGrantId ?? "") ||
      role !== this.role
    )
      throw new KernelGuardError(
        "a joined mutation must have the ambient mutation's tenant, principal, scope and grant",
      );
    const token = Symbol("joined");
    scope.stack.push(token);
    let out: UnitOutcome<T>;
    try {
      out = await scope.tx.unit(async () => {
        await scope.tx.applyContext(ctx, opts);
        // Same tenant as the ambient transaction: its sandbox flag, not the caller's (R1-D-87).
        const child = new JoinedTx(scope.tx, withKernelSandbox(ctx, scope.tx.ctx.sandbox));
        const r = await this.ambientFrame.run({ scope, token }, () => fn(child));
        if (!child.audited)
          throw new IpbError("IPB-MOD-003", {
            detail: `mutation${opts.action ? ` ${opts.action}` : ""} wrote no audit ledger entry`,
          });
        return r;
      });
    } finally {
      scope.stack.pop();
    }
    // A released savepoint keeps the joined call's settings; put the ambient ones back.
    await scope.tx.applyContext(a, scope.opts);
    if (!out.ok) throw out.error;
    return out.value;
  }

  async read<T>(
    ctx: KernelContext,
    fn: (tx: Tx) => Promise<T>,
    opts: ReadOptions = {},
  ): Promise<T> {
    assertValidContext(ctx);
    assertExternalGated(ctx, fn);
    // A support principal reads only through SupportReads, which ledgers every read (R1-D-76).
    const gate = isSupportContext(ctx) ? supportGateOf(fn) : undefined;
    if (isSupportContext(ctx) && gate !== "read" && gate !== "manage")
      throw new IpbError("IPB-SEC-005", {
        detail: "a support principal reads through SupportReads, which ledgers every read",
      });
    // A service reader in platform scope runs as its own database role, which is granted only the
    // columns it needs (PL3-D-21); RLS still applies. An external principal reads as the
    // SELECT-only app_external, under its grant's restrictive policies (R1-D-29).
    const reader = ctx.scope === "platform" ? serviceReaderRole(ctx) : undefined;
    return this.run(
      ctx,
      reader
        ? SERVICE_READER_ROLES[reader].dbRole
        : isExternal(ctx)
          ? EXTERNAL_DB_ROLE
          : this.readRole,
      opts.snapshot ? "snapshot" : true,
      {},
      fn,
      gate,
    );
  }

  /**
   * Before a break-glass context's transaction, in its own short one: the grant's scope (R1-D-75),
   * then the use, recorded in the tenant it touches, read or write, so the tenant sees every grant
   * used on its data (tenancy/0009, R1-D-28). A scoped grant used in another tenant, in a platform
   * context or for a write under `read` is refused (IPB-SEC-005) and ledgered there, and not
   * recorded as a use. An inactive grant records nothing; the transaction then refuses it
   * (IPB-SEC-009).
   */
  private async breakGlassPreflight(
    ctx: KernelContext,
    write: boolean,
    m: MutateOptions,
  ): Promise<GrantScope | undefined> {
    const client = await this.pool.connect();
    let scope: GrantScope | undefined;
    let refusal: ScopeRefusal | undefined;
    try {
      await client.query("begin");
      await client.query(`set local role ${quoteIdent(this.role)}`);
      await client.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      const r = await client.query<{
        scope_tenant_id: string | null;
        scope_modules: string[] | null;
        scope_access: "read" | "read_write" | null;
      }>("select * from tenancy.breakglass_scope($1, $2)", [
        ctx.breakGlassGrantId,
        ctx.principal.id,
      ]);
      const row = r.rows[0];
      if (row?.scope_access) {
        scope = {
          kind: "breakglass",
          grantId: ctx.breakGlassGrantId as string,
          tenantId: row.scope_tenant_id,
          modules: row.scope_modules,
          access: row.scope_access,
        };
        if (ctx.scope === "platform" || row.scope_tenant_id !== ctx.tenantId)
          refusal = { scope, reason: "tenant" };
        else if (write && row.scope_access === "read") refusal = { scope, reason: "write" };
        if (!this.audit)
          throw new KernelGuardError(
            "a scoped grant needs the kernel's audit sink (PgKernelOptions.audit)",
          );
      }
      if (!refusal && ctx.scope !== "platform")
        await client.query("select tenancy.breakglass_touch($1, $2)", [
          ctx.breakGlassGrantId,
          ctx.principal.id,
        ]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    if (refusal) {
      await this.ledgerRefusal(ctx, refusal, m.action);
      throw scopeRefusal(refusal, m.action);
    }
    return scope;
  }

  /** Ledger a scope refusal in the context's tenant, in its own transaction (R1-D-75, R1-D-76). */
  private async ledgerRefusal(ctx: KernelContext, r: ScopeRefusal, action?: string): Promise<void> {
    const audit = this.audit;
    if (!audit) throw new KernelGuardError("a scoped grant needs the kernel's audit sink");
    const support = r.scope.kind === "support";
    const ledgerAction = support ? SUPPORT_SCOPE_REFUSED_ACTION : BREAKGLASS_SCOPE_REFUSED_ACTION;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${quoteIdent(this.role)}`);
      await applySettings(client, ctx, { action: ledgerAction });
      await audit.record(new PgTx(client, withKernelSandbox(ctx, undefined)), {
        action: ledgerAction,
        resourceType: support ? "support_grant" : "breakglass_grant",
        resourceId: r.scope.grantId,
        after: {
          reason: r.reason,
          tenant_id: ctx.tenantId,
          scope: { tenant_id: r.scope.tenantId, modules: r.scope.modules, access: r.scope.access },
          ...(r.module ? { module: r.module } : {}),
          ...(action ? { action } : {}),
        },
      });
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  private async run<T>(
    ctx: KernelContext,
    role: string,
    readOnly: boolean | "snapshot",
    m: MutateOptions,
    fn: (tx: Tx) => Promise<T>,
    gate?: SupportGate,
  ): Promise<T> {
    let scope = ctx.breakGlassGrantId
      ? await this.breakGlassPreflight(ctx, readOnly === false, m)
      : undefined;
    // A support principal runs its own requests (`manage`) and the ledger entries of its reads
    // (`record`) without a grant; anything else needs its live grant in this tenant (R1-D-76).
    const needsGrant = isSupportContext(ctx) && gate !== "manage" && gate !== "record";
    if (needsGrant && !this.audit)
      throw new KernelGuardError(
        "support access needs the kernel's audit sink (PgKernelOptions.audit)",
      );
    let live: LiveSupportGrant | undefined;
    const client = await this.pool.connect();
    const refused: ScopeRefusal[] = [];
    try {
      await client.query(
        readOnly === "snapshot"
          ? "begin isolation level repeatable read read only"
          : readOnly
            ? "begin read only"
            : "begin",
      );
      await client.query(`set local role ${quoteIdent(role)}`);
      await applySettings(client, ctx, m);
      if (ctx.breakGlassGrantId) {
        const r = await client.query<{ ok: boolean }>(
          "select tenancy.breakglass_active($1, $2) as ok",
          [ctx.breakGlassGrantId, ctx.principal.id],
        );
        if (!r.rows[0]?.ok)
          throw new IpbError("IPB-SEC-009", { detail: "break-glass grant is not active" });
      }
      // An external read needs its grant active, the principal's own and in this tenant; the
      // ledger write that follows it is not refused, so a read is recorded even if the grant
      // was revoked in between.
      if (role === EXTERNAL_DB_ROLE) {
        const r = await client.query<{ ok: boolean }>(
          "select tenancy.external_grant_active() as ok",
        );
        if (!r.rows[0]?.ok)
          throw new IpbError("IPB-TRUST-003", {
            detail: "external grant is not active",
            meta: { grant_id: ctx.externalGrantId ?? null },
          });
      }
      // A support principal without a live, consented grant in this tenant sees nothing; under a
      // read grant it never writes (R1-D-76).
      if (needsGrant) {
        const g = await client.query<LiveSupportGrant>(
          `select id, modules, access from tenancy.support_grant
            where tenant_id = $1 and requester_id = $2 and state = 'active' and expires_at > now()`,
          [ctx.tenantId, ctx.principal.id],
        );
        if (g.rows.length !== 1)
          throw new IpbError("IPB-TRUST-003", {
            detail: "no live support access grant for this principal in this tenant",
          });
        live = g.rows[0] as LiveSupportGrant;
        scope = {
          kind: "support",
          grantId: live.id,
          tenantId: ctx.tenantId,
          modules: live.modules,
          access: live.access,
        };
        if (readOnly === false && live.access === "read")
          throw scopeRefusal({ scope, reason: "write" }, m.action);
      }
      // A scoped grant's statements name only its modules (R1-D-75); a module is a schema. Each
      // refusal is kept, so it is ledgered even when the caller catches it (a unit, a retry).
      let guard: ((text: string) => void) | undefined;
      if (scope?.modules) {
        const ns = await client.query<{ nspname: string }>(
          "select nspname from pg_catalog.pg_namespace",
        );
        const check = moduleGuard(scope, new Set(ns.rows.map((r) => r.nspname)));
        guard = (text) => {
          try {
            check(text);
          } catch (e) {
            const r = refusalOf(e);
            if (r) refused.push(r);
            throw e;
          }
        };
      }
      // The tenant's sandbox flag, read once per transaction, replaces whatever the caller passed
      // (R1-D-87). The service readers' and the outbox relay's own roles are not granted the lookup
      // and never send or call a model: their transactions carry no flag (fail closed).
      let sandbox: boolean | null = null;
      if (role === this.role || role === this.readRole || role === EXTERNAL_DB_ROLE) {
        const sb = await client.query<{ sandbox: boolean | null }>(
          "select tenancy.tenant_sandbox() as sandbox",
        );
        sandbox = sb.rows[0]?.sandbox ?? null;
      }
      const tx = new PgTx(client, withKernelSandbox(ctx, sandbox), readOnly !== false, guard);
      if (live) bindSupportGrant(tx, live);
      const result = await fn(tx);
      await client.query("commit");
      return result;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      const r = refusalOf(e);
      if (r && !refused.includes(r)) refused.push(r);
      throw e;
    } finally {
      client.release();
      // Ledgered on their own, after the transaction (which may have rolled back) has ended.
      const seen = new Set<string>();
      for (const r of refused) {
        const key = `${r.reason}:${r.module ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await this.ledgerRefusal(ctx, r, m.action);
      }
    }
  }
}

function quoteIdent(s: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`invalid role name ${s}`);
  return `"${s}"`;
}
