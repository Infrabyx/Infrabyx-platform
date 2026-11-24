// A scoped break-glass grant under the tenant's own control (Finbyx PR-FBX-55; owner order of 24 Nov
// 2026; R1-D-284; tenancy/0031). A scoped grant (R1-D-75) is requested and approved by platform staff
// in the platform tenant; here the tenant it is scoped to decides on it, as a maker-checker in the
// tenant: one ORG_OWNER or ORG_ADMIN approves a `read` grant (two different ones with the kernel's
// `breakGlassTenantApproversForRead: 2`; R1-D-286, tenancy/0032), a `read_write` grant needs a
// second, different one (as support access, R1-D-76). The approval lasts at most the grant's duration from
// the final approval; the tenant may refuse a grant or revoke its decision at once, and both are
// final. Every step is ledgered in the tenant. The kernel always enforces a refusal or revocation,
// and with `PgKernelOptions.requireTenantApprovedBreakGlass` admits a scoped grant only while its
// approval is live; `status` tells a product's own guard the same. Unscoped break-glass is unchanged.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { isPlatformRole, isServiceRole } from "@infrabyx/contracts/roles";
import { internalEvent } from "@infrabyx/config/events";
import type { SecretKey } from "@infrabyx/crypto";
import { BREAKGLASS_MAX_MINUTES } from "./breakglass.js";
import { PLATFORM_TENANT_ID, isAgentPrincipal, isSupportContext } from "./context.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { effectiveTenantApprovalState } from "./kernel.js";

const MANAGER_ROLES = ["ORG_OWNER", "ORG_ADMIN"];
const GRANT_ID = /^bgr_[0-9A-HJKMNP-TV-Z]{26}$/;
// C0 controls and DEL: a refusal reason is one line of text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
/** The longest reason a tenant gives for refusing a grant. */
export const BREAKGLASS_TENANT_REFUSAL_MAX = 500;

/** Ledger actions of the tenant's decisions (R1-D-284); the verbs the kernel's agent guard knows. */
export const BREAKGLASS_TENANT_ACTIONS = {
  approve: "security.breakglass_tenant.approve",
  refuse: "security.breakglass_tenant.refuse",
  revoke: "security.breakglass_tenant.revoke",
} as const;

/** The tenant's decision on a grant as stored (tenancy/0031). */
export type BreakGlassTenantDecision =
  "awaiting_second_approval" | "approved" | "refused" | "revoked";
/** The tenant's decision as read now: `approved` only while unexpired; `none` when undecided. */
export type BreakGlassTenantState = "none" | "expired" | BreakGlassTenantDecision;

/** The tenant's decision on one scoped grant. */
export interface BreakGlassTenantApprovalRecord {
  grantId: string;
  tenantId: string;
  access: "read" | "read_write";
  state: BreakGlassTenantDecision;
  /** The window the approvers asked for, in minutes (the smaller of the two for read-write). */
  windowMinutes: number | null;
  firstApproverId: string | null;
  firstApprovedAt: Date | null;
  secondApproverId: string | null;
  secondApprovedAt: Date | null;
  expiresAt: Date | null;
  endedBy: string | null;
  endedAt: Date | null;
  /** The tenant's reason for a refusal. */
  reason: string | null;
  createdAt: Date;
}

/** A scoped grant awaiting or holding the tenant's decision, as the tenant sees it. */
export interface PendingBreakGlassGrant {
  grantId: string;
  requesterId: string;
  /** The platform approver; null while the grant awaits one. */
  approverId: string | null;
  reason: string;
  durationMinutes: number;
  /** The modules the grant may touch; null for every module of the tenant. */
  modules: string[] | null;
  access: "read" | "read_write";
  /** The platform side's state: `requested` (awaiting the platform approver) or `active`. */
  grantState: "requested" | "active";
  requestedAt: Date;
  /** Set once the platform side approved it. */
  grantExpiresAt: Date | null;
  /** The tenant's decision so far; null when it has not decided. */
  approval: BreakGlassTenantApprovalRecord | null;
  /** The tenant's decision as read now. */
  tenantState: BreakGlassTenantState;
}

/** What a product's guard tests: whether the tenant's approval of the grant is live now. */
export interface BreakGlassTenantStatus {
  tenantApproved: boolean;
  state: BreakGlassTenantState;
  expiresAt: Date | null;
}

export interface BreakGlassTenantApprovalOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  outbox?: OutboxWriter;
  pseudonymKey?: SecretKey;
  /**
   * Tenant managers who approve a scoped `read` grant, 1 or 2 (R1-D-286). Taken from the kernel's
   * `breakGlassTenantApproversForRead` when the kernel is a `PgKernel`; give it here only for a
   * kernel that does not carry it, and never a different value (refused).
   */
  approversForRead?: 1 | 2;
}

interface Row {
  tenant_id: string;
  grant_id: string;
  access: "read" | "read_write";
  state: BreakGlassTenantDecision;
  window_minutes: number | null;
  first_approver_id: string | null;
  first_approved_at: Date | null;
  second_approver_id: string | null;
  second_approved_at: Date | null;
  expires_at: Date | null;
  ended_by: string | null;
  ended_at: Date | null;
  reason: string | null;
  created_at: Date;
}
const toRecord = (r: Row): BreakGlassTenantApprovalRecord => ({
  grantId: r.grant_id,
  tenantId: r.tenant_id,
  access: r.access,
  state: r.state,
  windowMinutes: r.window_minutes,
  firstApproverId: r.first_approver_id,
  firstApprovedAt: r.first_approved_at,
  secondApproverId: r.second_approver_id,
  secondApprovedAt: r.second_approved_at,
  expiresAt: r.expires_at,
  endedBy: r.ended_by,
  endedAt: r.ended_at,
  reason: r.reason,
  createdAt: r.created_at,
});

interface GrantRow {
  id: string;
  requester_id: string;
  approver_id: string | null;
  reason: string;
  duration_minutes: number;
  scope_modules: string[] | null;
  scope_access: "read" | "read_write";
  state: "requested" | "active";
  requested_at: Date;
  expires_at: Date | null;
}

/**
 * The tenant's own people: a named user, not an agent, support principal or service, holding
 * ORG_OWNER or ORG_ADMIN and no platform role, in a customer tenant's context that carries no
 * break-glass grant, impersonation or external grant. Never the platform side.
 */
function assertManager(ctx: KernelContext): void {
  if (
    ctx.scope === "platform" ||
    ctx.tenantId === PLATFORM_TENANT_ID ||
    ctx.principal.type !== "user" ||
    isSupportContext(ctx) ||
    ctx.breakGlassGrantId ||
    ctx.act ||
    ctx.externalGrantId !== undefined ||
    ctx.principal.roles.some((r) => isPlatformRole(r) || isServiceRole(r))
  )
    throw new IpbError("IPB-SEC-005", {
      detail: "a break-glass grant is approved in its tenant by that tenant's own named users",
    });
  if (isAgentPrincipal(ctx))
    throw new IpbError("IPB-SEC-004", { detail: "agents may not approve break-glass" });
  if (!ctx.principal.roles.some((r) => MANAGER_ROLES.includes(r)))
    throw new IpbError("IPB-UX-011", { detail: `needs one of ${MANAGER_ROLES.join(", ")}` });
}

function assertGrantId(id: string): void {
  if (typeof id !== "string" || !GRANT_ID.test(id))
    throw new RangeError("invalid break-glass grant id");
}

const stateOf = (r: Row | undefined, now: Date): BreakGlassTenantState =>
  !r
    ? "none"
    : r.state === "approved" && (r.expires_at === null || r.expires_at.getTime() <= now.getTime())
      ? "expired"
      : r.state;

export class BreakGlassTenantApproval {
  /** Tenant managers who approve a scoped `read` grant here: the kernel's value (R1-D-286). */
  readonly approversForRead: 1 | 2;

  constructor(private readonly o: BreakGlassTenantApprovalOptions) {
    const k = (o.kernel as { breakGlassTenantApproversForRead?: unknown })
      .breakGlassTenantApproversForRead;
    if (k !== undefined && k !== 1 && k !== 2)
      throw new RangeError("the kernel's breakGlassTenantApproversForRead is 1 or 2");
    const given = o.approversForRead;
    if (given !== undefined && given !== 1 && given !== 2)
      throw new RangeError("approversForRead is 1 or 2");
    if (given !== undefined && k !== undefined && given !== k)
      throw new RangeError(
        "approversForRead differs from the kernel's breakGlassTenantApproversForRead",
      );
    this.approversForRead = (k ?? given ?? 1) as 1 | 2;
  }

