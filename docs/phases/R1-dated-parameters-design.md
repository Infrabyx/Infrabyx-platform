# Dated, cited, locked rule parameters: design (LawDocsComply PR-LDC-57; wave 14 design, wave 15 build)

**Status:** design for review (R1-D-146). No code until wave 15. Packages: `contracts`, `rules` (minors, one migration).

## 1. The problem

A rule parameter today names a registered setting (`RuleParameter.setting`, R1-D-86). `resolveParameters` reads that setting's value **now**, even when `evaluate` is called with `asOf`. A decision taken "as of 31 March" for a threshold that changed on 1 April therefore uses the new threshold, and the decision log cannot say which statutory text the value came from.

Some parameters are not tenant choices at all. They are fixed by an instrument (a statute, a regulation, a circular) and change on a stated date. A tenant must not override them, and every decision must cite them.

## 2. What a product gets

A rule set may declare a **dated parameter** instead of a setting-backed one:

```ts
{ name: "auditThreshold", type: "integer", schedule: "stat.companies.audit_threshold" }
```

- `schedule` names a **parameter schedule**, a platform-owned, versioned list of values:
  `[{ value, effectiveFrom, effectiveTo?, citation: { instrumentRef, section, url? } }]`.
- At evaluation, the value is the entry in force at `asOf`, or now when no `asOf` is given. The engine sees only the value, exactly as for a setting-backed parameter.
- The decision log and `explain` record, per dated parameter: the value, the schedule key, the schedule version, the entry's `effectiveFrom` and its citation. The `source` is `"schedule"` (today it is `"setting"` or `"default"`).
- A dated parameter is **locked**. No setting, tier or tenant can override it, and it never falls back to a default. If no entry is in force at `asOf`, the decision is `UNDETERMINED` with reason `parameter_not_in_force`. It is never decided on a guess.

## 3. Publishing a schedule

- **Who.** A schedule is drafted and published exactly as a rule set is: the existing `rules.ruleset.publish` action under maker-checker R4 (its checker roles, the two sign-offs for statute, regulator and SRO layers; R1-D-86). No new approval policy is added.
- **When.** A new entry can be published ahead of its date with the scheduled cut-over of R1-D-113. The entry for 1 April is approved in March and takes effect on 1 April.
- **What is immutable.** A published schedule version is immutable. A correction is a new version, with the reason recorded. Entries never overlap, and `effectiveTo` is set from the next entry's `effectiveFrom`.
- **Citation.** Every entry needs an `instrumentRef` (1 to 128 printable characters, the instrument's own reference) and a `section`. A draft without them is refused (`IPB-RULE-001`).
- **Scope.** Schedules are PLATFORM-scope, readable by every tenant, and never tenant data. A product's own instrument-backed values (for example a product-specific regulator list) use the same mechanism under its own key prefix.

## 4. Data model (wave 15 migration `rules/0005`)

- `rules.parameter_schedule (key, version, status, published_at, approval_request_id)`.
- `rules.parameter_entry (key, version, effective_from, effective_to, value jsonb, instrument_ref, section, url)`.
- Platform scope only: written through the kernel with the ledger, and read by tenant contexts through a read policy, as for the platform's other catalogues.
- `rules.decision_log.parameters` already stores `{ value, source }` per parameter. It gains `schedule`, `version`, `effective_from` and `citation` for dated parameters, inside the same jsonb column, so no column is added.

## 5. Tests (wave 15)

- As-of evaluation picks the entry in force on each side of a cut-over.
- No entry in force gives `UNDETERMINED`.
- A tenant setting of the same name has no effect.
- `explain` cites the entry.
- A draft with overlapping entries or a missing citation is refused.
- Publication needs the R4 checker.
- Replaying an old decision gives the same value after a newer entry is published.
- Engines agree (the differential test), because the engine only ever sees the value.

## 6. Out of scope

- Fetching schedules from an external source. Values are entered and approved by people.
- Tenant-specific dated values. A tenant's choice stays a setting, which already has history (config/0003).
