// The one allow-list sanitiser (IPB-04-15, `@IPB-04-AT-20`; PL5 plan §5.5). Rich text is stored as
// portable-text JSON, never as HTML. `sanitisePortableText` runs at save and again at render;
// `htmlToPortableText` converts imported or pasted HTML (parse5) and reports every removal;
// `toHtml` escapes every text node, so no stored string can become markup.
//   Removed: scripts, styles, iframes, objects, embeds, inline SVG and MathML, forms, event
//   handler attributes, inline styles, and `javascript:`, `data:` and other non-allow-listed URLs.
//   Images survive only as media-library references (`/m/{med_id}/...`).
import { parseFragment, type DefaultTreeAdapterTypes as T } from "parse5";
import { z } from "zod";

export const TEXT_STYLES = ["normal", "h2", "h3", "h4", "blockquote"] as const;
export const DECORATORS = ["strong", "em", "code"] as const;
export const LIST_TYPES = ["bullet", "number"] as const;

export interface Span {
  _type: "span";
  text: string;
  marks: string[];
}
export interface LinkDef {
  _key: string;
  _type: "link";
  href: string;
}
export interface TextBlock {
  _type: "block";
  style: (typeof TEXT_STYLES)[number];
  listItem?: (typeof LIST_TYPES)[number];
  level?: number;
  children: Span[];
  markDefs: LinkDef[];
}
export interface ImageNode {
  _type: "image";
  media_id: string;
}
export type PortableNode = TextBlock | ImageNode;
export type PortableText = PortableNode[];

export interface SanitiseResult {
  value: PortableText;
  /** One human-readable line per removal (`IPB-CMS-008` shows this report). */
  removed: string[];
}

const MEDIA_ID = /^med_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * An allow-listed link target: a site path, an in-page anchor, `https:`, `mailto:` or `tel:`.
 * Control characters and whitespace are removed before the scheme is read, so `java\tscript:`
 * is still `javascript:`.
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const h = href.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (!h || h.length > 2048) return null;
  if (h.startsWith("#")) return /^#[A-Za-z0-9_-]+$/.test(h) ? h : null;
  if (h.startsWith("/")) return h.startsWith("//") || h.includes("\\") ? null : h;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(h)?.[1]?.toLowerCase();
  if (scheme === "https") {
    try {
      return new URL(h).protocol === "https:" ? h : null;
    } catch {
      return null;
    }
  }
  if (scheme === "mailto") return /^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(h) ? h : null;
  if (scheme === "tel") return /^tel:\+?[0-9-]{3,20}$/.test(h) ? h : null;
  return null;
}

const schemeOf = (href: string) =>
  // eslint-disable-next-line no-control-regex
  /^([a-z][a-z0-9+.-]*):/i.exec(href.replace(/[\u0000- ]/g, ""))?.[1]?.toLowerCase() ?? "";

/** Re-validate portable text from any source (a save, a stored revision, a render). */
export function sanitisePortableText(input: unknown): SanitiseResult {
  const removed: string[] = [];
  const out: PortableText = [];
  if (!Array.isArray(input)) {
    if (input != null) removed.push("rich text that is not a list of blocks");
    return { value: [], removed };
  }
  for (const node of input as unknown[]) {
    if (!node || typeof node !== "object") {
      removed.push("a node that is not an object");
      continue;
    }
    const n = node as Record<string, unknown>;
    if (n._type === "image") {
      if (typeof n.media_id === "string" && MEDIA_ID.test(n.media_id))
        out.push({ _type: "image", media_id: n.media_id });
      else removed.push("an image that is not from the media library");
      continue;
    }
    if (n._type !== "block") {
      removed.push(`node of type ${String(n._type).slice(0, 40)}`);
      continue;
    }
    const style = (TEXT_STYLES as readonly string[]).includes(String(n.style))
      ? (n.style as TextBlock["style"])
      : "normal";
    if (n.style !== undefined && style !== n.style)
      removed.push(`block style ${String(n.style).slice(0, 40)}`);
    const defs: LinkDef[] = [];
    for (const d of Array.isArray(n.markDefs) ? (n.markDefs as Record<string, unknown>[]) : []) {
      const href = safeHref(d?.href);
      if (d?._type === "link" && typeof d._key === "string" && href)
        defs.push({ _key: d._key, _type: "link", href });
      else
        removed.push(
          `${schemeOf(String(d?.href ?? "")) || "unsafe"}: URL on a link (${String(d?._key ?? "")})`,
        );
    }
    const keys = new Set(defs.map((d) => d._key));
    const children: Span[] = [];
    for (const c of Array.isArray(n.children) ? (n.children as Record<string, unknown>[]) : []) {
      if (c?._type !== "span" || typeof c.text !== "string") {
        removed.push("an inline node that is not text");
        continue;
      }
      const marks = (Array.isArray(c.marks) ? (c.marks as unknown[]) : []).filter(
        (m): m is string =>
          typeof m === "string" && ((DECORATORS as readonly string[]).includes(m) || keys.has(m)),
      );
      children.push({ _type: "span", text: c.text, marks });
    }
    const block: TextBlock = { _type: "block", style, children, markDefs: defs };
    if ((LIST_TYPES as readonly string[]).includes(String(n.listItem))) {
      block.listItem = n.listItem as NonNullable<TextBlock["listItem"]>;
      block.level = Math.min(Math.max(Number(n.level) || 1, 1), 3);
    }
    out.push(block);
  }
  return { value: out, removed };
}

