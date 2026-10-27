// The EMBEDDING gateway (IPB-03-04, 03-18 to 03-24, 03-27; PL4 plan §4.1, §4.9). The same rules as
// chat: kill switches, a data class raised by what the scrubber finds and never lowered, scrubbed
// text above PUBLIC, routing in the band that fails closed, failover on 429/5xx/timeout, caps, and
// one `ai.run` row (operation `embed`, no content) with its ledger entry and events. A retrieval
// index pins its embedding model, so every vector in one index version comes from one model.
import type { DataClass } from "@infrabyx/contracts/data-class";
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
} from "@infrabyx/contracts/kernel";
import {
  AI_EVENTS,
  AiProviderError,
  bandOf,
  RouteFailedClosedData,
  RunCompletedData,
  RunMeteredData,
  type EmbeddingPort,
  type LlmUsage,
} from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";
import { KillSwitches, type SettingsReader } from "./kill.js";
import { assertUnderCaps, capUse, costOf } from "./meter.js";
import { aiTrace } from "./obs.js";
import { CLASS_RANK, maxClass, type ModelRegistry } from "./registry.js";
import { Breaker, Router } from "./routing.js";
import { Scrubber } from "./scrub.js";

export interface EmbedRequest {
  featureKey: string;
  dataClass: DataClass;
  texts: readonly string[];
  /** The index's model; omitted, the band's DEFAULT `embed` model is used. */
  modelPin?: string;
  dims: number;
  taskType: "query" | "document";
  timeoutMs?: number;
}

export interface EmbedResult {
  runId: string;
  modelId: string;
  vectors: number[][];
  dataClass: DataClass;
  /** The text as embedded (scrubbed above PUBLIC): what lexical search indexes too. */
  scrubbed: string[];
}

export interface EmbeddingGatewayOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  settings: SettingsReader;
  registry: ModelRegistry;
  adapters: readonly EmbeddingPort[];
  outbox?: OutboxWriter;
  kill?: KillSwitches;
  breaker?: Breaker;
  scrubber?: Scrubber;
  now?: () => Date;
}

export class EmbeddingGateway {
  private readonly kill: KillSwitches;
  private readonly breaker: Breaker;
  private readonly router: Router<EmbeddingPort>;
  private readonly now: () => Date;

  constructor(private readonly o: EmbeddingGatewayOptions) {
    this.now = o.now ?? (() => new Date());
    this.kill = o.kill ?? new KillSwitches(o.settings);
    this.breaker = o.breaker ?? new Breaker({ failures: 5, windowSeconds: 60 });
    this.router = new Router(o.adapters, {
      settings: o.settings,
      kill: this.kill,
      breaker: this.breaker,
      now: this.now,
    });
  }

  private async scrubber(ctx: KernelContext): Promise<Scrubber> {
    if (this.o.scrubber) return this.o.scrubber;
    return new Scrubber((await this.o.settings.get(ctx, "ai.scrub.patterns")) ?? []);
  }

  async embed(ctx: KernelContext, req: EmbedRequest): Promise<EmbedResult> {
    const started = this.now().getTime();
    const runId = newId("run");
    const run = {
      outcome: "failed" as "ok" | "failed" | "refused" | "blocked",
      errorCode: null as string | null,
      dataClass: req.dataClass,
      modelId: null as string | null,
      adapterKey: null as string | null,
      routeReason: "none",
      candidates: [] as { model_id: string; reason: string }[],
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 } as LlmUsage,
      cost: null as { minorUnits: number; currency: string } | null,
      flags: [] as string[],
      failedClosed: false,
    };
    const fail = async (e: unknown, outcome: typeof run.outcome = "refused"): Promise<never> => {
      run.outcome = outcome;
      run.errorCode = (e as { code?: string }).code ?? "IPB-API-500";
      await this.record(ctx, req, runId, run, started);
      throw e;
    };

