// Model registry (IPB-03 §03.3.B, §03.4.4; PL4 plan §4.2). Rows live in `tnt_platform` and are
// written only in a platform context (the kernel grants platform scope to PLT_* people only).
// Promotion to APPROVED and the choice of DEFAULT are R4 approvals checked by
// PLT_SECURITY_OFFICER; BLOCKED is immediate and overrides pins and BYOK. Every change writes
// `ai.model_event`, a ledger entry and `ModelStateChanged` in one transaction.
import type { DataClass } from "@infrabyx/contracts/data-class";
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import {
  AI_EVENTS,
  ModelStateChangedData,
  type AiResidency,
  type ModelCapability,
  type RetentionPolicy,
  type RoutingBand,
} from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { NotFoundError, type ApprovalsEngine } from "@infrabyx/tenancy";

export const MODEL_STATES = [
  "CANDIDATE",
  "EVALUATING",
  "APPROVED",
  "DEFAULT",
  "DEPRECATED",
  "BLOCKED",
] as const;
export type ModelState = (typeof MODEL_STATES)[number];

export const PROMOTE_ACTION = "ai.model.promote";
export const SET_DEFAULT_ACTION = "ai.model.set_default";
/** Registry approvals are checked by the platform security officer (IPB-03-13, 03-14). */
export const REGISTRY_CHECKERS = ["PLT_SECURITY_OFFICER"] as const;
/** A DEPRECATED model's sunset is at least this far ahead (IPB-03-15). */
export const MIN_SUNSET_DAYS = 30;

export interface ModelRecord {
  modelId: string;
  adapterKey: string;
  providerModelName: string;
  capabilities: ModelCapability[];
  contextTokens: number | null;
  maxOutputTokens: number | null;
  embeddingDims: number | null;
  priceInPerMtok: number | null;
  priceOutPerMtok: number | null;
  currency: string | null;
  residency: AiResidency;
  retentionPolicy: RetentionPolicy;
  retentionEvidenceUrl: string | null;
  trainingOptOut: boolean;
  trainingEvidenceUrl: string | null;
  evalScores: Record<string, number>;
  state: ModelState;
  sunsetAt: Date | null;
  notes: string | null;
}

export interface CandidateInput {
  adapterKey: string;
  providerModelName: string;
  capabilities: ModelCapability[];
  residency: AiResidency;
  retentionPolicy: RetentionPolicy;
  contextTokens?: number;
  maxOutputTokens?: number;
  embeddingDims?: number;
  retentionEvidenceUrl?: string;
  trainingOptOut?: boolean;
  trainingEvidenceUrl?: string;
  notes?: string;
}

interface Row {
  model_id: string;
  adapter_key: string;
  provider_model_name: string;
  capabilities: ModelCapability[];
  context_tokens: number | null;
  max_output_tokens: number | null;
  embedding_dims: number | null;
  price_in_per_mtok: string | null;
  price_out_per_mtok: string | null;
  currency: string | null;
  residency: AiResidency;
  retention_policy: RetentionPolicy;
  retention_evidence_url: string | null;
  training_opt_out: boolean;
  training_evidence_url: string | null;
  eval_scores: Record<string, number>;
  state: ModelState;
  sunset_at: Date | null;
  notes: string | null;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));
const toRecord = (r: Row): ModelRecord => ({
  modelId: r.model_id,
  adapterKey: r.adapter_key,
  providerModelName: r.provider_model_name,
  capabilities: r.capabilities,
  contextTokens: r.context_tokens,
  maxOutputTokens: r.max_output_tokens,
  embeddingDims: r.embedding_dims,
  priceInPerMtok: num(r.price_in_per_mtok),
  priceOutPerMtok: num(r.price_out_per_mtok),
  currency: r.currency ? r.currency.trim() : null,
  residency: r.residency,
  retentionPolicy: r.retention_policy,
  retentionEvidenceUrl: r.retention_evidence_url,
  trainingOptOut: r.training_opt_out,
  trainingEvidenceUrl: r.training_evidence_url,
  evalScores: r.eval_scores ?? {},
  state: r.state,
  sunsetAt: r.sunset_at,
  notes: r.notes,
});

/** Transitions taken without an approval (IPB-03 §03.4.4 state diagram). */
const DIRECT: Readonly<Record<ModelState, readonly ModelState[]>> = {
  CANDIDATE: ["EVALUATING", "BLOCKED"],
  EVALUATING: ["CANDIDATE", "BLOCKED"],
  APPROVED: ["DEPRECATED", "BLOCKED"],
  DEFAULT: ["BLOCKED"],
  DEPRECATED: ["BLOCKED"],
  BLOCKED: ["CANDIDATE"],
};

