// Maker-checker engine (IPB-02 §02.4.2, §02.4.6.1; PL1-D-02/D-01). PL3 adds request expiry with a
// reminder and an escalation (PL3-D-07), the checker diff, the tighten-only tenant policy `mc.*`
// (PL3-D-08) and observers called in the same transaction, through which `@infrabyx/workflow`
// keeps its timers, scheduled actions and Work Inbox in step (PL3-D-19). Escalation never decides.
import type { DataClass } from "@infrabyx/contracts/data-class";
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  ApprovalGateway,
  ApprovalRequestInput,
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import {
  RISK_POLICY,
  TENANT_DELETE_ACTION,
  TENANT_DELETE_POLICY,
  type RiskPolicy,
} from "@infrabyx/contracts/tiers";
import { internalEvent } from "@infrabyx/config/events";
import { canonicalDigest, newId, type SecretKey } from "@infrabyx/crypto";
import { isAgentPrincipal } from "../context.js";
import { ConflictError, NotFoundError } from "../errors.js";
import type { FieldCrypto } from "../field-crypto.js";

export type ApprovalState =
  "pending" | "approved" | "rejected" | "cancelled" | "executed" | "expired";
type Risk = ApprovalRequestInput["riskClass"];

export interface ApprovalRecord {
  id: string;
  tenantId: string;
  action: string;
  riskClass: Risk;
  payloadDigest: string;
  payloadClass: DataClass;
  summary: string | null;
  makerId: string;
  state: ApprovalState;
  requiredCheckers: number;
  delayMinutes: number;
  approvedAt: Date | null;
  delayUntil: Date | null;
  executedAt: Date | null;
  createdAt: Date;
  /** After this a pending request expires and must be raised again (PL3-D-07). */
  expiresAt: Date;
  remindedAt: Date | null;
  escalatedAt: Date | null;
  financial: boolean;
  /** Checker diff; above INTERNAL only the changed field names (`{ fields }`). */
  diff: Record<string, unknown> | null;
}

export interface ActionPolicy {
  /** Roles that may check. Default: ORG_CHECKER, ORG_ADMIN, ORG_OWNER in a tenant; PLT_SECURITY_OFFICER, PLT_SUPER_ADMIN in a platform context. */
  checkerRoles?: readonly string[];
  /** Runs in the executing transaction with the decrypted payload. */
  execute?: (tx: Tx, payload: Record<string, unknown>, request: ApprovalRecord) => Promise<void>;
  /** Execute in the approving transaction when no delay applies (default true). */
  autoExecute?: boolean;
  /** Delay in minutes; never below the risk class minimum (IPB-02 §02.4.6.1). */
  delayMinutes?: number;
  /** Money-moving action: an R3 request on it expires after 72 hours (PL3-D-07). */
  financial?: boolean;
  /** Amount in minor units, for the tenant's `mc.dual_checker_above.<action>` (PL3-D-08). */
  amountOf?: (payload: Record<string, unknown>) => number | undefined;
}

/**
 * The tenant's tighten-only maker-checker keys for one action (PL3-D-08). `@infrabyx/workflow`
 * reads them from settings; the engine only ever tightens with them.
 */
export interface TenantApprovalPolicy {
  /** `mc.checker_roles.<action>`: narrows the action's checker roles; never widens them. */
  checkerRoles?: readonly string[] | null;
  /** `mc.dual_checker_above.<action>`: above this amount two distinct checkers decide. */
  dualCheckerAbove?: number | null;
}

/** Called inside the transaction of each transition, after the ledger entry. */
export interface ApprovalObserver {
  onRequested?(tx: Tx, r: ApprovalRecord): Promise<void>;
  onDecided?(tx: Tx, r: ApprovalRecord, decision: "approve" | "reject"): Promise<void>;
  onExecuted?(tx: Tx, r: ApprovalRecord): Promise<void>;
  onCancelled?(tx: Tx, r: ApprovalRecord): Promise<void>;
  onExpired?(tx: Tx, r: ApprovalRecord): Promise<void>;
  onReminded?(tx: Tx, r: ApprovalRecord): Promise<void>;
  onEscalated?(tx: Tx, r: ApprovalRecord, toRole: string): Promise<void>;
}

