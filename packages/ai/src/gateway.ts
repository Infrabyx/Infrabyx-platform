// The LLM gateway (IPB-03 §03.3.A–H, §03.4.2, §03.4.5; PL4 plan §4). The only path from Infrabyx
// code to a language model. For each call it: checks the kill switches; computes the data class
// (never lower than any input); resolves and renders the prompt; checks the cost caps; routes
// within the band and fails closed; calls the adapter with failover on 429/5xx/timeout; enforces
// the tool allow-list; and records one `ai.run` row with a ledger entry and the RunCompleted and
// RunMetered events. No prompt or completion text is logged, traced or stored in the run.
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
  AiProvenance,
  bandOf,
  CostCapReachedData,
  GuardrailTriggeredData,
  RouteFailedClosedData,
  RunCompletedData,
  RunMeteredData,
  type ChatMessage,
  type DataBlock,
  type LlmPort,
  type LlmPortRequest,
  type LlmPortResult,
  type LlmUsage,
  type ModelCapability,
  type RoutingBand,
  type StopReason,
  type ToolCall,
  type ToolSpec,
} from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";
import { KillSwitches, type SettingsReader } from "./kill.js";
import { assertUnderCaps, capUse, costOf, crossings, type CapUse } from "./meter.js";
import { aiTrace } from "./obs.js";
import { renderTemplate, type PromptRegistry, type PromptVersion } from "./prompts.js";
import { CLASS_RANK, maxClass, type ModelRegistry } from "./registry.js";
import { Breaker, Router, type RouteCandidate } from "./routing.js";
import { DATA_INSTRUCTION, wrapDataBlocks } from "./separation.js";

export interface LlmRequest {
  featureKey: string;
  skillKey?: string;
  /** The class the caller states; raised to the highest input class, never lowered (IPB-03-18). */
  dataClass: DataClass;
  /** `prompt_key@major` (IPB-03-25). */
  promptRef: string;
  variables?: Readonly<Record<string, unknown>>;
  /** Prior turns, already scrubbed. */
  messages?: readonly ChatMessage[];
  /** Data, never instructions (IPB-03-34). */
  dataBlocks?: readonly DataBlock[];
  modelPin?: string;
  maxOutputTokens?: number;
  temperature?: number;
  stop?: readonly string[];
  budget?: { timeoutMs?: number; costMinorUnits?: number };
  idempotencyKey?: string;
}

export interface LlmToolsRequest extends LlmRequest {
  tools: readonly ToolSpec[];
  toolChoice?: "auto" | "none" | { name: string };
}

export interface LlmResult {
  runId: string;
  modelId: string;
  adapterKey: string;
  text: string;
  toolCalls: ToolCall[];
  usage: LlmUsage;
  cost: { minorUnits: number; currency: string } | null;
  stopReason: StopReason;
  routeReason: string;
  candidatesConsidered: { model_id: string; reason: string }[];
  guard: { inputFlags: string[]; outputFlags: string[] };
  provenance: AiProvenance;
  dataClass: DataClass;
}

export interface LlmGatewayOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  settings: SettingsReader;
  registry: ModelRegistry;
  prompts: PromptRegistry;
  adapters: readonly LlmPort[];
  outbox?: OutboxWriter;
  kill?: KillSwitches;
  breaker?: Breaker;
  /** `ai.routing.breaker_failures` and `ai.routing.breaker_window_s`, read at boot (5 and 60). */
  breakerFailures?: number;
  breakerWindowSeconds?: number;
  /** Hosts whose markdown links survive inside data blocks. */
  allowedLinkHosts?: readonly string[];
  now?: () => Date;
}

type Op = "chat" | "tools" | "stream";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 1024;

interface Prepared {
  dataClass: DataClass;
  band: RoutingBand;
  prompt: PromptVersion;
  system: string;
  messages: ChatMessage[];
  inputFlags: string[];
  caps: CapUse[];
}

interface RunRecord {
  id: string;
  featureKey: string;
  skillKey?: string;
  operation: Op;
  dataClass: DataClass;
  band: RoutingBand;
  prompt?: PromptVersion;
  modelId?: string;
  adapterKey?: string;
  outcome: "ok" | "failed" | "refused" | "blocked";
  errorCode?: string;
  routeReason: string;
  candidates: { model_id: string; reason: string }[];
  usage?: LlmUsage;
  cost?: { minorUnits: number; currency: string } | null;
  guardFlags: string[];
  providerRequestId?: string | null;
  durationMs: number;
  caps?: CapUse[];
  guardEvent?: { kind: string; action: string };
  failedClosed?: boolean;
}

export class LlmGateway {
  private readonly kill: KillSwitches;
  private readonly breaker: Breaker;
  private readonly router: Router<LlmPort>;
  private readonly now: () => Date;

