// Tenant email template lint and rendering (LawDocsComply PR-LDC-27; R1-plan M58; R1-D-90).
// A tenant's email override is a subject, a required plain-text part and an optional HTML part with
// `{{var}}` placeholders. The lint refuses variables outside the class's whitelist, a missing plain
// text, over-long fields, and any HTML outside a strict allow-list of tags and attributes: no
// script, style, iframe, form or embedded content, no event-handler attributes, no `javascript:`
// or other non-https links, no remote images, and no variables inside attribute values (a variable
// can never become a link). There is no sanitiser: refused HTML is refused, never rewritten. The
// same lint runs again at every delivery and preview before rendering, which escapes every value
// placed in HTML, so preview and delivery render alike and a template that stopped passing (a
// class lost a variable) fails closed.
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import type {
  EmailContent,
  EmailTemplateContent,
  NotificationClass,
} from "@infrabyx/contracts/ports";

/** Template field limits (characters); the rendered subject is cut at 200. */
export const TEMPLATE_LIMITS = Object.freeze({
  subject: 150,
  text: 20_000,
  html: 100_000,
  placeholders: 100,
  /** An inline `data:` image in the HTML part. */
  inlineImage: 50_000,
});

export interface TemplateFinding {
  field: "subject" | "text" | "html";
  message: string;
}

/** The tenant template was refused by the lint (422); `findings` lists every reason. */
export class TemplateLintError extends Error {
  readonly status = 422;
  constructor(readonly findings: readonly TemplateFinding[]) {
    super(`tenant template refused: ${findings.map((f) => `${f.field}: ${f.message}`).join("; ")}`);
    this.name = "TemplateLintError";
  }
}

export interface TemplateLintOptions {
  /** Link hosts the tenant may use (exact or a subdomain); omitted: any https host. */
  linkHosts?: readonly string[];
}

/**
 * The variables a tenant template of this class may use: the class's `variables`, else the
 * names its SMS and WhatsApp templates take; a class with neither offers none.
 */
export function templateVariables(cls: NotificationClass): readonly string[] {
  if (cls.variables) return cls.variables;
  return [
    ...new Set([...(cls.templates.sms?.vars ?? []), ...(cls.templates.whatsapp?.vars ?? [])]),
  ];
}

const PLACEHOLDER = /\{\{\s*([a-z][a-zA-Z0-9_]*)\s*\}\}/g;
// Control characters are what these patterns look for.
// eslint-disable-next-line no-control-regex
const CONTROL_LINE = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_LINE_RUNS = new RegExp(`${CONTROL_LINE.source}+`, "g");
// eslint-disable-next-line no-control-regex
const CONTROL_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
/** Whitespace and control characters, which browsers ignore inside a URL scheme. */
// eslint-disable-next-line no-control-regex
const URL_IGNORED = /[\u0000- \u007f-\u009f]/g;

/** Placeholders in a field; `malformed` when braces remain that are not a valid placeholder. */
function placeholders(s: string): { names: string[]; malformed: boolean } {
  const names = [...s.matchAll(PLACEHOLDER)].map((m) => m[1] as string);
  const rest = s.replace(PLACEHOLDER, "");
  return { names, malformed: rest.includes("{{") || rest.includes("}}") };
}

// ---------------------------------------------------------------------------------- HTML lint

