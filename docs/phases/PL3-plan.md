# PL3 — Rules, workflow, notify, export

**Phase:** PL3 (IPB-14 §14.3) · **Packages:** `rules`, `workflow`, `notify`, `export` (first releases). Also ESIGN in `connectors` (owner decision D-09) and additions to `contracts`, `config`, `testing` and `connectors`.
**Date:** 2026-10-27 · **Branch:** `claude/sweet-maxwell-mv0qk2`
**Status:** written and self-reviewed under the continuous-build mode (PL2-D-41). **Owner answers to #7–#16 applied on 27 Oct 2026** (PL3-D-04 to PL3-D-13; sections marked _(owner, PL3-D-nn)_). Spike results: `docs/phases/PL3-spike.md` (PL3-D-15). Owner answers to #18–#20 applied on 27 Oct 2026 (PL3-C-01, PL3-C-02, PL3-D-17); no question is open.
**Read for this plan:**

- IPB-01 §01.4.4 (RULES, NOTIFY, PUSH, ESIGN, WORKFLOW, EMAIL, SMS, WHATSAPP rows), §01.4.10;
- IPB-02 §02.2, §02.4.2, §02.4.6.1–2, §02.4.12, §02.5, §02.6.1; rows 02-10, 02-18, 02-26, 02-80, 02-82, 02-83;
- IPB-07 rows 07-14 to 07-16, 07-25, 07-27, 07-36 to 07-43; §07.4.2, §07.4.9, §07.5, §07.6;
- IPB-09 rows 09-06, 09-07, 09-34 to 09-38; §09.4.7;
- IPB-10-27;
- Ecosystem spec §3.6, §3.11, §4.4, §5.2, §6.14, §6.26, §6.39, §6.40, §10.2, §12 to §12.3, §13.3;
- `docs/DECISIONS.md`: OWN-07, OWN-08, IPB-DEV-03 to 07, PL2-D-55, PL2-D-64, PL2-D-65, D-09.

---

## 1. Scope and what PL3 is not

| Package    | Delivers                                                                                                                                                                                                                                      | Builds on                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `rules`    | RULES_PORT service: rule sets as data, versioned and immutable once published; publish through maker-checker; `evaluate`, `evaluateCel`, `simulate`, `explain`; fail-closed `UNDETERMINED` to a human queue                                   | `tenancy` approvals and kernel, `audit`, `config`       |
| `workflow` | Maker-checker on top of the PL1 `ApprovalsEngine`. Adds: scheduled actions and delay windows executed by timers; the Work Inbox; human queues; checker diffs; SLA reminders; the standard `RefundApprovals` view; Temporal approval signals   | `tenancy` approvals, WORKFLOW and QUEUE ports, `notify` |
| `notify`   | NOTIFY_PORT fan-out to in-app, email, SMS, WhatsApp and push. Adds: the notification catalogue; preferences, quiet hours and digest; resend classes (owner, PL2-D-65); the platform suppression list; marketing consent; `kill.msg.<channel>` | EMAIL, SMS, WHATSAPP, PUSH, QUEUE ports                 |
| `export`   | `<PRODUCT>-EXPORT-1.0` export maps, the archive writer (Ecosystem §12.1 profile), `export-map-gate` and `golden-archive-diff` CI checks, and SHA-256 per download in the ledger                                                               | STORAGE, `audit`, `seed` (`tnt_demo`)                   |
| ESIGN      | Port interface, reference `leegality`, alternative `digio`, both on stubs and `unproven` (D-09, IPB-DEV-07)                                                                                                                                   | `connectors` core                                       |

Out of PL3:

- **UI.** The Work Inbox screen, Approvals tab, notification preferences screen, "Why this?" card and export download page are PL5 (`ui`). PL3 ships the services and APIs those screens call.
- **CONSENT port and the `consent` package** (PL5). PL3 holds only the marketing-consent state that NOTIFY needs to suppress sends (section 6.6). It moves to the CONSENT port when that port ships.
- **Help keys.** `hlp` and `hlp-lint` are PL5. PL3 makes a help key mandatory on every catalogue class, so the lint has something to check.
- **Outbound tenant webhooks** (IPB-10-21 to 26) and the realtime WebSocket adapter: PL6 and the watchlist.
- **Erasure and DPDP correction workflows** (locked list: deletion and retention). PL3 covers only the access/export path.
- **The platform support token** (PL2-D-55): see section 9.4.
- **`docgen` and PDF/A rendering.** No IPB-14 package owns them. The README is TXT and Markdown in PL3; PDF/DOCX wait for docgen (section 7.4).

## 2. Package changes and dependency order

```
contracts  + RULES, NOTIFY, PUSH, ESIGN port interfaces; notification catalogue schema; export map and
             archive manifest schemas; new IDs; events; error codes (section 10)
config     + settings keys (section 11); flags kill.msg.email|sms|whatsapp|push|inapp
testing    + RULES, NOTIFY, PUSH, ESIGN contract suites; Expo, FCM, Leegality and Digio stubs; export
             fixtures; golden-archive helpers
connectors + rules/zen and rules/json-rules (engine adapters); push/expo and push/fcm; esign/leegality
             and esign/digio
rules      (new) rule-set store, publish via approvals, evaluation, simulation, decision log
workflow   (new) scheduled actions, timers (Temporal + PostgreSQL alternative), Work Inbox, human queues,
             SLA reminders, diffs, RefundApprovals
notify     (new) catalogue, router, preferences, quiet hours, digest, resend classes, suppression,
             consent state, in-app channel, delivery tracking
export     (new) map registry, archive writer, normalisers, export-diff CLI, map gate CLI
```

Dependency order:

- `rules` and `notify` depend on `contracts`, `config`, `tenancy`, `audit` and `connectors`.
- `workflow` depends on those and on `notify`, which sends to checkers and SLA reminders.
- `export` depends on `contracts`, `config`, `tenancy`, `audit` and `connectors` (STORAGE).
- No cycles. `notify` does not import `workflow`. A "hold for review" resend writes an inbox item through a small `HumanQueue` interface in `contracts`, which `workflow` implements (section 6.4).

**Releases at the exit gate:**

- `rules`, `workflow`, `notify` and `export` **0.1.0**, each flipped to publishable in its first changeset (PL1-D-20);
- `contracts`, `config`, `testing` and `connectors` **minor** bumps;
- `tenancy` minor, for its new migration and approvals additions (section 5.2).

## 3. Cross-cutting design

### 3.1 One module, one schema

Each new package owns a PostgreSQL schema: `rules`, `workflow`, `notify`, `export`.

- Every tenant table has a `tenant_id`, RLS enabled and forced, and the PL1 tenant policy.
- `infrabyx-migrate` applies the migrations when the package is installed, as it does for connectors (PL2-D-34): tenancy → audit → config → seed → connectors → rules → workflow → notify → export.
- Cross-schema access goes through the outbox and in-process dispatch (IPB-01-09/11), never through a table read.

