// `aiTrace()` (IPB-03-50, 03-51; PL4 plan §4.8): the only emitter of AI spans, with the OpenTelemetry
// GenAI semantic-convention attribute names in one map, so a rename is a one-line change.
// Content capture is off by construction (owner decision, 27 Oct 2026): no attribute here can carry
// a prompt, a completion, tool arguments or retrieved text, whatever `ai.obs.capture_content` says.
import { SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";

/** GenAI semantic conventions (Development status) and the Infrabyx attributes. */
export const SEMCONV = {
  operation: "gen_ai.operation.name",
  provider: "gen_ai.provider.name",
  requestModel: "gen_ai.request.model",
  responseModel: "gen_ai.response.model",
  inputTokens: "gen_ai.usage.input_tokens",
  outputTokens: "gen_ai.usage.output_tokens",
  tenantId: "infrabyx.tenant_id",
  featureKey: "infrabyx.feature_key",
  dataClass: "infrabyx.data_class",
  runId: "infrabyx.run_id",
  routeReason: "infrabyx.route_reason",
  errorCode: "infrabyx.error_code",
} as const;
export type AiSpanAttribute = (typeof SEMCONV)[keyof typeof SEMCONV];

/** Attribute names that would carry content; `aiTrace` refuses them (and the CI scan checks). */
export const CONTENT_ATTRIBUTE =
  /(prompt|completion|content|messages|input\.value|output\.value|tool\.arguments)/i;

export type AiOperation =
  "chat" | "embeddings" | "execute_tool" | "invoke_agent" | "invoke_workflow" | "generate_content";

export interface AiSpanHandle {
  set(attrs: Partial<Record<keyof typeof SEMCONV, string | number>>): void;
}

const defaultTracer = (): Tracer => trace.getTracer("@infrabyx/ai");

/** Run `fn` inside a GenAI span named `<operation> <model>`; only `SEMCONV` attributes are set. */
export async function aiTrace<T>(
  operation: AiOperation,
  attrs: Partial<Record<keyof typeof SEMCONV, string | number>>,
  fn: (span: AiSpanHandle) => Promise<T>,
  tracer: Tracer = defaultTracer(),
): Promise<T> {
  return tracer.startActiveSpan(
    `${operation} ${attrs.requestModel ?? ""}`.trim(),
    async (span: Span) => {
      const handle: AiSpanHandle = {
        set(a) {
          for (const [k, v] of Object.entries(a)) {
            const name = SEMCONV[k as keyof typeof SEMCONV];
            if (name === undefined || v === undefined || CONTENT_ATTRIBUTE.test(name)) continue;
            span.setAttribute(name, v);
          }
        },
      };
      handle.set({ ...attrs, operation });
      try {
        const out = await fn(handle);
        span.setStatus({ code: SpanStatusCode.OK });
        return out;
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        if (typeof code === "string") span.setAttribute(SEMCONV.errorCode, code);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw e;
      } finally {
        span.end();
      }
    },
  );
}
