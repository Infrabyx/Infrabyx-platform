// Break-glass (IPB-02-06, §02.4.2): a PLT_SUPER_ADMIN emergency grant approved by a second
// PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER, ≤ 4 h, with a reason, an alert event and a mandatory
// post-use review ticket. Its own table rather than an approval request: R4's 60-minute delay
// would defeat an emergency grant (PL1-D-13).
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { internalEvent } from "@infrabyx/config/events";
import { newId, type SecretKey } from "@infrabyx/crypto";
import { PLATFORM_TENANT_ID } from "./context.js";
import { ConflictError, NotFoundError } from "./errors.js";

export const BREAKGLASS_MAX_MINUTES = 240;
const REQUESTER_ROLE = "PLT_SUPER_ADMIN";
const APPROVER_ROLES = ["PLT_SUPER_ADMIN", "PLT_SECURITY_OFFICER"];

export interface BreakGlassGrant {
  id: string;
  requesterId: string;
  approverId: string | null;
  state: "requested" | "active" | "revoked";
  durationMinutes: number;
  expiresAt: Date | null;
  reviewTicketRef: string | null;
}

export interface BreakGlassOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  outbox?: OutboxWriter;
  pseudonymKey?: SecretKey;
  /** Ceiling from the settings registry (trust.breakglass.max_minutes); never above 240. */
  maxMinutes?: number;
}

interface Row {
  id: string;
  requester_id: string;
  approver_id: string | null;
  state: BreakGlassGrant["state"];
  duration_minutes: number;
  expires_at: Date | null;
  review_ticket_ref: string | null;
}
const toGrant = (r: Row): BreakGlassGrant => ({
  id: r.id,
  requesterId: r.requester_id,
  approverId: r.approver_id,
  state: r.state,
  durationMinutes: r.duration_minutes,
  expiresAt: r.expires_at,
  reviewTicketRef: r.review_ticket_ref,
});

function assertPlatform(ctx: KernelContext, roles: readonly string[]): void {
  if (
    ctx.scope !== "platform" ||
    ctx.tenantId !== PLATFORM_TENANT_ID ||
    ctx.principal.type !== "user"
  ) {
    throw new IpbError("IPB-SEC-005", {
      detail: "break-glass is managed in the platform tenant by named staff",
    });
  }
  if (!ctx.principal.roles.some((r) => roles.includes(r)))
    throw new IpbError("IPB-UX-011", { detail: `needs one of ${roles.join(", ")}` });
}

export class BreakGlass {
  constructor(private readonly o: BreakGlassOptions) {}

