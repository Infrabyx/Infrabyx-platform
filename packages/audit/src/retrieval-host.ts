// The never-null refused-retrieval host (Udofin PR-UDF-082; R1-D-279; threat model §3.185; owner
// answer #178 (e): every refused host is recorded, with no exception). `retrievalHostOf` in
// contracts answers the host in clear (a DNS name of at most 128 characters, or an IPv6 literal)
// and null otherwise, because contracts cannot hash (IPB-12-05). Here, beside the sink products
// call and with `@infrabyx/crypto` to hash, every input gets a recordable host:
//
// - a host `retrievalHostOf` answers is recorded as it is (forms (a) and (b));
// - any other host the WHATWG parser reads is recorded as `sha256:` + the SHA-256 hex of its
//   serialised form, with its length in `host_length` (form (c));
// - text with no host to read is recorded as the fixed marker `unparsable.invalid` (RFC 6761
//   `.invalid`, never a real host).
//
// No scheme, userinfo, port, path, query or fragment is ever recorded or hashed.
import {
  RETRIEVAL_HOST_LENGTH_MAX,
  RETRIEVAL_URL_MAX_LENGTH,
  retrievalHostOf,
  retrievalHostRefusedEvent,
  type SecurityEventInput,
} from "@infrabyx/contracts/kernel";
import { sha256Hex } from "@infrabyx/crypto";

/**
 * The host recorded when a refused retrieval URL has no host to read (R1-D-279): text that is not
 * a URL, a URL with no or an empty host (`mailto:`, `file:///x`), or text longer than
 * `RETRIEVAL_URL_MAX_LENGTH`. A name under RFC 6761's `.invalid`, which never resolves, so it
 * cannot be mistaken for a partner's host.
 */
export const RETRIEVAL_HOST_UNPARSABLE = "unparsable.invalid";

/** The host fields of a `connector.retrieval.host_refused` detail (R1-D-279). */
export interface RetrievalHostRecord {
  /** A DNS name, an IPv6 literal, a `sha256:` digest, or `RETRIEVAL_HOST_UNPARSABLE`. */
  host: string;
  /** With a digest host only: the length of the hashed host, 1 to `RETRIEVAL_HOST_LENGTH_MAX`. */
  host_length?: number;
}

/**
 * The host to record for a refused retrieval URL; never null and never throws, whatever the input
 * (PR-UDF-082). The URL is read with the WHATWG URL parser (`URL.parse`), and its host taken as
 * the parser serialises it (`URL.hostname`: lower case for http(s), IDN labels in punycode,
 * percent-decoded then validated; an opaque host of another scheme as written, with non-ASCII
 * percent-encoded), with one trailing dot removed. Then:
 *
 * - a DNS name of at most 128 characters or an IPv6 literal (bracketed, compressed, lower case):
 *   `{ host }`, exactly `retrievalHostOf(url)`;
 * - any other non-empty host (longer than 128 characters, or with characters outside the DNS
 *   pattern such as `_`): `{ host: "sha256:" + hex, host_length }`, where `hex` is the lower-case
 *   SHA-256 of the UTF-8 bytes of that host string (ASCII after serialisation) and `host_length`
 *   its length in characters. To recompute: `sha256(new URL(url).hostname.replace(/\.$/, ""))`;
 * - no host to read (not a string, longer than `RETRIEVAL_URL_MAX_LENGTH`, not a URL, an empty
 *   host, or a host longer than `RETRIEVAL_HOST_LENGTH_MAX`): `{ host: RETRIEVAL_HOST_UNPARSABLE }`.
 *
 * Userinfo, port, path, query and fragment are never part of the answer or of what is hashed.
 */
export function retrievalHostRecord(url: string): RetrievalHostRecord {
  const unparsable = { host: RETRIEVAL_HOST_UNPARSABLE };
  try {
    const clear = retrievalHostOf(url);
    if (clear !== null) return { host: clear };
    if (typeof url !== "string" || url.length > RETRIEVAL_URL_MAX_LENGTH) return unparsable;
    const parsed = URL.parse(url);
    if (!parsed) return unparsable;
    const host = parsed.hostname.endsWith(".") ? parsed.hostname.slice(0, -1) : parsed.hostname;
    if (host.length === 0 || host.length > RETRIEVAL_HOST_LENGTH_MAX) return unparsable;
    return { host: `sha256:${sha256Hex(host)}`, host_length: host.length };
  } catch {
    return unparsable;
  }
}

/** What `retrievalHostRefusedEventOf` takes: the detail's ids and the refused URL itself. */
export interface RetrievalHostRefusedInput {
  /** The partner (producer) tenant whose retrieval answer named the host. */
  partner_tenant_id: string;
  /** The document id and version as on `DocumentRetrieval` / `DocumentShared`. */
  document_id: string;
  version: number;
  /** The refused retrieval URL; only its host is recorded (`retrievalHostRecord`). */
  url: string;
}

/**
 * The checked `connector.retrieval.host_refused` event for a refused retrieval URL (PR-UDF-082):
 * `retrievalHostRefusedEvent` with the host from `retrievalHostRecord(url)`, so the event can be
 * built for every refused URL. Throws a RangeError naming the field (never its value) only when
 * `partner_tenant_id`, `document_id` or `version` does not fit the detail; never because of the URL.
 */
export function retrievalHostRefusedEventOf(input: RetrievalHostRefusedInput): SecurityEventInput {
  return retrievalHostRefusedEvent({
    partner_tenant_id: input.partner_tenant_id,
    document_id: input.document_id,
    version: input.version,
    ...retrievalHostRecord(input.url),
  });
}
