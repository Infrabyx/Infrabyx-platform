// Skill manifest lint (IPB-03-61; OWNER-QUESTIONS #37, PL4-D-13). Products run
// `infrabyx-vidhi manifest-lint <dir or file>...` in CI over their `skill.manifest.json` files. It
// applies the same checks as `SkillRegistry.load` at boot, and names the owner's rule plainly: every
// tool declares `locked: true` or `locked: false`. Word matching against the kernel locked list
// stays the safety net, so the lint also reports a tool declared `false` that the list locks by
// name (a note, not a failure: `false` never unlocks it).
import { SkillRegistry, toolPolicy } from "./skills.js";
import { SkillManifest } from "@infrabyx/contracts/vidhi";

export interface ManifestLintFinding {
  file: string;
  key: string;
  severity: "error" | "note";
  message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Lint one parsed manifest. `file` only labels the findings. */
export function lintManifest(raw: unknown, file: string): ManifestLintFinding[] {
  const key = isRecord(raw) && typeof raw.key === "string" ? raw.key : "?";
  const out: ManifestLintFinding[] = [];
  const tools = isRecord(raw) && Array.isArray(raw.tools) ? raw.tools : [];
  for (const t of tools) {
    if (isRecord(t) && typeof t.locked !== "boolean")
      out.push({
        file,
        key,
        severity: "error",
        message: `tool ${String(t.name ?? "?")} must declare locked: true or locked: false`,
      });
  }
  const registry = new SkillRegistry().load([raw]);
  for (const i of registry.issues) out.push({ file, key, severity: "error", message: i.reason });
  const parsed = SkillManifest.safeParse(raw);
  if (parsed.success && !registry.issues.length)
    for (const t of parsed.data.tools) {
      const p = toolPolicy(parsed.data, t);
      if (!t.locked && p.locked)
        out.push({
          file,
          key,
          severity: "note",
          message: `tool ${t.name} is declared locked: false but the kernel list locks it (${p.locked.category})`,
        });
    }
  return out;
}
