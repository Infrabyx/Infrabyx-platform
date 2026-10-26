import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintDir, lintSql, recordChecksums, type RuleId } from "./index.js";

const HEAD = "set lock_timeout = '5s';\nset statement_timeout = '60s';\n";
const rules = async (sql: string, head = HEAD) =>
  (await lintSql("t.sql", head + sql)).filter((f) => f.severity === "error").map((f) => f.rule);
const codes = async (sql: string) => (await lintSql("t.sql", HEAD + sql)).map((f) => f.code);

describe("@IPB-09-AT-11 migration lint examples", () => {
  const cases: Array<[string, RuleId[] | "pass"]> = [
    ["ALTER TABLE cases.case DISABLE ROW LEVEL SECURITY;", ["forbidden"]],
    ["CREATE INDEX idx ON cases.case(status);", ["index-concurrently"]],
    ["ALTER TABLE cases.case RENAME COLUMN status TO state;", ["rename-forbidden"]],
    [
      "ALTER TABLE cases.case ADD COLUMN state text; COMMENT ON COLUMN cases.case.state IS 'dataclass:INTERNAL'; ALTER TABLE cases.case DROP COLUMN status;",
      ["no-expand-contract-same-release"],
    ],
    ["ALTER TABLE cases.case ALTER COLUMN amount SET NOT NULL;", ["not-null-two-step"]],
  ];
  for (const [sql, want] of cases) {
    it(sql, async () => {
      expect(await rules(sql)).toEqual(want);
    });
  }
  it("CREATE INDEX CONCURRENTLY with lock_timeout set passes", async () => {
    expect(
      await rules(
        "CREATE INDEX CONCURRENTLY idx ON cases.case(status);",
        `-- infrabyx:no-transaction\n${HEAD}`,
      ),
    ).toEqual([]);
  });
  it("forbidden statements fail with IPB-ENG-004", async () => {
    expect(await codes("ALTER TABLE cases.case DISABLE ROW LEVEL SECURITY;")).toEqual([
      "IPB-ENG-004",
    ]);
  });
});

describe("@IPB-01-AT-11 extension whitelist", () => {
  it("CREATE EXTENSION postgis fails with IPB-DB-001; whitelisted extensions pass", async () => {
    expect(await codes("CREATE EXTENSION postgis;")).toEqual(["IPB-DB-001"]);
    expect(
      await rules(
        "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS vector;",
      ),
    ).toEqual([]);
    expect(await codes("CREATE EXTENSION pg_graphql;")).toEqual(["IPB-DB-002"]);
  });
});

