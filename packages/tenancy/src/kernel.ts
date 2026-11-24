// Transaction kernel (PL1 plan §3.2): every mutation runs in one transaction with the verified
// context applied through SET LOCAL (IPB-01 §01.4.6, IPB-02-13), and the commit fails unless the
// audit ledger was written in that transaction (IPB-02-51, IPB-MOD-003).
import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import {
  AGENT_FORBIDDEN_VERBS,
  FUNCTION_ROLE_REGEX,
  OUTBOX_DISPATCH_ACTION,
  PRODUCT_ROLE_REGEX,
  SERVICE_READER_ROLES,
} from "@infrabyx/contracts/roles";
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditEntryInput,
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
  BRANCH_ID_PATTERN,
  MAX_BRANCH_IDS,
  assertValidContext,
  isAgentPrincipal,
  isSupportContext,
  serviceReaderRole,
} from "./context.js";
import { KernelGuardError } from "./errors.js";
import { isExternalGated } from "./external-gate.js";
import {
  bindScopedBranchRead,
  type ScopedBranchReadRequest,
  type ScopedBranchReadSource,
} from "./scoped-read-gate.js";
import {
  moduleGuard,
  refusalOf,
  scopeRefusal,
  TENANT_APPROVAL_REFUSAL,
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
  /**
   * Every branch the caller holds a grant on, open or closed (Finbyx PR-FBX-54; R1-D-273), for the
   * grant check of a scoped branch read. It runs on the mutation's transaction under the caller's
   * context and must only read. Without it the caller's own `allBranches` or `branchIds` are its
   * grants, so a closed branch must then be in `branchIds`.
   */
  branchGrants?: BranchGrantSource;
  /**
   * The named scoped-branch-read capabilities this kernel issues (R1-D-273), each once, through
   * `scopedBranchReadCapability(name)`: 2 to 4 dot-separated segments of `a-z 0-9 _`, a letter
   * first, at most 32 characters each, never under `approvals.` (the approval executor's own
   * path). None by default.
   */
  scopedBranchReadCapabilities?: readonly string[];
  /**
   * Admit a scoped break-glass grant in a tenant only while that tenant's own approval of it is
   * live (Finbyx PR-FBX-55; R1-D-284; tenancy/0031; `BreakGlassTenantApproval`). Default false:
   * a scoped grant needs no tenant approval, as before. Either way a tenant's refusal or
   * revocation of a scoped grant is always enforced; an unscoped grant is never affected.
   */
  requireTenantApprovedBreakGlass?: boolean;
}

/** The branches a caller holds a grant on: every branch of the tenant, or these (R1-D-273). */
export type BranchGrantSource = (
  tx: Tx,
) => Promise<ReadonlySet<string> | readonly string[] | "all">;

/** What a scoped branch read names (R1-D-273). */
export interface ScopedBranchReadOptions {
  /** The branches the read sees, exactly: 1 to 1000 distinct branch ids, each granted to the caller. */
  branchIds: readonly string[];
  /** Why (1 to 500 characters, no control character), in the ledger entry. No personal data. */
  reason: string;
}

/** A named scoped-branch-read capability (R1-D-273), issued once by the kernel that declared it. */
export interface ScopedBranchReadCapability {
  readonly name: string;
  /**
   * Inside the mutation `tx` (of the issuing kernel), run `fn` read-only under the caller's context
   * with its branch scope set to exactly `opts.branchIds`; ledgered in `tx`'s transaction.
   */
  scopedBranchRead<T>(
    tx: Tx,
    opts: ScopedBranchReadOptions,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T>;
}

/** Ledger action of a scoped branch read, written in the mutation's transaction (R1-D-273). */
export const SCOPED_BRANCH_READ_ACTION = "security.branch_scope.read";
/** Ledger action of a refused scoped branch read, written after the transaction (R1-D-273). */
export const SCOPED_BRANCH_READ_REFUSED_ACTION = "security.branch_scope.read_refused";
/** The fixed `meta.refusal` labels of a refused scoped branch read (IPB-SEC-005). */
export const SCOPED_BRANCH_READ_REFUSALS = [
  "principal",
  "branch_ids",
  "reason",
  "grants",
  "ungranted",
] as const;
export type ScopedBranchReadRefusal = (typeof SCOPED_BRANCH_READ_REFUSALS)[number];
/** The longest reason a scoped branch read states. */
export const MAX_SCOPED_BRANCH_READ_REASON = 500;
const CAPABILITY_NAME = /^[a-z][a-z0-9_]{0,31}(?:\.[a-z][a-z0-9_]{0,31}){1,3}$/;
// C0 controls and DEL: a reason is one line of text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Ledger actions of the kernel's scope refusals (R1-D-75). */
export const BREAKGLASS_SCOPE_REFUSED_ACTION = "security.breakglass.scope_refused";
export const SUPPORT_SCOPE_REFUSED_ACTION = "security.support_access.scope_refused";
/**
 * The fixed `meta.refusal` (and ledgered `reason`) of a scoped break-glass grant refused for want
 * of the tenant's approval, or for its refusal or revocation (R1-D-284); `meta.tenant_approval`
 * carries the decision the kernel read.
 */
export const BREAKGLASS_TENANT_APPROVAL_REFUSAL = TENANT_APPROVAL_REFUSAL;

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

/**
 * Refuses work on a transaction that has ended (R1-D-92): its connection goes back to the pool
 * and its next user may be another tenant, so a statement from a call that outlived it must never
 * reach the connection.
 */
const ENDED = "the transaction has ended: no statement may run on its connection";

/**
 * When a call in an ambient mutation may use the connection (PR-UDF-062; R1-D-237): undefined when
 * it may now, else a promise to wait on before asking again. It throws when the call may never run
 * (the call it was made from has ended, or a joined call's settings could not be restored).
 *
 * Callers wait with `for (let w = turn(); w; w = turn()) await w;` and then send their statement
 * in the same tick: the last check and the statement must not be split by an `await`, or another
 * call could take the connection in between.
 */
type Turn = () => Promise<void> | undefined;

class PgTx implements Tx {
  private _audited = false;
  private units = 0;
  private depth = 0;
  private ended = false;
  /**
   * Kernel only: set on an ambient mutation's transaction (PR-UDF-062; R1-D-237), so a statement
   * or unit runs only when its call is the innermost one open on the connection. Undefined on
   * every other transaction, whose statements run as before.
   */
  turn?: Turn;
  /**
   * Kernel only: set while a scoped branch read is open on this transaction (R1-D-273): no other
   * statement, unit or read unit runs on it until the read's savepoint is rolled back.
   */
  scopedOpen = false;
  /** Kernel only: scoped branch read refusals, ledgered after the transaction ends (R1-D-273). */
  readonly branchScopeRefusals: Array<{ ctx: KernelContext; entry: AuditEntryInput }> = [];
  constructor(
    private readonly client: pg.PoolClient,
    readonly ctx: KernelContext,
    private readonly readOnly = false,
    /** A scoped grant's module guard (R1-D-75), run on every statement. */
    private readonly guard?: (text: string) => void,
  ) {}

