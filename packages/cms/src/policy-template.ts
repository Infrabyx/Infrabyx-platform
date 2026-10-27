// Policy templates (IPB-05 §05.4; PL5 plan §5.7). The 17 template skeletons ship as versioned
// Markdown at `policies/<key>/<template_version>.md`: front matter (template number, class flags,
// review cadence, mandatory sections, parameters), then numbered clause headings with `[COUNSEL]`
// markers that the legal reviewer replaces with reviewed wording. Template 18's strings are the
// consent texts in `@infrabyx/consent`.
//   {{name}}               a parameter from the §05.3.2 block, the policy set or the instance
//   {{#if flag}}…{{/if}}   kept when the boolean parameter is true
//   [Option A | Option B]  a choice the reviewer must resolve before publish
// Rendering escapes every substituted value and gives each `## N. Heading` a stable `#clause-N`.
import { readFileSync, readdirSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { escapeHtml, safeHref } from "./sanitise.js";

export interface PolicyTemplate {
  key: string;
  template: number;
  title: string;
  templateVersion: string;
  privacyClass: boolean;
  termsClass: boolean;
  reconsentOnMajor: boolean;
  reviewMonths: number;
  mandatorySections: string[];
  parameters: string[];
  body: string;
}

const ROOT = new URL("../policies/", import.meta.url);

/** IPB-05-01: every product publishes these before its public site goes live (18 is consent texts). */
export const MANDATORY_POLICY_KEYS = [
  "privacy",
  "terms",
  "cookies",
  "ai_policy",
  "grievance",
  "acceptable_use",
  "retention",
  "accessibility",
  "security",
] as const;
/** Mandatory where the product sells online (templates 3 and 4). */
export const SELLING_POLICY_KEYS = ["payment_terms", "refund"] as const;

export function parseTemplate(text: string): PolicyTemplate {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("policy template without front matter");
  const fm = parseYaml(m[1]!) as Record<string, unknown>;
  return {
    key: fm.key as string,
    template: fm.template as number,
    title: fm.title as string,
    templateVersion: fm.template_version as string,
    privacyClass: fm.privacy_class as boolean,
    termsClass: fm.terms_class as boolean,
    reconsentOnMajor: fm.reconsent_on_major as boolean,
    reviewMonths: fm.review_months as number,
    mandatorySections: fm.mandatory_sections as string[],
    parameters: fm.parameters as string[],
    body: m[2]!,
  };
}

let cache: Map<string, PolicyTemplate> | null = null;

/** The latest version of every shipped template, by key. */
export function policyTemplates(): ReadonlyMap<string, PolicyTemplate> {
  if (cache) return cache;
  const out = new Map<string, PolicyTemplate>();
  for (const key of readdirSync(ROOT)) {
    const versions = readdirSync(new URL(`${key}/`, ROOT))
      .filter((f) => /^\d+\.\d+\.md$/.test(f))
      .sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a));
    if (versions[0])
      out.set(key, parseTemplate(readFileSync(new URL(`${key}/${versions[0]}`, ROOT), "utf8")));
  }
  cache = out;
  return out;
}

export function policyTemplate(key: string): PolicyTemplate {
  const t = policyTemplates().get(key);
  if (!t) throw new Error(`unknown policy template ${key}`);
  return t;
}

export type PolicyParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

export interface ResolveResult {
  text: string;
  /** Parameters without a value (`IPB-POL-001`). */
  unresolved: string[];
  /** `[COUNSEL]` markers and `[A | B]` choices still in the text (`IPB-POL-001`). */
  open: string[];
}

/** Substitute parameters and conditionals; report what is still unresolved. */
export function resolveParams(body: string, params: PolicyParams): ResolveResult {
  const unresolved = new Set<string>();
  let text = body.replace(
    /\{\{#if ([a-z_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, flag: string, inner: string) => (params[flag] === true ? inner : ""),
  );
  text = text.replace(/\{\{([a-z_]+)\}\}/g, (all, name: string) => {
    const v = params[name];
    if (v === undefined || v === null || v === "") {
      unresolved.add(name);
      return all;
    }
    return String(v);
  });
  const open = [
    ...[...text.matchAll(/\[COUNSEL\]/g)].map(() => "[COUNSEL]"),
    ...[...text.matchAll(/\[[^\]\n]*\|[^\]\n]*\]/g)].map((x) => x[0]),
  ];
  return { text, unresolved: [...unresolved].sort(), open };
}

/** Clause numbers present as `## N.` headings. */
export const clauseNumbers = (body: string) =>
  [...body.matchAll(/^##\s+(\d+(?:\.\d+)?)\.\s/gm)].map((m) => m[1]!);

const inline = (s: string) =>
  escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label: string, href: string) => {
      // The href was escaped with the rest; unescape `&amp;` before checking it.
      const h = safeHref(href.replace(/&amp;/g, "&"));
      return h ? `<a href="${escapeHtml(h)}">${label}</a>` : label;
    });

/**
 * Render resolved policy Markdown (headings, paragraphs, lists, tables, bold, links) to HTML.
 * `## 7. Heading` becomes `<h2 id="clause-7">`, stable across versions (IPB-05-11).
 */
export function renderPolicy(md: string): string {
  const out: string[] = [];
  const lines = md.split("\n");
  let para: string[] = [];
  let list: "ul" | "ol" | null = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      const level = Math.min(h[1]!.length, 4);
      const num = /^(\d+(?:\.\d+)?)\.\s/.exec(h[2]!)?.[1];
      const id = level === 2 && num ? ` id="clause-${num.replace(".", "-")}"` : "";
      out.push(`<h${level}${id}>${inline(h[2]!)}</h${level}>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line)) {
      flushPara();
      closeList();
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) {
        if (!/^\|[\s:|-]+\|\s*$/.test(lines[i]!))
          rows.push(
            lines[i]!.trim()
              .slice(1, -1)
              .split("|")
              .map((c) => c.trim()),
          );
        i++;
      }
      i--;
      const [head, ...body] = rows;
      out.push(
        `<table><thead><tr>${(head ?? []).map((c) => `<th scope="col">${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
          body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
          "</tbody></table>",
      );
      continue;
    }
    const li = /^\s*(-|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const kind = li[1] === "-" ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(li[2]!)}</li>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  flushPara();
  closeList();
  return out.join("");
}

/** Citations of instruments in the text, for the LAW_REGISTER check (`IPB-POL-004`). */
export function citations(text: string): string[] {
  // "Companies Act 2013", "Directions, 2025" …
  const named =
    /\b(?:[A-Z][A-Za-z()&,'-]*\s){1,10}(?:Act|Rules|Regulations|Directions|Guidelines|Circular)(?:,)?\s(?:of\s)?\d{4}\b/g;
  // "the RBI 2017 NBFC outsourcing directions" …
  const dated =
    /\b(?:[A-Z][A-Za-z()&'-]*\s){1,4}\d{4}(?:\s[A-Za-z()&'-]+){0,6}?\s(?:Act|Rules|Regulations|Directions|directions|Guidelines|guidelines)\b/g;
  return [...new Set([...text.matchAll(named), ...text.matchAll(dated)].map((m) => m[0].trim()))];
}

/** The next version label: 1.0 first; MAJOR bumps the first number, MINOR the second. */
export function nextVersion(
  previous: string | null,
  change: "INITIAL" | "MAJOR" | "MINOR",
): string {
  if (!previous || change === "INITIAL") return "1.0";
  const [maj, min] = previous.split(".").map(Number) as [number, number];
  return change === "MAJOR" ? `${maj + 1}.0` : `${maj}.${min + 1}`;
}