describe("IPB-09 §09.4.6.2 rules and §09.4.6.3 forbidden operations", () => {
  const fail: Array<[string, RuleId]> = [
    [
      "create table cases.note (id text primary key, tenant_id text not null); comment on column cases.note.id is 'dataclass:INTERNAL'; comment on column cases.note.tenant_id is 'dataclass:INTERNAL';",
      "rls-required",
    ],
    ["create table cases.tag (id text primary key);", "data-class-tag"],
    [
      "alter table cases.case add constraint fk foreign key (owner) references tenancy.user (id);",
      "fk-not-valid",
    ],
    [
      "update cases.case set status = 'x'; create table cases.t (id text); comment on column cases.t.id is 'dataclass:INTERNAL';",
      "no-data-in-ddl",
    ],
    ["alter table cases.case alter column amount type bigint;", "type-change-forbidden"],
    ["alter table audit.ledger add constraint x check (true);", "audit-ledger-untouched"],
    ["alter table audit.ledger disable trigger ledger_no_update;", "audit-ledger-untouched"],
    [
      "insert into config.setting_value (id, key) values ('x', 'int.storage.retention.audit_days');",
      "object-lock-untouched",
    ],
    ["drop schema cases cascade;", "forbidden"],
    ["truncate cases.case;", "forbidden"],
    ["alter table cases.case no force row level security;", "forbidden"],
    ["alter role app_rw bypassrls;", "forbidden"],
    ["alter role app_rw superuser;", "forbidden"],
    ["do $$ begin create role x bypassrls; end $$;", "forbidden"],
    ["delete from audit.ledger;", "forbidden"],
    ["update audit.ledger set seq = 1;", "forbidden"],
    ["reindex table cases.case;", "forbidden"],
    ["vacuum full cases.case;", "forbidden"],
    ["cluster cases.case;", "forbidden"],
    ["update pg_catalog.pg_class set relrowsecurity = false;", "forbidden"],
    ["set session_replication_role = replica;", "forbidden"],
    [
      "create unlogged table cases.u (id text); comment on column cases.u.id is 'dataclass:INTERNAL';",
      "no-engine-specific",
    ],
    ["listen events;", "no-engine-specific"],
    ["create policy p on cases.case using (auth.uid() = owner);", "no-engine-specific"],
  ];
  for (const [sql, rule] of fail) {
    it(`${rule}: ${sql.slice(0, 70)}`, async () => {
      expect(await rules(sql)).toContain(rule);
    });
  }
  const pass = [
    "create table cases.note (id text primary key, tenant_id text not null); comment on column cases.note.id is 'dataclass:INTERNAL'; comment on column cases.note.tenant_id is 'dataclass:INTERNAL'; alter table cases.note enable row level security; alter table cases.note force row level security; create policy p on cases.note for all using (tenant_id = current_setting('app.tenant_id', true)); create index note_idx on cases.note (tenant_id);",
    "alter table cases.case add constraint fk foreign key (owner) references tenancy.user (id) not valid; alter table cases.case validate constraint fk;",
    "alter table cases.case add constraint amount_nn check (amount is not null) not valid; alter table cases.case validate constraint amount_nn; alter table cases.case alter column amount set not null;",
    "alter table cases.case add column notes text; comment on column cases.case.notes is 'dataclass:CONFIDENTIAL';",
    "alter table audit.ledger add column region text; comment on column audit.ledger.region is 'dataclass:INTERNAL';",
    "create role app_x nologin nobypassrls nosuperuser;",
  ];
  for (const sql of pass) {
    it(`passes: ${sql.slice(0, 70)}`, async () => {
      expect(await rules(sql)).toEqual([]);
    });
  }
  it("lock-timeout-set requires both timeouts", async () => {
    expect(await rules("select 1;", "set lock_timeout = '5s';\n")).toEqual(["lock-timeout-set"]);
  });
  it("drops warn without the migration:contract label", async () => {
    const f = await lintSql("t.sql", `${HEAD}alter table cases.case drop column legacy;`);
    expect(f.map((x) => [x.rule, x.severity])).toEqual([["drop-requires-contract-label", "warn"]]);
    expect(
      await lintSql("t.sql", `${HEAD}alter table cases.case drop column legacy;`, new Map(), {
        contractLabel: true,
      }),
    ).toEqual([]);
  });
  it("a parse error is reported", async () => {
    expect(await rules("creat tabel x;")).toEqual(["parse-error"]);
  });
});

describe("@IPB-09-AT-12 released migration immutability", () => {
  it("an edited file listed in checksums.json fails with IPB-ENG-005", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mig-"));
    await writeFile(join(dir, "0001_init.sql"), `${HEAD}select 1;\n`);
    expect(await recordChecksums(dir)).toEqual(["0001_init.sql"]);
    expect((await lintDir(dir)).findings).toEqual([]);
    await writeFile(join(dir, "0001_init.sql"), `${HEAD}select 2;\n`);
    expect((await lintDir(dir)).findings.map((f) => [f.rule, f.code])).toEqual([
      ["checksum-immutable", "IPB-ENG-005"],
    ]);
    expect(await recordChecksums(dir)).toEqual([]);
    expect(
      JSON.parse(await readFile(join(dir, "checksums.json"), "utf8"))["0001_init.sql"],
    ).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("PL1 migrations", () => {
  for (const p of ["tenancy", "audit", "config", "seed"]) {
    it(`${p} migrations lint clean and match their checksums`, async () => {
      const r = await lintDir(join(import.meta.dirname, "../../..", p, "migrations"));
      expect(r.findings).toEqual([]);
      expect(r.files.length).toBeGreaterThan(0);
    });
  }
});
