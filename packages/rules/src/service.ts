// RULES service (IPB-01 RULES; PL3 plan §4.3–4.4, PL3-D-18): rule sets as data, versioned and
// immutable once published; publish through maker-checker at R4 (PL3-D-09); evaluation with a
// decision log; simulation; explain. A decision never defaults to allow: an invalid input, an
// engine error or timeout, or a `verify` row driving a statutory output is UNDETERMINED and goes to
// a human queue.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  HumanQueue,
  InboxItemInput,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { DataClass } from "@infrabyx/contracts/data-class";
import type {
  AdapterDescriptor,
  CelResult,
  RuleParameter,
  CompiledRuleSet,
  Decision,
  DecisionOutcome,
  Explanation,
  PortHealth,
  PublishOptions,
  RuleEngine,
  RuleSetBody,
  RuleSetRef,
  RuleSetSummary,
  RulesPort,
  SimulationReport,
} from "@infrabyx/contracts/ports";
import { RuleSetKey, ruleParameterValueError } from "@infrabyx/contracts/ports";
import { PRODUCT_ROLE_REGEX, TENANT_ROLES } from "@infrabyx/contracts/roles";
import { internalEvent } from "@infrabyx/config/events";
import { canonicalDigest, newId, type SecretKey } from "@infrabyx/crypto";
import {
  APPROVAL_ESCALATION_HOURS,
  DEFAULT_PLATFORM_CHECKERS,
  DEFAULT_TENANT_CHECKERS,
  NotFoundError,
  tenantHasRoleHolder,
  type ApprovalsEngine,
  type FieldCrypto,
} from "@infrabyx/tenancy";
import {
  evaluateCel,
  ruleEngine,
  RuleCompileError,
  RULE_ENGINES,
  type InProcessRuleEngine,
  type RuleEngineName,
} from "@infrabyx/connectors/rules";

export const PUBLISH_ACTION = "rules.ruleset.publish";
/** How far ahead a cut-over may be scheduled (PR-LDC-34). */
export const MAX_CUTOVER_DAYS = 366;
/** Most inputs one simulation may run (PL3 plan §4.4). */
export const MAX_SIMULATION_INPUTS = 1000;
const CACHE_SIZE = 256;
/** Prefixes a product's publish checker role may never carry (R1-D-86). */
const NON_TENANT_ROLE = /^(PLT|AGT|SVC|OPS)_/;

/** Reads the tenant's value of a parameter's setting (a `SettingsService` fits). */
export interface RuleParameterSettings {
  explain(ctx: KernelContext, key: string): Promise<{ value: unknown }>;
}
const CLEAR_CLASSES: readonly DataClass[] = ["PUBLIC", "INTERNAL"];
const CLASS_RANK: Record<DataClass, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  REGULATED: 3,
  SECRET: 4,
};

export interface RulesServiceOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The tenancy engine; the service registers `rules.ruleset.publish` on it. */
  approvals: ApprovalsEngine;
  /** Product code for event types (`in.<product>.rules.RuleSetPublished.v1`). */
  product: string;
  /** `rules.engine` (default `zen`). */
  engine?: RuleEngineName;
  /** `rules.cel.max_cost`: the most AST nodes in one CEL expression (default 10 000). */
  celMaxCost?: number;
  /** `rules.eval.timeout_ms` (default 50). */
  evalTimeoutMs?: number;
  /** Override the engine adapters (tests). Drafts compile on every validator. */
  engines?: { primary: InProcessRuleEngine; validators?: readonly RuleEngine[] };
  outbox?: OutboxWriter;
  /** Seals decision-log inputs above INTERNAL. Required when a rule set has such inputs. */
  fieldCrypto?: FieldCrypto;
  /** Work Inbox for UNDETERMINED decisions (implemented by `@infrabyx/workflow`). */
  humanQueue?: HumanQueue;
  /**
   * Who reviews an UNDETERMINED decision. Default (OWNER-QUESTIONS #21, PL3-D-21): the tenant's
   * ORG_CHECKER role, or ORG_ADMIN when no member holds ORG_CHECKER (`hasRoleHolder`).
   */
  undeterminedAssignee?: InboxItemInput["assignee"];
  /** Whether a member of the tenant holds the role (default: `tenancy.membership`). */
  hasRoleHolder?: (tx: Tx, role: string) => Promise<boolean>;
  pseudonymKey?: SecretKey;
  /**
   * Where parameter values come from (R1-D-88): the product's `SettingsService`, whose registry
   * holds each parameter's `setting` key. Required when a rule set declares parameters.
   */
  settings?: RuleParameterSettings;
  /**
   * The product's own tenant roles that may also check `rules.ruleset.publish` (OWNER-QUESTIONS
   * #109, R1-D-86), beside ORG_CHECKER, ORG_ADMIN and ORG_OWNER; e.g. `["TEN_CCO", "TEN_ADMIN"]`.
   * Platform, agent, service and operations roles are refused. Maker ≠ checker is unchanged.
   */
  publishCheckerRoles?: readonly string[];
}

interface VersionRow {
  rule_set_id: string;
  version: number;
  tenant_id: string;
  state: "draft" | "pending_approval" | "published" | "retired";
  body: RuleSetBody;
  digest: string;
  approval_id: string | null;
  effective_from: Date | null;
}

