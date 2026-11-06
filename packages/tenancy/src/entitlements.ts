// Tenant entitlements (Finbyx PR-FBX-43; OWNER-QUESTIONS #123; R1-D-107; tenancy/0020): the licence
// of a SKU for a tenant, with its dates, until the Operations Hub issues entitlements (OH8, Phase
// 16e). A change is a request and an approval by two different people, both ledgered:
//   * requested (`request`) by a PLT_SUPER_ADMIN or PLT_FINANCE (a commercial change);
//   * approved (`decide`) by a different PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER, never the
//     requester; never a tenant user, a support role or anyone impersonating;
//   * R3 for a tenant of a non-production deployment, R4 (a 60-minute delay) in production (as the
//     sandbox flag, #118); then applied once (`apply`), which writes the new version.
// The tenant is told of every grant, revocation and lapse (`tenancy.entitlement_notice`, and the
// `onNotice` hook in the same transaction) and sees them (`forTenant`). A lapsed or revoked licence
// refuses writes (`assertWritableIn`) and keeps every record readable until the product's detach
// workflow.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AppEnv } from "@infrabyx/contracts/env";
import { isTenantId, PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import {
  EntitlementChangeInput,
  type EntitlementNoticeKind,
  type EntitlementStatus,
  type EntitlementVersion,
  LicenceSku,
} from "@infrabyx/contracts/module-lifecycle";
import { newId } from "@infrabyx/crypto";
import type { ApprovalRecord, ApprovalsEngine } from "./approvals/engine.js";
import { NotFoundError } from "./errors.js";
import { sandboxChangeRisk } from "./sandbox.js";

export const ENTITLEMENT_CHANGE_ACTION = "tenancy.entitlement.change";
export const ENTITLEMENT_REQUEST_ACTION = "tenancy.entitlement.request";
export const ENTITLEMENT_LAPSE_ACTION = "tenancy.entitlement.lapse";
/** Who raises a licence change (#123). */
export const ENTITLEMENT_REQUESTER_ROLES: readonly string[] = ["PLT_SUPER_ADMIN", "PLT_FINANCE"];
/** Who approves it: a different person from the requester (#123). */
export const ENTITLEMENT_APPROVER_ROLES: readonly string[] = [
  "PLT_SUPER_ADMIN",
  "PLT_SECURITY_OFFICER",
];

export interface EntitlementNotice {
  id: string;
  entitlementId: string;
  sku: string;
  kind: EntitlementNoticeKind;
  version: number;
  validFrom: string;
  validUntil: string | null;
  noticedAt: string;
}

/** A write refused because the tenant's licence is not active (403; reads are never refused). */
export class EntitlementRefusal extends Error {
  readonly status = 403;
  readonly code = "not_entitled" as const;
  constructor(
    readonly sku: string,
    readonly entitlementStatus: EntitlementStatus,
  ) {
    super(
      `the tenant's ${sku} licence is ${entitlementStatus}: records stay readable, writes are refused`,
    );
    this.name = "EntitlementRefusal";
  }
}

export interface TenantEntitlementsOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The approvals engine every change goes through; without it nothing can change. */
  approvals?: ApprovalsEngine;
  /** This deployment's APP_ENV: R4 in production (`prod`, `dr`, `pre-prod`) or when not given, else R3. */
  appEnv?: AppEnv;
  /** Tell the tenant (NOTIFY, an outbox event): runs in the transaction that records the notice. */
  onNotice?: (tx: Tx, notice: EntitlementNotice) => Promise<void>;
}

const VERSION_COLUMNS = `id, sku, version, kind, valid_from::text as valid_from,
  valid_until::text as valid_until, reason, requested_by, approved_by, approval_id,
  recorded_at::text as recorded_at`;
const NOTICE_COLUMNS = `id, entitlement_id, sku, kind, version, valid_from::text as valid_from,
  valid_until::text as valid_until, noticed_at::text as noticed_at`;