  async request(
    ctx: KernelContext,
    reason: string,
    durationMinutes: number,
  ): Promise<BreakGlassGrant> {
    assertPlatform(ctx, [REQUESTER_ROLE]);
    const max = Math.min(this.o.maxMinutes ?? BREAKGLASS_MAX_MINUTES, BREAKGLASS_MAX_MINUTES);
    if (!(durationMinutes >= 1 && durationMinutes <= max))
      throw new RangeError(`break-glass lasts 1–${max} minutes`);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("bgr");
        const r = await tx.query<Row>(
          `insert into tenancy.breakglass_grant (id, tenant_id, requester_id, reason, duration_minutes)
         values ($1, $2, $3, $4, $5) returning *`,
          [id, PLATFORM_TENANT_ID, ctx.principal.id, reason, durationMinutes],
        );
        await this.o.audit.record(tx, {
          action: "security.breakglass.request",
          resourceType: "breakglass_grant",
          resourceId: id,
          after: { duration_minutes: durationMinutes },
        });
        return toGrant(r.rows[0] as Row);
      },
      { action: "security.breakglass.request" },
    );
  }

  /** Second-person approval; self-approval is refused with IPB-SEC-009 (@IPB-02-AT-10). */
  async approve(ctx: KernelContext, id: string): Promise<BreakGlassGrant> {
    assertPlatform(ctx, APPROVER_ROLES);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id);
        if (row.requester_id === ctx.principal.id)
          throw new IpbError("IPB-SEC-009", { meta: { grant_id: id } });
        if (row.state !== "requested") throw new ConflictError(`grant ${id} is ${row.state}`);
        const ticket = newId("rvw");
        const r = await tx.query<Row>(
          `update tenancy.breakglass_grant
            set state = 'active', approver_id = $2, approved_at = now(),
                expires_at = now() + make_interval(mins => duration_minutes), review_ticket_ref = $3
          where id = $1 returning *`,
          [id, ctx.principal.id, ticket],
        );
        const g = toGrant(r.rows[0] as Row);
        await this.o.audit.record(tx, {
          action: "security.breakglass.approve",
          resourceType: "breakglass_grant",
          resourceId: id,
          after: { expires_at: g.expiresAt?.toISOString(), review_ticket_ref: ticket },
        });
        await this.emit(tx, "BreakGlassGranted", {
          grant_id: id,
          requester_id: g.requesterId,
          approver_id: ctx.principal.id,
          expires_at: g.expiresAt?.toISOString(),
          review_ticket_ref: ticket,
        });
        return g;
      },
      { action: "security.breakglass.approve" },
    );
  }

  async revoke(ctx: KernelContext, id: string): Promise<BreakGlassGrant> {
    assertPlatform(ctx, APPROVER_ROLES);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id);
        if (row.state === "revoked") throw new ConflictError(`grant ${id} is revoked`);
        const r = await tx.query<Row>(
          "update tenancy.breakglass_grant set state = 'revoked', revoked_at = now() where id = $1 returning *",
          [id],
        );
        await this.o.audit.record(tx, {
          action: "security.breakglass.revoke",
          resourceType: "breakglass_grant",
          resourceId: id,
          before: { state: row.state },
          after: { state: "revoked" },
        });
        await this.emit(tx, "BreakGlassRevoked", { grant_id: id });
        return toGrant(r.rows[0] as Row);
      },
      { action: "security.breakglass.revoke" },
    );
  }

  private async load(tx: Tx, id: string): Promise<Row> {
    const r = await tx.query<Row>(
      "select * from tenancy.breakglass_grant where id = $1 for update",
      [id],
    );
    if (!r.rows[0]) throw new NotFoundError("break-glass grant");
    return r.rows[0];
  }

  private async emit(
    tx: Tx,
    event: "BreakGlassGranted" | "BreakGlassRevoked",
    data: Record<string, unknown>,
  ): Promise<void> {
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

/** A break-glass grant used in the context tenant, as the tenant sees it (tenancy/0009, R1-D-28). */
export interface BreakGlassUse {
  grantId: string;
  requesterId: string;
  approverId: string | null;
  reason: string;
  expiresAt: Date | null;
  reviewTicketRef: string | null;
  firstUsedAt: Date;
  lastUsedAt: Date;
  uses: number;
  notifiedAt: Date | null;
}

interface UseRow {
  grant_id: string;
  requester_id: string;
  approver_id: string | null;
  reason: string;
  expires_at: Date | null;
  review_ticket_ref: string | null;
  first_used_at: Date;
  last_used_at: Date;
  uses: number;
  notified_at: Date | null;
}
const toUse = (r: UseRow): BreakGlassUse => ({
  grantId: r.grant_id,
  requesterId: r.requester_id,
  approverId: r.approver_id,
  reason: r.reason,
  expiresAt: r.expires_at,
  reviewTicketRef: r.review_ticket_ref,
  firstUsedAt: r.first_used_at,
  lastUsedAt: r.last_used_at,
  uses: r.uses,
  notifiedAt: r.notified_at,
});

const NOTHING_NEW = Symbol("nothing new");

/**
 * Break-glass visible to the tenant (Finbyx PR-FBX-10 item 3; OUT 24, 70; R1-D-28). The kernel
 * records each grant's first and later uses in the tenant; `list` is the tenant's page, and
 * `notify` (per tenant, through `TenantSweep`, every few minutes) raises BreakGlassUsed in the
 * tenant once per grant, for the product to notify the tenant's administrators.
 */
export class BreakGlassTenantNotices {
  constructor(private readonly o: Omit<BreakGlassOptions, "maxMinutes">) {}

  list(ctx: KernelContext): Promise<BreakGlassUse[]> {
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<UseRow>("select * from tenancy.breakglass_use order by first_used_at desc")
      ).rows.map(toUse),
    );
  }

  /** Raise BreakGlassUsed for each new use in the context tenant; returns how many. */
  async notify(ctx: KernelContext): Promise<number> {
    try {
      return await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const rows = (
            await tx.query<UseRow>("select * from tenancy.breakglass_claim_notices(100)")
          ).rows;
          if (!rows.length) throw NOTHING_NEW;
          for (const r of rows) {
            await this.o.audit.record(tx, {
              action: "security.breakglass.use_notified",
              resourceType: "breakglass_grant",
              resourceId: r.grant_id,
              after: { first_used_at: r.first_used_at, uses: r.uses },
            });
            if (this.o.outbox)
              await this.o.outbox.publish(tx, "tenancy", {
                envelope: internalEvent({
                  product: this.o.product,
                  event: "BreakGlassUsed",
                  tenantId: tx.ctx.tenantId,
                  data: {
                    grant_id: r.grant_id,
                    requester_id: r.requester_id,
                    approver_id: r.approver_id,
                    expires_at: r.expires_at?.toISOString() ?? null,
                    review_ticket_ref: r.review_ticket_ref,
                    first_used_at: r.first_used_at.toISOString(),
                  },
                  actorId: tx.ctx.principal.id,
                  ...(this.o.pseudonymKey ? { pseudonymKey: this.o.pseudonymKey } : {}),
                }),
              });
          }
          return rows.length;
        },
        { action: "security.breakglass.use_notified" },
      );
    } catch (e) {
      if (e === NOTHING_NEW) return 0;
      throw e;
    }
  }

  sweep(sweep: { run<T>(job: (ctx: KernelContext) => Promise<T>): Promise<unknown> }) {
    return sweep.run((ctx) => this.notify(ctx));
  }
}
