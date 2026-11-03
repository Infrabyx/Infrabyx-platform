// splitStatements (PR-UDF-031): a no-transaction migration is sent one statement at a time.
import { describe, expect, it } from "vitest";
import { splitStatements } from "./index.js";

describe("splitStatements", () => {
  it("splits on semicolons and drops comment-only pieces", () => {
    const sql = `-- infrabyx:no-transaction\nset lock_timeout = '5s';\nset statement_timeout = 0;\n-- trailing\n`;
    expect(splitStatements(sql)).toEqual([
      "-- infrabyx:no-transaction\nset lock_timeout = '5s'",
      "set statement_timeout = 0",
    ]);
  });

  it("keeps semicolons inside strings, identifiers, comments and dollar quotes", () => {
    const sql = [
      "comment on table a.b is 'one; two ''three;''';",
      'create index concurrently "x;y" on a.b (c);',
      "/* block; /* nested; */ still */ select 1;",
      "create function f() returns int language sql as $body$ select 1; select 2 $body$;",
      "do $$ begin perform 1; end $$;",
      "select $1::text",
    ].join("\n");
    const parts = splitStatements(sql);
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("comment on table a.b is 'one; two ''three;'''");
    expect(parts[1]).toContain('"x;y"');
    expect(parts[3]).toContain("select 1; select 2 $body$");
    expect(parts[4]).toBe("do $$ begin perform 1; end $$");
    expect(parts[5]).toBe("select $1::text");
  });

  it("refuses an unterminated quote", () => {
    expect(() => splitStatements("select 'oops;")).toThrow(SyntaxError);
    expect(() => splitStatements("do $x$ begin")).toThrow(SyntaxError);
  });
});
