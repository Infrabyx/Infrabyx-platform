// Playwright gate helpers (IPB-06-54, §06.4.1). Each check returns findings; `assertGate` turns
// them into `IPB-A11Y-004: <rule> on <route>` (`@IPB-06-AT-01`). The engines are injected through
// `page.evaluate`, which the page's nonce CSP does not block, so routes are scanned under the
// production CSP (PL5-D-03). Works with `playwright-core` or `@playwright/test` pages.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { IpbError } from "@infrabyx/contracts/errors";
import type { Page, Request } from "playwright-core";

const require = createRequire(import.meta.url);
let axeSource: string | undefined;
let htmlcsSource: string | undefined;

/**
 * The axe tags of `a11y.ci.axe_tags` plus the WCAG 2.1 tags, which axe uses for the criteria added
 * in 2.1 (1.3.4, 1.3.5, 1.4.10 to 1.4.13, 2.5.3); tightening a superset is allowed (PL5-D-03).
 */
export const DEFAULT_AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;
/** Rules IPB-06 §06.3.2 names that axe tags as best practice or experimental. */
export const EXTRA_AXE_RULES = [
  "region",
  "landmark-one-main",
  "heading-order",
  "label-content-name-mismatch",
] as const;

export interface GateFinding {
  code: "IPB-A11Y-004";
  check:
    | "axe"
    | "htmlcs"
    | "reflow"
    | "text-scale"
    | "text-spacing"
    | "focus"
    | "skip-link"
    | "third-party";
  rule: string;
  route: string;
  theme?: string;
  detail: string;
  targets: string[];
}

export interface ScanOptions {
  /** The route name used in messages (defaults to the page path). */
  route?: string;
  theme?: string;
}

const routeOf = (page: Page, o: ScanOptions) => {
  if (o.route) return o.route;
  try {
    return new URL(page.url()).pathname;
  } catch {
    return page.url();
  }
};

/** axe-core with the WCAG tags and the extra rules; zero violations to pass. */
export async function axeScan(
  page: Page,
  o: ScanOptions & { tags?: readonly string[]; exclude?: readonly string[] } = {},
): Promise<GateFinding[]> {
  axeSource ??= readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  if (!(await page.evaluate(() => "axe" in window))) await page.evaluate(axeSource);
  const tags = [...new Set([...DEFAULT_AXE_TAGS, ...(o.tags ?? [])])];
  const violations = await page.evaluate(
    async ({ tags, extra, exclude }) => {
      const axe = (window as unknown as { axe: AxeApi }).axe;
      const ids = [...new Set([...axe.getRules(tags).map((r) => r.ruleId), ...extra])];
      const context = exclude.length ? { exclude: exclude.map((s) => [s]) } : document;
      const r = await axe.run(context, {
        runOnly: { type: "rule", values: ids },
        resultTypes: ["violations"],
      });
      return r.violations.map((v) => ({
        id: v.id,
        help: v.help,
        targets: v.nodes.map((n) => n.target.join(" ")),
      }));
    },
    { tags, extra: [...EXTRA_AXE_RULES], exclude: [...(o.exclude ?? [])] },
  );
  const route = routeOf(page, o);
  return violations.map((v) => ({
    code: "IPB-A11Y-004" as const,
    check: "axe" as const,
    rule: v.id,
    route,
    ...(o.theme ? { theme: o.theme } : {}),
    detail: v.help,
    targets: v.targets,
  }));
}

interface AxeApi {
  getRules(tags: string[]): { ruleId: string }[];
  run(
    context: unknown,
    options: unknown,
  ): Promise<{ violations: { id: string; help: string; nodes: { target: string[] }[] }[] }>;
}

