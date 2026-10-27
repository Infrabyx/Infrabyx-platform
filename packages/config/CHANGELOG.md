# @infrabyx/config

## 0.5.0

### Minor Changes

- de53086: Owner answer #40 (PL4-D-13): governed, tighten-only TENANT keys `vidhi.qa.min_reviews` (20), `vidhi.qa.precision_floor` (0.8) and `vidhi.qa.recall_floor` (0.8), changed by `ORG_OWNER` through R2 maker-checker. A tenant may only raise them; the registry minimum is the platform floor (235 keys in the registry).
- 1fecf45: Owner answer #53 (PL5-D-11): `cms.media.reencode_enabled` now defaults to `true` (AVIF and WebP renditions and PNG favicons through the MEDIA port).
- 275d4ba: Settings `trust.request.ack_hours` (24, may only be lowered) and `trust.request.fulfil_days` (`{ default: 10, regulator_deadline: 3 }`) from IPB-08 §08.5, read by the trust request SLA.
- 934355c: PL5 session 1 (PL5-D-02): 165 website keys (400 in the registry) from IPB-04 (`web.*`, `cms.*`, `brand.*`, the launch `mkt.*` keys, `fb.*`), IPB-05 (`pol.*`), IPB-06 (`a11y.*`), IPB-08 (`trust.*` for the mirror and the Trust Centre) and IPB-13 (`res.*` and the off-by-default blocks), plus `eco.v12.emit_enabled` (false). Launch defaults: no tag manager and no analytics adapter (OWN-09), form payloads never stored, Investors off; GPC, self-hosted fonts and the Claims Register are locked on; the contrast minimums, the Lighthouse floor (95) and the consent-cookie lifetime are tighten-only.

### Patch Changes

- b0dc390: Setting notes for `cms.soft_delete.restore_days` (content is purged 90 days after soft delete, OWNER-QUESTIONS #48) and `cms.media.reencode_enabled` (off: `sharp` failed the licence check, #43 and #53).
- b7de3c6: PL5 session 7: `validateEnv` and `loadAndValidate` give an absent optional variable its schema default (`envVar(z.enum([...]).default("a"), …)`), as its type already promised; before, the value was left out.
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
  - @infrabyx/contracts@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.4.0

### Minor Changes

- 200b25a: The `ai.*` and `vidhi.*` settings keys of IPB-03 §03.5 (232 keys in the registry), with content capture locked off, plus `trust.privacy.cross_border_ai_allowed` (default false) and the token caps used while model prices are unset (PL4-D-02).

  New settings field `mc_deactivate` (bool keys only): switching an explicit `true` to `false` needs maker-checker at that class, while every other change applies at once. The four `ai.kill.*` keys use it with `tighten: true`, so a kill switch turns on immediately, needs an R2 checker to turn off, and a lower tier can never switch off a higher one (IPB-03-48).

### Patch Changes

- f6e9a88: `ai.obs.run_retention_days`: the note now records the owner's approval of the 180-day run deletion (PL4-D-05).
- Updated dependencies [2b07109]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/crypto@0.4.0

## 0.3.0

### Minor Changes

- 50093e9: Settings `int.esign.provider` (`leegality` | `digio` | `memory`) and `int.esign.expire_in_days`
  (1–90, default 10), both PLATFORM tier and R4 (PL3-D-23).
- 2725b6c: PL3 session 1: settings for RULES (`rules.*`), PUSH (`int.push.*`), NOTIFY dedupe, workflow timers,
  export (`eng.export.*`) and the tighten-only maker-checker tenant keys `mc.*` (new tighten mode
  `subset`); exact `kill.msg.email|sms|whatsapp|push|inapp` switches; `FlagService.boot()` persists or
  loads the flag snapshot at startup, and `onAlert` raises `ops.flags.provider_unreachable`
  (throttled) whenever flags are served without the provider (PL3-D-13).
- dd7a98b: A maker-checker setting change carries the checker diff (`{ before, after }` at the target scope)
  in its approval request (IPB-07-15, @IPB-07-AT-06).
- 53697f5: `FlagService`: the `ops.flags.provider_unreachable` alert escalates when a provider outage passes
  1 hour and again at 12 hours (`ALERT_ESCALATIONS`; alert fields `outageS` and `escalation`), once
  each per outage, dated from the last provider contact so a restart does not reset it. The IPB-01
  24-hour snapshot limit is unchanged (OWNER-QUESTIONS #20, PL3-D-17).

### Patch Changes

- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [50093e9]
- Updated dependencies [3951517]
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0

## 0.2.0

### Minor Changes

- efd00ab: PL2 session 1: settings keys for the thirteen PL2 ports (IPB-01 §01.4.4.2; 156 keys in the
  registry), the provider_routing loader `loadRoutingFile` and the `infrabyx-routing check` CLI
  (IPB-01-20), including the IPB-DEV-04 gate-B check against `sandbox-status.json`.
- 13c7379: Settings `mkt.meta.enabled` (default false, OWN-08), `int.sms.low_balance_credits` (default 500) and `int.whatsapp.rate_card` (deployment configuration only) for the messaging adapters (PL2-D-64).

### Patch Changes

- 0c4535d: Env guard `payments-live-key`: a live Razorpay key (`rzp_live_`) in any variable refuses to start outside prod and dr (P-03).
- Updated dependencies [5482043]
- Updated dependencies [2969424]
- Updated dependencies [858a76a]
- Updated dependencies [9ac878e]
- Updated dependencies [ded1ae2]
- Updated dependencies [9c774b9]
- Updated dependencies [9ac878e]
- Updated dependencies [9ac878e]
- Updated dependencies [858a76a]
- Updated dependencies [7a36249]
- Updated dependencies [7a36249]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/contracts@0.2.0

## 0.1.0

### Minor Changes

- 542194d: PL1 config: typed environment schema helpers and boot loader with the IPB-11 guard table and supabase-guard (exit 78, names only, never values), secret:// resolution through the SECRETS port, schema-driven redaction and the `infrabyx-env example [--check]` generator; the settings registry generated from `settings-tree.yaml` with typed reads, scope precedence, tighten-only and locked enforcement, ledgered writes and maker-checker routing; the flag registry (`kill.*`, IPB-12 `fut.*`) with snapshot fallback and kill-switch safe state; migration `config/0001_init.sql`.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [a17086c]
- Updated dependencies [8f44a2c]
  - @infrabyx/contracts@0.1.0
  - @infrabyx/crypto@0.1.0
