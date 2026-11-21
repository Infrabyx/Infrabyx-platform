// export-map-gate (IPB-09-34, PL3 plan §7.4) and the map registry (IPB-09 §09.4.7.1).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExportMap } from "@infrabyx/contracts/export";
import {
  ARCHIVE_ROOTS,
  archiveModules,
  exportMapGate,
  schemaFromMigrations,
  type GateInput,
} from "./gate.js";
import { ExportMapRegistry, REF_EXPORT_MAP, assertExportable } from "./maps.js";

const MIGRATION = `
create table documents.document (
  id          text primary key,
  title       text not null,
  created_at  timestamptz not null default now(),
  check (length(title) > 0)
);
`;
const map = (version: string, fields: string[], views: string[] = []) =>
  ExportMap.parse({
    map_version: version,
    entities: {
      document: {
        source: "documents.document",
        id: "id",
        files: ["01 Data/document.csv"],
        fields,
        views,
      },
    },
    manifest: "manifest.json",
  });

const base = (over: Partial<GateInput> = {}): GateInput => ({
  changedFiles: [],
  maps: [map("LD-EXPORT-1.0", ["id", "title"])],
  mapChanges: [],
  changedMigrations: [],
  allMigrations: [{ path: "migrations/0001_init.sql", sql: MIGRATION }],
  changesets: [],
  unchangedLabel: false,
  ...over,
});

