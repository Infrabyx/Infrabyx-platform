// The feedback payload and its minimisation (IPB-04-95; `@IPB-04-AT-91`; PL5 plan §7.1). The widget
// may send only the fields below. Anything else (page HTML, form values, a screenshot, a full URL or
// a query string) is refused whole with `IPB-FB-001` and nothing is stored: the server never
// "cleans" a request that tried to send more. Identifiers in the route are reduced to `:id`, the
// user agent to an OS and browser family, and the summary is scanned for personal numbers and
// secrets with the AI gateway's detectors.
import { z } from "zod";
import { IpbError } from "@infrabyx/contracts/errors";
import type { FeedbackCategory } from "@infrabyx/contracts/ports";
import { Scrubber } from "@infrabyx/ai";

export const FEEDBACK_TYPES = [
  "bug",
  "idea",
  "praise",
  "nps",
  "accessibility",
  "help_content",
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** The widget never offers SECURITY: those go to the VDP (`/.well-known/security.txt`). */
export const WIDGET_CATEGORIES = [
  "BUG",
  "IDEA",
  "UX",
  "ACCESSIBILITY",
  "CONTENT",
  "HELP_ARTICLE",
] as const satisfies readonly FeedbackCategory[];

export const DEFAULT_CATEGORY: Record<FeedbackType, (typeof WIDGET_CATEGORIES)[number]> = {
  bug: "BUG",
  idea: "IDEA",
  praise: "UX",
  nps: "UX",
  accessibility: "ACCESSIBILITY",
  help_content: "HELP_ARTICLE",
};

export const VIEWPORT_CLASSES = ["xs", "sm", "md", "lg", "xl"] as const;

/** Names that announce content the widget must never send; listed so the refusal can say why. */
export const FORBIDDEN_FIELDS = [
  "page_html",
  "html",
  "dom",
  "url",
  "href",
  "query",
  "form_values",
  "fields",
  "screenshot",
  "attachment",
  "attachments",
  "document_id",
  "email",
  "phone",
  "name",
] as const;

/** The honeypot rendered off-screen in the no-JavaScript form; any value means a bot. */
export const FEEDBACK_HONEYPOT = "website_url";

export const FeedbackInput = z
  .object({
    type: z.enum(FEEDBACK_TYPES),
    category: z.enum(WIDGET_CATEGORIES).optional(),
    summary: z.string().trim().min(1).max(2000),
    nps_score: z.coerce.number().int().min(0).max(10).optional(),
    /** The route pattern (`/docs/[id]`) or a path, which is reduced to one. */
    route: z.string().max(300).optional(),
    app_version: z.string().max(40).optional(),
    brand_pack_id: z.string().regex(/^brd_/).optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .optional(),
    viewport: z.enum(VIEWPORT_CLASSES).optional(),
    trace_id: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    contact_ok: z.union([z.boolean(), z.literal("on")]).optional(),
    /** Accessibility reports (IPB-06-61): the assistive technology and what was expected. */
    assistive_tech: z.string().trim().max(120).optional(),
    expected: z.string().trim().max(1000).optional(),
    blocking: z.union([z.boolean(), z.literal("on")]).optional(),
    [FEEDBACK_HONEYPOT]: z.string().max(200).optional(),
    /** The CSRF field of the no-JavaScript form; checked by the app, never stored. */
    csrf: z.string().max(200).optional(),
  })
  .strict();
export type FeedbackInput = z.infer<typeof FeedbackInput>;

/** A path segment that identifies a record rather than a page. */
const ID_SEGMENT =
  /^(?:[a-z]{2,6}_[0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{3,}|[A-Za-z0-9_-]{20,})$/i;

/**
 * The route pattern for a path: no scheme, host, query or fragment (those are refused, not
 * stripped), and identifier segments replaced by `:id`.
 */
export function routePattern(route: string): string {
  const r = route.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith("//") || /[?#]/.test(r))
    throw new IpbError("IPB-FB-001", { detail: "send the route pattern, not a URL or query" });
  if (!r.startsWith("/")) throw new IpbError("IPB-FB-001", { detail: "route must start with /" });
  const segs = r
    .split("/")
    .slice(1)
    .map((s) => (/^\[[A-Za-z0-9_.]+\]$/.test(s) || !ID_SEGMENT.test(s) ? s : ":id"));
  const out = `/${segs.join("/")}`.slice(0, 200);
  if (!/^\/[A-Za-z0-9/_:.\-[\]]*$/.test(out))
    throw new IpbError("IPB-FB-001", { detail: "route pattern has characters it cannot carry" });
  return out;
}

/** OS and browser family from a User-Agent; never the full string or a version. */
export function uaFamilies(ua: string | undefined): { os: string | null; browser: string | null } {
  if (!ua) return { os: null, browser: null };
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "Other";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Other";
  return { os, browser };
}

const scrubber = new Scrubber();

/**
 * Personal numbers and secrets in free text (Aadhaar, PAN, card, account and mobile numbers, e-mail,
 * keys and the other IPB-03-27 kinds). The kinds found, never the values.
 */
export function piiKinds(text: string): string[] {
  return [...new Set(scrubber.detect(text).map((d) => d.kind))].sort();
}

/**
 * Parse a raw request body: unknown or forbidden fields, a URL or query in the route, or personal
 * data in the text are refused with `IPB-FB-001` before anything is stored.
 */
export function parseFeedback(raw: unknown): FeedbackInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new IpbError("IPB-FB-001", { detail: "expected a form or JSON object" });
  const forbidden = Object.keys(raw).filter((k) =>
    (FORBIDDEN_FIELDS as readonly string[]).includes(k.toLowerCase()),
  );
  if (forbidden.length)
    throw new IpbError("IPB-FB-001", {
      detail: `fields never captured: ${forbidden.sort().join(", ")}`,
    });
  const r = FeedbackInput.safeParse(raw);
  if (!r.success) {
    const unknown = r.error.issues.find((i) => i.code === "unrecognized_keys");
    throw new IpbError("IPB-FB-001", {
      detail: unknown
        ? `fields never captured: ${(unknown as { keys: string[] }).keys.join(", ")}`
        : (r.error.issues[0]?.message ?? "invalid feedback"),
    });
  }
  const v = r.data;
  if ((v.type === "nps") !== (v.nps_score !== undefined))
    throw new IpbError("IPB-FB-001", { detail: "a score goes with an NPS answer only" });
  for (const text of [v.summary, v.expected, v.assistive_tech]) {
    const kinds = text ? piiKinds(text) : [];
    if (kinds.length)
      throw new IpbError("IPB-FB-001", {
        detail: `remove personal details before sending (${kinds.join(", ")})`,
      });
  }
  return v;
}

export const isOn = (v: boolean | "on" | undefined): boolean => v === true || v === "on";