const toVersion = (x: Record<string, unknown>): EntitlementVersion => ({
  id: String(x.id),
  sku: String(x.sku),
  version: Number(x.version),
  kind: x.kind as "GRANT" | "REVOKE",
  validFrom: String(x.valid_from),
  validUntil: (x.valid_until as string | null) ?? null,
  reason: String(x.reason),
  requestedBy: String(x.requested_by),
  approvedBy: String(x.approved_by),
  approvalId: String(x.approval_id),
  recordedAt: String(x.recorded_at),
});
const toNotice = (x: Record<string, unknown>): EntitlementNotice => ({
  id: String(x.id),
  entitlementId: String(x.entitlement_id),
  sku: String(x.sku),
  kind: x.kind as EntitlementNoticeKind,
  version: Number(x.version),
  validFrom: String(x.valid_from),
  validUntil: (x.valid_until as string | null) ?? null,
  noticedAt: String(x.noticed_at),
});

const refuse = (detail: string) => new IpbError("IPB-SEC-005", { detail });

export class TenantEntitlements {
  constructor(private readonly o: TenantEntitlementsOptions) {
    o.approvals?.register(ENTITLEMENT_CHANGE_ACTION, {
      checkerRoles: ENTITLEMENT_APPROVER_ROLES,
      platformCheckerRoles: ENTITLEMENT_APPROVER_ROLES,
      autoExecute: false,
    });
  }

  /** Raise a grant or a revocation of a SKU for a tenant (PLT_SUPER_ADMIN or PLT_FINANCE). */
  async request(
    caller: KernelContext,
    tenantId: string,
    input: unknown,
  ): Promise<{ requestId: string }> {
    this.assertPerson(caller, ENTITLEMENT_REQUESTER_ROLES, "raised");
    const change = EntitlementChangeInput.parse(input);
    const approvals = this.engine();
    return this.o.kernel.mutate(
      this.contextFor(caller, tenantId),
      async (tx) => {
        const t = await tx.query("select 1 from tenancy.tenant where id = $1", [tenantId]);
        if (!t.rowCount) throw new NotFoundError("tenant");
        const last = await this.latestIn(tx, change.sku);
        const { id } = await approvals.request(tx, {
          action: ENTITLEMENT_CHANGE_ACTION,
          riskClass: sandboxChangeRisk(this.o.appEnv),
          payload: { tenant_id: tenantId, change, requested_by: caller.principal.id },
          summary: `${change.kind === "GRANT" ? "Grant" : "Revoke"} the ${change.sku} licence of ${tenantId} from ${change.validFrom}${change.validUntil ? ` to ${change.validUntil}` : ""}`,
          diff: {
            before: last
              ? {
                  version: last.version,
                  kind: last.kind,
                  valid_from: last.validFrom,
                  valid_until: last.validUntil,
                }
              : null,
            after: {
              kind: change.kind,
              valid_from: change.validFrom,
              valid_until: change.validUntil ?? null,
            },
          },
        });
        await this.o.audit.record(tx, {
          action: ENTITLEMENT_REQUEST_ACTION,
          resourceType: "entitlement_request",
          resourceId: id,
          after: { sku: change.sku, kind: change.kind, requested_by: caller.principal.id },
        });
        return { requestId: id };
      },
      { action: ENTITLEMENT_REQUEST_ACTION, reason: change.reason },
    );
  }

  /** Approve or reject (a PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER other than the requester). */
  async decide(
    caller: KernelContext,
    tenantId: string,
    requestId: string,
    decision: "approve" | "reject",
    reason?: string,
  ): Promise<ApprovalRecord> {
    this.assertPerson(caller, ENTITLEMENT_APPROVER_ROLES, "approved");
    return this.engine().decide(this.contextFor(caller, tenantId), requestId, decision, reason);
  }

