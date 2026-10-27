// LLM and EMBEDDING alternative adapter `gemini_vertex_asia_south1` (IPB-03-03; owner decision
// PL2-D-06): Gemini on Vertex AI in asia-south1 (Mumbai), plain HTTPS to the Vertex REST API over
// the egress client; no Google SDK (PL4-D-02).
// - `:generateContent` for chat and tools; `:predict` for text embeddings.
// - The bearer token comes from an injected provider: `vertexServiceAccountToken` (C-24, approved
//   for Vertex by the owner, PL4-C-01: a service-account key through SECRETS, the RS256 assertion
//   signed in `@infrabyx/crypto`, the token cached until 5 minutes before expiry), or keyless
//   workload identity federation, preferred once the platform runs on a cloud that supports it.
// - Residency is checked at construction: both the `{location}-aiplatform.googleapis.com` host and
//   the `locations/{location}` path must be asia-south1 (IPB-03-23).
// - Streaming is emulated in PL4 (PL4-D-04). Bodies are never logged (IPB-03-10).
// Vendor facts are [VERIFY] until the sandbox leg runs with the owner's approval (PL4 plan §10).
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
import { VERTEX_SCOPE } from "@infrabyx/crypto";
import {
  googleServiceAccountToken,
  type GoogleServiceAccountTokenOptions,
} from "../core/google-token.js";
import { createEgress } from "../core/http.js";
import {
  aiDescriptor,
  emulatedStream,
  estimateTokens,
  parseArgs,
  refuse,
  toProviderError,
} from "./common.js";

export const VERTEX_ADAPTER_KEY = "gemini_vertex_asia_south1";
export const VERTEX_LOCATION = "asia-south1";

/** A short-lived OAuth access token for Vertex (scope cloud-platform). */
export type GoogleAccessToken = () => Promise<string>;

/**
 * C-24 (PL4-C-01): a Vertex access-token provider from a service-account key read through SECRETS
 * (`secrets/<env>/ai/vertex/service_account_key`), scope cloud-platform. Never logged.
 */
export function vertexServiceAccountToken(
  o: Omit<GoogleServiceAccountTokenOptions, "port" | "adapter" | "scope">,
): GoogleAccessToken {
  return googleServiceAccountToken({
    ...o,
    port: "LLM",
    adapter: VERTEX_ADAPTER_KEY,
    scope: VERTEX_SCOPE,
  });
}

export interface VertexOptions {
  project: string;
  accessToken: GoogleAccessToken;
  /** Default asia-south1; anything else is reported and blocks the adapter. */
  location?: string;
  /** Tests only: the Vertex stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

/** The location the endpoint serves (host prefix and path must agree), or null. */
export function vertexObservedRegion(
  location: string,
  baseUrl?: string,
  loopbackOk = false,
): string | null {
  if (!baseUrl) return location;
  const u = new URL(baseUrl);
  if (loopbackOk && ["127.0.0.1", "localhost"].includes(u.hostname)) return location;
  const m = /^([a-z0-9-]+)-aiplatform\.googleapis\.com$/.exec(u.hostname);
  return u.protocol === "https:" && m ? (m[1] as string) : null;
}

const STOP: Record<string, StopReason> = {
  STOP: "end",
  MAX_TOKENS: "max_tokens",
  SAFETY: "refused",
  RECITATION: "refused",
  BLOCKLIST: "refused",
  PROHIBITED_CONTENT: "refused",
  SPII: "refused",
  MODEL_ARMOR: "refused",
};

interface Part {
  text?: string;
  functionCall?: { name?: string; args?: unknown };
}
interface GenerateResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
  responseId?: string;
}

abstract class VertexBase {
  readonly descriptor: AiAdapterDescriptor;
  protected readonly base: string;
  protected readonly location: string;