  /** The decision as read now, with this kernel's number of `read` approvers (R1-D-286). */
  private stateNow(r: Row | undefined, now: Date): BreakGlassTenantState {
    return effectiveTenantApprovalState(
      stateOf(r, now),
      r?.access === "read" && r.second_approver_id === null,
      this.approversForRead,
    ) as BreakGlassTenantState;
  }

  /** The scoped grants of this tenant that are requested or active, with its decision on each. */
  async pending(ctx: KernelContext): Promise<PendingBreakGlassGrant[]> {
    assertManager(ctx);
    return this.o.kernel.read(ctx, async (tx) => {
      const grants = (await tx.query<GrantRow>("select * from tenancy.breakglass_tenant_pending()"))
        .rows;
      if (!grants.length) return [];
      const rows = (
        await tx.query<Row>(
          `select * from tenancy.breakglass_tenant_approval
            where tenant_id = $1 and grant_id = any($2::text[])`,
          [ctx.tenantId, grants.map((g) => g.id)],
        )
      ).rows;
      const now = (await tx.query<{ now: Date }>("select now() as now")).rows[0]?.now ?? new Date();
      const by = new Map(rows.map((r) => [r.grant_id, r]));
      return grants.map((g) => {
        const r = by.get(g.id);
        return {
          grantId: g.id,
          requesterId: g.requester_id,
          approverId: g.approver_id,
          reason: g.reason,
          durationMinutes: g.duration_minutes,
          modules: g.scope_modules,
          access: g.scope_access,
          grantState: g.state,
          requestedAt: g.requested_at,
          grantExpiresAt: g.expires_at,
          approval: r ? toRecord(r) : null,
          tenantState: this.stateNow(r, now),
        };
      });
    });
  }

