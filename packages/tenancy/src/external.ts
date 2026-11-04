// External read access (Finbyx PR-FBX-10 item 5; IPB-02-12; IPB-08-19 for the grant's shape;
// R1-D-29; tenancy/0010). A named external grantee (statutory auditor, IS auditor, RBI inspector,
// SEBI, IRDAI, internal auditor; since tenancy/0016 also the kinds of LawDocsComply PR-LDC-07,
// R1-D-75) reads one tenant's data under one grant: the entities, the branches and the period it
// covers, time-boxed to at most 90 days. An ORG_OWNER or ORG_ADMIN requests the grant and a second
// one approves it before it is active (maker-checker; R1-D-29, OWNER-QUESTIONS #92); either may
// revoke it at once. The grantee reads only through `ExternalReads`, as the SELECT-only
// `app_external` role under the products' restrictive policies, and every read is ledgered in the
// tenant.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import { ConflictError, NotFoundError } from "./errors.js";
import { externalGate } from "./external-gate.js";
import { EXTERNAL_READ_ACTION } from "./kernel.js";

export const EXTERNAL_GRANT_MAX_DAYS = 90;
export const EXTERNAL_GRANT_DEFAULT_DAYS = 30;
export const EXTERNAL_GRANTEE_KINDS = [
  "statutory_auditor",
  "internal_auditor",
  "is_auditor",
  "rbi_inspector",
  "sebi",
  "irdai",
  // LawDocsComply PR-LDC-07 (R1-D-75; tenancy/0016): other regulators and inspectors, and the
  // auditors of companies and co-operatives. Same ceiling, approval and read-only rules.
  "nhb",
  "nabard",
  "ifsca",
  "roc_inspector",
  "rcs_inspector",
  "crcs_inspector",
  "secretarial_auditor",
  "tax_auditor",
  "concurrent_auditor",
  "cooperative_auditor",
] as const;
export type ExternalGranteeKind = (typeof EXTERNAL_GRANTEE_KINDS)[number];

const MANAGER_ROLES = ["ORG_OWNER", "ORG_ADMIN"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TABLE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface ExternalGrantRequest {
  granteeId: string;
  granteeName: string;
  organisation: string;
  kind: ExternalGranteeKind;
  /** Why the grantee needs the data (10 to 500 characters). */
  purpose: string;
  /** Legal entities of the tenant the grant covers (1 to 100). */
  entityIds: readonly string[];
  /** Branches it covers; omitted, every branch of those entities. */
  branchIds?: readonly string[];
  /** The period of the records it covers (`YYYY-MM-DD`, inclusive). */
  periodFrom: string;
  periodTo: string;
  /** Days the grant lasts once approved (default 30, at most 90). */
  days?: number;
}

/** How much personal data an external grantee may see (R1-D-40). */
export type ExternalPiiLevel = "none" | "masked" | "full";

/** A grant a product opens from its own approved register (Finbyx PR-FBX-22, R1-D-40). */
export interface ApprovedExternalGrant extends Omit<ExternalGrantRequest, "days"> {
  /** The product's own approval or register id; one grant per id in a tenant. */
  sourceApprovalId: string;
  /** The product's maker and the checker who approved (different people). */
  makerId: string;
  checkerId: string;
  /** Days the grant lasts from now (1 to 90). */
  days: number;
  piiLevel: ExternalPiiLevel;
  exportAllowed: boolean;
}

export interface ExternalGrant {
  id: string;
  granteeId: string;
  granteeName: string;
  organisation: string;
  kind: ExternalGranteeKind;
  purpose: string;
  entityIds: string[];
  branchIds: string[] | null;
  periodFrom: string;
  periodTo: string;
  durationDays: number;
  state: "requested" | "active" | "revoked";
  requestedBy: string;
  approvedBy: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  source: "platform" | "product";
  sourceApprovalId: string | null;
  piiLevel: ExternalPiiLevel;
  exportAllowed: boolean;
}

interface Row {
  id: string;
  grantee_id: string;
  grantee_name: string;
  organisation: string;
  kind: ExternalGranteeKind;
  purpose: string;
  entity_ids: string[];
  branch_ids: string[] | null;
  period_from: string;
  period_to: string;
  duration_days: number;
  state: ExternalGrant["state"];
  requested_by: string;
  approved_by: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  source: "platform" | "product";
  source_approval_id: string | null;
  pii_level: ExternalPiiLevel;
  export_allowed: boolean;
}
const COLUMNS = `id, grantee_id, grantee_name, organisation, kind, purpose, entity_ids, branch_ids,
  to_char(period_from, 'YYYY-MM-DD') as period_from, to_char(period_to, 'YYYY-MM-DD') as period_to,
  duration_days, state, requested_by, approved_by, expires_at, revoked_at,
  source, source_approval_id, pii_level, export_allowed`;
const toGrant = (r: Row): ExternalGrant => ({
  id: r.id,
  granteeId: r.grantee_id,
  granteeName: r.grantee_name,
  organisation: r.organisation,
  kind: r.kind,
  purpose: r.purpose,
  entityIds: r.entity_ids,
  branchIds: r.branch_ids,
  periodFrom: r.period_from,
  periodTo: r.period_to,
  durationDays: r.duration_days,
  state: r.state,
  requestedBy: r.requested_by,
  approvedBy: r.approved_by,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  source: r.source,
  sourceApprovalId: r.source_approval_id,
  piiLevel: r.pii_level,
  exportAllowed: r.export_allowed,
});

function assertManager(ctx: KernelContext): void {
  if (ctx.scope === "platform" || ctx.principal.type !== "user")
    throw new IpbError("IPB-SEC-005", {
      detail: "external grants are managed in the tenant by its named users",
    });
  if (!ctx.principal.roles.some((r) => MANAGER_ROLES.includes(r)))
    throw new IpbError("IPB-UX-011", { detail: `needs one of ${MANAGER_ROLES.join(", ")}` });
}

export interface ExternalGrantsOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** A lower ceiling for the grant's days; never above 90. */
  maxDays?: number;
}