// --- HTML import --------------------------------------------------------------------------

/** Elements dropped with their whole content. */
const DROP = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "template",
  "noscript",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "link",
  "meta",
  "base",
  "frame",
  "frameset",
  "applet",
  "audio",
  "video",
  "canvas",
]);
const BLOCKS: Record<string, TextBlock["style"]> = {
  p: "normal",
  h1: "h2",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h4",
  h6: "h4",
  blockquote: "blockquote",
  pre: "normal",
};
const DECORATOR_TAGS: Record<string, (typeof DECORATORS)[number]> = {
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  code: "code",
  pre: "code",
};

const isElement = (n: T.ChildNode): n is T.Element => "tagName" in n;
const isText = (n: T.ChildNode): n is T.TextNode => n.nodeName === "#text";

/** Convert HTML to portable text, keeping only allow-listed structure (`@IPB-04-AT-20`). */
export function htmlToPortableText(html: string): SanitiseResult {
  const removed: string[] = [];
  const out: PortableText = [];
  let current: TextBlock | null = null;
  let linkSeq = 0;

  const flush = () => {
    if (current && current.children.some((c) => c.text.trim())) out.push(current);
    current = null;
  };
  const open = (style: TextBlock["style"], list?: TextBlock["listItem"], level?: number) => {
    flush();
    current = { _type: "block", style, children: [], markDefs: [] };
    if (list) {
      current.listItem = list;
      current.level = level ?? 1;
    }
  };
  const textOut = (text: string, marks: string[]) => {
    if (!current) open("normal");
    current!.children.push({ _type: "span", text, marks: [...marks] });
  };

  const checkAttrs = (el: T.Element) => {
    for (const a of el.attrs) {
      if (/^on/i.test(a.name)) removed.push(`${a.name} on <${el.tagName}> (event attribute)`);
      else if (a.name === "style") removed.push(`style attribute on <${el.tagName}>`);
    }
  };

  const walk = (
    nodes: T.ChildNode[],
    marks: string[],
    list?: { type: TextBlock["listItem"]; level: number },
  ) => {
    for (const n of nodes) {
      if (isText(n)) {
        const text = n.value.replace(/\s+/g, " ");
        if (text.trim() || current) textOut(text, marks);
        continue;
      }
      if (!isElement(n)) continue;
      const tag = n.tagName.toLowerCase();
      if (DROP.has(tag)) {
        removed.push(tag === "svg" ? "<svg> (inline SVG)" : `<${tag}>`);
        continue;
      }
      checkAttrs(n);
      if (tag === "br") {
        textOut("\n", marks);
        continue;
      }
      if (tag === "img") {
        const src = n.attrs.find((a) => a.name === "src")?.value ?? "";
        const m = /^\/m\/(med_[0-7][0-9A-HJKMNP-TV-Z]{25})(\/|$)/.exec(src);
        if (m) {
          flush();
          out.push({ _type: "image", media_id: m[1]! });
        } else
          removed.push(
            `${schemeOf(src) === "data" ? "data: URL" : "image not from the media library"} on <img>`,
          );
        continue;
      }
      if (tag === "ul" || tag === "ol") {
        flush();
        walk(n.childNodes, marks, {
          type: tag === "ul" ? "bullet" : "number",
          level: Math.min((list?.level ?? 0) + 1, 3),
        });
        flush();
        continue;
      }
      if (tag === "li") {
        open("normal", list?.type ?? "bullet", list?.level ?? 1);
        walk(n.childNodes, marks, list);
        flush();
        continue;
      }
      if (tag in BLOCKS) {
        if (tag === "h1") removed.push("<h1> demoted to a level-2 heading (one h1 per page)");
        open(BLOCKS[tag]!);
        walk(n.childNodes, tag === "pre" ? [...marks, "code"] : marks, list);
        flush();
        continue;
      }
      if (tag in DECORATOR_TAGS) {
        walk(n.childNodes, [...marks, DECORATOR_TAGS[tag]!], list);
        continue;
      }
      if (tag === "a") {
        const raw = n.attrs.find((a) => a.name === "href")?.value;
        const href = safeHref(raw);
        if (raw !== undefined && !href) {
          removed.push(`${schemeOf(raw) || "unsafe"}: URL on <a>`);
          walk(n.childNodes, marks, list);
          continue;
        }
        if (!href) {
          walk(n.childNodes, marks, list);
          continue;
        }
        if (!current) open("normal");
        const key = `l${++linkSeq}`;
        current!.markDefs.push({ _key: key, _type: "link", href });
        walk(n.childNodes, [...marks, key], list);
        continue;
      }
      // Any other element (div, span, section, font…): keep its text, drop the element.
      walk(n.childNodes, marks, list);
    }
  };

  walk(parseFragment(html).childNodes, []);
  flush();
  // Re-run the portable-text sanitiser so both entry points share one allow-list.
  const again = sanitisePortableText(out);
  return { value: again.value, removed: [...removed, ...again.removed] };
}