/** Expiry periods (PL3-D-07): platform policy in code, never a tenant setting. */
export const APPROVAL_EXPIRY_HOURS = { default: 7 * 24, short: 72 } as const;
export const APPROVAL_REMINDER_HOURS = 24;
export const APPROVAL_ESCALATION_HOURS = 48;
export const APPROVAL_ESCALATION_ROLE = "ORG_ADMIN";

/** 72 hours for every R4 and R5 request and for R3 on a financial action; 7 days otherwise. */
export function expiryHoursFor(risk: Risk, financial: boolean): number {
  return risk === "R4" || risk === "R5" || (risk === "R3" && financial)
    ? APPROVAL_EXPIRY_HOURS.short
    : APPROVAL_EXPIRY_HOURS.default;
}

export interface ApprovalsEngineOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  outbox?: OutboxWriter;
  fieldCrypto?: FieldCrypto;
  pseudonymKey?: SecretKey;
  /** The tenant's `mc.*` keys for an action (PL3-D-08); omitted means the platform policy only. */
  tenantPolicy?: (ctx: KernelContext, action: string) => Promise<TenantApprovalPolicy>;
  observers?: readonly ApprovalObserver[];
}

const DEFAULT_TENANT_CHECKERS = ["ORG_CHECKER", "ORG_ADMIN", "ORG_OWNER"];
const DEFAULT_PLATFORM_CHECKERS = ["PLT_SECURITY_OFFICER", "PLT_SUPER_ADMIN"];
/** The maker, the tenant's ORG_OWNER, or a PLT_SECURITY_OFFICER (IPB-02-80, A-04). */
const CANCEL_ROLES = ["ORG_OWNER", "PLT_SECURITY_OFFICER"];

interface Row {
  id: string;
  tenant_id: string;
  action: string;
  risk_class: Risk;
  payload_digest: string;
  payload: Record<string, unknown> | null;
  payload_enc: Buffer | null;
  payload_key_id: string | null;
  payload_class: DataClass;
  summary: string | null;
  maker_id: string;
  state: ApprovalState;
  required_checkers: number;
  delay_minutes: number;
  approved_at: Date | null;
  delay_until: Date | null;
  executed_at: Date | null;
  created_at: Date;
  expires_at: Date | null;
  expired_at: Date | null;
  reminded_at: Date | null;
  escalated_at: Date | null;
  financial: boolean;
  diff: Record<string, unknown> | null;
}

/** Requests made before tenancy 0002 have no `expires_at`: they expire 7 days after creation. */
const expiresAtOf = (r: Row): Date =>
  r.expires_at ?? new Date(r.created_at.getTime() + APPROVAL_EXPIRY_HOURS.default * 3_600_000);

const toRecord = (r: Row): ApprovalRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  action: r.action,
  riskClass: r.risk_class,
  payloadDigest: r.payload_digest,
  payloadClass: r.payload_class,
  summary: r.summary,
  makerId: r.maker_id,
  state: r.expired_at ? "expired" : r.state,
  requiredCheckers: r.required_checkers,
  delayMinutes: r.delay_minutes,
  approvedAt: r.approved_at,
  delayUntil: r.delay_until,
  executedAt: r.executed_at,
  createdAt: r.created_at,
  expiresAt: expiresAtOf(r),
  remindedAt: r.reminded_at,
  escalatedAt: r.escalated_at,
  financial: r.financial,
  diff: r.diff,
});

const ENCRYPTED: readonly DataClass[] = ["CONFIDENTIAL", "REGULATED"];

/** The checker diff as stored: values only when the payload is PUBLIC or INTERNAL. */
function storedDiff(
  diff: ApprovalRequestInput["diff"],
  cls: DataClass,
): Record<string, unknown> | null {
  if (!diff) return null;
  if (!ENCRYPTED.includes(cls)) return { before: diff.before, after: diff.after };
  const fields = new Set([...Object.keys(diff.before ?? {}), ...Object.keys(diff.after)]);
  return { fields: [...fields].sort() };
}

