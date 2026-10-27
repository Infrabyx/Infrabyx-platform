// LLM and EMBEDDING contract cases (IPB-01-15, IPB-03-02, 03-04, 03-09; PL4 plan §5). Every adapter
// runs them against its stub (hermetic leg) and, once the owner approves a live run, its provider
// (sandbox leg). Run with defineContractSuite("LLM" | "EMBEDDING", factory, cases, { leg }).
import { expect } from "vitest";
import {
  AiProviderError,
  type EmbeddingPort,
  type LlmPort,
  type LlmPortRequest,
} from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";

const req = (text: string, over: Partial<LlmPortRequest> = {}): LlmPortRequest => ({
  model: "contract-model",
  system: "You are a contract test.",
  messages: [{ role: "user", content: text }],
  maxOutputTokens: 64,
  timeoutMs: 5000,
  ...over,
});

const providerError = async (p: Promise<unknown>): Promise<AiProviderError> => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(AiProviderError);
  return e as AiProviderError;
};

/** Cases for an LLM adapter; `model` is a provider model name the stub or sandbox accepts. */
export function llmContractCases(model = "contract-model"): ContractCase<LlmPort>[] {
  const r = (text: string, over: Partial<LlmPortRequest> = {}) => req(text, { model, ...over });
  return [
    {
      name: "declares its IPB-03 residency and serves only from its configured region (IPB-03-23)",
      async run(p) {
        expect(["IN", "EU", "US", "GLOBAL", "SELF"]).toContain(p.descriptor.aiResidency);
        expect(p.descriptor.observedRegion).toBe(p.descriptor.region);
        expect(p.capabilities()).toContain("chat");
      },
    },
    {
      name: "chat returns text, usage and a stop reason",
      method: "chat",
      async run(p) {
        const out = await p.chat(r("Say hello."));
        expect(typeof out.text).toBe("string");
        expect(out.text.length).toBeGreaterThan(0);
        expect(out.usage.inputTokens).toBeGreaterThan(0);
        expect(out.usage.outputTokens).toBeGreaterThanOrEqual(0);
        expect(["end", "max_tokens", "tool_use", "stop_sequence", "refused", "other"]).toContain(
          out.stopReason,
        );
        expect(out.toolCalls).toEqual([]);
      },
    },
    {
      name: "tools: a tool call comes back with its name and object arguments (IPB-03-02)",
      method: "chat",
      async run(p) {
        const out = await p.chat(
          r("CALL_TOOL lookup", {
            tools: [
              {
                name: "doc_lookup",
                description: "Look up a document",
                parameters: { type: "object", properties: { q: { type: "string" } } },
              },
            ],
          }),
        );
        expect(out.toolCalls).toHaveLength(1);
        expect(out.toolCalls[0]).toMatchObject({ name: "doc_lookup", arguments: { q: "x" } });
        expect(out.stopReason).toBe("tool_use");
      },
    },
    {
      name: "a 429 or 5xx is a retryable AiProviderError (the gateway fails over)",
      method: "chat",
      async run(p) {
        expect((await providerError(p.chat(r("RATE_LIMIT")))).retryable).toBe(true);
        expect((await providerError(p.chat(r("SERVER_ERROR")))).retryable).toBe(true);
      },
    },
    {
      name: "a 4xx is not retried: the request itself was refused",
      method: "chat",
      async run(p) {
        const e = await providerError(p.chat(r("BAD_REQUEST")));
        expect(e.retryable).toBe(false);
        expect(e.status).toBe(400);
      },
    },
    {
      name: "stream yields text and ends with usage (native or emulated)",
      method: "stream",
      async run(p) {
        let text = "";
        let end = false;
        for await (const c of p.stream(r("Stream please."))) {
          if (c.type === "text") text += c.text;
          if (c.type === "end") {
            end = true;
            expect(c.usage.inputTokens).toBeGreaterThan(0);
          }
        }
        expect(text.length).toBeGreaterThan(0);
        expect(end).toBe(true);
      },
    },
    {
      name: "estimateTokens needs no provider call (IPB-03-09)",
      async run(p) {
        const e = p.estimateTokens(r("x".repeat(400)));
        expect(e.input).toBeGreaterThanOrEqual(100);
        expect(e.output).toBe(64);
      },
    },
  ];
}

/** Cases for an EMBEDDING adapter (IPB-03-04). */
export function embeddingContractCases(
  model = "contract-embedding",
): ContractCase<EmbeddingPort>[] {
  return [
    {
      name: "embed returns one vector of exactly `dims` numbers per text",
      method: "embed",
      async run(p) {
        const out = await p.embed({
          model,
          texts: ["first text", "second text"],
          dims: 16,
          taskType: "document",
          timeoutMs: 5000,
        });
        expect(out.vectors).toHaveLength(2);
        for (const v of out.vectors) {
          expect(v).toHaveLength(16);
          expect(v.every((x) => Number.isFinite(x))).toBe(true);
        }
        expect(out.usage.inputTokens).toBeGreaterThan(0);
      },
    },
    {
      name: "the same text embeds to the same direction (cosine > 0.999)",
      method: "embed",
      async run(p) {
        const a = await p.embed({
          model,
          texts: ["repeatable"],
          dims: 8,
          taskType: "query",
          timeoutMs: 5000,
        });
        const b = await p.embed({
          model,
          texts: ["repeatable"],
          dims: 8,
          taskType: "query",
          timeoutMs: 5000,
        });
        const [x, y] = [a.vectors[0] as number[], b.vectors[0] as number[]];
        const cos =
          x.reduce((n, v, i) => n + v * (y[i] as number), 0) /
          (Math.hypot(...x) * Math.hypot(...y));
        expect(cos).toBeGreaterThan(0.999);
      },
    },
  ];
}