/** HTML_CodeSniffer with the WCAG2AA standard (the Pa11y engine; #45); zero errors to pass. */
export async function htmlcsScan(
  page: Page,
  o: ScanOptions & {
    standard?: "WCAG2A" | "WCAG2AA" | "WCAG2AAA";
    ignore?: readonly string[];
  } = {},
): Promise<GateFinding[]> {
  htmlcsSource ??= readFileSync(require.resolve("html_codesniffer/build/HTMLCS.js"), "utf8");
  if (!(await page.evaluate(() => "HTMLCS" in window))) await page.evaluate(htmlcsSource);
  const errors = await page.evaluate(
    ({ standard }) =>
      new Promise<{ code: string; msg: string; target: string }[]>((resolve, reject) => {
        const h = (window as unknown as { HTMLCS: HtmlcsApi }).HTMLCS;
        const selector = (el: Element | null): string => {
          if (!el || !(el instanceof Element)) return "document";
          if (el.id) return `#${CSS.escape(el.id)}`;
          const parts: string[] = [];
          for (
            let e: Element | null = el;
            e && e !== document.documentElement;
            e = e.parentElement
          ) {
            const p: Element | null = e.parentElement;
            const same = p ? [...p.children].filter((c) => c.tagName === e!.tagName) : [];
            parts.unshift(
              same.length > 1
                ? `${e.tagName.toLowerCase()}:nth-of-type(${same.indexOf(e) + 1})`
                : e.tagName.toLowerCase(),
            );
          }
          return parts.join(" > ");
        };
        h.process(
          standard,
          document,
          () =>
            resolve(
              h
                .getMessages()
                .filter((m) => m.type === 1)
                .map((m) => ({ code: m.code, msg: m.msg, target: selector(m.element) })),
            ),
          () => reject(new Error("HTML_CodeSniffer failed to run")),
          "en",
        );
      }),
    { standard: o.standard ?? "WCAG2AA" },
  );
  const route = routeOf(page, o);
  const ignore = new Set(o.ignore ?? []);
  return errors
    .filter((e) => !ignore.has(e.code))
    .map((e) => ({
      code: "IPB-A11Y-004" as const,
      check: "htmlcs" as const,
      rule: e.code,
      route,
      ...(o.theme ? { theme: o.theme } : {}),
      detail: e.msg,
      targets: [e.target],
    }));
}

interface HtmlcsApi {
  process(
    standard: string,
    doc: Document,
    done: () => void,
    failed: () => void,
    lang: string,
  ): void;
  getMessages(): { type: number; code: string; msg: string; element: Element | null }[];
}

async function withViewport<T>(
  page: Page,
  size: { width: number; height: number },
  fn: () => Promise<T>,
): Promise<T> {
  const before = page.viewportSize();
  await page.setViewportSize(size);
  try {
    return await fn();
  } finally {
    if (before) await page.setViewportSize(before);
  }
}

/** Elements whose text is cut off by `overflow: hidden` or `clip` (the 1.4.4 and 1.4.12 symptom). */
async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const hidesX = cs.overflowX === "hidden" || cs.overflowX === "clip";
      const hidesY = cs.overflowY === "hidden" || cs.overflowY === "clip";
      if (!hidesX && !hidesY) continue;
      if (!el.textContent?.trim()) continue;
      // Visually hidden text (skip links, sr-only) is 1×1 by design.
      if (el.clientWidth <= 1 || el.clientHeight <= 1) continue;
      if (
        (hidesX && el.scrollWidth > el.clientWidth + 1) ||
        (hidesY && el.scrollHeight > el.clientHeight + 1)
      )
        out.push(
          el.id
            ? `#${el.id}`
            : `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}`,
        );
    }
    return out;
  });
}

/** SC 1.4.10: at 320×256 CSS px nothing scrolls sideways (a scrolling table container is allowed). */
export async function reflowCheck(page: Page, o: ScanOptions = {}): Promise<GateFinding[]> {
  return withViewport(page, { width: 320, height: 256 }, async () => {
    const r = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: document.documentElement.clientWidth,
    }));
    if (r.scroll <= r.width + 1) return [];
    return [
      {
        code: "IPB-A11Y-004" as const,
        check: "reflow" as const,
        rule: "reflow-320",
        route: routeOf(page, o),
        ...(o.theme ? { theme: o.theme } : {}),
        detail: `page is ${r.scroll} px wide at a 320 px viewport`,
        targets: [],
      },
    ];
  });
}

