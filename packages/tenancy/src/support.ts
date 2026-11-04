// Tenant-consented support access (LawDocsComply PR-LDC-08 (a), (b) and PR-LDC-20; owner answer
// #104; R1-D-76; tenancy/0017). A separate grant, not break-glass (IPB-02-06 stays as it is): a
// PLT_SUPPORT principal asks one tenant for access to a list of modules; the tenant's ORG_OWNER or
// ORG_ADMIN consents first; read-only by default, read-write only once a second, different
// ORG_OWNER or ORG_ADMIN approves; at most 24 hours from activation; the tenant may refuse or revoke
// it at once. The kernel enforces it: a PLT_SUPPORT principal without a live grant in the tenant
// sees nothing; it reads only through `SupportReads`, which ledgers every read and shows it to the
// tenant (`SupportAccess.reads`); it writes only under a read-write grant; and every statement names
// only the grant's modules (the module guard of R1-D-75). A product maps its own support role onto
// `PLT_SUPPORT` (`supportContext`); the kernel accepts no product-defined platform role (R1-D-74).
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { SUPPORT_ROLE } from "@infrabyx/contracts/roles";
import { internalEvent } from "@infrabyx/config/events";
import { newId, type SecretKey } from "@infrabyx/crypto";
import { assertValidContext, isAgentPrincipal, isSupportContext } from "./context.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { scopeModules } from "./scope-guard.js";
import { supportGate, supportGrantOf } from "./support-gate.js";

export const SUPPORT_ACCESS_MAX_HOURS = 24;
export const SUPPORT_ACCESS_DEFAULT_HOURS = 4;
/** The ledger action of each read a support principal makes (R1-D-76). */
export const SUPPORT_READ_ACTION = "platform.support_read";
/** Modules a read-write grant may never list: the tenant's access records and its ledger. */
export const SUPPORT_READ_ONLY_MODULES = ["tenancy", "audit"] as const;

const MANAGER_ROLES = ["ORG_OWNER", "ORG_ADMIN"];
const TABLE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const TICKET = /^[A-Za-z0-9_.:/#-]{1,120}$/;

export type SupportAccessMode = "read" | "read_write";

export interface SupportAccessRequest {
  /** Why support needs the access (10 to 500 characters); shown to the tenant. */
  reason: string;
  /** The modules (PostgreSQL schemas) it covers, 1 to 50. */
  modules: readonly string[];
  /** Default `read`; `read_write` needs a second tenant approval. */
  access?: SupportAccessMode;
  /** Hours from activation (default 4, at most 24). */
  hours?: number;
  /** The support ticket, if any. */
  ticketRef?: string;
}

export interface SupportGrant {
  id: string;
  tenantId: string;
  requesterId: string;
  reason: string;
  ticketRef: string | null;
  modules: string[];
  access: SupportAccessMode;
  durationHours: number;
  state: "awaiting_tenant_consent" | "awaiting_second_approval" | "active" | "refused" | "revoked";
  requestedAt: Date;
  consentedBy: string | null;
  consentedAt: Date | null;
  secondApproverId: string | null;
  secondApprovedAt: Date | null;
  activatedAt: Date | null;
  expiresAt: Date | null;
  endedBy: string | null;
  endedAt: Date | null;
}

/** One read made under a grant, as the tenant sees it. */
export interface SupportRead {
  id: string;
  grantId: string;
  principalId: string;
  table: string;
  rows: number;
  readAt: Date;
}

interface Row {
  id: string;
  tenant_id: string;
  requester_id: string;
  reason: string;
  ticket_ref: string | null;
  modules: string[];
  access: SupportAccessMode;
  duration_hours: number;
  state: SupportGrant["state"];
  requested_at: Date;
  consented_by: string | null;
  consented_at: Date | null;
  second_approver_id: string | null;
  second_approved_at: Date | null;
  activated_at: Date | null;
  expires_at: Date | null;
  ended_by: string | null;
  ended_at: Date | null;
}
const toGrant = (r: Row): SupportGrant => ({
  id: r.id,
  tenantId: r.tenant_id,
  requesterId: r.requester_id,
  reason: r.reason,
  ticketRef: r.ticket_ref,
  modules: r.modules,
  access: r.access,
  durationHours: r.duration_hours,
  state: r.state,
  requestedAt: r.requested_at,
  consentedBy: r.consented_by,
  consentedAt: r.consented_at,
  secondApproverId: r.second_approver_id,
  secondApprovedAt: r.second_approved_at,
  activatedAt: r.activated_at,
  expiresAt: r.expires_at,
  endedBy: r.ended_by,
  endedAt: r.ended_at,
});

interface ReadRow {
  id: string;
  grant_id: string;
  principal_id: string;
  table_name: string;
  row_count: number;
  read_at: Date;
}
const toRead = (r: ReadRow): SupportRead => ({
  id: r.id,
  grantId: r.grant_id,
  principalId: r.principal_id,
  table: r.table_name,
  rows: r.row_count,
  readAt: r.read_at,
});

/** The tenant's own people: a named, non-agent ORG_OWNER or ORG_ADMIN in a tenant context. */
function assertManager(ctx: KernelContext): void {
  if (ctx.scope === "platform" || ctx.principal.type !== "user" || isSupportContext(ctx))
    throw new IpbError("IPB-SEC-005", {
      detail: "support access is consented to in the tenant by its named users",
    });
  if (isAgentPrincipal(ctx))
    throw new IpbError("IPB-SEC-004", { detail: "agents may not consent to support access" });
  if (!ctx.principal.roles.some((r) => MANAGER_ROLES.includes(r)))
    throw new IpbError("IPB-UX-011", { detail: `needs one of ${MANAGER_ROLES.join(", ")}` });
}

function assertSupport(ctx: KernelContext): void {
  if (!isSupportContext(ctx))
    throw new IpbError("IPB-UX-011", { detail: `support access is requested by ${SUPPORT_ROLE}` });
  assertValidContext(ctx);
}

/**
 * The context of a support principal in one tenant: the product maps its own support role onto
 * `PLT_SUPPORT` here, and the principal holds nothing else (R1-D-76).
 */
export function supportContext(
  tenantId: string,
  principalId: string,
  extras: Pick<KernelContext, "traceId" | "ip" | "userAgent"> = {},
): KernelContext {
  const ctx: KernelContext = {
    tenantId,
    principal: { id: principalId, type: "user", roles: [SUPPORT_ROLE] },
    ...(extras.traceId ? { traceId: extras.traceId } : {}),
    ...(extras.ip ? { ip: extras.ip } : {}),
    ...(extras.userAgent ? { userAgent: extras.userAgent } : {}),
  };
  assertValidContext(ctx);
  return ctx;
}

export interface SupportAccessOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  outbox?: OutboxWriter;
  pseudonymKey?: SecretKey;
  /** A lower ceiling for a grant's hours; never above 24. */
  maxHours?: number;
}

