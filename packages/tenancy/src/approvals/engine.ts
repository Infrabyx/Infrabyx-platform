// Maker-checker engine (IPB-02 §02.4.2, §02.4.6.1; PL1-D-02/D-01). PL3 `workflow` adds Temporal
// timers, SLAs and the Work Inbox on top of this table-backed engine.
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

export type ApprovalState = "pending" | "approved" | "rejected" | "cancelled" | "executed";
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
}

export interface ApprovalsEngineOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  outbox?: OutboxWriter;
  fieldCrypto?: FieldCrypto;
  pseudonymKey?: SecretKey;
}

const DEFAULT_TENANT_CHECKERS = ["ORG_CHECKER", "ORG_ADMIN", "ORG_OWNER"];
const DEFAULT_PLATFORM_CHECKERS = ["PLT_SECURITY_OFFICER", "PLT_SUPER_ADMIN"];
const CANCEL_ROLES = ["ORG_OWNER"];

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
}

const toRecord = (r: Row): ApprovalRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  action: r.action,
  riskClass: r.risk_class,
  payloadDigest: r.payload_digest,
  payloadClass: r.payload_class,
  summary: r.summary,
  makerId: r.maker_id,
  state: r.state,
  requiredCheckers: r.required_checkers,
  delayMinutes: r.delay_minutes,
  approvedAt: r.approved_at,
  delayUntil: r.delay_until,
  executedAt: r.executed_at,
});

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
          summary, maker_id, maker_type, required_checkers, delay_minutes)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
        risk.checkers,
        delay,
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
        if (row.state !== "pending") throw new ConflictError(`approval ${id} is ${row.state}`);
        if (row.maker_id === ctx.principal.id)
          throw new IpbError("IPB-SEC-007", { meta: { request_id: id } });
        this.assertChecker(ctx, row.action);
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
        if (row.state !== "pending" && row.state !== "approved")
          throw new ConflictError(`approval ${id} is ${row.state}`);
        const may =
          row.maker_id === ctx.principal.id ||
          ctx.principal.roles.some((r) => CANCEL_ROLES.includes(r));
        if (!may)
          throw new IpbError("IPB-UX-011", { detail: "only the maker or ORG_OWNER may cancel" });
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
        return toRecord(next);
      },
      { action: "approvals.request.cancel" },
    );
  }

  private assertChecker(ctx: KernelContext, action: string): void {
    const platform = ctx.scope === "platform";
    const allowed =
      this.policies.get(action)?.checkerRoles ??
      (platform ? DEFAULT_PLATFORM_CHECKERS : DEFAULT_TENANT_CHECKERS);
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
    event: "ApprovalRequested" | "ApprovalDecided" | "ApprovalExecuted" | "ApprovalCancelled",
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