export class ExternalGrants {
  constructor(private readonly o: ExternalGrantsOptions) {}

  async request(ctx: KernelContext, req: ExternalGrantRequest): Promise<ExternalGrant> {
    assertManager(ctx);
    const max = Math.min(this.o.maxDays ?? EXTERNAL_GRANT_MAX_DAYS, EXTERNAL_GRANT_MAX_DAYS);
    const days = req.days ?? Math.min(EXTERNAL_GRANT_DEFAULT_DAYS, max);
    if (!(Number.isInteger(days) && days >= 1 && days <= max))
      throw new RangeError(`an external grant lasts 1–${max} days`);
    if (!EXTERNAL_GRANTEE_KINDS.includes(req.kind))
      throw new RangeError(`unknown grantee kind ${req.kind}`);
    if (!DATE.test(req.periodFrom) || !DATE.test(req.periodTo) || req.periodFrom > req.periodTo)
      throw new RangeError("the grant's period is two dates, from no later than to");
    const entities = [...new Set(req.entityIds)];
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const known = await tx.query<{ n: number }>(
          "select count(*)::int as n from tenancy.legal_entity where id = any($1::text[])",
          [entities],
        );
        if (entities.length === 0 || known.rows[0]?.n !== entities.length)
          throw new NotFoundError("legal entity");
        const id = newId("xgr");
        const r = await tx.query<Row>(
          `insert into tenancy.external_grant
             (id, tenant_id, grantee_id, grantee_name, organisation, kind, purpose, entity_ids,
              branch_ids, period_from, period_to, duration_days, requested_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning ${COLUMNS}`,
          [
            id,
            ctx.tenantId,
            req.granteeId,
            req.granteeName,
            req.organisation,
            req.kind,
            req.purpose,
            entities,
            req.branchIds?.length ? [...new Set(req.branchIds)] : null,
            req.periodFrom,
            req.periodTo,
            days,
            ctx.principal.id,
          ],
        );
        await this.o.audit.record(tx, {
          action: "security.external_grant.request",
          resourceType: "external_grant",
          resourceId: id,
          after: {
            grantee_id: req.granteeId,
            kind: req.kind,
            entity_ids: entities,
            branch_ids: req.branchIds ?? null,
            period: [req.periodFrom, req.periodTo],
            days,
          },
        });
        return toGrant(r.rows[0] as Row);
      },
      { action: "security.external_grant.request" },
    );
  }

  /** The second person's approval starts the grant's days; the requester's own is refused. */
  async approve(ctx: KernelContext, id: string): Promise<ExternalGrant> {
    assertManager(ctx);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id);
        if (row.requested_by === ctx.principal.id)
          throw new IpbError("IPB-TRUST-005", { meta: { grant_id: id } });
        if (row.state !== "requested") throw new ConflictError(`grant ${id} is ${row.state}`);
        const r = await tx.query<Row>(
          `update tenancy.external_grant
              set state = 'active', approved_by = $2, approved_at = now(),
                  expires_at = now() + make_interval(days => duration_days)
            where id = $1 returning ${COLUMNS}`,
          [id, ctx.principal.id],
        );
        const g = toGrant(r.rows[0] as Row);
        await this.o.audit.record(tx, {
          action: "security.external_grant.approve",
          resourceType: "external_grant",
          resourceId: id,
          after: { expires_at: g.expiresAt?.toISOString() },
        });
        return g;
      },
      { action: "security.external_grant.approve" },
    );
  }

  /** Revocation is immediate: the grantee's next transaction is refused (IPB-TRUST-003). */
  async revoke(ctx: KernelContext, id: string): Promise<ExternalGrant> {
    assertManager(ctx);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row = await this.load(tx, id);
        if (row.state === "revoked") throw new ConflictError(`grant ${id} is revoked`);
        const r = await tx.query<Row>(
          `update tenancy.external_grant set state = 'revoked', revoked_by = $2, revoked_at = now()
            where id = $1 returning ${COLUMNS}`,
          [id, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "security.external_grant.revoke",
          resourceType: "external_grant",
          resourceId: id,
          before: { state: row.state },
          after: { state: "revoked" },
        });
        return toGrant(r.rows[0] as Row);
      },
      { action: "security.external_grant.revoke" },
    );
  }

  /**
   * Open an active grant from the product's own approved register, inside the transaction of the
   * product's executor (Finbyx PR-FBX-22, R1-D-40). The product's maker-checker replaces the
   * platform's ORG_OWNER/ORG_ADMIN pair: `makerId` and `checkerId` must differ, and the product's
   * approval id is kept, once per tenant (a second call with it returns the first grant).
   */
  async fromApproved(tx: Tx, g: ApprovedExternalGrant): Promise<ExternalGrant> {
    const ctx = tx.ctx;
    if (
      ctx.scope === "platform" ||
      ctx.principal.type === "agent" ||
      ctx.principal.type === "external"
    )
      throw new IpbError("IPB-SEC-005", {
        detail: "a product opens external grants in its tenant",
      });
    if (!(Number.isInteger(g.days) && g.days >= 1 && g.days <= EXTERNAL_GRANT_MAX_DAYS))
      throw new RangeError(`an external grant lasts 1–${EXTERNAL_GRANT_MAX_DAYS} days`);
    if (!EXTERNAL_GRANTEE_KINDS.includes(g.kind))
      throw new RangeError(`unknown grantee kind ${g.kind}`);
    if (!["none", "masked", "full"].includes(g.piiLevel)) throw new RangeError("invalid PII level");
    if (!DATE.test(g.periodFrom) || !DATE.test(g.periodTo) || g.periodFrom > g.periodTo)
      throw new RangeError("the grant's period is two dates, from no later than to");
    if (!g.makerId || g.makerId === g.checkerId)
      throw new IpbError("IPB-TRUST-005", {
        detail: "the product's maker and checker must differ",
      });
    const prior = await tx.query<Row>(
      `select ${COLUMNS} from tenancy.external_grant where tenant_id = $1 and source_approval_id = $2`,
      [ctx.tenantId, g.sourceApprovalId],
    );
    if (prior.rows[0]) return toGrant(prior.rows[0]);
    const entities = [...new Set(g.entityIds)];
    const known = await tx.query<{ n: number }>(
      "select count(*)::int as n from tenancy.legal_entity where id = any($1::text[])",
      [entities],
    );
    if (entities.length === 0 || known.rows[0]?.n !== entities.length)
      throw new NotFoundError("legal entity");
    const id = newId("xgr");
    const r = await tx.query<Row>(
      `insert into tenancy.external_grant
         (id, tenant_id, grantee_id, grantee_name, organisation, kind, purpose, entity_ids, branch_ids,
          period_from, period_to, duration_days, state, requested_by, approved_by, approved_at, expires_at,
          source, source_approval_id, pii_level, export_allowed)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13, $14, now(),
               now() + make_interval(days => $12), 'product', $15, $16, $17)
       returning ${COLUMNS}`,
      [
        id,
        ctx.tenantId,
        g.granteeId,
        g.granteeName,
        g.organisation,
        g.kind,
        g.purpose,
        entities,
        g.branchIds?.length ? [...new Set(g.branchIds)] : null,
        g.periodFrom,
        g.periodTo,
        g.days,
        g.makerId,
        g.checkerId,
        g.sourceApprovalId,
        g.piiLevel,
        g.exportAllowed,
      ],
    );
    const out = toGrant(r.rows[0] as Row);
    await tx.query(
      `insert into tenancy.external_grant_source (tenant_id, source_approval_id, grant_id)
       values ($1, $2, $3)`,
      [ctx.tenantId, g.sourceApprovalId, id],
    );
    await this.o.audit.record(tx, {
      action: "security.external_grant.from_approved",
      resourceType: "external_grant",
      resourceId: id,
      after: {
        source_approval_id: g.sourceApprovalId,
        grantee_id: g.granteeId,
        kind: g.kind,
        entity_ids: entities,
        branch_ids: g.branchIds ?? null,
        period: [g.periodFrom, g.periodTo],
        days: g.days,
        pii_level: g.piiLevel,
        export_allowed: g.exportAllowed,
        maker_id: g.makerId,
        checker_id: g.checkerId,
      },
    });
    return out;
  }

  /** Revoke the grant a product opened for one of its approvals, in the product's transaction. */
  async revokeFromApproved(
    tx: Tx,
    sourceApprovalId: string,
    revokedBy: string,
  ): Promise<ExternalGrant | null> {
    const r = await tx.query<Row>(
      `update tenancy.external_grant set state = 'revoked', revoked_by = $3, revoked_at = now()
        where tenant_id = $1 and source_approval_id = $2 and state <> 'revoked' returning ${COLUMNS}`,
      [tx.ctx.tenantId, sourceApprovalId, revokedBy],
    );
    const row = r.rows[0];
    if (!row) return null;
    await this.o.audit.record(tx, {
      action: "security.external_grant.revoke",
      resourceType: "external_grant",
      resourceId: row.id,
      after: { state: "revoked", source_approval_id: sourceApprovalId },
    });
    return toGrant(row);
  }

  async list(ctx: KernelContext): Promise<ExternalGrant[]> {
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<Row>(
          `select ${COLUMNS} from tenancy.external_grant order by requested_at desc, id`,
        )
      ).rows.map(toGrant),
    );
  }

  private async load(tx: Tx, id: string): Promise<Row> {
    const r = await tx.query<Row>(
      `select ${COLUMNS} from tenancy.external_grant where id = $1 for update`,
      [id],
    );
    if (!r.rows[0]) throw new NotFoundError("external grant");
    return r.rows[0];
  }
}

