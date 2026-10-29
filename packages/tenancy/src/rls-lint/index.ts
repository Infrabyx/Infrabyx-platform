// RLS lint (IPB-02-12, IPB-09 §09.4.2, PL1 plan §7.3): catalog checks against a database with
// every migration applied. Also used at boot to validate module manifests (IPB-01-10, IPB-MOD-001).
import { IpbError } from "@infrabyx/contracts/errors";
import type { ModuleManifest } from "@infrabyx/contracts/modules";

export interface Queryable {
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export interface RlsFinding {
  rule:
    | "rls-enabled"
    | "rls-forced"
    | "tenant-policy"
    | "security-invoker-view"
    | "no-auth-schema"
    | "no-bypassrls"
    | "definer-function";
  object: string;
  message: string;
}

export interface RlsLintOptions {
  /** Schemas to check; default every non-system schema. */
  schemas?: readonly string[];
  /** Extra tables required to have RLS (module manifests' rlsTables). */
  rlsTables?: readonly string[];
  /** SECURITY DEFINER functions app_rw/app_ro may execute ("schema.name"). */
  allowDefiners?: readonly string[];
  /** Roles allowed to hold SUPERUSER/BYPASSRLS (the bootstrap owner). */
  allowPrivilegedRoles?: readonly string[];
}

export const DEFAULT_ALLOWED_DEFINERS = [
  "tenancy.breakglass_active",
  // Break-glass visible to the tenant (tenancy/0009, R1-D-28): they write only the tenant's own row.
  "tenancy.breakglass_touch",
  "tenancy.breakglass_claim_notices",
];
const SYSTEM = "('pg_catalog', 'information_schema', 'pg_toast')";

export async function lintRls(db: Queryable, o: RlsLintOptions = {}): Promise<RlsFinding[]> {
  const findings: RlsFinding[] = [];
  const schemaFilter = o.schemas
    ? "n.nspname = any($1::text[])"
    : `n.nspname not in ${SYSTEM} and n.nspname not like 'pg_temp%'`;
  const params = o.schemas ? [o.schemas] : [];

  const tables = await db.query<{
    name: string;
    rls: boolean;
    force: boolean;
    has_tenant: boolean;
    tenant_policy: boolean;
  }>(
    `select n.nspname || '.' || c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
            exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as has_tenant,
            exists (select 1 from pg_policy p where p.polrelid = c.oid
                     and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) like '%app.tenant_id%') as tenant_policy
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and ${schemaFilter}`,
    params,
  );
  const required = new Set(o.rlsTables ?? []);
  for (const t of tables.rows) {
    if (!t.has_tenant && !required.has(t.name)) continue;
    if (!t.rls)
      findings.push({
        rule: "rls-enabled",
        object: t.name,
        message: "row level security is not enabled",
      });
    if (!t.force)
      findings.push({
        rule: "rls-forced",
        object: t.name,
        message: "row level security is not forced",
      });
    if (!t.tenant_policy)
      findings.push({
        rule: "tenant-policy",
        object: t.name,
        message: "no policy references app.tenant_id",
      });
  }
  for (const name of required) {
    if (!tables.rows.some((t) => t.name === name))
      findings.push({ rule: "rls-enabled", object: name, message: "listed table does not exist" });
  }

  const views = await db.query<{ name: string; invoker: boolean }>(
    `select n.nspname || '.' || c.relname as name,
            coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false) as invoker
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'v' and ${schemaFilter}
        and exists (select 1 from pg_depend d join pg_rewrite rw on rw.oid = d.objid
                      join pg_class src on src.oid = d.refobjid
                     where rw.ev_class = c.oid and src.relrowsecurity)`,
    params,
  );
  for (const v of views.rows) {
    if (!v.invoker)
      findings.push({
        rule: "security-invoker-view",
        object: v.name,
        message: "view over an RLS table must be security_invoker",
      });
  }

  const auth = await db.query<{ name: string }>(
    `select n.nspname || '.' || c.relname || ':' || p.polname as name
       from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
      where (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ '\\mauth\\.'`,
  );
  for (const a of auth.rows)
    findings.push({
      rule: "no-auth-schema",
      object: a.name,
      message: "policy references the auth schema (Supabase, IPB-01 §01.4.11)",
    });

  const allowRoles = new Set(o.allowPrivilegedRoles ?? []);
  const roles = await db.query<{ rolname: string; super: boolean; bypass: boolean }>(
    `select rolname, rolsuper as super, rolbypassrls as bypass from pg_roles
      where (rolsuper or rolbypassrls) and rolname not like 'pg\\_%' and rolname <> current_user`,
  );
  for (const r of roles.rows) {
    if (!allowRoles.has(r.rolname))
      findings.push({
        rule: "no-bypassrls",
        object: r.rolname,
        message: `role has ${r.super ? "SUPERUSER" : "BYPASSRLS"}`,
      });
  }
  const appRoles = await db.query<{ rolname: string }>(
    "select rolname from pg_roles where rolname in ('app_rw', 'app_ro', 'app_migrate') and (rolsuper or rolbypassrls)",
  );
  for (const r of appRoles.rows)
    findings.push({
      rule: "no-bypassrls",
      object: r.rolname,
      message: "application roles never bypass RLS (IPB-02-12)",
    });

  const allowDef = new Set(o.allowDefiners ?? DEFAULT_ALLOWED_DEFINERS);
  const definers = await db.query<{ name: string }>(
    `select n.nspname || '.' || p.proname as name
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and ${schemaFilter}
        and (has_function_privilege('app_rw', p.oid, 'execute') or has_function_privilege('app_ro', p.oid, 'execute'))`,
    params,
  );
  for (const d of definers.rows) {
    if (!allowDef.has(d.name))
      findings.push({
        rule: "definer-function",
        object: d.name,
        message: "SECURITY DEFINER function executable by app_rw/app_ro is not allow-listed",
      });
  }
  return findings;
}

/** Boot check (@IPB-01-AT-16): every manifest rlsTables entry has RLS enabled, forced and a tenant policy. */
export async function assertManifestsRls(
  db: Queryable,
  manifests: readonly ModuleManifest[],
): Promise<void> {
  const rlsTables = manifests.flatMap((m) => m.rlsTables);
  if (rlsTables.length === 0) return;
  const schemas = [...new Set(rlsTables.map((t) => t.split(".")[0] as string))];
  const findings = (await lintRls(db, { schemas, rlsTables })).filter(
    (f) =>
      rlsTables.includes(f.object) &&
      (f.rule === "rls-enabled" || f.rule === "rls-forced" || f.rule === "tenant-policy"),
  );
  if (findings.length) {
    throw new IpbError("IPB-MOD-001", {
      detail: findings.map((f) => `${f.object}: ${f.message}`).join("; "),
      meta: { tables: [...new Set(findings.map((f) => f.object))] },
    });
  }
}
