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

/** Tables and columns the migrations create (`create table`, `alter table … add column`). */
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
    for (const m of text.matchAll(
      /alter\s+table\s+(?:only\s+)?([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)/gi,
    )) {
      const t = (m[1] as string).toLowerCase();
      const cols = out.get(t) ?? new Set<string>();
      cols.add((m[2] as string).toLowerCase());
      out.set(t, cols);
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
