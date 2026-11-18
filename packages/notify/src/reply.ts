// Inbound email replies: the pure parts (LawDocsComply PR-LDC-50; R1-D-177; plan
// `docs/phases/R1-inbound-mail-plan.md` §4; threat model §3.123). The service in `service.ts` does
// the I/O: token lookup, storage, scan, ledger and outbox.
//
//   * Reply tokens are 20 random bytes (C-06) in lower-case base32 (RFC 4648 §6 alphabet), 32
//     characters, so `reply+<token>@<domain>` keeps the local part at 38 octets (RFC 5321 §4.5.3.1.1
//     allows 64). Only the SHA-256 is stored.
//   * A message is bounded before it is parsed (size, line length, declared charsets) and while it
//     is parsed (postal-mime 4.2.1's `maxPartCount`, `maxNestingDepth`, `maxHeadersSize`; a
//     forwarded `message/rfc822` is an attachment, never parsed inline).
//   * Authentication is the receiving adapter's verdict, never a header of the message.
//   * HTML is converted to text and never rendered; quoted history is removed.
import PostalMime, { type Email } from "postal-mime";
import {
  INBOUND_MAIL_CHARSETS,
  INBOUND_MAIL_LIMITS,
  type InboundDropReason,
  type InboundEmail,
} from "@infrabyx/contracts/ports";
import { randomBytes, sha256Hex } from "@infrabyx/crypto";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Lower-case RFC 4648 base32 without padding (20 bytes → 32 characters). */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** A new reply token and the SHA-256 that is the only thing stored. */
export function mintReplyToken(): { token: string; hash: string } {
  const token = base32(randomBytes(20));
  return { token, hash: sha256Hex(token) };
}

/** A host name of at least two labels, lower case (the tenant's reply subdomain). */
export const REPLY_DOMAIN =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const replyAddress = (token: string, domain: string): string => `reply+${token}@${domain}`;

const REPLY_RECIPIENT = /^reply\+([a-z2-7]{32})@([a-z0-9.-]{3,253})$/;

/**
 * The reply token among the envelope recipients: exactly one recipient of the reply form, or the
 * reason the message is dropped.
 */
export function replyRecipient(
  recipients: readonly string[],
): { token: string; domain: string } | { drop: "no_token" | "ambiguous" } {
  const found = new Map<string, { token: string; domain: string }>();
  for (const r of recipients) {
    const m = REPLY_RECIPIENT.exec(r.toLowerCase());
    if (m?.[1] && m[2]) found.set(`${m[1]}@${m[2]}`, { token: m[1], domain: m[2] });
  }
  if (found.size === 0) return { drop: "no_token" };
  if (found.size > 1) return { drop: "ambiguous" };
  return [...found.values()][0] as { token: string; domain: string };
}

const CHARSETS = new Set<string>(INBOUND_MAIL_CHARSETS);
const latin1 = new TextDecoder("latin1");

/**
 * Checks made on the raw bytes before any parsing: the size, RFC 5322 §2.1.1's 998-octet line limit
 * and the charset allow-list. Charsets are read from `Content-Type` parameters (with RFC 2231
 * extended values) and RFC 2047 encoded words; any one not on the list drops the message.
 */
