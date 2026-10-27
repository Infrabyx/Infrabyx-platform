// SVG logo sanitiser (IPB-04-21, `@IPB-04-AT-21`). Allow-list only: anything not listed is
// removed and reported. No `<script>`, `<foreignObject>`, `<a>`, `<image>`, event attributes,
// external references (`href` other than `#id`, `url()` other than `url(#id)`), `@import`, or
// DOCTYPE (entity expansion). The output is re-serialised from the cleaned tree; the caller stores
// only that, never the upload.
import { DOMParser, XMLSerializer, type Element, type Node } from "@xmldom/xmldom";
import { IpbError } from "@infrabyx/contracts/errors";

export const SVG_MAX_BYTES = 512 * 1024;
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "symbol",
  "use",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "clipPath",
  "mask",
  "filter",
  "feGaussianBlur",
  "feOffset",
  "feBlend",
  "feColorMatrix",
  "feComposite",
  "feFlood",
  "feMerge",
  "feMergeNode",
  "style",
]);

const ATTRIBUTES = new Set([
  "id",
  "class",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "clip-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "color",
  "display",
  "visibility",
  "clip-path",
  "mask",
  "filter",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "word-spacing",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "fx",
  "fy",
  "fr",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "preserveAspectRatio",
  "role",
  "aria-label",
  "aria-labelledby",
  "aria-hidden",
  "focusable",
  "lang",
  "xml:space",
  "xmlns",
  "xmlns:xlink",
  "version",
  "style",
  "href",
  "xlink:href",
  "stdDeviation",
  "dx",
  "dy",
  "in",
  "in2",
  "mode",
  "values",
  "type",
  "operator",
  "result",
  "flood-color",
  "flood-opacity",
  "filterUnits",
  "primitiveUnits",
  "startOffset",
  "textLength",
  "lengthAdjust",
]);

/** `url(...)` pointing anywhere but a local fragment, and CSS imports or expressions. */
const EXTERNAL_CSS = /url\(\s*(?!['"]?#)|@import|expression\s*\(|javascript:/i;

export interface SanitisedSvg {
  svg: string;
  /** What was removed, for the sanitiser report (`<script>`, `onload on <svg>`, …). */
  removed: string[];
}

export function sanitiseSvg(input: string | Uint8Array): SanitisedSvg {
  const text =
    typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  if (new TextEncoder().encode(text).length > SVG_MAX_BYTES)
    throw new IpbError("IPB-BRD-001", { detail: `SVG over ${SVG_MAX_BYTES / 1024} KB` });
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new IpbError("IPB-BRD-001", {
      detail: "DOCTYPE and entity declarations are not allowed",
    });

  let doc;
  try {
    doc = new DOMParser({
      onError: (level, msg) => {
        if (level !== "warning") throw new Error(msg);
      },
    }).parseFromString(text, "image/svg+xml");
  } catch (e) {
    throw new IpbError("IPB-BRD-001", { detail: `not well-formed SVG: ${(e as Error).message}` });
  }
  const root = doc.documentElement;
  if (!root || root.localName !== "svg" || (root.namespaceURI && root.namespaceURI !== SVG_NS))
    throw new IpbError("IPB-BRD-001", { detail: "the root element is not <svg>" });

  const removed: string[] = [];
  const clean = (el: Element) => {
    for (const child of [...nodes(el.childNodes)]) {
      if (child.nodeType === 1) {
        const c = child as Element;
        const name = c.localName ?? c.nodeName;
        const ns = c.namespaceURI;
        if (!ELEMENTS.has(name) || (ns && ns !== SVG_NS)) {
          removed.push(`<${c.nodeName}>`);
          el.removeChild(c);
          continue;
        }
        if (name === "style" && EXTERNAL_CSS.test(c.textContent ?? "")) {
          removed.push("<style> with an external reference");
          el.removeChild(c);
          continue;
        }
        cleanAttributes(c, removed);
        clean(c);
      } else if (child.nodeType === 7 || child.nodeType === 8) {
        // Processing instructions and comments carry nothing a logo needs.
        el.removeChild(child);
      } else if (child.nodeType === 4) {
        removed.push("CDATA section");
        el.removeChild(child);
      }
    }
  };
  cleanAttributes(root, removed);
  clean(root);
  for (const n of [...nodes(doc.childNodes)]) if (n !== root) doc.removeChild(n);
  return { svg: new XMLSerializer().serializeToString(doc), removed };
}

function* nodes(list: { length: number; item(i: number): Node | null }): Generator<Node> {
  for (let i = 0; i < list.length; i++) {
    const n = list.item(i);
    if (n) yield n;
  }
}

function cleanAttributes(el: Element, removed: string[]): void {
  const attrs = el.attributes;
  const names: { name: string; ns: string | null; value: string }[] = [];
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs.item(i);
    if (a) names.push({ name: a.name, ns: a.namespaceURI, value: a.value });
  }
  for (const a of names) {
    const local = a.name.toLowerCase();
    let why: string | null = null;
    if (local.startsWith("on")) why = "event attribute";
    else if (!ATTRIBUTES.has(a.name)) why = "attribute not allowed";
    else if (
      (a.name === "href" || a.name === "xlink:href") &&
      !/^#[A-Za-z_][\w.-]*$/.test(a.value.trim())
    )
      why = "external reference";
    else if (a.ns === XLINK_NS && a.name !== "xlink:href") why = "attribute not allowed";
    else if (EXTERNAL_CSS.test(a.value)) why = "external reference";
    if (why) {
      removed.push(`${a.name} on <${el.nodeName}> (${why})`);
      el.removeAttribute(a.name);
    }
  }
}
