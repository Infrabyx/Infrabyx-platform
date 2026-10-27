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
  CompiledRuleSet,
  Decision,
  DecisionOutcome,
  Explanation,
  PortHealth,
  RuleEngine,
  RuleSetBody,
  RuleSetRef,
  RuleSetSummary,
  RulesPort,
  SimulationReport,
} from "@infrabyx/contracts/ports";
import { RuleSetKey } from "@infrabyx/contracts/ports";
import { internalEvent } from "@infrabyx/config/events";
import { canonicalDigest, newId, type SecretKey } from "@infrabyx/crypto";
import { NotFoundError, type ApprovalsEngine, type FieldCrypto } from "@infrabyx/tenancy";
import {
  evaluateCel,
  ruleEngine,
  RuleCompileError,
  RULE_ENGINES,
  type InProcessRuleEngine,
  type RuleEngineName,
} from "@infrabyx/connectors/rules";

export const PUBLISH_ACTION = "rules.ruleset.publish";
/** Most inputs one simulation may run (PL3 plan §4.4). */
export const MAX_SIMULATION_INPUTS = 1000;
const CACHE_SIZE = 256;
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
  /** Who reviews an UNDETERMINED decision (default the tenant's `ORG_ADMIN` role, PL3-D-18). */
  undeterminedAssignee?: InboxItemInput["assignee"];
  pseudonymKey?: SecretKey;
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

interface RuleSetRow {
  id: string;
  tenant_id: string;
  key: string;
  owner_module: string;
  data_class: DataClass;
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
    opts.approvals.register(PUBLISH_ACTION, {
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
    input: { key: string; ownerModule: string; dataClass?: DataClass },
  ): Promise<{ ruleSetId: string }> {
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
          `insert into rules.rule_set (id, tenant_id, key, owner_module, data_class, created_by)
           values ($1, $2, $3, $4, $5, $6)`,
          [id, ctx.tenantId, input.key, input.ownerModule, cls, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "rules.ruleset.create",
          resourceType: "rule_set",
          resourceId: id,
          after: { key: input.key, owner_module: input.ownerModule, data_class: cls },
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
  ): Promise<{ approvalId: string }> {
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
        const current = await this.publishedRow(tx, ruleSetId);
        const { id } = await this.o.approvals.request(tx, {
          action: PUBLISH_ACTION,
          riskClass: "R4",
          payload: { ruleSetId, version, digest: v.digest },
          summary: publishSummary(set.key, v, current),
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
    const prev = await tx.query<{ version: number }>(
      `update rules.rule_set_version set state = 'retired', effective_to = now()
        where rule_set_id = $1 and state = 'published' returning version`,
      [ruleSetId],
    );
    const pub = await tx.query<{ effective_from: Date }>(
      `update rules.rule_set_version
          set state = 'published', effective_from = now(), published_at = now()
        where rule_set_id = $1 and version = $2 returning effective_from`,
      [ruleSetId, version],
    );
    const effectiveFrom = (pub.rows[0]?.effective_from as Date).toISOString();
    await this.o.audit.record(tx, {
      action: "rules.ruleset.publish",
      resourceType: "rule_set_version",
      resourceId: `${ruleSetId}@${version}`,
      before: { state: "pending_approval", retired: prev.rows[0]?.version ?? null },
      after: { state: "published", digest: v.digest, approval_id: approvalId },
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
    const { set, v } = await this.o.kernel.read(ctx, async (tx) => {
      const set = await this.loadSet(tx, ref.ruleSetId);
      const v =
        ref.version === undefined
          ? await this.publishedRow(tx, ref.ruleSetId)
          : await this.loadVersion(tx, ref.ruleSetId, ref.version, false).catch(() => null);
      if (!v || (ref.version !== undefined && !["published", "retired"].includes(v.state)))
        throw new IpbError("IPB-RULE-002", { meta: { rule_set_id: ref.ruleSetId } });
      return { set, v };
    });
    const result = await this.run(v, input);
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
              assignee: this.o.undeterminedAssignee ?? { kind: "role", id: "ORG_ADMIN" },
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
              inputs, inputs_enc, inputs_key_id, inbox_item_id, actor_id, actor_type)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15)`,
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
        };
      },
      { action: "rules.decision.record" },
    );
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
      }>(
        `select s.id, s.key, s.owner_module,
                max(v.version) filter (where v.state = 'published') as published,
                max(v.version) filter (where v.state in ('draft', 'pending_approval')) as draft
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
      }));
    });
  }

  /** Run inputs on a version and on the published one; report what changes. Inputs are not stored. */
  async simulate(
    ctx: KernelContext,
    ref: Required<RuleSetRef>,
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
    const changed: SimulationReport["changed"] = [];
    for (const [index, input] of inputs.entries()) {
      const after = await this.run(v, input);
      const before = base ? await this.run(base, input) : null;
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
      }>(
        "select rule_set_id, version, outcome, rule_ids, inputs from rules.decision_log where id = $1",
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
        source: "rules",
      };
    });
  }

  private async run(v: VersionRow, input: unknown): Promise<Evaluated> {
    let compiled: CompiledRuleSet;
    try {
      compiled = await this.compiledFor(v);
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

  private compiledFor(v: VersionRow): Promise<CompiledRuleSet> {
    const key = `${v.rule_set_id}@${v.version}:${v.digest}`;
    let c = this.cache.get(key);
    if (!c) {
      if (this.cache.size >= CACHE_SIZE)
        this.cache.delete(this.cache.keys().next().value as string);
      c = this.primary.compile(v.body);
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

  private async publishedRow(tx: Tx, id: string): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(
      `select * from rules.rule_set_version
        where rule_set_id = $1 and state = 'published' and effective_from <= now()`,
      [id],
    );
    return r.rows[0] ?? null;
  }
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