    const gate = await this.kill.gateway(ctx, req.featureKey);
    if (gate.on)
      return fail(
        new IpbError("IPB-AI-001", { detail: `${gate.on} is on`, meta: { switch: gate.on } }),
        "blocked",
      );
    let scrubber: Scrubber;
    try {
      scrubber = await this.scrubber(ctx);
    } catch (e) {
      return fail(e);
    }
    const detected = maxClass(
      ...req.texts.flatMap((t) => scrubber.detect(t).map((d) => scrubber.classOf(d.kind))),
    );
    const dataClass = maxClass(req.dataClass, detected);
    if (CLASS_RANK[dataClass] > CLASS_RANK[req.dataClass]) run.flags.push("class_raised");
    run.dataClass = dataClass;
    const scrubbed =
      dataClass === "PUBLIC" ? [...req.texts] : req.texts.map((t) => scrubber.session().scrub(t));
    const caps = await this.o.kernel.read(ctx, (tx) =>
      capUse(tx, this.o.settings, ctx, req.featureKey),
    );
    try {
      assertUnderCaps(caps);
    } catch (e) {
      return fail(e);
    }
    let crossBorder: boolean;
    try {
      crossBorder =
        (await this.o.settings.get(ctx, "trust.privacy.cross_border_ai_allowed")) === true;
    } catch {
      crossBorder = false;
    }
    let plan;
    try {
      plan = await this.router.plan(ctx, await this.o.registry.routingSnapshot(ctx), {
        featureKey: req.featureKey,
        band: bandOf(dataClass),
        capabilities: ["embed"],
        primary: "embed",
        ...(req.modelPin ? { modelPin: req.modelPin } : {}),
        crossBorderAllowed: crossBorder,
      });
    } catch (e) {
      return fail(e);
    }
    run.routeReason = plan.reason;
    run.candidates = [...plan.considered];
    let lastStatus: number | null = null;
    for (const c of plan.ordered) {
      if (c.model.embeddingDims !== null && c.model.embeddingDims !== req.dims) {
        run.candidates.push({ model_id: c.model.modelId, reason: "other dimensions" });
        continue;
      }
      try {
        const r = await aiTrace(
          "embeddings",
          {
            provider: c.adapter.descriptor.adapterKey,
            requestModel: c.model.providerModelName,
            tenantId: ctx.tenantId,
            featureKey: req.featureKey,
            dataClass,
            runId,
            routeReason: plan.reason,
          },
          () =>
            c.adapter.embed({
              model: c.model.providerModelName,
              texts: scrubbed,
              dims: req.dims,
              taskType: req.taskType,
              timeoutMs: req.timeoutMs ?? 30_000,
            }),
        );
        if (r.vectors.length !== scrubbed.length || r.vectors.some((v) => v.length !== req.dims))
          return fail(
            new IpbError("IPB-AI-011", { detail: `expected ${req.dims}-dimension vectors` }),
            "failed",
          );
        this.breaker.success(c.model.modelId);
        run.outcome = "ok";
        run.modelId = c.model.modelId;
        run.adapterKey = c.model.adapterKey;
        run.usage = r.usage;
        run.cost = costOf(c.model, r.usage);
        await this.record(ctx, req, runId, run, started);
        return { runId, modelId: c.model.modelId, vectors: r.vectors, dataClass, scrubbed };
      } catch (e) {
        if ((e as { code?: string }).code === "IPB-AI-011") throw e;
        await this.breaker.failure(c.model.modelId);
        const status = e instanceof AiProviderError ? e.status : null;
        run.candidates.push({ model_id: c.model.modelId, reason: `failed ${status ?? "error"}` });
        if (e instanceof AiProviderError && e.retryable) {
          lastStatus = status;
          continue;
        }
        run.modelId = c.model.modelId;
        run.adapterKey = c.model.adapterKey;
        return fail(
          new IpbError("IPB-AI-021", {
            detail: "the provider refused the request",
            meta: { degraded: true },
          }),
        );
      }
    }
    const code = lastStatus === 429 ? "IPB-AI-023" : "IPB-AI-021";
    run.failedClosed = code === "IPB-AI-021";
    return fail(
      new IpbError(code, {
        detail: plan.ordered.length ? "every eligible model failed" : "no eligible model",
        meta: { degraded: true },
      }),
    );
  }

  private async record(
    ctx: KernelContext,
    req: EmbedRequest,
    runId: string,
    run: {
      outcome: string;
      errorCode: string | null;
      dataClass: DataClass;
      modelId: string | null;
      adapterKey: string | null;
      routeReason: string;
      candidates: { model_id: string; reason: string }[];
      usage: LlmUsage;
      cost: { minorUnits: number; currency: string } | null;
      flags: string[];
      failedClosed: boolean;
    },
    started: number,
  ): Promise<void> {
    const durationMs = this.now().getTime() - started;
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `insert into ai.run
             (id, tenant_id, feature_key, principal_id, principal_type, operation, data_class,
              band, model_id, adapter_key, outcome, error_code, route_reason, candidates,
              tokens_in, tokens_out, cached_tokens, cost_minor_units, currency, guard_flags,
              duration_ms)
           values ($1, $2, $3, $4, $5, 'embed', $6, $7, $8, $9, $10, $11, $12, $13, $14, 0, 0,
                   $15, $16, $17, $18)`,
          [
            runId,
            ctx.tenantId,
            req.featureKey,
            ctx.principal.id,
            ctx.principal.type,
            run.dataClass,
            bandOf(run.dataClass),
            run.modelId,
            run.adapterKey,
            run.outcome,
            run.errorCode,
            run.routeReason,
            JSON.stringify(run.candidates),
            run.usage.inputTokens,
            run.cost?.minorUnits ?? null,
            run.cost?.currency ?? null,
            run.flags,
            durationMs,
          ],
        );
        await this.o.audit.record(tx, {
          action: "ai.run",
          resourceType: "ai_run",
          resourceId: runId,
          after: {
            outcome: run.outcome,
            error: run.errorCode,
            model_id: run.modelId,
            data_class: run.dataClass,
            route: run.routeReason,
          },
        });
        const outbox = this.o.outbox;
        if (!outbox) return;
        const emit = (event: { module: string; name: string }, data: Record<string, unknown>) =>
          outbox.publish(tx, "ai", {
            envelope: internalEvent({
              product: this.o.product,
              event,
              tenantId: ctx.tenantId,
              data,
            }),
          });
        if (run.failedClosed)
          await emit(
            AI_EVENTS.RouteFailedClosed,
            RouteFailedClosedData.parse({
              tenant_id: ctx.tenantId,
              feature_key: req.featureKey,
              data_class: run.dataClass,
              candidates_considered: run.candidates,
            }),
          );
        if (!run.modelId || run.outcome !== "ok") return;
        const tokens = { input_tokens: run.usage.inputTokens, output_tokens: 0, cached_tokens: 0 };
        await emit(
          AI_EVENTS.RunCompleted,
          RunCompletedData.parse({
            run_id: runId,
            tenant_id: ctx.tenantId,
            feature_key: req.featureKey,
            model_id: run.modelId,
            data_class: run.dataClass,
            usage: tokens,
            cost_minor_units: run.cost?.minorUnits ?? null,
            currency: run.cost?.currency ?? null,
            guard_flags: run.flags,
            duration_ms: durationMs,
          }),
        );
        await emit(
          AI_EVENTS.RunMetered,
          RunMeteredData.parse({
            run_id: runId,
            tenant_id: ctx.tenantId,
            feature_key: req.featureKey,
            cost_minor_units: run.cost?.minorUnits ?? null,
            currency: run.cost?.currency ?? null,
            tokens,
          }),
        );
      },
      { action: "ai.run" },
    );
  }
}
