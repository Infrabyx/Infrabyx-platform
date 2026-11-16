// `export-map-gate` (IPB-09-34, PL3 plan §7.4, @IPB-09-AT-14). Pure: the CLI gathers the PR's
// changed files, the maps before and after, the changed migrations and changesets; this decides.
// A PR that changes a mapped table in a migration, a map, or the export package's source, maps,
// verifier or migrations needs the
// map version bumped (at least as far as `requiredMapBump` says) with a changeset line
// `export_map: <version>`, or the `export:unchanged` attestation (reviewed by PLT_RELEASE_MANAGER
// through CODEOWNERS). A map that names a table or column no migration creates always fails.
import { parseMapVersion, requiredMapBump, type ExportMap } from "@infrabyx/contracts/export";

export interface MapChange {
  path: string;
  before: ExportMap | null;
  after: ExportMap | null;
}

export interface GateInput {
  changedFiles: readonly string[];
  /** Every map at the PR head. */
  maps: readonly ExportMap[];
  /** Map files the PR adds, changes or removes. */
  mapChanges: readonly MapChange[];
  /** SQL of the migrations the PR adds or changes. */
  changedMigrations: ReadonlyArray<{ path: string; sql: string }>;
  /** SQL of every migration at the PR head (for the map-against-schema check). */
  allMigrations: ReadonlyArray<{ path: string; sql: string }>;
  /** Text of the changesets the PR adds or changes. */
  changesets: readonly string[];
  /** The PR carries the `export:unchanged` label. */
  unchangedLabel: boolean;
  /** The export package directory (default `packages/export/`). */
  exportDir?: string;
}

export interface GateResult {
  ok: boolean;
  triggers: string[];
  findings: string[];
}

/**
 * Where the statement that starts at `from` ends: the first `;` outside quotes, quoted
 * identifiers, dollar-quoted bodies and comments (or the end of the text).
 */
function statementEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const c = text[i];
    if (c === ";") return i;
    if (c === "'" || c === '"') {
      const close = text.indexOf(c, i + 1);
      if (close < 0) return text.length;
      i = close + 1;
      continue;
    }
    if (c === "$") {
      const tag = /^\$[a-z_]*\$/i.exec(text.slice(i))?.[0];
      if (tag) {
        const close = text.indexOf(tag, i + tag.length);
        if (close < 0) return text.length;
        i = close + tag.length;
        continue;
      }
    }
    if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) return text.length;
      i = close + 2;
      continue;
    }
    i++;
  }
  return text.length;
}

/** Split an `ALTER TABLE` action list at commas outside parentheses and quotes. */
function alterActions(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "'" || c === '"') {
      const close = list.indexOf(c, i + 1);
      i = close < 0 ? list.length : close;
    } else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const IDENT = String.raw`"?([a-z_][a-z0-9_]*)"?`;