### 3.2 Every mutation through the kernel

Every write goes through `kernel.mutate` with a ledger entry in the same transaction. This covers rule-set drafts and publishes, inbox items, scheduled actions, notification sends, suppressions, export jobs and archive records. The NN suites `@NN-01`, `@NN-02` and `@NN-45` re-run with the new schemas.

### 3.3 Maker-checker uses the existing engine

`tenancy.ApprovalsEngine` stays the only place where a request is created, decided, executed or cancelled. The PL1 rules carry over unchanged:

- the checker is never the maker;
- agents never check;
- risk-class minimum delays;
- two checkers for tenant delete.

`workflow` adds timers, the inbox, SLAs and diffs **around** the engine and does not change those rules. The owner approved two policy additions _(owner, PL3-D-07, PL3-D-08)_: request **expiry** with reminder and escalation (section 5.2, 5.4) and the tighten-only tenant keys `mc.*` (section 11). Escalation notifies and never decides.

### 3.4 Data in payloads

These limits follow Ecosystem §13.3 and IPB-01:

- QUEUE and WORKFLOW payloads carry IDs only.
- Push payloads carry a title and a deep link only. Content is fetched in-app.
- No Aadhaar, PAN, OTP, account numbers or bureau data in logs, traces, push payloads or DLQ metadata. The existing telemetry scrubber covers logs and traces, and NOTIFY adds a payload guard for push and in-app titles.

### 3.5 Kill switches

`kill.msg.<channel>` for `email`, `sms`, `whatsapp`, `push` and `inapp`, registered in `flags.defaults.json` (IPB-02-83):

- When a switch is on, a send for that channel is refused before any I/O with `IPB-NTF-004`, and the delivery is recorded as `killed`.
- The PL1 FlagService rules apply: if the flag provider is unreachable, the snapshot and then the safe state decide.
- **Safe state.** The PL1 safe state is "kill on" for every class, with no bypass for mandatory classes _(owner, PL3-D-13)_. To make "no snapshot" impossible after the first boot:
  - `FlagService.boot()` fetches a snapshot and persists it in `config.flag_snapshot` before the service reports ready, and every scheduled refresh persists it again;
  - a process that starts during a provider outage loads the persisted snapshot;
  - every evaluation served from the snapshot or the safe state raises the operations alert `ops.flags.provider_unreachable` (`onAlert` hook, throttled to one per key per 5 minutes).
  - The IPB-01 24-hour snapshot limit is kept _(owner, PL3-D-17)_: after 24 hours without the provider, `kill.*` switches turn on and other flags take their registry defaults. The alert escalates at 1 hour and again at 12 hours of outage (once each per outage, dated from the last provider contact), so operations can act first.

## 4. RULES (`@infrabyx/rules`)

### 4.1 Port interface (`contracts/ports/rules.ts`)

```ts
interface RulesPort extends Port {
  evaluate(
    ref: { ruleSetId: string; version?: number },
    input: unknown,
    call: PortCall,
  ): Promise<Decision>;
  evaluateCel(expr: string, input: unknown, opts?: { maxCost?: number }): Promise<CelResult>;
  listRuleSets(): Promise<RuleSetSummary[]>; // RLS-scoped to the call's tenant
  publish(ruleSetId: string, version: number, call: PortCall): Promise<{ approvalId: string }>;
  simulate(
    ref: { ruleSetId: string; version: number },
    inputs: unknown[],
  ): Promise<SimulationReport>;
  explain(decisionId: string): Promise<Explanation>;
}
```

- `Decision`: `{ id: "dcs_…", outcome: "MATCHED" | "NO_MATCH" | "UNDETERMINED", outputs, ruleId, ruleSetId, version, reason }`.
- `Explanation`: the matched row and condition, the inputs it read (names only above INTERNAL), and the rule's `help_key`. It feeds the IPB-07-16 "Why this?" card and `@IPB-07-AT-11`.

### 4.2 Rule-set format (platform decision table)

Engine-neutral JSON, schema in `contracts`:

- **`hit_policy`:** `first` or `collect`.
- **Inputs and outputs:** typed lists.
- **Rows:** each row is `{ id, when: <CEL boolean>, then: {…}, citation?, verify? }`.
- **Statutory rows:** a row carrying `verify: true` (`[VERIFY]`) cannot drive an output marked `statutory`. Evaluation returns `UNDETERMINED` instead (Ecosystem §12.3 pattern).

Engine adapters compile this format:

| Adapter                    | Role               | Engine                                                      | Notes                                                                                           |
| -------------------------- | ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `zen` (reference)          | GoRules ZEN        | `@gorules/zen-engine`, JDM compiled from the table          | Native NAPI binary: spike checks Node 24.22.1 prebuilds, licence and the 7-day rule [VERIFY]    |
| `json-rules` (alternative) | json-rules-engine  | `json-rules-engine` with CEL conditions as custom operators | Pure JavaScript; kept green in CI                                                               |
| memory fake                | second alternative | direct CEL row walk                                         | `connectors/rules` (CEL is a vendor import), allowed by IPB-01 §01.4.4.0 _(as built, PL3-D-18)_ |

- **CEL:** a single pinned library chosen in the session-1 spike: `@marcbachmann/cel-js` or `cel-js` [VERIFY licence, maintenance, cost limits]. It runs under `rules.cel.max_cost`.
- **Placement** (assumption A-01): the engine adapters live in `packages/connectors/src/rules/`, so `vendor-import` stays unchanged. The `rules` package holds the store, publish flow, decision log and service. IPB-01 says the reference is "in `packages/rules`": the service is, and the engine binding sits behind the port in `connectors`.

### 4.3 Data model (`rules/0001_init.sql`)

- **`rule_set`:** `id rls_…`, `tenant_id` (platform sets use `tnt_platform`), `key` (dotted, for example `fbx.los.nba.sanction_ready`), `owner_module`, `data_class`.
- **`rule_set_version`:**
  - `(rule_set_id, version)` primary key;
  - `state` (`draft`, `pending_approval`, `published`, `retired`) and `body` jsonb;
  - `digest` (SHA-256 of the canonical body);
  - `effective_from` and `effective_to`, `approval_id`, `published_at`.
  - A trigger refuses updates to `body` once the state leaves `draft`.
