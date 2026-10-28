#!/usr/bin/env node
// Ruleset reconcile (IPB-09 §09.4.1.4; PL6-D-17): compares the live GitHub rulesets of this
// repository with infra/policy/github/rulesets.json, the policy file of record, and fails on drift.
// A ruleset the file marks `"$enforceable": false` (a rule the repository's plan cannot enforce, such
// as branch-name restrictions outside Enterprise) is expected to be missing: its absence is not
// drift, and its presence is reported as a note. For each ruleset the file lists, the target,
// enforcement, bypass actors, ref conditions, the set of rule types and every parameter the file
// states must match; parameters GitHub adds that the file does not state are ignored. Required
// status checks compare as a set of contexts.
//   node scripts/ruleset-reconcile.mjs [--repo owner/name] [--file <rulesets.json>]
// Reads the GitHub REST API with GITHUB_TOKEN when set (the rulesets of a public repository are
// readable without one). Exit 1 on drift, 2 when the API cannot be read.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const sorted = (a) => [...a].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function compareParams(path, want, got, out) {
  for (const [k, v] of Object.entries(want ?? {})) {
    if (k.startsWith("$")) continue;
    if (k === "required_status_checks") {
      const w = sorted(v.map((c) => c.context));
      const g = sorted((got?.[k] ?? []).map((c) => c.context));
      if (!same(w, g)) out.push(`${path}.${k}: file [${w.join(", ")}], live [${g.join(", ")}]`);
    } else if (
      !same(Array.isArray(v) ? sorted(v) : v, Array.isArray(got?.[k]) ? sorted(got[k]) : got?.[k])
    ) {
      out.push(`${path}.${k}: file ${JSON.stringify(v)}, live ${JSON.stringify(got?.[k])}`);
    }
  }
}

/** Compare the policy file with the live rulesets; returns { drift: string[], notes: string[] }. */
export function reconcile(file, live) {
  const drift = [];
  const notes = [];
  const byName = new Map(live.map((r) => [r.name, r]));
  for (const want of file.rulesets) {
    const got = byName.get(want.name);
    byName.delete(want.name);
    if (want.$enforceable === false) {
      if (got)
        notes.push(`${want.name}: marked not enforceable on the current plan, but present live`);
      else notes.push(`${want.name}: not enforceable on the current plan; expected missing`);
      continue;
    }
    if (!got) {
      drift.push(`${want.name}: in the policy file, missing live`);
      continue;
    }
    for (const k of ["target", "enforcement"])
      if (want[k] !== got[k]) drift.push(`${want.name}.${k}: file ${want[k]}, live ${got[k]}`);
    if ((want.bypass_actors ?? []).length !== (got.bypass_actors ?? []).length)
      drift.push(
        `${want.name}.bypass_actors: file ${(want.bypass_actors ?? []).length}, live ${(got.bypass_actors ?? []).length}`,
      );
    for (const k of ["include", "exclude"]) {
      const w = sorted(want.conditions?.ref_name?.[k] ?? []);
      const g = sorted(got.conditions?.ref_name?.[k] ?? []);
      if (!same(w, g))
        drift.push(
          `${want.name}.conditions.ref_name.${k}: file ${JSON.stringify(w)}, live ${JSON.stringify(g)}`,
        );
    }
    const liveRules = new Map((got.rules ?? []).map((r) => [r.type, r]));
    for (const rule of want.rules) {
      const g = liveRules.get(rule.type);
      liveRules.delete(rule.type);
      if (!g) {
        drift.push(`${want.name}.rules.${rule.type}: in the policy file, missing live`);
        continue;
      }
      compareParams(`${want.name}.rules.${rule.type}`, rule.parameters, g.parameters, drift);
    }
    for (const type of liveRules.keys())
      drift.push(`${want.name}.rules.${type}: live, not in the policy file`);
  }
  for (const name of byName.keys()) drift.push(`${name}: live, not in the policy file`);
  return { drift, notes };
}

async function api(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: "string", default: env.GITHUB_REPOSITORY ?? "Infrabyx/Infrabyx-platform" },
      file: { type: "string", default: "infra/policy/github/rulesets.json" },
    },
  });
  const file = JSON.parse(readFileSync(values.file, "utf8"));
  let live;
  try {
    const list = await api(
      `/repos/${values.repo}/rulesets?includes_parents=false`,
      env.GITHUB_TOKEN,
    );
    live = await Promise.all(
      list.map((r) => api(`/repos/${values.repo}/rulesets/${r.id}`, env.GITHUB_TOKEN)),
    );
  } catch (e) {
    console.error(`ruleset-reconcile: ${e.message}`);
    return 2;
  }
  const { drift, notes } = reconcile(file, live);
  for (const n of notes) console.log(`note: ${n}`);
  for (const d of drift) console.log(`DRIFT: ${d}`);
  console.log(drift.length ? `${drift.length} drift item(s)` : "rulesets match the policy file");
  return drift.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
