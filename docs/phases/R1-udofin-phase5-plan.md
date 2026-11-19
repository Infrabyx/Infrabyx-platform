# R1 — Udofin's Phase 5 and 6 requests, PR-UDF-037 to PR-UDF-047 (19 Nov 2026)

**Decisions:** R1-D-180 (accepted and ordered, owner 18 Nov), R1-D-188 (this plan), one row per item as built · **Order:** STATUS "Next" (owner, 19 Nov): PR-UDF-037 to PR-UDF-047 in order, then PR-LDC-46 and PR-LDC-52 · **Release:** minors and patches through the normal gate (#81(a)), with adoption notes in the product guide · **Spec read:** IPB-01 (ports, §01.4.6 kernel), IPB-02 (§02.4.6.1 maker-checker, IPB-02-12, -19, -51), IPB-09 (§09.4.6, -28, -34), IPB-10 (-04, -21, -24, -27), Ecosystem Spec v1.5 (nothing in these items touches a cross-product contract)

No item touches a locked-list item except PR-UDF-043 (3), which only **states** each adapter's documented funding source; the platform moves no money (R1-D-180). No item changes a migration that has shipped. Every new behaviour that could break a running product is opt-in or additive, so each lands as a minor.

## A. PR-UDF-037 — `Kernel.ambient` joins `read` (`tenancy` minor)

Today a `read` inside `ambient` opens its own read-only transaction on another connection, so it cannot see the ambient transaction's uncommitted writes (tenancy 1.19.0: "Reads are not joined"). Udofin keeps an `AmbientKernel` shim for this (its UDF-D-142).

- **Opt-in, per ambient call:** `ambient(ctx, fn, { ...mutateOptions, joinReads: true })` (`AmbientOptions extends MutateOptions`, in `tenancy`; the `MutationKernel` interface is unchanged). Default `false`: today's behaviour, so a product that runs reads concurrently inside `ambient` (`Promise.all`) is not broken by a minor. `[ASSUMED – owner review]` the opt-in (the request reads as the default); reversible by flipping the default in a later minor.
- **A joined read** runs on the ambient connection in a kernel unit (a savepoint) that is **always rolled back**: inside it `set local role <readRole>` and `set local transaction_read_only = on`, then the read's own `app.*` settings; rolling back the savepoint restores the ambient role, settings and read-write state (PostgreSQL: settings made with `SET LOCAL` inside a subtransaction are undone by `ROLLBACK TO SAVEPOINT`). Its `Tx` is a read-only view (`unit` refused, as a `read`'s is). It sees the ambient transaction's uncommitted writes and the ambient sandbox flag (R1-D-87).
- **Which reads join:** same tenant, principal, scope and break-glass grant as the ambient call, no `snapshot`, not a support, external or platform service-reader read (those keep their gates and roles). Any other read keeps its own transaction, as today: it cannot see the ambient tenant's rows under RLS anyway.
- **One at a time:** a joined read takes the same stack and in-flight bookkeeping as a joined mutation (R1-D-92): a concurrent sibling is refused with `KernelGuardError`; a read nested inside a joined mutation is allowed; a read still running when the ambient callback ends fails the ambient transaction.
- **Tests (PostgreSQL, `ambient.int.test.ts`):** a joined read sees an uncommitted insert; without `joinReads` it does not; a write inside a joined read is refused by PostgreSQL (read-only) and the ambient transaction carries on read-write; the read role applies (a table the read role cannot select is refused); another tenant's read keeps its own transaction; `snapshot` keeps its own; a concurrent sibling is refused; settings come back after the read.

## B. PR-UDF-038 — `toProblem` carries `reason` and `retry_after_seconds` (`contracts` minor)