export function prescan(raw: Uint8Array): InboundDropReason | null {
  if (raw.byteLength > INBOUND_MAIL_LIMITS.maxBytes) return "too_large";
  let start = 0;
  for (let i = 0; i <= raw.byteLength; i++) {
    if (i === raw.byteLength || raw[i] === 0x0a) {
      let end = i;
      if (end > start && raw[end - 1] === 0x0d) end -= 1;
      if (end - start > INBOUND_MAIL_LIMITS.maxLineOctets) return "line_length";
      start = i + 1;
    }
  }
  const text = latin1.decode(raw);
  for (const m of text.matchAll(/^content-type:[^\n]*(?:\r?\n[ \t][^\n]*)*/gim)) {
    const header = m[0];
    for (const c of header.matchAll(/charset\*?\s*=\s*"?([^";\s']*)/gi)) {
      const name = (c[1] ?? "").toLowerCase();
      if (!CHARSETS.has(name)) return "charset";
    }
    for (const c of header.matchAll(/\*(?:\d+\*)?\s*=\s*([^'";\s]*)'/g)) {
      const name = (c[1] ?? "").toLowerCase();
      if (name !== "" && !CHARSETS.has(name)) return "charset";
    }
  }
  for (const m of text.matchAll(/^content-disposition:[^\n]*(?:\r?\n[ \t][^\n]*)*/gim))
    for (const c of m[0].matchAll(/\*(?:\d+\*)?\s*=\s*([^'";\s]*)'/g)) {
      const name = (c[1] ?? "").toLowerCase();
      if (name !== "" && !CHARSETS.has(name)) return "charset";
    }
  for (const w of text.matchAll(/=\?([^?\s*]+)(?:\*[^?\s]*)?\?[bq]\?/gi))
    if (!CHARSETS.has((w[1] ?? "").toLowerCase())) return "charset";
  return null;
}

const PARSE_ERRORS: Readonly<Record<string, InboundDropReason>> = {
  EMAXPARTCOUNT: "parts",
  EMAXNESTINGDEPTH: "depth",
  EMAXHEADERSIZE: "headers",
};

/** The bounded parse: the message, or the reason it is dropped. */
export async function parseInbound(
  raw: Uint8Array,
): Promise<{ email: Email } | { drop: InboundDropReason }> {
  const pre = prescan(raw);
  if (pre) return { drop: pre };
  try {
    const email = await PostalMime.parse(raw, {
      attachmentEncoding: "arraybuffer",
      maxPartCount: INBOUND_MAIL_LIMITS.maxParts,
      maxNestingDepth: INBOUND_MAIL_LIMITS.maxDepth,
      maxHeadersSize: INBOUND_MAIL_LIMITS.maxHeaderBytes,
      maxRfc822NestingDepth: 0,
      forceRfc822Attachments: true,
      maxForwardedAddresses: 100,
    });
    return { email };
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    return { drop: (typeof code === "string" && PARSE_ERRORS[code]) || "parse" };
  }
}

/** The single `From` mailbox (lower case), or null when there is none, a group, or more than one. */
export function singleFrom(email: Email): string | null {
  const from = email.from;
  if (!from || from.group !== undefined || !from.address) return null;
  // postal-mime reports the first From mailbox; a second one in the same header is refused here.
  const fromHeaders = email.headers.filter((h) => h.key === "from");
  if (fromHeaders.length !== 1 || (fromHeaders[0]?.value.match(/@/g) ?? []).length !== 1)
    return null;
  const a = from.address.trim().toLowerCase();
  return /^[^\s@<>"]{1,64}@[a-z0-9.-]{1,253}$/.test(a) ? a : null;
}

const domainOf = (address: string): string => {
  const at = address.lastIndexOf("@");
  return at < 0 ? "" : address.slice(at + 1).toLowerCase();
};

/**
 * The sender rule (plan §4 rule 4): DMARC `pass`; or, where the sender's domain has no enforceable
 * DMARC policy (`none`), an aligned DKIM `pass` and an SPF `pass` whose envelope-from domain is the
 * `From` domain (strict alignment, so no public-suffix list is needed). Anything else fails.
 */
export function senderAuthenticated(m: Pick<InboundEmail, "auth" | "envelopeFrom">, from: string) {
  if (m.auth.dmarc === "pass") return true;
  if (m.auth.dmarc !== "none") return false;
  const env = domainOf(m.envelopeFrom);
  return (
    m.auth.dkimAligned === "pass" && m.auth.spf === "pass" && env !== "" && env === domainOf(from)
  );
}

// ------------------------------------------------------------------------------- reply text

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  trade: "™",
  bull: "•",
  middot: "·",
  rupee: "₹",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Where mail clients start the quoted part of an HTML reply; everything from there is cut. */
const HTML_QUOTE_STARTS = [
  /<div[^>]*class=["']?[^"'>]*\bgmail_quote\b/i, // Gmail
  /<div[^>]*id=["']?appendonsend\b/i, // Outlook
  /<div[^>]*id=["']?divRplyFwdMsg\b/i, // Outlook
  /<div[^>]*class=["']?[^"'>]*\bmoz-cite-prefix\b/i, // Thunderbird
  /<blockquote[^>]*type=["']?cite\b/i, // Apple Mail
  /<div[^>]*class=["']?[^"'>]*\byahoo_quoted\b/i, // Yahoo
];

/** HTML to plain text, for reading only: nothing is rendered, scripts and styles are dropped. */
export function htmlToText(html: string): string {
  let h = html.slice(0, 2 * INBOUND_MAIL_LIMITS.maxBytes);
  for (const re of HTML_QUOTE_STARTS) {
    const at = h.search(re);
    if (at >= 0) h = h.slice(0, at);
  }
  h = h
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|script|style|title|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<blockquote\b[\s\S]*?<\/blockquote\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol)\s*>/gi, "\n")
    .replace(/<(hr|p|div|li|tr)\b[^>]*>/gi, (m) => (/^<hr/i.test(m) ? "\n" : ""))
    .replace(/<[^>]*>/g, "");
  return decodeEntities(h)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

const CUT_LINES: readonly RegExp[] = [
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i, // Outlook, older clients
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^_{10,}\s*$/, // Outlook's rule above its header block
  /^-- $/, // the signature delimiter (RFC 3676 §4.3)
  /^Sent from my (iPhone|iPad|Android|mobile)/i,
];

/** "On <date>, <name> wrote:" in one line or split over two (Gmail wraps it). */
const ON_WROTE = /^On\b.{0,300}\bwrote:\s*$/;
const ON_START = /^On\b.{0,300}$/;
const WROTE_END = /^.{0,300}\bwrote:\s*$/;
/** Outlook's header block: `From:` then `Sent:` or `Date:` within the next two lines. */
const OUTLOOK_FROM = /^\*?From:\*?\s.+/;
const OUTLOOK_NEXT = /^\*?(Sent|Date|To):\*?\s.+/;

/** Removes quoted history and the signature; keeps the reply's own text. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const t = line.trim();
    if (ON_WROTE.test(t)) break;
    if (ON_START.test(t) && WROTE_END.test((lines[i + 1] ?? "").trim())) break;
    if (CUT_LINES.some((re) => re.test(line) || re.test(t))) break;
    if (
      OUTLOOK_FROM.test(t) &&
      (OUTLOOK_NEXT.test((lines[i + 1] ?? "").trim()) ||
        OUTLOOK_NEXT.test((lines[i + 2] ?? "").trim()))
    )
      break;
    if (/^>/.test(t)) continue;
    kept.push(line.replace(/[ \t]+$/, ""));
  }
  return kept.join("\n").trim();
}

/** The reply's own text: `text/plain` if present, else the HTML as text; history removed, capped. */
export function replyText(email: Pick<Email, "text" | "html">): string {
  const source =
    typeof email.text === "string" && email.text.trim() !== ""
      ? email.text
      : typeof email.html === "string"
        ? htmlToText(email.html)
        : "";
  // Control characters other than tab and line feed are removed (never rendered, never stored).
  // eslint-disable-next-line no-control-regex
  const clean = stripQuoted(source).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  return [...clean].slice(0, INBOUND_MAIL_LIMITS.maxTextChars).join("");
}