  /**
   * Approve a scoped grant of this tenant that is requested or active. A `read` grant is then
   * approved; a `read_write` grant, and a `read` grant with `approversForRead` 2 (R1-D-286), waits
   * for a second, different manager. The approval lasts `minutes` (default and at most the grant's
   * duration; the smaller of the two approvers') from the final approval. With 2, a live `read`
   * approval one manager gave earlier (under 1) takes a second manager's approval here, which never
   * lengthens its window or its expiry.
   */
  async approve(
    ctx: KernelContext,
    grantId: string,
    opts: { minutes?: number } = {},
  ): Promise<BreakGlassTenantApprovalRecord> {
    assertManager(ctx);
    assertGrantId(grantId);
    if (
      opts.minutes !== undefined &&
      !(
        Number.isInteger(opts.minutes) &&
        opts.minutes >= 1 &&
        opts.minutes <= BREAKGLASS_MAX_MINUTES
      )
    )
      throw new RangeError(`a tenant approval lasts 1–${BREAKGLASS_MAX_MINUTES} minutes`);
    const action = BREAKGLASS_TENANT_ACTIONS.approve;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const g = await this.grant(tx, grantId);
        if (!g) throw new NotFoundError("break-glass grant");
        // Never the platform side: neither the requester nor its platform approver decides here.
        if (ctx.principal.id === g.requester_id || ctx.principal.id === g.approver_id)
          throw new IpbError("IPB-TRUST-005", { meta: { grant_id: grantId } });
        const minutes = Math.min(opts.minutes ?? g.duration_minutes, g.duration_minutes);
        const row = await this.load(tx, grantId);
        const now = await this.now(tx);
        let r: Row | undefined;
        if (!row) {
          const one = g.scope_access === "read" && this.approversForRead === 1;
          const ins = await tx.query<Row>(
            one
              ? `insert into tenancy.breakglass_tenant_approval
                   (tenant_id, grant_id, access, state, window_minutes, first_approver_id,
                    first_approved_at, expires_at)
                 values ($1, $2, 'read', 'approved', $3, $4, now(), now() + make_interval(mins => $3))
                 on conflict do nothing returning *`
              : `insert into tenancy.breakglass_tenant_approval
                   (tenant_id, grant_id, access, state, window_minutes, first_approver_id,
                    first_approved_at)
                 values ($1, $2, $5, 'awaiting_second_approval', $3, $4, now())
                 on conflict do nothing returning *`,
            one
              ? [ctx.tenantId, grantId, minutes, ctx.principal.id]
              : [ctx.tenantId, grantId, minutes, ctx.principal.id, g.scope_access],
          );
          r = ins.rows[0];
          if (!r) throw new ConflictError(`the tenant's decision on ${grantId} changed; try again`);
        } else if (row.state === "awaiting_second_approval") {
          if (row.first_approver_id === ctx.principal.id)
            throw new IpbError("IPB-TRUST-005", { meta: { grant_id: grantId } });
          r = (
            await tx.query<Row>(
              `update tenancy.breakglass_tenant_approval
                  set state = 'approved', second_approver_id = $3, second_approved_at = now(),
                      window_minutes = least(window_minutes, $4),
                      expires_at = now() + make_interval(mins => least(window_minutes, $4))
                where tenant_id = $1 and grant_id = $2 returning *`,
              [ctx.tenantId, grantId, ctx.principal.id, minutes],
            )
          ).rows[0];
        } else if (
          this.approversForRead === 2 &&
          row.access === "read" &&
          row.second_approver_id === null &&
          stateOf(row, now) === "approved"
        ) {
          // An approval one manager gave under 1: a second, different one completes it, never
          // lengthening it (tenancy/0032's guard holds the same).
          if (row.first_approver_id === ctx.principal.id)
            throw new IpbError("IPB-TRUST-005", { meta: { grant_id: grantId } });
          r = (
            await tx.query<Row>(
              `update tenancy.breakglass_tenant_approval
                  set second_approver_id = $3, second_approved_at = now(),
                      window_minutes = least(window_minutes, $4),
                      expires_at = least(expires_at,
                                         now() + make_interval(mins => least(window_minutes, $4)))
                where tenant_id = $1 and grant_id = $2 returning *`,
              [ctx.tenantId, grantId, ctx.principal.id, minutes],
            )
          ).rows[0];
        } else {
          throw new ConflictError(
            `the tenant's decision on ${grantId} is ${row ? this.stateNow(row, now) : "none"}`,
          );
        }
        const rec = toRecord(r as Row);
        await this.o.audit.record(tx, {
          action,
          resourceType: "breakglass_grant",
          resourceId: grantId,
          before: { state: row ? this.stateNow(row, now) : "none" },
          after: {
            state: rec.state,
            access: rec.access,
            window_minutes: rec.windowMinutes,
            expires_at: rec.expiresAt?.toISOString() ?? null,
          },
        });
        if (rec.state === "approved")
          await this.emit(tx, "BreakGlassTenantApproved", {
            grant_id: grantId,
            requester_id: g.requester_id,
            access: rec.access,
            modules: g.scope_modules,
            first_approver_id: rec.firstApproverId,
            second_approver_id: rec.secondApproverId,
            expires_at: rec.expiresAt?.toISOString() ?? null,
          });
        return rec;
      },
      { action },
    );
  }

  /**
   * Refuse a scoped grant of this tenant that is undecided (and requested or active) or awaits its
   * second approval. Final: the kernel refuses the grant in this tenant from then on.
   */
  async refuse(
    ctx: KernelContext,
    grantId: string,
    reason: string,
  ): Promise<BreakGlassTenantApprovalRecord> {
    assertManager(ctx);
    assertGrantId(grantId);
    if (
      typeof reason !== "string" ||
      reason.length < 1 ||
      reason.length > BREAKGLASS_TENANT_REFUSAL_MAX ||
      CONTROL.test(reason)
    )
      throw new RangeError(
        `a refusal reason has 1 to ${BREAKGLASS_TENANT_REFUSAL_MAX} characters on one line`,
      );
    return this.end(ctx, grantId, "refused", reason);
  }

  /**
   * Revoke the tenant's decision at once: an approval, one awaiting its second approver, or (for a
   * requested or active grant it has not decided on) the grant in this tenant. Final; the kernel
   * refuses the grant's next transaction here, whatever its options.
   */
  async revoke(ctx: KernelContext, grantId: string): Promise<BreakGlassTenantApprovalRecord> {
    assertManager(ctx);
    assertGrantId(grantId);
    return this.end(ctx, grantId, "revoked", null);
  }

  /** The tenant's decision on a grant now; `none` for a grant it has not decided on or cannot see. */
  async status(ctx: KernelContext, grantId: string): Promise<BreakGlassTenantStatus> {
    assertManager(ctx);
    assertGrantId(grantId);
    return this.o.kernel.read(ctx, async (tx) => {
      const r = (
        await tx.query<{
          state: BreakGlassTenantState;
          expires_at: Date | null;
          single_read: boolean | null;
        }>(
          `select tenancy.breakglass_tenant_approval_state($1) as state, a.expires_at,
                  a.access = 'read' and a.second_approver_id is null as single_read
             from (select 1) one
             left join tenancy.breakglass_tenant_approval a
               on a.tenant_id = $2 and a.grant_id = $1`,
          [grantId, ctx.tenantId],
        )
      ).rows[0];
      const state = effectiveTenantApprovalState(
        r?.state ?? "none",
        r?.single_read === true,
        this.approversForRead,
      ) as BreakGlassTenantState;
      return { tenantApproved: state === "approved", state, expiresAt: r?.expires_at ?? null };
    });
  }

  private async end(
    ctx: KernelContext,
    grantId: string,
    to: "refused" | "revoked",
    reason: string | null,
  ): Promise<BreakGlassTenantApprovalRecord> {
    const action = BREAKGLASS_TENANT_ACTIONS[to === "refused" ? "refuse" : "revoke"];
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, grantId);
        let r: Row | undefined;
        if (!row) {
          // Undecided: the grant must be one this tenant can see (requested or active, its own).
          const g = await this.grant(tx, grantId);
          if (!g) throw new NotFoundError("break-glass grant");
          r = (
            await tx.query<Row>(
              `insert into tenancy.breakglass_tenant_approval
                 (tenant_id, grant_id, access, state, ended_by, ended_at, reason)
               values ($1, $2, $3, $4, $5, now(), $6)
               on conflict do nothing returning *`,
              [ctx.tenantId, grantId, g.scope_access, to, ctx.principal.id, reason],
            )
          ).rows[0];
          if (!r) throw new ConflictError(`the tenant's decision on ${grantId} changed; try again`);
        } else if (
          row.state === "awaiting_second_approval" ||
          (to === "revoked" && row.state === "approved")
        ) {
          r = (
            await tx.query<Row>(
              `update tenancy.breakglass_tenant_approval
                  set state = $3, ended_by = $4, ended_at = now(), reason = $5
                where tenant_id = $1 and grant_id = $2 returning *`,
              [ctx.tenantId, grantId, to, ctx.principal.id, reason],
            )
          ).rows[0];
        } else {
          const now = await this.now(tx);
          throw new ConflictError(
            this.stateNow(row, now) === "awaiting_second_approval" && row.state === "approved"
              ? `the tenant's single approval of ${grantId} is revoked, not refused`
              : `the tenant's decision on ${grantId} is ${this.stateNow(row, now)}`,
          );
        }
        const rec = toRecord(r as Row);
        await this.o.audit.record(tx, {
          action,
          resourceType: "breakglass_grant",
          resourceId: grantId,
          before: { state: row ? this.stateNow(row, await this.now(tx)) : "none" },
          after: { state: to },
        });
        await this.emit(tx, "BreakGlassTenantRevoked", {
          grant_id: grantId,
          state: to,
          ended_by: ctx.principal.id,
        });
        return rec;
      },
      { action },
    );
  }

  /** The grant as this tenant sees it: scoped to it and requested or active (tenancy/0031). */
  private async grant(tx: Tx, grantId: string): Promise<GrantRow | undefined> {
    return (
      await tx.query<GrantRow>("select * from tenancy.breakglass_tenant_pending() where id = $1", [
        grantId,
      ])
    ).rows[0];
  }

  private async now(tx: Tx): Promise<Date> {
    return (await tx.query<{ now: Date }>("select now() as now")).rows[0]?.now ?? new Date();
  }

  private async load(tx: Tx, grantId: string): Promise<Row | undefined> {
    return (
      await tx.query<Row>(
        `select * from tenancy.breakglass_tenant_approval
          where tenant_id = $1 and grant_id = $2 for update`,
        [tx.ctx.tenantId, grantId],
      )
    ).rows[0];
  }

  private async emit(
    tx: Tx,
    event: "BreakGlassTenantApproved" | "BreakGlassTenantRevoked",
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
