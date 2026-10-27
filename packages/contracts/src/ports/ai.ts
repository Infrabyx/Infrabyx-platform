// AI ports (IPB-03 §03.4.2, IPB-01 LLM/EMBEDDING/IMAGE_GEN/SPEECH; PL4 plan §4.1). These are the
// adapter interfaces: they take a fully resolved, scrubbed request for one model and return what
// the provider returned. `@infrabyx/ai` owns the caller-facing gateway around them (registry,
// data-class routing, prompts, scrubbing, guardrails, metering). Adapters never log prompt or
// completion bodies (IPB-03-10).
import { z } from "zod";
import type { DataClass } from "../data-class.js";
import type { AdapterDescriptor, Port } from "./common.js";

/** Where a provider processes and may store a request (IPB-03 §03.2). */
export const AI_RESIDENCIES = ["IN", "EU", "US", "GLOBAL", "SELF"] as const;
export const AiResidency = z.enum(AI_RESIDENCIES);
export type AiResidency = z.infer<typeof AiResidency>;

/** What the provider keeps after the response (IPB-03 §03.2). */
export const RETENTION_POLICIES = ["ZERO", "ABUSE_30D", "STANDARD", "UNKNOWN"] as const;
export const RetentionPolicy = z.enum(RETENTION_POLICIES);
export type RetentionPolicy = z.infer<typeof RetentionPolicy>;

/** Model capabilities recorded on the registry row (IPB-03 §03.4.4). */
export const MODEL_CAPABILITIES = [
  "chat",
  "tools",
  "structured",
  "stream",
  "batch",
  "vision",
  "embed",
  "image",
  "stt",
  "tts",
  "rerank",
] as const;
export const ModelCapability = z.enum(MODEL_CAPABILITIES);
export type ModelCapability = z.infer<typeof ModelCapability>;

/** Routing bands (IPB-03 §03.4.5): open (PUBLIC, INTERNAL), in_zero (CONFIDENTIAL, REGULATED), self (SECRET). */
export const ROUTING_BANDS = ["open", "in_zero", "self"] as const;
export type RoutingBand = (typeof ROUTING_BANDS)[number];
export function bandOf(dataClass: DataClass): RoutingBand {
  if (dataClass === "SECRET") return "self";
  return dataClass === "CONFIDENTIAL" || dataClass === "REGULATED" ? "in_zero" : "open";
}

/** IPB-03-03 adapter config keys (the folder names under `connectors/src/ai/`). */
export const LLM_ADAPTER_KEYS = [
  "anthropic_direct",
  "bedrock_claude_in",
  "openai",
  "azure_openai_in",
  "gemini_vertex_asia_south1",
  "xai_grok",
  "sarvam",
  "bhashini",
  "self_hosted_vllm",
] as const;
export const IMAGE_ADAPTER_KEYS = [
  "openai_images",
  "gemini_imagen",
  "stability",
  "flux_replicate",
  "flux_self_hosted",
] as const;
export type AiAdapterKey =
  (typeof LLM_ADAPTER_KEYS)[number] | (typeof IMAGE_ADAPTER_KEYS)[number] | (string & {});

/** An AI adapter instance also states its IPB-03 residency and the region it was configured for. */
export interface AiAdapterDescriptor extends AdapterDescriptor {
  adapterKey: AiAdapterKey;
  aiResidency: AiResidency;
  /** Configured region (e.g. `ap-south-1`, `asia-south1`); null for SELF. */
  region: string | null;
  /** Region the endpoint actually resolves to; a mismatch blocks the adapter (IPB-03-23). */
  observedRegion: string | null;
}

/**
 * Content that is data, never instructions (IPB-03-34): documents, retrieved chunks, web pages,
 * e-mail bodies and tool results. The gateway wraps each block in delimiters before the adapter
 * sees it, and the block's class counts toward the request's class (IPB-03-18).
 */
