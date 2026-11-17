# R1 plan: web snapshots as evidence (LawDocsComply PR-LDC-40, wave 15)

Status: drafted and built 18 Nov 2026 (nineteenth session, R1-D-176), from the triage (R1-D-117, M90) and the threat-model entry written first in wave 14 (§3.125, R1-D-150). Packages: `contracts` minor, `connectors` minor (migration `connectors/0006`), `config` minor (three settings), `testing` minor (a fake and contract cases).

## 1. Scope

LawDocsComply keeps a dated, hashed copy of a public web page (a regulator's circular, a notice page) as evidence. Today it fetches and stores the page itself. The platform takes that over:

- `WebSnapshotPort.archive(request)` fetches one https URL through governed egress, stores the bytes as received in the tenant's STORAGE, scans them with the AV port, records the snapshot under RLS with a ledger entry in the same transaction, and returns the record.
- `get(id)` returns the record; `open(id)` returns the bytes of a released snapshot after checking their SHA-256, with the headers to serve them as a download only; `rescan(id)` scans a quarantined snapshot again (the AV port's `ERROR` keeps a file quarantined until a later scan, IPB-02-44).
- The fetch is the platform's first real `EgressPort` adapter, `governed` (IPB-04 §04.4.4, IPB-02-43): allow-list, DNS pinning, private and special-purpose ranges refused, redirects re-checked, size and time caps.

Not in scope: rendering (no headless browser, no script execution, no sub-resources: the page alone is fetched), robots.txt (a single user-requested fetch of a public page, as a browser would; IPB-03-79's robots rule is for Vidhi notebook sources, which may take this port later), and retention (the platform sets none unless the caller passes `retainUntil`; retention is the product's decision and on the locked list).

## 2. Interface (`contracts` minor, `ports/web-snapshot.ts`)

- `WEB_SNAPSHOT_CONTENT_TYPES`: `text/html`, `application/xhtml+xml`, `text/plain`, `application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`. SVG is not on it (it is active content).
- `WEB_SNAPSHOT_LIMIT_DEFAULTS` `{ maxBytes: 10 MiB, timeoutMs: 20 000 }` and maxima `{ maxBytes: 25 MiB (the AV adapter's default), timeoutMs: 60 000 }`; at most 5 redirects (fixed). `resolveWebSnapshotLimits` caps what is asked, as the PDF limits do.
- `WebSnapshotRequest` (strict): `url` (https, at most 2048 characters), `outputPrefix` (`OutputPrefix`, under the tenant's own prefix), `bucketClass` (`GENERAL`, `CONFIDENTIAL` or `REGULATED`; default `CONFIDENTIAL`), `compartment?`, `retainUntil?` (ISO date-time, in the future: a write-once copy), `reference?` (the product's record id, 1 to 120 printable characters), `limits?`.
- `WebSnapshot`: `id` (`wsn_<ULID>`), `tenantId`, `requestedUrl`, `finalUrl`, `redirects` (each hop's URL, in order), `httpStatus` (200), `contentType` (the media type, lower case), `charset` (or null), `contentEncoding` (`identity`, `gzip`, `deflate` or `br`, as served), `bytes`, `sha256`, `fetchedAt`, `file` (`DocFileRef`), `state` (`RELEASED`, `QUARANTINED`, `REJECTED`), `scan` (`verdict`, `engine`, `reason`, `threat`, `scannedAt`), `reference`, `requestedBy`, `retainUntil`.
- `WebSnapshotPort`: `archive(req, call?)`, `get(id, call?)`, `open(id, call?)` → `{ snapshot, body, headers }`, `rescan(id, call?)`.
- `webSnapshotDownloadHeaders(s)`: `Content-Type` as stored, `Content-Disposition: attachment; filename="<id>.<ext>"`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private, no-store`, `Cross-Origin-Resource-Policy: same-origin`.
- `EgressPort.fetch` gains optional, additive fields: options `maxRedirects` (0 by default: a redirect is refused, as today) and `tenantId`; the answer `finalUrl?`, `redirects?`, `contentEncoding?`. `FakeEgress` keeps working.
- Refusals: `IPB-SEC-018` (scheme, port, user-info, host not allow-listed, an address in a refused range, a redirect to http or past 5, a mixed DNS answer), `IPB-SEC-013` (size), `IPB-SEC-010` (content type not on the list, or bytes that do not match a binary type's signature), `IPB-SEC-019` (rate limit, with `retryAfterSeconds`), `IPB-PORT-002` (unreachable, timed out, a status other than 200), `IPB-PORT-001` (off). `open` of a snapshot not `RELEASED` is `IPB-SEC-011` (rejected) or `IPB-SEC-015` (quarantined); bytes that no longer hash to the record are `IPB-SEC-015` with reason `hash_mismatch`.

## 3. Governed egress (`connectors` `egress/governed.ts`, adapter `governed`)

- Per hop: `https:` only, port 443 only (an explicit `:443` is allowed), no user-info, a host name (an IP literal is refused: an allow-list names hosts), the host on the allow-list (`hostAllowed`, exact or `*.suffix`).
- DNS: `lookup(host, { all: true, verbatim: true })`. Every address must be public: one refused address refuses the hop (a mixed answer is how DNS rebinding is staged). The refused ranges are IANA's special-purpose registries (IPv4 and IPv6, read 18 Nov 2026, cited in the code) plus multicast, `0.0.0.0/8`, `240.0.0.0/4`, NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`, 6to4 `2002::/16`, Teredo `2001::/32`, and IPv4-mapped and -compatible IPv6 checked as IPv4. Checked with `node:net` `BlockList`.
- Pinning: the request goes through `node:https` with a `lookup` that returns only the checked address, so the connection is to the address that was checked; TLS verifies the certificate against the host name (SNI and `checkServerIdentity` unchanged).
- Redirects: 301, 302, 303, 307 and 308 with a `Location` are followed by GET up to `maxRedirects` (5 at most); each hop is checked as the first. No other status is followed.
- Request: `GET`, a fixed `User-Agent` (`InfrabyxWebSnapshot/1.0`) naming no tenant, `Accept` from the caller, `Accept-Encoding: gzip, deflate, br`, no cookies (none sent, `Set-Cookie` ignored), no `Authorization`, no `Referer`, no proxy environment variables honoured.
- Limits: one deadline for the whole chain (`timeoutMs`); a `Content-Length` over the cap is refused before reading; the body is read capped; a compressed body is inflated with `zlib` `maxOutputLength` at the cap, so a decompression bomb stops at the cap.
- Off behind `int.egress.governed.enabled` (PLATFORM, false, R4); health `down` while off.

## 4. Web snapshot service (`connectors` `web-snapshot/`)

`PlatformWebSnapshot` takes the kernel and audit sink (as the customer-identity store does), the `EgressPort`, `StoragePort`, `FileScanPort`, the `RateLimiter` from `@infrabyx/tenancy`, and getters for the three settings. `archive`:

1. Agents are refused (`IPB-SEC-004`), impersonation (`IPB-SEC-003`), and external principals, break-glass, platform contexts and platform staff (`IPB-SEC-004`, `meta.reason`). Off (`int.web_snapshot.enabled`) is `IPB-PORT-001`. The request is parsed; `outputPrefix` must be under the calling tenant's prefix.
2. The rate limiter: bucket `web_snapshot`, key the tenant, `int.web_snapshot.per_hour` per hour; over it is `IPB-SEC-019`.
3. The fetch, with the tenant's `int.web_snapshot.allow_hosts`, the limits and `maxRedirects: 5`; only 200 is kept.
4. The media type must be on the list; PDF, PNG, JPEG, GIF and WebP must start with their signature.
5. SHA-256; `put` (or `putWithRetention` when `retainUntil` is given) at `<outputPrefix>/<id>.<ext>` with the hash in the metadata.
6. The AV scan; `scanDecision` sets the state.
7. One transaction: the row in `connectors.web_snapshot` and the ledger entry `connectors.web_snapshot.archive` (the URL host, the final URL host, status, type, bytes, SHA-256 and state; the full URLs in `after`, kept as the entry's digest).

`rescan` takes only a `QUARANTINED` row, scans the same file and moves it to `RELEASED` or `REJECTED` with `connectors.web_snapshot.rescan`. `open` reads the row, refuses unless `RELEASED`, reads the object and refuses bytes that do not hash to the record.

## 5. Data model (migration `connectors/0006_web_snapshot.sql`, expand-only)

`connectors.web_snapshot`: `id` (`wsn_` ULID), `tenant_id`, `requested_url`, `final_url`, `redirects` (jsonb array), `http_status`, `content_type`, `charset`, `content_encoding`, `bytes`, `sha256`, `storage_key`, `fetched_at`, `state`, `scan_verdict`, `scan_engine`, `scan_reason`, `scan_threat`, `scanned_at`, `reference`, `requested_by`, `retain_until`, `created_at`. Forced RLS by `app.tenant_id`; `select, insert, update` to `app_rw`, `select` to `app_ro`, no delete grant. A trigger keeps every fetched field immutable and allows only `QUARANTINED` → `RELEASED` or `REJECTED` with new scan fields. Every column carries its data class. Products map the table in their own export maps (the reference map is the reference app's, which does not use snapshots).

## 6. Settings (`config` minor)

| Key                            | Tier     | Type     | Default | Change               | mc    |
| ------------------------------ | -------- | -------- | ------- | -------------------- | ----- |
| `int.egress.governed.enabled`  | PLATFORM | bool     | false   | PLT_SUPER_ADMIN      | R4    |
| `int.web_snapshot.enabled`     | PLATFORM | bool     | false   | PLT_SUPER_ADMIN      | R4    |
| `int.web_snapshot.allow_hosts` | TENANT   | string[] | []      | ORG_ADMIN            | R4    |
| `int.web_snapshot.per_hour`    | PLATFORM | int      | 60      | PLT_SECURITY_OFFICER | false |

## 7. Tests (by ID)

- `@IPB-04-AT-94` (SSRF guard), unit, `egress/__tests__/governed.test.ts`: every refused range (both families, mapped forms), scheme, port, user-info, IP literal, allow-list, a mixed DNS answer, pinning (the connection goes to the checked address even when a second lookup would answer otherwise), each redirect hop re-checked, a redirect to http, a sixth redirect, a size over the cap (by `Content-Length` and streamed), a gzip bomb stopped at the cap, the deadline, the fixed headers and no cookie sent back. Against a local TLS server with a test CA (a test-only option admits loopback).
- `web-snapshot.int.test.ts` (PostgreSQL 18): archive, the row and ledger entry in one transaction, RLS across two tenants, the trigger, rescan, `open` refusing a quarantined, rejected or altered copy, the rate limit, a refused type and a wrong signature, `retainUntil` takes the write-once path, off.
- `testing`: `FakeWebSnapshot` and `defineWebSnapshotContract`, run against the fake and the platform service.

## 8. Threat model

§3.125 becomes the as-built entry (no design change); `docs/security/threat-model.md` header updated.

## 9. Exit gate

`pnpm check:full` green locally (integration suites and Docker contract legs included), one `ci:run`, then the version PR (minors, #81(a)).

## 10. Owner decisions needed

None blocking. Assumptions taken `[ASSUMED – owner review]`, each reversible before a product relies on it (OWNER-QUESTIONS #134): (1) only HTTP 200 is kept, so a 404 page cannot be archived as proof that a page is gone; (2) the allow-list is per tenant (`int.web_snapshot.allow_hosts`, ORG_ADMIN under R4 maker-checker: settings take R2, R4 or R5), empty by default, so nothing can be fetched until a tenant lists hosts; (3) a compressed response is stored decoded (the bytes a browser would show), with the encoding recorded; (4) 60 snapshots per tenant per hour by default.
