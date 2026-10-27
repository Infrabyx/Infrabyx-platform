// Shared pieces of the AI adapters (PL4 plan §5): descriptors, error mapping for the gateway's
// failover, emulated streaming and a provider-free token estimate. Adapters never log prompt or
// completion bodies (IPB-03-10); they log status, latency, request id and token counts only.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AiProviderError,
  type AiAdapterDescriptor,
  type AiResidency,
  type DataClass,
  type LlmChunk,
  type LlmPortRequest,
  type LlmPortResult,
  type Residency,
} from "@infrabyx/contracts";

/** IPB-01 residency tag of an AI adapter: own infrastructure in India is `IN`, a provider's zero-retention India region `IN-ZR`. */
export const residencyTag = (r: AiResidency): Residency =>
  r === "SELF" ? "IN" : r === "IN" ? "IN-ZR" : "GLOBAL";

export function aiDescriptor(o: {
  port: "LLM" | "EMBEDDING" | "IMAGE_GEN";
  adapterKey: string;
  aiResidency: AiResidency;
  region: string | null;
  observedRegion: string | null;
  maxDataClass: DataClass;
  capabilities?: Record<string, "native" | "emulated" | "unsupported">;
}): AiAdapterDescriptor {
  return {
    port: o.port,
    adapter: o.adapterKey.replace(/_/g, "-"),
    adapterKey: o.adapterKey,
    residency: residencyTag(o.aiResidency),
    maxDataClass: o.maxDataClass,
    aiResidency: o.aiResidency,
    region: o.region,
    observedRegion: o.observedRegion,
    ...(o.capabilities ? { capabilities: o.capabilities } : {}),
  };
}

/** Status-only retry rule shared with the gateway: 429, 5xx and timeouts fail over. */
export const retryableStatus = (s: number | null): boolean =>
  s === null || s === 408 || s === 429 || s >= 500;

/** Map an egress or SDK failure to the error the gateway's router understands. */
export function toProviderError(e: unknown, adapter: string): AiProviderError {
  if (e instanceof AiProviderError) return e;
  if (e instanceof PortError) {
    const status = (e.meta?.vendorStatus as number | undefined) ?? null;
    // IPB-SEC-018 (host or redirect refused) is never retried.
    const retryable = e.code === "IPB-PORT-002" && retryableStatus(status);
    return new AiProviderError(`${adapter}: ${e.code}`, status, retryable);
  }
  const x = e as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
    $retryable?: unknown;
  };
  if (x?.name === "AbortError" || x?.name === "TimeoutError")
    return new AiProviderError(`${adapter}: timed out`, null, true);
  const status = x?.$metadata?.httpStatusCode ?? null;
  return new AiProviderError(
    `${adapter}: ${x?.name ?? "error"}${status ? ` ${status}` : ""}`,
    status,
    status === null ? Boolean(x?.$retryable) : retryableStatus(status),
  );
}

/** A refusal that must never fail over (the request itself is not allowed here). */
export const refuse = (adapter: string, why: string): AiProviderError =>
  new AiProviderError(`${adapter}: ${why}`, 400, false);

/** About four characters per token; good enough for caps and budgets before the call. */
export function estimateTokens(req: LlmPortRequest): { input: number; output: number } {
  const chars =
    req.system.length +
    req.messages.reduce((n, m) => n + m.content.length, 0) +
    JSON.stringify(req.tools ?? []).length;
  return { input: Math.ceil(chars / 4), output: req.maxOutputTokens };
}

/** Streaming emulated over `chat` (PL4-D-04): one call, then the text in pieces. */
export async function* emulatedStream(
  chat: (req: LlmPortRequest) => Promise<LlmPortResult>,
  req: LlmPortRequest,
): AsyncIterable<LlmChunk> {
  const r = await chat(req);
  for (const piece of r.text.match(/[\s\S]{1,64}/g) ?? []) yield { type: "text", text: piece };
  for (const call of r.toolCalls) yield { type: "tool_call", call };
  yield {
    type: "end",
    usage: r.usage,
    stopReason: r.stopReason,
    providerRequestId: r.providerRequestId,
    responseModel: r.responseModel,
  };
}

/** Parse a JSON tool-argument string; anything that is not an object becomes `{}`. */
export function parseArgs(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string")
    try {
      const o = JSON.parse(v) as unknown;
      return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  return {};
}
