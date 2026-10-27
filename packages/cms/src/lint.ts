// Publish lint (IPB-04-07, 04-11, 04-69, 04-102; IPB-08-24; owner rule O-5; PL5 plan §5.4). Runs on
// every submit and on seed content. Blocking findings carry their error code:
//   IPB-CMS-010  a stats or timeline figure without an active claim of class E1 or above
//   IPB-CMS-014  a logo without permission evidence, a testimonial (#42), a photo without consent
//   IPB-CMS-012  banned wording, or a category claim ("India's first") without an E2+ claim
//   IPB-TRUST-006 a certification or audit asserted without an active E3+ claim linked to a
//                 vendor-assurance document
//   IPB-CMS-015  dark patterns in hero, CTA and pricing copy
//   IPB-CMS-007  an image without alt text that is not marked decorative
// The word list is data (`claims/words.json`); a product may add phrases, never remove them.
import { readFileSync } from "node:fs";
import type { IpbErrorCode } from "@infrabyx/contracts/errors";
import { flattenBlocks, type Block } from "./blocks.js";
import type { ContentType } from "./types.js";

export interface WordList {
  banned: string[];
  category: string[];
  certification: string[];
  dark_patterns: string[];
}

const BASE: WordList = JSON.parse(
  readFileSync(new URL("../claims/words.json", import.meta.url), "utf8"),
) as WordList;

/** The platform list plus a product's additions (never fewer). */
export function wordList(extra: Partial<WordList> = {}): WordList {
  const merge = (k: keyof WordList) => [...new Set([...BASE[k], ...(extra[k] ?? [])])];
  return {
    banned: merge("banned"),
    category: merge("category"),
    certification: merge("certification"),
    dark_patterns: merge("dark_patterns"),
  };
}

export const EVIDENCE_CLASSES = ["E0", "E1", "E2", "E3", "E4"] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];
const rank = (c: string) => EVIDENCE_CLASSES.indexOf(c as EvidenceClass);

export interface ClaimInfo {
  id: string;
  evidenceClass: EvidenceClass;
  kind: "figure" | "certification" | "audit" | "permission" | "category";
  status: "proposed" | "active" | "expired" | "withdrawn";
  asOf: string;
  evidenceDocId: string | null;
  permissionDocId: string | null;
}

export interface MediaInfo {
  id: string;
  kind: string;
  altText: string | null;
  decorative: boolean;
}

export interface LintFinding {
  code: IpbErrorCode;
  path: string;
  message: string;
}

export interface LintInput {
  type: ContentType;
  title: string;
  seo: Record<string, unknown>;
  body: Record<string, unknown>;
  blocks: readonly Block[];
  /** The item's `claims_refs` (claims that back category or certification wording). */
  claimsRefs: readonly string[];
  claims: ReadonlyMap<string, ClaimInfo>;
  media: ReadonlyMap<string, MediaInfo>;
  words?: WordList;
}

export interface LintResult {
  findings: LintFinding[];
  /** Flags that route the item to legal review (IPB-04 §04.4.3 "any lint flag"). */
  legalFlags: string[];
}

const NEGATION = /\b(not|no|never|cannot|can't|doesn't|don't|won't|without|nor)\b/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Phrases found in `text`, skipping those negated within the three words before them. */
export function findPhrases(text: string, phrases: readonly string[]): string[] {
  const hits: string[] = [];
  for (const p of phrases) {
    const lead = /^\w/.test(p) ? "\\b" : "(?:^|\\s)";
    const tail = /\w$/.test(p) ? "\\b" : "(?=\\s|$|[.,;:!?)])";
    const re = new RegExp(`${lead}${escapeRe(p)}${tail}`, "gi");
    for (const m of text.matchAll(re)) {
      const before = text.slice(0, m.index).split(/\s+/).slice(-4).join(" ");
      if (!NEGATION.test(before)) {
        hits.push(p);
        break;
      }
    }
  }
  return hits;
}

/** Every human-readable string in a value (ids, URLs and keys excluded). */
function strings(v: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof v === "string") {
    if (!/^(https?:|mailto:|tel:|\/|#|[a-z]{2,4}_[0-7][0-9A-HJKMNP-TV-Z]{25}$)/.test(v))
      out.push({ path, text: v });
    return;
  }
  if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if (
        [
          "_type",
          "_key",
          "style",
          "listItem",
          "marks",
          "type",
          "slot",
          "key",
          "href",
          "url",
        ].includes(k)
      )
        continue;
      strings(x, `${path}.${k}`, out);
    }
}

const activeAtLeast = (c: ClaimInfo | undefined, min: EvidenceClass) =>
  !!c && c.status === "active" && rank(c.evidenceClass) >= rank(min);