/** The routing band served by a capability's DEFAULT row. */
export interface DefaultRef {
  capability: ModelCapability;
  band: RoutingBand;
  modelId: string;
}

export interface ModelRegistryOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  outbox?: OutboxWriter;
  /** The tenancy approvals engine; the registry registers its two R4 actions on it. */
  approvals: ApprovalsEngine;
  /** `ai.registry.promotion_tolerance` (default 0.02). */
  promotionTolerance?: (ctx: KernelContext) => Promise<number>;
  /** Seconds a routing snapshot of the registry may be reused (default 30; IPB-03-16 bound 60). */
  cacheSeconds?: number;
  now?: () => Date;
}

export class ModelRegistry {
  private snapshot: { at: number; models: ModelRecord[]; defaults: DefaultRef[] } | null = null;
  private readonly now: () => Date;

  constructor(private readonly o: ModelRegistryOptions) {
    this.now = o.now ?? (() => new Date());
    o.approvals.register(PROMOTE_ACTION, {
      checkerRoles: REGISTRY_CHECKERS,
      execute: (tx, payload, request) => this.executePromote(tx, payload, request.id),
    });
    o.approvals.register(SET_DEFAULT_ACTION, {
      checkerRoles: REGISTRY_CHECKERS,
      execute: (tx, payload, request) => this.executeSetDefault(tx, payload, request.id),
    });
  }

  /** Models and defaults for routing, cached for `cacheSeconds` (a BLOCK is seen within 60 s). */
  async routingSnapshot(
    ctx: KernelContext,
  ): Promise<{ models: ModelRecord[]; defaults: DefaultRef[] }> {
    const ttl = (this.o.cacheSeconds ?? 30) * 1000;
    const t = this.now().getTime();
    if (this.snapshot && t - this.snapshot.at < ttl) return this.snapshot;
    const s = await this.o.kernel.read(ctx, async (tx) => ({
      models: (await tx.query<Row>("select * from ai.model order by model_id")).rows.map(toRecord),
      defaults: (
        await tx.query<{ capability: ModelCapability; band: RoutingBand; model_id: string }>(
          "select capability, band, model_id from ai.default_model",
        )
      ).rows.map((d) => ({ capability: d.capability, band: d.band, modelId: d.model_id })),
    }));
    this.snapshot = { at: t, ...s };
    return s;
  }

  /** Drop the cached snapshot (after a local change, or on a settings-change signal). */
  invalidate(): void {
    this.snapshot = null;
  }

  async get(ctx: KernelContext, modelId: string): Promise<ModelRecord> {
    return this.o.kernel.read(ctx, (tx) => this.load(tx, modelId));
  }

  private async load(tx: Tx, modelId: string): Promise<ModelRecord> {
    const r = await tx.query<Row>("select * from ai.model where model_id = $1", [modelId]);
    if (!r.rows[0]) throw new NotFoundError("model");
    return toRecord(r.rows[0]);
  }

