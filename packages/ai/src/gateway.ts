// The LLM gateway (IPB-03 §03.3.A–H, §03.4.2, §03.4.5; PL4 plan §4). The only path from Infrabyx
// code to a language model. For each call it: checks the kill switches; computes the data class
// (never lower than any input, raised by the PII the scrubber finds); applies the per-user rate
// and input-size limits; runs the input classifier; resolves and renders the prompt; scrubs every
// outbound text above PUBLIC into reversible tokens; checks the cost caps; routes within the band
// and fails closed; calls the adapter with failover on 429/5xx/timeout; enforces the tool
// allow-list; runs the output classifier, restores the tokens and, for `structured`, validates the
// JSON with one repair turn; and records one `ai.run` row with a ledger entry and the
// RunCompleted, RunMetered and GuardrailTriggered events. No prompt or completion text is logged,
// traced or stored in the run.
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
  type Citation,
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
import { newId, sha256Hex } from "@infrabyx/crypto";
import { z } from "zod";
import { checkOutput, classifyInput, type GuardKind, type OutputPolicy } from "./guard.js";
import { keySegment, KillSwitches, type SettingsReader } from "./kill.js";
import { assertUnderCaps, capUse, costOf, crossings, type CapUse } from "./meter.js";
import { aiTrace } from "./obs.js";
import { insertRunHold, type RunHold } from "./retention.js";
import { renderTemplate, type PromptRegistry, type PromptVersion } from "./prompts.js";
import { CLASS_RANK, maxClass, type ModelRegistry } from "./registry.js";
import { Scrubber, type ScrubSession } from "./scrub.js";
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
  /**
   * The approval, statutory output or maker-checker request this run belongs to: the run row is
   * then kept as long as that record is kept, never by the 180-day sweep (PL4-D-05).
   */
  hold?: RunHold;
}

export interface LlmToolsRequest extends LlmRequest {
  tools: readonly ToolSpec[];
  toolChoice?: "auto" | "none" | { name: string };
}

/** `structured` (IPB-03-36): the answer must be JSON valid against `schema` (JSON Schema). */
export interface LlmStructuredRequest extends LlmRequest {
  schema: Record<string, unknown>;
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
  /** True when the output classifier withheld the answer (`IPB-AI-042`, "200 with blocked"). */
  blocked: boolean;
  /** Citations to the request's data blocks (IPB-03-31). */
  citations: Citation[];
  /** Data blocks were retrieved but the answer cites none of them (IPB-03-31). */
  ungrounded: boolean;
  /** The validated JSON of a `structured` call. */
  data?: unknown;
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
  /** Overrides the scrubber built from `ai.scrub.patterns` (tests). */
  scrubber?: Scrubber;
  now?: () => Date;
}

type Op = "chat" | "tools" | "stream" | "structured";
interface StructuredSpec {
  schema: Record<string, unknown>;
  validator: z.ZodType;
}
const REPAIR_INSTRUCTION =
  "Your previous reply was not valid JSON for the required schema. Reply again with only the corrected JSON object, and nothing else.";

/** The JSON inside a reply: the whole text, or the first fenced block. */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  try {
    return { ok: true, value: JSON.parse((fenced ? fenced[1] : text) ?? "") };
  } catch {
    return { ok: false };
  }
}
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT = 1024;

interface Prepared {
  dataClass: DataClass;
  band: RoutingBand;
  prompt: PromptVersion;
  /** As sent: rendered, with the data instruction when blocks are present, and scrubbed. */
  system: string;
  messages: ChatMessage[];
  inputFlags: string[];
  caps: CapUse[];
  scrubber: Scrubber;
  /** Null for PUBLIC requests, which are not scrubbed. */
  session: ScrubSession | null;
  policy: OutputPolicy;
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
  guardEvents: { kind: GuardKind | "tool_disallowed"; action: string }[];
  failedClosed?: boolean;
  hold?: RunHold;
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

