#!/usr/bin/env node
// infrabyx-routing check <file...> [--sandbox-status packages/connectors/sandbox-status.json]
// Validates provider_routing files in CI (IPB-01-20) and refuses unproven adapters in staging and
// above (IPB-DEV-04). Prints problems only; secrets are paths, never values.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isIpbError } from "@infrabyx/contracts/errors";
import { loadRoutingFile, loadUnprovenAdapters } from "./index.js";

export async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { "sandbox-status": { type: "string" } },
  });
  const [cmd, ...files] = positionals;
  if (cmd !== "check" || files.length === 0) {
    process.stderr.write("usage: infrabyx-routing check <file...> [--sandbox-status <json>]\n");
    return 2;
  }
  const unprovenAdapters = values["sandbox-status"]
    ? await loadUnprovenAdapters(values["sandbox-status"])
    : undefined;
  let failed = 0;
  for (const f of files) {
    try {
      const r = await loadRoutingFile(f, unprovenAdapters ? { unprovenAdapters } : {});
      process.stdout.write(`ok ${f} (${r.env}, ${Object.keys(r.file.ports).length} ports)\n`);
    } catch (e) {
      failed++;
      const problems = isIpbError(e) ? ((e.meta?.problems as string[] | undefined) ?? []) : [];
      process.stderr.write(`${isIpbError(e) ? e.code : "error"} ${f}: ${(e as Error).message}\n`);
      for (const p of problems) process.stderr.write(`  - ${p}\n`);
    }
  }
  return failed ? 1 : 0;
}

// pnpm and npm run a bin through a symlink; Node resolves the module to its real path (PR-UDF-005).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