  /** Add a model as CANDIDATE (IPB-03-17: residency and retention set, `[VERIFY]` in notes). */
  async addCandidate(ctx: KernelContext, input: CandidateInput): Promise<ModelRecord> {
    const modelId = `${input.adapterKey}/${input.providerModelName}`;
    const rec = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<Row>(
          `insert into ai.model
             (model_id, adapter_key, provider_model_name, capabilities, context_tokens,
              max_output_tokens, embedding_dims, residency, retention_policy,
              retention_evidence_url, training_opt_out, training_evidence_url, notes)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           on conflict (model_id) do nothing returning *`,
          [
            modelId,
            input.adapterKey,
            input.providerModelName,
            input.capabilities,
            input.contextTokens ?? null,
            input.maxOutputTokens ?? null,
            input.embeddingDims ?? null,
            input.residency,
            input.retentionPolicy,
            input.retentionEvidenceUrl ?? null,
            input.trainingOptOut ?? false,
            input.trainingEvidenceUrl ?? null,
            input.notes ?? null,
          ],
        );
        const row = r.rows[0] ?? (await this.loadRow(tx, modelId));
        await this.o.audit.record(tx, {
          action: "ai.model.add",
          resourceType: "ai_model",
          resourceId: modelId,
          after: { state: row.state, residency: row.residency, retention: row.retention_policy },
        });
        return toRecord(row);
      },
      { action: "ai.model.add" },
    );
    this.invalidate();
    return rec;
  }

  private async loadRow(tx: Tx, modelId: string): Promise<Row> {
    const r = await tx.query<Row>("select * from ai.model where model_id = $1", [modelId]);
    if (!r.rows[0]) throw new NotFoundError("model");
    return r.rows[0];
  }

  /** Record evidence and eval scores on a CANDIDATE or EVALUATING model. */
  async recordEvidence(
    ctx: KernelContext,
    modelId: string,
    e: {
      retentionEvidenceUrl?: string;
      trainingOptOut?: boolean;
      trainingEvidenceUrl?: string;
      evalScores?: Record<string, number>;
      priceInPerMtok?: number;
      priceOutPerMtok?: number;
      currency?: string;
    },
  ): Promise<ModelRecord> {
    const rec = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const m = await this.load(tx, modelId);
        if (m.state !== "CANDIDATE" && m.state !== "EVALUATING")
          throw new IpbError("IPB-AI-013", {
            detail: `evidence is recorded before promotion; ${modelId} is ${m.state}`,
          });
        const r = await tx.query<Row>(
          `update ai.model set
             retention_evidence_url = coalesce($2, retention_evidence_url),
             training_opt_out = coalesce($3, training_opt_out),
             training_evidence_url = coalesce($4, training_evidence_url),
             eval_scores = eval_scores || coalesce($5::jsonb, '{}'::jsonb),
             price_in_per_mtok = coalesce($6, price_in_per_mtok),
             price_out_per_mtok = coalesce($7, price_out_per_mtok),
             currency = coalesce($8, currency),
             updated_at = now()
           where model_id = $1 returning *`,
          [
            modelId,
            e.retentionEvidenceUrl ?? null,
            e.trainingOptOut ?? null,
            e.trainingEvidenceUrl ?? null,
            e.evalScores ? JSON.stringify(e.evalScores) : null,
            e.priceInPerMtok ?? null,
            e.priceOutPerMtok ?? null,
            e.currency ?? null,
          ],
        );
        await this.o.audit.record(tx, {
          action: "ai.model.evidence",
          resourceType: "ai_model",
          resourceId: modelId,
          after: {
            retention_evidence: Boolean(e.retentionEvidenceUrl),
            training_opt_out: e.trainingOptOut ?? null,
            eval_sets: Object.keys(e.evalScores ?? {}),
            price_set: e.priceInPerMtok !== undefined || e.priceOutPerMtok !== undefined,
          },
        });
        return toRecord(r.rows[0] as Row);
      },
      { action: "ai.model.evidence" },
    );
    this.invalidate();
    return rec;
  }

  /**
   * A transition that needs no approval: CANDIDATE ⇄ EVALUATING, APPROVED → DEPRECATED (with a
   * sunset at least 30 days ahead), DEPRECATED → BLOCKED, BLOCKED → CANDIDATE, and BLOCKED from
   * any state, at once (IPB-03-16). Blocking a DEFAULT removes it from the defaults table.
   */
  async transition(
    ctx: KernelContext,
    modelId: string,
    to: ModelState,
    o: { reason: string; sunsetAt?: Date },
  ): Promise<ModelRecord> {
    const rec = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const m = await this.load(tx, modelId);
        if (!DIRECT[m.state].includes(to))
          throw new IpbError("IPB-AI-013", {
            detail: `${m.state} → ${to} is not a direct transition`,
          });
        if (to === "DEPRECATED") {
          const min = this.now().getTime() + MIN_SUNSET_DAYS * 86_400_000;
          if (!o.sunsetAt || o.sunsetAt.getTime() < min)
            throw new IpbError("IPB-AI-013", {
              detail: `a deprecation needs sunset_at at least ${MIN_SUNSET_DAYS} days ahead`,
            });
        }
        if (to === "BLOCKED")
          await tx.query("delete from ai.default_model where model_id = $1", [modelId]);
        return this.setState(tx, m, to, { reason: o.reason, sunsetAt: o.sunsetAt ?? null });
      },
      { action: `ai.model.${to.toLowerCase()}` },
    );
    this.invalidate();
    return rec;
  }

  /**
   * Ask for promotion to APPROVED (R4, PLT_SECURITY_OFFICER). Refused with IPB-AI-013 without a
   * retention evidence URL, a documented training opt-out, or eval scores at or above the
   * current DEFAULT's minus `ai.registry.promotion_tolerance` (IPB-03-13, 03-52).
   */
  async requestPromotion(ctx: KernelContext, modelId: string): Promise<{ approvalId: string }> {
    const tolerance = (await this.o.promotionTolerance?.(ctx)) ?? 0.02;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const m = await this.load(tx, modelId);
        if (m.state !== "EVALUATING")
          throw new IpbError("IPB-AI-013", { detail: `only EVALUATING models are promoted` });
        await this.assertPromotable(tx, m, tolerance);
        const { id } = await this.o.approvals.request(tx, {
          action: PROMOTE_ACTION,
          riskClass: "R4",
          payload: { modelId, tolerance },
          summary: `Promote ${modelId} to APPROVED (residency ${m.residency}, retention ${m.retentionPolicy})`,
        });
        await this.o.audit.record(tx, {
          action: "ai.model.promote.request",
          resourceType: "ai_model",
          resourceId: modelId,
          after: { approval_id: id },
        });
        return { approvalId: id };
      },
      { action: "ai.model.promote.request" },
    );
  }

  private async assertPromotable(tx: Tx, m: ModelRecord, tolerance: number): Promise<void> {
    const missing: string[] = [];
    if (!m.retentionEvidenceUrl) missing.push("retention_evidence_url");
    if (!m.trainingOptOut || !m.trainingEvidenceUrl) missing.push("training opt-out evidence");
    if (!Object.keys(m.evalScores).length) missing.push("eval scores");
    if (missing.length)
      throw new IpbError("IPB-AI-013", { detail: `missing ${missing.join(", ")}` });
    // Compare with every DEFAULT serving one of this model's capabilities.
    const d = await tx.query<{ eval_scores: Record<string, number>; model_id: string }>(
      `select m.model_id, m.eval_scores from ai.default_model d
         join ai.model m on m.model_id = d.model_id where d.capability = any($1)`,
      [m.capabilities],
    );
    for (const def of d.rows)
      for (const [set, base] of Object.entries(def.eval_scores ?? {})) {
        const got = m.evalScores[set];
        if (got === undefined || got < base - tolerance)
          throw new IpbError("IPB-AI-013", {
            detail: `eval set ${set}: ${got ?? "no score"} is below ${def.model_id}'s ${base} minus ${tolerance}`,
          });
      }
  }

  private async executePromote(
    tx: Tx,
    payload: Record<string, unknown>,
    approvalId: string,
  ): Promise<void> {
    const m = await this.load(tx, String(payload.modelId));
    if (m.state !== "EVALUATING")
      throw new IpbError("IPB-AI-013", { detail: `${m.modelId} is no longer EVALUATING` });
    await this.assertPromotable(tx, m, Number(payload.tolerance ?? 0.02));
    await tx.query(
      "update ai.model set approved_by = $2, approved_at = now() where model_id = $1",
      [m.modelId, tx.ctx.principal.id],
    );
    await this.setState(tx, m, "APPROVED", { reason: "promoted", approvalId });
    this.invalidate();
  }

  /** Make an APPROVED model the DEFAULT for one capability and band (R4, IPB-03-14). */
  async requestDefault(
    ctx: KernelContext,
    modelId: string,
    capability: ModelCapability,
    band: RoutingBand,
  ): Promise<{ approvalId: string }> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const m = await this.load(tx, modelId);
        if (m.state !== "APPROVED" && m.state !== "DEFAULT")
          throw new IpbError("IPB-AI-012", { detail: `${modelId} is ${m.state}` });
        const reason = eligibility(m, {
          band,
          crossBorderAllowed: true,
          capabilities: [capability],
        });
        if (reason) throw new IpbError("IPB-AI-012", { detail: `${modelId}: ${reason}` });
        const { id } = await this.o.approvals.request(tx, {
          action: SET_DEFAULT_ACTION,
          riskClass: "R4",
          payload: { modelId, capability, band },
          summary: `Make ${modelId} the DEFAULT for ${capability} in band ${band}`,
        });
        await this.o.audit.record(tx, {
          action: "ai.model.set_default.request",
          resourceType: "ai_model",
          resourceId: modelId,
          after: { approval_id: id, capability, band },
        });
        return { approvalId: id };
      },
      { action: "ai.model.set_default.request" },
    );
  }

  private async executeSetDefault(
    tx: Tx,
    payload: Record<string, unknown>,
    approvalId: string,
  ): Promise<void> {
    const m = await this.load(tx, String(payload.modelId));
    const capability = String(payload.capability);
    const band = String(payload.band);
    if (m.state !== "APPROVED" && m.state !== "DEFAULT")
      throw new IpbError("IPB-AI-012", { detail: `${m.modelId} is ${m.state}` });
    const prev = await tx.query<{ model_id: string }>(
      "select model_id from ai.default_model where capability = $1 and band = $2",
      [capability, band],
    );
    await tx.query(
      `insert into ai.default_model (capability, band, model_id, set_by, approval_id)
       values ($1, $2, $3, $4, $5)
       on conflict (capability, band) do update
         set model_id = excluded.model_id, set_by = excluded.set_by,
             approval_id = excluded.approval_id, updated_at = now()`,
      [capability, band, m.modelId, tx.ctx.principal.id, approvalId],
    );
    if (m.state !== "DEFAULT")
      await this.setState(tx, m, "DEFAULT", {
        reason: `default ${capability}/${band}`,
        approvalId,
      });
    const old = prev.rows[0]?.model_id;
    if (old && old !== m.modelId) {
      const still = await tx.query("select 1 from ai.default_model where model_id = $1", [old]);
      if (!still.rowCount) {
        const o = await this.load(tx, old);
        if (o.state === "DEFAULT")
          await this.setState(tx, o, "APPROVED", {
            reason: `replaced by ${m.modelId}`,
            approvalId,
          });
      }
    }
    this.invalidate();
  }

  private async setState(
    tx: Tx,
    m: ModelRecord,
    to: ModelState,
    o: { reason: string; approvalId?: string; sunsetAt?: Date | null },
  ): Promise<ModelRecord> {
    const r = await tx.query<Row>(
      `update ai.model set state = $2, sunset_at = coalesce($3, sunset_at), updated_at = now()
        where model_id = $1 returning *`,
      [m.modelId, to, o.sunsetAt ?? null],
    );
    await tx.query(
      `insert into ai.model_event (model_id, from_state, to_state, actor_id, approval_id, reason)
       values ($1, $2, $3, $4, $5, $6)`,
      [m.modelId, m.state, to, tx.ctx.principal.id, o.approvalId ?? null, o.reason],
    );
    await this.o.audit.record(tx, {
      action: "ai.model.state",
      resourceType: "ai_model",
      resourceId: m.modelId,
      before: { state: m.state },
      after: { state: to, approval_id: o.approvalId ?? null },
    });
    if (this.o.outbox)
      await this.o.outbox.publish(tx, "ai", {
        envelope: internalEvent({
          product: this.o.product,
          event: AI_EVENTS.ModelStateChanged,
          tenantId: tx.ctx.tenantId,
          data: ModelStateChangedData.parse({
            model_id: m.modelId,
            from: m.state,
            to,
            actor: tx.ctx.principal.id,
            reason: o.reason,
          }),
        }),
      });
    return toRecord(r.rows[0] as Row);
  }
}

