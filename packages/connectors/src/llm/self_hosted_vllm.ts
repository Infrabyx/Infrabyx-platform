// LLM and EMBEDDING adapter `self_hosted_vllm` (IPB-03-03): an OpenAI-compatible inference server
// (vLLM) on our own infrastructure in India. Residency SELF, retention ZERO by construction, so it
// is the only route the gateway allows for SECRET data (IPB-03-19). HTTPS to a host on the
// configured allow-list (a mesh or internal TLS endpoint); an optional API key from SECRETS.
// Streaming is emulated in PL4 (PL4-D-04). Bodies are never logged (IPB-03-10).
import type {
  AiAdapterDescriptor,
  EmbeddingPort,
  EmbeddingPortRequest,
  LlmChunk,
  LlmPort,
  LlmPortRequest,
  LlmPortResult,
  LlmUsage,
  ModelCapability,
  PortHealth,
  StopReason,
  ToolCall,
} from "@infrabyx/contracts";
import { createEgress } from "../core/http.js";
import {
  aiDescriptor,
  emulatedStream,
  estimateTokens,
  parseArgs,
  refuse,
  toProviderError,
} from "./common.js";

export const VLLM_ADAPTER_KEY = "self_hosted_vllm";

export interface VllmOptions {
  /** e.g. `https://vllm.ai.svc.internal`; its host is the only one the adapter may call. */
  baseUrl: string;
  /** `secrets/<env>/ai/vllm/api_key`, when the server requires one. */
  apiKey?: () => Promise<string | undefined> | string | undefined;
  /** Tests only. */
  allowLoopbackHttp?: boolean;
}

const STOP: Record<string, StopReason> = {
  stop: "end",
  length: "max_tokens",
  tool_calls: "tool_use",
  content_filter: "refused",
};

abstract class VllmBase {
  readonly descriptor: AiAdapterDescriptor;
  protected readonly base: string;
  private readonly host: string;

  constructor(
    protected readonly o: VllmOptions,
    port: "LLM" | "EMBEDDING",
    capabilities?: Record<string, "native" | "emulated" | "unsupported">,
  ) {
    const u = new URL(o.baseUrl);
    this.host = u.hostname;
    this.base = o.baseUrl.replace(/\/$/, "");
    this.descriptor = aiDescriptor({
      port,
      adapterKey: VLLM_ADAPTER_KEY,
      aiResidency: "SELF",
      region: null,
      observedRegion: null,
      maxDataClass: "SECRET",
      ...(capabilities ? { capabilities } : {}),
    });
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  protected async post<T>(
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<{ json: T; requestId: string | null }> {
    const egress = createEgress({
      port: this.descriptor.port,
      adapter: VLLM_ADAPTER_KEY,
      allow: [this.host],
      retries: 0,
      timeoutMs,
      ...(this.o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
    const key = await this.o.apiKey?.();
    let res;
    try {
      res = await egress(`${this.base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw toProviderError(e, VLLM_ADAPTER_KEY);
    }
    if (res.status >= 400)
      throw toProviderError(
        { name: "VllmError", $metadata: { httpStatusCode: res.status } },
        VLLM_ADAPTER_KEY,
      );
    return { json: res.json<T>(), requestId: res.headers.get("x-request-id") };
  }
}

interface ChatCompletion {
  id?: string;
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export class VllmLlm extends VllmBase implements LlmPort {
  constructor(o: VllmOptions) {
    super(o, "LLM", { stream: "emulated", batch: "unsupported" });
  }

  capabilities(): readonly ModelCapability[] {
    return ["chat", "tools", "structured", "stream"];
  }

  estimateTokens(req: LlmPortRequest): { input: number; output: number } {
    return estimateTokens(req);
  }

  async chat(req: LlmPortRequest): Promise<LlmPortResult> {
    const body = {
      model: req.model,
      messages: [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_tokens: req.maxOutputTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.stop?.length ? { stop: [...req.stop] } : {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice:
              typeof req.toolChoice === "object"
                ? { type: "function", function: { name: req.toolChoice.name } }
                : (req.toolChoice ?? "auto"),
          }
        : {}),
      ...(req.schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "output", schema: req.schema },
            },
          }
        : {}),
    };
    const { json, requestId } = await this.post<ChatCompletion>(
      "/v1/chat/completions",
      body,
      req.timeoutMs,
    );
    const choice = json.choices?.[0];
    if (!choice) throw refuse(VLLM_ADAPTER_KEY, "no choices in the response");
    const toolCalls: ToolCall[] = (choice.message?.tool_calls ?? []).map((t, i) => ({
      id: t.id ?? `call_${i}`,
      name: t.function?.name ?? "",
      arguments: parseArgs(t.function?.arguments),
    }));
    return {
      text: choice.message?.content ?? "",
      toolCalls,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        cachedTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      stopReason: STOP[choice.finish_reason ?? ""] ?? "other",
      providerRequestId: json.id ?? requestId,
      responseModel: json.model ?? req.model,
    };
  }

  stream(req: LlmPortRequest): AsyncIterable<LlmChunk> {
    return emulatedStream((r) => this.chat(r), req);
  }
}

export class VllmEmbedding extends VllmBase implements EmbeddingPort {
  constructor(o: VllmOptions) {
    super(o, "EMBEDDING");
  }

  capabilities(): readonly ModelCapability[] {
    return ["embed"];
  }

  async embed(req: EmbeddingPortRequest): Promise<{ vectors: number[][]; usage: LlmUsage }> {
    const { json } = await this.post<{
      data?: { index?: number; embedding?: number[] }[];
      usage?: { prompt_tokens?: number };
    }>(
      "/v1/embeddings",
      { model: req.model, input: [...req.texts], dimensions: req.dims },
      req.timeoutMs,
    );
    const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (data.length !== req.texts.length)
      throw refuse(VLLM_ADAPTER_KEY, `expected ${req.texts.length} embeddings, got ${data.length}`);
    const vectors = data.map((d) => d.embedding ?? []);
    if (vectors.some((v) => v.length !== req.dims))
      throw refuse(VLLM_ADAPTER_KEY, `an embedding does not have ${req.dims} dimensions`);
    return {
      vectors,
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: 0, cachedTokens: 0 },
    };
  }
}
