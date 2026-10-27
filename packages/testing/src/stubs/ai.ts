// Bedrock Runtime, Vertex AI and vLLM (OpenAI-compatible) stubs for the AI adapters' hermetic legs
// (PL4 plan §5). Shapes from `@aws-sdk/client-bedrock-runtime` 3.1152.0 and Google's
// aiplatform v1 protos (docs/phases/PL4-spike.md); [VERIFY] until a sandbox leg runs with the
// owner's approval. No stub reaches a provider. Behaviour is driven by markers in the last user
// message, so the shared contract cases work against every stub:
//   CALL_TOOL  → a call to the first tool with `{ "q": "x" }`
//   RATE_LIMIT → 429, SERVER_ERROR → 503, BAD_REQUEST → 400
// otherwise the reply is `stub:<model>` with token counts from the request size.
import { startStub, type StubReply, type VendorStub } from "./http.js";

export interface AiStub extends VendorStub {
  /** Bearer token the Vertex stub expects (null: any). */
  token: string | null;
}

type Marker = "CALL_TOOL" | "RATE_LIMIT" | "SERVER_ERROR" | "BAD_REQUEST" | null;
const marker = (text: string): Marker =>
  (["CALL_TOOL", "RATE_LIMIT", "SERVER_ERROR", "BAD_REQUEST"] as const).find((m) =>
    text.includes(m),
  ) ?? null;

const tokens = (s: string): number => Math.max(1, Math.ceil(s.length / 4));