export interface ExternalReadsOptions {
  kernel: MutationKernel;
  audit: AuditSink;
}

/**
 * The one way an external principal reads. Each call runs one query as `app_external` and then
 * ledgers it in the tenant (`platform.external_read`, resource `<grant>/<table>`, with the row
 * count); the rows are returned only once the entry is written.
 */
export class ExternalReads {
  constructor(private readonly o: ExternalReadsOptions) {}

  async read<R extends Record<string, unknown>>(
    ctx: KernelContext,
    table: string,
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<R[]> {
    if (ctx.principal.type !== "external" || !ctx.externalGrantId)
      throw new IpbError("IPB-SEC-005", { detail: "ExternalReads is for external principals" });
    if (!TABLE.test(table)) throw new RangeError(`invalid table ${table}`);
    if (!new RegExp(`\\bfrom\\s+${table.replace(".", "\\.")}\\b`, "i").test(sql))
      throw new Error(`the query does not read ${table}`);
    const rows = await this.o.kernel.read(
      ctx,
      externalGate(async (tx: Tx) => (await tx.query<R>(sql, params)).rows),
    );
    const grantId = ctx.externalGrantId;
    await this.o.kernel.mutate(
      ctx,
      externalGate(async (tx: Tx) => {
        await this.o.audit.record(tx, {
          action: EXTERNAL_READ_ACTION,
          resourceType: "external_read",
          resourceId: `${grantId}/${table}`,
          after: { grant_id: grantId, table, rows: rows.length },
        });
      }),
      { action: EXTERNAL_READ_ACTION },
    );
    return rows;
  }
}