type GrantEvent = "SupportAccessRequested" | "SupportAccessGranted" | "SupportAccessRevoked";

export class SupportAccess {
  constructor(private readonly o: SupportAccessOptions) {}

  /** A PLT_SUPPORT principal asks the context tenant; nothing is visible until it consents. */
  async request(ctx: KernelContext, req: SupportAccessRequest): Promise<SupportGrant> {
    assertSupport(ctx);
    const max = Math.min(this.o.maxHours ?? SUPPORT_ACCESS_MAX_HOURS, SUPPORT_ACCESS_MAX_HOURS);
    const hours = req.hours ?? Math.min(SUPPORT_ACCESS_DEFAULT_HOURS, max);
    if (!(Number.isInteger(hours) && hours >= 1 && hours <= max))
      throw new RangeError(`support access lasts 1–${max} hours`);
    const access = req.access ?? "read";
    if (access !== "read" && access !== "read_write")
      throw new RangeError("support access is read or read_write");
    const modules = scopeModules(req.modules);
    if (
      access === "read_write" &&
      modules.some((m) => (SUPPORT_READ_ONLY_MODULES as readonly string[]).includes(m))
    )
      throw new RangeError(
        `a read-write grant may not list ${SUPPORT_READ_ONLY_MODULES.join(" or ")}`,
      );
    if (!(req.reason.length >= 10 && req.reason.length <= 500))
      throw new RangeError("a support access reason has 10 to 500 characters");
    if (req.ticketRef !== undefined && !TICKET.test(req.ticketRef))
      throw new RangeError("invalid ticket reference");
    const action = "security.support_access.request";
    return this.o.kernel.mutate(
      ctx,
      supportGate(async (tx: Tx) => {
        const open = await tx.query(
          `select 1 from tenancy.support_grant
            where tenant_id = $1 and requester_id = $2
              and (state in ('awaiting_tenant_consent', 'awaiting_second_approval')
                   or (state = 'active' and expires_at > now()))`,
          [ctx.tenantId, ctx.principal.id],
        );
        if (open.rows[0])
          throw new ConflictError("a support access request or grant is already open here");
        const id = newId("sgr");
        const r = await tx.query<Row>(
          `insert into tenancy.support_grant
             (id, tenant_id, requester_id, reason, ticket_ref, modules, access, duration_hours)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
          [
            id,
            ctx.tenantId,
            ctx.principal.id,
            req.reason,
            req.ticketRef ?? null,
            modules,
            access,
            hours,
          ],
        );
        const g = toGrant(r.rows[0] as Row);
        await this.o.audit.record(tx, {
          action,
          resourceType: "support_grant",
          resourceId: id,
          after: { modules, access, hours, ticket_ref: g.ticketRef },
        });
        await this.emit(tx, "SupportAccessRequested", {
          grant_id: id,
          requester_id: g.requesterId,
          modules,
          access,
          hours,
          ticket_ref: g.ticketRef,
        });
        return g;
      }, "manage"),
      { action },
    );
  }

  /**
   * The tenant's first consent (ORG_OWNER or ORG_ADMIN). A read grant is then active for its
   * hours; a read-write grant waits for a second, different approver (`approve`).
   */
  async consent(ctx: KernelContext, id: string): Promise<SupportGrant> {
    assertManager(ctx);
    const action = "security.support_access.consent";
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id);
        if (row.state !== "awaiting_tenant_consent")
          throw new ConflictError(`support access ${id} is ${row.state}`);
        const r =
          row.access === "read"
            ? await tx.query<Row>(
                `update tenancy.support_grant
                    set state = 'active', consented_by = $2, consented_at = now(), activated_at = now(),
                        expires_at = now() + make_interval(hours => duration_hours)
                  where id = $1 returning *`,
                [id, ctx.principal.id],
              )
            : await tx.query<Row>(
                `update tenancy.support_grant
                    set state = 'awaiting_second_approval', consented_by = $2, consented_at = now()
                  where id = $1 returning *`,
                [id, ctx.principal.id],
              );
        const g = toGrant(r.rows[0] as Row);
        await this.o.audit.record(tx, {
          action,
          resourceType: "support_grant",
          resourceId: id,
          before: { state: row.state },
          after: { state: g.state, expires_at: g.expiresAt?.toISOString() ?? null },
        });
        if (g.state === "active") await this.granted(tx, g);
        return g;
      },
      { action },
    );
  }

  /** The second, different tenant approval a read-write grant needs (maker ≠ checker). */
  async approve(ctx: KernelContext, id: string): Promise<SupportGrant> {
    assertManager(ctx);
    const action = "security.support_access.approve";
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id);
        if (row.state !== "awaiting_second_approval")
          throw new ConflictError(`support access ${id} is ${row.state}`);
        if (row.consented_by === ctx.principal.id || row.requester_id === ctx.principal.id)
          throw new IpbError("IPB-TRUST-005", { meta: { grant_id: id } });
        const r = await tx.query<Row>(
          `update tenancy.support_grant
              set state = 'active', second_approver_id = $2, second_approved_at = now(),
                  activated_at = now(), expires_at = now() + make_interval(hours => duration_hours)
            where id = $1 returning *`,
          [id, ctx.principal.id],
        );
        const g = toGrant(r.rows[0] as Row);
        await this.o.audit.record(tx, {
          action,
          resourceType: "support_grant",
          resourceId: id,
          after: { state: g.state, expires_at: g.expiresAt?.toISOString() ?? null },
        });
        await this.granted(tx, g);
        return g;
      },
      { action },
    );
  }

  /** The tenant declines a request still waiting for consent or for the second approval. */
  async refuse(ctx: KernelContext, id: string): Promise<SupportGrant> {
    return this.end(ctx, id, "refused");
  }

  /** Revocation is immediate: the support principal's next transaction sees nothing. */
  async revoke(ctx: KernelContext, id: string): Promise<SupportGrant> {
    return this.end(ctx, id, "revoked");
  }

  /** The tenant's ORG_OWNER or ORG_ADMIN sees every grant; a support principal sees its own. */
  async list(ctx: KernelContext): Promise<SupportGrant[]> {
    if (isSupportContext(ctx))
      return this.o.kernel.read(
        ctx,
        supportGate(
          async (tx: Tx) =>
            (
              await tx.query<Row>(
                "select * from tenancy.support_grant where requester_id = $1 order by requested_at desc",
                [ctx.principal.id],
              )
            ).rows.map(toGrant),
          "manage",
        ),
      );
    assertManager(ctx);
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<Row>("select * from tenancy.support_grant order by requested_at desc, id")
      ).rows.map(toGrant),
    );
  }

  /** Every read made under support access in the tenant, newest first (the tenant's admins). */
  async reads(
    ctx: KernelContext,
    opts: { grantId?: string; limit?: number } = {},
  ): Promise<SupportRead[]> {
    assertManager(ctx);
    const limit = opts.limit ?? 500;
    if (!(Number.isInteger(limit) && limit >= 1 && limit <= 5000))
      throw new RangeError("limit is 1 to 5000");
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<ReadRow>(
          `select * from tenancy.support_read where ($1::text is null or grant_id = $1)
            order by read_at desc, id desc limit $2`,
          [opts.grantId ?? null, limit],
        )
      ).rows.map(toRead),
    );
  }

  private async end(
    ctx: KernelContext,
    id: string,
    to: "refused" | "revoked",
  ): Promise<SupportGrant> {
    assertManager(ctx);
    const action = `security.support_access.${to === "refused" ? "refuse" : "revoke"}`;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id);
        const open = ["awaiting_tenant_consent", "awaiting_second_approval"].includes(row.state);
        if (to === "refused" ? !open : !(open || row.state === "active"))
          throw new ConflictError(`support access ${id} is ${row.state}`);
        const r = await tx.query<Row>(
          `update tenancy.support_grant set state = $2, ended_by = $3, ended_at = now()
            where id = $1 returning *`,
          [id, to, ctx.principal.id],
        );
        const g = toGrant(r.rows[0] as Row);
        await this.o.audit.record(tx, {
          action,
          resourceType: "support_grant",
          resourceId: id,
          before: { state: row.state },
          after: { state: to },
        });
        await this.emit(tx, "SupportAccessRevoked", {
          grant_id: id,
          requester_id: g.requesterId,
          state: to,
          ended_by: ctx.principal.id,
        });
        return g;
      },
      { action },
    );
  }

  private granted(tx: Tx, g: SupportGrant): Promise<void> {
    return this.emit(tx, "SupportAccessGranted", {
      grant_id: g.id,
      requester_id: g.requesterId,
      modules: g.modules,
      access: g.access,
      consented_by: g.consentedBy,
      second_approver_id: g.secondApproverId,
      expires_at: g.expiresAt?.toISOString() ?? null,
    });
  }

  private async load(tx: Tx, id: string): Promise<Row> {
    const r = await tx.query<Row>("select * from tenancy.support_grant where id = $1 for update", [
      id,
    ]);
    if (!r.rows[0]) throw new NotFoundError("support access grant");
    return r.rows[0];
  }

  private async emit(tx: Tx, event: GrantEvent, data: Record<string, unknown>): Promise<void> {
    if (!this.o.outbox) return;
    const envelope = internalEvent({
      product: this.o.product,
      event,
      tenantId: tx.ctx.tenantId,
      data,
      actorId: tx.ctx.principal.id,
      ...(this.o.pseudonymKey ? { pseudonymKey: this.o.pseudonymKey } : {}),
    });
    await this.o.outbox.publish(tx, "tenancy", { envelope });
  }
}

export interface SupportReadsOptions {
  kernel: MutationKernel;
  audit: AuditSink;
}

/**
 * The one way a support principal reads. Each call runs one query under the principal's live grant
 * in the tenant (its modules only), then ledgers it (`platform.support_read`, resource
 * `<grant>/<table>`, with the row count) and records it for the tenant (`SupportAccess.reads`); the
 * rows are returned only once both are written.
 */
export class SupportReads {
  constructor(private readonly o: SupportReadsOptions) {}

  async read<R extends Record<string, unknown>>(
    ctx: KernelContext,
    table: string,
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<R[]> {
    if (!isSupportContext(ctx))
      throw new IpbError("IPB-SEC-005", { detail: "SupportReads is for support principals" });
    if (!TABLE.test(table)) throw new RangeError(`invalid table ${table}`);
    if (!new RegExp(`\\bfrom\\s+${table.replace(".", "\\.")}\\b`, "i").test(sql))
      throw new Error(`the query does not read ${table}`);
    let grantId = "";
    const rows = await this.o.kernel.read(
      ctx,
      supportGate(async (tx: Tx) => {
        grantId = (supportGrantOf(tx) as { id: string }).id;
        return (await tx.query<R>(sql, params)).rows;
      }, "read"),
    );
    await this.o.kernel.mutate(
      ctx,
      supportGate(async (tx: Tx) => {
        await this.o.audit.record(tx, {
          action: SUPPORT_READ_ACTION,
          resourceType: "support_read",
          resourceId: `${grantId}/${table}`,
          after: { grant_id: grantId, table, rows: rows.length },
        });
        await tx.query("select tenancy.support_read_record($1, $2, $3, $4)", [
          newId("srd"),
          grantId,
          table,
          rows.length,
        ]);
      }, "record"),
      { action: SUPPORT_READ_ACTION },
    );
    return rows;
  }
}
