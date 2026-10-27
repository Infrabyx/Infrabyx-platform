#!/usr/bin/env node
// infrabyx-export (PL3 plan §7.4):
//   map-gate --base <git ref> [--unchanged-label] [--maps <dir>] [--export-dir <dir>]
//            [--migrations <dir>]...                      export-map-gate (IPB-09-34, IPB-ENG-006)
//   diff <archive.zip | folder> --golden <folder>           golden-archive-diff (IPB-09-35, IPB-ENG-007)
//   verify <archive.zip>                                    hashes, signature, totals, audit chain
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ExportMap } from "@infrabyx/contracts/export";
import { diffArchives, loadArchiveFiles } from "./diff.js";
import { exportMapGate, type MapChange } from "./gate.js";
import { readZip } from "./zip.js";

const out = (s: string) => void process.stdout.write(`${s}\n`);

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function flags(argv: string[], name: string): string[] {
  const r: string[] = [];
  argv.forEach((a, i) => {
    if (a === name && argv[i + 1]) r.push(argv[i + 1] as string);
  });
  return r;
}

const git = (args: string[]): string => execFileSync("git", args, { encoding: "utf8" });
const gitShow = (ref: string, path: string): string | null => {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};
const sqlFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .sort()
        .map((f) => ({ path: join(dir, f), sql: readFileSync(join(dir, f), "utf8") }))
    : [];

export function mapGate(argv: string[]): number {
  const base = flag(argv, "--base");
  if (!base) throw new Error("map-gate needs --base <git ref>");
  const mapsDir = flag(argv, "--maps") ?? "packages/export/maps";
  const exportDir = flag(argv, "--export-dir") ?? "packages/export";
  let migrationDirs = flags(argv, "--migrations");
  if (!migrationDirs.length)
    migrationDirs = [
      ...(existsSync("packages")
        ? readdirSync("packages").map((p) => join("packages", p, "migrations"))
        : []),
      "migrations",
    ].filter((d) => existsSync(d));
  const changed = git(["diff", "--name-only", `${base}...HEAD`])
    .split("\n")
    .filter(Boolean);
  const isMap = (f: string) =>
    f.startsWith(`${mapsDir.replace(/\/$/, "")}/`) && f.endsWith(".json");
  const parse = (t: string | null) => (t === null ? null : ExportMap.parse(JSON.parse(t)));
  const mapChanges: MapChange[] = changed.filter(isMap).map((p) => ({
    path: p,
    before: parse(gitShow(base, p)),
    after: existsSync(p) ? parse(readFileSync(p, "utf8")) : null,
  }));
  const maps = existsSync(mapsDir)
    ? readdirSync(mapsDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ExportMap.parse(JSON.parse(readFileSync(join(mapsDir, f), "utf8"))))
    : [];
  const all = migrationDirs.flatMap(sqlFiles);
  const changedSet = new Set(changed);
  const r = exportMapGate({
    changedFiles: changed,
    maps,
    mapChanges,
    changedMigrations: all.filter((m) => changedSet.has(m.path)),
    allMigrations: all,
    changesets: changed
      .filter((f) => f.startsWith(".changeset/") && f.endsWith(".md") && existsSync(f))
      .map((f) => readFileSync(f, "utf8")),
    unchangedLabel: argv.includes("--unchanged-label"),
    exportDir,
  });
  for (const t of r.triggers) out(`trigger: ${t}`);
  for (const f of r.findings) out(`IPB-ENG-006 ${f}`);
  out(
    `export-map-gate: ${r.ok ? "pass" : "fail"} (${r.triggers.length} trigger(s), ${r.findings.length} finding(s))`,
  );
  return r.ok ? 0 : 1;
}

export function diff(argv: string[]): number {
  const archive = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--golden");
  const golden = flag(argv, "--golden");
  if (!archive || !golden) throw new Error("diff needs <archive> --golden <folder>");
  const d = diffArchives(loadArchiveFiles(archive), loadArchiveFiles(golden));
  for (const x of d) out(`IPB-ENG-007 ${x.kind}: ${x.path}`);
  out(`golden-archive-diff: ${d.length ? "fail" : "pass"} (${d.length} difference(s))`);
  return d.length ? 1 : 0;
}

/** Extract an archive to a temporary folder and run its own offline verifier. */
export function verify(argv: string[]): number {
  const zip = argv[0];
  if (!zip) throw new Error("verify needs <archive.zip>");
  const dir = mkdtempSync(join(tmpdir(), "ipb-archive-"));
  try {
    let root = "";
    for (const [p, b] of readZip(readFileSync(zip))) {
      root = p.slice(0, p.indexOf("/"));
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), b);
    }
    execFileSync(process.execPath, [join(dir, root, "00 Start Here", "verify", "verify.mjs")], {
      stdio: "inherit",
    });
    return 0;
  } catch {
    return 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (cmd === "map-gate") return mapGate(rest);
  if (cmd === "diff") return diff(rest);
  if (cmd === "verify") return verify(rest);
  out("usage: infrabyx-export map-gate|diff|verify …");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  process.exit(main(process.argv.slice(2)));
