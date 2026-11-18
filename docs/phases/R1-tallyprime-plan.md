# R1 plan: the TallyPrime adapter and its local agent (Finbyx PR-FBX-46, wave 15)

**Status:** plan, written and self-reviewed 18 Nov 2026 by the twenty-first session (scheduled run) under the continuous-build rule (the owner reviews plans in batches). Design `docs/phases/R1-tallyprime-design.md` (R1-D-137), owner answer #128 (R1-D-144): source and a container image only, no signed Windows installer; the TallyPrime sandbox company is an owner task, so the adapter stays `unproven` and off. Threat model §3.121. Decision R1-D-178.

## 1. Scope

- **In:** the platform half (`TallyAccountingSink`, the agent enrolment service, the agent API handler, migration `connectors/0007`), the agent itself (`apps/tally-agent`, a private workspace app, with its own Dockerfile built and scanned in CI), the TallyPrime XML stub and the contract legs, the settings, the threat-model, guide and exit-runbook entries.
- **Out:** a real TallyPrime in CI (no sandbox company, #128); a Windows installer (#128); SAP and Zoho Books (only when a tenant needs them, R1-D-122); serving the agent API over HTTP (the product mounts the framework-free handler in its own API, IPB-12, as for the inbound-mail route).

## 2. Research (18 Nov 2026) and one change to the design

The official TallyPrime documentation (help.tallysolutions.com) is not reachable from the build session (network policy); only search snippets of it could be read. What they show, and what follows:

- **Request shape** (Tally Help "XML Integration", "Case Study I – XML Request and Response Formats"; search snippets, 18 Nov 2026): an `ENVELOPE` with `HEADER` (`TALLYREQUEST` `Import` or `Export`, `TYPE` `Data` or `Collection`, `ID`) and `BODY` (`DESC` with `STATICVARIABLES` such as `SVCURRENTCOMPANY`, and `DATA` with `TALLYMESSAGE`). A voucher is `<VOUCHER REMOTEID="…" VCHTYPE="…" ACTION="Create">` with `ALLLEDGERENTRIES.LIST` lines. A successful import answers `CREATED` 1 and `ERRORS` 0; a refused line answers `LINEERROR`; the import result carries `LASTVCHID`. An export of a collection names it in `ID` and may carry its own TDL definition with a `FILTER`. The default XML port is 9000.
- **`REMOTEID` is not a uniqueness guarantee.** The design (§4) assumed TallyPrime refuses a second create with the same `REMOTEID`. The sources disagree: Tally's Import Data FAQ ties overwriting to the company setting "Overwrite voucher when a voucher with same GUID exists" (No: a duplicate is created; Yes: the voucher is overwritten); a community integration guide says the same `REMOTEID` with `ACTION="Create"` alters the voucher in place (`ALTERED` 1). Either way, a blind second create can **duplicate or overwrite** a voucher. `[VERIFY]` against a TallyPrime sandbox company (#128).
- **Change (conservative, R1-D-178):** the agent looks the `REMOTEID` up **before every create**, not only after a failure, and creates only when it is absent; after the create it reads the `REMOTEID` back and acknowledges only when **exactly one** voucher carries it with the same date, type, ledgers and amounts. Found and matching before the create: acknowledged without importing. Found and different: `REJECTED` `remote_mismatch`. Two or more: `REJECTED` `remote_duplicate` (a person resolves it in TallyPrime; nothing is altered or deleted by the agent). The agent never sends `ACTION="Alter"` or `"Delete"`. The stub implements both TallyPrime behaviours (`duplicate` and `alter`) and every case runs under both.

## 3. Interfaces

### 3.1 `contracts` minor (`ports/accounting-agent.ts`, exported from `ports`)

- Ids: `tga_<ULID>` (TallyPrime agent), `tbr_<ULID>` (trial-balance read); both in `ID_PREFIXES`.
- `TALLY_AGENT_API` paths: `POST /v1/accounting/agent/enrol`, `GET /v1/accounting/agent/jobs`, `POST /v1/accounting/agent/jobs/{jobId}/result`.
- Wire schemas (zod, strict, classed): `AgentEnrolRequest` (`code`, `jwk` P-256 public only, `agentVersion`), `AgentEnrolResponse` (`agentId`, `tenantId`, `company`, `pollTimeoutSeconds`), `AgentJob` (`{ kind: "post", jobId: <journalId>, attempt, company, batch }` or `{ kind: "trial_balance", jobId: tbr_…, company, asOf }`), `AgentJobResult` (`post`: `acknowledged` with `ledgerRefs` per voucher reference, or `rejected` with a reason; `trial_balance`: `done` with lines in paise, or `failed` with a reason).
- `TALLY_REASON_CODES`: `ledger_unknown`, `voucher_type_unknown`, `period_closed`, `company_not_open`, `duplicate_voucher`, `remote_mismatch`, `remote_duplicate`, `tally_unreachable`, `tally_error`, `agent_unreachable`, `too_large`.
- Limits: `TALLY_AGENT_MAX_BODY_BYTES` 2 MiB (a job or a result), `TALLY_AGENT_MAX_VOUCHERS` 1,000 (= `ACCOUNTING_MAX_ENTRIES`), `TALLY_ENROL_CODE_MINUTES` 30, `TALLY_AGENT_LEASE_MINUTES` 10, the health thresholds (15 minutes degraded, 24 hours down) and `TALLY_TRIAL_BALANCE_CACHE_MINUTES` 10.

### 3.2 `crypto` minor (`agent-request-jws.ts`; C-22 profile, no new primitive)

- `signAgentRequest({ privateKey, kid, request, seq })` and `verifyAgentRequest(compact, request, { key, replay, now })`: a detached JWS (RFC 7515 Appendix F), ES256 only through an allow-list, protected header exactly `alg`, `kid`, `typ`, `iat`, `jti` as C-22, with its own `typ` `ipb-agent-request+jws` so a request proof can never pass as a regulated message or the reverse. The signed payload is the JCS form of `{ v: 1, tenant, agent, seq, htm, path, body_sha256 }`, so the proof is bound to the tenant, the agent, the method, the path and the body digest. Window 300 s back, 60 s ahead.
- **Replay without a growing table:** besides the `jti`, each proof carries `seq`, a strictly increasing integer per agent; the platform accepts a proof only when its `seq` is above the agent's stored `last_seq` and stores it in the same statement (`update … where last_seq < $seq`). Nothing is ever deleted (the deletion stop holds; #129 allowed only rate-limit counters). One running copy per enrolment is the rule: a second copy with the same key is refused on its first stale `seq`.
- `generateAgentKeyPair()` (P-256 through `node:crypto`) and `agentPublicJwk()`. The registry's `ecdsa-p256-sha256` entry names the use.

### 3.3 `connectors` minor (`accounting/tally/`)

- **`TallyAgentService`** (tenant context, people only; agents, external principals, break-glass, platform contexts and impersonation are refused, `IPB-SEC-003`/`004`):
  - `requestEnrolment(ctx, { name, company })` raises the R3 request `accounting.agent.enrol`; the approval executor creates the agent `approved` (maker ≠ checker by the engine; ORG_CHECKER, ORG_ADMIN, ORG_OWNER check by default, narrowed by `mc.*`).
  - `issueCode(ctx, agentId)` (an `approved` agent only; ORG_ADMIN or ORG_OWNER, or the product's `adminRoles`): returns once `tac1.<tenantId>.<agentId>.<secret>` (256 random bits, base64url); the platform stores only its SHA-256 and an expiry 30 minutes ahead; issuing again replaces the earlier code; ledgered without the code.
  - `revoke(ctx, agentId, reason)` (the admin roles, or `PLT_SECURITY_OFFICER` in a platform context through `revokeAsPlatform`): the next call is refused; ledgered.
  - `list(ctx)` and `get(ctx, id)`: state, company, key thumbprint, last poll, never the key or a code hash.
- **`TallyAgentGateway.handle({ method, path, headers, body })`** → `{ status, headers, body }`, framework-free:
  - `enrol`: parses the code, opens the tenant's context as the service principal `SVC_TALLY_AGENT`, finds the agent, compares the code's SHA-256 in constant time, refuses an expired, used or wrong code (five wrong codes lock the agent's code until a new one is issued), stores the public JWK and thumbprint, makes the agent `active` and revokes the tenant's previous active agent in the same transaction (rotation by re-enrolment; one active agent per tenant).
  - `jobs` (long poll up to `int.accounting.tally.poll_timeout_seconds`) and `result`: `Authorization: IPB-Agent <jws>`; `kid` is `<tenantId>/<agentId>`; the agent must be `active`; the proof verified with the agent's stored key and `seq`; `int.accounting.tally.enabled` must be on for the tenant. A job is claimed with a 10-minute lease (one in flight per agent); a result is accepted only for the job the agent holds, for its current attempt, and only once. Every refusal answers a problem document with no detail of which check failed (401 for proofs, 403 for a revoked agent, 409 for a stale result).
- **`TallyAccountingSink implements AccountingSinkPort`** (descriptor `ACCOUNTING`/`tallyprime`, residency `IN`, at most CONFIDENTIAL):
  - `post` runs `assertBalancedBatch`, refuses a batch over 2 MiB of canonical JSON (`IPB-UX-004`), stores the journal `PENDING` with its canonical SHA-256 and ledgers `connectors.accounting.post`; the same batch again answers its row, a changed one is refused (`IPB-PORT-004`). An optional `awaitResultMs` (default 0, at most 30 s) waits for the agent's answer.
  - `status` reads the row (and rejects it `agent_unreachable` once unclaimed past `int.accounting.tally.job_expiry_days`); `replay` re-queues a `REJECTED` or `PENDING` batch unchanged with `attempts + 1` (`IPB-PORT-003` once acknowledged); `expireStale(ctx)` sweeps for a scheduler.
  - `trialBalance(asOf)` answers a `done` read of the same date younger than 10 minutes, else queues one and waits up to `trialBalanceWaitMs` (default 20 s); without a fresh answer `IPB-PORT-002`.
  - `health()`: `up` with an active agent that polled in the last 15 minutes, `degraded` up to 24 hours, else `down`.
  - The context comes from `currentContext()` of `@infrabyx/tenancy` unless a `context` option is passed (the port methods take no context, PortCall).

### 3.4 The agent (`apps/tally-agent`, private; depends on `contracts` and `crypto` only)

- **Runs:** reads `/etc/infrabyx-tally-agent/config.json` or the environment (`TALLY_AGENT_PLATFORM_URL` https only, `TALLY_AGENT_TALLY_URL` default `http://127.0.0.1:9000`, plain http only to a loopback or private address, `TALLY_AGENT_STATE_DIR` default `/data`); on first start with `TALLY_AGENT_ENROL_CODE` it generates its key pair, enrols, and writes `agent.json` (key and identity, mode 0600) to the state directory, then loops: long-poll, run the job against TallyPrime, post the result, back off with jitter on errors (1 s to 5 minutes). It listens on no port. The health check is a heartbeat file in `/tmp` written each loop turn (`node dist/health.js`: fresh within 90 s).
- **XML:** a small builder that escapes `& < > " '` (the port's text already refuses control characters) and a strict reader for TallyPrime's answers: elements, attributes, text and the five named and numeric character references only; `<!DOCTYPE`, `<!ENTITY`, processing instructions other than the XML declaration and CDATA are refused; 2 MiB, depth 32, 100,000 elements. No XML dependency.
- **Posting:** per voucher, look up (export of a TDL collection of vouchers filtered by `$RemoteID`), then create only when absent, then read back (§2). Amounts: TallyPrime's sign convention (debit lines negative with `ISDEEMEDPOSITIVE` Yes, credit lines positive with No) converted from integer paise to rupees with two decimals by string arithmetic, never floating point; read back parses back to paise exactly or the voucher is `remote_mismatch`.
- **Image:** `infra/docker/tally-agent/Dockerfile`, the platform's pinned Node 24.22.1 base, `pnpm deploy --prod`, UID 10001, read-only root, `/data` the only volume, no `EXPOSE`. CI builds it with the other images, runs hadolint, `trivy config`, `trivy image` (HIGH and CRITICAL zero or waived) and its hardening checks (UID, read-only root, nothing listening, the heartbeat health check). Products sign and attest it in their own release, as for the other images.

### 3.5 `testing` minor

- `TallyPrimeStub`: an in-memory TallyPrime speaking the XML envelope on a function or a loopback HTTP server: companies, ledgers, voucher types, a closed period; `REMOTEID` collisions behave as `duplicate` or `alter` (both run); scripted refusals and lost answers (the voucher is created, the answer dropped).
- `defineTallyAccountingContract` runs `accountingContractCases` against `TallyAccountingSink` with the agent in-process against the stub; `AccountingScript.settle` may now return a promise (the cases await it; the fake is unchanged).

## 4. Data model (migration `connectors/0007_tallyprime.sql`, expand-only)

- `connectors.tally_agent`: `id` (`tga_`), `tenant_id`, `name`, `company`, `state` (`approved`, `active`, `revoked`), `approval_id`, `code_sha256`, `code_expires_at`, `code_failures`, `public_jwk` (jsonb, P-256 public members only), `jkt`, `last_seq` (bigint), `last_poll_at`, `agent_version`, `enrolled_at`, `revoked_at`, `revoked_by`, `revoke_reason`, timestamps. One `active` agent per tenant (partial unique index). Trigger: `revoked` is final; the key is set once (on activation) and never changed; `last_seq` only grows.
- `connectors.tally_journal`: primary key (`tenant_id`, `journal_id`), `digest`, `batch` (jsonb), `state`, `attempts`, `ledger_refs`, `reason_code`, `reason`, `queued_at`, `claimed_by`, `claimed_attempt`, `lease_until`, timestamps. Trigger: `digest` and `batch` immutable; `ACKNOWLEDGED` final.
- `connectors.tally_read`: `id` (`tbr_`), `tenant_id`, `as_of`, `state` (`queued`, `claimed`, `done`, `failed`), `lines` (jsonb), totals, `reason_code`, `claimed_by`, `lease_until`, timestamps; a `done` or `failed` row is final.
- All three: forced RLS by tenant, every column classed (`batch`, `ledger_refs`, `lines` and totals CONFIDENTIAL), `select, insert, update` to `app_rw`, `select` to `app_ro`, no delete grant. Each mutation is ledgered in its transaction (`connectors.accounting.post`, `.replay`, `.result`, `.expire`, `connectors.accounting.agent.enrol`, `.code`, `.activate`, `.revoke`, `.read`); a poll that finds nothing writes only `last_poll_at` and `last_seq` (no ledger row, as a rate-limit hit, R1-D-123) under its own narrow function.

## 5. Settings (`config` minor)

- `int.accounting.tally.enabled` (TENANT, bool, false; ORG_ADMIN; R3).
- `int.accounting.tally.poll_timeout_seconds` (PLATFORM, int, 25; 1 to 55; PLT_SECURITY_OFFICER).
- `int.accounting.tally.job_expiry_days` (PLATFORM, int, 7; 1 to 30; PLT_SECURITY_OFFICER).

## 6. Tests (by ID)

- `crypto`: `agent-request-jws.test.ts`: round trip; wrong `typ` (a regulated-message JWS refused, and the reverse); every header deviation; a changed method, path, body, tenant or agent; stale, future, replayed `jti`; a lower or equal `seq`; a non-P-256 key.
- `connectors` (PostgreSQL, `tally.int.test.ts`): enrolment under maker-checker (maker ≠ checker, an agent may not make it); the code once, 30 minutes, five failures, re-issue replaces it; activation revokes the previous agent; unsigned, expired, replayed, other-tenant, revoked and disabled-tenant calls refused; one job in flight, the lease, a stale or second result refused; expiry rejects `agent_unreachable`; the RLS and immutability triggers; the ledger entries. The `ACCOUNTING` contract leg (`defineTallyAccountingContract`, both stub behaviours).
- `apps/tally-agent` (unit): XML builder and reader (every refusal, the limits), paise ↔ rupee strings, the posting algorithm against the stub: a lost answer recovered without a duplicate, a mismatched `REMOTEID` rejected, a duplicated `REMOTEID` rejected, each TallyPrime refusal mapped, TallyPrime down; config refusals (http platform URL, a public TallyPrime URL); the state file mode.
- Image: `image.e2e.test.mjs` gains the agent: UID 10001, read-only root, nothing listening, healthy from the heartbeat.

## 7. Threat model, guide, exit runbook

- §3.121 rewritten as built, including the `REMOTEID` change and the residual (a voucher created by a person between the lookup and the create is caught by the read-back as `remote_duplicate`, never silently).
- Product guide §7ck (Finbyx): enrol, mount the handler, schedule `expireStale`, run the image; what the tenant runs.
- Exit runbook: ACCOUNTING `tallyprime` (unproven; alternative: the fake until SAP or Zoho Books is needed).

## 8. Exit gate

IPB-09 required checks, `pnpm check:full` (every Docker contract leg), the new image's `containers` checks, and the cases above green; Changesets: `contracts`, `crypto`, `connectors`, `config`, `testing` minors.

## 9. Owner decisions

None blocks the build. Owner question #136 (with a recommendation to accept): the `REMOTEID` lookup before every create; one active agent per tenant; replay by a per-agent `seq` instead of a `jti` table (no deletion); the agent's key file unencrypted on the tenant's machine at mode 0600 in its state volume (the tenant's machine is the trust boundary, as for TallyPrime's own data); the hand-written restricted XML reader.
