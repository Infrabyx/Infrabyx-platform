#!/usr/bin/env node
// infrabyx-ai (PL4 plan §4.4, §4.7):
//   infrabyx-ai prompt-lint [--root <repo>]
//   infrabyx-ai eval [--key <prompt_key>] [--write] [--live --approved-by <owner ticket>]
//   infrabyx-ai prompts sync --db <url> --actor <usr_id> --env <APP_ENV>
// `eval` runs every platform golden set against the scripted fake model and fails when a score
// falls below its baseline or a committed result is stale (`--write` refreshes the results).
// `--live` would call paid providers: it refuses to start without `--approved-by`, and no live
// target is wired in this repository (owner decision O-6).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  gateAgainstBaseline,
  lintPrompts,
  loadEvalSet,
  pipelineTarget,
  platformEvalsDir,
  reportFile,
  runEvalSet,
} from "./evals.js";
import { loadPromptFiles, platformPromptsDir } from "./prompt-files.js";
import { syncPrompts } from "./prompt-sync.js";

const say = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

function sources(root: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === "node_modules" || f === "dist" || f === "__tests__") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
        out.push({ path: p, text: readFileSync(p, "utf8") });
    }
  };
  for (const top of ["packages", "apps"]) {
    const d = join(root, top);
    if (!existsSync(d)) continue;
    for (const pkg of readdirSync(d)) {
      // The test kit holds stubs and fixtures, not product prompts.
      if (top === "packages" && pkg === "testing") continue;
      const src = join(d, pkg, "src");
      if (existsSync(src)) walk(src);
    }
  }
  return out;
}

async function evalCommand(v: Record<string, unknown>): Promise<number> {
  if (v.live) {
    if (typeof v["approved-by"] !== "string" || !/^[A-Za-z0-9#._:/-]{3,}$/.test(v["approved-by"])) {
      err("--live calls paid providers: it needs --approved-by <owner approval reference> (O-6)");
      return 78;
    }
    err(
      "no live eval target is wired in this repository: run live evals from a deployment with provider accounts",
    );
    return 2;
  }
  const { modelId, target } = pipelineTarget();
  let failed = 0;
  for (const p of loadPromptFiles()) {
    if (typeof v.key === "string" && v.key !== p.promptKey) continue;
    const set = loadEvalSet(p.promptKey);
    if (!set?.baseline) {
      err(`${p.promptKey}@${p.version}: no golden set or baseline (run prompt-lint)`);
      failed++;
      continue;
    }
    const r = await runEvalSet({ prompt: p, cases: set.cases, target, modelId });
    const g = gateAgainstBaseline(r, set.baseline);
    say(
      `${g.ok ? "ok  " : "FAIL"} ${p.promptKey}@${p.version}: ${r.passed}/${r.total} (score ${r.score}, floor ${g.floor})`,
    );
    for (const f of r.failures.slice(0, 20)) say(`       ${f.id} [${f.grader}] ${f.reason}`);
    if (!g.ok) failed++;
    const file = join(platformEvalsDir(), p.promptKey, "results", `${p.version}.json`);
    if (v.write) {
      mkdirSync(join(platformEvalsDir(), p.promptKey, "results"), { recursive: true });
      writeFileSync(file, reportFile(r));
    } else {
      const stored = set.results.get(p.version);
      if (!stored || reportFile(stored) !== reportFile(r)) {
        err(
          `${p.promptKey}@${p.version}: results/${p.version}.json is missing or stale; run eval --write`,
        );
        failed++;
      }
    }
  }
  return failed ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: "string", default: "." },
      key: { type: "string" },
      write: { type: "boolean", default: false },
      live: { type: "boolean", default: false },
      "approved-by": { type: "string" },
      db: { type: "string" },
      actor: { type: "string" },
      env: { type: "string" },
    },
  });
  const [cmd, sub] = positionals;
  if (cmd === "prompt-lint") {
    const root = resolve(v.root as string);
    const findings = lintPrompts({
      prompts: loadPromptFiles(platformPromptsDir()),
      evalsDir: platformEvalsDir(),
      sourceFiles: sources(root),
      root,
    });
    for (const f of findings) err(`${f.file}: ${f.message}`);
    say(`ai-prompt-lint: ${findings.length} finding(s)`);
    return findings.length ? 1 : 0;
  }
  if (cmd === "eval") return evalCommand(v);
  if (cmd === "prompts" && sub === "sync") {
    if (!v.db || !v.actor || !v.env) {
      err("usage: infrabyx-ai prompts sync --db <url> --actor <usr_id> --env <APP_ENV>");
      return 2;
    }
    const pg = (await import("pg")).default;
    const { PgKernel } = await import("@infrabyx/tenancy");
    const { PgAuditSink } = await import("@infrabyx/audit");
    const pool = new pg.Pool({ connectionString: v.db });
    try {
      const results = await syncPrompts({
        kernel: new PgKernel({ pool }),
        audit: new PgAuditSink(),
        actorId: v.actor,
        env: v.env,
        prompts: loadPromptFiles(),
      });
      for (const r of results)
        say(`${r.action.padEnd(10)} ${r.key}@${r.version}${r.reason ? ` (${r.reason})` : ""}`);
      return 0;
    } finally {
      await pool.end();
    }
  }
  err(
    "usage: infrabyx-ai prompt-lint | eval [--write] | prompts sync --db <url> --actor <id> --env <env>",
  );
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      err((e as Error).message);
      process.exit(1);
    },
  );
}
