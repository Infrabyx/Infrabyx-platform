// The 40-item manual release checklist (IPB-06-55). `checklist.md` at the package root is the
// source; this parses its item lines so a release record can be checked for completeness.
import { readFileSync } from "node:fs";

export interface ChecklistItem {
  id: string;
  /** The success criteria or IPB IDs in brackets, as written. */
  refs: string;
  text: string;
}

const ITEM = /^- \[ \] \*\*(C\d{2})\*\* \(([^)]+)\) (.+)$/;

export function parseChecklist(markdown: string): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const line of markdown.split("\n")) {
    const m = ITEM.exec(line.trim());
    if (m) out.push({ id: m[1]!, refs: m[2]!, text: m[3]! });
  }
  return out;
}

let cached: ChecklistItem[] | undefined;

export function releaseChecklist(): ChecklistItem[] {
  cached ??= parseChecklist(readFileSync(new URL("../checklist.md", import.meta.url), "utf8"));
  return cached;
}