  constructor(private readonly o: LlmGatewayOptions) {
    this.now = o.now ?? (() => new Date());
    this.kill = o.kill ?? new KillSwitches(o.settings);
    this.breaker =
      o.breaker ??
      new Breaker({
        failures: () => o.breakerFailures ?? 5,
        windowSeconds: () => o.breakerWindowSeconds ?? 60,
      });
    this.router = new Router(o.adapters, {
      settings: o.settings,
      kill: this.kill,
      breaker: this.breaker,
      now: this.now,
    });
  }

  /** Plain completion (IPB-03-02 `chat`). */
  chat(ctx: KernelContext, req: LlmRequest): Promise<LlmResult> {
    return this.execute(ctx, "chat", req, undefined);
  }

  /** Function calling with the skill's tool allow-list (IPB-03-02 `tools`, IPB-03-35). */
  tools(ctx: KernelContext, req: LlmToolsRequest): Promise<LlmResult> {
    return this.execute(ctx, "tools", req, req);
  }

  /** `batch` is declared and refused until an adapter supports it (PL4 plan §4.1). */
  async batch(): Promise<never> {
    throw new IpbError("IPB-AI-010", { detail: "no configured adapter supports batch" });
  }

  private async prepare(ctx: KernelContext, req: LlmRequest, run: RunRecord): Promise<Prepared> {
    const gate = await this.kill.gateway(ctx, req.featureKey);
    if (gate.on) {
      run.outcome = "blocked";
      throw new IpbError("IPB-AI-001", { detail: `${gate.on} is on`, meta: { switch: gate.on } });
    }
    const blocksMax = maxClass(...(req.dataBlocks ?? []).map((b) => b.dataClass));
    if (CLASS_RANK[req.dataClass] < CLASS_RANK[blocksMax]) {
      run.outcome = "refused";
      throw new IpbError("IPB-AI-020", {
        detail: `stated ${req.dataClass} is below an input of class ${blocksMax}`,
      });
    }
    const dataClass = maxClass(req.dataClass, blocksMax);
    const band = bandOf(dataClass);
    run.dataClass = dataClass;
    run.band = band;
    const prompt = await this.o.prompts.resolve(ctx, req.promptRef);
    run.prompt = prompt;
    if (CLASS_RANK[dataClass] > CLASS_RANK[prompt.dataClassMax]) {
      run.outcome = "refused";
      throw new IpbError("IPB-AI-012", {
        detail: `${dataClass} data is above ${prompt.promptKey}@${prompt.version}'s ${prompt.dataClassMax}`,
      });
    }
    const system = renderTemplate(prompt.template, req.variables ?? {});
    const inputFlags: string[] = [];
    const messages: ChatMessage[] = [...(req.messages ?? [])];
    if (req.dataBlocks?.length) {
      const w = wrapDataBlocks(req.dataBlocks, this.o.allowedLinkHosts ?? []);
      if (w.neutralised) inputFlags.push("injection_neutralised");
      const first = messages[0];
      if (first && first.role === "user")
        messages[0] = { role: "user", content: `${w.text}\n\n${first.content}` };
      else messages.unshift({ role: "user", content: w.text });
    }
    if (!messages.length) messages.push({ role: "user", content: "Follow the instructions." });
    const caps = await this.o.kernel.read(ctx, (tx) =>
      capUse(tx, this.o.settings, ctx, req.featureKey),
    );
    try {
      assertUnderCaps(caps);
    } catch (e) {
      run.outcome = "refused";
      throw e;
    }
    return {
      dataClass,
      band,
      prompt,
      system: req.dataBlocks?.length ? `${system}\n\n${DATA_INSTRUCTION}` : system,
      messages,
      inputFlags,
      caps,
    };
  }

  private async crossBorder(ctx: KernelContext): Promise<boolean> {
    try {
      return (await this.o.settings.get(ctx, "trust.privacy.cross_border_ai_allowed")) === true;
    } catch {
      return false;
    }
  }