export function riskPolicyFor(action: string, risk: Risk): RiskPolicy {
  return action === TENANT_DELETE_ACTION ? TENANT_DELETE_POLICY : RISK_POLICY[risk];
}

export class ApprovalsEngine implements ApprovalGateway {
  private readonly policies = new Map<string, ActionPolicy>();
  constructor(private readonly o: ApprovalsEngineOptions) {}

  /** Register checker roles and the executor for an action. */
  register(action: string, policy: ActionPolicy): this {
    this.policies.set(action, policy);
    return this;
  }

  /** Create a request inside the caller's mutation (ApprovalGateway, IPB-SEC-006 flow). */
  async request(tx: Tx, input: ApprovalRequestInput): Promise<{ id: string }> {
    const ctx = tx.ctx;
    const risk = riskPolicyFor(input.action, input.riskClass);
    if (isAgentPrincipal(ctx) && !risk.agentMayMake) {
      throw new IpbError("IPB-SEC-004", {
        detail: `agents may not make ${input.riskClass} requests`,
        meta: { action: input.action },
      });
    }
    const policy = this.policies.get(input.action) ?? {};
    const delay = Math.max(policy.delayMinutes ?? risk.defaultDelayMinutes, risk.minDelayMinutes);
    const tenant = (await this.o.tenantPolicy?.(ctx, input.action)) ?? {};
    const amount = policy.amountOf?.(input.payload);
    const dual =
      tenant.dualCheckerAbove != null && amount !== undefined && amount > tenant.dualCheckerAbove;
    const checkers = Math.max(risk.checkers, dual ? 2 : 1);
    const financial = policy.financial === true;
    const cls = input.payloadDataClass ?? "INTERNAL";
    if (cls === "SECRET") throw new Error("SECRET data never enters an approval payload");
    const id = newId("apr");
    const digest = canonicalDigest(input.payload);
    let payload: string | null = JSON.stringify(input.payload);
    let enc: Buffer | null = null;
    let keyId: string | null = null;
    if (cls === "CONFIDENTIAL" || cls === "REGULATED") {
      if (!this.o.fieldCrypto) throw new Error(`${cls} approval payloads need FieldCrypto`);
      const sealed = await this.o.fieldCrypto.encryptField(ctx.tenantId, cls, payload, {
        table: "tenancy.approval_request",
        column: "payload",
        rowId: id,
      });
      enc = Buffer.from(sealed.enc);
      keyId = sealed.keyId;
      payload = null;
    }
    await tx.query(
      `insert into tenancy.approval_request
         (id, tenant_id, action, risk_class, payload_digest, payload, payload_enc, payload_key_id, payload_class,
          summary, maker_id, maker_type, required_checkers, delay_minutes, financial, diff, expires_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb,
               now() + make_interval(hours => $17))`,
      [
        id,
        ctx.tenantId,
        input.action,
        input.riskClass,
        digest,
        payload,
        enc,
        keyId,
        cls,
        input.summary ?? null,
        ctx.principal.id,
        ctx.principal.type,
        checkers,
        delay,
        financial,
        JSON.stringify(storedDiff(input.diff, cls)),
        expiryHoursFor(input.riskClass, financial),
      ],
    );
    await this.o.audit.record(tx, {
      action: "approvals.request.create",
      resourceType: "approval_request",
      resourceId: id,
      after: { action: input.action, risk_class: input.riskClass, payload_digest: digest },
    });
    await this.emit(tx, "ApprovalRequested", {
      request_id: id,
      action: input.action,
      risk_class: input.riskClass,
      maker_id: ctx.principal.id,
      state: "pending",
    });
    if (this.o.observers?.length) {
      const rec = toRecord(await this.load(tx, id, false));
      for (const ob of this.o.observers) await ob.onRequested?.(tx, rec);
    }
    return { id };
  }

  async get(ctx: KernelContext, id: string): Promise<ApprovalRecord> {
    return this.o.kernel.read(ctx, async (tx) => toRecord(await this.load(tx, id, false)));
  }