/** Deterministic unit vector of `dims` numbers for a text (FNV-1a buckets). */
export function stubVector(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const w of text.toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 2166136261;
    for (const ch of w) h = Math.imul(h ^ (ch.codePointAt(0) as number), 16777619);
    v[Math.abs(h) % dims]! += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

function failure(m: Marker, awsType = false): StubReply | null {
  const status =
    m === "RATE_LIMIT" ? 429 : m === "SERVER_ERROR" ? 503 : m === "BAD_REQUEST" ? 400 : 0;
  if (!status) return null;
  const type =
    status === 429
      ? "ThrottlingException"
      : status === 503
        ? "ServiceUnavailableException"
        : "ValidationException";
  return {
    status,
    body: awsType
      ? { message: `stub ${type}` }
      : { error: { code: status, message: `stub ${status}` } },
    headers: awsType ? { "x-amzn-errortype": `${type}:` } : {},
  };
}

/** Bedrock Runtime: `POST /model/{modelId}/converse` and `/invoke` (restJson1). */
export async function startBedrockStub(): Promise<AiStub> {
  const stub = await startStub((r) => {
    const m = /^\/model\/([^/]+)\/(converse|invoke)$/.exec(r.path);
    if (r.method !== "POST" || !m) return { status: 404, body: { message: "not found" } };
    const modelId = decodeURIComponent(m[1] as string);
    if (!r.headers.authorization?.startsWith("AWS4-HMAC-SHA256"))
      return {
        status: 403,
        body: { message: "missing SigV4" },
        headers: { "x-amzn-errortype": "AccessDeniedException:" },
      };
    if (m[2] === "invoke") {
      const b = r.json<{ inputText: string; dimensions: number }>();
      return {
        status: 200,
        body: {
          embedding: stubVector(b.inputText, b.dimensions),
          inputTextTokenCount: tokens(b.inputText),
        },
      };
    }
    const b = r.json<{
      messages: { role: string; content: { text?: string }[] }[];
      system?: { text: string }[];
      toolConfig?: { tools: { toolSpec: { name: string } }[] };
    }>();
    const last =
      b.messages
        .at(-1)
        ?.content.map((c) => c.text ?? "")
        .join("") ?? "";
    const fail = failure(marker(last), true);
    if (fail) return fail;
    const inTok = tokens(JSON.stringify(b));
    const tool = marker(last) === "CALL_TOOL" ? b.toolConfig?.tools[0]?.toolSpec.name : undefined;
    const content = tool
      ? [{ toolUse: { toolUseId: "tooluse_stub_1", name: tool, input: { q: "x" } } }]
      : [{ text: `stub:${modelId}` }];
    return {
      status: 200,
      headers: { "x-amzn-requestid": "stub-req-1" },
      body: {
        output: { message: { role: "assistant", content } },
        stopReason: tool ? "tool_use" : "end_turn",
        usage: { inputTokens: inTok, outputTokens: 5, totalTokens: inTok + 5 },
        metrics: { latencyMs: 1 },
      },
    };
  });
  return Object.assign(stub, { token: null });
}

/** Vertex AI: `…/publishers/google/models/{model}:generateContent` and `:predict`. */
export async function startVertexStub(token: string | null = null): Promise<AiStub> {
  const ref: { s?: AiStub } = {};
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (s.token && r.headers.authorization !== `Bearer ${s.token}`)
      return { status: 401, body: { error: { code: 401, message: "unauthenticated" } } };
    const m =
      /^\/v1\/projects\/([^/]+)\/locations\/([^/]+)\/publishers\/google\/models\/([^/:]+):(generateContent|predict)$/.exec(
        r.path,
      );
    if (r.method !== "POST" || !m) return { status: 404, body: { error: { code: 404 } } };
    const [, , location, model, verb] = m;
    if (location !== "asia-south1")
      return { status: 400, body: { error: { code: 400, message: "wrong location" } } };
    if (verb === "predict") {
      const b = r.json<{
        instances: { content: string }[];
        parameters: { outputDimensionality: number };
      }>();
      return {
        status: 200,
        body: {
          predictions: b.instances.map((i) => ({
            embeddings: {
              values: stubVector(i.content, b.parameters.outputDimensionality),
              statistics: { token_count: tokens(i.content) },
            },
          })),
        },
      };
    }
    const b = r.json<{
      contents: { role: string; parts: { text?: string }[] }[];
      tools?: { functionDeclarations: { name: string }[] }[];
    }>();
    const last =
      b.contents
        .at(-1)
        ?.parts.map((p) => p.text ?? "")
        .join("") ?? "";
    const fail = failure(marker(last));
    if (fail) return fail;
    const tool =
      marker(last) === "CALL_TOOL" ? b.tools?.[0]?.functionDeclarations[0]?.name : undefined;
    const inTok = tokens(JSON.stringify(b));
    return {
      status: 200,
      body: {
        candidates: [
          {
            content: {
              role: "model",
              parts: tool
                ? [{ functionCall: { name: tool, args: { q: "x" } } }]
                : [{ text: `stub:${model}` }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: inTok,
          candidatesTokenCount: 5,
          totalTokenCount: inTok + 5,
        },
        modelVersion: `${model}-stub`,
        responseId: "stub-response-1",
      },
    };
  });
  ref.s = Object.assign(stub, { token });
  return ref.s;
}

/** vLLM (OpenAI-compatible): `/v1/chat/completions` and `/v1/embeddings`. */
export async function startVllmStub(): Promise<AiStub> {
  const stub = await startStub((r) => {
    if (r.method === "POST" && r.path === "/v1/embeddings") {
      const b = r.json<{ input: string[]; dimensions: number }>();
      return {
        status: 200,
        body: {
          data: b.input.map((t, index) => ({ index, embedding: stubVector(t, b.dimensions) })),
          usage: { prompt_tokens: b.input.reduce((n, t) => n + tokens(t), 0) },
        },
      };
    }
    if (r.method !== "POST" || r.path !== "/v1/chat/completions") return { status: 404, body: {} };
    const b = r.json<{
      model: string;
      messages: { role: string; content: string }[];
      tools?: { function: { name: string } }[];
    }>();
    const last = b.messages.at(-1)?.content ?? "";
    const fail = failure(marker(last));
    if (fail) return fail;
    const tool = marker(last) === "CALL_TOOL" ? b.tools?.[0]?.function.name : undefined;
    const inTok = tokens(JSON.stringify(b));
    return {
      status: 200,
      body: {
        id: "chatcmpl-stub-1",
        model: b.model,
        choices: [
          {
            index: 0,
            finish_reason: tool ? "tool_calls" : "stop",
            message: {
              role: "assistant",
              content: tool ? null : `stub:${b.model}`,
              ...(tool
                ? {
                    tool_calls: [
                      {
                        id: "call_stub_1",
                        type: "function",
                        function: { name: tool, arguments: '{"q":"x"}' },
                      },
                    ],
                  }
                : {}),
            },
          },
        ],
        usage: { prompt_tokens: inTok, completion_tokens: 5 },
      },
    };
  });
  return Object.assign(stub, { token: null });
}
