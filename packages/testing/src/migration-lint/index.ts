// migration-lint (IPB-09-31, §09.4.6.2 rules and §09.4.6.3 forbidden operations; IPB-01-22/23)
// over the real PostgreSQL parser (libpg-query, PostgreSQL 18 grammar, WASM).
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "libpg-query";
import { sha256Hex } from "@infrabyx/crypto";

export type Severity = "error" | "warn";
export type RuleId =
  | "parse-error"
  | "ext-whitelist"
  | "no-engine-specific"
  | "rls-required"
  | "data-class-tag"
  | "index-concurrently"
  | "no-expand-contract-same-release"
  | "not-null-two-step"
  | "fk-not-valid"
  | "lock-timeout-set"
  | "no-data-in-ddl"
  | "rename-forbidden"
  | "type-change-forbidden"
  | "drop-requires-contract-label"
  | "checksum-immutable"
  | "audit-ledger-untouched"
  | "object-lock-untouched"
  | "forbidden";

export interface Finding {
  file: string;
  rule: RuleId;
  severity: Severity;
  /** IPB-ENG-004 lint failure, IPB-ENG-005 edited released file, IPB-DB-001/002 for IPB-01 rules. */
  code: "IPB-ENG-004" | "IPB-ENG-005" | "IPB-DB-001" | "IPB-DB-002";
  message: string;
}

export interface LintOptions {
  /** The PR carries the `migration:contract` label (drop-requires-contract-label). */
  contractLabel?: boolean;
}

/** IPB-01-22: pgvector ("vector"), pg_trgm, pgcrypto, citext; uuid-ossp and btree_gist are core/contrib. */
export const EXTENSION_WHITELIST = [
  "vector",
  "pg_trgm",
  "pgcrypto",
  "citext",
  "uuid-ossp",
  "btree_gist",
];
const ENGINE_SCHEMAS = [
  "auth",
  "storage",
  "realtime",
  "supabase_functions",
  "graphql_public",
  "extensions",
  "cron",
];
const ENGINE_EXTENSIONS = [
  "pg_graphql",
  "supabase_vault",
  "pg_net",
  "pg_cron",
  "aws_commons",
  "aws_s3",
  "dblink",
  "postgres_fdw",
  "pglogical",
];
export const NO_TRANSACTION_MARKER = "-- infrabyx:no-transaction";

type Node = Record<string, unknown>;
interface RangeVar {
  schemaname?: string;
  relname: string;
  relpersistence?: string;
}
const qn = (r?: RangeVar) => (r ? `${r.schemaname ?? "public"}.${r.relname}` : "?");
const strs = (items: unknown): string[] =>
  ((items as Node[] | undefined) ?? [])
    .map((i) => (i.String as { sval: string } | undefined)?.sval ?? "")
    .filter(Boolean);

/** Every RangeVar anywhere in a node (for pg_catalog and engine-schema references). */
function rangeVars(n: unknown, out: RangeVar[] = []): RangeVar[] {
  if (Array.isArray(n)) n.forEach((x) => rangeVars(x, out));
  else if (n && typeof n === "object") {
    const o = n as Node;
    if (typeof o.relname === "string") out.push(o as unknown as RangeVar);
    for (const v of Object.values(o)) rangeVars(v, out);
  }
  return out;
}

/** Schema-qualified function calls anywhere in a node, e.g. auth.uid(). */
function funcSchemas(n: unknown, out: string[] = []): string[] {
  if (Array.isArray(n)) n.forEach((x) => funcSchemas(x, out));
  else if (n && typeof n === "object") {
    const o = n as Node;
    const names = strs(o.funcname);
    if (names.length > 1) out.push(names[0] as string);
    for (const v of Object.values(o)) funcSchemas(v, out);
  }
  return out;
}

interface FileState {
  created: Set<string>;
  tenantTables: Set<string>;
  columns: Map<string, Set<string>>;
  tagged: Set<string>;
  rlsEnabled: Set<string>;
  rlsForced: Set<string>;
  policies: Set<string>;
  adds: Set<string>;
  drops: Set<string>;
  lockTimeout: boolean;
  statementTimeout: boolean;
  ddl: boolean;
  dataWrites: string[];
}