  private portRequest(
    c: RouteCandidate<LlmPort>,
    p: Prepared,
    req: LlmRequest,
    tools: LlmToolsRequest | undefined,
  ): LlmPortRequest {
    return {
      model: c.model.providerModelName,
      system: p.system,
      messages: p.messages,
      ...(tools
        ? { tools: tools.tools, ...(tools.toolChoice ? { toolChoice: tools.toolChoice } : {}) }
        : {}),
      maxOutputTokens: Math.min(
        req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
        c.model.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
      ),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.stop ? { stop: req.stop } : {}),
      timeoutMs: req.budget?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : {}),
    };
  }

  private async execute(
    ctx: KernelContext,
    op: Op,
    req: LlmRequest,
    tools: LlmToolsRequest | undefined,
  ): Promise<LlmResult> {
    const started = this.now().getTime();
    const run: RunRecord = {
      id: newId("run"),
      featureKey: req.featureKey,
      ...(req.skillKey ? { skillKey: req.skillKey } : {}),
      operation: op,
      dataClass: req.dataClass,
      band: bandOf(req.dataClass),
      outcome: "failed",
      routeReason: "none",
      candidates: [],
      guardFlags: [],
      durationMs: 0,
    };
    const finish = async () => {
      run.durationMs = this.now().getTime() - started;
      await this.record(ctx, run);
    };
    let p: Prepared;
    try {
      p = await this.prepare(ctx, req, run);
    } catch (e) {
      run.errorCode = (e as { code?: string }).code ?? "IPB-API-500";
      await finish();
      throw e;
    }
    run.guardFlags.push(...p.inputFlags);
    const capabilities: ModelCapability[] = tools ? ["chat", "tools"] : ["chat"];
    let plan;
    try {
      plan = await this.router.plan(ctx, await this.o.registry.routingSnapshot(ctx), {
        featureKey: req.featureKey,
        band: p.band,
        capabilities,
        primary: "chat",
        ...(req.modelPin ? { modelPin: req.modelPin } : {}),
        crossBorderAllowed: await this.crossBorder(ctx),
      });
    } catch (e) {
      run.outcome = "refused";
      run.errorCode = (e as { code?: string }).code ?? "IPB-API-500";
      await finish();
      throw e;
    }
    run.routeReason = plan.reason;
    run.candidates = [...plan.considered];

    let lastStatus: number | null = null;
    for (const c of plan.ordered) {
      const preq = this.portRequest(c, p, req, tools);
      const budget = req.budget?.costMinorUnits;
      if (budget !== undefined) {
        const est = c.adapter.estimateTokens(preq);
        const cost = costOf(c.model, {
          inputTokens: est.input,
          outputTokens: est.output,
          cachedTokens: 0,
        });
        if (cost && cost.minorUnits > budget) {
          run.candidates.push({ model_id: c.model.modelId, reason: "over the call budget" });
          continue;
        }
      }
      let res: LlmPortResult;
      try {
        res = await aiTrace(
          "chat",
          {
            provider: c.adapter.descriptor.adapterKey,
            requestModel: c.model.providerModelName,
            tenantId: ctx.tenantId,
            featureKey: req.featureKey,
            dataClass: p.dataClass,
            runId: run.id,
            routeReason: plan.reason,
          },
          async (span) => {
            const r = await c.adapter.chat(preq);
            span.set({
              ...(r.responseModel ? { responseModel: r.responseModel } : {}),
              inputTokens: r.usage.inputTokens,
              outputTokens: r.usage.outputTokens,
            });
            return r;
          },
        );
      } catch (e) {
        if (e instanceof AiProviderError && e.retryable) {
          lastStatus = e.status;
          await this.breaker.failure(c.model.modelId);
          run.candidates.push({
            model_id: c.model.modelId,
            reason: `failed ${e.status ?? "timeout"}`,
          });
          continue;
        }
        await this.breaker.failure(c.model.modelId);
        run.modelId = c.model.modelId;
        run.adapterKey = c.model.adapterKey;
        run.errorCode = "IPB-AI-021";
        run.candidates.push({
          model_id: c.model.modelId,
          reason: `failed ${(e as AiProviderError).status ?? "error"}`,
        });
        await finish();
        throw new IpbError("IPB-AI-021", {
          detail: "the provider refused the request",
          meta: { degraded: true },
        });
      }
      this.breaker.success(c.model.modelId);
      run.modelId = c.model.modelId;
      run.adapterKey = c.model.adapterKey;
      run.usage = res.usage;
      run.cost = costOf(c.model, res.usage);
      run.providerRequestId = res.providerRequestId;
      run.caps = p.caps;
      // IPB-03-35: a tool the request did not allow halts the run.
      const allowed = new Set((tools?.tools ?? []).map((t) => t.name));
      const rogue = res.toolCalls.filter((t) => !allowed.has(t.name));
      if (rogue.length) {
        run.outcome = "refused";
        run.errorCode = "IPB-AI-040";
        run.guardFlags.push("tool_disallowed");
        run.guardEvent = { kind: "tool_disallowed", action: "halt" };
        await finish();
        throw new IpbError("IPB-AI-040", {
          detail: `the model called tools outside the allow-list`,
          meta: { tools: rogue.map((t) => t.name) },
        });
      }
      run.outcome = "ok";
      await finish();
      return {
        runId: run.id,
        modelId: c.model.modelId,
        adapterKey: c.model.adapterKey,
        text: res.text,
        toolCalls: res.toolCalls,
        usage: res.usage,
        cost: run.cost,
        stopReason: res.stopReason,
        routeReason: plan.reason,
        candidatesConsidered: run.candidates,
        guard: { inputFlags: p.inputFlags, outputFlags: [] },
        provenance: AiProvenance.parse({
          generated_by: "vidhi",
          model_id: c.model.modelId,
          prompt_ref: `${p.prompt.promptKey}@${p.prompt.version}`,
          prompt_hash: p.prompt.contentSha256,
          run_id: run.id,
          created_at: this.now().toISOString(),
          c2pa_manifest_ref: null,
        }),
        dataClass: p.dataClass,
      };
    }
    // Nothing eligible, or every eligible candidate failed: fail closed (IPB-03-20).
    const code = lastStatus === 429 ? "IPB-AI-023" : "IPB-AI-021";
    run.outcome = "refused";
    run.errorCode = code;
    run.failedClosed = code === "IPB-AI-021";
    await finish();
    throw new IpbError(code, {
      detail: plan.ordered.length ? "every eligible model failed" : "no eligible model",
      meta: { degraded: true, candidates: run.candidates.length },
    });
  }

  /** One `ai.run` row, its ledger entry and events, in one transaction. */
  private async record(ctx: KernelContext, run: RunRecord): Promise<void> {
    const usage = run.usage ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `insert into ai.run
             (id, tenant_id, feature_key, skill_key, principal_id, principal_type, operation,
              data_class, band, prompt_ref, prompt_sha256, model_id, adapter_key, outcome,
              error_code, route_reason, candidates, tokens_in, tokens_out, cached_tokens,
              cost_minor_units, currency, guard_flags, provider_request_id, duration_ms)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                   $18, $19, $20, $21, $22, $23, $24, $25)`,
          [
            run.id,
            ctx.tenantId,
            run.featureKey,
            run.skillKey ?? null,
            ctx.principal.id,
            ctx.principal.type,
            run.operation,
            run.dataClass,
            run.band,
            run.prompt ? `${run.prompt.promptKey}@${run.prompt.version}` : null,
            run.prompt?.contentSha256 ?? null,
            run.modelId ?? null,
            run.adapterKey ?? null,
            run.outcome,
            run.errorCode ?? null,
            run.routeReason,
            JSON.stringify(run.candidates),
            usage.inputTokens,
            usage.outputTokens,
            usage.cachedTokens,
            run.cost?.minorUnits ?? null,
            run.cost?.currency ?? null,
            run.guardFlags,
            run.providerRequestId ?? null,
            run.durationMs,
          ],
        );
        await this.o.audit.record(tx, {
          action: "ai.run",
          resourceType: "ai_run",
          resourceId: run.id,
          after: {
            outcome: run.outcome,
            error: run.errorCode ?? null,
            model_id: run.modelId ?? null,
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
              feature_key: run.featureKey,
              data_class: run.dataClass,
              candidates_considered: run.candidates,
            }),
          );
        if (run.guardEvent)
          await emit(
            AI_EVENTS.GuardrailTriggered,
            GuardrailTriggeredData.parse({ run_id: run.id, ...run.guardEvent }),
          );
        if (!run.modelId) return;
        const tokens = {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cached_tokens: usage.cachedTokens,
        };
        await emit(
          AI_EVENTS.RunCompleted,
          RunCompletedData.parse({
            run_id: run.id,
            tenant_id: ctx.tenantId,
            feature_key: run.featureKey,
            model_id: run.modelId,
            data_class: run.dataClass,
            usage: tokens,
            cost_minor_units: run.cost?.minorUnits ?? null,
            currency: run.cost?.currency ?? null,
            guard_flags: run.guardFlags,
            duration_ms: run.durationMs,
          }),
        );
        await emit(
          AI_EVENTS.RunMetered,
          RunMeteredData.parse({
            run_id: run.id,
            tenant_id: ctx.tenantId,
            feature_key: run.featureKey,
            cost_minor_units: run.cost?.minorUnits ?? null,
            currency: run.cost?.currency ?? null,
            tokens,
          }),
        );
        for (const c of crossings(run.caps ?? [], {
          minor: run.cost?.minorUnits ?? null,
          tokens: usage.inputTokens + usage.outputTokens,
        }))
          await emit(
            AI_EVENTS.CostCapReached,
            CostCapReachedData.parse({
              tenant_id: ctx.tenantId,
              scope: c.scope,
              cap: c.cap,
              used: c.after,
              level: c.level,
            }),
          );
      },
      { action: "ai.run" },
    );
  }
}
