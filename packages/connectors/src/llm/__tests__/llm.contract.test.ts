// LLM contract legs (PL4 plan §5, §15). Hermetic: Bedrock Runtime, Vertex AI and vLLM stubs. The
// sandbox legs need the owner's provider accounts and an approved paid run (owner decision O-6):
// they are not defined until then, so nothing here can reach a provider.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defineContractSuite,
  llmContractCases,
  startBedrockStub,
  startVertexStub,
  startVllmStub,
  stubCredential,
  type AiStub,
} from "@infrabyx/testing";
import { BedrockClaudeLlm, bedrockObservedRegion } from "../bedrock_claude_in.js";
import { VertexGeminiLlm, vertexObservedRegion } from "../gemini_vertex_asia_south1.js";
import { VllmLlm } from "../self_hosted_vllm.js";

let bedrock: AiStub;
let vertex: AiStub;
let vllm: AiStub;
const token = stubCredential();
beforeAll(async () => {
  bedrock = await startBedrockStub();
  vertex = await startVertexStub(token);
  vllm = await startVllmStub();
});
afterAll(async () => {
  await Promise.all([bedrock?.close(), vertex?.close(), vllm?.close()]);
});

const bedrockAdapter = () =>
  new BedrockClaudeLlm({
    endpoint: bedrock.url,
    allowLoopbackHttp: true,
    credentials: { accessKeyId: "AKIASTUB", secretAccessKey: stubCredential() },
  });
const vertexAdapter = () =>
  new VertexGeminiLlm({
    project: "infrabyx-test",
    accessToken: async () => token,
    baseUrl: vertex.url,
    allowLoopbackHttp: true,
  });
const vllmAdapter = () => new VllmLlm({ baseUrl: vllm.url, allowLoopbackHttp: true });

defineContractSuite("LLM", bedrockAdapter, llmContractCases("anthropic.claude-contract"), {
  leg: "hermetic",
});
defineContractSuite("LLM", vertexAdapter, llmContractCases("gemini-contract"), { leg: "hermetic" });
defineContractSuite("LLM", vllmAdapter, llmContractCases("open-weights-contract"), {
  leg: "hermetic",
});

describe("bedrock_claude_in specifics", () => {
  it("residency check: only the ap-south-1 runtime host counts as Mumbai (IPB-03-23)", () => {
    expect(bedrockObservedRegion("ap-south-1")).toBe("ap-south-1");
    expect(
      bedrockObservedRegion("ap-south-1", "https://bedrock-runtime.ap-south-1.amazonaws.com"),
    ).toBe("ap-south-1");
    expect(
      bedrockObservedRegion("ap-south-1", "https://bedrock-runtime.us-east-1.amazonaws.com"),
    ).toBe("us-east-1");
    expect(
      bedrockObservedRegion("ap-south-1", "http://bedrock-runtime.ap-south-1.amazonaws.com"),
    ).toBeNull();
    expect(bedrockObservedRegion("ap-south-1", "https://proxy.example.org")).toBeNull();
    const wrong = new BedrockClaudeLlm({
      region: "us-east-1",
      credentials: { accessKeyId: "x", secretAccessKey: "y" },
    });
    expect(wrong.descriptor.observedRegion).toBe("us-east-1");
    expect(wrong.descriptor.region).toBe("ap-south-1");
  });

  it("refuses cross-region inference profiles before any call", async () => {
    const before = bedrock.requests.length;
    await expect(
      bedrockAdapter().chat({
        model: "apac.anthropic.claude-x",
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        maxOutputTokens: 8,
        timeoutMs: 2000,
      }),
    ).rejects.toMatchObject({ retryable: false });
    expect(bedrock.requests.length).toBe(before);
  });

  it("signs with SigV4 and sends system, messages and tool specs in the Converse shape", async () => {
    await bedrockAdapter().chat({
      model: "anthropic.claude-contract",
      system: "SYS",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "t", description: "d", parameters: { type: "object" } }],
      maxOutputTokens: 8,
      timeoutMs: 2000,
    });
    const r = bedrock.requests.at(-1)!;
    expect(r.path).toBe("/model/anthropic.claude-contract/converse");
    expect(r.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIASTUB\/\d{8}\/ap-south-1\/bedrock\/aws4_request/,
    );
    expect(r.json()).toMatchObject({
      system: [{ text: "SYS" }],
      messages: [{ role: "user", content: [{ text: "hello" }] }],
      inferenceConfig: { maxTokens: 8 },
      toolConfig: {
        tools: [{ toolSpec: { name: "t", inputSchema: { json: { type: "object" } } } }],
      },
    });
  });
});

describe("gemini_vertex_asia_south1 specifics", () => {
  it("residency check: host prefix must be asia-south1 (IPB-03-23)", () => {
    expect(
      vertexObservedRegion("asia-south1", "https://asia-south1-aiplatform.googleapis.com"),
    ).toBe("asia-south1");
    expect(
      vertexObservedRegion("asia-south1", "https://us-central1-aiplatform.googleapis.com"),
    ).toBe("us-central1");
    expect(vertexObservedRegion("asia-south1", "https://aiplatform.googleapis.com")).toBeNull();
    const elsewhere = new VertexGeminiLlm({
      project: "infrabyx-test",
      location: "us-central1",
      accessToken: async () => token,
    });
    expect(elsewhere.descriptor.observedRegion).not.toBe(elsewhere.descriptor.region);
  });

  it("sends the bearer token and maps roles, system and generation config", async () => {
    await vertexAdapter().chat({
      model: "gemini-contract",
      system: "SYS",
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
      maxOutputTokens: 9,
      temperature: 0,
      timeoutMs: 2000,
    });
    const r = vertex.requests.at(-1)!;
    expect(r.headers.authorization).toBe(`Bearer ${token}`);
    expect(r.path).toBe(
      "/v1/projects/infrabyx-test/locations/asia-south1/publishers/google/models/gemini-contract:generateContent",
    );
    expect(r.json()).toMatchObject({
      systemInstruction: { parts: [{ text: "SYS" }] },
      contents: [{ role: "user" }, { role: "model" }, { role: "user" }],
      generationConfig: { maxOutputTokens: 9, temperature: 0 },
    });
  });

  it("an access-token failure is refused, not retried", async () => {
    const a = new VertexGeminiLlm({
      project: "infrabyx-test",
      accessToken: async () => {
        throw new Error("no identity");
      },
      baseUrl: vertex.url,
      allowLoopbackHttp: true,
    });
    await expect(
      a.chat({
        model: "gemini-contract",
        system: "",
        messages: [{ role: "user", content: "x" }],
        maxOutputTokens: 4,
        timeoutMs: 2000,
      }),
    ).rejects.toMatchObject({ retryable: false });
  });
});

describe("self_hosted_vllm specifics", () => {
  it("is the SELF route: residency SELF, max class SECRET, IPB-01 residency IN", () => {
    const a = vllmAdapter();
    expect(a.descriptor).toMatchObject({
      aiResidency: "SELF",
      maxDataClass: "SECRET",
      residency: "IN",
    });
  });

  it("refuses a host other than the configured one and plain HTTP outside tests", async () => {
    const a = new VllmLlm({ baseUrl: "http://vllm.internal.example" });
    await expect(
      a.chat({
        model: "m",
        system: "",
        messages: [{ role: "user", content: "x" }],
        maxOutputTokens: 4,
        timeoutMs: 2000,
      }),
    ).rejects.toMatchObject({ retryable: false });
  });
});