/** Columns with a validated CHECK (col IS NOT NULL), across files in order (not-null-two-step). */
type NotNullChecks = Map<string, { validated: boolean; conname?: string }>;

function isNotNullCheck(expr: unknown): string | null {
  const t = (expr as Node | undefined)?.NullTest as
    { arg?: Node; nulltesttype?: string } | undefined;
  if (!t || t.nulltesttype !== "IS_NOT_NULL") return null;
  return strs((t.arg?.ColumnRef as { fields?: unknown } | undefined)?.fields).at(-1) ?? null;
}

export async function lintSql(
  file: string,
  sql: string,
  checks: NotNullChecks = new Map(),
  opts: LintOptions = {},
): Promise<Finding[]> {
  const out: Finding[] = [];
  const add = (
    rule: RuleId,
    message: string,
    severity: Severity = "error",
    code: Finding["code"] = "IPB-ENG-004",
  ) => out.push({ file, rule, severity, code, message });
  let stmts: Array<{ stmt: Node }>;
  try {
    stmts = (await parse(sql)).stmts as unknown as Array<{ stmt: Node }>;
  } catch (e) {
    add("parse-error", (e as Error).message);
    return out;
  }
  const noTx = sql.startsWith(NO_TRANSACTION_MARKER);
  const s: FileState = {
    created: new Set(),
    tenantTables: new Set(),
    columns: new Map(),
    tagged: new Set(),
    rlsEnabled: new Set(),
    rlsForced: new Set(),
    policies: new Set(),
    adds: new Set(),
    drops: new Set(),
    lockTimeout: false,
    statementTimeout: false,
    ddl: false,
    dataWrites: [],
  };
  const addColumn = (table: string, col: string) => {
    const set = s.columns.get(table) ?? new Set<string>();
    set.add(col);
    s.columns.set(table, set);
  };
  const createdHere = (t: string) => s.created.has(t);
  const ledgerTouched = (t: string) => t === "audit.ledger" && !createdHere("audit.ledger");

  for (const { stmt } of stmts) {
    const [kind, body] = Object.entries(stmt)[0] as [string, Node];
    for (const rv of rangeVars(body)) {
      if (rv.schemaname === "pg_catalog")
        add("forbidden", `statement touches pg_catalog (${qn(rv)})`);
      if (rv.schemaname && ENGINE_SCHEMAS.includes(rv.schemaname))
        add(
          "no-engine-specific",
          `references engine schema ${rv.schemaname}`,
          "error",
          "IPB-DB-002",
        );
    }
    for (const fs of funcSchemas(body)) {
      if (ENGINE_SCHEMAS.includes(fs))
        add("no-engine-specific", `calls a function in engine schema ${fs}`, "error", "IPB-DB-002");
    }
    switch (kind) {
      case "VariableSetStmt": {
        const name = body.name as string;
        if (name === "lock_timeout") s.lockTimeout = true;
        if (name === "statement_timeout") s.statementTimeout = true;
        if (name === "session_replication_role")
          add("forbidden", "SET session_replication_role bypasses triggers");
        break;
      }
      case "CreateExtensionStmt": {
        const ext = body.extname as string;
        if (ENGINE_EXTENSIONS.includes(ext))
          add("no-engine-specific", `extension ${ext} is engine-specific`, "error", "IPB-DB-002");
        else if (!EXTENSION_WHITELIST.includes(ext))
          add(
            "ext-whitelist",
            `extension ${ext} is not whitelisted (IPB-01-22)`,
            "error",
            "IPB-DB-001",
          );
        s.ddl = true;
        break;
      }
      case "CreateStmt": {
        const rel = body.relation as RangeVar;
        const t = qn(rel);
        s.ddl = true;
        s.created.add(t);
        s.adds.add(t);
        if (rel.relpersistence === "u")
          add(
            "no-engine-specific",
            `${t}: unlogged tables are not allowed for durable data`,
            "error",
            "IPB-DB-002",
          );
        for (const el of (body.tableElts as Node[] | undefined) ?? []) {
          const col = el.ColumnDef as { colname?: string } | undefined;
          if (col?.colname) {
            addColumn(t, col.colname);
            if (col.colname === "tenant_id") s.tenantTables.add(t);
          }
        }
        break;
      }
      case "AlterTableStmt": {
        const t = qn(body.relation as RangeVar);
        s.ddl = true;
        for (const c of (body.cmds as Node[] | undefined) ?? []) {
          const cmd = c.AlterTableCmd as { subtype: string; name?: string; def?: Node };
          switch (cmd.subtype) {
            case "AT_EnableRowSecurity":
              s.rlsEnabled.add(t);
              break;
            case "AT_ForceRowSecurity":
              s.rlsForced.add(t);
              break;
            case "AT_DisableRowSecurity":
              add("forbidden", `${t}: DISABLE ROW LEVEL SECURITY`);
              break;
            case "AT_NoForceRowSecurity":
              add("forbidden", `${t}: NO FORCE ROW LEVEL SECURITY`);
              break;
            case "AT_AddColumn": {
              const col = cmd.def?.ColumnDef as
                { colname?: string; constraints?: Node[] } | undefined;
              if (col?.colname) addColumn(t, col.colname);
              s.adds.add(t);
              const notNull = (col?.constraints ?? []).some(
                (k) => (k.Constraint as { contype?: string }).contype === "CONSTR_NOTNULL",
              );
              const hasDefault = (col?.constraints ?? []).some(
                (k) => (k.Constraint as { contype?: string }).contype === "CONSTR_DEFAULT",
              );
              if (notNull && !hasDefault && !createdHere(t))
                add(
                  "not-null-two-step",
                  `${t}.${col?.colname}: new NOT NULL column without default on an existing table`,
                );
              break;
            }
            case "AT_DropColumn":
            case "AT_DropConstraint":
              s.drops.add(t);
              if (!opts.contractLabel)
                add(
                  "drop-requires-contract-label",
                  `${t}: drop needs the migration:contract label`,
                  "warn",
                );
              break;
            case "AT_SetNotNull": {
              const chk = checks.get(`${t}.${cmd.name}`);
              if (!createdHere(t) && !chk?.validated)
                add(
                  "not-null-two-step",
                  `${t}.${cmd.name}: SET NOT NULL without a validated CHECK (… IS NOT NULL) constraint`,
                );
              break;
            }
            case "AT_AlterColumnType": {
              const type = strs(
                (cmd.def?.ColumnDef as { typeName?: { names?: unknown } } | undefined)?.typeName
                  ?.names,
              ).at(-1);
              if (!createdHere(t) && type !== "text")
                add(
                  "type-change-forbidden",
                  `${t}.${cmd.name}: ALTER COLUMN TYPE on a populated table`,
                );
              break;
            }
            case "AT_AddConstraint": {
              const k = cmd.def?.Constraint as
                | {
                    contype?: string;
                    skip_validation?: boolean;
                    conname?: string;
                    raw_expr?: unknown;
                  }
                | undefined;
              if (k?.contype === "CONSTR_FOREIGN" && !createdHere(t) && !k.skip_validation)
                add(
                  "fk-not-valid",
                  `${t}: new foreign key on an existing table must be NOT VALID, then VALIDATE`,
                );
              const col = k?.contype === "CONSTR_CHECK" ? isNotNullCheck(k.raw_expr) : null;
              if (col)
                checks.set(`${t}.${col}`, {
                  validated: !k?.skip_validation,
                  ...(k?.conname ? { conname: k.conname } : {}),
                });
              break;
            }
            case "AT_ValidateConstraint":
              for (const [key, v] of checks)
                if (key.startsWith(`${t}.`) && v.conname === cmd.name) v.validated = true;
              break;
            case "AT_DisableTrig":
            case "AT_DisableTrigAll":
            case "AT_DisableTrigUser":
              if (t === "audit.ledger")
                add("audit-ledger-untouched", "triggers on audit.ledger may not be disabled");
              break;
            default:
              break;
          }
          if (ledgerTouched(t) && cmd.subtype !== "AT_AddColumn")
            add(
              "audit-ledger-untouched",
              `audit.ledger: ${cmd.subtype} (only additive columns are allowed)`,
            );
        }
        break;
      }
      case "IndexStmt": {
        const t = qn(body.relation as RangeVar);
        s.ddl = true;
        if (!body.concurrent && !createdHere(t))
          add("index-concurrently", `${t}: CREATE INDEX must be CONCURRENTLY on an existing table`);
        if (body.concurrent && !noTx)
          add(
            "index-concurrently",
            `${t}: CREATE INDEX CONCURRENTLY needs the "${NO_TRANSACTION_MARKER}" first line`,
          );
        break;
      }
      case "CommentStmt": {
        if (body.objtype === "OBJECT_COLUMN") {
          const parts = strs(
            (body.object as Node).List && ((body.object as Node).List as Node).items,
          );
          if (
            /^dataclass:(PUBLIC|INTERNAL|CONFIDENTIAL|REGULATED|SECRET)$/.test(
              String(body.comment ?? ""),
            )
          )
            s.tagged.add(parts.join("."));
        }
        break;
      }
      case "CreatePolicyStmt":
        s.ddl = true;
        s.policies.add(qn(body.table as RangeVar));
        break;
      case "RenameStmt":
        s.ddl = true;
        if (body.renameType === "OBJECT_COLUMN" || body.renameType === "OBJECT_TABLE")
          add(
            "rename-forbidden",
            `${qn(body.relation as RangeVar)}: RENAME is forbidden (expand/contract)`,
          );
        break;
      case "DropStmt": {
        s.ddl = true;
        const type = body.removeType as string;
        if (type === "OBJECT_SCHEMA" && body.behavior === "DROP_CASCADE")
          add("forbidden", "DROP SCHEMA … CASCADE");
        if (type === "OBJECT_DATABASE") add("forbidden", "DROP DATABASE");
        for (const o of (body.objects as Node[] | undefined) ?? []) {
          const name = strs((o.List as Node | undefined)?.items).join(".");
          if (type === "OBJECT_TABLE") {
            s.drops.add(name);
            if (name === "audit.ledger") add("audit-ledger-untouched", "DROP TABLE audit.ledger");
          }
        }
        if (!opts.contractLabel)
          add(
            "drop-requires-contract-label",
            `DROP ${type.replace("OBJECT_", "")} needs the migration:contract label`,
            "warn",
          );
        break;
      }
      case "DropdbStmt":
        add("forbidden", "DROP DATABASE");
        break;
      case "TruncateStmt":
        add("forbidden", `TRUNCATE ${rangeVars(body.relations).map(qn).join(", ")}`);
        break;
      case "ReindexStmt": {
        const params = ((body.params as Node[] | undefined) ?? []).map(
          (p) => (p.DefElem as { defname?: string }).defname,
        );
        if (!params.includes("concurrently")) add("forbidden", "REINDEX without CONCURRENTLY");
        break;
      }
      case "VacuumStmt":
        if (
          ((body.options as Node[] | undefined) ?? []).some(
            (o) => (o.DefElem as { defname?: string }).defname === "full",
          )
        )
          add("forbidden", "VACUUM FULL in a migration");
        break;
      case "ClusterStmt":
        add("forbidden", "CLUSTER");
        break;
      case "ListenStmt":
      case "NotifyStmt":
        add(
          "no-engine-specific",
          "LISTEN/NOTIFY is not a delivery mechanism (use the outbox)",
          "error",
          "IPB-DB-002",
        );
        break;
      case "CreateRoleStmt":
      case "AlterRoleStmt":
        for (const o of (body.options as Node[] | undefined) ?? []) {
          const d = o.DefElem as { defname?: string; arg?: { Boolean?: { boolval?: boolean } } };
          if (
            (d.defname === "bypassrls" || d.defname === "superuser") &&
            d.arg?.Boolean?.boolval === true
          )
            add("forbidden", `role ${d.defname.toUpperCase()}`);
        }
        break;
      case "DoStmt":
      case "CreateFunctionStmt": {
        const text = JSON.stringify(body).toLowerCase();
        if (/(?<!no)bypassrls/.test(text) || /(?<!no)superuser\b/.test(text))
          add("forbidden", "BYPASSRLS/SUPERUSER inside a procedural block");
        if (text.includes("session_replication_role"))
          add("forbidden", "session_replication_role inside a procedural block");
        break;
      }
      case "InsertStmt":
      case "UpdateStmt":
      case "DeleteStmt": {
        const t = qn(body.relation as RangeVar);
        if (t === "audit.ledger" && kind !== "InsertStmt")
          add("forbidden", `${kind === "UpdateStmt" ? "UPDATE" : "DELETE FROM"} audit.ledger`);
        if (
          kind !== "InsertStmt" ||
          (body.selectStmt &&
            (body.selectStmt as Node).SelectStmt &&
            ((body.selectStmt as Node).SelectStmt as Node).fromClause)
        )
          s.dataWrites.push(t);
        if (/retention|object_lock/i.test(JSON.stringify(body)))
          add("object-lock-untouched", `${t}: migrations never change retention settings`);
        break;
      }
      case "GrantStmt":
      case "GrantRoleStmt":
      case "CreateTrigStmt":
      case "CreateSchemaStmt":
      case "AlterOwnerStmt":
      case "AlterFunctionStmt":
        s.ddl = true;
        break;
      default:
        break;
    }
  }
  if (!s.lockTimeout || !s.statementTimeout)
    add("lock-timeout-set", "the migration must SET lock_timeout and statement_timeout");
  if (s.ddl && s.dataWrites.length)
    add(
      "no-data-in-ddl",
      `data changes in a DDL migration: ${[...new Set(s.dataWrites)].join(", ")} (backfills belong to worker jobs)`,
    );
  for (const t of s.adds)
    if (s.drops.has(t))
      add("no-expand-contract-same-release", `${t}: added and dropped structures in one migration`);
  for (const t of s.tenantTables) {
    if (!s.rlsEnabled.has(t) || !s.rlsForced.has(t) || !s.policies.has(t))
      add(
        "rls-required",
        `${t}: tenant table needs ENABLE + FORCE ROW LEVEL SECURITY and a policy in the same migration`,
      );
  }
  for (const [t, cols] of s.columns)
    for (const c of cols)
      if (!s.tagged.has(`${t}.${c}`))
        add("data-class-tag", `${t}.${c}: no 'dataclass:<CLASS>' comment`);
  return out;
}