describe("@IPB-09-AT-14 export map gate", () => {
  const addField = {
    path: "migrations/0002_signed_at.sql",
    sql: "set lock_timeout = '5s';\nalter table documents.document add column signed_at timestamptz;\n",
  };

  it("a schema change to a mapped table without a map version bump fails (IPB-ENG-006)", () => {
    const r = exportMapGate(
      base({
        changedFiles: [addField.path],
        changedMigrations: [addField],
        allMigrations: [{ path: "m1", sql: MIGRATION }, addField],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.triggers[0]).toMatch(/changes documents.document/);
    expect(r.findings.at(-1)).toMatch(/bump the map version .* or add the export:unchanged label/);
  });

  it("passes with a minor bump that adds the field and a changeset line, or with the attestation", () => {
    const before = map("LD-EXPORT-1.0", ["id", "title"]);
    const after = map("LD-EXPORT-1.1", ["id", "title", "signed_at"]);
    const bumped = base({
      changedFiles: [addField.path, "maps/LD-EXPORT.json", ".changeset/x.md"],
      maps: [after],
      mapChanges: [{ path: "maps/LD-EXPORT.json", before, after }],
      changedMigrations: [addField],
      allMigrations: [{ path: "m1", sql: MIGRATION }, addField],
      changesets: ["---\n---\n\nexport_map: LD-EXPORT-1.1\nDownloads gain a signed_at column.\n"],
    });
    expect(exportMapGate(bumped)).toMatchObject({ ok: true });
    expect(exportMapGate({ ...bumped, changesets: [] }).findings).toEqual([
      'map LD-EXPORT-1.1: the PR needs a changeset line "export_map: LD-EXPORT-1.1" with a customer note',
    ]);
    const attested = base({
      changedFiles: [addField.path],
      changedMigrations: [addField],
      allMigrations: [{ path: "m1", sql: MIGRATION }, addField],
      unchangedLabel: true,
    });
    expect(exportMapGate(attested).ok).toBe(true);
  });

  it("a removed field needs a major bump; views never need one", () => {
    const before = map("LD-EXPORT-1.1", ["id", "title"]);
    const minor = map("LD-EXPORT-1.2", ["id"]);
    const r = exportMapGate(
      base({
        maps: [minor],
        mapChanges: [{ path: "m.json", before, after: minor }],
        changesets: ["export_map: LD-EXPORT-1.2"],
      }),
    );
    expect(r.findings).toContain(
      "m.json: the change needs a major bump of LD-EXPORT-1.1, got minor",
    );
    const major = map("LD-EXPORT-2.0", ["id"]);
    expect(
      exportMapGate(
        base({
          maps: [major],
          mapChanges: [{ path: "m.json", before, after: major }],
          changesets: ["export_map: LD-EXPORT-2.0"],
        }),
      ).ok,
    ).toBe(true);
    const views = map("LD-EXPORT-1.1", ["id", "title"], ["folder_path"]);
    const v = exportMapGate(
      base({
        maps: [views],
        mapChanges: [{ path: "m.json", before, after: views }],
        unchangedLabel: true,
      }),
    );
    expect(v.ok).toBe(true);
  });

  it("a map that names a column no migration creates always fails", () => {
    const r = exportMapGate(
      base({ maps: [map("LD-EXPORT-1.0", ["id", "hash_sha256"])], unchangedLabel: true }),
    );
    expect(r.findings).toEqual([
      "LD-EXPORT-1.0 document: documents.document.hash_sha256 does not exist",
    ]);
  });

  it("source changes in the export package trigger the gate; metadata, tests and the golden folder do not", () => {
    for (const f of [
      "packages/export/src/archive.ts",
      "packages/export/verify/verify.mjs",
      "packages/export/migrations/0002_x.sql",
    ])
      expect(exportMapGate(base({ changedFiles: [f] })).ok).toBe(false);
    // The version PR changes only package.json and CHANGELOG.md.
    for (const f of [
      "packages/export/golden/x/README.txt",
      "packages/export/package.json",
      "packages/export/CHANGELOG.md",
      "packages/export/README.md",
      "packages/export/src/gate.test.ts",
      "packages/export/src/__tests__/export.int.test.ts",
    ])
      expect(exportMapGate(base({ changedFiles: [f] })).ok).toBe(true);
  });

  // R1-D-263 (owner, 21 Nov 2026): only source an archive can depend on triggers.
  it("with the archive's module graph, a source file triggers only when an archive module reaches it", () => {
    const archive = new Set(["src/archive.ts", "src/csv.ts"]);
    const at = (f: string) =>
      exportMapGate(base({ changedFiles: [`packages/export/${f}`], archiveModules: archive }));
    for (const f of ["src/archive.ts", "src/csv.ts", "verify/verify.mjs", "maps/X-1.0.json"])
      expect(at(f).ok, f).toBe(false);
    // A non-TypeScript file under src/ still triggers.
    expect(at("src/table.json").ok).toBe(false);
    for (const f of ["src/pdf-id.ts", "src/index.ts", "src/xlsx-read.ts"])
      expect(at(f), f).toMatchObject({ ok: true, triggers: [] });
    // Without the graph, every source file triggers (the rule before).
    expect(exportMapGate(base({ changedFiles: ["packages/export/src/pdf-id.ts"] })).ok).toBe(false);
  });

  it("follows relative imports from the roots, and gives up on a dynamic import or a missing file", () => {
    const files: Record<string, string> = {
      "src/archive.ts":
        'import { a } from "./csv.js";\nimport type { Z } from "./zip.js";\n// import "./not.js"',
      "src/csv.ts": 'export * from "./code-tables.js";\nimport x from "@infrabyx/contracts";',
      "src/zip.ts": "export const zip = 1;",
      "src/code-tables.ts": "",
      "src/pdf-id.ts": 'import { o } from "./ooxml.js";',
    };
    const read = (p: string) => files[p] ?? null;
    expect([...(archiveModules(read, ["src/archive.ts"]) ?? [])].sort()).toEqual([
      "src/archive.ts",
      "src/code-tables.ts",
      "src/csv.ts",
      "src/zip.ts",
    ]);
    expect(
      archiveModules(
        (p) => (p === "src/zip.ts" ? 'await import("./x.js")' : read(p)),
        ["src/archive.ts"],
      ),
    ).toBeUndefined();
    expect(
      archiveModules((p) => (p === "src/zip.ts" ? null : read(p)), ["src/archive.ts"]),
    ).toBeUndefined();
  });

  it("finds this package's archive modules: the writer and what it imports, not the office or PDF readers", () => {
    const dir = join(import.meta.dirname, "..");
    const graph = archiveModules((p) =>
      existsSync(join(dir, p)) ? readFileSync(join(dir, p), "utf8") : null,
    );
    expect(graph).toBeDefined();
    for (const f of ARCHIVE_ROOTS) expect(graph?.has(f), f).toBe(true);
    for (const f of ["src/csv.ts", "src/zip.ts", "src/code-tables.ts"])
      expect(graph?.has(f), f).toBe(true);
    for (const f of ["src/pdf-id.ts", "src/index.ts", "src/gate.ts", "src/xlsx-read.ts"])
      expect(graph?.has(f), f).toBe(false);
  });

  it("reads tables and columns from create table and add column", () => {
    const s = schemaFromMigrations([
      { sql: MIGRATION },
      { sql: "alter table documents.document add column x int;" },
    ]);
    expect([...(s.get("documents.document") ?? [])].sort()).toEqual([
      "created_at",
      "id",
      "title",
      "x",
    ]);
  });

  it("reads every column of a multi-column alter table (PR-LDC-61)", () => {
    const s = schemaFromMigrations([
      { sql: MIGRATION },
      {
        sql: `alter table documents.document
  add column a text not null default 'x, y',
  add column if not exists b numeric(12, 2) check (b >= 0),
  add c jsonb,
  add constraint document_a_ck check (a <> ''),
  add primary key (id),
  alter column title set not null,
  add column "d" int; -- trailing comment, add column ignored int
alter table if exists only "documents"."document" add column e int, add f int;`,
      },
    ]);
    expect([...(s.get("documents.document") ?? [])].sort()).toEqual([
      "a",
      "b",
      "c",
      "created_at",
      "d",
      "e",
      "f",
      "id",
      "title",
    ]);
  });

  it("a map over a multi-column alter table has no false findings (PR-LDC-61)", () => {
    const r = exportMapGate(
      base({
        maps: [map("LD-EXPORT-1.0", ["id", "title", "a", "b", "c"])],
        allMigrations: [
          { path: "0001.sql", sql: MIGRATION },
          {
            path: "0002.sql",
            sql: "alter table documents.document add column a text, add column b int, add c int;",
          },
        ],
      }),
    );
    expect(r.findings).toEqual([]);
  });
});

describe("export maps", () => {
  it("REF-EXPORT-1.7 matches the platform migrations", async () => {
    const { readdirSync, readFileSync, existsSync } = await import("node:fs");
    const root = new URL("../../", import.meta.url);
    const all = readdirSync(root)
      .map((p) => new URL(`${p}/migrations/`, root))
      .filter((u) => existsSync(u))
      .flatMap((u) =>
        readdirSync(u)
          .filter((f) => f.endsWith(".sql"))
          .map((f) => ({ path: f, sql: readFileSync(new URL(f, u), "utf8") })),
      );
    const r = exportMapGate(base({ maps: [REF_EXPORT_MAP], allMigrations: all }));
    expect(r.findings).toEqual([]);
  });

  it("the registry emits the newest map and, for 90 days, the previous one", () => {
    const reg = new ExportMapRegistry()
      .register(map("LD-EXPORT-1.0", ["id"]), new Date("2026-01-01"))
      .register(map("LD-EXPORT-1.1", ["id", "title"]), new Date("2026-06-01"));
    expect(reg.current("LD").map_version).toBe("LD-EXPORT-1.1");
    expect(reg.emitted("LD", new Date("2026-07-01")).map((m) => m.map_version)).toEqual([
      "LD-EXPORT-1.0",
      "LD-EXPORT-1.1",
    ]);
    expect(reg.emitted("LD", new Date("2026-09-15"), 30).map((m) => m.map_version)).toEqual([
      "LD-EXPORT-1.1",
    ]);
  });

  it("refuses secret, sealed, Aadhaar and card fields (IPB-EXP-004)", () => {
    const c = (name: string, pgType = "text", dataClass = "INTERNAL") => ({
      name,
      pgType,
      nullable: true,
      dataClass,
    });
    for (const [f, cols] of [
      ["k", [c("k", "text", "SECRET")]],
      ["token_enc", [c("token_enc", "bytea")]],
      ["aadhaar_number", [c("aadhaar_number")]],
      ["card_number", [c("card_number")]],
    ] as const)
      expect(() => assertExportable("e", [f], cols)).toThrow(/IPB-EXP-004/);
    expect(() => assertExportable("e", ["x"], [])).toThrow(/does not exist/);
  });
});