  /** Approve or reject. Agents never check (IPB-02-10); the maker never checks (IPB-SEC-007). */
  async decide(
    ctx: KernelContext,
    id: string,
    decision: "approve" | "reject",
    reason?: string,
  ): Promise<ApprovalRecord> {
    if (isAgentPrincipal(ctx))
      throw new IpbError("IPB-SEC-004", { detail: "agents are makers only" });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id, true);
        await this.assertNotExpired(tx, row);
        if (row.state !== "pending") throw new ConflictError(`approval ${id} is ${row.state}`);
        if (row.maker_id === ctx.principal.id)
          throw new IpbError("IPB-SEC-007", { meta: { request_id: id } });
        await this.assertChecker(ctx, row.action);
        const dup = await tx.query(
          "select 1 from tenancy.approval_decision where request_id = $1 and checker_id = $2",
          [id, ctx.principal.id],
        );
        if (dup.rows.length) throw new ConflictError("this checker has already decided");
        await tx.query(
          `insert into tenancy.approval_decision (request_id, tenant_id, maker_id, checker_id, decision, reason)
           values ($1, $2, $3, $4, $5, $6)`,
          [id, ctx.tenantId, row.maker_id, ctx.principal.id, decision, reason ?? null],
        );
        let next: Row;
        if (decision === "reject") {
          next = await this.update(tx, id, "state = 'rejected'");
        } else {
          const n = await tx.query<{ n: string }>(
            "select count(*) as n from tenancy.approval_decision where request_id = $1 and decision = 'approve'",
            [id],
          );
          next =
            Number(n.rows[0]?.n) >= row.required_checkers
              ? await this.update(
                  tx,
                  id,
                  "state = 'approved', approved_at = now(), delay_until = now() + make_interval(mins => delay_minutes)",
                )
              : row;
        }
        await this.o.audit.record(tx, {
          action: `approvals.request.${decision}`,
          resourceType: "approval_request",
          resourceId: id,
          before: { state: row.state },
          after: { state: next.state },
        });
        await this.emit(tx, "ApprovalDecided", {
          request_id: id,
          action: row.action,
          risk_class: row.risk_class,
          maker_id: row.maker_id,
          state: next.state,
          checker_id: ctx.principal.id,
          delay_until: next.delay_until?.toISOString() ?? null,
        });
        for (const ob of this.o.observers ?? []) await ob.onDecided?.(tx, toRecord(next), decision);
        const policy = this.policies.get(row.action);
        if (
          next.state === "approved" &&
          next.delay_minutes === 0 &&
          policy?.execute &&
          policy.autoExecute !== false
        ) {
          next = await this.runExecutor(tx, next);
        }
        return toRecord(next);
      },
      { action: `approvals.request.${decision}` },
    );
  }

  /** Execute an approved request once its delay window has passed (IPB-SEC-008 before that). */
  async execute(ctx: KernelContext, id: string): Promise<ApprovalRecord> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id, true);
        if (row.expired_at) throw new IpbError("IPB-UX-012", { meta: { request_id: id } });
        if (row.state !== "approved") throw new ConflictError(`approval ${id} is ${row.state}`);
        const now = await tx.query<{ now: Date }>("select now() as now");
        if (row.delay_until && row.delay_until > (now.rows[0]?.now as Date)) {
          throw new IpbError("IPB-SEC-008", {
            meta: { request_id: id, delay_until: row.delay_until.toISOString() },
          });
        }
        return toRecord(await this.runExecutor(tx, row));
      },
      { action: "approvals.request.execute" },
    );
  }

  /** Cancel a pending or approved request: the maker, or the tenant's ORG_OWNER (IPB-02-AT-12). */
  async cancel(ctx: KernelContext, id: string): Promise<ApprovalRecord> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id, true);
        if (row.expired_at) throw new IpbError("IPB-UX-012", { meta: { request_id: id } });
        if (row.state !== "pending" && row.state !== "approved")
          throw new ConflictError(`approval ${id} is ${row.state}`);
        const may =
          row.maker_id === ctx.principal.id ||
          ctx.principal.roles.some((r) => CANCEL_ROLES.includes(r));
        if (!may)
          throw new IpbError("IPB-UX-011", {
            detail: "only the maker, ORG_OWNER or PLT_SECURITY_OFFICER may cancel",
          });
        const next = await this.update(tx, id, "state = 'cancelled', cancelled_by = $2", [
          ctx.principal.id,
        ]);
        await this.o.audit.record(tx, {
          action: "approvals.request.cancel",
          resourceType: "approval_request",
          resourceId: id,
          before: { state: row.state },
          after: { state: "cancelled" },
        });
        await this.emit(tx, "ApprovalCancelled", {
          request_id: id,
          action: row.action,
          risk_class: row.risk_class,
          maker_id: row.maker_id,
          state: "cancelled",
        });
        for (const ob of this.o.observers ?? []) await ob.onCancelled?.(tx, toRecord(next));
        return toRecord(next);
      },
      { action: "approvals.request.cancel" },
    );
  }

  /**
   * Expire a pending request past its `expires_at` (timer, PL3-D-07). Terminal: it can no longer be
   * approved, executed or cancelled, and the maker raises it again (IPB-UX-012).
   */
  async expire(ctx: KernelContext, id: string): Promise<ApprovalRecord> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id, true);
        if (row.expired_at || row.state !== "pending")
          throw new ConflictError(`approval ${id} is ${toRecord(row).state}`);
        if (!(await this.isDue(tx, expiresAtOf(row))))
          throw new ConflictError(`approval ${id} expires at ${expiresAtOf(row).toISOString()}`);
        const next = await this.update(tx, id, "expired_at = now()");
        await this.o.audit.record(tx, {
          action: "approvals.request.expire",
          resourceType: "approval_request",
          resourceId: id,
          before: { state: "pending" },
          after: { state: "expired" },
        });
        await this.emit(tx, "ApprovalExpired", {
          request_id: id,
          action: row.action,
          risk_class: row.risk_class,
          maker_id: row.maker_id,
          expires_at: expiresAtOf(row).toISOString(),
        });
        const rec = toRecord(next);
        for (const ob of this.o.observers ?? []) await ob.onExpired?.(tx, rec);
        return rec;
      },
      { action: "approvals.request.expire" },
    );
  }

  /** Record the reminder to the checkers (timer at 24 h or `mc.reminder_hours`, PL3-D-07). */
  async remind(ctx: KernelContext, id: string): Promise<ApprovalRecord> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id, true);
        if (row.expired_at || row.state !== "pending" || row.reminded_at)
          throw new ConflictError(`approval ${id} needs no reminder`);
        const next = await this.update(tx, id, "reminded_at = now()");
        await this.o.audit.record(tx, {
          action: "approvals.request.remind",
          resourceType: "approval_request",
          resourceId: id,
          after: { reminded: true },
        });
        const rec = toRecord(next);
        for (const ob of this.o.observers ?? []) await ob.onReminded?.(tx, rec);
        return rec;
      },
      { action: "approvals.request.remind" },
    );
  }

  /**
   * Escalate a request still pending at 48 hours to the tenant's ORG_ADMIN role (PL3-D-07).
   * Escalation notifies and adds an inbox item; it never decides.
   */
  async escalate(ctx: KernelContext, id: string): Promise<ApprovalRecord> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id, true);
        if (row.expired_at || row.state !== "pending" || row.escalated_at)
          throw new ConflictError(`approval ${id} needs no escalation`);
        const next = await this.update(tx, id, "escalated_at = now()");
        await this.o.audit.record(tx, {
          action: "approvals.request.escalate",
          resourceType: "approval_request",
          resourceId: id,
          after: { escalated_to_role: APPROVAL_ESCALATION_ROLE },
        });
        const hours = Math.max(
          1,
          Math.floor(
            ((next.escalated_at as Date).getTime() - row.created_at.getTime()) / 3_600_000,
          ),
        );
        await this.emit(tx, "ApprovalEscalated", {
          request_id: id,
          action: row.action,
          risk_class: row.risk_class,
          escalated_to_role: APPROVAL_ESCALATION_ROLE,
          pending_hours: hours,
        });
        const rec = toRecord(next);
        for (const ob of this.o.observers ?? [])
          await ob.onEscalated?.(tx, rec, APPROVAL_ESCALATION_ROLE);
        return rec;
      },
      { action: "approvals.request.escalate" },
    );
  }

  /** Checker roles for an action after the tenant's `mc.checker_roles.<action>` (never wider). */
  async checkerRolesFor(ctx: KernelContext, action: string): Promise<readonly string[]> {
    const platform = ctx.scope === "platform";
    const allowed =
      this.policies.get(action)?.checkerRoles ??
      (platform ? DEFAULT_PLATFORM_CHECKERS : DEFAULT_TENANT_CHECKERS);
    if (platform || !this.o.tenantPolicy) return allowed;
    const narrowed = (await this.o.tenantPolicy(ctx, action)).checkerRoles;
    const subset = narrowed ? allowed.filter((r) => narrowed.includes(r)) : [];
    return subset.length ? subset : allowed;
  }

  private async assertNotExpired(tx: Tx, row: Row): Promise<void> {
    if (row.expired_at || (row.state === "pending" && (await this.isDue(tx, expiresAtOf(row)))))
      throw new IpbError("IPB-UX-012", {
        meta: { request_id: row.id, expires_at: expiresAtOf(row).toISOString() },
      });
  }

  private async isDue(tx: Tx, at: Date): Promise<boolean> {
    const now = await tx.query<{ now: Date }>("select now() as now");
    return at <= (now.rows[0]?.now as Date);
  }

  private async assertChecker(ctx: KernelContext, action: string): Promise<void> {
    const allowed = await this.checkerRolesFor(ctx, action);
    if (!ctx.principal.roles.some((r) => allowed.includes(r))) {
      throw new IpbError("IPB-UX-011", { detail: `checker needs one of ${allowed.join(", ")}` });
    }
  }

  private async runExecutor(tx: Tx, row: Row): Promise<Row> {
    const policy = this.policies.get(row.action);
    if (policy?.execute) await policy.execute(tx, await this.payloadOf(tx, row), toRecord(row));
    const next = await this.update(tx, row.id, "state = 'executed', executed_at = now()");
    await this.o.audit.record(tx, {
      action: "approvals.request.execute",
      resourceType: "approval_request",
      resourceId: row.id,
      before: { state: row.state },
      after: { state: "executed" },
    });
    await this.emit(tx, "ApprovalExecuted", {
      request_id: row.id,
      action: row.action,
      risk_class: row.risk_class,
      maker_id: row.maker_id,
      state: "executed",
    });
    for (const ob of this.o.observers ?? []) await ob.onExecuted?.(tx, toRecord(next));
    return next;
  }

  private async payloadOf(tx: Tx, row: Row): Promise<Record<string, unknown>> {
    if (row.payload) return row.payload;
    if (!row.payload_enc || !row.payload_key_id || !this.o.fieldCrypto)
      throw new Error("encrypted payload needs FieldCrypto");
    const text = await this.o.fieldCrypto.decryptFieldText(
      tx.ctx.tenantId,
      { enc: new Uint8Array(row.payload_enc), keyId: row.payload_key_id, alg: "aes-256-gcm" },
      { table: "tenancy.approval_request", column: "payload", rowId: row.id },
    );
    const payload = JSON.parse(text) as Record<string, unknown>;
    if (canonicalDigest(payload) !== row.payload_digest)
      throw new Error("approval payload digest mismatch");
    return payload;
  }

  private async load(tx: Tx, id: string, lock: boolean): Promise<Row> {
    const r = await tx.query<Row>(
      `select * from tenancy.approval_request where id = $1${lock ? " for update" : ""}`,
      [id],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundError("approval request");
    return row;
  }

  private async update(tx: Tx, id: string, set: string, extra: unknown[] = []): Promise<Row> {
    const r = await tx.query<Row>(
      `update tenancy.approval_request set ${set} where id = $1 returning *`,
      [id, ...extra],
    );
    return r.rows[0] as Row;
  }

  private async emit(
    tx: Tx,
    event:
      | "ApprovalRequested"
      | "ApprovalDecided"
      | "ApprovalExecuted"
      | "ApprovalCancelled"
      | "ApprovalExpired"
      | "ApprovalEscalated",
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
      ...(tx.ctx.traceId ? { traceId: tx.ctx.traceId } : {}),
    });
    await this.o.outbox.publish(tx, "tenancy", { envelope });
  }
}