export interface DataBlock {
  kind: "document" | "retrieved" | "web" | "email" | "tool_result" | "record";
  /** Stable reference for citations (`source_id`, `resource_ref`). */
  sourceId: string;
  resourceRef?: string;
  locator?: string;
  dataClass: DataClass;
  text: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** A tool the model may call; the allow-list comes from the skill manifest (IPB-03-35). */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema 2020-12 of the arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export type StopReason = "end" | "max_tokens" | "tool_use" | "stop_sequence" | "refused" | "other";

/** One model call as the adapter receives it: already routed, rendered and scrubbed. */
export interface LlmPortRequest {
  /** `provider_model_name` from the registry row. */
  model: string;
  system: string;
  messages: readonly ChatMessage[];
  tools?: readonly ToolSpec[];
  toolChoice?: "auto" | "none" | { name: string };
  /** JSON Schema for native structured output, when the model record declares `structured`. */
  schema?: Record<string, unknown>;
  maxOutputTokens: number;
  temperature?: number;
  stop?: readonly string[];
  timeoutMs: number;
  idempotencyKey?: string;
  /** BYOK: the tenant's credential reference for this adapter (IPB-03-47). */
  credentialRef?: string;
  signal?: AbortSignal;
}

export interface LlmPortResult {
  text: string;
  toolCalls: ToolCall[];
  usage: LlmUsage;
  stopReason: StopReason;
  /** The provider's own response or request id, for support. */
  providerRequestId: string | null;
  /** The model the provider says answered (`gen_ai.response.model`). */
  responseModel: string | null;
}

export type LlmChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | {
      type: "end";
      usage: LlmUsage;
      stopReason: StopReason;
      providerRequestId: string | null;
      responseModel: string | null;
    };

/**
 * A provider failure the router acts on: `retryable` failures (429, 5xx, timeout) fail over to the
 * next candidate of the same band; others end the call.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

interface AiPort extends Port {
  readonly descriptor: AiAdapterDescriptor;
  /** What the adapter can do (IPB-03-09); a gateway call needing anything else is `IPB-AI-010`. */
  capabilities(): readonly ModelCapability[];
}

export interface LlmPort extends AiPort {
  chat(req: LlmPortRequest): Promise<LlmPortResult>;
  stream(req: LlmPortRequest): AsyncIterable<LlmChunk>;
  /** Token estimate for cost and limit checks, without a provider call. */
  estimateTokens(req: LlmPortRequest): { input: number; output: number };
}

export interface EmbeddingPortRequest {
  model: string;
  texts: readonly string[];
  dims: number;
  taskType: "query" | "document";
  timeoutMs: number;
  credentialRef?: string;
}

export interface EmbeddingPort extends AiPort {
  /** One vector per text, each of exactly `dims` numbers (IPB-03-04). */
  embed(req: EmbeddingPortRequest): Promise<{ vectors: number[][]; usage: LlmUsage }>;
}

/** Permitted image uses (IPB-03-05); anything else is `IPB-AI-030`. */
export const IMAGE_USES = ["marketing", "blog_hero", "diagram", "placeholder"] as const;
export type ImageUse = (typeof IMAGE_USES)[number];

export interface ImageGenPortRequest {
  model: string;
  prompt: string;
  /** `WIDTHxHEIGHT`, e.g. `1024x1024`. */
  size: string;
  n: number;
  timeoutMs: number;
  /** For `edit` and `variations`. */
  image?: Uint8Array;
  mask?: Uint8Array;
}

export interface GeneratedImageBytes {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface ImageGenPort extends AiPort {
  generate(req: ImageGenPortRequest): Promise<GeneratedImageBytes[]>;
  edit(req: ImageGenPortRequest): Promise<GeneratedImageBytes[]>;
  variations(req: ImageGenPortRequest): Promise<GeneratedImageBytes[]>;
}

export interface Transcript {
  lang: string;
  text: string;
  segments: { startMs: number; endMs: number; speaker?: string; text: string }[];
}

/** SPEECH (IPB-03-07): interface and fakes only in PL4 (plan §7). */
export interface SpeechPort extends AiPort {
  stt(
    audio: Uint8Array,
    o: { lang: string; diarise?: boolean; dataClass: DataClass },
  ): Promise<Transcript>;
  tts(
    text: string,
    o: { voice: string; lang: string; format: "mp3" | "ogg" | "wav" },
  ): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

export interface RerankCandidate {
  id: string;
  text: string;
  score?: number;
}

/** RERANK (IPB-03-08, S tier): interface and fakes only in PL4. */
export interface RerankPort extends AiPort {
  rerank(
    query: string,
    candidates: readonly RerankCandidate[],
    topK: number,
  ): Promise<RerankCandidate[]>;
}

/** The `ai_provenance` sidecar on every AI artefact (IPB-03-53). */
export const AiProvenance = z
  .object({
    generated_by: z.literal("vidhi"),
    model_id: z.string().min(1),
    prompt_ref: z.string().regex(/^[a-z0-9_.-]+@\d+\.\d+\.\d+$/),
    prompt_hash: z.string().regex(/^[0-9a-f]{64}$/),
    run_id: z.string().regex(/^run_/),
    created_at: z.iso.datetime({ offset: true }),
    c2pa_manifest_ref: z.string().nullable(),
  })
  .strict();
export type AiProvenance = z.infer<typeof AiProvenance>;

/** A grounded answer's citation (IPB-03-31). */
export interface Citation {
  source_id: string;
  resource_ref: string | null;
  locator: string | null;
  quote_hash: string;
}
