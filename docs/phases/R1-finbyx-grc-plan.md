# R1 plan: Finbyx Phase 14, the GRC port and the §6.15 events (PR-FBX-51)

Owner's order, 19 Nov 2026 night (item E4). Decision R1-D-220; ADR-0013; platform request PR-048. Spec of record: Ecosystem Specification §6.15 (Compliance and GRC events), §9.1 (compliance modes), §9.2 (generic GRC connector contract), §9.4 (OSCAL), §3.2 (envelope), §3.6 (regulated messages: none of these). Nothing under `docs/ecosystem/` or `docs/ipb/` is edited.

## A. What Finbyx asked for

1. A GRC port on the §9.2 generic connector contract.
2. The §6.15 event schemas `ControlTestResultPublished`, `ComplianceIssueRaised`, `ReturnStatusUpdated`, `PolicyAttested`, `SecurityIncidentNotified` (`EvidenceSubmitted` and `ObligationPublished` exist already and are reused).

## B. Contracts: events (`@infrabyx/contracts/events`, new file `grc-events.ts`; minor)

Types `in.infrabyx.grc.<Event>.v1`, schema version 1.0.0 (`GRC_SCHEMA_VERSION`). Field names are §6.15's key payload fields and §9.2's resource fields in snake case; unknown fields pass through `[VERIFY]` against the registry. Ids `[A-Za-z0-9_.:-]{3,128}` (never a name or e-mail); times RFC 3339 with offset; dates `YYYY-MM-DD`. Every schema refuses an Aadhaar-like number (`findAadhaarLike`, letters joining) or a PAN anywhere in the data, unknown fields included (`grcPersonalDataProblems`). None is a regulated message.

| Event                        | Fields                                                                                                                                                                                                                                                                                             | Idempotency key (§6.15)              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `ControlTestResultPublished` | `control_id`, `run_id`, `period?`, `result` (`PASS`, `FAIL`, `INCONCLUSIVE`), `population_count`, `sample_count`, `exception_count` (sample and exceptions ≤ population; no exception on PASS), `masked_sample_ids[]` (`GRC_MASKED_ID`), `evidence[]` (`uri`, `sha256`), `automated?`, `tested_at` | (`control_id`, `run_id`)             |
| `ComplianceIssueRaised`      | `issue_id`, `source` (`TEST`, `AUDIT`, `RBI`, `INCIDENT`), `source_ref?`, `control_id?`, `severity` (`SEV1` to `SEV4`, the `ProviderIncident` scale; `SEV1` is §6.15's "severity 1"), `owner` (`role` code, `ref?`), `due`, `raised_at`                                                            | `issue_id`                           |
| `ReturnStatusUpdated`        | `return_code`, `period` (`RETURN_PERIOD`: day, month, quarter, half, year, financial year), `status` (`GENERATED`, `VALIDATED`, `FILED`, `ACKNOWLEDGED`, `REJECTED`), `ack_ref?` (required when ACKNOWLEDGED, allowed when REJECTED), `reason_code?`, `status_at`                                  | (`return_code`, `period`, `status`)  |
| `PolicyAttested`             | `policy_id`, `version`, `user_ref` (a reference), `attested_at`, `board_approved_on?`                                                                                                                                                                                                              | (`policy_id`, `version`, `user_ref`) |
| `SecurityIncidentNotified`   | `incident_id`, `update_seq`, `detected_at`, `class` (`SECURITY_INCIDENT_CLASSES`), `affected_data_categories[]` (codes), `status` (`OPEN`, `CONTAINED`, `RESOLVED`, `CLOSED`), `notified_re_at?`, `rbi_reported_at?` (neither before `detected_at`)                                                | (`incident_id`, `update_seq`)        |

`GRC_EVENTS` lists these five with `ObligationPublished` (`FROM_GRC`) and `EvidenceSubmitted`; `grcIdempotencyKey(name, data)`. `securityIncidentClockCopy` makes the OH13 copy §6.15 asks for (the schema's fields only).

## C. Contracts: the port (`@infrabyx/contracts/ports`, new file `grc.ts`; minor)

`GrcPort`: `listObligations({ updatedSince?, cursor?, limit? }, call?)` → `{ items: GrcObligation[], nextCursor? }` (§9.2 `Obligation`: `obligation_ref`, `version`, `paragraph?`, `text_sha256`, `applicability_keys`, dates, `owner_role?`, `status`, `updated_at`; never the text), and six POSTs taking the event data and `call?`, each answering a `GrcReceipt` (`resource`, `ref`, `idempotencyKey`, `adapter`, `receivedAt`). Shared checks: `assertGrcClass`, `prepareGrcPost` (class, personal data, schema, key), `prepareGrcObligationQuery`; fixed refusal labels `GRC_REFUSALS`. Catalogue row `GRC` (tier 2, `int.grc.`, ADR-0013), `R1_PORTS`; port default class CONFIDENTIAL (unlisted default); router method table: the POSTs `noFailover`.

## D. Adapters and fake

- `connectors` `grc/generic.ts`, `GenericGrc` (`generic-grc`): `GET /v1/grc/obligations?updated_since=&cursor=&limit=` (§6.15 names the path), POSTs to `/v1/grc/<resource>` with `idempotency-key`, bearer token from SECRETS, the egress client with one allowed host and keyed POSTs resent like reads; `422 idempotency_key_reused` → `IPB-PORT-004`, `409 out_of_order` → `out_of_order`, `400 invalid_cursor` → `invalid_cursor`. Stub-shaped `[VERIFY]` where §9.2 is silent. Off (`int.grc.generic.enabled`) and unproven.
- `fakes` `FakeGrc` (`fake-grc`): in memory, the same rules; `seedObligations`, `records`, `accepted` test hooks.
- `testing`: `grcContractCases(fixtures)` (8 cases), `grcSamples`, `grcObligations`, and `startGrcStub()`.

## E. Tests (by IPB ID)

- `contracts`: `grc-events.test.ts` (types, keys, accepted fields, wrong types and enums, counts, Aadhaar-like and PAN values anywhere, the OH13 copy) and `grc.test.ts` (registration, keys, class and personal-data checks, query, obligation and receipt).
- `@IPB-01-15` contract cases on the fake (`testing`) and, in the `GRC` port-contract leg, on `generic-grc` against the stub and on the fake; adapter-only tests (off, host, headers, outage resend, answer mapping). `@IPB-01-38` `PORT_EXIT` and the exit runbook.

## F. Stubs and exit checklist

No vendor, no counterparty account, no migration, no new cryptography. Settings `int.grc.generic.enabled`, `int.grc.generic.host`. Exit: build, lint, typecheck and tests of the changed packages; `test:contract -- --port GRC`; `ipb:check`; `test:policy`; `scripts:test`; the exit runbook regenerated; changesets for `contracts`, `config`, `connectors`, `fakes`, `testing` (minors); guide §7dg; threat model §3.151; DECISIONS R1-D-220; owner question #159; platform request PR-048.

## G. Owner decisions needed

#159 only (the enums the Specification does not name, the stub-shaped REST details and the authentication), with the defaults taken. Nothing blocks.
