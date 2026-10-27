#!/usr/bin/env node
// infrabyx-vidhi (OWNER-QUESTIONS #37, PL4-D-13):
//   infrabyx-vidhi manifest-lint <file or directory>...
// Lints every `*.manifest.json` under the given paths (node_modules and dist skipped). Exits 1 when
// any manifest has an error, such as a tool without an explicit `locked`.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { lintManifest, type ManifestLintFinding } from "./manifest-lint.js";

function manifestFiles(paths: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort())
        if (f !== "node_modules" && f !== "dist") walk(join(p, f));
    } else if (p.endsWith(".manifest.json")) out.push(p);
  };
  for (const p of paths) walk(p);
  return out;
}

export function main(argv: readonly string[]): number {
  const [cmd, ...paths] = argv;
  if (cmd !== "manifest-lint" || !paths.length) {
    process.stderr.write("usage: infrabyx-vidhi manifest-lint <file or directory>...\n");
    return 2;
  }
  const files = manifestFiles(paths);
  const findings: ManifestLintFinding[] = [];
  for (const f of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      findings.push({ file: f, key: "?", severity: "error", message: (e as Error).message });
      continue;
    }
    findings.push(...lintManifest(raw, f));
  }
  for (const x of findings)
    process.stdout.write(`${x.file} ${x.key} ${x.severity}: ${x.message}\n`);
  const errors = findings.filter((x) => x.severity === "error").length;
  process.stdout.write(`manifest-lint: ${files.length} manifest(s), ${errors} error(s)\n`);
  return errors ? 1 : 0;
}

// Through `node_modules/.bin` the script path is a symlink; compare the real path.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href)
  process.exitCode = main(process.argv.slice(2));