- `Problem` gains two optional RFC 9457 extension members: **`reason`**, the error's `meta.reason` when it is a fixed label (`^[a-z][a-z0-9_]{0,63}$`; anything else is left out, so a value never leaks), and **`retry_after_seconds`**, from `meta.retryAfterSeconds` (or `meta.retry_after_seconds`) when the status is 429 or 503 and the value is an integer from 1 to 86400.
- `problemHeaders(problem)` returns `{ "Retry-After": "<n>" }` when `retry_after_seconds` is set (RFC 9110 §10.2.3, delay-seconds), else `{}`; the reference API's `ProblemFilter` sets it, as products should.
- **Tests (unit):** a label passes, a value-like or over-long `reason` is dropped; `retry_after_seconds` only on 429/503, integers 1 to 86400; the header; unknown errors unchanged; `toProblem` output still parses with `Problem`.

## C. PR-UDF-039 — Aadhaar Secure QR and the stored-object hash (`contracts`, `testing`, `connectors` minors)

- `AadhaarOfflineCheck` gains `kind: "xml_zip" | "secure_qr"` (default `xml_zip`, so today's callers are unchanged); `shareCode` is required for `xml_zip` and refused for `secure_qr`. `AadhaarOfflineResult.kind` echoes it.
- **Hash check, stated and tested:** the adapter reads the object from its STORAGE and refuses `IPB-PORT-002` `meta.reason: "hash_mismatch"` when its SHA-256 differs from `KycFileRef.sha256`, before any parse or vendor call. **Digits:** no result field carries more than the last four digits of an Aadhaar number (`maskedUid` is `XXXXXXXX1234`).
- **Secure QR verification** follows UIDAI's published Secure QR format (the decimal-encoded, compressed payload with UIDAI's signature over it) [VERIFY against UIDAI's Secure QR specification before the adapter path is turned on; until then the Digio and IDfy adapters answer `unsupported` for `secure_qr`, and the in-platform verifier is built only if the specification can be read from the session].
- **Contract suite:** `kycPortContract` gains a hash-mismatch case and a no-12-digit-run sweep over every result field (shared helper from F).
- **As built (R1-D-190):** `kind` optional (default `xml_zip`) and `shareCode` optional in the type with a refinement, so no caller breaks; the hash check was already in the Digio adapter and its test (R1-D-24), and every result was already swept by `noAadhaar` in `kycContractCases`; the new case accepts a verified Secure QR or an `unsupported` refusal. uidai.gov.in is outside the session's network, so no in-platform Secure QR verifier.

## D. PR-UDF-040 — DigiLocker start, evidence, idempotency (`contracts`, `testing`, `connectors` minors)

- `startDigilocker({ docTypes, returnUrl }, call) → { consentSession, signInUrl, expiresAt }`: the adapter builds the vendor request; `returnUrl` must be `https:` and on the tenant's allowed hosts (an option of the adapter, as egress is governed).
- `DigilockerDocument` gains `evidence: KycEvidence` and `signatureValid: boolean | null` (`null` when the vendor does not report it; the product records "not reported").
- `digilockerPull` is idempotent on `call.idempotencyKey`: a retry returns the stored documents rather than `consent_used` (the adapter keeps the key → document keys map in its own store, `connectors` `PgInbox`-style table, `connectors/0010`, tenant-scoped, forced RLS, ids and keys only).
- Stated in the contract: documents go to the adapter's own STORAGE; no key or issuer carries a 12-digit run; `consent_incomplete` is a refusal the product may retry within the session.
- Vendor API shapes for Digio's and IDfy's DigiLocker flows are `[VERIFY]` from their published API references at build time; adapters stay off until the sandboxes exist (owner answer #102).
- **As built (R1-D-193):** `startDigilocker` optional on `KycPort` (implementers outside the platform do not break) and built in the fake, Digio and the router; IDfy refuses it `unsupported`, as it does `digilockerPull`, until its sandbox confirms a DigiLocker flow. The return-address check is `digilockerReturnUrlAllowed` in `contracts` (exact hosts, empty by default). `evidence` and `signatureValid` optional in the type, always set by the platform's adapters (as C's `kind`). The store is `connectors/0010` `connectors.kyc_digilocker_pull` (key and session by SHA-256, one record per session, a pending, done or refused state, 24 hours, `[ASSUMED – owner review]` #144), with `PgDigilockerPullStore` and an in-memory default. Digio's template request, gateway address and per-file `signature_valid` are `[VERIFY]` in `digio.ts`, built against the stub only.

## E. PR-UDF-041 — Aadhaar OTP e-KYC for a notified RE (`contracts`, `testing`, `connectors` minors)

- `aadhaarOtpRequest({ uid, uidKind: "AADHAAR" | "VID", consent: { version, textHash, at } }, call) → { txn, expiresAt }` and `aadhaarOtpVerify({ txn, otp }, call) → AadhaarOtpResult` (`KycEvidence`, `ekyc: KycFileRef` of UIDAI's signed response in the RE's STORAGE, `signatureValid`, `uidLast4`).
- Idempotent on the call's key; the same key with another code is `IPB-PORT-004`. Definite refusals: `otp_invalid`, `otp_expired`, `uid_invalid`, `mobile_not_linked`, `not_configured`.
- The number is never in an answer, log, error or stored row: `uid` is `regulated`, scrubbed, and dropped after the vendor call; the contract test sweeps every answer field for a 12-digit or 16-digit run.
- **Who may call it:** only an RE notified under PML Act s.11A may use Aadhaar OTP e-KYC (KYC Directions 2025 para 23 proviso (i)) [VERIFY the paragraph numbers against the Directions as published]. The adapter option `notifiedEntity: true` is required, otherwise every call is `not_configured` (fail closed). Which KUA the RE uses (Digio, IDfy) is the RE's contract; both adapters get the methods against stubs, off.

## F. PR-UDF-042 — `beforeDrop` and a shared no-Aadhaar detector (`testing`, `contracts`, `ai` minors)

- `startPostgres({ beforeDrop })`: an async hook given the admin client, run by `end()` before the suite's database is dropped; a throw fails `end()` after the drop still runs.
- **Detector** in `@infrabyx/contracts/aadhaar` (no new package: `contracts` has no runtime dependencies to add): `findAadhaarLike(text)` for 12-digit Aadhaar numbers (first digit 2 to 9, Verhoeff check) and 16-digit Virtual IDs (Verhoeff), in plain and grouped forms (`1234 5678 9012`, `1234-5678-9012`), bounded by a non-digit, letter or `+`; returns masked spans (`XXXX XXXX 9012`) only. `verhoeffValid` moves there; `@infrabyx/ai` re-exports it unchanged and its `AADHAAR` scrub uses the shared rule.
- **CLI** `infrabyx-aadhaar-scan <paths…>` (in `testing`'s bin): walks files (skipping `node_modules`, `.git`, binaries), prints file, line and the masked span, exits 1 on a find. The platform's CI runs it over `packages/*/src/**/__fixtures__`, recorded fixtures and the integration databases (through `beforeDrop`).

## G. PR-UDF-043 — bank-account mode, idempotency, funding source (`contracts`, `testing`, `connectors` minors)

- `BankAccountCheck.mode?: "pennyless" | "penny_drop"`; `BankAccountResult.mode` (the mode used). An adapter that cannot honour the asked mode refuses `IPB-PORT-002` `meta.reason: "mode_unsupported"` (no silent fallback). Omitted: the adapter's configured mode, reported back.
- Idempotency stated: the same `PortCall.idempotencyKey` returns the first result and never verifies, or credits, twice (the adapter's result cache in its store, as D).
- `KYC_ADAPTER_FUNDING` per adapter: `{ pennyDrop: "provider" | "tenant" | "unknown" }` with its source [VERIFY against each vendor's documentation; `unknown` until verified]. Statement only; no money moves.
- Status set unchanged; no-12-digit-run sweep.

## H. PR-UDF-044 — liveness mode, threshold, idempotency, retention (`contracts`, `testing`, `connectors` minors)

- `LivenessCheck.mode?: "passive" | "active_gesture" | "active_voice"`; `ScoreResult.mode` and `ScoreResult.threshold` (the threshold the adapter applied). Unsupported mode: `mode_unsupported`, no fallback.
- Idempotency stated and tested for `livenessCheck` and `faceMatch`. `score` is finite, 0 to 1 (the adapter normalises or refuses `IPB-PORT-003`).
- `KYC_ADAPTER_RETENTION` per adapter: whether the vendor keeps a template or embedding beyond the call [VERIFY; `unknown` until a written statement from the vendor].

## I. PR-UDF-045 — RE-hosted V-CIP launcher (`contracts`, `connectors` minors)

- `launchVcip({ context, jws }, call) → { vcipId, launchUrl, expiresAt }` beside `startVcip`; the LSP hosts no V-CIP component.
- `VcipHandoffContext` in `contracts` (tenant, RE, LSP, customer ref, journey id, issued-at, expires-at, nonce; ids and times only), signed with `signRegulatedMessage` and verified with `verifyRegulatedMessage` plus a replay store (the existing ones in `crypto`).
- `vcipStatus(vcipId, call?)` takes a `PortCall` (optional: no break). `VcipManifest.reason` becomes a code from `VCIP_REASON_CODES` (the old free text kept as `reasonText`, deprecated, never shown). `liveness.mode` as H. No-12-digit-run sweep over the manifest.

## J. PR-UDF-046 — cheap webhook verification (`contracts`, `testing`, `connectors` minors)

- `verifyWebhook(rawBody, headers, meta) → { eventId, vcipId, receivedAt }`: signature and replay window only, no vendor call; `handleWebhook` stays (it now calls `verifyWebhook`, then `vcipStatus`).
- The KYC adapters verify Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`, HMAC-SHA256, 5-minute window; the platform's existing verifier) or RFC 9421, per the RE's provider configuration; Digio and IDfy keep `unsupported` until their schemes are verified [VERIFY].
- `kycPortContract`: a forged event is refused `IPB-API-018` with no vendor call (the fake counts calls).

## K. PR-UDF-047 — checkable approvals for the signed-in checker (`tenancy` minor; `workflow` source)

- `ApprovalsEngine.listCheckable(ctx, { cursor?, limit? }) → { items: CheckableApproval[], nextCursor }`: the tenant's **pending, unexpired** requests that this principal may check now: not their own (maker ≠ checker), not already decided by them, an action whose checker roles (after the tenant's narrowing, `checkerRolesFor`) include one of theirs, and for a levelled request the open level's roles. Agents get an empty list (they never check).
- `CheckableApproval`: `id`, `action`, `summary`, `riskClass`, `makerId`, `createdAt`, `expiresAt`, `currentLevel`, `requiredCheckers`, `approvals`. **Never** the sealed payload, its digest or class, or the diff.
- Paged by keyset on `(created_at, id)`, `limit` 1 to 100 (default 25), cursor opaque (base64url of the last pair); read through the kernel (`read`), so RLS scopes it to the tenant.
- **Work Inbox:** a `workflow` inbox source (`approvalsInboxSource(engine)`) if the inbox already takes pluggable sources; otherwise the inbox side waits and the product calls `listCheckable` directly [decided at build time from `workflow`'s inbox code].
- **Tests (PostgreSQL):** the maker's own request is absent; a non-checker role sees nothing; the tenant's narrowing applies; a level-2 request shows only to a level-2 role; a decided request is absent for that checker; expired requests are absent; paging is stable; another tenant's requests never appear; no payload field in an item.

## Exit checklist (per PR)

`pnpm check:full --pr-body <file>` including the Docker contract suites; the whole unit suite of each changed package; a Changeset per changed package; threat model rows for new data flows (D, E, F, I, J, K); help keys for new refusal reasons; the product guide section for adoption; DECISIONS row; STATUS.

## Owner decisions needed

None blocking. To confirm (each `[ASSUMED – owner review]` in its DECISIONS row): A's opt-in `joinReads` (rather than joining by default); B's label rule for `reason`; F's home for the detector (`contracts`, not a new package).
