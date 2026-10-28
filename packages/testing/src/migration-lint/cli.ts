#!/usr/bin/env node
// infrabyx-migration-lint <dir>... [--contract-label] [--record-checksums]
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { lintDir, recordChecksums } from "./index.js";

export async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "contract-label": { type: "boolean", default: false },
      "record-checksums": { type: "boolean", default: false },
    },
  });
  if (positionals.length === 0) {
    process.stderr.write(
      "usage: infrabyx-migration-lint <migrations dir>... [--contract-label] [--record-checksums]\n",
    );
    return 2;
  }
  let errors = 0;
  for (const dir of positionals) {
    if (values["record-checksums"]) {
      const added = await recordChecksums(dir);
      process.stdout.write(`${dir}: recorded ${added.length} checksum(s)\n`);
    }
    const r = await lintDir(dir, { contractLabel: values["contract-label"] });
    for (const f of r.findings)
      process.stdout.write(`${f.severity} ${f.code} ${f.rule} ${f.file}: ${f.message}\n`);
    errors += r.findings.filter((f) => f.severity === "error").length;
    process.stdout.write(`${dir}: ${r.files.length} file(s), ${r.findings.length} finding(s)\n`);
  }
  return errors ? 1 : 0;
}

// pnpm and npm run a bin through a symlink; Node resolves the module to its real path (PR-UDF-005).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
