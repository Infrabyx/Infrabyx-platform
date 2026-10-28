// The ruleset reconcile (PL6-D-17): live rulesets against the policy file of record.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reconcile } from "./ruleset-reconcile.mjs";

const FILE = JSON.parse(
  readFileSync(new URL("../infra/policy/github/rulesets.json", import.meta.url), "utf8"),
);
// What GitHub returns for the applied rulesets: no annotations, its own extra parameters.
const live = () =>
  FILE.rulesets
    .filter((r) => r.$enforceable !== false)
    .map((r, i) => ({
      id: i + 1,
      name: r.name,
      target: r.target,
      enforcement: r.enforcement,
      bypass_actors: r.bypass_actors,
      conditions: r.conditions,
      rules: r.rules.map((x) => ({
        type: x.type,
        ...(x.parameters
          ? {
              parameters: {
                ...x.parameters,
                require_extra_approval_for_unattributed_changes: true,
              },
            }
          : {}),
      })),
    }));

describe("ruleset reconcile", () => {
  it("matches the applied rulesets and treats the unenforceable one as expected-missing", () => {
    const { drift, notes } = reconcile(FILE, live());
    expect(drift).toEqual([]);
    expect(notes).toEqual(["branch-naming: not enforceable on the current plan; expected missing"]);
  });

  it("reports a missing ruleset, a changed required check, a changed merge method and an extra rule", () => {
    const l = live().filter((r) => r.name !== "release-tags");
    const main = l.find((r) => r.name === "main");
    const checks = main.rules.find((r) => r.type === "required_status_checks");
    checks.parameters.required_status_checks = checks.parameters.required_status_checks.filter(
      (c) => c.context !== "scaffold",
    );
    main.rules.find((r) => r.type === "pull_request").parameters.allowed_merge_methods = [
      "squash",
      "rebase",
    ];
    main.rules.push({ type: "update" });
    const { drift } = reconcile(FILE, l);
    expect(drift).toHaveLength(4);
    expect(drift.join("\n")).toMatch(/release-tags: in the policy file, missing live/);
    expect(drift.join("\n")).toMatch(/main\.rules\.required_status_checks\.required_status_checks/);
    expect(drift.join("\n")).toMatch(/main\.rules\.pull_request\.allowed_merge_methods/);
    expect(drift.join("\n")).toMatch(/main\.rules\.update: live, not in the policy file/);
  });

  it("reports a live ruleset the file does not know, and notes an unenforceable one that appears", () => {
    const l = [...live(), { name: "ad-hoc", target: "branch", enforcement: "active", rules: [] }];
    l.push({ ...FILE.rulesets.find((r) => r.name === "branch-naming"), $enforceable: undefined });
    const { drift, notes } = reconcile(FILE, l);
    expect(drift).toEqual(["ad-hoc: live, not in the policy file"]);
    expect(notes[0]).toMatch(/branch-naming: marked not enforceable.*present live/);
  });
});