interface ResolvedParameters {
  values: Record<string, unknown>;
  trace: Record<string, { value: unknown; source: "setting" | "default" }>;
  /** The first parameter whose value is invalid, if any. */
  invalid: string | null;
}

interface RuleSetRow {
  id: string;
  tenant_id: string;
  key: string;
  owner_module: string;
  data_class: DataClass;
  purpose?: "decision" | "projection";
}

/** At most this many inputs in one `project` call. */
export const RULES_PROJECT_MAX_INPUTS = 1000;

/** One projected result: the outcome only, never a decision id (PR-LDC-49). */
export interface Projection {
  outcome: DecisionOutcome;
  outputs: Record<string, unknown>;
  reason: string;
}

interface Evaluated {
  outcome: DecisionOutcome;
  outputs: Record<string, unknown>;
  ruleIds: string[];
  reason: string;
}

export class RulesService implements RulesPort {
  private readonly o: RulesServiceOptions;
  private readonly primary: InProcessRuleEngine;
  private readonly validators: readonly RuleEngine[];
  private readonly timeoutMs: number;
  private readonly celMaxCost: number;
  private readonly cache = new Map<string, Promise<CompiledRuleSet>>();

  constructor(opts: RulesServiceOptions) {
    this.o = opts;
    this.celMaxCost = opts.celMaxCost ?? 10_000;
    this.timeoutMs = opts.evalTimeoutMs ?? 50;
    const limits = { maxAstNodes: this.celMaxCost };
    this.primary = opts.engines?.primary ?? ruleEngine(opts.engine ?? "zen", { limits });
    this.validators =
      opts.engines?.validators ??
      RULE_ENGINES.map((n) => (n === this.primary.name ? this.primary : ruleEngine(n, { limits })));
    const extra = opts.publishCheckerRoles ?? [];
    for (const r of extra)
      if (
        NON_TENANT_ROLE.test(r) ||
        !((TENANT_ROLES as readonly string[]).includes(r) || PRODUCT_ROLE_REGEX.test(r))
      )
        throw new Error(`publishCheckerRoles: ${r} is not a tenant or product role`);
    opts.approvals.register(PUBLISH_ACTION, {
      ...(extra.length
        ? {
            checkerRoles: [...new Set([...DEFAULT_TENANT_CHECKERS, ...extra])],
            platformCheckerRoles: DEFAULT_PLATFORM_CHECKERS,
          }
        : {}),
      execute: (tx, payload, request) => this.executePublish(tx, payload, request.id),
    });
  }

  get descriptor(): AdapterDescriptor {
    return this.primary.descriptor;
  }

  health(): Promise<PortHealth> {
    return this.primary.health();
  }

