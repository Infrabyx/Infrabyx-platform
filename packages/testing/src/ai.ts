// AI test doubles (PL4 plan §2): a scripted `FakeLlm` and a deterministic `FakeEmbedding`. They
// implement the contracts ports, record every request (so a test can prove which adapter was or
// was not called), and never reach a network. No test in this repository calls a paid provider.
import {
  AiProviderError,
  type AiAdapterDescriptor,
  type AiResidency,
  type EmbeddingPort,
  type EmbeddingPortRequest,
  type LlmChunk,
  type LlmPort,
  type LlmPortRequest,
  type LlmPortResult,
  type LlmUsage,
  type ModelCapability,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import type { DataClass } from "@infrabyx/contracts/data-class";

export interface FakeAiOptions {
  adapterKey: string;
  aiResidency: AiResidency;
  region?: string | null;
  /** Defaults to `region`; set it differently to simulate a misconfigured endpoint. */
  observedRegion?: string | null;
  maxDataClass?: DataClass;
  capabilities?: readonly ModelCapability[];
}

const residencyTag = (r: AiResidency): AiAdapterDescriptor["residency"] =>
  r === "SELF" ? "IN" : r === "IN" ? "IN-ZR" : "GLOBAL";

function descriptor(port: string, o: FakeAiOptions): AiAdapterDescriptor {
  const region = o.region ?? null;
  return {
    port,
    adapter: o.adapterKey,
    adapterKey: o.adapterKey,
    residency: residencyTag(o.aiResidency),
    maxDataClass: o.maxDataClass ?? (o.aiResidency === "SELF" ? "SECRET" : "REGULATED"),
    aiResidency: o.aiResidency,
    region,
    observedRegion: o.observedRegion === undefined ? region : o.observedRegion,
  };
}

const up = async (): Promise<PortHealth> => ({
  status: "up",
  latency_ms: 0,
  checked_at: new Date().toISOString(),
});

export type FakeLlmReply =
  | Partial<LlmPortResult>
  | AiProviderError
  | Error
  | ((req: LlmPortRequest) => Partial<LlmPortResult> | Error);

/** Scripted LLM adapter: replies are taken in order, the last one repeats. */
export class FakeLlm implements LlmPort {
  readonly descriptor: AiAdapterDescriptor;
  readonly calls: LlmPortRequest[] = [];
  private replies: FakeLlmReply[];

  constructor(private readonly o: FakeAiOptions & { replies?: FakeLlmReply[] }) {
    this.descriptor = descriptor("LLM", o);
    this.replies = o.replies ?? [{ text: "ok" }];
  }

  capabilities(): readonly ModelCapability[] {
    return this.o.capabilities ?? ["chat", "tools", "structured", "stream"];
  }

  health(): Promise<PortHealth> {
    return up();
  }

  /** Replace the script. */
  script(...replies: FakeLlmReply[]): this {
    this.replies = replies;
    return this;
  }

  estimateTokens(req: LlmPortRequest): { input: number; output: number } {
    const chars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
    return { input: Math.ceil(chars / 4), output: req.maxOutputTokens };
  }

  async chat(req: LlmPortRequest): Promise<LlmPortResult> {
    this.calls.push(req);
    const next = this.replies.length > 1 ? this.replies.shift()! : this.replies[0]!;
    const r = typeof next === "function" ? next(req) : next;
    if (r instanceof Error) throw r;
    const usage: LlmUsage = r.usage ?? {
      inputTokens: this.estimateTokens(req).input,
      outputTokens: Math.ceil((r.text ?? "").length / 4),
      cachedTokens: 0,
    };
    return {
      text: r.text ?? "",
      toolCalls: r.toolCalls ?? [],
      usage,
      stopReason: r.stopReason ?? ((r.toolCalls ?? []).length ? "tool_use" : "end"),
      providerRequestId: r.providerRequestId ?? `fake-${this.calls.length}`,
      responseModel: r.responseModel ?? req.model,
    };
  }

  async *stream(req: LlmPortRequest): AsyncIterable<LlmChunk> {
    const r = await this.chat(req);
    for (const piece of r.text.match(/.{1,16}/gs) ?? []) yield { type: "text", text: piece };
    for (const call of r.toolCalls) yield { type: "tool_call", call };
    yield {
      type: "end",
      usage: r.usage,
      stopReason: r.stopReason,
      providerRequestId: r.providerRequestId,
      responseModel: r.responseModel,
    };
  }
}

/** A retryable provider failure (429/5xx) for scripts. */
export const providerError = (status: number, retryable = status === 429 || status >= 500) =>
  new AiProviderError(`provider ${status}`, status, retryable);

/** Deterministic embeddings: a hashed bag of words, normalised, of exactly `dims` numbers. */
export class FakeEmbedding implements EmbeddingPort {
  readonly descriptor: AiAdapterDescriptor;
  readonly calls: EmbeddingPortRequest[] = [];
  constructor(private readonly o: FakeAiOptions) {
    this.descriptor = descriptor("EMBEDDING", o);
  }
  capabilities(): readonly ModelCapability[] {
    return this.o.capabilities ?? ["embed"];
  }
  health(): Promise<PortHealth> {
    return up();
  }
  async embed(req: EmbeddingPortRequest): Promise<{ vectors: number[][]; usage: LlmUsage }> {
    this.calls.push(req);
    const vectors = req.texts.map((t) => {
      const v = new Array<number>(req.dims).fill(0);
      for (const w of t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        let h = 2166136261;
        for (const ch of w) h = Math.imul(h ^ (ch.codePointAt(0) as number), 16777619);
        v[Math.abs(h) % req.dims]! += 1;
      }
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
    const tokens = req.texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
    return { vectors, usage: { inputTokens: tokens, outputTokens: 0, cachedTokens: 0 } };
  }
}
