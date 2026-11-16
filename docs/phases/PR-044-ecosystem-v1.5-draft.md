# PR-044: draft amendment to the Ecosystem Specification, v1.5

**Status:** draft for the owner's sign-off (OWNER-QUESTIONS #127). Nothing under `docs/ecosystem/` changes until the owner signs this text off. It is then applied as v1.5 in its own owner-authorised docs-only PR, as v1.3 (#210) and v1.4 were, and the `contracts` schema follows in the next wave. **Raised by:** LawDocsComply PR-LDC-33, through the platform (R1-D-114).

## 1. What changes and why

§6.15 already registers `ObligationPublished` (N), produced by LDC (or Finbyx embedded) for every product, keyed by `(obligation_ref, version)`, with "obligation_ref, change type, dates, applicability" as its key payload fields. It does not fix a schema, so LawDocsComply publishes its own internal `in.lawdocscomply.cnt.ObligationPublished.v1`, and a consumer has nothing to validate against. v1.5 fixes the payload of the existing canonical event to **ids and keys only**. Consumers then subscribe to `in.infrabyx.grc.ObligationPublished.v1` and fetch the text, where they need it, through the existing pull API (`GET /v1/grc/obligations?updated_since=`, §6.22's API row).

- No new event name, no new producer, no change to the idempotency key or the SLA.
- The payload carries no obligation text, no tenant data and no personal data (`dataclass = INTERNAL`), so it needs no `consentref` or `legalbasis`.
- "Applicability" becomes a list of applicability **keys** (codes), not free text.

## 2. Text for §6.15 (replace the `ObligationPublished` row)

| Event or API                                       | Producer → consumer(s)          | Trigger                                                                    | Key payload fields                                                                                                                                                                                                                                                                                | Owner | Idempotency key           | SLA             |
| -------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------- | --------------- |
| `ObligationPublished` (N) _(schema fixed in v1.5)_ | LDC (or FX embedded) → products | Obligation added, amended or repealed in a catalogue release (change feed) | obligation_ref, business_id, version, change_type (ADDED, AMENDED, REPEALED), instrument_ref, authority, family, effective_from, effective_to?, release_id, applicability_keys[]; `dataclass = INTERNAL`; ids and keys only, never the obligation's text (pull it with `GET /v1/grc/obligations`) | LDC   | (obligation_ref, version) | ≤ 1 working day |

Then add after the table:

- **`ObligationPublished` payload** _(v1.5)_:

| Field                | Type and rule                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `obligation_ref`     | The producer's obligation id, `obl_` + ULID; also the event's `subject`                                                                                               |
| `business_id`        | The obligation's business id as the producer's audit ledger records it (1 to 128 of `A-Z a-z 0-9 _ . : @ / + = -`; an id, never a name)                               |
| `version`            | Integer ≥ 1, one more for each change to the obligation; with `obligation_ref`, the idempotency key                                                                   |
| `change_type`        | `ADDED`, `AMENDED` or `REPEALED`                                                                                                                                      |
| `instrument_ref`     | The issuing instrument's own reference as published by the authority (circular, notification or regulation number; 1 to 128 printable characters)                     |
| `authority`          | The issuing authority's code (upper case, 2 to 32 of `A-Z 0-9 _`), from the producer's published authority list                                                       |
| `family`             | The obligation family code (lower case, 2 to 64 of `a-z 0-9 _ .`), from the producer's published family list                                                          |
| `effective_from`     | Date (`YYYY-MM-DD`, IST) from which this version applies                                                                                                              |
| `effective_to`       | Date, present only when the version stops applying (always present for `REPEALED`)                                                                                    |
| `release_id`         | The catalogue release that carried the change (1 to 64 of `A-Za-z0-9_.-`); every event of one release carries the same value                                          |
| `applicability_keys` | 0 to 64 codes (each 2 to 64 of `a-z 0-9 _ . :`) naming the entity types, product families or activities the obligation applies to; an empty list means "see the text" |

No other field is allowed (`additionalProperties: false`). A consumer that needs the text, citations or owner fetches `GET /v1/grc/obligations?updated_since=[ts]` and matches on `(obligation_ref, version)`.

## 3. Versioning

- **Minor version** (Part 14.1): the event, its producer, consumers, idempotency key and SLA are unchanged. Its schema is fixed for the first time, with additive fields and no meaning changed. The only product that emits an obligation feed today does so under its own internal name, so no consumer of the canonical type breaks. No parallel run is required, and no new canonical name means no new tag.
- **Schema:** `[registry-base]/schemas/grc/ObligationPublished/1.0.0.json`.
- **§6.17 (superseded names):** add `in.lawdocscomply.cnt.ObligationPublished.v1` → `grc.ObligationPublished` (6.15). An internal `in.[product].*` name never leaves the product (IPB-10-41).
- **Specification history:** "v1.5: the payload of `ObligationPublished` fixed as ids and keys only (§6.15). Raised as platform request PR-044 from LawDocsComply PR-LDC-33."
- **What changed in v1.5** (front matter) and **16.0 v1.5 change log** (the present 16.0 becomes 16.1, and so on): "Part 6: 6.15 `ObligationPublished` schema (LDC as producer; every consuming product); 6.17 one superseded internal name; Part 14: 14.3 certification test 'Obligation feed (v1.5)'". Propagation: every repository adopts v1.5 within 10 working days of publication (Part 14.2) [REC].

## 4. Acceptance tests (paste into §14.3's test table)

| Area                   | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Obligation feed (v1.5) | An `ObligationPublished` with obligation text, a free-text applicability, an unknown field, a `REPEALED` without `effective_to`, an `effective_to` before `effective_from` or a `dataclass` other than `INTERNAL` is refused with `schema-validation-failed`; a valid one is accepted; the same `(obligation_ref, version)` delivered twice is processed once; a lower `version` after a higher one is stored and not applied over it; every event of one `release_id` can be fetched by the pull API with the same `(obligation_ref, version)` |

## 5. Owner points for sign-off

1. **Ids only.** The event carries no obligation text. A consumer that shows text pulls it from LDC's API under its existing scope. The alternative, text in the event, would raise the class and put regulatory text in every consumer's inbox, and is not proposed.
2. **Code lists.** `authority` and `family` are codes from the producer's published lists, not a new Part 5.3 code table. A Part 5.3 table can follow later if a second producer appears; that would also be a minor change.
3. **Batching.** v1.5 holds only this change today. If LawDocsComply PR-LDC-51's `ProviderIncident` event (wave 14, §6.16) is drafted before sign-off, it joins v1.5 as a second, separately approvable section; otherwise it waits for v1.6.