  /** Create a rule set in the caller's tenant (platform sets: a platform context in `tnt_platform`). */
  async createRuleSet(
    ctx: KernelContext,
    input: {
      key: string;
      ownerModule: string;
      dataClass?: DataClass;
      /**
       * `projection` (PR-LDC-49): evaluated only by `project`, which records nothing. Fixed at
       * creation; default `decision`, evaluated only by `evaluate`, which always records.
       */
      purpose?: "decision" | "projection";
    },
  ): Promise<{ ruleSetId: string }> {
    const purpose = input.purpose ?? "decision";
    if (purpose !== "decision" && purpose !== "projection")
      throw new IpbError("IPB-RULE-001", { detail: "purpose is decision or projection" });
    if (!RuleSetKey.safeParse(input.key).success)
      throw new IpbError("IPB-RULE-001", { detail: "rule set key must be dotted lower case" });
    const cls = input.dataClass ?? "INTERNAL";
    if (cls === "SECRET")
      throw new IpbError("IPB-RULE-001", { detail: "SECRET never enters rules" });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("rls");
        await tx.query(
          `insert into rules.rule_set (id, tenant_id, key, owner_module, data_class, created_by, purpose)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [id, ctx.tenantId, input.key, input.ownerModule, cls, ctx.principal.id, purpose],
        );
        await this.o.audit.record(tx, {
          action: "rules.ruleset.create",
          resourceType: "rule_set",
          resourceId: id,
          after: {
            key: input.key,
            owner_module: input.ownerModule,
            data_class: cls,
            ...(purpose === "projection" ? { purpose } : {}),
          },
        });
        return { ruleSetId: id };
      },
      { action: "rules.ruleset.create" },
    );
  }

  /**
   * Save the open draft (or open a new one). The body is compiled on every engine first, so a
   * draft that one engine cannot run is refused (IPB-RULE-001).
   */
  async saveDraft(
    ctx: KernelContext,
    ruleSetId: string,
    body: RuleSetBody,
  ): Promise<{ version: number; digest: string }> {
    const set = await this.o.kernel.read(ctx, (tx) => this.loadSet(tx, ruleSetId));
    await this.validate(body, set);
    await this.checkParameterSettings(ctx, body);
    const digest = canonicalDigest(body);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const open = await tx.query<VersionRow>(
          `select * from rules.rule_set_version
            where rule_set_id = $1 and state in ('draft', 'pending_approval') for update`,
          [ruleSetId],
        );
        const cur = open.rows[0];
        if (cur?.state === "pending_approval")
          throw new IpbError("IPB-RULE-003", {
            detail: `version ${cur.version} is pending approval`,
            meta: { rule_set_id: ruleSetId, version: cur.version },
          });
        let version: number;
        if (cur) {
          version = cur.version;
          await tx.query(
            `update rules.rule_set_version set body = $3::jsonb, digest = $4
              where rule_set_id = $1 and version = $2`,
            [ruleSetId, version, JSON.stringify(body), digest],
          );
        } else {
          const max = await tx.query<{ v: number | null }>(
            "select max(version) as v from rules.rule_set_version where rule_set_id = $1",
            [ruleSetId],
          );
          version = (max.rows[0]?.v ?? 0) + 1;
          await tx.query(
            `insert into rules.rule_set_version
               (rule_set_id, version, tenant_id, state, body, digest, created_by)
             values ($1, $2, $3, 'draft', $4::jsonb, $5, $6)`,
            [ruleSetId, version, ctx.tenantId, JSON.stringify(body), digest, ctx.principal.id],
          );
        }
        await this.o.audit.record(tx, {
          action: "rules.ruleset.draft",
          resourceType: "rule_set_version",
          resourceId: `${ruleSetId}@${version}`,
          before: cur ? { digest: cur.digest } : undefined,
          after: { digest, rows: body.rows.length },
        });
        return { version, digest };
      },
      { action: "rules.ruleset.draft" },
    );
  }

  /** Submit a draft for publication: an R4 approval request with `{ ruleSetId, version, digest }`. */
  async publish(
    ctx: KernelContext,
    ruleSetId: string,
    version: number,
    opts: PublishOptions = {},
  ): Promise<{ approvalId: string }> {
    const effectiveFrom =
      opts.effectiveFrom === undefined ? null : cutoverInstant(opts.effectiveFrom);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const set = await this.loadSet(tx, ruleSetId);
        const v = await this.loadVersion(tx, ruleSetId, version, true);
        if (v.state !== "draft")
          throw new IpbError("IPB-RULE-003", {
            detail: `version ${version} is ${v.state}`,
            meta: { rule_set_id: ruleSetId, version },
          });
        if (effectiveFrom) {
          const w = await tx.query<{ ok: boolean }>(
            `select $1::timestamptz >= now() and $1::timestamptz <= now() + make_interval(days => $2) as ok`,
            [effectiveFrom, MAX_CUTOVER_DAYS],
          );
          if (!w.rows[0]?.ok)
            throw new IpbError("IPB-RULE-001", {
              detail: `effectiveFrom must be now or later, at most ${MAX_CUTOVER_DAYS} days ahead`,
            });
        }
        await this.refuseScheduled(tx, ruleSetId);
        const current = await this.publishedRow(tx, ruleSetId);
        const { id } = await this.o.approvals.request(tx, {
          action: PUBLISH_ACTION,
          riskClass: "R4",
          payload: {
            ruleSetId,
            version,
            digest: v.digest,
            ...(effectiveFrom ? { effectiveFrom: effectiveFrom.toISOString() } : {}),
          },
          summary:
            publishSummary(set.key, v, current) +
            (effectiveFrom ? `, in force from ${effectiveFrom.toISOString()}` : ""),
        });
        await tx.query(
          `update rules.rule_set_version set state = 'pending_approval', approval_id = $3
            where rule_set_id = $1 and version = $2`,
          [ruleSetId, version, id],
        );
        await this.o.audit.record(tx, {
          action: "rules.ruleset.submit",
          resourceType: "rule_set_version",
          resourceId: `${ruleSetId}@${version}`,
          before: { state: "draft" },
          after: { state: "pending_approval", approval_id: id, digest: v.digest },
        });
        return { approvalId: id };
      },
      { action: "rules.ruleset.submit" },
    );
  }

  /** Return a pending version to draft once its approval request was rejected, cancelled or expired. */
  async reopen(ctx: KernelContext, ruleSetId: string, version: number): Promise<void> {
    const v = await this.o.kernel.read(ctx, (tx) =>
      this.loadVersion(tx, ruleSetId, version, false),
    );
    if (v.state !== "pending_approval" || !v.approval_id)
      throw new IpbError("IPB-RULE-003", { detail: `version ${version} is ${v.state}` });
    const approval = await this.o.approvals.get(ctx, v.approval_id);
    if (!["rejected", "cancelled", "expired"].includes(approval.state))
      throw new IpbError("IPB-RULE-003", {
        detail: `approval ${approval.id} is ${approval.state}`,
      });
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          `update rules.rule_set_version set state = 'draft', approval_id = null
            where rule_set_id = $1 and version = $2 and state = 'pending_approval' and approval_id = $3`,
          [ruleSetId, version, approval.id],
        );
        if (!r.rowCount) throw new IpbError("IPB-RULE-003", { detail: "version changed" });
        await this.o.audit.record(tx, {
          action: "rules.ruleset.reopen",
          resourceType: "rule_set_version",
          resourceId: `${ruleSetId}@${version}`,
          before: { state: "pending_approval", approval_id: approval.id },
          after: { state: "draft" },
        });
      },
      { action: "rules.ruleset.reopen" },
    );
  }

  /** The approved request's executor: publish the version and retire the previous one. */
  private async executePublish(
    tx: Tx,
    payload: Record<string, unknown>,
    approvalId: string,
  ): Promise<void> {
    const ruleSetId = String(payload.ruleSetId);
    const version = Number(payload.version);
    const set = await this.loadSet(tx, ruleSetId);
    const v = await this.loadVersion(tx, ruleSetId, version, true);
    if (
      v.state !== "pending_approval" ||
      v.approval_id !== approvalId ||
      v.digest !== payload.digest
    )
      throw new IpbError("IPB-RULE-003", {
        detail: "the version no longer matches the approved request",
        meta: { rule_set_id: ruleSetId, version },
      });
    await this.refuseScheduled(tx, ruleSetId);
    // The cut-over: the requested instant, or now when the approval came after it (PR-LDC-34). The
    // version in force keeps applying until then; both windows meet exactly at the cut-over.
    const requested = typeof payload.effectiveFrom === "string" ? payload.effectiveFrom : null;
    const cut = (
      await tx.query<{ cut: Date }>(
        "select greatest(coalesce($1::timestamptz, now()), now()) as cut",
        [requested],
      )
    ).rows[0]!.cut;
    const prev = await tx.query<{ version: number }>(
      `update rules.rule_set_version set state = 'retired', effective_to = $2
        where rule_set_id = $1 and state = 'published' returning version`,
      [ruleSetId, cut],
    );
    const pub = await tx.query<{ effective_from: Date }>(
      `update rules.rule_set_version
          set state = 'published', effective_from = $3, published_at = now()
        where rule_set_id = $1 and version = $2 returning effective_from`,
      [ruleSetId, version, cut],
    );
    const effectiveFrom = (pub.rows[0]?.effective_from as Date).toISOString();
    // Compile the new version for this tenant now, outside any evaluation's budget (PR-LDC-25,
    // R1-D-88); a failure is dropped from the cache and retried by the first evaluation.
    const ctx = tx.ctx;
    void this.resolveParameters(ctx, v.body)
      .then((p) => (p.invalid ? undefined : this.compiledFor(v, p.values)))
      .catch(() => undefined);
    await this.o.audit.record(tx, {
      action: "rules.ruleset.publish",
      resourceType: "rule_set_version",
      resourceId: `${ruleSetId}@${version}`,
      before: { state: "pending_approval", retired: prev.rows[0]?.version ?? null },
      after: {
        state: "published",
        digest: v.digest,
        approval_id: approvalId,
        effective_from: effectiveFrom,
      },
    });
    if (this.o.outbox) {
      const envelope = internalEvent({
        product: this.o.product,
        event: "RuleSetPublished",
        tenantId: tx.ctx.tenantId,
        data: {
          rule_set_id: ruleSetId,
          key: set.key,
          version,
          digest: v.digest,
          approval_id: approvalId,
          effective_from: effectiveFrom,
        },
        actorId: tx.ctx.principal.id,
        ...(this.o.pseudonymKey ? { pseudonymKey: this.o.pseudonymKey } : {}),
        ...(tx.ctx.traceId ? { traceId: tx.ctx.traceId } : {}),
      });
      await this.o.outbox.publish(tx, "rules", { envelope });
    }
  }

  async evaluate(ctx: KernelContext, ref: RuleSetRef, input: unknown): Promise<Decision> {
    const asOf = ref.asOf === undefined ? null : asOfInstant(ref);
    const { set, v } = await this.o.kernel.read(ctx, async (tx) => {
      const set = await this.loadSet(tx, ref.ruleSetId);
      if (set.purpose === "projection")
        throw new IpbError("IPB-RULE-003", {
          detail: "a projection rule set is evaluated with project, never as a decision",
          meta: { rule_set_id: ref.ruleSetId },
        });
      const v =
        asOf !== null
          ? await this.versionAt(tx, ref.ruleSetId, asOf)
          : ref.version === undefined
            ? await this.publishedRow(tx, ref.ruleSetId)
            : await this.loadVersion(tx, ref.ruleSetId, ref.version, false).catch(() => null);
      if (!v || (ref.version !== undefined && !["published", "retired"].includes(v.state)))
        throw new IpbError("IPB-RULE-002", {
          meta: { rule_set_id: ref.ruleSetId, ...(asOf ? { as_of: asOf.toISOString() } : {}) },
        });
      return { set, v };
    });
    const params = await this.resolveParameters(ctx, v.body);
    const result = params.invalid
      ? undetermined("parameter_invalid")
      : await this.run(v, input, params.values);
    const id = newId("dcs");
    const inputs = result.reason === "input_invalid" ? null : splitInputs(v.body, input);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        let enc: Buffer | null = null;
        let keyId: string | null = null;
        if (inputs?.sealed) {
          if (!this.o.fieldCrypto)
            throw new Error(`rule set ${set.key} has inputs above INTERNAL and needs FieldCrypto`);
          const s = await this.o.fieldCrypto.encryptField(
            ctx.tenantId,
            inputs.sealedClass,
            JSON.stringify(inputs.sealed),
            { table: "rules.decision_log", column: "inputs_enc", rowId: id },
          );
          enc = Buffer.from(s.enc);
          keyId = s.keyId;
        }
        let inboxId: string | null = null;
        if (result.outcome === "UNDETERMINED" && this.o.humanQueue) {
          inboxId = (
            await this.o.humanQueue.raise(tx, {
              type: "task",
              productModule: "rules",
              recordRef: id,
              title: `Rule decision undetermined (${set.key}, ${result.reason})`,
              assignee: await this.undeterminedAssignee(tx),
              // The principal whose request produced the decision never reviews it (#21).
              excludePrincipal: ctx.principal.id,
              escalateAfterHours: APPROVAL_ESCALATION_HOURS,
              severity: "warning",
              actionHint: "review_undetermined",
              deepLink: `/rules/decisions/${id}`,
              helpKey: "hlp.rules.undetermined",
            })
          ).id;
        }
        await tx.query(
          `insert into rules.decision_log
             (id, tenant_id, rule_set_id, version, engine, outcome, reason, rule_ids, inputs_digest,
              inputs, inputs_enc, inputs_key_id, inbox_item_id, actor_id, actor_type, parameters,
              as_of)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15,
                   $16::jsonb, $17)`,
          [
            id,
            ctx.tenantId,
            set.id,
            v.version,
            this.primary.name,
            result.outcome,
            result.reason,
            result.ruleIds,
            safeDigest(input),
            inputs ? JSON.stringify(inputs.clear) : null,
            enc,
            keyId,
            inboxId,
            ctx.principal.id,
            ctx.principal.type,
            Object.keys(params.trace).length ? JSON.stringify(params.trace) : null,
            asOf,
          ],
        );
        await this.o.audit.record(tx, {
          action: "rules.decision.record",
          resourceType: "decision",
          resourceId: id,
          after: {
            rule_set_id: set.id,
            version: v.version,
            outcome: result.outcome,
            reason: result.reason,
            rule_ids: result.ruleIds,
            ...(params.invalid ? { parameter: params.invalid } : {}),
            ...(asOf ? { as_of: asOf.toISOString() } : {}),
          },
        });
        return {
          id,
          outcome: result.outcome,
          outputs: result.outputs,
          ruleIds: result.ruleIds,
          ruleSetId: set.id,
          version: v.version,
          reason: result.reason,
          ...(Object.keys(params.trace).length ? { parameters: params.values } : {}),
          ...(asOf ? { asOf: asOf.toISOString() } : {}),
        };
      },
      { action: "rules.decision.record" },
    );
  }

  /**
   * Project a batch of inputs through a projection rule set (PR-LDC-49): a read, with no decision
   * record, no ledger entry and no human queue item; outcomes only, never a decision id. Refused
   * (`IPB-RULE-003`) for a decision-grade rule set, so a decision is always recorded.
   */
  async project(
    ctx: KernelContext,
    ref: RuleSetRef,
    inputs: readonly unknown[],
  ): Promise<{ ruleSetId: string; version: number; results: Projection[] }> {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > RULES_PROJECT_MAX_INPUTS)
      throw new IpbError("IPB-RULE-001", {
        detail: `project takes 1 to ${RULES_PROJECT_MAX_INPUTS} inputs`,
      });
    const asOf = ref.asOf === undefined ? null : asOfInstant(ref);
    const v = await this.o.kernel.read(ctx, async (tx) => {
      const set = await this.loadSet(tx, ref.ruleSetId);
      if (set.purpose !== "projection")
        throw new IpbError("IPB-RULE-003", {
          detail: "only a rule set created for projection is projected; decisions use evaluate",
          meta: { rule_set_id: ref.ruleSetId },
        });
      const v =
        asOf !== null
          ? await this.versionAt(tx, ref.ruleSetId, asOf)
          : ref.version === undefined
            ? await this.publishedRow(tx, ref.ruleSetId)
            : await this.loadVersion(tx, ref.ruleSetId, ref.version, false).catch(() => null);
      if (!v || (ref.version !== undefined && !["published", "retired"].includes(v.state)))
        throw new IpbError("IPB-RULE-002", { meta: { rule_set_id: ref.ruleSetId } });
      return v;
    });
    const params = await this.resolveParameters(ctx, v.body);
    const results: Projection[] = [];
    for (const input of inputs) {
      const r = params.invalid
        ? undetermined("parameter_invalid")
        : await this.run(v, input, params.values);
      results.push({ outcome: r.outcome, outputs: r.outputs, reason: r.reason });
    }
    return { ruleSetId: ref.ruleSetId, version: v.version, results };
  }

  /** ORG_CHECKER first; ORG_ADMIN only if the tenant has no checker (OWNER-QUESTIONS #21). */
  private async undeterminedAssignee(tx: Tx): Promise<InboxItemInput["assignee"]> {
    if (this.o.undeterminedAssignee) return this.o.undeterminedAssignee;
    const has = this.o.hasRoleHolder ?? tenantHasRoleHolder;
    return { kind: "role", id: (await has(tx, "ORG_CHECKER")) ? "ORG_CHECKER" : "ORG_ADMIN" };
  }

  async evaluateCel(
    expr: string,
    input: unknown,
    opts: { maxAstNodes?: number } = {},
  ): Promise<CelResult> {
    return evaluateCel(expr, input, {
      maxAstNodes: Math.min(opts.maxAstNodes ?? this.celMaxCost, this.celMaxCost),
    });
  }

  async listRuleSets(ctx: KernelContext): Promise<RuleSetSummary[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{
        id: string;
        key: string;
        owner_module: string;
        published: number | null;
        draft: number | null;
        scheduled: number | null;
        scheduled_from: Date | null;
      }>(
        `select s.id, s.key, s.owner_module,
                max(v.version) filter (where v.state in ('published', 'retired')
                  and v.effective_from <= now() and (v.effective_to is null or v.effective_to > now())) as published,
                max(v.version) filter (where v.state in ('draft', 'pending_approval')) as draft,
                max(v.version) filter (where v.state = 'published' and v.effective_from > now()) as scheduled,
                max(v.effective_from) filter (where v.state = 'published' and v.effective_from > now()) as scheduled_from
           from rules.rule_set s left join rules.rule_set_version v on v.rule_set_id = s.id
          group by s.id, s.key, s.owner_module
          order by s.key`,
      );
      return r.rows.map((x) => ({
        ruleSetId: x.id,
        key: x.key,
        ownerModule: x.owner_module,
        publishedVersion: x.published,
        draftVersion: x.draft,
        scheduledVersion: x.scheduled,
        scheduledFrom: x.scheduled_from ? x.scheduled_from.toISOString() : null,
      }));
    });
  }

  /** Run inputs on a version and on the published one; report what changes. Inputs are not stored. */
  async simulate(
    ctx: KernelContext,
    ref: Required<Pick<RuleSetRef, "ruleSetId" | "version">>,
    inputs: unknown[],
  ): Promise<SimulationReport> {
    if (inputs.length > MAX_SIMULATION_INPUTS)
      throw new IpbError("IPB-RULE-001", { detail: `at most ${MAX_SIMULATION_INPUTS} inputs` });
    const { v, base } = await this.o.kernel.read(ctx, async (tx) => {
      await this.loadSet(tx, ref.ruleSetId);
      const v = await this.loadVersion(tx, ref.ruleSetId, ref.version, false);
      const base = await this.publishedRow(tx, ref.ruleSetId);
      return { v, base: base && base.version !== v.version ? base : null };
    });
    // Both versions run with the tenant's current parameter values (R1-D-88).
    const pv = await this.resolveParameters(ctx, v.body);
    const pb = base ? await this.resolveParameters(ctx, base.body) : null;
    const changed: SimulationReport["changed"] = [];
    for (const [index, input] of inputs.entries()) {
      const after = pv.invalid
        ? undetermined("parameter_invalid")
        : await this.run(v, input, pv.values);
      const before =
        base && pb
          ? pb.invalid
            ? undetermined("parameter_invalid")
            : await this.run(base, input, pb.values)
          : null;
      if (before && sameResult(before, after)) continue;
      changed.push({
        index,
        before: before?.outcome ?? "NO_MATCH",
        after: after.outcome,
        ...(before?.ruleIds[0] ? { rowBefore: before.ruleIds.join(",") } : {}),
        ...(after.ruleIds[0] ? { rowAfter: after.ruleIds.join(",") } : {}),
      });
    }
    const runId = newId("run");
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const summary = { changed: changed.length, indexes: changed.map((c) => c.index) };
        await tx.query(
          `insert into rules.simulation_run
             (id, tenant_id, rule_set_id, version, baseline, input_count, diff_summary, created_by)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            runId,
            ctx.tenantId,
            ref.ruleSetId,
            ref.version,
            base?.version ?? null,
            inputs.length,
            JSON.stringify(summary),
            ctx.principal.id,
          ],
        );
        await this.o.audit.record(tx, {
          action: "rules.simulation.run",
          resourceType: "simulation_run",
          resourceId: runId,
          after: {
            rule_set_id: ref.ruleSetId,
            version: ref.version,
            input_count: inputs.length,
            ...summary,
          },
        });
      },
      { action: "rules.simulation.run" },
    );
    return { runId, inputCount: inputs.length, changed };
  }

  /** "Why this?" (IPB-07-16): the matched rows, their conditions and the inputs they read. */
  async explain(ctx: KernelContext, decisionId: string): Promise<Explanation> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{
        rule_set_id: string;
        version: number;
        outcome: DecisionOutcome;
        rule_ids: string[];
        inputs: Record<string, unknown> | null;
        parameters: Record<string, { value: unknown; source: "setting" | "default" }> | null;
        as_of: Date | null;
      }>(
        `select rule_set_id, version, outcome, rule_ids, inputs, parameters, as_of
           from rules.decision_log where id = $1`,
        [decisionId],
      );
      const d = r.rows[0];
      if (!d) throw new NotFoundError("decision");
      const v = await this.loadVersion(tx, d.rule_set_id, d.version, false);
      const rows = v.body.rows.filter((x) => d.rule_ids.includes(x.id));
      return {
        decisionId,
        outcome: d.outcome,
        ruleIds: d.rule_ids,
        conditions: rows.map((x) => x.when),
        inputs: v.body.inputs.map((f) =>
          CLEAR_CLASSES.includes(f.dataClass) && d.inputs && f.name in d.inputs
            ? { name: f.name, value: d.inputs[f.name] }
            : { name: f.name },
        ),
        help_keys: rows.flatMap((x) => (x.help_key ? [x.help_key] : [])),
        ...(d.parameters
          ? {
              parameters: Object.entries(d.parameters).map(([name, p]) => ({
                name,
                value: p.value,
                source: p.source,
              })),
            }
          : {}),
        ...(d.as_of ? { asOf: new Date(d.as_of).toISOString() } : {}),
        source: "rules",
      };
    });
  }

  /**
   * Compile ahead of traffic (PR-LDC-25, R1-D-88): warms the engine once, then compiles the
   * version in force now of each rule set given (default: every rule set the caller can read),
   * so no evaluation pays for compilation. Call it at start-up and when `RuleSetPublished`
   * arrives from another instance.
   */
  async prepare(
    ctx: KernelContext,
    ruleSetIds?: readonly string[],
  ): Promise<{ compiled: number; failed: string[] }> {
    await this.primary.health();
    const versions = await this.o.kernel.read(ctx, async (tx) => {
      const ids =
        ruleSetIds ??
        (await tx.query<{ id: string }>("select id from rules.rule_set order by id")).rows.map(
          (r) => r.id,
        );
      const out: VersionRow[] = [];
      for (const id of ids) {
        const v = await this.publishedRow(tx, id);
        if (v) out.push(v);
      }
      return out;
    });
    const failed: string[] = [];
    for (const v of versions) {
      const ok = await this.resolveParameters(ctx, v.body)
        .then((p) => (p.invalid ? false : this.compiledFor(v, p.values).then(() => true)))
        .catch(() => false);
      if (!ok) failed.push(`${v.rule_set_id}@${v.version}`);
    }
    return { compiled: versions.length - failed.length, failed };
  }

  /** Each parameter's tenant value from settings, else its default; checked against its type. */
  private async resolveParameters(
    ctx: KernelContext,
    body: RuleSetBody,
  ): Promise<ResolvedParameters> {
    const out: ResolvedParameters = { values: {}, trace: {}, invalid: null };
    const params: readonly RuleParameter[] = body.parameters ?? [];
    if (!params.length) return out;
    const settings = this.o.settings;
    if (!settings) throw new Error("a rule set with parameters needs the settings option");
    for (const p of params) {
      const read = (await settings.explain(ctx, p.setting)).value;
      const fromSetting = read !== null && read !== undefined;
      const value = fromSetting ? read : p.default;
      out.values[p.name] = value;
      out.trace[p.name] = { value, source: fromSetting ? "setting" : "default" };
      if (!out.invalid && ruleParameterValueError(p, value)) out.invalid = p.name;
    }
    return out;
  }

  /** A draft's parameters must name registered settings (IPB-07: registered before read). */
  private async checkParameterSettings(ctx: KernelContext, body: RuleSetBody): Promise<void> {
    const params = body.parameters ?? [];
    if (!params.length) return;
    if (!this.o.settings)
      throw new IpbError("IPB-RULE-001", {
        detail: "rule parameters need the settings option on the RULES service",
      });
    for (const p of params) {
      try {
        await this.o.settings.explain(ctx, p.setting);
      } catch {
        throw new IpbError("IPB-RULE-001", {
          detail: `parameter ${p.name}: setting ${p.setting} is not registered`,
          meta: { parameter: p.name, setting: p.setting },
        });
      }
    }
  }

  private async run(
    v: VersionRow,
    input: unknown,
    parameters: Record<string, unknown> = {},
  ): Promise<Evaluated> {
    let compiled: CompiledRuleSet;
    try {
      compiled = await this.compiledFor(v, parameters);
    } catch {
      return { outcome: "UNDETERMINED", outputs: {}, ruleIds: [], reason: "engine_error" };
    }
    const r = await compiled.evaluate(input as Record<string, unknown>, {
      timeoutMs: this.timeoutMs,
    });
    if (r.outcome !== "MATCHED") return r;
    // A `verify` row may not drive a statutory output (Ecosystem §12.3, PL3 plan §4.2).
    const statutory = new Set(v.body.outputs.filter((o) => o.statutory).map((o) => o.name));
    const verifyHit = v.body.rows.some(
      (row) =>
        row.verify &&
        r.ruleIds.includes(row.id) &&
        Object.keys(row.then).some((k) => statutory.has(k)),
    );
    if (verifyHit)
      return { outcome: "UNDETERMINED", outputs: {}, ruleIds: r.ruleIds, reason: "verify_row" };
    return r;
  }

  /** One compiled table per version and parameter values (R1-D-88), least recently built out. */
  private compiledFor(
    v: VersionRow,
    parameters: Record<string, unknown> = {},
  ): Promise<CompiledRuleSet> {
    const bound = Object.keys(parameters).length ? `:${canonicalDigest(parameters)}` : "";
    const key = `${v.rule_set_id}@${v.version}:${v.digest}${bound}`;
    let c = this.cache.get(key);
    if (!c) {
      if (this.cache.size >= CACHE_SIZE)
        this.cache.delete(this.cache.keys().next().value as string);
      c = this.primary.compile(v.body, parameters);
      c.catch(() => this.cache.delete(key));
      this.cache.set(key, c);
    }
    return c;
  }

  private async validate(body: RuleSetBody, set: RuleSetRow): Promise<void> {
    for (const f of body.inputs)
      if (CLASS_RANK[f.dataClass] > CLASS_RANK[set.data_class])
        throw new IpbError("IPB-RULE-001", {
          detail: `input ${f.name} is ${f.dataClass}, above the rule set's ${set.data_class}`,
        });
    for (const e of this.validators) {
      try {
        await e.compile(body);
      } catch (err) {
        if (err instanceof RuleCompileError)
          throw new IpbError("IPB-RULE-001", {
            detail: err.message,
            meta: { engine: e.name, row: err.rowId, reason: err.reason },
          });
        throw err;
      }
    }
  }

  private async loadSet(tx: Tx, id: string): Promise<RuleSetRow> {
    const r = await tx.query<RuleSetRow>("select * from rules.rule_set where id = $1", [id]);
    const row = r.rows[0];
    if (!row) throw new NotFoundError("rule set");
    return row;
  }

  private async loadVersion(
    tx: Tx,
    id: string,
    version: number,
    lock: boolean,
  ): Promise<VersionRow> {
    const r = await tx.query<VersionRow>(
      `select * from rules.rule_set_version where rule_set_id = $1 and version = $2${lock ? " for update" : ""}`,
      [id, version],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundError("rule set version");
    return row;
  }

  /** The version in force at `at`: published or since retired, effective then (PR-LDC-22 (b)). */
  private async versionAt(tx: Tx, id: string, at: Date): Promise<VersionRow | null> {
    const now = await tx.query<{ ok: boolean }>("select $1::timestamptz <= now() as ok", [at]);
    if (!now.rows[0]?.ok)
      throw new IpbError("IPB-RULE-001", { detail: "asOf must not be in the future" });
    const r = await tx.query<VersionRow>(
      `select * from rules.rule_set_version
        where rule_set_id = $1 and state in ('published', 'retired')
          and effective_from <= $2 and (effective_to is null or effective_to > $2)
        order by version desc limit 1`,
      [id, at],
    );
    return r.rows[0] ?? null;
  }

  /** The version in force now: published, or retired with its cut-over still ahead (PR-LDC-34). */
  private async publishedRow(tx: Tx, id: string): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(
      `select * from rules.rule_set_version
        where rule_set_id = $1 and state in ('published', 'retired')
          and effective_from <= now() and (effective_to is null or effective_to > now())
        order by version desc limit 1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  /** One scheduled cut-over at a time: a new publication waits until the pending one is in force. */
  private async refuseScheduled(tx: Tx, id: string): Promise<void> {
    const r = await tx.query<{ version: number; effective_from: Date }>(
      `select version, effective_from from rules.rule_set_version
        where rule_set_id = $1 and state = 'published' and effective_from > now()`,
      [id],
    );
    const s = r.rows[0];
    if (s)
      throw new IpbError("IPB-RULE-003", {
        detail: `version ${s.version} comes into force at ${s.effective_from.toISOString()}; publish again after it`,
        meta: { rule_set_id: id, version: s.version },
      });
  }
}

const undetermined = (reason: string): Evaluated => ({
  outcome: "UNDETERMINED",
  outputs: {},
  ruleIds: [],
  reason,
});

function cutoverInstant(v: Date | string): Date {
  const at = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(at.getTime()))
    throw new IpbError("IPB-RULE-001", { detail: "effectiveFrom is not a valid instant" });
  return at;
}

function asOfInstant(ref: RuleSetRef): Date {
  if (ref.version !== undefined)
    throw new IpbError("IPB-RULE-001", { detail: "asOf and version are exclusive" });
  const at = ref.asOf instanceof Date ? ref.asOf : new Date(String(ref.asOf));
  if (Number.isNaN(at.getTime()))
    throw new IpbError("IPB-RULE-001", { detail: "asOf is not a valid instant" });
  return at;
}

function publishSummary(key: string, v: VersionRow, current: VersionRow | null): string {
  if (!current) return `Publish ${key} v${v.version} (${v.body.rows.length} rows, first version)`;
  const before = new Map(current.body.rows.map((r) => [r.id, canonicalDigest(r)]));
  const after = new Map(v.body.rows.map((r) => [r.id, canonicalDigest(r)]));
  const added = [...after.keys()].filter((k) => !before.has(k)).length;
  const removed = [...before.keys()].filter((k) => !after.has(k)).length;
  const changed = [...after].filter(([k, d]) => before.has(k) && before.get(k) !== d).length;
  return `Publish ${key} v${v.version} replacing v${current.version} (+${added} −${removed} ~${changed} rows)`;
}

/** Inputs at PUBLIC/INTERNAL stay readable for explain; the rest are sealed together. */
function splitInputs(
  body: RuleSetBody,
  input: unknown,
): {
  clear: Record<string, unknown>;
  sealed: Record<string, unknown> | null;
  sealedClass: DataClass;
} {
  const rec = input as Record<string, unknown>;
  const clear: Record<string, unknown> = {};
  const sealed: Record<string, unknown> = {};
  let sealedClass: DataClass = "CONFIDENTIAL";
  for (const f of body.inputs) {
    if (CLEAR_CLASSES.includes(f.dataClass)) clear[f.name] = rec[f.name];
    else {
      sealed[f.name] = rec[f.name];
      if (CLASS_RANK[f.dataClass] > CLASS_RANK[sealedClass]) sealedClass = f.dataClass;
    }
  }
  return { clear, sealed: Object.keys(sealed).length ? sealed : null, sealedClass };
}

function safeDigest(input: unknown): string {
  try {
    return canonicalDigest(input ?? null);
  } catch {
    return canonicalDigest("unserialisable");
  }
}

function sameResult(a: Evaluated, b: Evaluated): boolean {
  return (
    a.outcome === b.outcome &&
    a.ruleIds.join(",") === b.ruleIds.join(",") &&
    canonicalDigest(a.outputs) === canonicalDigest(b.outputs)
  );
}
