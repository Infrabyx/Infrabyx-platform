// LLM and EMBEDDING reference adapter `bedrock_claude_in` (IPB-03-03; owner decision PL2-D-06):
// Anthropic Claude and an embeddings model on Amazon Bedrock in ap-south-1 (Mumbai), through
// `@aws-sdk/client-bedrock-runtime` (Converse for chat and tools, InvokeModel for embeddings).
// - Residency is checked at construction: the client region must be the configured `ap-south-1`
//   and a custom endpoint must be the Bedrock runtime host of that region (IPB-03-23); a mismatch
//   leaves `observedRegion` different, and the gateway never selects the adapter.
// - Cross-region inference profiles (`apac.`, `global.`, `us.`, `eu.` model ids) may process
//   outside India and are refused before any call [VERIFY: profile naming].
// - Credentials come from the default AWS chain (an IAM role); nothing is read from environment
//   variables here. Bodies are never logged (IPB-03-10).
// - Streaming is emulated over Converse in PL4 (PL4-D-04), so HTTP/1.1 is enough.
// Vendor facts are [VERIFY] until the sandbox leg runs with the owner's approval (PL4 plan §10).
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type BedrockRuntimeClientConfig,
  type ContentBlock,
  type ConverseCommandInput,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
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
import {
  aiDescriptor,
  emulatedStream,
  estimateTokens,
  parseArgs,
  refuse,
  toProviderError,
} from "./common.js";

export const BEDROCK_ADAPTER_KEY = "bedrock_claude_in";
export const BEDROCK_REGION = "ap-south-1";
const CROSS_REGION_PROFILE = /^(apac|global|us|eu|ca|jp|au)\./;

export interface BedrockOptions {
  /** Default ap-south-1; anything else is reported as configured and checked against the endpoint. */
  region?: string;
  /** Tests only: the Bedrock stub. */
  endpoint?: string;
  allowLoopbackHttp?: boolean;
  /** Tests only: static stub credentials; production uses the default chain (IAM role). */
  credentials?: BedrockRuntimeClientConfig["credentials"];
  /** A prepared client (tests, or a product's own configuration). */
  client?: BedrockRuntimeClient;
}

/** The region the endpoint actually serves (IPB-03-23), or null when it cannot be told. */
export function bedrockObservedRegion(
  region: string,
  endpoint?: string,
  loopbackOk = false,
): string | null {
  if (!endpoint) return region;
  const u = new URL(endpoint);
  if (loopbackOk && ["127.0.0.1", "localhost"].includes(u.hostname)) return region;
  const m = /^bedrock-runtime(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com$/.exec(u.hostname);
  return u.protocol === "https:" && m ? (m[1] as string) : null;
}

function client(o: BedrockOptions, region: string): BedrockRuntimeClient {
  return (
    o.client ??
    new BedrockRuntimeClient({
      region,
      ...(o.endpoint ? { endpoint: o.endpoint } : {}),
      ...(o.credentials ? { credentials: o.credentials } : {}),
      maxAttempts: 1, // the gateway fails over; the SDK must not retry on its own
      // HTTP/1.1: Converse and InvokeModel need no HTTP/2, which the client would otherwise pick
      // for its bidirectional-stream operation (unused here).
      requestHandler: new NodeHttpHandler(),
    })
  );
}

const STOP: Record<string, StopReason> = {
  end_turn: "end",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  model_context_window_exceeded: "max_tokens",
  stop_sequence: "stop_sequence",
  content_filtered: "refused",
  guardrail_intervened: "refused",
};

export class BedrockClaudeLlm implements LlmPort {
  readonly descriptor: AiAdapterDescriptor;
  private readonly c: BedrockRuntimeClient;

  constructor(o: BedrockOptions = {}) {
    const region = o.region ?? BEDROCK_REGION;
    this.c = client(o, region);
    this.descriptor = aiDescriptor({
      port: "LLM",
      adapterKey: BEDROCK_ADAPTER_KEY,
      aiResidency: "IN",
      region: BEDROCK_REGION,
      observedRegion: bedrockObservedRegion(region, o.endpoint, o.allowLoopbackHttp === true),
      maxDataClass: "REGULATED",
      capabilities: { stream: "emulated", batch: "unsupported" },
    });
  }

  capabilities(): readonly ModelCapability[] {
    return ["chat", "tools", "structured", "stream"];
  }

  async health(): Promise<PortHealth> {
    const ok = this.descriptor.region === this.descriptor.observedRegion;
    return { status: ok ? "up" : "down", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  estimateTokens(req: LlmPortRequest): { input: number; output: number } {
    return estimateTokens(req);
  }

  async chat(req: LlmPortRequest): Promise<LlmPortResult> {
    if (CROSS_REGION_PROFILE.test(req.model))
      throw refuse(
        BEDROCK_ADAPTER_KEY,
        "cross-region inference profiles may process outside India",
      );
    const messages: Message[] = req.messages.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));
    const input: ConverseCommandInput = {
      modelId: req.model,
      messages,
      ...(req.system ? { system: [{ text: req.system }] } : {}),
      inferenceConfig: {
        maxTokens: req.maxOutputTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.stop?.length ? { stopSequences: [...req.stop] } : {}),
      },
      ...(req.tools?.length && req.toolChoice !== "none"
        ? {
            toolConfig: {
              tools: req.tools.map((t) => ({
                toolSpec: {
                  name: t.name,
                  description: t.description,
                  inputSchema: { json: t.parameters as never },
                },
              })),
              ...(typeof req.toolChoice === "object"
                ? { toolChoice: { tool: { name: req.toolChoice.name } } }
                : {}),
            },
          }
        : {}),
      ...(req.schema
        ? {
            outputConfig: {
              textFormat: {
                type: "json_schema",
                structure: { jsonSchema: { schema: JSON.stringify(req.schema), name: "output" } },
              },
            },
          }
        : {}),
    };
    let out;
    try {
      out = await this.c.send(new ConverseCommand(input), {
        abortSignal: req.signal ?? AbortSignal.timeout(req.timeoutMs),
      });
    } catch (e) {
      throw toProviderError(e, BEDROCK_ADAPTER_KEY);
    }
    const blocks: ContentBlock[] =
      out.output && "message" in out.output ? (out.output.message?.content ?? []) : [];
    const text = blocks
      .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
      .join("");
    const toolCalls: ToolCall[] = blocks.flatMap((b) =>
      "toolUse" in b && b.toolUse
        ? [
            {
              id: b.toolUse.toolUseId ?? "",
              name: b.toolUse.name ?? "",
              arguments: parseArgs(b.toolUse.input),
            },
          ]
        : [],
    );
    const usage: LlmUsage = {
      inputTokens: out.usage?.inputTokens ?? 0,
      outputTokens: out.usage?.outputTokens ?? 0,
      cachedTokens: out.usage?.cacheReadInputTokens ?? 0,
    };
    return {
      text,
      toolCalls,
      usage,
      stopReason: STOP[out.stopReason ?? ""] ?? "other",
      providerRequestId: out.$metadata.requestId ?? null,
      responseModel: req.model,
    };
  }

  stream(req: LlmPortRequest): AsyncIterable<LlmChunk> {
    return emulatedStream((r) => this.chat(r), req);
  }
}

