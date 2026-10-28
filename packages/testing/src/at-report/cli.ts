#!/usr/bin/env node
// infrabyx-at-report [--root .] [--results vitest.json]... [--spec docs/ipb] [--only IPB-02,IPB-11]
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { applyResults, collectTags, renderReport, specAts } from "./index.js";

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: "string", default: "." },
      results: { type: "string", multiple: true },
      spec: { type: "string" },
      only: { type: "string" },
    },
  });
  const tags = await collectTags(values.root);
  if (values.results?.length) await applyResults(tags, values.results);
  const only = values.only?.split(",").filter(Boolean) ?? [];
  let spec = values.spec ? await specAts(values.spec) : [];
  if (only.length) spec = spec.filter((a) => only.some((o) => a.startsWith(o)));
  process.stdout.write(renderReport(tags, spec, only));
  return 0;
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