const ALTER_TABLE = new RegExp(
  String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${IDENT}\s*\.\s*${IDENT}\s+`,
  "gi",
);
/** `add [column] [if not exists] name …`, but not `add constraint`, `add primary key` and the like. */
const ADD_COLUMN = new RegExp(
  String.raw`^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(?!(?:constraint|primary|unique|check|foreign|exclude)\b)${IDENT}`,
  "i",
);

/**
 * Tables and columns the migrations create: `create table`, and every `add [column]` action of an
 * `alter table`, including statements that add several columns at once (LawDocsComply PR-LDC-61).
 */
export function schemaFromMigrations(
  migrations: ReadonlyArray<{ sql: string }>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const SKIP = /^(primary|unique|check|constraint|foreign|exclude|like)\b/i;
  for (const { sql } of migrations) {
    const text = sql.replace(/--[^\n]*/g, "");
    for (const m of text.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi,
    )) {
      const cols = out.get((m[1] as string).toLowerCase()) ?? new Set<string>();
      for (const line of (m[2] as string).split("\n")) {
        const t = line.trim();
        if (!t || SKIP.test(t)) continue;
        const name = /^"?([a-z_][a-z0-9_]*)"?\s/i.exec(t)?.[1];
        if (name) cols.add(name.toLowerCase());
      }
      out.set((m[1] as string).toLowerCase(), cols);
    }
    for (const m of text.matchAll(ALTER_TABLE)) {
      const table = `${m[1] as string}.${m[2] as string}`.toLowerCase();
      const from = (m.index ?? 0) + m[0].length;
      for (const action of alterActions(text.slice(from, statementEnd(text, from)))) {
        const col = ADD_COLUMN.exec(action)?.[1];
        if (!col) continue;
        const cols = out.get(table) ?? new Set<string>();
        cols.add(col.toLowerCase());
        out.set(table, cols);
      }
    }
  }
  return out;
}

function actualBump(before: string, after: string): "none" | "minor" | "major" | "down" {
  const a = parseMapVersion(before);
  const b = parseMapVersion(after);
  if (!a || !b || a.product !== b.product) return "down";
  if (b.major > a.major) return b.minor === 0 ? "major" : "down";
  if (b.major < a.major) return "down";
  if (b.minor > a.minor) return b.minor === a.minor + 1 ? "minor" : "down";
  return b.minor === a.minor ? "none" : "down";
}

const RANK = { none: 0, minor: 1, major: 2 } as const;

/**
 * Whether a file of the export package can change what an archive contains: its source, maps,
 * verifier and migrations. Tests, the golden fixture, the README, the changelog and `package.json`
 * (release metadata, e.g. the version PR) cannot.
 */
export function shapesExports(path: string): boolean {
  if (/^(golden|node_modules|dist)\//.test(path)) return false;
  if (/(^|\/)__tests__\//.test(path) || /\.test\.[cm]?[jt]s$/.test(path)) return false;
  return /^(src|maps|verify|migrations)\//.test(path);
}

export function exportMapGate(i: GateInput): GateResult {
  const findings: string[] = [];
  const triggers: string[] = [];
  const exportDir = (i.exportDir ?? "packages/export").replace(/\/$/, "") + "/";

  // 1. Every map against the schema the migrations create.
  const schema = schemaFromMigrations(i.allMigrations);
  for (const map of i.maps)
    for (const [name, e] of Object.entries(map.entities)) {
      const cols = schema.get(e.source);
      if (!cols) {
        findings.push(`${map.map_version} ${name}: no migration creates ${e.source}`);
        continue;
      }
      for (const f of e.fields)
        if (!cols.has(f))
          findings.push(`${map.map_version} ${name}: ${e.source}.${f} does not exist`);
    }

  // 2. What in the PR touches the export.
  const sources = new Map<string, string>();
  for (const map of i.maps)
    for (const [name, e] of Object.entries(map.entities))
      sources.set(e.source, `${map.map_version} ${name}`);
  for (const m of i.changedMigrations) {
    const text = m.sql.replace(/--[^\n]*/g, "");
    for (const [src, label] of sources)
      if (
        new RegExp(
          `(create|alter|drop)\\s+table\\s+(if\\s+(not\\s+)?exists\\s+)?(only\\s+)?${src.replace(".", "\\.")}\\b`,
          "i",
        ).test(text)
      )
        triggers.push(`${m.path} changes ${src} (${label})`);
  }
  for (const f of i.changedFiles)
    if (f.startsWith(exportDir) && shapesExports(f.slice(exportDir.length)))
      triggers.push(`${f} is in the export package`);
  for (const c of i.mapChanges) triggers.push(`${c.path} changes an export map`);

  // 3. Map bumps: content changes need at least the required bump, and a changeset line.
  const bumped: string[] = [];
  for (const c of i.mapChanges) {
    if (!c.after) {
      findings.push(`${c.path}: a map is removed; keep it for the 90-day dual run`);
      continue;
    }
    if (!c.before) {
      bumped.push(c.after.map_version);
      continue;
    }
    const need = requiredMapBump(c.before, c.after);
    const got = actualBump(c.before.map_version, c.after.map_version);
    if (got === "down")
      findings.push(
        `${c.path}: ${c.before.map_version} → ${c.after.map_version} is not a single minor or major step`,
      );
    else if (RANK[got] < RANK[need])
      findings.push(
        `${c.path}: the change needs a ${need} bump of ${c.before.map_version}, got ${got}`,
      );
    else if (got !== "none") bumped.push(c.after.map_version);
  }
  const noted = (v: string) =>
    i.changesets.some((t) =>
      new RegExp(`^\\s*export_map:\\s*${v.replace(/\./g, "\\.")}\\s*$`, "m").test(t),
    );
  for (const v of bumped)
    if (!noted(v))
      findings.push(
        `map ${v}: the PR needs a changeset line "export_map: ${v}" with a customer note`,
      );

  if (triggers.length && !bumped.length && !i.unchangedLabel)
    findings.push(
      "the PR changes what an export may contain: bump the map version (with an export_map changeset line) or add the export:unchanged label",
    );
  return { ok: findings.length === 0, triggers, findings };
}