/**
 * Embeddings on Bedrock through InvokeModel, in the Titan Text Embeddings v2 body shape
 * (`{ inputText, dimensions, normalize }` → `{ embedding, inputTextTokenCount }`) [VERIFY: the
 * embeddings model available in ap-south-1]. One text per call, as that model takes one.
 */
export class BedrockEmbedding implements EmbeddingPort {
  readonly descriptor: AiAdapterDescriptor;
  private readonly c: BedrockRuntimeClient;

  constructor(o: BedrockOptions = {}) {
    const region = o.region ?? BEDROCK_REGION;
    this.c = client(o, region);
    this.descriptor = aiDescriptor({
      port: "EMBEDDING",
      adapterKey: BEDROCK_ADAPTER_KEY,
      aiResidency: "IN",
      region: BEDROCK_REGION,
      observedRegion: bedrockObservedRegion(region, o.endpoint, o.allowLoopbackHttp === true),
      maxDataClass: "REGULATED",
    });
  }

  capabilities(): readonly ModelCapability[] {
    return ["embed"];
  }

  async health(): Promise<PortHealth> {
    const ok = this.descriptor.region === this.descriptor.observedRegion;
    return { status: ok ? "up" : "down", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  async embed(req: EmbeddingPortRequest): Promise<{ vectors: number[][]; usage: LlmUsage }> {
    if (CROSS_REGION_PROFILE.test(req.model))
      throw refuse(
        BEDROCK_ADAPTER_KEY,
        "cross-region inference profiles may process outside India",
      );
    const vectors: number[][] = [];
    let tokens = 0;
    for (const text of req.texts) {
      let out;
      try {
        out = await this.c.send(
          new InvokeModelCommand({
            modelId: req.model,
            contentType: "application/json",
            accept: "application/json",
            body: new TextEncoder().encode(
              JSON.stringify({ inputText: text, dimensions: req.dims, normalize: true }),
            ),
          }),
          { abortSignal: AbortSignal.timeout(req.timeoutMs) },
        );
      } catch (e) {
        throw toProviderError(e, BEDROCK_ADAPTER_KEY);
      }
      const body = JSON.parse(new TextDecoder().decode(out.body)) as {
        embedding?: number[];
        inputTextTokenCount?: number;
      };
      const v = body.embedding ?? [];
      if (v.length !== req.dims)
        throw refuse(
          BEDROCK_ADAPTER_KEY,
          `embedding has ${v.length} dimensions, expected ${req.dims}`,
        );
      vectors.push(v);
      tokens += body.inputTextTokenCount ?? 0;
    }
    return { vectors, usage: { inputTokens: tokens, outputTokens: 0, cachedTokens: 0 } };
  }
}