/** SC 1.4.4: at 200 % text no text is clipped. The root font size is restored afterwards. */
export async function textScaleCheck(
  page: Page,
  o: ScanOptions & { percent?: number } = {},
): Promise<GateFinding[]> {
  const pct = o.percent ?? 200;
  const prev = await page.evaluate((p) => {
    const root = document.documentElement;
    const old = root.style.fontSize;
    root.style.fontSize = `${p}%`;
    return old;
  }, pct);
  try {
    const clipped = await clippedText(page);
    return clipped.length
      ? [
          {
            code: "IPB-A11Y-004" as const,
            check: "text-scale" as const,
            rule: `text-scale-${pct}`,
            route: routeOf(page, o),
            ...(o.theme ? { theme: o.theme } : {}),
            detail: `${clipped.length} element(s) clip text at ${pct} %`,
            targets: clipped,
          },
        ]
      : [];
  } finally {
    await page.evaluate((old) => {
      document.documentElement.style.fontSize = old;
    }, prev);
  }
}

/** SC 1.4.12: the WCAG text-spacing values cause no clipping. Applied as a constructed sheet. */
export async function textSpacingCheck(page: Page, o: ScanOptions = {}): Promise<GateFinding[]> {
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }",
    );
    (window as unknown as { __ibxSpacing: CSSStyleSheet }).__ibxSpacing = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  try {
    const clipped = await clippedText(page);
    return clipped.length
      ? [
          {
            code: "IPB-A11Y-004" as const,
            check: "text-spacing" as const,
            rule: "text-spacing",
            route: routeOf(page, o),
            ...(o.theme ? { theme: o.theme } : {}),
            detail: `${clipped.length} element(s) clip text with WCAG text spacing`,
            targets: clipped,
          },
        ]
      : [];
  } finally {
    await page.evaluate(() => {
      const w = window as unknown as { __ibxSpacing?: CSSStyleSheet };
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== w.__ibxSpacing);
    });
  }
}

/**
 * Moves the sequential-focus starting point to the top of the page: `blur()` alone leaves it at the
 * last focused element. A temporary unfocusable-by-Tab element takes focus and is removed after the
 * next Tab.
 */
async function focusStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const t = document.createElement("span");
    t.id = "__ibx_focus_start";
    t.tabIndex = -1;
    document.body.prepend(t);
    t.focus();
  });
}

/** SC 2.4.1: the first Tab lands on a skip link whose target exists. */
export async function skipLinkFirst(page: Page, o: ScanOptions = {}): Promise<GateFinding[]> {
  await focusStart(page);
  await page.keyboard.press("Tab");
  const r = await page.evaluate(() => {
    document.getElementById("__ibx_focus_start")?.remove();
    const a = document.activeElement;
    const href = a instanceof HTMLAnchorElement ? a.getAttribute("href") : null;
    const target = href?.startsWith("#") ? document.getElementById(href.slice(1)) : null;
    return { tag: a?.tagName.toLowerCase() ?? "none", href, target: Boolean(target) };
  });
  if (r.href?.startsWith("#") && r.target) return [];
  return [
    {
      code: "IPB-A11Y-004" as const,
      check: "skip-link" as const,
      rule: "skip-link-first",
      route: routeOf(page, o),
      ...(o.theme ? { theme: o.theme } : {}),
      detail: r.href
        ? `first focus is a link to ${r.href}, whose target is missing`
        : `first focus is <${r.tag}>, not a skip link`,
      targets: [],
    },
  ];
}

/**
 * SC 2.4.7 and 2.4.11: Tab through the page; every focused element shows a ring at least
 * `minWidth` px wide (outline or box-shadow) and is not fully hidden behind fixed or sticky regions.
 */
