# R1 plan: dated, cited, locked rule parameters (LawDocsComply PR-LDC-57, wave 15)

Status: built 18 Nov 2026 (eighteenth session, R1-D-175); drafted the same day (seventeenth session), from the design `docs/phases/R1-dated-parameters-design.md` (R1-D-146, accepted for wave 15, M107). Build next. Packages: `contracts` minor, `rules` minor (migration `rules/0005`), `testing` patch if a helper is needed.

## 1. Scope

What is built is what the design describes and nothing more:

- A rule parameter may name a `schedule` instead of a `setting`.
- A schedule is a platform-owned, versioned and cited list of values. Its value is taken at `asOf`.
- A dated parameter is locked: no setting overrides it and there is no default. When no entry is in force, the decision is `UNDETERMINED` with reason `parameter_not_in_force`.
- The decision log and `explain` record the value, the schedule key and version, the entry's `effectiveFrom` and its citation, with `source: "schedule"`.

Fixed by the design, and not reopened here:

- Values are entered and approved by people, never fetched.
- Tenant-specific dated values stay settings.

## 2. Interface (`contracts` minor)

```ts
// RuleParameter becomes a union. Existing setting-backed parameters are unchanged.
type RuleParameter =
  | { name; type; setting; default; min?; max?; values?; help_key? } // as today
  | { name; type; schedule: string; min?; max?; values?; help_key? }; // dated: no default

// A schedule version body (format "ipb.parameter_schedule.v1")
interface ParameterScheduleBody {
  format: "ipb.parameter_schedule.v1";
  type: RuleParameterType; // every entry's value has this type
  entries: {
    value: string | number | boolean;
    effectiveFrom: string; // YYYY-MM-DD, the first day in force (00:00 IST, see §5)
    citation: { instrumentRef: string; section: string; url?: string };
  }[]; // 1..500, strictly ascending effectiveFrom, no duplicates
  reason?: string; // required from version 2 on: why this correction
}

// Explanation.parameters[i].source gains "schedule", with
//   schedule?: { key: string; version: number; effectiveFrom: string; citation: {...} }
// Decision reason gains "parameter_not_in_force".
```

- **Validation (`IPB-RULE-001`).**
  - Entries are sorted and do not overlap. `effectiveTo` is not entered: it is the next entry's `effectiveFrom`, and the last entry is open-ended.
  - `instrumentRef` is 1 to 128 printable characters and `section` is 1 to 64. `url` is optional and https only.
  - Each value passes the parameter's own `type`, `min`, `max` and `values` when the rule set is drafted (`ruleParameterValueError`).
  - A rule set naming an unknown or unpublished schedule is refused.
  - So is a rule set whose parameter `type` differs from the schedule's.
- **Keys.**
  - Same pattern as setting keys: dotted lower case, for example `stat.companies.audit_threshold`.
  - Products use their own prefix (no product or tenant name in platform code).

## 3. Publishing (`rules` minor; no new approval policy)

- `createSchedule(ctx, { key })`, `saveScheduleDraft(ctx, key, body)` and `publishSchedule(ctx, key, version, { effectiveFrom? })` are **platform context only**. The schedule lives in `tnt_platform`.
- Publication raises the existing R4 action `rules.ruleset.publish`. Its payload is `{ kind: "schedule", key, version, digest, effectiveFrom? }`. The executor dispatches on `kind`, and a payload without `kind` stays a rule-set publication, so pending requests keep working. The checkers, the 60-minute delay and the R1-D-86 sign-offs are therefore exactly those of a platform rule set.
- The R1-D-113 scheduled cut-over applies unchanged. The previous version is retired at the cut-over and stays readable. A published version is immutable (a trigger, as for `rule_set_version`). A correction is a new version with `reason`.
- Ledger: `rules.schedule.create`, `rules.schedule.draft`, `rules.schedule.submit` and `rules.schedule.publish`, each in the same transaction. There are no outbox events in this change, so no new event schema is needed; a later request can add `ParameterSchedulePublished`.

## 4. Data model (migration `rules/0005_parameter_schedule.sql`, expand-only)

- `rules.parameter_schedule`:
  - columns: `key` (pk), `tenant_id` (always `tnt_platform`, checked), `created_by`, `created_at`.
- `rules.parameter_schedule_version`:
  - columns: `key`, `version`, `state` (`draft`, `pending_approval`, `published`, `retired`), `body` jsonb, `digest`, `approval_id`, `effective_from`, `effective_to`, `published_at`, `created_by`, `created_at`, `updated_at`;
  - primary key `(key, version)`;
  - partial unique indexes: one open draft or pending version, and one published version;
  - an immutability trigger outside `draft`.