export interface DirResult {
  findings: Finding[];
  files: string[];
}

export const CHECKSUM_MANIFEST = "checksums.json";

async function readManifest(dir: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(join(dir, CHECKSUM_MANIFEST), "utf8")) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

/** Lint every NNNN_*.sql file in `dir` in order, plus checksum-immutable against checksums.json. */
export async function lintDir(dir: string, opts: LintOptions = {}): Promise<DirResult> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const checks: NotNullChecks = new Map();
  const findings: Finding[] = [];
  const manifest = await readManifest(dir);
  for (const f of files) {
    const sql = await readFile(join(dir, f), "utf8");
    const path = join(dir, f);
    findings.push(...(await lintSql(path, sql, checks, opts)));
    if (manifest[f] && manifest[f] !== sha256Hex(sql)) {
      findings.push({
        file: path,
        rule: "checksum-immutable",
        severity: "error",
        code: "IPB-ENG-005",
        message: "released migration changed (checksum differs from checksums.json)",
      });
    }
  }
  for (const f of Object.keys(manifest)) {
    if (!files.includes(f))
      findings.push({
        file: join(dir, f),
        rule: "checksum-immutable",
        severity: "error",
        code: "IPB-ENG-005",
        message: "released migration was removed",
      });
  }
  return { findings, files };
}

/** Record checksums for files not yet in the manifest; existing entries are never rewritten. */
export async function recordChecksums(dir: string): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const manifest = await readManifest(dir);
  const added: string[] = [];
  for (const f of files) {
    if (manifest[f]) continue;
    manifest[f] = sha256Hex(await readFile(join(dir, f), "utf8"));
    added.push(f);
  }
  await writeFile(join(dir, CHECKSUM_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return added;
}
