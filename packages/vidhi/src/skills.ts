// Skill manifests (IPB-03-61, §03.4.6; PL4 plan §8.1). `SkillRegistry.load` validates every
// manifest at boot: an invalid one is disabled and reported with `IPB-VID-001`, and the others
// still load. A tool that is `locked: true`, or whose name matches the kernel locked list (or the
// product's additions), caps that tool's effective ceiling at L2.
import { SkillManifest, type AutonomyLevel, type SkillTool } from "@infrabyx/contracts/vidhi";
import { lockedCategory, type LockedMatch } from "./locked.js";

/** Last segments that make a non-write tool a read (listing payments is not making one). */
const READ_VERBS = new Set([
  "get",
  "list",
  "read",
  "view",
  "search",
  "lookup",
  "find",
  "explain",
  "summary",
  "summarise",
  "summarize",
  "describe",
  "status",
  "preview",
  "count",
]);

export interface ToolPolicy {
  tool: SkillTool;
  /** The locked category, or null for an ordinary tool. */
  locked: LockedMatch | null;
  /** L2 for a locked tool, otherwise the skill ceiling. */
  ceiling: AutonomyLevel;
}

export interface LoadedSkill {
  manifest: SkillManifest;
  tools: ReadonlyMap<string, ToolPolicy>;
}

export interface SkillLoadIssue {
  key: string;
  code: "IPB-VID-001";
  reason: string;
}

export function toolPolicy(manifest: SkillManifest, tool: SkillTool): ToolPolicy {
  const words = tool.name.split(".").at(-1)?.split("_") ?? [];
  const read = !tool.write && words.some((w) => READ_VERBS.has(w));
  const match = lockedCategory(tool.name, manifest.product);
  const locked = tool.locked
    ? (match ?? { category: "approval" as const, defaultRole: tool.required_role ?? "ORG_CHECKER" })
    : match && !read
      ? match
      : null;
  const rank = ["L0", "L1", "L2", "L3", "L4"];
  const ceiling =
    locked && rank.indexOf(manifest.autonomy_ceiling) > 2 ? "L2" : manifest.autonomy_ceiling;
  return { tool, locked, ceiling };
}

export class SkillRegistry {
  private readonly skills = new Map<string, LoadedSkill>();
  readonly issues: SkillLoadIssue[] = [];

  /**
   * Validate and register manifests. `promptExists` and `evalSetExists` check the references
   * (IPB-03-61); a failing check disables the skill like a schema error.
   */
  load(
    manifests: readonly unknown[],
    o: {
      promptExists?: (promptKey: string) => boolean;
      evalSetExists?: (ref: string) => boolean;
      onInvalid?: (issue: SkillLoadIssue) => void;
    } = {},
  ): this {
    for (const raw of manifests) {
      const key =
        typeof (raw as { key?: unknown })?.key === "string" ? (raw as { key: string }).key : "?";
      const report = (reason: string) => {
        const issue: SkillLoadIssue = { key, code: "IPB-VID-001", reason };
        this.issues.push(issue);
        o.onInvalid?.(issue);
      };
      const r = SkillManifest.safeParse(raw);
      if (!r.success) {
        report(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        continue;
      }
      const m = r.data;
      if (!m.key.startsWith(`${m.product.toLowerCase()}.`) && m.product !== "PLATFORM") {
        report(`key ${m.key} does not start with the product prefix`);
        continue;
      }
      if (o.promptExists && !o.promptExists(m.prompt_key)) {
        report(`prompt ${m.prompt_key} is not in the registry`);
        continue;
      }
      if (o.evalSetExists && !o.evalSetExists(m.eval_set_ref)) {
        report(`eval set ${m.eval_set_ref} is missing`);
        continue;
      }
      if (new Set(m.tools.map((t) => t.name)).size !== m.tools.length) {
        report("a tool is listed twice");
        continue;
      }
      this.skills.set(m.key, {
        manifest: m,
        tools: new Map(m.tools.map((t) => [t.name, toolPolicy(m, t)])),
      });
    }
    return this;
  }

  get(key: string): LoadedSkill | undefined {
    return this.skills.get(key);
  }

  keys(): string[] {
    return [...this.skills.keys()].sort();
  }
}
