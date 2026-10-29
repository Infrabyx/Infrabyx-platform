// Transaction kernel (PL1 plan §3.2): every mutation runs in one transaction with the verified
// context applied through SET LOCAL (IPB-01 §01.4.6, IPB-02-13), and the commit fails unless the
// audit ledger was written in that transaction (IPB-02-51, IPB-MOD-003).
import type pg from "pg";
import {
  AGENT_FORBIDDEN_VERBS,
  OUTBOX_DISPATCH_ACTION,
  SERVICE_READER_ROLES,
} from "@infrabyx/contracts/roles";
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  KernelContext,
  MutateOptions,
  MutationKernel,
  QueryResult,
  ReadOptions,
  Tx,
} from "@infrabyx/contracts/kernel";
import { assertValidContext, isAgentPrincipal, serviceReaderRole } from "./context.js";
import { KernelGuardError } from "./errors.js";

/** Minimal pool surface (pg.Pool satisfies it). */
export interface PoolLike {
  connect(): Promise<pg.PoolClient>;
}

export interface PgKernelOptions {
  pool: PoolLike;
  /** Role assumed with SET LOCAL ROLE for every transaction; RLS-subject (IPB-01 §01.4.6). */
  role?: string;
  readRole?: string;
}

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

class PgTx implements Tx {
  private _audited = false;
  constructor(
    private readonly client: pg.PoolClient,
    readonly ctx: KernelContext,
  ) {}
  async query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    assertAllowedStatement(text);
    const r = await this.client.query(text, params as unknown[] | undefined);
    return { rows: r.rows as R[], rowCount: r.rowCount };
  }
  markAudited(): void {
    this._audited = true;
  }
  get audited(): boolean {
    return this._audited;
  }
}

/** The only action a service reader may commit: the ledger entry for its cross-tenant read. */
export const SERVICE_READ_ACTION = "platform.service_read";

/** Mutation guard (IPB-02-09, IPB-02-10): no writes while impersonating; agents never approve, sign, disburse, delete or grant. */
export function assertMayMutate(ctx: KernelContext, opts: MutateOptions = {}): void {
  if (ctx.act) {
    throw new IpbError("IPB-SEC-003", { detail: "impersonation sessions are read-only" });
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

  constructor(opts: PgKernelOptions) {
    this.pool = opts.pool;
    this.role = opts.role ?? "app_rw";
    this.readRole = opts.readRole ?? this.role;
  }

  async mutate<T>(
    ctx: KernelContext,
    fn: (tx: Tx) => Promise<T>,
    opts: MutateOptions = {},
  ): Promise<T> {
    assertValidContext(ctx);
    assertMayMutate(ctx, opts);
    // The outbox relay's dispatch runs as its own database role, granted only the registered
    // outbox tables and the ledger append (R1-D-01); every other mutation runs as the app role.
    const role =
      serviceReaderRole(ctx) === "SVC_OUTBOX_RELAY"
        ? SERVICE_READER_ROLES.SVC_OUTBOX_RELAY.dbRole
        : this.role;
    if (opts.reason !== undefined && (opts.reason.length < 1 || opts.reason.length > 500))
      throw new RangeError("a mutation's reason has 1 to 500 characters");
    return this.run(ctx, role, false, opts, async (tx) => {
      const r = await fn(tx);
      if (!tx.audited) {
        throw new IpbError("IPB-MOD-003", {
          detail: `mutation${opts.action ? ` ${opts.action}` : ""} wrote no audit ledger entry`,
        });
      }
      return r;
    });
  }

  async read<T>(
    ctx: KernelContext,
    fn: (tx: Tx) => Promise<T>,
    opts: ReadOptions = {},
  ): Promise<T> {
    assertValidContext(ctx);
    // A service reader in platform scope runs as its own database role, which is granted only the
    // columns it needs (PL3-D-21); RLS still applies.
    const reader = ctx.scope === "platform" ? serviceReaderRole(ctx) : undefined;
    return this.run(
      ctx,
      reader ? SERVICE_READER_ROLES[reader].dbRole : this.readRole,
      opts.snapshot ? "snapshot" : true,
      {},
      fn,
    );
  }

  private async run<T>(
    ctx: KernelContext,
    role: string,
    readOnly: boolean | "snapshot",
    m: MutateOptions,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(
        readOnly === "snapshot"
          ? "begin isolation level repeatable read read only"
          : readOnly
            ? "begin read only"
            : "begin",
      );
      await client.query(`set local role ${quoteIdent(role)}`);
      await client.query(
        `select set_config('app.tenant_id', $1, true), set_config('app.entity_id', $2, true),
                set_config('app.actor_id', $3, true), set_config('app.trace_id', $4, true),
                set_config('app.scope', $5, true), set_config('app.breakglass', $6, true),
                set_config('app.action', $7, true), set_config('app.reason', $8, true),
                set_config('app.branch_id', $9, true), set_config('app.branch_ids', $10, true),
                set_config('app.branch_scope', $11, true)`,
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
        ],
      );
      if (ctx.breakGlassGrantId) {
        const r = await client.query<{ ok: boolean }>(
          "select tenancy.breakglass_active($1, $2) as ok",
          [ctx.breakGlassGrantId, ctx.principal.id],
        );
        if (!r.rows[0]?.ok)
          throw new IpbError("IPB-SEC-009", { detail: "break-glass grant is not active" });
      }
      const result = await fn(new PgTx(client, ctx));
      await client.query("commit");
      return result;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

function quoteIdent(s: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`invalid role name ${s}`);
  return `"${s}"`;
}