  /** Kernel only: no statement runs after this (called before commit or rollback). */
  end(): void {
    this.ended = true;
  }
  /** Kernel only: whether statements may still run on this transaction. */
  get open(): boolean {
    return !this.ended;
  }
  private assertOpen(): void {
    if (this.ended) throw new KernelGuardError(ENDED);
  }
  private assertNoScopedRead(): void {
    if (this.scopedOpen) throw new KernelGuardError(SCOPED_OPEN);
  }

  unit<T>(fn: (tx: Tx) => Promise<T>): Promise<UnitOutcome<T>> {
    return this.unitIn(fn, this.turn);
  }

  /**
   * Kernel only: a unit whose savepoint is opened and closed only when `turn` lets it (PR-UDF-062;
   * R1-D-237), so it never closes over another call's savepoint. `unit` passes the transaction's
   * own turn (none outside an ambient mutation); a joined mutation passes its own call's.
   */
  async unitIn<T>(fn: (tx: Tx) => Promise<T>, turn?: Turn): Promise<UnitOutcome<T>> {
    if (turn) for (let w = turn(); w; w = turn()) await w;
    this.assertOpen();
    this.assertNoScopedRead();
    if (this.readOnly) throw new KernelGuardError("units are for mutations");
    if (++this.units > MAX_UNITS_PER_TX)
      throw new KernelGuardError(`a transaction opens at most ${MAX_UNITS_PER_TX} units`);
    const name = `ipb_unit_${this.depth}`;
    const auditedBefore = this._audited;
    this.depth++;
    await this.client.query(`savepoint ${name}`);
    try {
      const value = await fn(this);
      if (turn) for (let w = turn(); w; w = turn()) await w;
      await this.client.query(`release savepoint ${name}`);
      return { ok: true, value };
    } catch (error) {
      if (turn) for (let w = turn(); w; w = turn()) await w;
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
    // In an ambient mutation a statement waits until its call is the innermost one open, so it
    // never runs under another call's savepoint or settings (PR-UDF-062; R1-D-237).
    for (let w = this.turn?.(); w; w = this.turn?.()) await w;
    this.assertOpen();
    this.assertNoScopedRead();
    return this.send<R>(text, params);
  }
  /**
   * Kernel only: a statement of the scoped branch read open on this transaction (R1-D-273), which
   * alone may run while it is open. It takes its turn and passes the statement guard as any other.
   */
  async scopedQuery<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    for (let w = this.turn?.(); w; w = this.turn?.()) await w;
    this.assertOpen();
    return this.send<R>(text, params);
  }
  private async send<R>(text: string, params?: readonly unknown[]): Promise<QueryResult<R>> {
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
    this.assertOpen();
    await applySettings(this.client, ctx, m);
  }

