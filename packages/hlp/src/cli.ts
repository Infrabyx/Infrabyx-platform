#!/usr/bin/env node
// infrabyx-hlp (IPB-07-43, IPB-07-53):
//   infrabyx-hlp lint --registry <dir>... --keys <file or directory>...
//                     [--tours <file>...] [--journeys <file>...] [--allow-draft]
// Exits 1 on an error finding (IPB-HLP-001…004, IPB-TUT-003) and 2 on bad usage. Pass
// --allow-draft off the production branch, where draft entries satisfy the lint.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { collectKeys, lintHelp, type KeyUse } from "./lint.js";
import { loadRegistry } from "./registry.js";
import { lintTours } from "./tours.js";

const USAGE =
  "usage: infrabyx-hlp lint --registry <dir>... --keys <file or directory>... [--tours <file>...] [--journeys <file>...] [--allow-draft]\n";

export function main(argv: readonly string[]): number {
  const [cmd, ...rest] = argv;
  if (cmd !== "lint") {
    process.stderr.write(USAGE);
    return 2;
  }
  const opts: Record<string, string[]> = {};
  let allowDraft = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--allow-draft") allowDraft = true;
    else if (["--registry", "--keys", "--tours", "--journeys"].includes(a)) {
      const list = (opts[a.slice(2)] ??= []);
      while (rest[i + 1] !== undefined && !rest[i + 1]!.startsWith("--")) list.push(rest[++i]!);
    } else {
      process.stderr.write(`infrabyx-hlp: unknown or empty option ${a}\n${USAGE}`);
      return 2;
    }
  }
  if (!opts["registry"]?.length || !opts["keys"]?.length) {
    process.stderr.write(USAGE);
    return 2;
  }
  const out = (s: string) => process.stdout.write(`${s}\n`);
  try {
    const reg = loadRegistry(opts["registry"]);
    let errors = 0;
    for (const i of reg.issues) {
      out(`${i.file} ${i.key} error: ${i.message}`);
      errors++;
    }
    const uses: KeyUse[] = collectKeys(opts["keys"]);
    const regulated = (opts["journeys"] ?? []).flatMap((f) => {
      const doc = parseYaml(readFileSync(f, "utf8")) as {
        journeys?: { regulated_steps?: string[] }[];
      };
      return (doc.journeys ?? []).flatMap((j) => j.regulated_steps ?? []);
    });
    for (const f of opts["tours"] ?? []) {
      const doc = parseYaml(readFileSync(f, "utf8")) as { tours?: unknown[] };
      const t = lintTours(doc.tours ?? [], { regulatedRoutes: regulated });
      for (const x of t.findings) {
        out(`${f} ${x.tour} error${x.code ? ` ${x.code}` : ""}: ${x.message}`);
        errors++;
      }
      uses.push(...t.keys.map((key) => ({ key, file: f, line: 0 })));
    }
    for (const x of lintHelp(reg.entries, uses, { allowDraft, sources: reg.sources })) {
      out(`${x.where} ${x.key} ${x.severity}${x.code ? ` ${x.code}` : ""}: ${x.message}`);
      if (x.severity === "error") errors++;
    }
    out(`hlp-lint: ${reg.entries.length} entries, ${uses.length} key use(s), ${errors} error(s)`);
    return errors ? 1 : 0;
  } catch (e) {
    process.stderr.write(`infrabyx-hlp: ${(e as Error).message}\n`);
    return 1;
  }
}

// Through `node_modules/.bin` the script path is a symlink; compare the real path.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href)
  process.exitCode = main(process.argv.slice(2));
