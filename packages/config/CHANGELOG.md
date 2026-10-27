# @infrabyx/config

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