  /**
   * Apply an approved change once (after the R4 delay in production): the new version, the
   * tenant's notice and the ledger entry in one `tenancy.entitlement.change` transaction.
   */
  async apply(
    caller: KernelContext,
    tenantId: string,
    requestId: string,
  ): Promise<EntitlementVersion> {
    this.assertPerson(
      caller,
      [...new Set([...ENTITLEMENT_REQUESTER_ROLES, ...ENTITLEMENT_APPROVER_ROLES])],
      "applied",
    );
    const approvals = this.engine();
    return this.o.kernel.mutate(
      this.contextFor(caller, tenantId),
      async (tx) => {
        const { payload, record } = await approvals.consumeIn(
          tx,
          requestId,
          ENTITLEMENT_CHANGE_ACTION,
        );
        if (payload.tenant_id !== tenantId) throw refuse("the approval is for another tenant");
        const change = EntitlementChangeInput.parse(payload.change);
        const approver = await tx.query<{ checker_id: string }>(
          `select checker_id from tenancy.approval_decision
            where request_id = $1 and decision = 'approve' order by decided_at desc limit 1`,
          [requestId],
        );
        const approvedBy = approver.rows[0]?.checker_id;
        if (!approvedBy || approvedBy === record.makerId)
          throw new IpbError("IPB-SEC-007", { meta: { request_id: requestId } });
        const last = await this.latestIn(tx, change.sku);
        const id = newId("lic");
        await tx.query(
          `insert into tenancy.entitlement (id, tenant_id, sku, version, kind, valid_from, valid_until,
             reason, requested_by, approved_by, approval_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id,
            tenantId,
            change.sku,
            (last?.version ?? 0) + 1,
            change.kind,
            change.validFrom,
            change.validUntil ?? null,
            change.reason,
            record.makerId,
            approvedBy,
            requestId,
          ],
        );
        const v = (await this.latestIn(tx, change.sku))!;
        await this.o.audit.record(tx, {
          action: ENTITLEMENT_CHANGE_ACTION,
          resourceType: "entitlement",
          resourceId: id,
          before: last ? { version: last.version, kind: last.kind } : undefined,
          after: {
            sku: v.sku,
            version: v.version,
            kind: v.kind,
            valid_from: v.validFrom,
            valid_until: v.validUntil,
            requested_by: v.requestedBy,
            approved_by: v.approvedBy,
            approval_request_id: requestId,
          },
        });
        await this.notice(tx, v, v.kind);
        return v;
      },
      { action: ENTITLEMENT_CHANGE_ACTION },
    );
  }

  /** Every version of a tenant's licences, newest first (a platform person). */
  async history(caller: KernelContext, tenantId: string): Promise<EntitlementVersion[]> {
    this.assertPerson(
      caller,
      [...new Set([...ENTITLEMENT_REQUESTER_ROLES, ...ENTITLEMENT_APPROVER_ROLES])],
      "read",
    );
    return this.o.kernel.read(this.contextFor(caller, tenantId), async (tx) =>
      (
        await tx.query(
          `select ${VERSION_COLUMNS} from tenancy.entitlement order by sku, version desc limit 500`,
        )
      ).rows.map(toVersion),
    );
  }

  /** The tenant's own view, for its admin page: each SKU's latest version and status, and every notice. */
  async forTenant(ctx: KernelContext): Promise<{
    licences: Array<EntitlementVersion & { status: EntitlementStatus }>;
    notices: EntitlementNotice[];
  }> {
    return this.o.kernel.read(ctx, async (tx) => {
      const latest = await tx.query(
        `select distinct on (sku) ${VERSION_COLUMNS} from tenancy.entitlement order by sku, version desc`,
      );
      const licences = [];
      for (const row of latest.rows) {
        const v = toVersion(row);
        licences.push({ ...v, status: await this.statusIn(tx, v.sku) });
      }
      const notices = (
        await tx.query(
          `select ${NOTICE_COLUMNS} from tenancy.entitlement_notice order by noticed_at desc, id desc limit 500`,
        )
      ).rows.map(toNotice);
      return { licences, notices };
    });
  }

  /** The transaction's tenant's status of a SKU today (India time). */
  async statusIn(tx: Tx, sku: string): Promise<EntitlementStatus> {
    const r = await tx.query<{ s: EntitlementStatus }>(
      "select tenancy.entitlement_status($1) as s",
      [LicenceSku.parse(sku)],
    );
    return r.rows[0]!.s;
  }

  /** Refuse a write unless the licence is ACTIVE; reads never ask this. */
  async assertWritableIn(tx: Tx, sku: string): Promise<void> {
    const s = await this.statusIn(tx, sku);
    if (s !== "ACTIVE") throw new EntitlementRefusal(sku, s);
  }

  /** The transaction's tenant's latest version of a SKU, or null. */
  async latestIn(tx: Tx, sku: string): Promise<EntitlementVersion | null> {
    const r = await tx.query(
      `select ${VERSION_COLUMNS} from tenancy.entitlement where sku = $1 order by version desc limit 1`,
      [sku],
    );
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }

  /**
   * The lapse sweep (a platform context, e.g. the product's scheduled service principal): one LAPSE
   * notice per grant that has ended, each in its tenant's own ledgered transaction. Returns how many.
   */
  async recordLapses(caller: KernelContext): Promise<number> {
    if (caller.scope !== "platform" || caller.act)
      throw refuse("the lapse sweep runs in a platform context");
    const due = await this.o.kernel.read(
      caller,
      async (tx) =>
        (
          await tx.query<{ tenant_id: string; entitlement_id: string }>(
            "select tenant_id, entitlement_id from tenancy.entitlement_lapses_due()",
          )
        ).rows,
    );
    let n = 0;
    for (const d of due)
      n += await this.o.kernel.mutate(
        this.contextFor(caller, d.tenant_id),
        async (tx) => {
          const r = await tx.query(
            `select ${VERSION_COLUMNS} from tenancy.entitlement where id = $1`,
            [d.entitlement_id],
          );
          if (!r.rows[0]) return 0;
          const v = toVersion(r.rows[0]);
          const added = await this.notice(tx, v, "LAPSE");
          if (added)
            await this.o.audit.record(tx, {
              action: ENTITLEMENT_LAPSE_ACTION,
              resourceType: "entitlement",
              resourceId: v.id,
              after: { sku: v.sku, version: v.version, valid_until: v.validUntil },
            });
          return added ? 1 : 0;
        },
        { action: ENTITLEMENT_LAPSE_ACTION },
      );
    return n;
  }

  private async notice(
    tx: Tx,
    v: EntitlementVersion,
    kind: EntitlementNoticeKind,
  ): Promise<boolean> {
    const r = await tx.query(
      `insert into tenancy.entitlement_notice (id, tenant_id, entitlement_id, sku, kind, version, valid_from, valid_until)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (entitlement_id, kind) do nothing
       returning ${NOTICE_COLUMNS}`,
      [newId("lcn"), tx.ctx.tenantId, v.id, v.sku, kind, v.version, v.validFrom, v.validUntil],
    );
    if (!r.rows[0]) return false;
    await this.o.onNotice?.(tx, toNotice(r.rows[0]));
    return true;
  }

  private engine(): ApprovalsEngine {
    if (!this.o.approvals)
      throw refuse("a licence changes only under two-person approval (no approvals engine)");
    return this.o.approvals;
  }

  /** A person (never a service, an agent or an impersonation) of the platform holding one of `roles`. */
  private assertPerson(caller: KernelContext, roles: readonly string[], what: string): void {
    if (
      caller.scope !== "platform" ||
      caller.tenantId !== PLATFORM_TENANT_ID ||
      caller.principal.type !== "user" ||
      caller.act ||
      !caller.principal.roles.some((r) => roles.includes(r))
    )
      throw refuse(
        `a licence change is ${what} only by ${roles.join(" or ")}, in person, from the platform (#123)`,
      );
  }

  /** The tenant's own context, platform-scoped, so the request and ledger entries land there. */
  private contextFor(caller: KernelContext, tenantId: string): KernelContext {
    if (!isTenantId(tenantId))
      throw new RangeError("a tenant id is tnt_ followed by letters and digits");
    const ctx: KernelContext = { ...caller, tenantId, scope: "platform" };
    delete ctx.entityId;
    delete ctx.branchId;
    delete ctx.branchIds;
    delete ctx.allBranches;
    return ctx;
  }
}
