// What the Studio block editor needs from the CMS (PR-038; R1-D-02): each block type's form, read
// off the block library in `blocks.ts`, and the rich text codec that lets an editor write portable
// text as plain paragraphs. The editor posts the result to `saveDraft`, which checks every block
// against its schema and sanitises rich text exactly as for the JSON editor.
//
// The text conventions (one blank line between blocks):
//   ## Heading, ### Heading, #### Heading      headings (level 2 to 4)
//   > text                                     a quotation
//   - item, 1. item (two spaces per level)     bulleted and numbered lists
//   **bold**, _italic_ (or *italic*), `code`  inline styles
//   [text](link)                               a link (site path, #anchor, https:, mailto:, tel:)
//   ![image](med_…)                            an image from the media library
//   \ before any of these characters           the character itself
import type { BlockEditorOptions, BlockSpec, RichTextCodec } from "@infrabyx/ui/studio";
import {
  sanitisePortableText,
  type LinkDef,
  type PortableText,
  type Span,
  type TextBlock,
} from "./sanitise.js";

// --- Rich text ------------------------------------------------------------------------------

const INLINE_SPECIAL = /[\\*_`[\]]/g;
const LINE_START = /^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|!\[)/;

const escapeInline = (s: string) => s.replace(INLINE_SPECIAL, (c) => `\\${c}`);

/**
 * A text block's spans as inline text. Marks open and close as a stack, so a run that is bold
 * with an italic part reads `**bold _and italic_**`; code is written as it is, between backticks.
 */
function inlineText(node: TextBlock): string {
  const href = (m: string) => node.markDefs.find((d) => d._key === m)?.href;
  const open = (m: string) => (m === "strong" ? "**" : m === "em" ? "_" : "[");
  const close = (m: string) => (m === "strong" ? "**" : m === "em" ? "_" : `](${href(m)})`);
  const stack: string[] = [];
  let out = "";
  for (const c of node.children) {
    if (!c.text) continue;
    const marks = c.marks.filter((m) => m === "strong" || m === "em" || href(m) !== undefined);
    while (stack.some((m) => !marks.includes(m))) out += close(stack.pop()!);
    for (const m of marks)
      if (!stack.includes(m)) {
        out += open(m);
        stack.push(m);
      }
    out += c.marks.includes("code") ? `\`${c.text.replace(/`/g, "")}\`` : escapeInline(c.text);
  }
  while (stack.length) out += close(stack.pop()!);
  return out;
}

/** Portable text as the text an editor writes. */
export function portableTextToText(value: unknown): string {
  const { value: pt } = sanitisePortableText(value);
  const out: string[] = [];
  let prevList = false;
  for (const node of pt) {
    if (node._type === "image") {
      out.push(`![image](${node.media_id})`);
      prevList = false;
      continue;
    }
    let body = inlineText(node);
    // A line of a paragraph that would read as a heading, quotation or list item is escaped.
    body = body
      .split("\n")
      .map((l) => (LINE_START.test(l) ? `\\${l.trimStart()}` : l))
      .join("\n");
    let line: string;
    if (node.listItem) {
      const indent = "  ".repeat((node.level ?? 1) - 1);
      line = `${indent}${node.listItem === "number" ? "1." : "-"} ${body.replace(/\n/g, " ")}`;
    } else if (node.style === "normal") line = body;
    else if (node.style === "blockquote")
      line = body
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    else line = `${"#".repeat(Number(node.style.slice(1)))} ${body.replace(/\n/g, " ")}`;
    // List items of one list are on consecutive lines; everything else is a block of its own.
    if (out.length && !(prevList && node.listItem)) out.push("");
    out.push(line);
    prevList = Boolean(node.listItem);
  }
  return out.join("\n");
}

