# R1 — LDC-68: refuse zstd while the runtime's zstd is affected (CVE-2026-124851)

Owner's order of 27 Nov 2026, 07:45 IST, item 0 (urgent, first). A security update under the maintenance mode; built and released in one minor without a plan stop (R1-D-294, R1-D-295).

## Finding

- Node.js 24.22.1 (and 24.22.3) bundles zstd 1.5.7 (`process.versions.zstd`), inside CVE-2026-124851's affected range 1.5.1 to 1.5.7.
- body-parser 2.4.0 (Express 5.2.1, `@nestjs/platform-express` 11.2.7) decodes a `Content-Encoding: zstd` request body with `zlib.createZstdDecompress()` before any guard.
- Node's `fetch` (bundled undici 7.30.1) offers zstd over https and decodes a zstd response whatever was offered.
- R1-D-291 called the Debian `libzstd1` finding unreachable because Node.js bundles its own zstd. That premise is wrong; R1-D-294 corrects it.

## Interfaces (`@infrabyx/connectors/content-coding`, new subpath)

| Export                                                                                                                | What                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `refuseZstdBodies`, `refuseZstdBodiesWith({ productPrefix, typeBase })`                                               | Connect/Express middleware: 415 `IPB-SEC-010`, `reason: content_encoding`, body never read |
| `refuseZstdFetch(fetchImpl?)`, `RefusedContentCodingError`                                                            | A fetch that never offers zstd and refuses a zstd response unread                          |
| `contentCodings`, `namesRefusedCoding`, `refusedCodingProblem`                                                        | The parsing and the problem, for products with another server                              |
| `REFUSED_CONTENT_CODINGS`, `ACCEPTED_REQUEST_CODINGS`, `OUTBOUND_ACCEPT_ENCODING`, `CONTENT_CODING_PROBLEM_TYPE_BASE` | The constants                                                                              |

## Changes

1. `apps/reference/api`: `app.use(refuseZstdBodies)` straight after `NestFactory.create`, before Nest's body parsers (added at `init`) and any guard. The scaffold copies it.
2. `createEgress` wraps its fetch, injected ones included; a zstd answer is `IPB-SEC-010`, not retried.
3. OpenFGA's direct `fetch` calls use `refuseZstdFetch`; Cerbos's client gets the same `Accept-Encoding`.
4. Consent's OH ledger, Vidhi's MCP client and the reference web app send `Accept-Encoding: gzip, deflate, br`.
5. The waiver `CVE-2026-124851` ends 2026-12-07 (was 25 Dec).

No migration, setting, environment variable, dependency, error code or algorithm.

## Tests

- `connectors` `content-coding.test.ts`: parsing; 415 with the problem, headers and an untouched body; lists, capitals, repeated headers, `x-zstd`; gzip, deflate, br and identity pass; product prefix; the wrapper's `Accept-Encoding` in each header shape; a zstd response refused (plain `fetch` decodes it); `createEgress` refuses without retry, injected fetch included.
- `reference-api` `content-coding.test.ts`: `createApp` answers 415 and builds no zstd decoder; a broken zstd body is 415, not body-parser's 400 (fails if the order changes); gzip, deflate, br not refused; Express 5 with body-parser decodes gzip, deflate, br and identity, and the bare stack decodes zstd (the exposure) while the guarded one refuses it.
- Each refusal test was checked to fail with the guard removed.

## Exit checklist

- [x] IPB-09 required checks green on the PR
- [x] Threat model §3.194, guide §7fb, DECISIONS R1-D-294, owner question #209
- [x] Changeset: `connectors` minor, `consent` and `vidhi` patches
