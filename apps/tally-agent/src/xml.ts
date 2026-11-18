// XML for TallyPrime's local port (PR-FBX-46, R1-D-178): a small builder that escapes every text
// and attribute value, and a strict reader for TallyPrime's answers. No XML dependency.
//
// The reader accepts elements, attributes, text, comments, CDATA sections and the five named and
// numeric character references, after an optional XML declaration. It refuses a document type
// declaration (so no entity can be defined or expanded), any other processing instruction,
// unbalanced or mismatched tags and anything past the limits: 8 MiB of text, depth 32, 200,000
// elements, 64 attributes an element. TallyPrime is known to put control characters in exported
// text (`&#4;` before some names) [VERIFY with a TallyPrime sandbox company, #128]; the reader
// drops C0 controls other than tab, line feed and carriage return instead of refusing the answer.

export interface XmlElement {
  name: string;
  attrs: Readonly<Record<string, string>>;
  children: XmlElement[];
  /** The element's own text (child elements' text excluded), entities decoded. */
  text: string;
}

export class XmlError extends Error {}

export const XML_LIMITS = { maxChars: 8 * 1024 * 1024, maxDepth: 32, maxElements: 200_000 };
const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;
// eslint-disable-next-line no-control-regex
const C0 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Escapes text or an attribute value. */
export function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type XmlChild = string | XmlBuilt;
export interface XmlBuilt {
  readonly xml: string;
}

/** `<name a="v">children</name>`; strings are escaped, built elements kept as they are. */
export function el(
  name: string,
  attrs: Readonly<Record<string, string>> | null,
  ...children: readonly XmlChild[]
): XmlBuilt {
  if (!NAME.test(name)) throw new XmlError(`not an element name: ${name}`);
  let a = "";
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (!NAME.test(k)) throw new XmlError(`not an attribute name: ${k}`);
    a += ` ${k}="${esc(v)}"`;
  }
  const body = children.map((c) => (typeof c === "string" ? esc(c) : c.xml)).join("");
  return { xml: `<${name}${a}>${body}</${name}>` };
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const REF = /&(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/g;
const BARE_AMP = /&(?!(?:#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[a-z]{2,4});)/;

function decode(s: string): string {
  if (!s.includes("&")) return s.replace(C0, "");
  if (BARE_AMP.test(s)) throw new XmlError("a bare & in text");
  return s
    .replace(REF, (_m, ref: string) => {
      if (ref[0] === "#") {
        const cp = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        if (!Number.isInteger(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
          throw new XmlError("invalid character reference");
        return String.fromCodePoint(cp);
      }
      const v = NAMED[ref];
      if (v === undefined) throw new XmlError(`undefined entity &${ref};`);
      return v;
    })
    .replace(C0, "");
}

/** Reads one document; throws `XmlError` on anything outside the accepted subset. */
export function parseXml(input: string, limits = XML_LIMITS): XmlElement {
  if (input.length > limits.maxChars) throw new XmlError("document too large");
  let i = input.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = input.length;
  const skipWs = () => {
    while (i < n && /\s/.test(input[i]!)) i++;
  };
  skipWs();
  if (input.startsWith("<?xml", i)) {
    const end = input.indexOf("?>", i);
    if (end < 0) throw new XmlError("unterminated XML declaration");
    i = end + 2;
  }
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let count = 0;
  for (;;) {
    if (i >= n) break;
    const lt = input.indexOf("<", i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      const raw = input.slice(i, textEnd);
      const top = stack[stack.length - 1];
      if (top) top.text += decode(raw);
      else if (raw.trim()) throw new XmlError("text outside the root element");
      i = textEnd;
      if (lt < 0) break;
    }
    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4);
      if (end < 0) throw new XmlError("unterminated comment");
      i = end + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", i)) {
      const end = input.indexOf("]]>", i + 9);
      if (end < 0) throw new XmlError("unterminated CDATA section");
      const top = stack[stack.length - 1];
      if (!top) throw new XmlError("CDATA outside the root element");
      top.text += input.slice(i + 9, end).replace(C0, "");
      i = end + 3;
      continue;
    }
    if (input.startsWith("<!", i)) throw new XmlError("document type declarations are refused");
    if (input.startsWith("<?", i)) throw new XmlError("processing instructions are refused");
    if (input.startsWith("</", i)) {
      const end = input.indexOf(">", i);
      if (end < 0) throw new XmlError("unterminated end tag");
      const name = input.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new XmlError(`mismatched end tag </${name}>`);
      i = end + 1;
      if (stack.length === 0) {
        root = top;
        skipWs();
        while (input.startsWith("<!--", i)) {
          const e = input.indexOf("-->", i + 4);
          if (e < 0) throw new XmlError("unterminated comment");
          i = e + 3;
          skipWs();
        }
        if (i < n) throw new XmlError("content after the root element");
        break;
      }
      continue;
    }
    // A start tag: name, attributes, then > or />.
    let j = i + 1;
    const nameStart = j;
    while (j < n && /[A-Za-z0-9_.:-]/.test(input[j]!)) j++;
    const name = input.slice(nameStart, j);
    if (!NAME.test(name)) throw new XmlError("malformed start tag");
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      while (j < n && /\s/.test(input[j]!)) j++;
      if (input[j] === ">") {
        j++;
        break;
      }
      if (input[j] === "/" && input[j + 1] === ">") {
        selfClosing = true;
        j += 2;
        break;
      }
      const aStart = j;
      while (j < n && /[A-Za-z0-9_.:-]/.test(input[j]!)) j++;
      const aName = input.slice(aStart, j);
      if (!NAME.test(aName) || input[j] !== "=") throw new XmlError("malformed attribute");
      const quote = input[j + 1];
      if (quote !== '"' && quote !== "'") throw new XmlError("attribute values are quoted");
      const vEnd = input.indexOf(quote, j + 2);
      if (vEnd < 0) throw new XmlError("unterminated attribute value");
      const raw = input.slice(j + 2, vEnd);
      if (raw.includes("<")) throw new XmlError("< in an attribute value");
      if (Object.hasOwn(attrs, aName)) throw new XmlError(`duplicate attribute ${aName}`);
      if (Object.keys(attrs).length >= 64) throw new XmlError("too many attributes");
      attrs[aName] = decode(raw);
      j = vEnd + 1;
    }
    if (++count > limits.maxElements) throw new XmlError("too many elements");
    const node: XmlElement = { name, attrs, children: [], text: "" };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (root || count > 1) throw new XmlError("more than one root element");
    i = j;
    if (selfClosing) {
      if (!parent) {
        root = node;
        skipWs();
        if (i < n) throw new XmlError("content after the root element");
        break;
      }
      continue;
    }
    stack.push(node);
    if (stack.length > limits.maxDepth) throw new XmlError("nesting too deep");
  }
  if (stack.length || !root) throw new XmlError("unterminated document");
  return root;
}

/** Every descendant (and the element itself) named `name`, in document order. */
export function findAll(e: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (x: XmlElement) => {
    if (x.name === name) out.push(x);
    for (const c of x.children) walk(c);
  };
  walk(e);
  return out;
}

/** The trimmed text of the first child named `name`, or of the attribute when there is no child. */
export function field(e: XmlElement, name: string): string | undefined {
  const c = e.children.find((x) => x.name === name);
  if (c) return c.text.trim();
  const a = e.attrs[name];
  return a === undefined ? undefined : a.trim();
}

/** The text of the first descendant named `name`. */
export function first(e: XmlElement, name: string): string | undefined {
  return findAll(e, name)[0]?.text.trim();
}