/** Tags a tenant email may use; everything else is refused. */
const ALLOWED_TAGS = new Set([
  "html",
  "head",
  "body",
  "title",
  "meta",
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
/** Named so the finding says why; refused like any other tag outside the allow-list. */
const ACTIVE_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "link",
  "base",
  "svg",
  "math",
  "audio",
  "video",
  "source",
  "track",
  "canvas",
  "noscript",
  "template",
  "portal",
]);
/** Elements whose content a browser does not parse as markup; skipped to their end tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "iframe", "noscript", "xmp", "noembed"]);
const GLOBAL_ATTRS = new Set([
  "align",
  "valign",
  "width",
  "height",
  "bgcolor",
  "border",
  "style",
  "class",
  "dir",
  "lang",
  "title",
  "role",
]);
const TAG_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt"]),
  table: new Set(["cellpadding", "cellspacing", "summary"]),
  td: new Set(["colspan", "rowspan", "nowrap", "scope"]),
  th: new Set(["colspan", "rowspan", "nowrap", "scope"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  ol: new Set(["start", "type"]),
  li: new Set(["value"]),
  meta: new Set(["charset", "name", "content"]),
};
const META_NAMES = new Set([
  "viewport",
  "color-scheme",
  "supported-color-schemes",
  "x-apple-disable-message-reformatting",
  "format-detection",
]);
const CSS_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
  "text-transform",
  "text-indent",
  "vertical-align",
  "white-space",
  "word-break",
  "word-wrap",
  "overflow-wrap",
  "direction",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-color",
  "border-style",
  "border-width",
  "border-radius",
  "border-collapse",
  "border-spacing",
  "display",
  "list-style",
  "list-style-type",
  "table-layout",
]);
const CSS_VALUE = /^[#a-zA-Z0-9\s.,%'"!()+-]*$/;
// `@import` is refused by the `@` check; `!important` stays allowed.
const CSS_FORBIDDEN =
  /url|expression|image\(|image-set|javascript|behavio|binding|var\(|attr\(|env\(/i;
const DATA_IMAGE = /^data:image\/(png|gif|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * An attribute value as the browser reads it. Numeric references and the basic named ones are
 * decoded; any other named reference makes it `null` (refused where a URL or CSS is checked).
 */
function decodeAttr(v: string): string | null {
  let bad = false;
  const out = v.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (_, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ((bad = true), "");
    }
    const n = NAMED_ENTITIES[e.toLowerCase()];
    if (n === undefined) bad = true;
    return n ?? "";
  });
  return bad ? null : out;
}

function hostAllowed(host: string, hosts: readonly string[] | undefined): boolean {
  if (!hosts) return true;
  const h = host.toLowerCase();
  return hosts.some((a) => h === a.toLowerCase() || h.endsWith(`.${a.toLowerCase()}`));
}