- **`decision_log`:**
  - `id dcs_…`, `rule_set_id`, `version`, `outcome`, `rule_id`, `inputs_digest`, `inputs_enc` (FieldCrypto when above INTERNAL), `created_at`.
  - Retention is the `audit` retention class default; changing it is locked (section 13, #13).
- **`simulation_run`:** `id`, `version`, `input_count`, `diff_summary`, `created_by`.

### 4.4 Behaviour

- **Publishing.**
  - `publish` creates an approval request with action `rules.ruleset.publish`, payload `{ ruleSetId, version, digest }` and a diff against the current published version.
  - Risk class: **R4** (policy change, 1 h minimum delay), the stricter reading (assumption A-02, #12).
  - `rules.publish.requires_checker` is locked true.
  - When the request executes, the version's state becomes `published` and the previous version becomes `retired`. One ledger entry is written, and `in.<product>.rules.RuleSetPublished.v1` is emitted.
- **Evaluating.**
  - `evaluate` reads the version effective now (or the pinned version) and caches compiled tables per `(id, version)`.
  - An engine error, timeout (`rules.eval.timeout_ms`, default 50) or CEL cost overrun returns `UNDETERMINED` and raises a human-queue item (`HumanQueue.raise({ kind: "rules_undetermined", ref: dcs_… })`). A decision never defaults to allow or approve (IPB-01 RULES).
- **Simulation.** `simulate` runs a draft against a stored fixture set and against the published version, and reports which rows changed outcome.
- **Health.** A canary table is evaluated on every adapter.

## 5. WORKFLOW (`@infrabyx/workflow`)

### 5.1 Scheduled actions and delay windows (IPB-02-80, IPB-07-27(c), `@IPB-07-AT-07`)

- **Table `workflow.scheduled_action`:**
  - `id sca_…`, `approval_id`, `action`, `execute_at` (= `delay_until`);
  - `state` (`scheduled`, `executed`, `cancelled`, `failed`), `attempts`, `last_error_code`.
  - A row is created when the approvals engine moves a request to `approved` with a delay. It is written through an outbox consumer of `ApprovalDecided`, in the same transaction as the inbox item.
- **Timers.**
  - Reference: a Temporal workflow `scheduledAction(id)` that sleeps until `execute_at` and then calls `ApprovalsEngine.execute`. Cancel is a signal.
  - Alternative: a PostgreSQL poller on pg-boss (`workflow.timers`). IPB-01 names "a PostgreSQL state-machine engine in `packages/workflow` for simple timers".
  - Both pass one timer contract suite.
- **Catch-up reconciler** (IPB-01 WORKFLOW failover). Every minute it finds `scheduled` rows past `execute_at` with no running timer and executes them.
- **Idempotency.** Execution reuses the engine's state check (`executed` is final), so a double fire is harmless.
- **Cancellers.** `PLT_SECURITY_OFFICER` can cancel too (IPB-02-80 says "any ORG_OWNER or PLT_SECURITY_OFFICER"). PL1's `cancel` allows the maker and ORG_OWNER only, so tenancy gains `PLT_SECURITY_OFFICER`. This widens who may _cancel_: it adds a safety stop and weakens no control (A-04).
- **Events.** `ScheduledActionCreated`, `ScheduledActionCancelled` and `ScheduledActionExecuted` (already registered in contracts).

### 5.2 Additions to `tenancy` (no edit to shipped migrations)

- _(as built, PL3-D-19: expiry is the terminal marker `expired_at`, because widening the CHECK would need a drop in the same release; the index is not needed)_
- `tenancy/0002_approvals_pl3.sql`:
  - an `approval_request.diff` jsonb column (CONFIDENTIAL; a sealed variant when the payload is sealed);
  - an index on `(tenant_id, state, delay_until)`.
- The engine's `request` takes an optional `diff` (`{ before, after }`), which is redacted to field names above INTERNAL. It produces the checker diff (IPB-07-15, 07-39).
- **Expiry** _(owner, PL3-D-07)_: a new terminal state `expired` (CHECK constraint widened, expand-only) and `expires_at` set at request time:
  - 7 days for every request;
  - 72 hours for R3 requests on actions registered `financial: true`, and for every R4 and R5 request.
  - A timer (`workflow`, both engines) moves an overdue `pending` request to `expired` through `kernel.mutate` with the ledger entry `approvals.request.expire` and the event `ApprovalExpired`. `decide` and `execute` refuse an expired request (`IPB-UX-012`, proposed with PR-017's batch), and the maker must raise it again.

### 5.3 Work Inbox (IPB-07-15, §07.4.9, `@IPB-07-AT-10` backend)

- **Table `workflow.inbox_item`.** Fields as in IPB-07 §07.4.9:
  - `id ibx_…`, `type` (`task`, `approval`, `mention`, `suggestion`, `due`, `job_failed`);
  - `product_module`, `record_ref`, `title` (INTERNAL, no personal data), `due_at`;
  - `from_id`, `severity`, `action_hint`, `deep_link`, `help_key`;
  - `assignee` (user or role), `created_at`, `read_at`, `resolved_at`.
- **Service.** `InboxService.raise`, `list(principal, filter)`, `markRead`, `resolve`, `badgeCount`.
  - Items resolve automatically when the underlying state changes. The approval consumer resolves the item on `Decided`, `Executed` or `Cancelled`.
  - An approval item is visible to principals holding a checker role for the action, **excluding the maker**.
- **Sources in PL3:**
  - approvals (`ApprovalRequested` raises one item per checker role);
  - rules `UNDETERMINED`;
  - NOTIFY hold-for-review resends;
  - PAYMENTS unresolved refunds (P-07) and reconciliation differences (P-11);
  - failed export jobs;
  - `due` items from SLA reminders.
- Mentions and Vidhi suggestions arrive with their products and PL4.
- **Events.** `in.<product>.inbox.ItemCreated.v1` and `ItemResolved.v1`.
- **`HumanQueue`** (`contracts/kernel.ts`): a small interface, `raise(tx, item)`. It lets `notify`, `rules` and `connectors` raise inbox items without depending on `workflow`.

### 5.4 SLA reminders, bulk and Vidhi signals

- **Reminders.**
  - Each pending approval older than 24 hours (or the tenant's shorter `mc.reminder_hours`) gets a NOTIFY class `approval.reminder` (mandatory) to its checkers and a `due` inbox item _(owner, PL3-D-07)_.
  - At 48 hours the request **escalates**: NOTIFY class `approval.escalated` (mandatory) and an inbox item for the tenant's `ORG_ADMIN` role. Escalation never decides.
  - At `expires_at` the request expires (section 5.2).
- **Bulk approve.** `decideMany(ids)` applies `decide` per id, each with its own audit entry. Above `ux.bulk.confirm_threshold` it requires a typed confirmation token, or returns `IPB-UX-006` (IPB-07-14).
- **Temporal helper** _(deferred to PL4 with Vidhi, PL3-D-19)_ `awaitApproval(approvalId)` for PL4 Vidhi missions: a workflow waits for a signal raised by the `ApprovalDecided` consumer. A late signal after cancellation is ignored (prepares `IPB-VID-022`).

### 5.5 `RefundApprovals` (gate A product ask)

`workflow` ships the standard implementation of `connectors/payments` `RefundApprovals` on top of the engine. Products then need only to register the `payments.refund` action and its checker roles.

## 6. NOTIFY (`@infrabyx/notify`)

### 6.1 Port interface (`contracts/ports/notify.ts`)

The spec gives no method list, so the interface is derived from IPB-07-25 and the IPB-04/05 uses (assumption A-06):

```ts
interface NotifyPort extends Port {
  send(
    n: {
      class: string;
      to: Recipient[];
      vars: Record<string, unknown>;
      deepLink: string;
      locale?: string;
      idempotencyKey: string;
    },
    call: PortCall,
  ): Promise<SendResult>;
  preview(classId: string, locale: string, vars: unknown): Promise<RenderedChannels>; // "test notification"
  setPreferences(userId: string, prefs: ChannelMatrix): Promise<void>; // IPB-NTF-001 on a mandatory class
  suppress(entry: SuppressionInput): Promise<void>;
  unsubscribe(token: string): Promise<void>; // one-click marketing unsubscribe
  verifySenderDomain(brand: string, domain: string): Promise<DomainCheck>; // SPF, DKIM, DMARC (IPB-04-28)
  deliveryStatus(notificationId: string): Promise<DeliveryRecord[]>;
}
```

- **Recipients.** A `Recipient` is a principal reference (`usr_…` or a product `party_ref`). Addresses are resolved inside NOTIFY through a product-supplied `ContactResolver`, so callers never pass raw addresses through events.
- **Reference.** The internal `packages/notify`.
- **Alternatives.** A memory fake. The "OH notification service via HTTP" alternative arrives when Operations Hub exposes it.

### 6.2 Notification catalogue

`notify/catalogue/*.yaml` per product plus the platform file `platform.yaml`, validated by a schema in `contracts`. Each class has:

```yaml
id: approval.requested # dotted
category: transactional | security | regulatory | maker_checker | marketing
mandatory: true # cannot be disabled (IPB-NTF-001), may be routed
urgent: true
bypass_quiet_hours: true # only if also allowed by ntf.org.allow_quiet_hours_bypass
resend: safe | hold # owner decision PL2-D-65; missing → hold
default_channels: [inapp, email]
help_key: ntf.approval.requested
marketing_purpose: MARKETING_EMAIL # marketing only; Ecosystem consent purpose codes
templates:
  email: { key: approval.requested, locales: [en, hi] }
  sms: { dlt_template_id: "…", header: "…" }
  whatsapp: { name: "…", category: utility, lang: [en] }
  push: { title_key: "…" }
never_channels: [whatsapp] # e.g. collections, legal notices (Ecosystem §4.4, §10.2)
```

**Catalogue lint** (`infrabyx-notify-lint`, runs in `verify`):

- every class has a `help_key`, a `deep_link` pattern and a `resend` value;
- `marketing` classes carry a consent purpose and are never `mandatory`;
- classes in `category: regulatory` whose id matches the collection, recovery or legal-notice patterns list `whatsapp` under `never_channels`;
- marketing WhatsApp classes are refused while `mkt.meta.enabled` is false (OWN-08).

The platform file ships these classes:

- `security.*`, mandatory and urgent;
- `approval.requested` and `approval.reminder`, mandatory, urgent, bypass allowed;
- `export.ready`;
- `notice.policy.change` (IPB-05-06);
- `breach.notice` (IPB-02-58);
- `webhook.endpoint.disabled`.

### 6.3 Routing, preferences, quiet hours and digest (IPB-07-25, `@IPB-07-AT-22`)

1. **Resolve the class** and the effective channel list. The order is: catalogue defaults → `ntf.org.routing` (ORG, maker-checker) → `ntf.user.channels` (USER). A mandatory class keeps at least one channel. Disabling it fails with `IPB-NTF-001`.
2. **Quiet hours.** `ntf.quiet_hours` (default 21:00–08:00) is applied in the user's time zone: `usr.profile.timezone` if registered, else the tenant's `org.timezone`, else Asia/Kolkata (A-07).
   - Non-urgent classes are queued for the digest.
   - Urgent classes send immediately only when `bypass_quiet_hours` and `ntf.org.allow_quiet_hours_bypass` are both true. Otherwise they wait for the end of quiet hours.
3. **Digest-first.** Non-urgent classes go to `notify.digest_entry` and are sent at `ntf.user.digest_time` (08:30 local) as one message per channel, emitting `in.<product>.ntf.NotificationDigestSent.v1`.
4. **Consent and suppression** (6.5, 6.6) are checked per recipient and channel just before each send.
5. **Fan-out.** One `delivery` row per (recipient, channel). The send is enqueued on QUEUE with IDs only. The worker calls the channel port through the PL2 router with the class's idempotency key.

### 6.4 Resend classes (owner decision PL2-D-65)

Every class declares `resend`, and an unclassified class is treated as `hold`. When a delivery is left `pending` after a timeout or an unknown vendor outcome:

| Resend class        | Examples (owner)                                                                                                                                              | Behaviour                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **safe to resend**  | OTPs, login and security alerts, receipts                                                                                                                     | Resent **once**. A later delivery report removes the duplicate where the vendor provides one. The second attempt is recorded on the same `delivery` row (`attempt = 2`)                                                      |
| **hold for review** | collection or recovery reminders, legal and demand notices, KFS and loan-term communications, anything that could read as harassment or a second legal notice | **Never resent automatically.** The delivery moves to `held`, and an inbox item (`task`, `action_hint: "confirm_resend"`) goes to the tenant's `ORG_ADMIN` role. A person confirms or discards, and the decision is ledgered |
| _unclassified_      | —                                                                                                                                                             | Treated as **hold for review**                                                                                                                                                                                               |

- This replaces the PL2-D-64 at-least-once behaviour for any send that goes through NOTIFY.
- The PL2 adapters stay unchanged. The resend decision moves up into NOTIFY, and the adapters' pending lookup still runs first.
- **Channel fallback.** A WhatsApp failure falls back to SMS or email "with notice" (IPB-01). That fallback is allowed only for `safe` classes and never for a class whose `never_channels` or consent forbids the target channel. A `hold` class never falls back automatically. It goes to the same review item.

### 6.5 Platform suppression list (owner decision PL2-D-65: single source of truth)

- **Table `notify.suppression`:**
  - `id sup_…`, `scope` (`platform` for hard bounces and complaints, or a `tenant_id` for tenant-level marketing opt-outs);
  - `channel`, `address_hash`, `reason` (`hard_bounce`, `complaint`, `unsubscribe`, `stop`, `manual`, `invalid`), `class_scope` (`all` or `marketing`), `source`, `created_at`, `lifted_at`.
- **Inputs:**
  - EMAIL bounce and complaint webhooks (SES SNS, Brevo);
  - SMS and WhatsApp STOP keywords and delivery errors that mean "invalid number";
  - the one-click unsubscribe link (RFC 8058 `List-Unsubscribe-Post` on marketing email);
  - a manual entry by `ORG_ADMIN`.
- **Vendor-side lists are not a source.** Brevo is send-only: no contact records and no manual blocks (OWN-15, PL2-D-65). `EmailPort.suppress` is called only where an adapter supports it, and only to mirror this list, never to read back from it.
- **What a hit blocks.** A platform-scope `hard_bounce` or `complaint` blocks every class on that channel and address except `security` classes on another channel. A marketing opt-out blocks only `marketing` classes.
- **Lifting.** An entry can be lifted only by an R2 maker-checker request. Lifting re-enables sending to a person who complained, so it gets a checker (A-08).
- **Address key** _(owner, PL3-D-05)_: `address_hash` is **HMAC-SHA-256 (C-23)** of the normalised address (lower-cased email; E.164 phone) with the platform **group consent key**: one key per environment, held through KMS/SECRETS and shared with the products so a withdrawal is joinable group-wide. It is used from the first migration, while the lists are empty. The table stays CONFIDENTIAL with RLS, never exported or logged. The Ecosystem `principal_hash` is still unkeyed SHA-256 on the wire; NOTIFY computes it only at the event boundary and never stores it, and platform request PR-018 asks for the keyed form.
- **Retention.** Entries are kept while active, plus the audit retention after `lifted_at`. Changing that is locked (#13).

### 6.6 Marketing consent before the CONSENT port (Ecosystem §6.39, IPB-02-26)

- **Table `notify.marketing_consent`.** `(tenant_id, principal_hash` (keyed, C-23)`, purpose, brand_pack_id)` → `state` (GRANTED or WITHDRAWN), `consentref`, `notice_version`, `updated_at`.
- **Consuming.** NOTIFY consumes `MarketingConsentUpdated` and must stop marketing within 60 s. A test asserts the withdrawal is applied before the next send.
- **Emitting.** NOTIFY emits `MarketingConsentUpdated` with `state = WITHDRAWN` on unsubscribe, SMS STOP and WhatsApp STOP (`channel`: EMAIL_LINK, SMS_STOP or WHATSAPP_STOP).
- **Default.** A marketing class with no GRANTED record is not sent (default deny).
- **Replacement.** When PL5 ships the CONSENT port, this table becomes a read model fed by it, and the event contract stays the same.
- **Preference sync.** `ntf.*` maps to the Ecosystem `notif.*` keys in `UserPreferencesSynced` at the event boundary only (Ecosystem prevails for events).

### 6.7 Channels

| Channel  | Port                                | Notes                                                                                                                                                                                                                       |
| -------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| in-app   | none (table `notify.inapp_message`) | Read by the PL5 shell via API. Title INTERNAL, body fetched by deep link                                                                                                                                                    |
| email    | EMAIL (`ses`, `brevo`)              | Marketing gets `List-Unsubscribe` and a one-click POST link (random one-time token stored server-side and revocable, _owner, PL3-D-06_). Accessible HTML with a text part (IPB-06-27)                                       |
| SMS      | SMS (`msg91`, `gupshup-sms`)        | DLT template from the catalogue; live SMS only after DLT registration (PL2-D-17)                                                                                                                                            |
| WhatsApp | WHATSAPP (`gupshup`, `meta-cloud`)  | Utility and authentication only while `mkt.meta.enabled` is false; never for collections or legal notices                                                                                                                   |
| push     | **PUSH (new port)**                 | Interface per IPB-01: `register`, `send`, `sendTopic`, `unregister`. Reference `expo`, alternative `fcm`, both on stubs and `unproven` (they need Expo and Firebase accounts, #14). A memory fake is the second alternative |

- The PUSH payload guard refuses anything beyond `title`, `deepLink` and an INTERNAL `data` map.
- Device tokens live in `notify.device_token`: `token_enc` sealed with FieldCrypto plus a lookup digest, `platform`, `user_id`, `last_seen_at`.

### 6.8 Data model (`notify/0001_init.sql`)

- `notification` (`ntf_…`: class, tenant, idempotency key unique, dedupe window 24 h, deep link, created_by);
- `delivery` (`dlv_…`: notification, recipient ref, channel, state `queued|sent|delivered|failed|held|suppressed|killed|digested`, attempt, vendor ref, adapter, last error code, resend class);
- `digest_entry`;
- `inapp_message`;
- `suppression`;
- `marketing_consent`;
- `device_token`;
- `unsubscribe_token` (one-time, 90 days).

Inbound delivery reports reuse the PL2 `acceptWebhook` (verify, inbox dedupe, async via QUEUE, 2xx within 2 s).

## 7. EXPORT (`@infrabyx/export`)

### 7.1 Export maps (IPB-09 §09.4.7.1)

- **Location and schema.** `packages/export/maps/<PRODUCT>-EXPORT-<major.minor>.json`, using the IPB-09 format (`map_version`, `entities`, `manifest`, `normalisers`), schema in `contracts`.
- **Products.** Each product ships its own map in its repository and registers it with `registerExportMap`.
- **Reference map.** The platform repository has no product entities, so it ships `REF-EXPORT-1.0` for `apps/reference` and the `demo` seed. It covers tenants, legal entities, users and memberships, settings, approvals, the audit ledger slice, notifications and inbox items (A-09).
- **Bump rules.**
  - `files` and `fields` changes bump `map_version`: minor for an addition, major for a removal or rename.
  - `views` changes never bump.
  - Both maps are emitted during the 90-day dual run (`eng.export.dual_run_days`, floor 90).

### 7.2 Archive writer (Ecosystem §12.1 profile `archive_standard_version` 1.0)

- **Layout.**
  - Root: `[Owner legal name] - [Product] Archive - [scope] - as of [YYYY-MM-DD]/`.
  - `00 Start Here/` holds `README.txt` and `README.md`, `export-manifest.csv`, `manifest.json`, `data-dictionary.csv`, `relationships.csv`, `code-tables/`, `schemas/` (JSON Schema 2020-12) and `verify/`, an offline verifier script under Apache-2.0.
- **Datasets.** `[dataset].csv`:
  - UTF-8 with BOM, ISO 8601 with time zone;
  - amounts as fixed 2-decimal strings with a `currency` column;
  - code plus label columns.
  - Each dataset also has `.schema.json` and optional `.jsonl`.
  - **No XLSX in PL3** _(owner, PL3-D-12)_: `exceljs` fails the licence allow-list (`buffers@0.1.1` has no licence), so XLSX waits for `docgen`.
- **Original documents** keep their bytes. The SHA-256 must equal the producer's hash.
- **Audit trail.** `audit-events.jsonl` per month, verifiable offline with the PL1 chain verifier logic, which is copied into `verify/`.
- **Naming.** Windows-safe and NFC, path ≤ 240 characters, and **no personal data in any file or folder name** (`ids_only`).
- **`manifest.json`:**
  - `archive_id` (ULID), `folder_profile`, producer and release, tenant, scope, requester, approvers, `as_of`;
  - `control_totals`, reconciled to the live system at the snapshot instant (a difference fails the job);
  - `predecessor_archive_id`;
  - a pack-level SHA-256 over the sorted file list.
- **Signing (C-22)** _(owner, PL3-D-06)_: the writer produces the detached JWS `manifest.json.jws` (RFC 7515 Appendix F, ES256) over `manifest.json`, signed through KMS `sign` with the platform export-signing key (`kid` = KMS key id). The README says how to verify it offline, and `verify/` checks it as well as the hashes.
- **Restricted folders** (HR, privileged legal, collections and recovery: encrypted ZIPs with a second approver) stay **refused** with `IPB-RES-001` until a product needs them _(owner, PL3-D-06)_. Aadhaar and card data are never exported.

### 7.3 Jobs and API

- **Table `export.export_job`:** `exj_…`, scope (DATASET, LEGAL_ENTITY, MODULE, AUDIT_PACK, FULL_TENANT), requester, state, `archive_id`, bytes, file count, manifest hash.
- **Table `export.archive`:** Ecosystem entity 40.
- **Lifecycle.**
  - Jobs run on QUEUE and write to STORAGE in the `EXPORT` bucket class; downloads use a presigned URL.
  - Each download records its SHA-256 in the ledger, and re-downloading the same version gives the same hash (IPB-09-37).
  - `ExportRequested` and `ExportCompleted` are emitted. Payloads describe the job, never its content. `ExportCompleted` is signed as the Ecosystem spec requires: a detached JWS (C-22) over the JCS (RFC 8785) form of the CloudEvent without its signature attribute (Ecosystem §3 regulated messages; RFC 9421 in transit arrives with outbound delivery) _(owner, PL3-D-06)_.
- **Policy.**
  - Tenant export is always available to `ORG_OWNER` (R0; IPB-02-18, 02-82). The `trust.export.enabled` setting is locked true.
  - Rate limit `api.export`: 5 concurrent and 20 a day per principal, counted in PostgreSQL until a CACHE port exists. Exports are rate-limited, never blocked.
  - Export of a full dataset to a **new destination** is the delay-window action of IPB-07-27(c). It goes through `workflow` scheduled actions with the risk class the spec gives. No new destination connector (`StorageTarget`) is built in PL3, so the path exists but has no destination yet.

### 7.4 CI gates (IPB-09-34/35, `@IPB-09-AT-14`, `@IPB-09-AT-15`)

**`export-map-gate`** (`infrabyx-export map-gate`). The check fails with `IPB-ENG-006` when either:

- a migration changes a table or column named in a map's `entities.*.source` or `fields`; or
- `packages/export/**` changes;

unless one of these comes with it:

- the map's `map_version` is bumped in the same PR, with a changeset line `export_map: <version>`; or
- the PR carries the `export:unchanged` attestation label. CODEOWNERS routes it to `PLT_RELEASE_MANAGER` (IPB-09-06).

**`golden-archive-diff`** (`infrabyx-export diff --golden <release> --normalise`):

- CI seeds `tnt_demo` with `eng.seed.demo_date_anchor` pinned, exports with `REF-EXPORT-1.0` and diffs byte for byte against the golden archive of the last release.
- The normalisers replace run-time timestamps, job and archive IDs and ZIP entry times. Fonts do not apply in PL3, since there is no PDF yet.
- Any difference fails with `IPB-ENG-007` unless a map bump with a customer note is in the PR.
- **Storage.** The golden archive is a committed fixture under `packages/export/golden/<release>/`, synthetic data only. The AUDIT bucket with Object Lock is used once the AWS sandbox exists (A-10).

Both checks join `ci.yml` `verify` and the required-check list. Both run only when export, a map or a migration changes; docs-only PRs skip them.

## 8. ESIGN (owner decision D-09; IPB-DEV-07)

- **Port interface** per IPB-01 ESIGN, in `contracts/ports/esign.ts`:
  - create a signing request, get its status, download the signed document, cancel, verify a webhook;
  - signature types Aadhaar eSign, DSC and electronic, never silently downgraded (a downgrade needs signer consent and a RULES legal-sufficiency rule).
- **Adapters** _(owner, PL3-D-04)_: `leegality` (interim reference) and `digio` (alternative), both on vendor stubs, test mode only and `unproven`. Their sandbox legs need vendor test accounts, so they get `port-contract` issues at the PL3 gate.
- **Interface** as IPB-01 names it: `createEnvelope`, `sendForSignature`, `getStatus`, `downloadSigned`, `aadhaarEsign`, `dscSign`, `verifySignature`, `handleWebhook`.
- **Webhooks are untrusted triggers** (PL3-D-15, #19): Leegality's `mac` is HMAC-SHA1, which is not an approved C-item, and no Digio signature scheme was found, so the adapter acts only on the status it reads back from the vendor API.
- **Risk class.** "sign" is R3: an agent may be the maker only, with per-action human confirmation (IPB-02 §02.4.6.1).
- **Documents** travel by reference (`document_id`, `sha256`) and are never inline. Inbound webhook signatures use the vendor scheme inside the adapter. If a vendor's scheme needs a new primitive, the adapter waits for the owner (C-items).
- **Sequencing.** ESIGN is the last build session _(owner, PL3-D-04)_.

## 9. Owner decisions already given for PL3

### 9.1 Resend classes (PL2-D-65 (1))

Implemented as section 6.4:

- **safe to resend** (OTPs, login and security alerts, receipts): resent once;
- **hold for review** (collections, recovery, legal and demand notices, KFS and loan-term communications): a person confirms;
- **default** for an unclassified type: hold.

The catalogue lint makes `resend` a required field, so "unclassified" can only arise from data written outside the catalogue. Such a type is still held.

### 9.2 Platform suppression list (PL2-D-65 (3))

Implemented as section 6.5. The platform table is the single source of truth. Brevo stays send-only, with no contact records and no manual blocks (OWN-15). Vendor lists are mirrored from it where an adapter supports that, never read back.

### 9.3 Gupshup interim conditions (PL2-D-65 (2))

These stay as built in PL2, and NOTIFY relies on them:

- ≥ 32-byte rotated `ipb_token`;
- scrubbed query strings;
- status confirmed before a state-changing event.

NOTIFY marks a Gupshup delivery `delivered` only from a confirmed event.

### 9.4 Support token (PL2-D-55)

**No work in PL3.** Impersonation stays off on both IdPs. The support token is built in the phase where a product first needs support access, with these properties:

- issued by the platform independently of the IdP, after an approved request with a ticket reference;
- read-only under `IPB-SEC-003`;
- valid for at most 60 minutes;
- ledgered and visible to the tenant's `ORG_OWNER`.

PL3 only makes that later work cheap: `workflow` gives it the approval request and inbox item it will use. Token signing goes through that phase's cryptography review.

### 9.5 Cryptography items approved for PL3

| Item     | Use                                       | Choice                                                                                                                                                                                                                                                                               |
| -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C-22** | Export manifest and `ExportCompleted`     | Detached JWS (RFC 7515 Appendix F), ES256 through KMS `sign` (C-14 `ECC_NIST_P256`, `ECDSA_SHA_256`, DIGEST); one platform export-signing key per environment; `kid` = KMS key id; payload = the manifest bytes, or JCS (RFC 8785) of the CloudEvent without its signature attribute |
| **C-23** | Suppression and marketing-consent address | HMAC-SHA-256 of the normalised address (lower-cased email; E.164 phone) with the group consent key, one per environment, read through SECRETS (wrapped by KMS) and shared with the products; full 64-hex output; computed only in `@infrabyx/crypto`                                 |

| **C-24** | FCM OAuth service-account assertion | RS256 (RSASSA-PKCS1-v1_5, SHA-256) **only** to sign the Google service-account JWT that FCM HTTP v1's OAuth 2.0 token exchange requires; never for platform tokens (C-12 ES256 stays the rule). Key read through SECRETS; signed in `@infrabyx/crypto` with `node:crypto`; key and assertion never logged; access token cached until 5 minutes before expiry; keyless workload identity federation preferred once the platform runs on a cloud that supports it |
| **C-25** | Leegality webhook verification | HMAC-SHA1 **verification only**, for Leegality webhooks and nothing else: constant-time comparison over the signed bytes, a timestamp or replay window where Leegality sends one, and the document status read back from the Leegality API before any state change; switch to SHA-256 signing if Leegality offers it once the test account exists |

All four are owner-approved (PL3-D-05, PL3-D-06, PL3-C-01, PL3-C-02). C-24 is built with the `fcm` adapter (session 4) and C-25 with the `leegality` adapter (session 6).

## 10. Contracts additions

- **Ports:** RULES, NOTIFY, PUSH, ESIGN. The catalogue gets `interfaceDefined: true` for each.
- **Contracts:** `HumanQueue`; the notification catalogue schema; export map and `archive_manifest_v1` schemas.
- **ID prefixes:** `rls`, `dcs`, `sca`, `ibx`, `ntf`, `dlv`, `sup`, `exj`, `arc`, `esr`.
- **Events:**
  - `in.<product>.rules.RuleSetPublished.v1`;
  - `in.<product>.ntf.NotificationDigestSent.v1` and `NotificationHeld.v1`;
  - `in.<product>.inbox.ItemCreated.v1` and `ItemResolved.v1` (already named in IPB-07);
  - the Ecosystem `MarketingConsentUpdated`, `ExportRequested` and `ExportCompleted` payload types;
  - `in.<product>.eng.ExportMapBumped.v1` and `GoldenArchiveDrift.v1`.
- **Error codes:**
  - within the existing `IPB-NTF` area: `IPB-NTF-002` (unknown notification class), `-003` (no deliverable channel after preferences, consent and suppression), `-004` (channel killed), `-005` (resend held for review), `-006` (push payload beyond title and deep link);
  - rules and export runtime errors use `IPB-PORT-*` and `IPB-RES-001` for now. Platform request **PR-017** asks the IPB editor to add `IPB-RULE` and `IPB-EXP` areas, because the Ecosystem §3.12 area list has neither.

## 11. Config additions

**Settings:**

- `rules.engine` (`zen` | `json-rules`, default `zen`);
- `rules.cel.max_cost` (default 10 000, A-11);
- `rules.eval.timeout_ms` (50);
- `rules.publish.requires_checker` (true, locked);
- `workflow.timers.engine` (`temporal` | `pg`);
- `int.push.provider`, `int.push.fcm_project_id`, `int.push.apns_topic`;
- `int.notify.dedupe_window_h` (24);
- `eng.export.map_version`, `eng.export.dual_run_days` (90, floor 90, maker-checker);
- `eng.export.font_drift_allowed` (false).

**Flags:** `kill.msg.email`, `kill.msg.sms`, `kill.msg.whatsapp`, `kill.msg.push`, `kill.msg.inapp`.

**Maker-checker tenant keys** _(owner, PL3-D-08)_: ORG tier, governed (each change is itself maker-checker), tighten-only. The validator refuses any value that loosens the platform floor:

- `mc.extra_actions` adds actions to maker-checker and can never remove one from the platform floor (`RISK_POLICY`);
- `mc.amount_threshold.<action>` (minor units) can only be lowered;
- `mc.dual_checker_above.<action>` (minor units): above it, two distinct checkers;
- `mc.checker_roles.<action>` is a subset of the action's allowed checker roles;
- `mc.reminder_hours` (1–24) can only shorten the 24 h reminder.

`workflow.approvals.remind_after_h` is dropped: the 24 h reminder is platform policy, and tenants shorten it through `mc.reminder_hours`.

## 12. Acceptance tests and exit gate

**Acceptance tests:**

| Test                                                                                                   | Where                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `@IPB-07-AT-11` deterministic NBA (backend)                                                            | rules: `evaluate` + `explain` return `rule_id` `fbx.los.nba.sanction_ready` and its reason; an AI source cannot produce an "approve" decision |
| `@IPB-07-AT-06` maker-checker on organisation settings                                                 | workflow + config: diff stored, value unchanged until an ORG_CHECKER who is not the maker approves, ledger in the same transactions           |
| `@IPB-07-AT-07` typed confirmation and delay window                                                    | workflow: scheduled action, `IPB-UX-005` early, owner cancel, inbox item                                                                      |
| `@IPB-07-AT-09` bulk confirm (backend)                                                                 | workflow `decideMany`, `IPB-UX-006`                                                                                                           |
| `@IPB-07-AT-10` Work Inbox (backend)                                                                   | five sources in a fixture, badge count 5, suggestion labelled AI                                                                              |
| `@IPB-07-AT-22` digest-first and quiet hours                                                           | notify: mention at 22:15 held to the 08:30 digest; approval request sent at once; `IPB-NTF-001`                                               |
| `@IPB-02-AT-10/11/12`                                                                                  | re-run through the workflow wrappers and timers                                                                                               |
| `@IPB-02-AT-20` pattern                                                                                | `kill.msg.*` at NOTIFY                                                                                                                        |
| `@IPB-09-AT-14` export map gate                                                                        | export CLI on a fixture PR                                                                                                                    |
| `@IPB-09-AT-15` golden archive                                                                         | (a) refactor does not change downloads; (b) folder deletion leaves document and hash unchanged                                                |
| `@IPB-01-15/16/17/18`, `@IPB-01-AT-04/13/19`                                                           | RULES, PUSH, ESIGN contract suites, vendor-import, health, no `process.env`                                                                   |
| `@IPB-10-27`                                                                                           | push and esign webhooks; email, SMS and WhatsApp delivery reports into NOTIFY                                                                 |
| `@NN-01/02/45`                                                                                         | with the four new schemas                                                                                                                     |
| PL3-specific: resend classes, suppression, consent 60 s, never-WhatsApp for collections, payload guard | notify unit and integration tests, tagged `@PL3-NTF-*`                                                                                        |

**Exit gate.** Same shape as PL2 gate A; no gate B except for the new SaaS adapters:

- [ ] All IPB-09 required checks green, including `export-map-gate` and `golden-archive-diff`
- [ ] RULES (`zen`, `json-rules`), PUSH (`expo`, `fcm`) and ESIGN (`leegality`, `digio`) hermetic legs green. Each SaaS adapter without a sandbox account has a `port-contract` issue and is `unproven`
- [ ] Acceptance tests above present by tag and passing; `at-report` lists them
- [ ] Migrations `tenancy/0002`, `rules/0001`, `workflow/0001`, `notify/0001`, `export/0001` pass migration-lint and rls-lint
- [ ] Threat model updated (four packages, PUSH and ESIGN adapters, the export data flow, the suppression hash)
- [ ] Changesets: four packages at 0.1.0 (publishable); minors for contracts, config, testing, connectors, tenancy
- [ ] STATUS, DECISIONS, OWNER-QUESTIONS and platform-requests updated; gate report `docs/phases/PL3-gate.md`
- [ ] Published through the version PR and `release.yml`

**Sessions** (one PR each, D-11 style):

| Session | Work                                                                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Spike on every [VERIFY]: ZEN prebuilds on Node 24.22.1, CEL library, XLSX library, Expo, FCM, Leegality and Digio API shapes from official SDKs. Contracts (ports, schemas, IDs, events, errors) and config keys |
| 2       | `rules` package + `zen` and `json-rules` adapters                                                                                                                                                                |
| 3       | `workflow` (scheduled actions, timers on both engines, Work Inbox, HumanQueue, reminders, bulk, RefundApprovals) and `tenancy/0002`                                                                              |
| 4       | `notify` (catalogue and lint, routing, quiet hours, digest, resend classes, suppression, consent, in-app) + PUSH adapters                                                                                        |
| 5       | `export` (maps, archive writer, jobs, CLIs, CI gates, golden fixture)                                                                                                                                            |
| 6       | ESIGN adapters (#7)                                                                                                                                                                                              |
| 7       | Exit gate and release                                                                                                                                                                                            |

## 13. Assumptions and owner questions

**Assumptions** (logged as `PL3-D-nn` when implemented, as in PL2):

- A-01 rule engines in `connectors`;
- A-02 publish at R4;
- A-03 kill-switch safe state "kill on" for every class (PL1 rule);
- A-04 `PLT_SECURITY_OFFICER` may cancel;
- A-05 24 h reminders;
- A-06 the NOTIFY interface;
- A-07 time-zone order;
- A-08 lifting a suppression is R2;
- A-09 the `REF-EXPORT-1.0` map;
- A-10 the golden archive as a committed fixture;
- A-11 CEL cost 10 000.

**Owner questions** (recorded in `docs/OWNER-QUESTIONS.md`, default taken, work continues):

| #   | Question                                                                                                                                                                            | Default taken                                                                                                                            | Locked list?                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 7   | ESIGN stays in PL3 (D-09) although IPB-14's PL3 row lists four packages?                                                                                                            | Keep it in PL3 as the last build session                                                                                                 | Changing D-09 would be             |
| 8   | Suppression and consent key: Ecosystem `principal_hash` (unkeyed SHA-256) or a keyed HMAC?                                                                                          | Ecosystem `principal_hash`, table CONFIDENTIAL with RLS                                                                                  | Cryptography if HMAC               |
| 9   | Export manifest signing (detached JWS, key type and custody via KMS `sign`), signed `ExportCompleted`, restricted-folder encrypted ZIPs, and the signed one-click unsubscribe token | Manifest unsigned (hashes only), restricted folders refused, unsubscribe token is a random one-time ID stored server-side (no signature) | **Yes**: blocked items parked      |
| 10  | Approval expiry, escalation and timeouts for maker-checker requests                                                                                                                 | None: requests stay pending; reminders only                                                                                              | **Yes**: approval policy           |
| 11  | The tenant `mc.*` maker-checker policy keys (which actions, thresholds, segregation)                                                                                                | Not registered; code-level `RISK_POLICY` only                                                                                            | **Yes**: approval policy           |
| 12  | Risk class for publishing a rule set (R2 publish or R4 policy change)                                                                                                               | R4 (stricter, 1 h delay)                                                                                                                 | Approval policy (stricter default) |
| 13  | Retention of the decision log, deliveries, suppression entries and export archives                                                                                                  | Audit retention class defaults; nothing shortened                                                                                        | **Yes**: retention                 |
| 14  | Expo and Firebase accounts for the PUSH sandbox legs                                                                                                                                | Adapters on stubs, `unproven`                                                                                                            | **Yes**: external accounts         |
| 15  | XLSX in archives before docgen exists                                                                                                                                               | Only if a pinned library passes the licence allow-list; else CSV only                                                                    | No                                 |
| 16  | Should mandatory classes (security alerts, maker-checker requests) bypass `kill.msg.<channel>` when the flag provider is unreachable and no snapshot exists?                        | No: PL1 safe state "kill on" for every class; in-app stays the fallback only if `kill.msg.inapp` is off                                  | **Yes**: weakens an IPB-02 control |

**All answered on 27 Oct 2026** (PL3-D-04 to PL3-D-14): #7 ESIGN stays; #8 keyed HMAC (C-23); #9 manifest and event signing (C-22), restricted refused, random unsubscribe token; #10 expiry with reminder and escalation; #11 tighten-only `mc.*`; #12 R4; #13 defaults; #14 owner task; #15 no XLSX (licence); #16 no bypass, persisted snapshot and alert. New: #18 FCM token minting, #19 Leegality HMAC-SHA1, #20 snapshot age (defaults in use, nothing blocked).

## 14. Risks

| ID    | Risk                                                                    | Mitigation                                                                                                       |
| ----- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| R3-01 | ZEN's native binary has no Node 24 prebuild or fails the 7-day rule     | Spike in session 1; `json-rules` becomes the reference until it passes (assumption logged)                       |
| R3-02 | Quiet hours and digests across time zones and DST                       | Time computed with `Intl` and an injected clock; tests at DST edges for non-Indian time zones                    |
| R3-03 | A hold-for-review class sent twice through a path outside NOTIFY        | Adapters stay at-least-once only for direct calls; the threat model notes that products must send through NOTIFY |
| R3-04 | Golden-archive drift from library updates (CSV quoting, JSON key order) | Canonical writers with sorted keys; Renovate PRs touching export run the diff                                    |
| R3-05 | Address hashes in the suppression list                                  | Keyed HMAC (C-23, PL3-D-05); CONFIDENTIAL with RLS, never exported or logged                                     |
| R3-06 | Export-signing key misuse                                               | KMS `sign` only, one purpose-bound key (C-22); verification offline from the README                              |
