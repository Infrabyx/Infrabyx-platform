# TallyPrime adapter for the ACCOUNTING sink: design (wave 14; build in wave 15)

**Status:** design for review. Finbyx PR-FBX-46 (R1-D-122) and the owner's acceptance of 12 Nov (R1-D-126). The port, fake and contract cases shipped in wave 13 (`AccountingSinkPort`, R1-D-130). This note fixes how the TallyPrime adapter reaches a tenant's books before any code is written (R1-D-137). Threat model entry: §3.121.

## 1. The constraint

TallyPrime runs on the tenant's own machines, on their own network, and accepts XML requests only on a local HTTP port (by default 9000). The platform runs in the cluster. It must never ask a tenant to open an inbound port to the internet, and it must never hold a network path into a tenant's office.

## 2. Shape: an outbound-only local agent

```text
platform (cluster)                                tenant network
┌──────────────────────────────┐   HTTPS, agent   ┌────────────────────────────┐
│ TallyAccountingSink          │ ◀─ dials out ─── │ infrabyx-tally-agent       │
│  (AccountingSinkPort)        │                  │  polls, posts, reports     │
│  accounting.tally_job table  │ ── jobs ───────▶ │                            │
│  /v1/accounting/agent/*      │ ◀── results ──── │  ──▶ TallyPrime :9000 (XML) │
└──────────────────────────────┘                  └────────────────────────────┘
```

- **Adapter (platform side).** `TallyAccountingSink` implements `AccountingSinkPort`. `post` runs `assertBalancedBatch`, stores the batch as a job (tenant-scoped, forced RLS) and answers `PENDING`. `status` reads the job. `trialBalance` queues a read job and waits up to a bounded time, then answers from the last fresh result, or refuses `IPB-PORT-002` when it has none within the window.
- **Agent (tenant side).** A small, single-purpose program the tenant runs on a machine that can reach TallyPrime. It dials out to the platform over HTTPS, long-polls for jobs, turns each into a TallyPrime XML import or export on `localhost`, and reports the result. It listens on no port. It holds no platform data beyond the job in hand.
- **Agent API** (`/v1/accounting/agent/jobs`, `.../{id}/result`), served by the product's API under the platform's API standard (IPB-12): `GET` next job (long poll, 25 s), `POST` result. Only an enrolled agent's token may call it, and only for its own tenant.

## 3. Identity and enrolment (approved cryptography only)

- **Enrolment under maker-checker.** A tenant admin creates an enrolment (action `accounting.agent.enrol`, R3), and a different checker approves it. Approval issues a one-time enrolment code that is valid for 30 minutes and is shown once.
- **Key pair on the agent.** The agent generates an ES256 key pair on first start (C-12) and sends its public key with the code. The platform stores the public key, never a shared secret.
- **Every call signed.** The agent sends a short-lived JWS (ES256, C-22 profile, 5 minutes, `jti` single-use) bound to the request method, path and body digest. This is the same proof form as regulated messages, so no new cryptography is introduced. TLS is the cluster ingress's.
- **Revocation.** A tenant admin, or PLT_SECURITY_OFFICER, revokes an agent and its next call is refused. Agent keys are rotated by re-enrolling.

## 4. Posting to TallyPrime idempotently

- Each voucher is imported with `ACTION="Create"`, its company, and a `REMOTEID` of `ipb:<journalId>:<reference>`. A second import of the same `REMOTEID` is refused by TallyPrime instead of creating a duplicate.
- After an import, the agent exports the vouchers by `REMOTEID`. Only a voucher found with the same amounts and ledgers counts as `ACKNOWLEDGED`, with its GUID and voucher number as `ledgerRefs`.
- When an import fails or its answer is lost, the agent first looks the `REMOTEID` up. Found and matching: acknowledged. Absent: imported once more. Found but different: `REJECTED` with `remote_mismatch`, and nothing is overwritten.
- TallyPrime's own refusals map to reason codes: `ledger_unknown`, `voucher_type_unknown`, `period_closed`, `company_not_open`, `duplicate_voucher`, `tally_error`.
- The digest rule of the port holds on the platform side. A changed batch under the same journal id never reaches the agent.

## 5. Limits and failure

- **Bounded work.** At most one batch is in flight per agent; at most 1,000 vouchers and 2 MB of XML a job. Jobs expire after 7 days unclaimed and are then `REJECTED` (`agent_unreachable`), so the product sees it.
- **Agent offline.** Batches stay `PENDING`. `health()` is `degraded` after 15 minutes without a poll and `down` after 24 hours. `replay` re-queues a rejected batch unchanged.
- **Trial balance.** Read through an export job, as of a date, in paise. The result is cached for 10 minutes, so reconciliation cannot flood the agent.

## 6. Settings, residency and data class

- `int.accounting.tally.enabled` (TENANT, default off; turning it on is R3), `int.accounting.tally.poll_timeout_seconds` (25), `int.accounting.tally.job_expiry_days` (7).
- **Residency.** IN, because the books are the tenant's own.
- **Data class.** At most CONFIDENTIAL (ledger names, amounts, narrations). Narrations are the product's and should never carry personal data beyond a reference.

## 7. Tests (wave 15)

- **Contract cases.** `accountingContractCases` runs against the adapter with a **TallyPrime stub** that speaks the XML envelope and keeps vouchers by `REMOTEID`, and with the agent running in-process.
- **Extra cases.**
  - A lost import answer is recovered by the `REMOTEID` lookup, with no duplicate.
  - A mismatched `REMOTEID` is `REJECTED`.
  - An unsigned, expired, replayed or other-tenant agent call is refused.
  - A revoked agent is refused.
  - An expired job is `REJECTED`.
- **Not run.** No real TallyPrime is driven in CI. The adapter stays `unproven` until a tenant's sandbox company is available, which is an owner task.

## 8. Owner points (OWNER-QUESTIONS #128)

1. **Distribution of the agent.** The agent is software the tenant installs. Is it shipped as source plus a container image only (default: no cost, no external account), or also as a signed Windows installer, which needs a code-signing certificate (an external account and a recurring cost)?
2. **Sandbox.** A TallyPrime licence or a tenant's test company for the sandbox leg (an external account). Until then the adapter is unproven and off.
