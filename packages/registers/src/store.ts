// The register row store (regulatory templates item (a), part 2; ADR-0016, R1-D-323). Rows are
// versioned: `create` writes version 1, `correct` a new version, and the database never lets a
// version's content change or a row be deleted before its retention date. Every value is checked
// against the register's `RegisterDefinition` before it is written. With `approval`, a change waits
// as a `pending` version until a checker other than the maker approves it (the engine's rule);
// the approval's executor makes it `current` in the same transaction. `history` reads the row's
// versions and its ledger entries. Lists filter on column values with a keyset cursor (IPB-10).
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import {
  RegisterDefinition,
  RegisterError,
  assertRow,
  registerSheet,
  type RegisterColumn,
} from "@infrabyx/contracts/registers";
import { canonicalDigest, newId } from "@infrabyx/crypto";
import {
  ConflictError,
  NotFoundError,
  type ActionPolicy,
  type ApprovalsEngine,
} from "@infrabyx/tenancy";

/** The approval action a register change is checked under; register its checkers on the engine. */
export const REGISTER_ROW_ACTION = "registers.row.change";

export type RegisterRowState = "pending" | "current" | "superseded" | "rejected";

export interface RegisterRowVersion {
  rowId: string;
  version: number;
  registerCode: string;
  definitionVersion: string;
  sheet: string;
  data: Record<string, unknown>;
  dataSha256: string;
  state: RegisterRowState;
  approvalId: string | null;
  retainUntil: Date;
  createdBy: string;
  createdAt: Date;
}

/** One ledger entry about a row, as `AuditService.history` returns it (only what this needs). */
export interface RegisterLedgerEntry {
  action: string;
  actorId: string;
  occurredAt: Date | string;
  [k: string]: unknown;
}

export interface RegisterStoreOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** For maker-checker changes; a store without it refuses `approval`. */
  approvals?: ApprovalsEngine;
  /** The ledger's business-id history (`@infrabyx/audit` `AuditService`), for `history`. */
  ledger?: { history(ctx: KernelContext, businessId: string): Promise<readonly unknown[]> };
  now?: () => Date;
}

export interface RowChangeInput {
  data: Record<string, unknown>;
  /** Maker-checker, where the product's rules ask: a request on `REGISTER_ROW_ACTION`. */
  approval?: { riskClass: "R2" | "R3" | "R4" | "R5"; summary?: string };
}

export interface RegisterListQuery {
  code: string;
  sheet: string;
  /** Exact matches on column values (by key); at most 8. */
  where?: Readonly<Record<string, string | number | boolean>>;
  /** 1 to 200 (default 50). */
  limit?: number;
  cursor?: string;
}

export interface RegisterPage {
  items: RegisterRowVersion[];
  /** Opaque; pass it back as `cursor`. Null when there is none. */
  nextCursor: string | null;
}

interface Row {
  row_id: string;
  version: number;
  register_code: string;
  definition_version: string;
  sheet: string;
  data: Record<string, unknown>;
  data_sha256: string;
  state: RegisterRowState;
  approval_id: string | null;
  retain_until: Date;
  created_by: string;
  created_at: Date;
}

