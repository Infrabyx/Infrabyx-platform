// Platform prompt files (IPB-03-25; PL4 plan §4.4). Each platform prompt version is one file,
// `packages/ai/prompts/<prompt_key>/<version>.md`: front matter (`key: value` lines; JSON values for
// schemas) between `---` lines, then the logic-less template. `infrabyx-ai prompts sync` loads them
// into the platform tenant; a version that is already stored with other content is refused, because
// a template never changes once it leaves DRAFT.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DataClass } from "@infrabyx/contracts/data-class";
import { PROMPT_REF, promptDigest, templateVariables } from "./prompts.js";

export interface PromptFile {
  path: string;
  promptKey: string;
  version: string;
  ownerRole: string;
  dataClassMax: DataClass;
  evalSetRef: string;
  variablesSchema: Record<string, unknown>;
  /** JSON Schema of the answer, for prompts used with `structured`. */
  outputSchema: Record<string, unknown> | null;
  template: string;
  /** `promptDigest` of this version: what the eval gate grades and the registry stores. */
  contentSha256: string;
}

const CLASSES: readonly DataClass[] = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "REGULATED", "SECRET"];
const KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

/** `packages/ai/prompts` (next to `dist/` and `src/`). */
export const platformPromptsDir = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");

export function parsePromptFile(text: string, path = "<prompt>"): PromptFile {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) throw new Error(`${path}: no front matter`);
  const meta: Record<string, unknown> = {};
  for (const line of (m[1] as string).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i < 1) throw new Error(`${path}: bad front-matter line "${line}"`);
    const k = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    meta[k] = /^[[{]/.test(raw) ? JSON.parse(raw) : raw;
  }
  const template = (m[2] as string).trim();
  const promptKey = String(meta.prompt_key ?? "");
  const version = String(meta.version ?? "");
  const dataClassMax = String(meta.data_class_max ?? "") as DataClass;
  if (!KEY.test(promptKey)) throw new Error(`${path}: prompt_key ${promptKey} is not valid`);
  if (!SEMVER.test(version)) throw new Error(`${path}: version ${version} is not semver`);
  if (!CLASSES.includes(dataClassMax)) throw new Error(`${path}: data_class_max is not a class`);
  if (!PROMPT_REF.test(`${promptKey}@${version.split(".")[0]}`))
    throw new Error(`${path}: ${promptKey} cannot be referenced`);
  const variablesSchema = (meta.variables_schema ?? {}) as Record<string, unknown>;
  const declared = Object.keys(
    ((variablesSchema as { properties?: Record<string, unknown> }).properties ?? {}) as object,
  );
  for (const v of templateVariables(template))
    if (!declared.includes(v)) throw new Error(`${path}: {{${v}}} is not in variables_schema`);
  const ownerRole = String(meta.owner_role ?? "");
  if (!/^[A-Z][A-Z0-9_]+$/.test(ownerRole)) throw new Error(`${path}: owner_role is required`);
  const evalSetRef = String(meta.eval_set_ref ?? `evals/${promptKey}`);
  return {
    path,
    promptKey,
    version,
    ownerRole,
    dataClassMax,
    evalSetRef,
    variablesSchema,
    outputSchema: (meta.output_schema as Record<string, unknown> | undefined) ?? null,
    template,
    contentSha256: promptDigest({ template, variablesSchema, dataClassMax }),
  };
}

/** Every `<key>/<version>.md` under `dir`, sorted by key and version. */
export function loadPromptFiles(dir = platformPromptsDir()): PromptFile[] {
  if (!existsSync(dir)) return [];
  const out: PromptFile[] = [];
  for (const key of readdirSync(dir).sort())
    for (const f of readdirSync(join(dir, key))
      .filter((x) => x.endsWith(".md"))
      .sort()) {
      const p = parsePromptFile(readFileSync(join(dir, key, f), "utf8"), join(dir, key, f));
      if (p.promptKey !== key || `${p.version}.md` !== f)
        throw new Error(`${p.path}: the path must be ${p.promptKey}/${p.version}.md`);
      out.push(p);
    }
  return out;
}
