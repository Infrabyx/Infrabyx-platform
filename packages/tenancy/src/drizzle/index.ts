// Drizzle helpers (PL1 plan §3.1, IPB-02-19): the tenant column, data-class comments and the RLS
// policy every tenant table needs. drizzle-orm is an optional peer dependency.
import { text } from "drizzle-orm/pg-core";
import type { DataClass } from "@infrabyx/contracts/data-class";

const IDENT = /^[a-z_][a-z0-9_]*$/;
function qualified(t: string): string {
  const parts = t.split(".");
  if (parts.length !== 2 || !parts.every((p) => IDENT.test(p)))
    throw new Error(`expected schema.table, got ${t}`);
  return t;
}

/** `tenant_id text not null` — add a foreign key to tenancy.tenant in the migration. */
export const tenantIdColumn = () => text("tenant_id").notNull();

/** COMMENT ON COLUMN … IS 'dataclass:<CLASS>' for every column (read by migration-lint and schema-lint). */
export function dataClassCommentsSql(
  table: string,
  classes: Readonly<Record<string, DataClass>>,
): string {
  const t = qualified(table);
  return Object.entries(classes)
    .map(([col, cls]) => {
      if (!IDENT.test(col)) throw new Error(`invalid column ${col}`);
      return `comment on column ${t}.${col} is 'dataclass:${cls}';`;
    })
    .join("\n");
}

/** ENABLE + FORCE RLS and a tenant policy from current_setting('app.tenant_id', true) (IPB-02-12). */
export function rlsPolicySql(table: string, policy = "tenant_isolation"): string {
  const t = qualified(table);
  if (!IDENT.test(policy)) throw new Error(`invalid policy name ${policy}`);
  return [
    `alter table ${t} enable row level security;`,
    `alter table ${t} force row level security;`,
    `create policy ${policy} on ${t} for all`,
    `  using (tenant_id = current_setting('app.tenant_id', true))`,
    `  with check (tenant_id = current_setting('app.tenant_id', true));`,
  ].join("\n");
}