  constructor(
    protected readonly o: VertexOptions,
    port: "LLM" | "EMBEDDING",
    capabilities?: Record<string, "native" | "emulated" | "unsupported">,
  ) {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(o.project))
      throw refuse(VERTEX_ADAPTER_KEY, "invalid Google Cloud project id");
    this.location = o.location ?? VERTEX_LOCATION;
    this.base = (o.baseUrl ?? `https://${this.location}-aiplatform.googleapis.com`).replace(
      /\/$/,
      "",
    );
    this.descriptor = aiDescriptor({
      port,
      adapterKey: VERTEX_ADAPTER_KEY,
      aiResidency: "IN",
      region: VERTEX_LOCATION,
      observedRegion:
        this.location === VERTEX_LOCATION
          ? vertexObservedRegion(this.location, o.baseUrl, o.allowLoopbackHttp === true)
          : this.location,
      maxDataClass: "REGULATED",
      ...(capabilities ? { capabilities } : {}),
    });
  }

  async health(): Promise<PortHealth> {
    const ok = this.descriptor.region === this.descriptor.observedRegion;
    return { status: ok ? "up" : "down", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  protected modelUrl(model: string, verb: "generateContent" | "predict"): string {
    if (!/^[A-Za-z0-9._@-]+$/.test(model)) throw refuse(VERTEX_ADAPTER_KEY, "invalid model name");
    return `${this.base}/v1/projects/${this.o.project}/locations/${this.location}/publishers/google/models/${model}:${verb}`;
  }

  protected async post<T>(
    url: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<{ json: T; requestId: string | null }> {
    const egress = createEgress({
      port: this.descriptor.port,
      adapter: VERTEX_ADAPTER_KEY,
      allow: [`${this.location}-aiplatform.googleapis.com`],
      retries: 0,
      timeoutMs,
      ...(this.o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
    let token: string;
    try {
      token = await this.o.accessToken();
    } catch {
      throw refuse(VERTEX_ADAPTER_KEY, "no access token");
    }
    let res;
    try {
      res = await egress(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw toProviderError(e, VERTEX_ADAPTER_KEY);
    }
    if (res.status >= 400)
      throw toProviderError(
        { name: "VertexError", $metadata: { httpStatusCode: res.status } },
        VERTEX_ADAPTER_KEY,
      );
    return { json: res.json<T>(), requestId: res.headers.get("x-goog-request-id") };
  }
}

export class VertexGeminiLlm extends VertexBase implements LlmPort {
  constructor(o: VertexOptions) {
    super(o, "LLM", { stream: "emulated", batch: "unsupported" });
  }

  capabilities(): readonly ModelCapability[] {
    return ["chat", "tools", "structured", "stream"];
  }

  estimateTokens(req: LlmPortRequest): { input: number; output: number } {
    return estimateTokens(req);
  }

  async chat(req: LlmPortRequest): Promise<LlmPortResult> {
    const mode =
      req.toolChoice === "none" ? "NONE" : typeof req.toolChoice === "object" ? "ANY" : "AUTO";
    const body = {
      contents: req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      ...(req.tools?.length
        ? {
            tools: [
              {
                functionDeclarations: req.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.parameters,
                })),
              },
            ],
            toolConfig: {
              functionCallingConfig: {
                mode,
                ...(typeof req.toolChoice === "object"
                  ? { allowedFunctionNames: [req.toolChoice.name] }
                  : {}),
              },
            },
          }
        : {}),
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.stop?.length ? { stopSequences: [...req.stop] } : {}),
        ...(req.schema
          ? { responseMimeType: "application/json", responseJsonSchema: req.schema }
          : {}),
      },
    };
    const { json, requestId } = await this.post<GenerateResponse>(
      this.modelUrl(req.model, "generateContent"),
      body,
      req.timeoutMs,
    );
    const cand = json.candidates?.[0];
    const parts = cand?.content?.parts ?? [];
    const toolCalls: ToolCall[] = parts.flatMap((p, i) =>
      p.functionCall
        ? [
            {
              id: `call_${i}`,
              name: p.functionCall.name ?? "",
              arguments: parseArgs(p.functionCall.args),
            },
          ]
        : [],
    );
    const usage: LlmUsage = {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      cachedTokens: json.usageMetadata?.cachedContentTokenCount ?? 0,
    };
    const finish = cand?.finishReason ?? "";
    return {
      text: parts.map((p) => p.text ?? "").join(""),
      toolCalls,
      usage,
      stopReason: toolCalls.length && finish === "STOP" ? "tool_use" : (STOP[finish] ?? "other"),
      providerRequestId: json.responseId ?? requestId,
      responseModel: json.modelVersion ?? req.model,
    };
  }

  stream(req: LlmPortRequest): AsyncIterable<LlmChunk> {
    return emulatedStream((r) => this.chat(r), req);
  }
}

/** Text embeddings through `:predict` (`instances[{ content, task_type }]`) [VERIFY: model shape]. */
export class VertexEmbedding extends VertexBase implements EmbeddingPort {
  constructor(o: VertexOptions) {
    super(o, "EMBEDDING");
  }

  capabilities(): readonly ModelCapability[] {
    return ["embed"];
  }

  async embed(req: EmbeddingPortRequest): Promise<{ vectors: number[][]; usage: LlmUsage }> {
    const { json } = await this.post<{
      predictions?: { embeddings?: { values?: number[]; statistics?: { token_count?: number } } }[];
    }>(
      this.modelUrl(req.model, "predict"),
      {
        instances: req.texts.map((content) => ({
          content,
          task_type: req.taskType === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        })),
        parameters: { outputDimensionality: req.dims },
      },
      req.timeoutMs,
    );
    const preds = json.predictions ?? [];
    if (preds.length !== req.texts.length)
      throw refuse(
        VERTEX_ADAPTER_KEY,
        `expected ${req.texts.length} embeddings, got ${preds.length}`,
      );
    const vectors = preds.map((p) => p.embeddings?.values ?? []);
    if (vectors.some((v) => v.length !== req.dims))
      throw refuse(VERTEX_ADAPTER_KEY, `an embedding does not have ${req.dims} dimensions`);
    const tokens = preds.reduce((n, p) => n + (p.embeddings?.statistics?.token_count ?? 0), 0);
    return { vectors, usage: { inputTokens: tokens, outputTokens: 0, cachedTokens: 0 } };
  }
}
