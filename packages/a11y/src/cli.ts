#!/usr/bin/env node
// infrabyx-a11y (IPB-06-54, 06-57, 06-58, 06-22):
//   infrabyx-a11y journeys-lint <journeys.yaml>... [--routes <file>] [--at-scripts <dir>]
//   infrabyx-a11y overlay-scan <file or directory>... [--extra <signature>]...
//   infrabyx-a11y statement <release-record.json> [--out <file.html>] [--json <file.json>]
//   infrabyx-a11y lighthouse <lhr.json>... [--min <n>]
// Each exits 1 on an error finding and 2 on bad usage.
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { lintJourneys } from "./journeys.js";
import {
  evaluateLighthouse,
  formatLighthouseVerdict,
  type LighthouseResult,
} from "./lighthouse.js";
import { scanPaths } from "./overlay.js";
import { generateStatement, renderStatementHtml, type ReleaseRecord } from "./statement.js";

const USAGE = `usage:
  infrabyx-a11y journeys-lint <journeys.yaml>... [--routes <file>] [--at-scripts <dir>]
  infrabyx-a11y overlay-scan <file or directory>... [--extra <signature>]...
  infrabyx-a11y statement <release-record.json> [--out <file.html>] [--json <file.json>]
  infrabyx-a11y lighthouse <lhr.json>... [--min <n>]
`;

function split(args: readonly string[], flags: readonly string[]) {
  const positional: string[] = [];
  const opts: Record<string, string[]> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const v = args[i + 1];
      if (!flags.includes(name) || v === undefined) throw new Error(`unknown or empty option ${a}`);
      (opts[name] ??= []).push(v);
      i++;
    } else positional.push(a);
  }
  return { positional, opts };
}

/** A routes file is a JSON array of paths or one path per line (`#` comments allowed). */
function readRoutes(file: string): string[] {
  const text = readFileSync(file, "utf8");
  if (text.trimStart().startsWith("[")) return JSON.parse(text) as string[];
  return text
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
}

const out = (s: string) => process.stdout.write(`${s}\n`);

export function main(argv: readonly string[]): number {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "journeys-lint") {
      const { positional, opts } = split(rest, ["routes", "at-scripts"]);
      if (!positional.length) throw new Error("no journeys file");
      const routes = opts["routes"]?.flatMap(readRoutes);
      const atDir = opts["at-scripts"]?.[0];
      let errors = 0;
      for (const f of positional) {
        const findings = lintJourneys(parseYaml(readFileSync(f, "utf8")), {
          ...(routes ? { routes } : {}),
          ...(atDir
            ? {
                atScriptExists: (p: string, file: string) =>
                  existsSync(join(atDir, p.toLowerCase(), file)),
              }
            : {}),
        });
        for (const x of findings)
          out(`${f} ${x.subject} ${x.severity}${x.code ? ` ${x.code}` : ""}: ${x.message}`);
        errors += findings.filter((x) => x.severity === "error").length;
      }
      out(
        `journeys-lint: ${positional.length} registr${positional.length === 1 ? "y" : "ies"}, ${errors} error(s)`,
      );
      return errors ? 1 : 0;
    }
    if (cmd === "overlay-scan") {
      const { positional, opts } = split(rest, ["extra"]);
      if (!positional.length) throw new Error("no path to scan");
      const findings = scanPaths(positional, opts["extra"] ?? []);
      for (const f of findings)
        out(`${f.source}:${f.line} ${f.code}: accessibility overlay signature "${f.signature}"`);
      out(`overlay-scan: ${findings.length} finding(s)`);
      return findings.length ? 1 : 0;
    }
    if (cmd === "statement") {
      const { positional, opts } = split(rest, ["out", "json"]);
      const file = positional[0];
      if (!file) throw new Error("no release record");
      const s = generateStatement(JSON.parse(readFileSync(file, "utf8")) as ReleaseRecord);
      for (const f of s.findings) out(`${f.code}: ${f.message}`);
      const html = renderStatementHtml(s);
      if (opts["out"]?.[0]) writeFileSync(opts["out"][0], `${html}\n`);
      else out(html);
      if (opts["json"]?.[0]) writeFileSync(opts["json"][0], `${JSON.stringify(s, null, 2)}\n`);
      out(
        `statement: ${s.summary.conforms} conform, ${s.summary.partially_conforms} partially, ${s.summary.does_not_conform} do not`,
      );
      return 0;
    }
    if (cmd === "lighthouse") {
      const { positional, opts } = split(rest, ["min"]);
      if (!positional.length) throw new Error("no Lighthouse result file");
      const min = opts["min"]?.[0] ? Number(opts["min"][0]) : undefined;
      let failed = 0;
      for (const f of positional) {
        const v = evaluateLighthouse(
          JSON.parse(readFileSync(f, "utf8")) as LighthouseResult,
          min === undefined ? {} : { min },
        );
        out(formatLighthouseVerdict(v));
        if (!v.ok) failed++;
      }
      out(`lighthouse: ${positional.length} page(s), ${failed} below the gate`);
      return failed ? 1 : 0;
    }
  } catch (e) {
    process.stderr.write(`infrabyx-a11y: ${(e as Error).message}\n`);
    return cmd && ["journeys-lint", "overlay-scan", "statement", "lighthouse"].includes(cmd)
      ? 1
      : 2;
  }
  process.stderr.write(USAGE);
  return 2;
}

// Through `node_modules/.bin` the script path is a symlink; compare the real path.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href)
  process.exitCode = main(process.argv.slice(2));