function checkHref(raw: string, opts: TemplateLintOptions): string | undefined {
  const d = decodeAttr(raw);
  if (d === null) return "a link may not use character references other than numeric or &amp;";
  // Browsers ignore whitespace and control characters inside a scheme (`java\tscript:`).
  const v = d.replace(URL_IGNORED, "");
  const lower = v.toLowerCase();
  if (/^(javascript|vbscript|livescript|data|file|blob):/.test(lower))
    return `a ${lower.slice(0, lower.indexOf(":"))}: URL is not allowed in a link`;
  if (/^mailto:[^\s<>"']+$/i.test(v) || /^tel:\+?[0-9().-]+$/i.test(v)) return undefined;
  if (!lower.startsWith("https://")) return "a link must be an https:, mailto: or tel: URL";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "a link is not a valid URL";
  }
  if (u.username || u.password) return "a link may not carry a user name or password";
  if (!hostAllowed(u.hostname, opts.linkHosts)) return `link host ${u.hostname} is not allowed`;
  return undefined;
}

function checkImageSrc(raw: string): string | undefined {
  const d = decodeAttr(raw);
  const v = (d ?? "").replace(URL_IGNORED, "");
  if (d !== null && DATA_IMAGE.test(v)) {
    return v.length > TEMPLATE_LIMITS.inlineImage
      ? `an inline image is longer than ${TEMPLATE_LIMITS.inlineImage} characters`
      : undefined;
  }
  if (/^(https?:)?\/\//i.test(v) || /^[a-z][a-z0-9+.-]*:/i.test(v))
    return "remote images are not allowed (inline PNG, GIF, JPEG or WebP data only)";
  return "an image source must be inline PNG, GIF, JPEG or WebP data";
}

function checkStyle(raw: string): string | undefined {
  const d = decodeAttr(raw);
  if (d === null || /[\\<>@]|\/\*/.test(d)) return "a style attribute holds characters it may not";
  for (const decl of d.split(";")) {
    if (!decl.trim()) continue;
    const i = decl.indexOf(":");
    if (i < 0) return "a style declaration has no value";
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!CSS_PROPS.has(prop) && !/^mso-[a-z-]+$/.test(prop))
      return `the CSS property ${prop} is not allowed`;
    if (!CSS_VALUE.test(value) || CSS_FORBIDDEN.test(value))
      return `the CSS value of ${prop} is not allowed (no URLs, images or expressions)`;
  }
  return undefined;
}

function checkAttr(
  tag: string,
  name: string,
  value: string | undefined,
  opts: TemplateLintOptions,
): string | undefined {
  if (/^on/i.test(name)) return `event-handler attribute ${name} is not allowed`;
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return `attribute ${name} is not allowed`;
  const aria = /^aria-[a-z]+$/.test(name);
  if (!aria && !GLOBAL_ATTRS.has(name) && !TAG_ATTRS[tag]?.has(name))
    return `attribute ${name} is not allowed on <${tag}>`;
  const v = value ?? "";
  if (v.includes("{{") || v.includes("}}"))
    return `variables may appear only in text, not in the attribute ${name}`;
  if (name === "href") return checkHref(v, opts);
  if (name === "src") return checkImageSrc(v);
  if (name === "style") return checkStyle(v);
  if (name === "target" && v !== "_blank") return "target may only be _blank";
  if (name === "rel" && !/^[a-z ]*$/.test(v)) return "rel holds characters it may not";
  if (tag === "meta" && name === "name" && !META_NAMES.has(v.toLowerCase()))
    return `meta name ${v} is not allowed`;
  if (tag === "meta" && name === "content" && /[:/\\]|url/i.test(v))
    return "meta content may not hold a URL";
  return undefined;
}

/** Lint an HTML part against the allow-list; returns every finding (empty means clean). */
export function lintHtml(html: string, opts: TemplateLintOptions = {}): string[] {
  const out = new Set<string>();
  const add = (m: string) => out.add(m);
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    i = lt;
    const rest = html.slice(i, i + 12);
    if (rest.startsWith("<!--")) {
      add("HTML comments are not allowed (conditional comments can hide content)");
      const end = html.indexOf("-->", i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (rest.startsWith("<!")) {
      const end = html.indexOf(">", i);
      const decl = html.slice(i, end < 0 ? n : end + 1);
      if (!/^<!doctype\s+html[^<>]*>$/i.test(decl))
        add("declarations other than <!doctype html> are not allowed");
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (rest.startsWith("<?")) {
      add("processing instructions are not allowed");
      const end = html.indexOf(">", i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const close = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(html.slice(i, i + 64));
    if (close) {
      const tag = (close[1] as string).toLowerCase();
      if (!ALLOWED_TAGS.has(tag))
        add(ACTIVE_TAGS.has(tag) ? `<${tag}> is not allowed` : `tag <${tag}> is not allowed`);
      i += close[0].length;
      continue;
    }
    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i, i + 64));
    if (!open) {
      add("a bare < must be written &lt;");
      i += 1;
      continue;
    }
    const tag = (open[1] as string).toLowerCase();
    i += open[0].length;
    if (!ALLOWED_TAGS.has(tag))
      add(ACTIVE_TAGS.has(tag) ? `<${tag}> is not allowed` : `tag <${tag}> is not allowed`);
    // Attributes, to the end of the tag.
    const seen = new Set<string>();
    let ended = false;
    while (i < n) {
      while (i < n && /\s/.test(html[i] as string)) i++;
      if (html.startsWith("/>", i)) {
        i += 2;
        ended = true;
        break;
      }
      if (html[i] === ">") {
        i += 1;
        ended = true;
        break;
      }
      const an = /^[^\s"'>/=<]+/.exec(html.slice(i, i + 128));
      if (!an) {
        add(`<${tag}> holds a malformed attribute`);
        i += 1;
        continue;
      }
      const name = an[0].toLowerCase();
      i += an[0].length;
      while (i < n && /\s/.test(html[i] as string)) i++;
      let value: string | undefined;
      if (html[i] === "=") {
        i += 1;
        while (i < n && /\s/.test(html[i] as string)) i++;
        const q = html[i];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, i + 1);
          if (end < 0) {
            add(`<${tag}> has an unterminated attribute value`);
            i = n;
            break;
          }
          value = html.slice(i + 1, end);
          i = end + 1;
        } else {
          const uq = /^[^\s"'=<>`]+/.exec(html.slice(i));
          value = uq ? uq[0] : "";
          i += value.length;
        }
      }
      if (seen.has(name)) add(`<${tag}> repeats the attribute ${name}`);
      seen.add(name);
      const f = checkAttr(tag, name, value, opts);
      if (f) add(f);
    }
    if (!ended) add(`<${tag}> is not closed with >`);
    if (tag === "title" || RAW_TEXT.has(tag)) {
      const m = new RegExp(`</${tag}\\s*>`, "i").exec(html.slice(i));
      const body = m ? html.slice(i, i + m.index) : html.slice(i);
      if (tag === "title" && body.includes("<")) add("<title> may hold text only");
      i = m ? i + m.index : n;
    }
  }
  return [...out];
}

// ------------------------------------------------------------------------------ template lint

/**
 * Lint a tenant email template for a class: every finding (empty means clean). `security`
 * classes are refused here by `TenantTemplateStore` before the content is looked at.
 */
export function lintEmailTemplate(
  content: EmailTemplateContent,
  allowed: readonly string[],
  opts: TemplateLintOptions = {},
): TemplateFinding[] {
  const out: TemplateFinding[] = [];
  const whitelist = new Set(allowed);
  let count = 0;
  const field = (f: TemplateFinding["field"], v: unknown, max: number, required: boolean) => {
    if (v === undefined && !required) return;
    if (typeof v !== "string" || !v.trim()) {
      out.push({
        field: f,
        message: f === "text" ? "a plain-text part is required" : `${f} is required`,
      });
      return;
    }
    if (v.length > max) out.push({ field: f, message: `longer than ${max} characters` });
    if ((f === "subject" ? CONTROL_LINE : CONTROL_TEXT).test(v))
      out.push({
        field: f,
        message:
          f === "subject"
            ? "line breaks and control characters are not allowed"
            : "control characters are not allowed",
      });
    const p = placeholders(v);
    count += p.names.length;
    if (p.malformed) out.push({ field: f, message: "a placeholder is malformed; write {{name}}" });
    for (const name of new Set(p.names))
      if (!whitelist.has(name))
        out.push({
          field: f,
          message: `unknown variable {{${name}}}: this class offers ${allowed.length ? allowed.join(", ") : "no variables"}`,
        });
    if (f === "html") for (const m of lintHtml(v, opts)) out.push({ field: f, message: m });
  };
  field("subject", content.subject, TEMPLATE_LIMITS.subject, true);
  field("text", content.text, TEMPLATE_LIMITS.text, true);
  field("html", content.html, TEMPLATE_LIMITS.html, false);
  if (count > TEMPLATE_LIMITS.placeholders)
    out.push({ field: "text", message: `more than ${TEMPLATE_LIMITS.placeholders} placeholders` });
  return out;
}

// ---------------------------------------------------------------------------------- rendering

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "{": "&#123;",
  "}": "&#125;",
};
const escapeHtml = (s: string): string => s.replace(/[&<>"'{}]/g, (c) => HTML_ESCAPES[c] as string);

/**
 * Render a tenant email template for one notification, as delivery and preview both do: the
 * template is linted first (a finding fails closed with IPB-PORT-001, reason `template_invalid`),
 * a placeholder whose variable the notification lacks fails with `template_variable_missing`,
 * values in the HTML part are escaped, and line breaks and control characters are removed from
 * values in the subject.
 */
export function renderEmailTemplate(
  cls: NotificationClass,
  content: EmailTemplateContent,
  vars: Readonly<Record<string, unknown>>,
  opts: TemplateLintOptions = {},
): EmailContent {
  const findings = lintEmailTemplate(content, templateVariables(cls), opts);
  if (findings.length)
    throw new PortError("IPB-PORT-001", "EMAIL", {
      adapter: "notify",
      detail: `the tenant's ${cls.id} email template no longer passes the lint`,
      meta: { reason: "template_invalid", definite: true, findings: findings.length },
    });
  const fill = (s: string, f: (v: string) => string) =>
    s.replace(PLACEHOLDER, (_, name: string) => {
      if (!(name in vars) || vars[name] === undefined || vars[name] === null)
        throw new IpbError("IPB-PORT-001", {
          detail: `notification ${cls.id} lacks the template variable ${name}`,
          meta: { reason: "template_variable_missing", definite: true },
        });
      return f(String(vars[name]));
    });
  const subject = fill(content.subject, (v) => v.replace(CONTROL_LINE_RUNS, " "))
    .trim()
    .slice(0, 200);
  const text = fill(content.text, (v) => v.replace(new RegExp(CONTROL_TEXT.source, "g"), ""));
  return {
    subject: subject || cls.id,
    text,
    ...(content.html ? { html: fill(content.html, escapeHtml) } : {}),
  };
}