export async function focusVisibleCheck(
  page: Page,
  o: ScanOptions & { maxTabs?: number; minWidth?: number } = {},
): Promise<GateFinding[]> {
  const max = o.maxTabs ?? 60;
  const minWidth = o.minWidth ?? 2;
  await focusStart(page);
  const failures: { target: string; why: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate((minW) => {
      document.getElementById("__ibx_focus_start")?.remove();
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const id = el.id
        ? `#${el.id}`
        : `${el.tagName.toLowerCase()}${el.getAttribute("href") ? `[href="${el.getAttribute("href")}"]` : ""}:${[...document.querySelectorAll(el.tagName)].indexOf(el)}`;
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== "none" ? parseFloat(cs.outlineWidth) : 0;
      const ring = outline >= minW || (cs.boxShadow !== "none" && cs.boxShadow !== "");
      const rect = el.getBoundingClientRect();
      const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1);
      const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
      const inView =
        rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      const top = document.elementFromPoint(cx, cy);
      const covered =
        inView && top !== null && top !== el && !el.contains(top) && !top.contains(el);
      return { id, ring, covered };
    }, minWidth);
    if (!r || seen.has(r.id)) break;
    seen.add(r.id);
    if (!r.ring) failures.push({ target: r.id, why: "no visible focus indicator" });
    if (r.covered) failures.push({ target: r.id, why: "focused element is obscured" });
  }
  const route = routeOf(page, o);
  return failures.map((f) => ({
    code: "IPB-A11Y-004" as const,
    check: "focus" as const,
    rule: f.why === "no visible focus indicator" ? "focus-visible" : "focus-not-obscured",
    route,
    ...(o.theme ? { theme: o.theme } : {}),
    detail: f.why,
    targets: [f.target],
  }));
}

export interface RequestRecorder {
  /** Third-party URLs requested since the recorder started. */
  requests(): string[];
  /** As findings (IPB-04-79: zero third-party requests before and after consent). */
  findings(o?: ScanOptions): GateFinding[];
  stop(): void;
}

/** Start before `page.goto`: records every request outside `origin` (and `allow`). */
export function recordThirdPartyRequests(
  page: Page,
  o: { origin: string; allow?: readonly string[] },
): RequestRecorder {
  const own = new Set([new URL(o.origin).origin, ...(o.allow ?? []).map((a) => new URL(a).origin)]);
  const seen: string[] = [];
  const onRequest = (req: Request) => {
    const url = req.url();
    if (/^(data|blob|about|chrome-extension):/.test(url)) return;
    try {
      if (!own.has(new URL(url).origin)) seen.push(url);
    } catch {
      seen.push(url);
    }
  };
  page.on("request", onRequest);
  return {
    requests: () => [...seen],
    findings: (so = {}) =>
      seen.length
        ? [
            {
              code: "IPB-A11Y-004" as const,
              check: "third-party" as const,
              rule: "third-party-request",
              route: so.route ?? routeOf(page, so),
              ...(so.theme ? { theme: so.theme } : {}),
              detail: `${seen.length} request(s) outside ${[...own].join(", ")}`,
              targets: [...new Set(seen.map((u) => new URL(u).origin))],
            },
          ]
        : [],
    stop: () => {
      page.off("request", onRequest);
    },
  };
}

/** One line per finding: `IPB-A11Y-004: <rule> on <route> [theme] — detail (targets)`. */
export function formatFindings(findings: readonly GateFinding[]): string {
  return findings
    .map(
      (f) =>
        `${f.code}: ${f.rule} on ${f.route}${f.theme ? ` [${f.theme}]` : ""} — ${f.detail}${f.targets.length ? ` (${f.targets.slice(0, 5).join(", ")})` : ""}`,
    )
    .join("\n");
}

/** Throws `IPB-A11Y-004` naming the first rule and route when there is any finding. */
export function assertGate(findings: readonly GateFinding[]): void {
  const first = findings[0];
  if (!first) return;
  throw new IpbError("IPB-A11Y-004", {
    detail: `${first.rule} on ${first.route}`,
    meta: { findings: formatFindings(findings) },
  });
}