// --- Rendering ------------------------------------------------------------------------------

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export interface RenderMedia {
  src: string;
  alt: string;
}

/**
 * Render portable text to HTML on the server. The value is sanitised again first (IPB-04-15:
 * "at save and at render"); every text node is escaped; external links get `rel`.
 */
export function toHtml(
  input: unknown,
  o: { media?: (id: string) => RenderMedia | null } = {},
): string {
  const { value } = sanitisePortableText(input);
  const parts: string[] = [];
  let openList: { tag: "ul" | "ol"; level: number } | null = null;
  const closeList = () => {
    if (openList) parts.push(`</${openList.tag}>`);
    openList = null;
  };
  for (const node of value) {
    if (node._type === "image") {
      closeList();
      const m = o.media?.(node.media_id);
      if (m) parts.push(`<img src="${escapeHtml(m.src)}" alt="${escapeHtml(m.alt)}">`);
      continue;
    }
    const inner = node.children
      .map((c) => {
        let html = escapeHtml(c.text).replace(/\n/g, "<br>");
        for (const mark of c.marks) {
          if (mark === "strong") html = `<strong>${html}</strong>`;
          else if (mark === "em") html = `<em>${html}</em>`;
          else if (mark === "code") html = `<code>${html}</code>`;
          else {
            const def = node.markDefs.find((d) => d._key === mark);
            if (!def) continue;
            const ext = def.href.startsWith("https:");
            html = `<a href="${escapeHtml(def.href)}"${ext ? ' rel="noopener noreferrer"' : ""}>${html}</a>`;
          }
        }
        return html;
      })
      .join("");
    if (node.listItem) {
      const tag = node.listItem === "number" ? "ol" : "ul";
      if (!openList || openList.tag !== tag) {
        closeList();
        parts.push(`<${tag}>`);
        openList = { tag, level: node.level ?? 1 };
      }
      parts.push(`<li>${inner}</li>`);
      continue;
    }
    closeList();
    const tag = node.style === "normal" ? "p" : node.style;
    parts.push(`<${tag}>${inner}</${tag}>`);
  }
  closeList();
  return parts.join("");
}

/** All plain text of a portable-text value (for lint and search). */
export function plainText(pt: unknown): string {
  return sanitisePortableText(pt)
    .value.map((n) => (n._type === "block" ? n.children.map((c) => c.text).join("") : ""))
    .join("\n");
}

/** Zod type for portable text in block and body schemas: shape-checked, then sanitised. */
export const PortableTextSchema = z.array(z.record(z.string(), z.unknown()));
