// The module guard of a scoped grant (PR-LDC-08 (c); R1-D-75): which names it reads as modules.
import { describe, expect, it } from "vitest";
import { moduleGuard, refusalOf, scopeModules, tokenize, type GrantScope } from "./scope-guard.js";

const scope: GrantScope = {
  kind: "breakglass",
  grantId: "bgr_x",
  tenantId: "tnt_a",
  modules: ["docs"],
  access: "read_write",
};
const schemas = new Set(["docs", "billing", "audit", "tenancy", "pg_catalog", "public"]);
const guard = moduleGuard(scope, schemas);
const refusedModule = (sql: string) => {
  try {
    guard(sql);
    return null;
  } catch (e) {
    return refusalOf(e)?.module ?? "not a refusal";
  }
};

describe("@IPB-02-06 scoped break-glass module guard (R1-D-75)", () => {
  it("allows the scope's modules, pg_catalog and the ledger append", () => {
    for (const sql of [
      "select d.id, docs.file.name from docs.file d",
      'select "f"."id" from "docs"."file" as "f"',
      "select pg_catalog.now()",
      "insert into audit.ledger (id) values ($1)",
      "INSERT INTO audit . ledger (id) values ($1) returning id",
      "select 'billing.invoice', $1::text from docs.file",
      "select 1 from docs.file -- billing.invoice\n",
      "select 1 /* outer /* billing.x */ still a comment billing.y */ from docs.file",
      "select E'it\\'s billing.x' from docs.file",
    ])
      expect(refusedModule(sql)).toBeNull();
  });

  it("refuses any other schema, wherever it is named", () => {
    expect(refusedModule("select * from billing.invoice")).toBe("billing");
    expect(refusedModule('select * from "billing".invoice')).toBe("billing");
    expect(refusedModule("select * from docs.file where id in (select id from tenancy.user)")).toBe(
      "tenancy",
    );
    expect(refusedModule("select * from audit.ledger")).toBe("audit");
    expect(refusedModule("insert into docs.file select * from audit.ledger")).toBe("audit");
    expect(refusedModule("update audit.ledger set id = 'x'")).toBe("audit");
    expect(refusedModule("select public.f()")).toBe("public");
  });

  it("refuses statements that could reach a module without naming it", () => {
    for (const sql of [
      "set local search_path = billing",
      "SET LOCAL statement_timeout = 1",
      "reset all",
      "select set_config('x', 'y', true)",
      "select table_to_xml('billing.invoice', true, false, '')",
      "select $q$ billing.x $q$",
      "do $$ begin end $$",
      "prepare p as select 1",
      "execute p",
      "copy docs.file to stdout",
      "call docs.p()",
    ])
      expect(refusedModule(sql)).toMatch(/^\(/);
  });

  it("tokenizes quoted identifiers and drops literals and comments", () => {
    expect(tokenize(`select "A""b".x, 'it''s' -- c\n`)).toEqual([
      { t: "id", v: "select" },
      { t: "id", v: 'A"b' },
      { t: "dot" },
      { t: "id", v: "x" },
      { t: "other", v: "," },
      { t: "other", v: "'" },
    ]);
  });

  it("validates a scope's module list", () => {
    expect(scopeModules(["docs", "docs", "billing"])).toEqual(["docs", "billing"]);
    expect(() => scopeModules([])).toThrow(RangeError);
    expect(() => scopeModules(["Docs"])).toThrow(RangeError);
    expect(() => scopeModules(Array.from({ length: 51 }, (_, i) => `m${i}`))).toThrow(RangeError);
  });
});
