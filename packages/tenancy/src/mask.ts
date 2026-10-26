// Server-side masking (IPB-02 §02.4.3.3), driven by mask.rules.json shared with packages/ui/mask.
import { createRequire } from "node:module";

export interface MaskRule {
  strategy: "last" | "pan" | "mobile" | "email";
  keep?: number;
  template?: string;
  reveal: "never" | "ledgered";
}

const rulesFile = createRequire(import.meta.url)("../mask.rules.json") as {
  version: number;
  rules: Record<string, MaskRule>;
};
export const MASK_RULES: Readonly<Record<string, MaskRule>> = Object.freeze(rulesFile.rules);
export type MaskField = keyof typeof MASK_RULES;

const X = (n: number) => "X".repeat(Math.max(0, n));

export function mask(field: string, value: string): string {
  const rule = MASK_RULES[field];
  if (!rule) throw new Error(`no masking rule for ${field}`);
  const v = value.trim();
  switch (rule.strategy) {
    case "last": {
      const digits = v.replace(/[\s-]/g, "");
      const last = digits.slice(-(rule.keep ?? 4));
      return rule.template
        ? rule.template.replace("{last}", last)
        : X(digits.length - last.length) + last;
    }
    case "pan": {
      // ABCDE1234F → ABCXX1234X: entity letters and digits stay, the rest is masked.
      const p = v.toUpperCase();
      return /^[A-Z]{5}\d{4}[A-Z]$/.test(p) ? `${p.slice(0, 3)}XX${p.slice(5, 9)}X` : X(p.length);
    }
    case "mobile": {
      const keep = rule.keep ?? 3;
      const m = /^(\+\d{1,3})?\s*(.*)$/.exec(v);
      const rest = (m?.[2] ?? v).replace(/\D/g, "");
      return `${m?.[1] ? `${m[1]} ` : ""}${X(rest.length - keep)}${rest.slice(-keep)}`;
    }
    case "email": {
      const at = v.lastIndexOf("@");
      if (at < 1) return X(v.length);
      return `${v[0]}${X(Math.max(1, at - 1))}${v.slice(at)}`;
    }
  }
}
