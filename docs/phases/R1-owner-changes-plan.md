# R1 — the owner's changes to #132 and #136 (18 Nov 2026)

**Decision:** R1-D-179 (answers) · plan decisions R1-D-183 (#132) and R1-D-184 (#136) · **Order:** right after the priority-1 requests (R1-D-180)

## A. #132 (4): a purpose code beside the purpose digest (`rules`, `contracts` minor)

- `RevealRequest.purposeCode`: a short enumerated id, `^[a-z][a-z0-9_]{2,31}$`. The list is the product's: `RevealRule.purposeCodes` (non-empty, frozen at construction of `RulesService`), defaulting to the platform list `REVEAL_PURPOSE_CODES` in `@infrabyx/contracts` (`customer_request`, `complaint`, `dispute`, `internal_audit`, `external_audit`, `regulatory_request`, `legal_proceedings`, `fraud_review`, `quality_review`). No product name is in the platform list.
- `entitleReveal` refuses a missing or unlisted code with `IPB-RULE-004` `meta.reason: "purpose_code_invalid"` before it asks the product's rule; the rule receives the code with the text.
- The reveal's ledger entry gains the business id `purpose:<code>`, readable in `AuditService.history`; the free-text purpose stays only under the entry's digest, as accepted in #132 (4).
- Compatibility: the field is optional in the type, so a product compiles unchanged, but a reveal without a code is refused (fail closed). The reveal shipped in `rules` 1.5.0 on 18 Nov; no product has turned it on (`revealRule` unset means every reveal is refused already).

## B. #132 (5): refused reveals as security audit events (`contracts`, `rules`, `audit` minor)

Nothing in the platform records security events yet (IPB-02-54 names the SIEM stream; IPB-02 §02.4.7.2 the alert catalogue). The smallest piece that serves this and later security events:

- **`audit.security_event`** (`audit/0011`): append-only, tenant-scoped, forced RLS; columns `id` (`sev_` ULID), `tenant_id`, `occurred_at`, `actor_id`, `actor_type`, `kind` (`rules.reveal.refused` for now; a check list), `resource_type`, `resource_id`, `detail` jsonb (ids and codes only, never a value; bounded 2 KiB), `trace_id`. No update or delete grant to any role; not part of the hash-chained business ledger (IPB-02-51 is unchanged) and not in a tenant's business history. Retention: kept like the ledger until the owner's retention schedule says otherwise (no deletion is added).
- **`SecurityEventSink`** (`contracts/kernel`) with `record(tx, event)`; `PgSecurityEvents` in `audit` writes the row through the kernel's transaction, so a refusal is recorded even though the reveal itself is refused (its own short transaction).
- **Who, when, which decision and input, the reason:** `actor_id`, `actor_type`, `occurred_at`, `resource_id` (the decision), `detail.input`, `detail.reason` (the `meta.reason` of the refusal), `detail.purpose_code` when given. Never the value, never the purpose text.
- **Repeated refusals → the existing alert path:** the platform's alerts are internal events on the outbox (as break-glass raises `BreakGlassGranted`, IPB-02-06). Refusals are counted per principal with the shared `RateLimiter` (`tenancy`, no ledger row per hit); the fifth refusal by one principal within 15 minutes publishes one internal event `RevealRefusalsRepeated` (principal, count, window), at most once per window, which the product routes to its security on-call like the other security events. Thresholds are settings (`rul.reveal.refusal_alert_threshold`, 5, 2 to 50; `rul.reveal.refusal_alert_window_minutes`, 15) [defaults ASSUMED].
- `RulesService` takes `securityEvents?` and `rateLimiter?`; without them a refusal is still thrown, and the boot check refuses a `revealRule` without a security sink (fail closed), so a product cannot turn reveals on without the record.

## C. #136 (4): the agent key under DPAPI on Windows, 90-day re-enrolment (agent, `contracts`, `connectors` minor)

- **DPAPI call path** ([VERIFY] done against Microsoft's reference source on 18 Nov 2026, `dotnet/dotnet-api-docs` `ProtectedData.xml` and `DataProtectionScope.xml`, and `MicrosoftDocs/PowerShell-Docs` `about_PowerShell_exe` 5.1; learn.microsoft.com itself is blocked from the session): `System.Security.Cryptography.ProtectedData.Protect/Unprotect` wraps DPAPI (`CryptProtectData`, `CryptUnprotectData`), is Windows-only (`PlatformNotSupportedException` elsewhere), and with `DataProtectionScope.CurrentUser` only the same account can unprotect (`LocalMachine` lets every account on the machine; Microsoft advises `CurrentUser`). DPAPI keeps its keys in the user profile, so the service account's profile must be loaded (a Windows service under its own account loads it). The agent calls Windows PowerShell 5.1, which ships with Windows, so no npm dependency: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -Command <fixed script>` by absolute path (configurable), with the key bytes on **standard input** and the result on standard output: the key is never on a command line (process listings) nor in the script text (PowerShell script-block logging), and the entropy is the agent's id.
- **Store:** on Windows the state file keeps `privateKeyDpapi` (base64 of the DPAPI blob) instead of `privateKeyPem`; mode 0600 as before. The 0600 PEM is the fallback only off Windows or when the DPAPI call fails, and then the agent says so at enrolment.
- **The enrolment record:** `AgentEnrolRequest.keyProtection` (`dpapi` or `file`), stored on `connectors.tally_agent.key_protection` (`connectors/0008`, expand-only; existing rows `file`); `TallyAccountingSink.health()` and the agent list carry `keyWarning: "key_unencrypted"` for `file`.
- **Rotation:** an agent's key is valid 90 days from its activation (`TALLY_AGENT_KEY_MAX_DAYS`); from day 80 its status carries `rotationDue` (the console warns); from day 90 its requests are refused with `agent_key_expired` and it must be enrolled again (enrolment already revokes the previous agent).
- **Runbook:** `docs/runbooks/tally-agent.md`: run the agent as a dedicated Windows service account; re-enrol before day 90; **revoke the agent at once if its machine is lost or compromised** (`TallyAgentService.revoke`), then enrol a new one from a clean machine.

## Tests (by item)

A: unit cases for the code list, the refusal and the business id. B: PostgreSQL cases: a refused reveal writes one security event with no value and no ledger entry; RLS; no update or delete; the fifth refusal raises one event per window; boot refusal without a sink. C: agent cases with a fake PowerShell runner (stdin carries the key, never argv); the fallback on non-Windows and on a failing call; the enrolment record; day 80 warning and day 90 refusal on PostgreSQL.

## Owner decisions needed

None blocking. Defaults to confirm: the platform purpose-code list (A), the alert threshold and window (B), refusal (not only a warning) at day 90 (C).