- The design's separate `parameter_entry` table is folded into the version's `body`. The entries are always read and written as one immutable list per version, so a second table would add only joins. This is a departure from the design, recorded in DECISIONS.
- **RLS, forced:**
  - select: every tenant;
  - insert and update: only `tenant_id = 'tnt_platform'` in platform scope, as for platform rule sets.
- Every column is tagged `dataclass:INTERNAL`, except `body` (`PUBLIC`: statutory values and citations).
- `rules.decision_log.parameters` (jsonb) gains the `schedule` object per dated parameter. There is no column change.

## 5. Evaluation

- `resolveParameters(ctx, body, asOf)` now receives the decision's instant: `asOf`, or now when none is given.
- For a dated parameter it reads the schedule version in force at that instant. The version is chosen by publication window (`effective_from <= t < effective_to`), as `versionAt` does for rule sets. The entry is then chosen by date.
- The entry's date is compared with the calendar day of `t` in **Asia/Kolkata**. This is the platform default zone (PL3-D-21 #23), and it is an assumption. A product that needs another zone passes `asOf` at that zone's midnight.
- No published version, or no entry in force (before the first `effectiveFrom`), gives `UNDETERMINED` / `parameter_not_in_force`. It never falls back, and a tenant setting of the same name is never read.
- The setting-backed path is unchanged, including reading the current value under `asOf` (the design's §1 problem for settings is out of scope: settings have their own history, config/0003).
- `prepare` and `project` resolve dated parameters the same way. `project` never records.

## 6. Tests (by ID; all on PostgreSQL 18 unless marked)

- **IPB-07-16 explain:** `explain` cites the entry (schedule key, version, `effectiveFrom`, citation; `source: "schedule"`).
- **As of:** decisions as of each side of a cut-over get each entry's value. Replaying an old decision as of its date gives the same value after a newer entry or a newer version is published.
- **Locked:** a tenant setting with the parameter's name has no effect, and no entry in force gives `UNDETERMINED`.
- **Refusals** (`IPB-RULE-001`):
  - a draft with overlapping or unsorted entries;
  - a draft with a missing or over-long citation;
  - a draft with a non-https url;
  - a draft whose value fails the parameter's bounds;
  - a draft naming an unknown schedule, or one of another type.
- **Maker-checker:** publication needs the platform R4 checker (maker ≠ checker, delay).
- **Scope:** a tenant context cannot create, draft or publish a schedule, and every tenant reads published schedules.
- **Immutability:** a published version cannot be updated (trigger).
- **Engines (unit):** the differential test agrees on all three engines, because only the value reaches the engine.
- **Migration:** `migration:lint`, `rls-lint`, the data-class lint, and the export-map gate (no export change in `audit`).

## 7. Threat model

A new §3.131:

- **T:** a tenant or a single person changing a statutory value. Mitigations: platform scope only, R4 maker-checker, immutable versions, ledgered.
- **R:** every decision records the version and citation it used.
- **I:** none. The values are public.
- **D:** a missing entry. Mitigation: `UNDETERMINED`, never a guess.

## 8. Exit gate

- [ ] §6 tests pass locally (`pnpm check:full`) and at the PR's `ci:run`.
- [x] Product guide section (§7ch: declaring a dated parameter, publishing a schedule, reading the citation in `explain`), with the LawDocsComply adoption note.
- [x] Threat model §3.131, DECISIONS (R1-D-175), STATUS, OWNER-QUESTIONS #133.
- [x] Changesets: `contracts` minor, `rules` minor (migration `rules/0005`), `connectors` patch (the engines refuse an unbound dated parameter; §10).

## 10. As built (departures from this plan, R1-D-175)

- **`connectors` patch.** The engines bound a parameter's `default` when no value was given; a dated parameter has none, so `prepareTable` now refuses it unbound, and the RULES service compiles a draft on every engine with the schedule's latest value bound.
- **Added for completeness:** `reopenSchedule` (a rejected or expired request would otherwise block the schedule's one open version for ever), `listSchedules` and `getSchedule` (reads from any context), a schedule's type fixed for its life, and the trigger also keeping a published version's cut-over and a retired version's end.
- **`explain`** lists parameters in their declared order (jsonb reorders object keys).
- **Locking:** a draft locks the schedule's version rows, as a rule-set draft does; `app_rw` has no update right on `rules.parameter_schedule`, so it is not locked.
- **Before the first publication:** a schedule version applies only from its publication, so an `asOf` earlier than that is `parameter_not_in_force`.

## 9. Owner decisions needed

None to build. Three assumptions will be logged `[ASSUMED – owner review]`:

- entries are compared by calendar day in Asia/Kolkata;
- entries are folded into the version body;
- publication reuses `rules.ruleset.publish` with a `kind` in its payload.

The first one changes results, so the owner may want to confirm it. It is reversible before any product publishes a schedule.
