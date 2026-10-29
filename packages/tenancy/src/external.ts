// External read access (Finbyx PR-FBX-10 item 5; IPB-02-12; IPB-08-19 for the grant's shape;
// R1-D-29; tenancy/0010). A named external grantee (statutory auditor, IS auditor, RBI inspector,
// SEBI, IRDAI, internal auditor) reads one tenant's data under one grant: the entities, the branches
// and the period it covers, time-boxed to at most 90 days. An ORG_OWNER or ORG_ADMIN requests the
// grant and a second one approves it before it is active (maker-checker; R1-D-29, OWNER-QUESTIONS
// #92); either may revoke it at once. The grantee reads only through `ExternalReads`, as the
// SELECT-only `app_external` role under the products' restrictive policies, and every read is
// ledgered in the tenant.
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
}
const COLUMNS = `id, grantee_id, grantee_name, organisation, kind, purpose, entity_ids, branch_ids,
  to_char(period_from, 'YYYY-MM-DD') as period_from, to_char(period_to, 'YYYY-MM-DD') as period_to,
  duration_days, state, requested_by, approved_by, expires_at, revoked_at`;
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