const toVersion = (r: Row): RegisterRowVersion => ({
  rowId: r.row_id,
  version: r.version,
  registerCode: r.register_code,
  definitionVersion: r.definition_version,
  sheet: r.sheet,
  data: r.data,
  dataSha256: r.data_sha256,
  state: r.state,
  approvalId: r.approval_id,
  retainUntil: r.retain_until,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

/** Only the classes the store keeps in its CONFIDENTIAL `data` column (R1-D-323 (3)). */
const STORABLE = new Set<RegisterColumn["dataClass"]>(["PUBLIC", "INTERNAL", "CONFIDENTIAL"]);
const YEAR_MS = 365.25 * 24 * 3_600_000;
const ROW_ID = /^rrw_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const enc = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");
const dec = (s: string): unknown => {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

/** Only the keys the sheet defines, empty values dropped, so the digest is of the row as stored. */
function stored(
  cols: readonly RegisterColumn[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of cols) {
    const v = data[c.key];
    if (v !== undefined && v !== null && v !== "") out[c.key] = v;
  }
  return out;
}

export class RegisterStore {
  private readonly defs = new Map<string, RegisterDefinition>();
  private readonly now: () => Date;

  constructor(private readonly o: RegisterStoreOptions) {
    this.now = o.now ?? (() => new Date());
  }

  /**
   * Register a definition (the latest version per code is the one written with). A definition
   * with a REGULATED column is refused: the store's `data` column is CONFIDENTIAL.
   */
  define(definition: RegisterDefinition): this {
    const d = RegisterDefinition.parse(definition);
    const too = d.sheets.flatMap((s) =>
      s.columns.filter((c) => !STORABLE.has(c.dataClass)).map((c) => `${s.name}.${c.key}`),
    );
    if (too.length)
      throw new RegisterError(
        "definition_invalid",
        too.map((column) => ({ reason: "type", column })),
      );
    this.defs.set(d.code, d);
    return this;
  }

  private def(code: string): RegisterDefinition {
    const d = this.defs.get(code);
    if (!d)
      throw new RegisterError("definition_invalid", [
        { reason: "sheet_unknown", sheet: code, columns: [] },
      ]);
    return d;
  }

  /** The policy to register for `REGISTER_ROW_ACTION`: its executor makes the pending version current. */
  approvalPolicy(base: Omit<ActionPolicy, "execute" | "autoExecute"> = {}): ActionPolicy {
    return {
      ...base,
      autoExecute: true,
      execute: async (tx, payload, request) => {
        const rowId = payload["row_id"];
        const version = payload["version"];
        if (typeof rowId !== "string" || typeof version !== "number")
          throw new ConflictError("not a register row approval");
        const r = await tx.query<Row>(
          "select * from registers.row_version where row_id = $1 and version = $2 for update",
          [rowId, version],
        );
        const row = r.rows[0];
        if (
          !row ||
          row.approval_id !== request.id ||
          request.payloadDigest !== canonicalDigest(approvalPayload(row))
        )
          throw new ConflictError("the approval request does not cover this row version");
        if (row.state !== "pending") return;
        await this.promote(tx, row);
      },
    };
  }

  /** Write a new row (version 1), current at once or pending its approval. */
  async create(
    ctx: KernelContext,
    code: string,
    sheet: string,
    input: RowChangeInput,
  ): Promise<RegisterRowVersion> {
    const d = this.def(code);
    const s = registerSheet(d, sheet);
    assertRow(s, input.data);
    if (input.approval && !this.o.approvals)
      throw new ConflictError("this store has no approvals engine");
    const data = stored(s.columns, input.data);
    const rowId = newId("rrw");
    const retainUntil = new Date(this.now().getTime() + d.retention.years * YEAR_MS);
    return this.o.kernel.mutate(
      ctx,
      async (tx) =>
        this.write(tx, {
          rowId,
          version: 1,
          def: d,
          sheet,
          data,
          retainUntil,
          approval: input.approval,
        }),
      { action: "registers.row.create" },
    );
  }

  /** A correction: a new version of the row, its retention kept from version 1. */
  async correct(
    ctx: KernelContext,
    rowId: string,
    input: RowChangeInput,
  ): Promise<RegisterRowVersion> {
    if (!ROW_ID.test(rowId)) throw new NotFoundError("register row");
    if (input.approval && !this.o.approvals)
      throw new ConflictError("this store has no approvals engine");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<Row>(
          "select * from registers.row_version where row_id = $1 order by version desc for update",
          [rowId],
        );
        const latest = r.rows[0];
        if (!latest) throw new NotFoundError("register row");
        if (r.rows.some((x) => x.state === "pending"))
          throw new ConflictError("a change to this row is awaiting approval");
        const d = this.def(latest.register_code);
        const s = registerSheet(d, latest.sheet);
        assertRow(s, input.data);
        return this.write(tx, {
          rowId,
          version: latest.version + 1,
          def: d,
          sheet: latest.sheet,
          data: stored(s.columns, input.data),
          retainUntil: r.rows[r.rows.length - 1]!.retain_until,
          approval: input.approval,
        });
      },
      { action: "registers.row.correct" },
    );
  }

  /**
   * Bring a pending version in line with its approval: `rejected` when the request was rejected,
   * cancelled or expired. Approval itself arrives through `approvalPolicy`'s executor.
   */
  async refreshApproval(ctx: KernelContext, rowId: string): Promise<RegisterRowVersion | null> {
    if (!this.o.approvals) throw new ConflictError("this store has no approvals engine");
    const pending = (await this.versions(ctx, rowId)).find((v) => v.state === "pending");
    if (!pending?.approvalId) return null;
    const apr = await this.o.approvals.get(ctx, pending.approvalId);
    if (!["rejected", "cancelled", "expired"].includes(apr.state)) return pending;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<Row>(
          `update registers.row_version set state = 'rejected', updated_at = now()
            where row_id = $1 and version = $2 and state = 'pending' returning *`,
          [rowId, pending.version],
        );
        const row = r.rows[0] ?? (await this.lockVersion(tx, rowId, pending.version));
        await this.ledger(tx, "registers.row.reject", row, { approval_state: apr.state });
        return toVersion(row);
      },
      { action: "registers.row.reject" },
    );
  }

  /** The row's current version. */
  async get(ctx: KernelContext, rowId: string): Promise<RegisterRowVersion> {
    const v = (await this.versions(ctx, rowId)).find((x) => x.state === "current");
    if (!v) throw new NotFoundError("register row");
    return v;
  }

  /** Every version of the row, newest first. */
  async versions(ctx: KernelContext, rowId: string): Promise<RegisterRowVersion[]> {
    if (!ROW_ID.test(rowId)) throw new NotFoundError("register row");
    const rows = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<Row>(
            "select * from registers.row_version where row_id = $1 order by version desc",
            [rowId],
          )
        ).rows,
    );
    if (!rows.length) throw new NotFoundError("register row");
    return rows.map(toVersion);
  }

  /** The row's history: its versions (newest first) and its ledger entries (oldest first). */
  async history(
    ctx: KernelContext,
    rowId: string,
  ): Promise<{ versions: RegisterRowVersion[]; ledger: readonly unknown[] }> {
    const versions = await this.versions(ctx, rowId);
    const ledger = this.o.ledger ? await this.o.ledger.history(ctx, rowId) : [];
    return { versions, ledger };
  }

  /** Current rows of one sheet, filtered on column values, by row id, with a keyset cursor. */
  async list(ctx: KernelContext, q: RegisterListQuery): Promise<RegisterPage> {
    const d = this.def(q.code);
    const s = registerSheet(d, q.sheet);
    const limit = q.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new RangeError("limit is 1 to 200");
    const where = Object.entries(q.where ?? {});
    if (where.length > 8) throw new RangeError("at most 8 filters");
    for (const [k, v] of where) {
      const c = s.columns.find((x) => x.key === k);
      if (!c) throw new RegisterError("row_invalid", [{ reason: "unknown_key", column: k }]);
      if (!["string", "number", "boolean"].includes(typeof v))
        throw new RegisterError("row_invalid", [{ reason: "type", column: k }]);
    }
    let after: string | null = null;
    if (q.cursor) {
      const c = dec(q.cursor) as { a?: unknown; c?: unknown; s?: unknown } | null;
      if (!c || typeof c.a !== "string" || c.c !== q.code || c.s !== q.sheet || !ROW_ID.test(c.a))
        throw new RangeError("invalid cursor");
      after = c.a;
    }
    const rows = await this.o.kernel.read(ctx, async (tx) => {
      const params: unknown[] = [q.code, q.sheet, after, limit + 1];
      const filters = where.map(([k, v]) => {
        params.push(JSON.stringify({ [k]: v }));
        return `and data @> $${params.length}::jsonb`;
      });
      return (
        await tx.query<Row>(
          `select * from registers.row_version
            where register_code = $1 and sheet = $2 and state = 'current'
              and ($3::text is null or row_id > $3)
              ${filters.join(" ")}
            order by row_id limit $4`,
          params,
        )
      ).rows;
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(toVersion),
      nextCursor:
        rows.length > limit
          ? enc({ a: page[page.length - 1]!.row_id, c: q.code, s: q.sheet })
          : null,
    };
  }

  // ------------------------------------------------------------------ helpers

  private async write(
    tx: Tx,
    w: {
      rowId: string;
      version: number;
      def: RegisterDefinition;
      sheet: string;
      data: Record<string, unknown>;
      retainUntil: Date;
      approval: RowChangeInput["approval"];
    },
  ): Promise<RegisterRowVersion> {
    const ins = await tx.query<Row>(
      `insert into registers.row_version
         (tenant_id, row_id, version, register_code, definition_version, sheet, data, data_sha256,
          state, retain_until, created_by)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'pending', $9, $10)
       returning *`,
      [
        tx.ctx.tenantId,
        w.rowId,
        w.version,
        w.def.code,
        w.def.version,
        w.sheet,
        JSON.stringify(w.data),
        canonicalDigest(w.data),
        w.retainUntil,
        tx.ctx.principal.id,
      ],
    );
    let row = ins.rows[0]!;
    if (w.approval) {
      const { id } = await this.o.approvals!.request(tx, {
        action: REGISTER_ROW_ACTION,
        riskClass: w.approval.riskClass,
        payload: approvalPayload(row),
        payloadDataClass: "CONFIDENTIAL",
        summary: w.approval.summary ?? `${w.def.code} ${w.sheet}: version ${w.version}`,
      });
      const u = await tx.query<Row>(
        "update registers.row_version set approval_id = $3, updated_at = now() where row_id = $1 and version = $2 returning *",
        [w.rowId, w.version, id],
      );
      row = u.rows[0]!;
      await this.ledger(tx, "registers.row.request", row);
      // The engine may have executed it already (an auto-executed request); read the state back.
      return toVersion(await this.lockVersion(tx, w.rowId, w.version));
    }
    return toVersion(await this.promote(tx, row));
  }

  /** Make a version current: the previous current one becomes superseded. */
  private async promote(tx: Tx, row: Row): Promise<Row> {
    await tx.query(
      `update registers.row_version set state = 'superseded', updated_at = now()
        where row_id = $1 and state = 'current'`,
      [row.row_id],
    );
    const r = await tx.query<Row>(
      `update registers.row_version set state = 'current', updated_at = now()
        where row_id = $1 and version = $2 and state = 'pending' returning *`,
      [row.row_id, row.version],
    );
    const next = r.rows[0]!;
    await this.ledger(
      tx,
      row.version === 1 ? "registers.row.create" : "registers.row.correct",
      next,
    );
    return next;
  }

  private async lockVersion(tx: Tx, rowId: string, version: number): Promise<Row> {
    const r = await tx.query<Row>(
      "select * from registers.row_version where row_id = $1 and version = $2 for update",
      [rowId, version],
    );
    if (!r.rows[0]) throw new NotFoundError("register row");
    return r.rows[0];
  }

  private async ledger(
    tx: Tx,
    action: string,
    row: Row,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.o.audit.record(tx, {
      action,
      resourceType: "register_row",
      resourceId: row.row_id,
      after: {
        register_code: row.register_code,
        sheet: row.sheet,
        version: row.version,
        state: row.state,
        data_sha256: row.data_sha256,
        ...extra,
      },
      businessIds: [row.row_id],
    });
  }
}

/** What a row-change approval binds: the row, its version and the exact data. */
function approvalPayload(
  r: Pick<Row, "row_id" | "version" | "register_code" | "sheet" | "data_sha256">,
) {
  return {
    row_id: r.row_id,
    version: r.version,
    register_code: r.register_code,
    sheet: r.sheet,
    data_sha256: r.data_sha256,
  };
}