  /**
   * JSON valid against `req.schema` (IPB-03-36): native JSON mode where the model record declares
   * `structured`, schema validation always, one bounded repair turn, then `IPB-AI-041`.
   */
  structured(ctx: KernelContext, req: LlmStructuredRequest): Promise<LlmResult> {
    let validator: z.ZodType;
    try {
      validator = z.fromJSONSchema(req.schema as Parameters<typeof z.fromJSONSchema>[0]);
    } catch {
      return Promise.reject(
        new IpbError("IPB-AI-041", { detail: "the output schema is not a usable JSON Schema" }),
      );
    }
    return this.execute(ctx, "structured", req, undefined, { schema: req.schema, validator });
  }

  /** `batch` is declared and refused until an adapter supports it (PL4 plan §4.1). */
  async batch(): Promise<never> {
    throw new IpbError("IPB-AI-010", { detail: "no configured adapter supports batch" });
  }

  private async setting<T>(ctx: KernelContext, key: string, fallback: T): Promise<T> {
    try {
      const v = await this.o.settings.get(ctx, key);
      return v === null || v === undefined ? fallback : (v as T);
    } catch {
      return fallback;
    }
  }

  private scrubberCache: { key: string; scrubber: Scrubber } | null = null;
  /** The scrubber for `ai.scrub.patterns`; an unreadable or invalid setting fails closed. */
  private async scrubberFor(ctx: KernelContext): Promise<Scrubber> {
    if (this.o.scrubber) return this.o.scrubber;
    const extra = await this.o.settings.get(ctx, "ai.scrub.patterns");
    const key = JSON.stringify(extra ?? []);
    if (this.scrubberCache?.key !== key)
      this.scrubberCache = { key, scrubber: new Scrubber(extra ?? []) };
    return this.scrubberCache.scrubber;
  }