/** Inline text with its marks; unclosed markers are text. */
function parseInline(src: string, marks: string[], defs: LinkDef[], seq: { n: number }): Span[] {
  const spans: Span[] = [];
  let buf = "";
  const push = (text: string, m: string[]) => {
    if (!text) return;
    const last = spans[spans.length - 1];
    if (last && last.marks.join() === m.join()) last.text += text;
    else spans.push({ _type: "span", text, marks: [...m] });
  };
  const flush = () => {
    push(buf, marks);
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const rest = src.slice(i);
    if (c === "\\" && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        push(src.slice(i + 1, end), [...marks, "code"]);
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith("**")) {
      const end = findClose(src, i + 2, "**");
      if (end > i + 2) {
        flush();
        spans.push(...parseInline(src.slice(i + 2, end), [...marks, "strong"], defs, seq));
        i = end + 2;
        continue;
      }
    } else if (c === "*" || c === "_") {
      const end = findClose(src, i + 1, c);
      if (end > i + 1) {
        flush();
        spans.push(...parseInline(src.slice(i + 1, end), [...marks, "em"], defs, seq));
        i = end + 1;
        continue;
      }
    }
    if (c === "[") {
      const close = findClose(src, i + 1, "]");
      const m = close > i + 1 ? /^\(([^()\s]+)\)/.exec(src.slice(close + 1)) : null;
      if (m) {
        flush();
        const key = `l${++seq.n}`;
        defs.push({ _key: key, _type: "link", href: m[1]! });
        spans.push(...parseInline(src.slice(i + 1, close), [...marks, key], defs, seq));
        i = close + 1 + m[0].length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return spans;
}

/** The index of the closing marker after `from`, skipping escaped characters; -1 if none. */
function findClose(src: string, from: number, marker: string): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === "\\") {
      i++;
      continue;
    }
    if (marker === "*" && src.startsWith("**", i)) {
      // A bold run inside italics: skip to its end.
      const end = findClose(src, i + 2, "**");
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (src.startsWith(marker, i)) return i;
  }
  return -1;
}

/** The text an editor wrote as portable text (sanitised, so only allow-listed structure stays). */
export function textToPortableText(text: string): PortableText {
  const out: Record<string, unknown>[] = [];
  const seq = { n: 0 };
  const block = (
    src: string,
    style: TextBlock["style"],
    list?: { type: "bullet" | "number"; level: number },
  ) => {
    const markDefs: LinkDef[] = [];
    const children = parseInline(src, [], markDefs, seq);
    if (!children.some((c) => c.text.trim())) return;
    out.push({
      _type: "block",
      style,
      children,
      markDefs,
      ...(list ? { listItem: list.type, level: list.level } : {}),
    });
  };
  const groups = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const g of groups) {
    let para: string[] = [];
    let quote: string[] = [];
    let item: { src: string[]; type: "bullet" | "number"; level: number } | null = null;
    const end = () => {
      if (para.length) block(para.join("\n"), "normal");
      if (quote.length) block(quote.join("\n"), "blockquote");
      if (item) block(item.src.join(" "), "normal", { type: item.type, level: item.level });
      para = [];
      quote = [];
      item = null;
    };
    for (const raw of g.split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) continue;
      const h = /^(#{2,4})\s+(.*)$/.exec(line);
      const img = /^!\[[^\]]*\]\((med_[0-9A-Za-z]+)\)$/.exec(line.trim());
      const li = /^( *)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      const q = /^>\s?(.*)$/.exec(line);
      if (h) {
        end();
        block(h[2]!, `h${h[1]!.length}` as TextBlock["style"]);
      } else if (img) {
        end();
        out.push({ _type: "image", media_id: img[1] });
      } else if (li) {
        end();
        item = {
          src: [li[3]!],
          type: /\d/.test(li[2]!) ? "number" : "bullet",
          level: Math.min(Math.floor(li[1]!.length / 2) + 1, 3),
        };
      } else if (q) {
        if (!quote.length) end();
        quote.push(q[1]!);
      } else if (item) item.src.push(line.trim());
      else {
        if (quote.length) end();
        para.push(line.trim());
      }
    }
    end();
  }
  return sanitisePortableText(out).value;
}

export const RICH_TEXT_CODEC: RichTextCodec = {
  toText: portableTextToText,
  fromText: textToPortableText,
  hint:
    "Leave a blank line between paragraphs. Start a line with ## for a heading, - or 1. for a list " +
    "item, > for a quotation. Write **bold**, _italic_, `code` and [link text](/path or https://…); " +
    "put \\ before any of these characters to show it as written.",
};

// --- Block forms ----------------------------------------------------------------------------

const ctaFields = [
  { kind: "text", name: "label", label: "Button text" },
  {
    kind: "text",
    name: "href",
    label: "Link",
    hint: "A site path such as /contact, or an https: address.",
  },
] as const;

const claimHint = "A Claims Register id (clm_…), for a figure or fact that needs evidence.";

/**
 * The editor's form for each block type of the library (all of `BLOCK_SCHEMAS`). `tabs` has no
 * form (its tabs hold blocks of their own): it is edited as JSON. Each template is a valid block
 * once its `ref` is filled (checked in the tests against the schemas).
 */