  /**
   * Kernel only: a read joined to an ambient mutation (PR-UDF-037; R1-D-188). `fn` runs in a
   * savepoint as `role`, read-only, with the read's own `app.*` settings; the savepoint is always
   * rolled back, which undoes the role, the read-only flag and the settings (each set with SET
   * LOCAL inside it), so the ambient transaction carries on as it was. The savepoint is opened and
   * rolled back only when `turn` lets it (PR-UDF-062; R1-D-237). With `scoped` it is a scoped
   * branch read (R1-D-273): nothing else runs on the transaction until its savepoint is rolled back.
   */
  async readUnit<T>(
    role: string,
    ctx: KernelContext,
    fn: () => Promise<T>,
    turn?: Turn,
    scoped = false,
  ): Promise<UnitOutcome<T>> {
    if (turn) for (let w = turn(); w; w = turn()) await w;
    this.assertOpen();
    this.assertNoScopedRead();
    if (this.readOnly) throw new KernelGuardError("units are for mutations");
    if (++this.units > MAX_UNITS_PER_TX)
      throw new KernelGuardError(`a transaction opens at most ${MAX_UNITS_PER_TX} units`);
    const name = `ipb_unit_${this.depth}`;
    const auditedBefore = this._audited;
    this.depth++;
    // Set before the savepoint opens, in the tick of the checks, so no other statement can be sent
    // in between (R1-D-273); cleared only once the savepoint is rolled back and released.
    if (scoped) this.scopedOpen = true;
    await this.client.query(`savepoint ${name}`);
    try {
      await this.client.query(`set local role ${quoteIdent(role)}`);
      await this.client.query("set local transaction_read_only = on");
      await applySettings(this.client, ctx, {});
      return { ok: true, value: await fn() };
    } catch (error) {
      return { ok: false, error };
    } finally {
      if (turn) for (let w = turn(); w; w = turn()) await w;
      // A failed rollback (a broken connection) fails the whole transaction; a scoped read's flag
      // then stays set, so nothing more runs on it.
      await this.client.query(`rollback to savepoint ${name}`);
      await this.client.query(`release savepoint ${name}`);
      if (scoped) this.scopedOpen = false;
      this._audited = auditedBefore;
      this.depth--;
    }
  }
}

const SCOPED_OPEN =
  "a scoped branch read is open on this transaction: nothing else runs on it until the read ends, and scoped reads do not nest";

/**
 * The transaction a scoped branch read's callback gets (R1-D-273): its statements run on the
 * mutation's connection inside the read's savepoint, read-only, under the derived branch scope.
 * It opens no units and its ledger mark counts for nothing.
 */
class ScopedBranchReadTx implements Tx {
  private ended = false;
  constructor(
    private readonly parent: PgTx,
    readonly ctx: KernelContext,
  ) {}
  /** Kernel only: the read is over; its tx may not be used again (R1-D-92). */
  end(): void {
    this.ended = true;
  }
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    if (this.ended) return Promise.reject(new KernelGuardError(ENDED));
    return this.parent.scopedQuery<R>(text, params);
  }
  markAudited(): void {
    // A read writes no ledger entry; its unit is rolled back, so nothing it wrote would survive.
  }
  get audited(): boolean {
    return false;
  }
  unit<T>(): Promise<UnitOutcome<T>> {
    return Promise.reject(new KernelGuardError("units are for mutations"));
  }
}

/**
 * A read joined to an ambient mutation (PR-UDF-037; R1-D-188): its statements run on the ambient
 * connection inside a read unit, so they see the ambient transaction's uncommitted writes. Like a
 * `read`'s transaction it opens no units and its ledger mark counts for nothing.
 */
class JoinedReadTx implements Tx {
  private ended = false;
  constructor(
    private readonly parent: PgTx,
    readonly ctx: KernelContext,
  ) {}
  /** Kernel only: the read is over; its tx may not be used again (R1-D-92). */
  end(): void {
    this.ended = true;
  }
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    if (this.ended) return Promise.reject(new KernelGuardError(ENDED));
    return this.parent.query<R>(text, params);
  }
  markAudited(): void {
    // A read writes no ledger entry; its unit is rolled back, so nothing it wrote would survive.
  }
  get audited(): boolean {
    return false;
  }
  unit<T>(): Promise<UnitOutcome<T>> {
    return Promise.reject(new KernelGuardError("units are for mutations"));
  }
}

/**
 * A mutation joined to an ambient one (PR-UDF-033 (1), PR-FBX-21 (1); R1-D-48): its own context and
 * ledger check, on the ambient transaction's connection, inside a kernel unit.
 */
class JoinedTx implements Tx {
  private _audited = false;
  private ended = false;
  constructor(
    /** Kernel only: the ambient transaction this call runs on. */
    readonly parent: PgTx,
    readonly ctx: KernelContext,
  ) {}
  /** Kernel only: the joined call's unit is over; its tx may not be used again (R1-D-92). */
  end(): void {
    this.ended = true;
  }
  /** Kernel only: whether the joined call's unit is still open. */
  get open(): boolean {
    return !this.ended;
  }
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    if (this.ended) return Promise.reject(new KernelGuardError(ENDED));
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
    if (this.ended) throw new KernelGuardError(ENDED);
    const before = this._audited;
    const out = await this.parent.unit(() => fn(this));
    if (!out.ok) this._audited = before;
    return out;
  }
}

/** An open call on an ambient mutation's connection, with the settings it runs under. */
interface OpenCall {
  token: symbol;
  ctx: KernelContext;
  opts: MutateOptions;
  /** Set once the call's callback has settled: nothing new may start from it or run as it. */
  closing?: boolean;
}

interface AmbientScope {
  tx: PgTx;
  ctx: KernelContext;
  opts: MutateOptions;
  /**
   * The open calls, innermost last; the first is the ambient call's own. Only the innermost uses
   * the connection; a call made from it runs at once, and any other waits its turn (PR-UDF-062).
   */
  stack: OpenCall[];
  /** Resolved and replaced each time a call closes: the waiting calls then ask again, in order. */
  wake: { promise: Promise<void>; resolve: () => void };
  /** Set when a joined call's settings could not be restored: nothing more runs (PR-UDF-062). */
  broken?: { error: unknown };
  /** Joined calls not yet settled; the ambient mutation waits for them before it ends (R1-D-92). */
  inflight: Set<Promise<unknown>>;
  /** Set when the ambient mutation ends: a joined call that starts later is refused. */
  ended: boolean;
  /** Reads join too (`AmbientOptions.joinReads`; PR-UDF-037, R1-D-188). */
  joinReads: boolean;
}

const BROKEN =
  "a joined call's settings could not be restored: nothing more runs in this ambient mutation";