  private async prepare(ctx: KernelContext, req: LlmRequest, run: RunRecord): Promise<Prepared> {
    const gate = await this.kill.gateway(ctx, req.featureKey);
    if (gate.on) {
      run.outcome = "blocked";
      throw new IpbError("IPB-AI-001", { detail: `${gate.on} is on`, meta: { switch: gate.on } });
    }
    const feature = keySegment(req.featureKey);
    // IPB-03-38: runs per user per hour.
    const perHour = await this.setting<number>(ctx, "ai.limits.user_runs_per_hour", 120);
    const recent = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ n: number }>(
        `select count(*)::int as n from ai.run
          where principal_id = $1 and created_at > now() - interval '1 hour'`,
        [ctx.principal.id],
      );
      return r.rows[0]?.n ?? 0;
    });
    if (recent >= perHour) {
      run.outcome = "refused";
      throw new IpbError("IPB-SEC-019", { meta: { limit: "ai.limits.user_runs_per_hour" } });
    }

    const blocksMax = maxClass(...(req.dataBlocks ?? []).map((b) => b.dataClass));
    if (CLASS_RANK[req.dataClass] < CLASS_RANK[blocksMax]) {
      run.outcome = "refused";
      throw new IpbError("IPB-AI-020", {
        detail: `stated ${req.dataClass} is below an input of class ${blocksMax}`,
      });
    }
    // IPB-03-18, 03-28: what the scrubber finds raises the class; scrubbing never lowers it.
    const scrubber = await this.scrubberFor(ctx);
    const variableText = Object.values(req.variables ?? {}).map((v) =>
      typeof v === "string" ? v : JSON.stringify(v),
    );
    const inputs = [
      ...variableText,
      ...(req.messages ?? []).map((m) => m.content),
      ...(req.dataBlocks ?? []).map((b) => b.text),
    ];
    const detected = maxClass(
      ...inputs.flatMap((t) => scrubber.detect(t).map((d) => scrubber.classOf(d.kind))),
    );
    const dataClass = maxClass(req.dataClass, blocksMax, detected);
    const inputFlags: string[] = [];
    if (CLASS_RANK[dataClass] > CLASS_RANK[maxClass(req.dataClass, blocksMax)])
      inputFlags.push("class_raised");
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

    // IPB-03-33: the input classifier, over the caller's own text (data blocks are data).
    const threshold = await this.setting<number>(ctx, `ai.guard.input_threshold.${feature}`, 0.7);
    const verdict = classifyInput([
      ...variableText,
      ...(req.messages ?? []).filter((m) => m.role === "user").map((m) => m.content),
    ]);
    if (verdict.score >= threshold) {
      run.outcome = "refused";
      run.guardFlags.push("injection_blocked");
      run.guardEvents.push({ kind: "injection", action: "refuse" });
      throw new IpbError("IPB-AI-042", {
        detail: "the request was blocked by the input classifier",
        meta: { blocked: true, stage: "input", score: verdict.score },
      });
    }

    let system = renderTemplate(prompt.template, req.variables ?? {});
    const messages: ChatMessage[] = [...(req.messages ?? [])];
    if (req.dataBlocks?.length) {
      const w = wrapDataBlocks(req.dataBlocks, this.o.allowedLinkHosts ?? []);
      if (w.neutralised) {
        inputFlags.push("injection_neutralised");
        run.guardEvents.push({ kind: "injection", action: "neutralise" });
      }
      const first = messages[0];
      if (first && first.role === "user")
        messages[0] = { role: "user", content: `${w.text}\n\n${first.content}` };
      else messages.unshift({ role: "user", content: w.text });
      system = `${system}\n\n${DATA_INSTRUCTION}`;
    }
    if (!messages.length) messages.push({ role: "user", content: "Follow the instructions." });

    // IPB-03-38: oversized input is refused for the caller to chunk; never truncated silently.
    const maxTokens = await this.setting<number>(ctx, "ai.limits.max_input_tokens", 200_000);
    const chars = system.length + messages.reduce((n, m) => n + m.content.length, 0);
    const estimated = Math.ceil(chars / 4);
    if (estimated > maxTokens) {
      run.outcome = "refused";
      throw new IpbError("IPB-SEC-013", {
        detail: "the input is larger than ai.limits.max_input_tokens; split it and retry",
        meta: { truncated: false, estimated_tokens: estimated, limit: maxTokens },
      });
    }

    // IPB-03-27: every outbound text above PUBLIC is scrubbed into reversible tokens.
    let session: ScrubSession | null = null;
    let sent: ChatMessage[] = messages;
    if (dataClass !== "PUBLIC") {
      const sc = scrubber.session();
      session = sc;
      system = sc.scrub(system);
      sent = messages.map((m) => ({ role: m.role, content: sc.scrub(m.content) }));
      if (sc.detections.length) inputFlags.push("scrubbed");
    }

    const caps = await this.o.kernel.read(ctx, (tx) =>
      capUse(tx, this.o.settings, ctx, req.featureKey),
    );
    try {
      assertUnderCaps(caps);
    } catch (e) {
      run.outcome = "refused";
      throw e;
    }
    const policy = await this.setting<OutputPolicy>(
      ctx,
      `ai.guard.output_policy.${feature}`,
      "redact",
    );
    return {
      dataClass,
      band,
      prompt,
      system,
      messages: sent,
      inputFlags,
      caps,
      scrubber,
      session,
      policy: policy === "refuse" ? "refuse" : "redact",
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
    structured?: StructuredSpec,
  ): LlmPortRequest {
    return {
      model: c.model.providerModelName,
      system: p.system,
      messages: p.messages,
      // Native JSON mode only where the model record declares it; validation always follows.
      ...(structured && c.model.capabilities.includes("structured")
        ? { schema: structured.schema }
        : {}),
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
    structured?: StructuredSpec,
  ): Promise<LlmResult> {
    const started = this.now().getTime();
    const run: RunRecord = {
      id: newId("run"),
      featureKey: req.featureKey,
      ...(req.skillKey ? { skillKey: req.skillKey } : {}),
      ...(req.hold ? { hold: req.hold } : {}),
      operation: op,
      dataClass: req.dataClass,
      band: bandOf(req.dataClass),
      outcome: "failed",
      routeReason: "none",
      candidates: [],
      guardFlags: [],
      guardEvents: [],
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
      const preq = this.portRequest(c, p, req, tools, structured);
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
        run.guardEvents.push({ kind: "tool_disallowed", action: "halt" });
        await finish();
        throw new IpbError("IPB-AI-040", {
          detail: `the model called tools outside the allow-list`,
          meta: { tools: rogue.map((t) => t.name) },
        });
      }

      // IPB-03-37, 03-39: the output classifier, on the text as the model wrote it (tokens in).
      const blocks = req.dataBlocks ?? [];
      const sourceIds = blocks.length ? new Set(blocks.map((b) => b.sourceId)) : null;
      const check = (raw: string) => {
        const out = checkOutput(raw, {
          scrubber: p.scrubber,
          systemPrompt: p.system,
          sourceIds,
          policy: p.policy,
        });
        for (const f of out.flags) if (!run.guardFlags.includes(f)) run.guardFlags.push(f);
        run.guardEvents.push(...out.events);
        return out;
      };
      const restore = (t: string) => (p.session ? p.session.restore(t) : t);
      let out = check(res.text);
      let data: unknown;
      // IPB-03-36: structured output is validated, with one bounded repair turn.
      if (structured && !out.blocked) {
        const validate = (text: string) => {
          const j = parseJson(restore(text));
          if (!j.ok) return { ok: false as const };
          const v = structured.validator.safeParse(j.value);
          return v.success ? { ok: true as const, value: v.data } : { ok: false as const };
        };
        let v = validate(out.text);
        if (!v.ok) {
          run.guardFlags.push("schema_repair");
          let repaired: LlmPortResult | null;
          try {
            repaired = await c.adapter.chat({
              ...preq,
              messages: [
                ...preq.messages,
                { role: "assistant", content: res.text },
                { role: "user", content: REPAIR_INSTRUCTION },
              ],
            });
          } catch {
            repaired = null;
          }
          if (repaired) {
            run.usage = {
              inputTokens: run.usage.inputTokens + repaired.usage.inputTokens,
              outputTokens: run.usage.outputTokens + repaired.usage.outputTokens,
              cachedTokens: run.usage.cachedTokens + repaired.usage.cachedTokens,
            };
            run.cost = costOf(c.model, run.usage);
            out = check(repaired.text);
            v = out.blocked ? { ok: false } : validate(out.text);
          }
          if (!out.blocked && !v.ok) {
            run.outcome = "refused";
            run.errorCode = "IPB-AI-041";
            run.guardFlags.push("schema_invalid");
            run.guardEvents.push({ kind: "schema", action: "refuse" });
            await finish();
            throw new IpbError("IPB-AI-041", {
              detail: "the output failed schema validation after one repair",
            });
          }
        }
        if (v.ok) data = v.value;
      }
      const cited: Citation[] = out.cited.map((id) => {
        const b = blocks.find((x) => x.sourceId === id) as DataBlock;
        return {
          source_id: id,
          resource_ref: b.resourceRef ?? null,
          locator: b.locator ?? null,
          quote_hash: sha256Hex(b.text),
        };
      });
      const ungrounded = blocks.some((b) => b.kind === "retrieved") && !cited.length;
      if (ungrounded) run.guardFlags.push("ungrounded");
      if (out.blocked) run.errorCode = "IPB-AI-042";
      run.outcome = out.blocked ? "refused" : "ok";
      await finish();
      return {
        runId: run.id,
        modelId: c.model.modelId,
        adapterKey: c.model.adapterKey,
        text: out.blocked ? "" : restore(out.text),
        toolCalls: res.toolCalls.map((t) => ({
          ...t,
          arguments: p.session ? p.session.restoreDeep(t.arguments) : t.arguments,
        })),
        usage: run.usage,
        cost: run.cost,
        stopReason: res.stopReason,
        routeReason: plan.reason,
        candidatesConsidered: run.candidates,
        guard: { inputFlags: p.inputFlags, outputFlags: out.flags },
        blocked: out.blocked,
        citations: cited,
        ungrounded,
        ...(data !== undefined ? { data } : {}),
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
        if (run.hold) await insertRunHold(tx, this.o.audit, ctx, run.id, run.hold);
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
        for (const g of run.guardEvents)
          await emit(
            AI_EVENTS.GuardrailTriggered,
            GuardrailTriggeredData.parse({ run_id: run.id, ...g }),
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
