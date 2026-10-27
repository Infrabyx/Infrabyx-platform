#!/usr/bin/env node
// infrabyx-notify-lint <file-or-dir>... [--meta-marketing-enabled]
// Lints notification catalogue files (PL3 plan §6.2); the platform file is always included.
import { pathToFileURL } from "node:url";
import { lintCatalogues, PLATFORM_CATALOGUE_PATH, readCatalogueFiles } from "./catalogue.js";

export function main(argv: string[]): number {
  const meta = argv.includes("--meta-marketing-enabled");
  const paths = argv.filter((a) => !a.startsWith("--"));
  const findings = lintCatalogues(readCatalogueFiles([PLATFORM_CATALOGUE_PATH, ...paths]), {
    metaMarketingEnabled: meta,
  });
  for (const f of findings)
    process.stdout.write(`${f.file}${f.classId ? ` ${f.classId}` : ""}: ${f.message}\n`);
  process.stdout.write(`notify-lint: ${findings.length} finding(s)\n`);
  return findings.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  process.exit(main(process.argv.slice(2)));
