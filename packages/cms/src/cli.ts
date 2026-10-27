#!/usr/bin/env node
// infrabyx-cms (PL5 plan §5.6, §11): `validate-footer <file.json>...` fails CI when any published
// brand pack's footer has an empty mandatory field (IPB-04-71, `@IPB-04-AT-73`). Each file holds
// one FooterInput or an array of them (the site build writes it from `footerInputFrom`).
import { readFile } from "node:fs/promises";
import { footerReport, validateFooter, type FooterInput } from "./footer.js";

async function main(argv: string[]): Promise<number> {
  const [cmd, ...files] = argv;
  if (cmd !== "validate-footer" || !files.length) {
    console.error("usage: infrabyx-cms validate-footer <footer-input.json>...");
    return 2;
  }
  const findings = [];
  let packs = 0;
  for (const f of files) {
    const data = JSON.parse(await readFile(f, "utf8")) as FooterInput | FooterInput[];
    for (const input of Array.isArray(data) ? data : [data]) {
      packs++;
      findings.push(...validateFooter(input));
    }
  }
  if (findings.length) {
    console.error(footerReport(findings));
    return 1;
  }
  console.log(`validate-footer: ${packs} pack(s), every mandatory field present`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