function wakeSignal(): AmbientScope["wake"] {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Wakes every waiting call; each asks again in the order it started waiting. */
function wakeAll(scope: AmbientScope): void {
  const { resolve } = scope.wake;
  scope.wake = wakeSignal();
  resolve();
}

/**
 * The turn of the code of call `token` on `scope`'s connection (PR-UDF-062; R1-D-237): now when it
 * is the innermost open call, else once the calls above it close. Code of a call that has ended or
 * whose callback has settled never runs (a call made from it, or a statement it left behind),
 * except the kernel's own closing of that call (`own`).
 */
function turnOf(scope: AmbientScope, token: symbol, own = false): Promise<void> | undefined {
  if (scope.broken) throw new KernelGuardError(BROKEN);
  const i = scope.stack.findIndex((c) => c.token === token);
  if (i < 0 || (!own && scope.stack[i]!.closing))
    throw new KernelGuardError("the call this one was made from has ended: it cannot run");
  return i === scope.stack.length - 1 ? undefined : scope.wake.promise;
}

/** Options of `PgKernel.ambient`: the mutation's own, and whether reads join it. */
export interface AmbientOptions extends MutateOptions {
  /**
   * When true, a `read` made within the callback joins the ambient transaction (PR-UDF-037;
   * R1-D-188): it sees the transaction's uncommitted writes, runs read-only as the read role, and
   * runs one at a time with the joined mutations (queued, PR-UDF-062). A read by another principal
   * of the same tenant joins with its own `app.*` settings (PR-UDF-062; R1-D-237). A `snapshot`
   * read, a read for another tenant, scope or grant, a read by another principal when either
   * carries a break-glass grant or support access, and a support, external or platform service
   * read keep their own transaction. Default false: every read keeps its own transaction, as
   * before 1.21.
   */
  joinReads?: boolean;
}
interface AmbientFrame {
  scope: AmbientScope;
  token: symbol;
}

/** The longest role name `app.roles` carries (tenancy/0028's registry holds the same limit). */
export const MAX_DB_ROLE_LENGTH = 128;

/**
 * The verified context's roles as `app.roles` carries them (PR-UDF-084; R1-D-280): comma-joined,
 * each a well-formed role name (`RoleSchema`'s forms: `XX_…` to `XXXX_…`, or `FN:…`) of at most
 * 128 characters, in the order given, without repeats. A role of any other form is left out (no
 * comma or other character can reach the setting), so a database check on it fails closed.
 */
export function rolesSetting(ctx: KernelContext): string {
  const out = new Set<string>();
  for (const r of ctx.principal.roles)
    if (
      typeof r === "string" &&
      r.length <= MAX_DB_ROLE_LENGTH &&
      (PRODUCT_ROLE_REGEX.test(r) || FUNCTION_ROLE_REGEX.test(r))
    )
      out.add(r);
  return [...out].join(",");
}

async function applySettings(
  client: pg.PoolClient,
  ctx: KernelContext,
  m: MutateOptions,
): Promise<void> {
  // `app.roles` (R1-D-280) is set here with the rest, from the verified context only; callback
  // SQL may not set any `app.*` setting (FORBIDDEN above), so it has the trust of `app.tenant_id`.
  await client.query(
    `select set_config('app.tenant_id', $1, true), set_config('app.entity_id', $2, true),
            set_config('app.actor_id', $3, true), set_config('app.trace_id', $4, true),
            set_config('app.scope', $5, true), set_config('app.breakglass', $6, true),
            set_config('app.action', $7, true), set_config('app.reason', $8, true),
            set_config('app.branch_id', $9, true), set_config('app.branch_ids', $10, true),
            set_config('app.branch_scope', $11, true), set_config('app.external_grant', $12, true),
            set_config('app.roles', $13, true)`,
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
      rolesSetting(ctx),
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
  private readonly branchGrants: BranchGrantSource | undefined;
  private readonly requireTenantApprovedBreakGlass: boolean;
  /** Declared scoped-branch-read capabilities, and those already issued (R1-D-273). */
  private readonly capabilities: ReadonlySet<string>;
  private readonly issued = new Set<string>();
  /** The mutation transactions this kernel opened: the only ones a scoped read runs in. */
  private readonly mutationTxs = new WeakSet<PgTx>();

  constructor(opts: PgKernelOptions) {
    this.pool = opts.pool;
    this.role = opts.role ?? "app_rw";
    this.readRole = opts.readRole ?? this.role;
    this.audit = opts.audit;
    this.branchGrants = opts.branchGrants;
    this.requireTenantApprovedBreakGlass = opts.requireTenantApprovedBreakGlass === true;
    const names = opts.scopedBranchReadCapabilities ?? [];
    for (const n of names)
      if (typeof n !== "string" || !CAPABILITY_NAME.test(n) || n.startsWith("approvals."))
        throw new RangeError(`invalid scoped branch read capability name ${JSON.stringify(n)}`);
    if (new Set(names).size !== names.length)
      throw new RangeError("scoped branch read capability names must be distinct");
    this.capabilities = new Set(names);
    // The approval executor's path (R1-D-273): the approvals engine of this package finds it by
    // this kernel instance; nothing outside the package can.
    bindScopedBranchRead(this, (tx, source, req, fn) =>
      this.#scopedBranchRead(tx, source, req, fn),
    );
  }

  /**
   * The named scoped-branch-read capability `name` (Finbyx PR-FBX-54; R1-D-273), declared in
   * `PgKernelOptions.scopedBranchReadCapabilities`, issued once: wire it at start-up into the one
   * service that needs it. A second call, or an undeclared name, throws `KernelGuardError`.
   */
  scopedBranchReadCapability(name: string): ScopedBranchReadCapability {
    if (!this.capabilities.has(name))
      throw new KernelGuardError(
        `no scoped branch read capability ${JSON.stringify(name)} was declared (PgKernelOptions.scopedBranchReadCapabilities)`,
      );
    if (this.issued.has(name))
      throw new KernelGuardError(
        `the scoped branch read capability ${JSON.stringify(name)} was already issued`,
      );
    this.issued.add(name);
    const source: ScopedBranchReadSource = Object.freeze({ kind: "capability", name });
    return Object.freeze({
      name,
      scopedBranchRead: <T>(tx: Tx, opts: ScopedBranchReadOptions, fn: (tx: Tx) => Promise<T>) =>
        this.#scopedBranchRead(tx, source, opts, fn),
    });
  }

  /** The mutation transaction of this kernel `tx` runs on, if it is one and open (R1-D-273). */
  #mutationBase(tx: Tx): PgTx {
    if (tx instanceof PgTx && tx.open && this.mutationTxs.has(tx)) return tx;
    if (tx instanceof JoinedTx && tx.open && tx.parent.open && this.mutationTxs.has(tx.parent))
      return tx.parent;
    throw new KernelGuardError(
      "a scoped branch read runs only inside a mutation this kernel opened, on its own transaction",
    );
  }

  /**
   * A scoped branch read (Finbyx PR-FBX-54; R1-D-273): inside the mutation `tx`, `fn` runs
   * read-only (a read unit as the read role, always rolled back) under the caller's context with
   * its branch scope set to exactly the named branches, every one of which the caller must hold a
   * grant on (`branchGrants`, else the context's own branches). Ledgered in the mutation's
   * transaction before the read, so the entry commits or rolls back with the mutation; it does not
   * count as the mutation's own ledger entry. A refusal is `IPB-SEC-005` with a fixed
   * `meta.refusal`, ledgered in its own transaction after the mutation's has ended. Reached only by
   * an approval executor (`ActionPolicy.execute`'s fourth argument) or a named capability.
   */
  async #scopedBranchRead<T>(
    tx: Tx,
    source: ScopedBranchReadSource,
    req: ScopedBranchReadRequest,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const audit = this.audit;
    if (!audit)
      throw new KernelGuardError(
        "a scoped branch read needs the kernel's audit sink (PgKernelOptions.audit)",
      );
    const base = this.#mutationBase(tx);
    if (base.scopedOpen) throw new KernelGuardError(SCOPED_OPEN);
    if (typeof fn !== "function") throw new TypeError("a scoped branch read needs a callback");
    const caller = tx.ctx;
    const resource =
      source.kind === "approval"
        ? { resourceType: "approval_request", resourceId: source.requestId }
        : { resourceType: "kernel_capability", resourceId: source.name };
    const origin =
      source.kind === "approval"
        ? { approval_request_id: source.requestId, approval_action: source.action }
        : { capability: source.name };
    const businessIds = source.kind === "approval" ? { businessIds: [source.requestId] } : {};
    const refuse = (
      refusal: ScopedBranchReadRefusal,
      detail: string,
      extra: Record<string, unknown> = {},
    ): never => {
      base.branchScopeRefusals.push({
        ctx: caller,
        entry: {
          action: SCOPED_BRANCH_READ_REFUSED_ACTION,
          ...resource,
          after: { refusal, tenant_id: caller.tenantId, ...origin, ...extra },
          ...businessIds,
        },
      });
      throw new IpbError("IPB-SEC-005", { detail, meta: { refusal } });
    };
    // A person or a service of the tenant, acting as itself: never an agent (makers only), support
    // access, break-glass, a service reader, an external principal, impersonation or platform scope.
    if (
      isAgentPrincipal(caller) ||
      isSupportContext(caller) ||
      caller.breakGlassGrantId ||
      serviceReaderRole(caller) ||
      isExternal(caller) ||
      caller.act ||
      caller.scope === "platform"
    )
      refuse("principal", "this principal does not open scoped branch reads");
    const named = (req as { branchIds?: unknown } | null | undefined)?.branchIds;
    if (
      !Array.isArray(named) ||
      named.length < 1 ||
      named.length > MAX_BRANCH_IDS ||
      !named.every((b) => typeof b === "string" && BRANCH_ID_PATTERN.test(b)) ||
      new Set(named).size !== named.length
    )
      refuse(
        "branch_ids",
        `a scoped branch read names 1 to ${MAX_BRANCH_IDS} distinct branch ids of the branch id pattern`,
      );
    // A copy, taken before any await, so the caller cannot change the list after it is checked.
    const ids: readonly string[] = Object.freeze([...(named as string[])]);
    const reason = (req as { reason?: unknown }).reason;
    if (
      typeof reason !== "string" ||
      reason.length < 1 ||
      reason.length > MAX_SCOPED_BRANCH_READ_REASON ||
      CONTROL.test(reason) ||
      reason.trim().length === 0
    )
      refuse(
        "reason",
        `a scoped branch read states a reason of 1 to ${MAX_SCOPED_BRANCH_READ_REASON} characters, with no control character`,
      );
    // Reads on the mutation's transaction under the caller's context: it cannot mark the ledger
    // or open a unit.
    const view = (): Tx => ({
      ctx: caller,
      query: <R = Record<string, unknown>>(text: string, params?: readonly unknown[]) =>
        base.query<R>(text, params),
      markAudited: () => undefined,
      get audited() {
        return false;
      },
    });
    const grants = await this.#grantsOf(caller, view());
    if (!grants) refuse("grants", 'the branch grant source answered neither a list nor "all"');
    const ungranted = grants === "all" ? [] : ids.filter((b) => !(grants as Set<string>).has(b));
    if (ungranted.length)
      refuse("ungranted", "the caller holds no grant on a named branch", {
        branch_ids: ids,
        ungranted,
      });
    await audit.record(view(), {
      action: SCOPED_BRANCH_READ_ACTION,
      ...resource,
      after: { reason, branch_ids: ids, tenant_id: caller.tenantId, ...origin },
      ...businessIds,
    });
    // The caller's tenant, principal, trace and kernel-read sandbox flag; exactly the named
    // branches; no current branch (a read changes nothing in any branch).
    const derived: KernelContext = { ...caller, branchIds: ids, allBranches: false };
    delete derived.branchId;
    assertValidContext(derived);
    const frame = this.ambientFrame.getStore();
    if (base.turn) {
      if (frame?.scope.tx !== base)
        throw new KernelGuardError(
          "a scoped branch read in an ambient mutation runs from a call open on it",
        );
      return this.joined(frame, () => this.joinedRead(frame, derived, fn, true));
    }
    const out = await base.readUnit(
      this.readRole,
      derived,
      async () => {
        const child = new ScopedBranchReadTx(base, derived);
        try {
          return await fn(child);
        } finally {
          // Before the savepoint is rolled back: a statement the callback left behind never runs
          // under the mutation's own settings.
          child.end();
        }
      },
      undefined,
      true,
    );
    if (!out.ok) throw out.error;
    return out.value;
  }

  /** The caller's branch grants (R1-D-273); null when the source answered something else. */
  async #grantsOf(caller: KernelContext, view: Tx): Promise<ReadonlySet<string> | "all" | null> {
    if (!this.branchGrants) return caller.allBranches ? "all" : new Set(caller.branchIds ?? []);
    const g: unknown = await this.branchGrants(view);
    if (g === "all") return "all";
    if (!(g instanceof Set) && !Array.isArray(g)) return null;
    const out = new Set<string>();
    for (const b of g as Iterable<unknown>) {
      if (typeof b !== "string") return null;
      out.add(b);
    }
    return out;
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
    if (frame) {
      // Another tenant's call is never joined: it runs in its own transaction, as if no ambient
      // mutation were open, so neither tenant sees the other's uncommitted rows (PR-UDF-062).
      if (ctx.tenantId !== frame.scope.ctx.tenantId)
        return this.ambientFrame.exit(() => this.mutate(ctx, fn, opts));
      return this.joined(frame, () => this.joinedCall(frame, ctx, role, fn, opts));
    }
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
   * check: when it throws, only its writes roll back and the error reaches its caller; the settings
   * of the call it was made from are restored after it, on every path. A joined call must be the
   * ambient one's tenant and scope and run as the app role; a call by another principal of the same
   * tenant joins with its own `app.*` settings and ledger entries, unless it or the ambient call
   * carries a break-glass grant or support access (refused), and the same principal keeps its own
   * grant (PR-UDF-062; R1-D-237). Another tenant's call never joins: it runs in its own
   * transaction. Joined calls run one at a time: a call made while another runs waits its turn in
   * order (FIFO), and a call made from inside a running joined call runs at once. Reads join only
   * with `opts.joinReads` (PR-UDF-037; R1-D-188); otherwise `read` keeps its own read-only
   * transaction.
   */
  async ambient<T>(
    ctx: KernelContext,
    fn: (tx: Tx) => Promise<T>,
    opts: AmbientOptions = {},
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
        const pgTx = tx as PgTx;
        const scope: AmbientScope = {
          tx: pgTx,
          ctx,
          opts,
          stack: [{ token, ctx, opts }],
          wake: wakeSignal(),
          inflight: new Set(),
          ended: false,
          joinReads: opts.joinReads === true,
        };
        // A statement on this transaction runs in its caller's turn: the call whose code made it,
        // or the ambient call's own when made outside every call (PR-UDF-062; R1-D-237).
        pgTx.turn = () => {
          const f = this.ambientFrame.getStore();
          return turnOf(scope, f?.scope === scope ? f.token : token);
        };
        let value: T | undefined;
        let failure: { error: unknown } | undefined;
        try {
          value = await this.ambientFrame.run({ scope, token }, () => fn(tx));
        } catch (error) {
          failure = { error };
        }
        // A joined call still running when the callback ended (one not awaited, or a sibling of a
        // refused one) finishes inside this transaction before it ends, and the transaction then
        // fails: it never commits half a call, and the call never reaches the next transaction on
        // this connection (R1-D-92).
        const running = [...scope.inflight];
        while (scope.inflight.size) await Promise.allSettled([...scope.inflight]);
        scope.ended = true;
        if (failure) throw failure.error;
        // A joined call whose settings could not be restored fails the transaction, even when its
        // caller caught the error (PR-UDF-062).
        if (scope.broken) throw new KernelGuardError(BROKEN);
        if (running.length)
          throw new KernelGuardError(
            "a mutation joined to the ambient one was still running when it ended",
          );
        return value as T;
      },
      opts,
    );
  }

  private async joined<T>(frame: AmbientFrame, call: () => Promise<T>): Promise<T> {
    const { scope } = frame;
    if (scope.ended)
      throw new KernelGuardError("the ambient mutation has ended: a joined call cannot start");
    const p = call();
    scope.inflight.add(p);
    void p.then(
      () => scope.inflight.delete(p),
      () => scope.inflight.delete(p),
    );
    return p;
  }

  private async joinedCall<T>(
    frame: AmbientFrame,
    ctx: KernelContext,
    role: string,
    fn: (tx: Tx) => Promise<T>,
    opts: MutateOptions,
  ): Promise<T> {
    const { scope } = frame;
    if (!this.mayJoin(scope, ctx) || role !== this.role)
      throw new KernelGuardError(
        "a joined mutation must have the ambient mutation's tenant and scope and run as the app role; the same principal keeps its break-glass grant, and another principal joins only when neither carries a break-glass grant or support access",
      );
    // Its turn (PR-UDF-062): at once when made from the innermost open call (a nested call), else
    // after the calls queued before it. The last check and the push are in one tick.
    for (let w = turnOf(scope, frame.token); w; w = turnOf(scope, frame.token)) await w;
    const parent = scope.stack.at(-1) as OpenCall;
    const token = Symbol("joined");
    const call: OpenCall = { token, ctx, opts };
    scope.stack.push(call);
    const own = () => turnOf(scope, token, true);
    let out: UnitOutcome<T>;
    let child: JoinedTx | undefined;
    try {
      out = await scope.tx.unitIn(async () => {
        await scope.tx.applyContext(ctx, opts);
        // Same tenant as the ambient transaction: its sandbox flag, not the caller's (R1-D-87).
        child = new JoinedTx(scope.tx, withKernelSandbox(ctx, scope.tx.ctx.sandbox));
        const c = child;
        let r: T;
        try {
          r = await this.ambientFrame.run({ scope, token }, () => fn(c));
        } finally {
          call.closing = true;
        }
        if (!c.audited)
          throw new IpbError("IPB-MOD-003", {
            detail: `mutation${opts.action ? ` ${opts.action}` : ""} wrote no audit ledger entry`,
          });
        return r;
      }, own);
    } finally {
      call.closing = true;
      child?.end();
      try {
        // A released savepoint keeps the joined call's settings (and a failed unit may not have
        // undone them): put back those of the call it was made from, on every path, before any
        // other call may use the connection (PR-UDF-062; R1-D-237). If that fails, nothing more
        // runs in this ambient mutation and it fails.
        if (!scope.broken) {
          for (let w = own(); w; w = own()) await w;
          await scope.tx.applyContext(parent.ctx, parent.opts);
        }
      } catch (error) {
        scope.broken ??= { error };
      } finally {
        const i = scope.stack.indexOf(call);
        if (i >= 0) scope.stack.splice(i, 1);
        wakeAll(scope);
      }
    }
    if (scope.broken) throw new KernelGuardError(BROKEN);
    if (!out.ok) throw out.error;
    return out.value;
  }

  /**
   * Whether a call for `ctx` may run on `scope`'s connection: the ambient call's tenant and scope,
   * and either the same principal with the same break-glass grant (R1-D-48), or another principal
   * when neither it nor the ambient call carries a break-glass grant or support access and it is
   * not an external principal or a service reader, whose own transactions run gates a joined call
   * would skip (PR-UDF-062; R1-D-237).
   */
  private mayJoin(scope: AmbientScope, ctx: KernelContext): boolean {
    const a = scope.ctx;
    if (ctx.tenantId !== a.tenantId || (ctx.scope ?? "tenant") !== (a.scope ?? "tenant"))
      return false;
    if (ctx.principal.id === a.principal.id)
      return (ctx.breakGlassGrantId ?? "") === (a.breakGlassGrantId ?? "");
    return (
      !ctx.breakGlassGrantId &&
      !a.breakGlassGrantId &&
      !isSupportContext(ctx) &&
      !isSupportContext(a) &&
      !isExternal(ctx) &&
      !serviceReaderRole(ctx)
    );
  }

  /** Whether a read made inside `scope` joins it (PR-UDF-037, R1-D-188; PR-UDF-062, R1-D-237). */
  private joinsRead(scope: AmbientScope, ctx: KernelContext, opts: ReadOptions): boolean {
    if (!scope.joinReads || opts.snapshot) return false;
    if (isSupportContext(ctx) || isExternal(ctx) || serviceReaderRole(ctx)) return false;
    return this.mayJoin(scope, ctx);
  }

  /**
   * A read joined to the ambient mutation (PR-UDF-037; R1-D-188), or with `scoped` a scoped branch
   * read in it (R1-D-273), whose callback's statements alone run while it is open.
   */
  private async joinedRead<T>(
    frame: AmbientFrame,
    ctx: KernelContext,
    fn: (tx: Tx) => Promise<T>,
    scoped = false,
  ): Promise<T> {
    const { scope } = frame;
    // Its turn, as a joined mutation's (PR-UDF-062).
    for (let w = turnOf(scope, frame.token); w; w = turnOf(scope, frame.token)) await w;
    const token = Symbol(scoped ? "scoped-read" : "joined-read");
    const call: OpenCall = { token, ctx, opts: {} };
    scope.stack.push(call);
    let child: JoinedReadTx | ScopedBranchReadTx | undefined;
    let out: UnitOutcome<T>;
    try {
      out = await scope.tx.readUnit(
        this.readRole,
        ctx,
        async () => {
          // Same tenant as the ambient transaction: its sandbox flag, not the caller's (R1-D-87).
          const kctx = withKernelSandbox(ctx, scope.tx.ctx.sandbox);
          child = scoped
            ? new ScopedBranchReadTx(scope.tx, kctx)
            : new JoinedReadTx(scope.tx, kctx);
          const c = child;
          try {
            return await this.ambientFrame.run({ scope, token }, () => fn(c));
          } finally {
            call.closing = true;
          }
        },
        () => turnOf(scope, token, true),
        scoped,
      );
    } catch (error) {
      // The savepoint's rollback, which undoes the read's role, read-only flag and settings,
      // failed: nothing more runs in this ambient mutation (PR-UDF-062). A kernel guard refused
      // the read before its savepoint opened and changed nothing.
      if (!(error instanceof KernelGuardError)) scope.broken ??= { error };
      throw error;
    } finally {
      call.closing = true;
      child?.end();
      const i = scope.stack.indexOf(call);
      if (i >= 0) scope.stack.splice(i, 1);
      wakeAll(scope);
    }
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
    const frame = this.ambientFrame.getStore();
    if (frame) {
      if (this.joinsRead(frame.scope, ctx, opts))
        return this.joined(frame, () => this.joinedRead(frame, ctx, fn));
      // Another tenant's read runs as if no ambient mutation were open (PR-UDF-062), so a call
      // made inside it does not join this tenant's transaction either.
      if (ctx.tenantId !== frame.scope.ctx.tenantId)
        return this.ambientFrame.exit(() => this.read(ctx, fn, opts));
    }
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
   * context, in a tenant that refused or revoked it (or, with `requireTenantApprovedBreakGlass`,
   * has no live approval of it; R1-D-284) or for a write under `read` is refused (IPB-SEC-005) and
   * ledgered there, and not recorded as a use. An inactive grant records nothing; the transaction
   * then refuses it (IPB-SEC-009).
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
        else refusal = await this.tenantApprovalRefusal(client, scope);
        if (!refusal && write && row.scope_access === "read") refusal = { scope, reason: "write" };
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

  /**
   * The tenant's decision on a scoped break-glass grant used in it (PR-FBX-55; R1-D-284;
   * tenancy/0031), read on `client` in the context's tenant: a refusal or revocation is always
   * enforced; with `requireTenantApprovedBreakGlass`, anything but a live approval is refused.
   */
  private async tenantApprovalRefusal(
    client: pg.PoolClient,
    scope: GrantScope,
  ): Promise<ScopeRefusal | undefined> {
    const r = await client.query<{ state: string | null }>(
      "select tenancy.breakglass_tenant_approval_state($1) as state",
      [scope.grantId],
    );
    const state = r.rows[0]?.state ?? "none";
    if (
      state === "refused" ||
      state === "revoked" ||
      (this.requireTenantApprovedBreakGlass && state !== "approved")
    )
      return { scope, reason: TENANT_APPROVAL_REFUSAL, tenantApproval: state };
    return undefined;
  }

  /** Ledger a scope refusal in the context's tenant, in its own transaction (R1-D-75, R1-D-76). */
  private async ledgerRefusal(ctx: KernelContext, r: ScopeRefusal, action?: string): Promise<void> {
    if (!this.audit) throw new KernelGuardError("a scoped grant needs the kernel's audit sink");
    const support = r.scope.kind === "support";
    await this.ledgerOwn(ctx, {
      action: support ? SUPPORT_SCOPE_REFUSED_ACTION : BREAKGLASS_SCOPE_REFUSED_ACTION,
      resourceType: support ? "support_grant" : "breakglass_grant",
      resourceId: r.scope.grantId,
      after: {
        reason: r.reason,
        tenant_id: ctx.tenantId,
        scope: { tenant_id: r.scope.tenantId, modules: r.scope.modules, access: r.scope.access },
        ...(r.module ? { module: r.module } : {}),
        ...(r.tenantApproval ? { tenant_approval: r.tenantApproval } : {}),
        ...(action ? { action } : {}),
      },
    });
  }

  /** Ledger a kernel entry in the context's tenant, in its own transaction. */
  private async ledgerOwn(ctx: KernelContext, entry: AuditEntryInput): Promise<void> {
    const audit = this.audit;
    if (!audit) throw new KernelGuardError("the kernel has no audit sink");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${quoteIdent(this.role)}`);
      await applySettings(client, ctx, { action: entry.action });
      const ltx = new PgTx(client, withKernelSandbox(ctx, undefined));
      await audit.record(ltx, entry);
      ltx.end();
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
    let tx: PgTx | undefined;
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
        // Read again in this transaction, so a refusal or revocation that lands after the
        // preflight still stops it (R1-D-284).
        if (scope?.kind === "breakglass" && scope.tenantId !== null) {
          const t = await this.tenantApprovalRefusal(client, scope);
          if (t) throw scopeRefusal(t, m.action);
        }
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
      // (R1-D-90). A tenant without a `tenancy.tenant` row was never flagged, so it is not a
      // sandbox (a production platform tenant may have no row: its mail must still go out). The
      // service readers' and the outbox relay's own roles are not granted the lookup and never
      // send or call a model: their transactions carry no flag, which the ports treat as a
      // sandbox (fail closed).
      let sandbox: boolean | null = null;
      if (role === this.role || role === this.readRole || role === EXTERNAL_DB_ROLE) {
        const sb = await client.query<{ sandbox: boolean | null }>(
          "select tenancy.tenant_sandbox() as sandbox",
        );
        sandbox = sb.rows[0]?.sandbox ?? false;
      }
      tx = new PgTx(client, withKernelSandbox(ctx, sandbox), readOnly !== false, guard);
      if (readOnly === false) this.mutationTxs.add(tx);
      if (live) bindSupportGrant(tx, live);
      const result = await fn(tx);
      tx.end();
      await client.query("commit");
      return result;
    } catch (e) {
      tx?.end();
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
      // Refused scoped branch reads (R1-D-273), each in the tenant of the call that made it.
      for (const r of tx?.branchScopeRefusals.splice(0) ?? []) await this.ledgerOwn(r.ctx, r.entry);
    }
  }
}

function quoteIdent(s: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`invalid role name ${s}`);
  return `"${s}"`;
}
