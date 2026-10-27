// The export snapshot (PL3 plan §7.2–7.3): one read-only kernel transaction in the tenant's context
// reads every mapped entity's columns (with their data class), rows and foreign keys, then counts
// each table again in the same REPEATABLE READ snapshot; any difference from the rows read fails the job (IPB-EXP-003), so the control
// totals in the manifest are reconciled to the live system at the snapshot instant.
import { IpbError } from "@infrabyx/contracts/errors";
import type { ExportMap } from "@infrabyx/contracts/export";
import type { KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import type { ColumnInfo, DatasetInput, Relationship } from "./archive.js";
import { assertExportable } from "./maps.js";

export interface Snapshot {
  asOf: Date;
  ownerName: string;
  datasets: DatasetInput[];
  relationships: Relationship[];
}

const IDENT = /^[a-z][a-z0-9_]*$/;
const q = (s: string) => {
  if (!IDENT.test(s)) throw new Error(`invalid identifier ${s}`);
  return `"${s}"`;
};

async function columnsOf(tx: Tx, source: string): Promise<ColumnInfo[]> {
  const [schema, table] = source.split(".") as [string, string];
  const r = await tx.query<{
    name: string;
    type: string;
    nullable: string;
    comment: string | null;
  }>(
    `select c.column_name as name, c.data_type as type, c.is_nullable as nullable,
            col_description(format('%I.%I', c.table_schema, c.table_name)::regclass, c.ordinal_position) as comment
       from information_schema.columns c
      where c.table_schema = $1 and c.table_name = $2
      order by c.ordinal_position`,
    [schema, table],
  );
  return r.rows.map((c) => ({
    name: c.name,
    pgType: c.type,
    nullable: c.nullable === "YES",
    dataClass: /dataclass:([A-Z]+)/.exec(c.comment ?? "")?.[1] ?? "UNCLASSIFIED",
  }));
}

/** Entities an export of `scope` covers (FULL_TENANT: all; DATASET: the listed ones; AUDIT_PACK). */
export function entitiesFor(map: ExportMap, scope: { type: string; ref: string | null }): string[] {
  const all = Object.keys(map.entities).sort();
  if (scope.type === "FULL_TENANT") return all;
  if (scope.type === "AUDIT_PACK")
    return all.filter((e) => map.entities[e]?.source === "audit.ledger");
  if (scope.type === "DATASET") {
    const want = (scope.ref ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!want.length || want.some((w) => !map.entities[w]))
      throw new IpbError("IPB-EXP-002", { detail: "DATASET scope needs map entity names" });
    return [...new Set(want)].sort();
  }
  throw new IpbError("IPB-EXP-002", { meta: { scope: scope.type } });
}

export async function readSnapshot(
  kernel: MutationKernel,
  ctx: KernelContext,
  map: ExportMap,
  entities: readonly string[],
): Promise<Snapshot> {
  return kernel.read(
    ctx,
    async (tx) => {
      const head = await tx.query<{ as_of: Date; owner: string | null }>(
        "select now() as as_of, (select name from tenancy.tenant where id = $1) as owner",
        [ctx.tenantId],
      );
      const datasets: DatasetInput[] = [];
      const filters = new Map<string, { sql: string; params: unknown[] }>();
      for (const name of entities) {
        const e = map.entities[name];
        if (!e) throw new Error(`entity ${name} is not in ${map.map_version}`);
        const all = await columnsOf(tx, e.source);
        assertExportable(name, e.fields, all);
        const columns = e.fields.map((f) => all.find((c) => c.name === f) as ColumnInfo);
        const where =
          e.source === "tenancy.tenant"
            ? { sql: "where id = $1", params: [ctx.tenantId] }
            : all.some((c) => c.name === "tenant_id")
              ? { sql: "where tenant_id = $1", params: [ctx.tenantId] }
              : { sql: "", params: [] };
        filters.set(name, where);
        const [schema, table] = e.source.split(".") as [string, string];
        const r = await tx.query<Record<string, unknown>>(
          `select ${e.fields.map(q).join(", ")} from ${q(schema)}.${q(table)} ${where.sql}`,
          where.params,
        );
        let rows = r.rows;
        let cols = columns;
        if (e.source === "audit.ledger") {
          // The chain hashes `seq` as a JSON number; keep it one in the archive.
          rows = rows.map((x) => ({ ...x, seq: Number(x.seq) }));
          cols = columns.map((c) => (c.name === "seq" ? { ...c, pgType: "integer" } : c));
        }
        datasets.push({ name, source: e.source, columns: cols, rows });
      }
      // Foreign keys between exported columns become relationships.csv.
      const fk = await tx.query<{ ft: string; fc: string; tt: string; tc: string }>(
        `select c.conrelid::regclass::text as ft, a.attname as fc,
              c.confrelid::regclass::text as tt, af.attname as tc
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
        where c.contype = 'f' and array_length(c.conkey, 1) = 1`,
      );
      const bySource = new Map(
        entities.map((n) => [map.entities[n]?.source as string, n] as const),
      );
      const relationships: Relationship[] = [];
      for (const k of fk.rows) {
        const from = bySource.get(k.ft);
        const to = bySource.get(k.tt);
        if (!from || !to) continue;
        if (!map.entities[from]?.fields.includes(k.fc) || !map.entities[to]?.fields.includes(k.tc))
          continue;
        relationships.push({ fromDataset: from, fromField: k.fc, toDataset: to, toField: k.tc });
      }
      // Reconcile: each table counted again in the same transaction.
      for (const d of datasets) {
        const [schema, table] = d.source.split(".") as [string, string];
        const f = filters.get(d.name) as { sql: string; params: unknown[] };
        const c = await tx.query<{ n: number }>(
          `select count(*)::int as n from ${q(schema)}.${q(table)} ${f.sql}`,
          f.params,
        );
        if ((c.rows[0]?.n ?? -1) !== d.rows.length)
          throw new IpbError("IPB-EXP-003", { meta: { dataset: d.name } });
      }
      return {
        asOf: head.rows[0]?.as_of as Date,
        ownerName: head.rows[0]?.owner ?? ctx.tenantId,
        datasets,
        relationships,
      };
    },
    { snapshot: true },
  );
}