export function lintContent(input: LintInput): LintResult {
  const words = input.words ?? wordList();
  const findings: LintFinding[] = [];
  const legalFlags: string[] = [];
  const claim = (id: string | undefined) => (id ? input.claims.get(id) : undefined);
  const needMedia = (id: string | undefined, path: string) => {
    if (!id) return;
    const m = input.media.get(id);
    if (!m) findings.push({ code: "IPB-CMS-007", path, message: `media ${id} not found` });
    else if ((m.kind === "image" || m.kind === "svg") && !m.decorative && !m.altText?.trim())
      findings.push({ code: "IPB-CMS-007", path, message: `image ${id} has no alt text` });
  };

  const all = flattenBlocks(input.blocks);
  all.forEach((b, i) => {
    const at = `blocks[${i}]`;
    switch (b.type) {
      case "stats":
        b.items.forEach((s, j) => {
          if (!activeAtLeast(claim(s.claims_ref), "E1"))
            findings.push({
              code: "IPB-CMS-010",
              path: `${at}.items[${j}]`,
              message: s.claims_ref
                ? `claim ${s.claims_ref} is not active at E1 or above`
                : `"${s.value} ${s.label}" needs a Claims Register reference`,
            });
        });
        break;
      case "timeline":
        b.items.forEach((t, j) => {
          if (t.claims_ref && !activeAtLeast(claim(t.claims_ref), "E1"))
            findings.push({
              code: "IPB-CMS-010",
              path: `${at}.items[${j}]`,
              message: `claim ${t.claims_ref} is not active at E1 or above`,
            });
        });
        break;
      case "logo_wall":
        b.logos.forEach((l, j) => {
          const c = claim(l.claims_ref);
          if (!c || c.status !== "active" || c.kind !== "permission" || !c.permissionDocId)
            findings.push({
              code: "IPB-CMS-014",
              path: `${at}.logos[${j}]`,
              message: `${l.org} needs a permission claim with the written permission document`,
            });
          needMedia(l.media_id, `${at}.logos[${j}].media_id`);
        });
        break;
      case "testimonial":
        findings.push({
          code: "IPB-CMS-014",
          path: at,
          message:
            "testimonials are not enabled until their permission gate exists (OWNER-QUESTIONS #42)",
        });
        break;
      case "hero":
        needMedia(b.media_id, `${at}.media_id`);
        break;
      case "media":
        needMedia(b.media_id, `${at}.media_id`);
        break;
      case "comparison_table":
        if (b.names_competitor) legalFlags.push("comparison names a competitor");
        break;
      case "rich_text":
        for (const n of b.content as { _type?: string; media_id?: string }[])
          if (n._type === "image") needMedia(n.media_id, `${at}.content`);
        break;
      default:
        break;
    }
  });

  if (input.type === "team_member") {
    const photo = input.body.photo_media_id as string | undefined;
    if (photo && input.body.photo_consent !== true)
      findings.push({
        code: "IPB-CMS-014",
        path: "body.photo_media_id",
        message: "a team photo needs photo consent recorded on the person",
      });
    needMedia(photo, "body.photo_media_id");
  }
  if (input.type === "blog_post")
    needMedia(input.body.hero_media_id as string | undefined, "body.hero_media_id");

  const texts: { path: string; text: string }[] = [{ path: "title", text: input.title }];
  strings(input.seo, "seo", texts);
  strings(input.body, "body", texts);
  const itemClaims = input.claimsRefs.map((id) => input.claims.get(id));
  const hasCategoryClaim = itemClaims.some((c) => c?.kind === "category" && activeAtLeast(c, "E2"));
  const hasCertClaim = itemClaims.some(
    (c) =>
      (c?.kind === "certification" || c?.kind === "audit") &&
      activeAtLeast(c, "E3") &&
      !!c.evidenceDocId,
  );
  // Dark-pattern lint applies to persuasive copy: hero and CTA blocks, and pricing copy.
  const ctaBlocks = new Set(
    input.blocks
      .map((b, i) => (b.type === "hero" || b.type === "cta" ? i : -1))
      .filter((i) => i >= 0),
  );
  for (const t of texts) {
    for (const p of findPhrases(t.text, words.banned))
      findings.push({ code: "IPB-CMS-012", path: t.path, message: `prohibited wording "${p}"` });
    if (!hasCategoryClaim)
      for (const p of findPhrases(t.text, words.category))
        findings.push({
          code: "IPB-CMS-012",
          path: t.path,
          message: `category claim "${p}" needs a category claim of class E2 or above`,
        });
    if (!hasCertClaim)
      for (const p of findPhrases(t.text, words.certification))
        findings.push({
          code: "IPB-TRUST-006",
          path: t.path,
          message: `"${p}" needs an active certification or audit claim linked to a trust document`,
        });
    const blockIdx = /^body\.blocks\[(\d+)\]/.exec(t.path)?.[1];
    const inCta = blockIdx !== undefined && ctaBlocks.has(Number(blockIdx));
    if (inCta || input.type === "pricing_copy")
      for (const p of findPhrases(t.text, words.dark_patterns))
        findings.push({ code: "IPB-CMS-015", path: t.path, message: `dark pattern "${p}"` });
  }
  return { findings, legalFlags };
}