export interface EligibilityInput {
  band: RoutingBand;
  /** `trust.privacy.cross_border_ai_allowed`: false narrows every band to IN/SELF (IPB-03-24). */
  crossBorderAllowed: boolean;
  capabilities: readonly ModelCapability[];
  now?: Date;
}

/**
 * Why a model may not serve a request, or null when it may (IPB-03-19, 03-11, 03-24). Pure: the
 * routing table test runs it for every class × model.
 */
export function eligibility(m: ModelRecord, i: EligibilityInput): string | null {
  const now = i.now ?? new Date();
  const servable =
    m.state === "APPROVED" ||
    m.state === "DEFAULT" ||
    (m.state === "DEPRECATED" && m.sunsetAt !== null && m.sunsetAt.getTime() > now.getTime());
  if (!servable) return `state ${m.state}`;
  if (!m.trainingOptOut) return "no training opt-out";
  if (i.band === "self" && m.residency !== "SELF") return "SECRET needs SELF";
  if (i.band === "in_zero") {
    if (m.residency !== "IN" && m.residency !== "SELF") return `residency ${m.residency}`;
    if (m.retentionPolicy !== "ZERO") return `retention ${m.retentionPolicy}`;
  }
  if (!i.crossBorderAllowed && m.residency !== "IN" && m.residency !== "SELF")
    return `cross-border AI not allowed for the tenant (residency ${m.residency})`;
  const missing = i.capabilities.filter((c) => !m.capabilities.includes(c));
  if (missing.length) return `lacks ${missing.join(", ")}`;
  return null;
}

/** The highest class among the inputs; SECRET is the top (IPB-03-18). */
export const CLASS_RANK: Readonly<Record<DataClass, number>> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  REGULATED: 3,
  SECRET: 4,
};
export const maxClass = (...cs: DataClass[]): DataClass =>
  cs.reduce((a, b) => (CLASS_RANK[b] > CLASS_RANK[a] ? b : a), "PUBLIC");