export const BLOCK_EDITOR_SPECS: readonly BlockSpec[] = [
  {
    type: "hero",
    label: "Hero",
    template: { heading: "New heading" },
    fields: [
      { kind: "text", name: "eyebrow", label: "Eyebrow" },
      { kind: "text", name: "heading", label: "Heading", required: true },
      { kind: "text", name: "sub", label: "Subheading", multiline: true },
      { kind: "group", name: "primary_cta", label: "Main button", fields: ctaFields },
      { kind: "group", name: "secondary_cta", label: "Second button", fields: ctaFields },
      { kind: "text", name: "media_id", label: "Image", hint: "A media library id (med_…)." },
    ],
  },
  {
    type: "rich_text",
    label: "Text",
    template: { content: textToPortableText("New text.") },
    fields: [{ kind: "richtext", name: "content", label: "Text", required: true }],
  },
  {
    type: "feature_grid",
    label: "Feature grid",
    template: { columns: 3, items: [{ title: "Feature", text: "What it does." }] },
    fields: [
      { kind: "number", name: "columns", label: "Columns", required: true, hint: "2, 3 or 4." },
      {
        kind: "list",
        name: "items",
        label: "Features",
        fields: [
          { kind: "text", name: "title", label: "Title" },
          { kind: "text", name: "text", label: "Text", multiline: true },
          { kind: "text", name: "icon", label: "Icon name" },
          { kind: "text", name: "link", label: "Link" },
        ],
      },
    ],
  },
  {
    type: "steps",
    label: "Steps",
    template: {
      items: [
        { title: "First step", text: "What happens first." },
        { title: "Second step", text: "What happens next." },
      ],
    },
    fields: [
      {
        kind: "list",
        name: "items",
        label: "Steps",
        fields: [
          { kind: "text", name: "title", label: "Title" },
          { kind: "text", name: "text", label: "Text", multiline: true },
        ],
      },
    ],
  },
  {
    type: "media",
    label: "Image or video",
    template: {},
    ref: { name: "media_id", label: "Media library id (med_…)" },
    fields: [
      {
        kind: "text",
        name: "media_id",
        label: "Media",
        required: true,
        hint: "A media library id (med_…).",
      },
      { kind: "text", name: "caption", label: "Caption" },
    ],
  },
  {
    type: "cta",
    label: "Call to action",
    template: {
      heading: "New call to action",
      button: { label: "Contact us", href: "/contact" },
      variant: "primary",
    },
    fields: [
      { kind: "text", name: "heading", label: "Heading", required: true },
      { kind: "text", name: "text", label: "Text", multiline: true },
      { kind: "group", name: "button", label: "Button", fields: ctaFields },
      {
        kind: "select",
        name: "variant",
        label: "Style",
        options: ["primary", "secondary"],
        required: true,
      },
    ],
  },
  {
    type: "faq_accordion",
    label: "Questions and answers",
    template: {
      faq_ids: [],
      items: [{ question: "A question?", answer: textToPortableText("The answer.") }],
    },
    fields: [
      {
        kind: "list",
        name: "items",
        label: "Questions",
        fields: [
          { kind: "text", name: "question", label: "Question" },
          { kind: "richtext", name: "answer", label: "Answer" },
        ],
      },
      {
        kind: "lines",
        name: "faq_ids",
        label: "Shared questions",
        hint: "FAQ ids (faq_…), one per line.",
      },
    ],
  },
  {
    type: "resources_list",
    label: "Resources list",
    template: { filters: {}, limit: 6 },
    fields: [
      { kind: "number", name: "limit", label: "How many", required: true },
      {
        kind: "group",
        name: "filters",
        label: "Filters",
        fields: [
          { kind: "text", name: "artefact_type", label: "Resource type" },
          { kind: "text", name: "topic", label: "Topic" },
        ],
      },
    ],
  },
  {
    type: "team_grid",
    label: "Team",
    template: { group: "team", layout: "grid" },
    fields: [
      {
        kind: "select",
        name: "group",
        label: "Group",
        options: ["leadership", "team", "advisory", "board"],
        required: true,
      },
      {
        kind: "select",
        name: "layout",
        label: "Layout",
        options: ["grid", "list"],
        required: true,
      },
    ],
  },
  {
    type: "timeline",
    label: "Timeline",
    template: { items: [{ date: "2026", title: "A milestone" }] },
    fields: [
      {
        kind: "list",
        name: "items",
        label: "Milestones",
        fields: [
          { kind: "text", name: "date", label: "Date (YYYY, YYYY-MM or YYYY-MM-DD)" },
          { kind: "text", name: "title", label: "Title" },
          { kind: "text", name: "text", label: "Text", multiline: true },
          { kind: "text", name: "claims_ref", label: "Claim" },
        ],
      },
    ],
  },
  {
    type: "stats",
    label: "Figures",
    template: { items: [{ value: "0", label: "What the figure counts" }] },
    fields: [
      {
        kind: "list",
        name: "items",
        label: "Figures",
        fields: [
          { kind: "text", name: "value", label: "Figure" },
          { kind: "text", name: "label", label: "Label" },
          { kind: "text", name: "claims_ref", label: `Claim (${claimHint})` },
        ],
      },
    ],
  },
  {
    type: "logo_wall",
    label: "Logos",
    template: { logos: [{ org: "Organisation name" }] },
    ref: { name: "logos.0.media_id", label: "Logo's media library id (med_…)" },
    fields: [
      {
        kind: "list",
        name: "logos",
        label: "Logos",
        fields: [
          { kind: "text", name: "media_id", label: "Logo (med_…)" },
          { kind: "text", name: "org", label: "Organisation" },
          { kind: "text", name: "claims_ref", label: "Claim" },
        ],
      },
    ],
  },
  {
    type: "testimonial",
    label: "Testimonials",
    template: {},
    ref: { name: "testimonial_ids", label: "Testimonial id (tst_…)", list: true },
    fields: [
      {
        kind: "lines",
        name: "testimonial_ids",
        label: "Testimonials",
        required: true,
        hint: "Testimonial ids (tst_…), one per line.",
      },
    ],
  },
  {
    type: "form",
    label: "Form",
    template: {},
    ref: { name: "form_id", label: "Form id (frm_…)" },
    fields: [
      { kind: "text", name: "form_id", label: "Form", required: true, hint: "A form id (frm_…)." },
    ],
  },
  {
    type: "pricing_table",
    label: "Pricing table",
    template: {},
    ref: { name: "plan_refs", label: "Plan reference", list: true },
    fields: [
      {
        kind: "lines",
        name: "plan_refs",
        label: "Plans",
        required: true,
        hint: "Plan references, one per line.",
      },
      { kind: "text", name: "copy_id", label: "Pricing copy", hint: "A pricing copy id (prc_…)." },
    ],
  },
  {
    type: "comparison_table",
    label: "Comparison table",
    template: {
      columns: ["Feature", "Us", "Others"],
      rows: [["Example", "Yes", "No"]],
      footnotes: [],
      as_of: "2026-01-01",
      names_competitor: false,
    },
    fields: [
      { kind: "lines", name: "columns", label: "Column headings", required: true },
      { kind: "table", name: "rows", label: "Rows" },
      { kind: "lines", name: "footnotes", label: "Footnotes" },
      { kind: "text", name: "as_of", label: "Correct as of (YYYY-MM-DD)", required: true },
      { kind: "checkbox", name: "names_competitor", label: "The table names a competitor" },
    ],
  },
  {
    type: "embed",
    label: "Video embed",
    template: {
      provider: "youtube",
      url: "https://www.youtube.com/watch?v=",
      title: "Video title",
      consent_category: "functional",
    },
    fields: [
      {
        kind: "select",
        name: "provider",
        label: "Provider",
        options: ["youtube", "vimeo"],
        required: true,
      },
      {
        kind: "text",
        name: "url",
        label: "Video address",
        required: true,
        hint: "An https: address on the provider's own site.",
      },
      { kind: "text", name: "title", label: "Title", required: true },
      {
        kind: "select",
        name: "consent_category",
        label: "Cookie category",
        options: ["functional", "analytics", "marketing"],
        required: true,
      },
    ],
  },
  {
    type: "mermaid",
    label: "Diagram",
    template: {
      source: "flowchart LR\n  A --> B",
      caption: "Diagram",
      fallback_text: "A leads to B.",
    },
    fields: [
      {
        kind: "text",
        name: "source",
        label: "Diagram source (Mermaid)",
        required: true,
        multiline: true,
      },
      { kind: "text", name: "caption", label: "Caption", required: true },
      {
        kind: "text",
        name: "fallback_text",
        label: "Text description",
        required: true,
        multiline: true,
      },
    ],
  },
];

/** The options `ContentEditScreen` and `blockHandlers` take for the CMS block library. */
export const BLOCK_EDITOR: BlockEditorOptions = {
  specs: BLOCK_EDITOR_SPECS,
  richText: RICH_TEXT_CODEC,
};
