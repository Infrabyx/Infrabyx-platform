// Package-internal: the module guard of a scoped grant (LawDocsComply PR-LDC-08 (c); R1-D-75). A
// module is a PostgreSQL schema (IPB-01-09). In a transaction under a grant that lists modules, the
// kernel runs a statement only when every schema it names is one of them (or `pg_catalog`); the
// ledger append (`insert into audit.ledger`) is always allowed, so the mutation is still recorded.
// Unqualified names resolve only through the default search path, which no module uses, and the
// statements that would change it or run SQL held in a string are refused under a scope.
import { IpbError } from "@infrabyx/contracts/errors";

/** The scope a break-glass or support grant narrows a context to (R1-D-75; R1-D-76). */
export interface GrantScope {
  kind: "breakglass" | "support";
  grantId: string;
  /** The one tenant it may touch; null only for an unscoped break-glass grant. */
  tenantId: string | null;
  /** Schemas it may touch; null for every module. */
  modules: readonly string[] | null;
  access: "read" | "read_write";
}

export type RefusalReason = "tenant" | "write" | "module";

export interface ScopeRefusal {
  scope: GrantScope;
  reason: RefusalReason;
  module?: string;
}

// Errors the kernel raised for a scope, which it ledgers once the transaction has rolled back.
const refusals = new WeakMap<object, ScopeRefusal>();

export function scopeRefusal(r: ScopeRefusal, action?: string): IpbError {
  const what =
    r.reason === "tenant"
      ? "this tenant is outside the grant's scope"
      : r.reason === "write"
        ? "the grant is read-only"
        : `module ${r.module} is outside the grant's scope`;
  const e = new IpbError("IPB-SEC-005", {
    detail: `${r.scope.kind === "breakglass" ? "break-glass" : "support access"}: ${what}`,
    meta: {
      grant_id: r.scope.grantId,
      reason: r.reason,
      ...(r.module ? { module: r.module } : {}),
      ...(action ? { action } : {}),
    },
  });
  refusals.set(e, r);
  return e;
}

export const refusalOf = (e: unknown): ScopeRefusal | undefined =>
  e && typeof e === "object" ? refusals.get(e) : undefined;

export const MODULE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
export const MAX_SCOPE_MODULES = 50;

/** A scope's module list: 1 to 50 distinct schema names. */
export function scopeModules(modules: readonly string[]): string[] {
  const out = [...new Set(modules)];
  if (out.length < 1 || out.length > MAX_SCOPE_MODULES)
    throw new RangeError(`a scope lists 1–${MAX_SCOPE_MODULES} modules`);
  for (const m of out)
    if (!MODULE_NAME.test(m)) throw new RangeError(`invalid module ${JSON.stringify(m)}`);
  return out;
}

// Refused outright under a module scope: statements that change the search path or settings, run
// a prepared or anonymous block, or functions that run SQL from a string (the *_to_xml family).
const UNSCOPED: Array<[RegExp, string]> = [
  [/^\s*(?:set|reset|do|execute|prepare|deallocate|copy|call)\b/i, "statement kind"],
  [/search_path/i, "search_path"],
  [/\bset_config\s*\(/i, "set_config"],
  [/_to_xml/i, "SQL held in a string"],
  [/\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/, "dollar-quoted text"],
];

type Token = { t: "id"; v: string } | { t: "dot" } | { t: "other"; v: string };

/** Identifiers, dots and other tokens; comments and string literals are dropped. */
export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i] as string;
    if (/\s/.test(c)) {
      i++;
    } else if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
    } else if (c === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
    } else if (c === "'") {
      // An E'…' literal (the E was read as an identifier just before) honours backslash escapes.
      const prev = out.at(-1);
      const escapes = prev?.t === "id" && prev.v === "e" && /[eE]/.test(sql[i - 1] ?? "");
      if (escapes) out.pop();
      i++;
      while (i < n) {
        if (escapes && sql[i] === "\\") i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      out.push({ t: "other", v: "'" });
    } else if (c === '"') {
      let v = "";
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          v += '"';
          i += 2;
        } else if (sql[i] === '"') break;
        else v += sql[i++];
      }
      i++;
      out.push({ t: "id", v });
    } else if (/[A-Za-z_\u0080-￿]/.test(c)) {
      let v = "";
      while (i < n && /[A-Za-z0-9_$\u0080-￿]/.test(sql[i] as string)) v += sql[i++];
      out.push({ t: "id", v: v.toLowerCase() });
    } else if (c === ".") {
      out.push({ t: "dot" });
      i++;
    } else {
      out.push({ t: "other", v: c });
      i++;
    }
  }
  return out;
}

/**
 * The guard for one transaction: `schemas` are the database's schema names, so an alias or a table
 * name that is not a schema is never mistaken for one (one that is, is refused: fail closed).
 */
export function moduleGuard(
  scope: GrantScope,
  schemas: ReadonlySet<string>,
): (sql: string) => void {
  const allowed = new Set([...(scope.modules ?? []), "pg_catalog"]);
  return (sql: string) => {
    for (const [re, what] of UNSCOPED)
      if (re.test(sql)) throw scopeRefusal({ scope, reason: "module", module: `(${what})` });
    const tk = tokenize(sql);
    for (let i = 0; i < tk.length; i++) {
      const a = tk[i] as Token;
      if (a.t !== "id" || tk[i + 1]?.t !== "dot" || tk[i - 1]?.t === "dot") continue;
      if (!schemas.has(a.v) || allowed.has(a.v)) continue;
      const next = tk[i + 2];
      const ledgerAppend =
        a.v === "audit" &&
        next?.t === "id" &&
        next.v === "ledger" &&
        i === 2 &&
        tk[0]?.t === "id" &&
        tk[0].v === "insert" &&
        tk[1]?.t === "id" &&
        tk[1].v === "into";
      if (!ledgerAppend) throw scopeRefusal({ scope, reason: "module", module: a.v });
    }
  };
}
