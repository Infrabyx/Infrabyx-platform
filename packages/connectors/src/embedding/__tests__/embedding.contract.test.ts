// EMBEDDING contract legs (PL4 plan §5, §15): Bedrock InvokeModel (Titan v2 body), Vertex `:predict`
// and vLLM `/v1/embeddings` stubs. No sandbox leg until the owner approves a paid run (O-6).
import { afterAll, beforeAll } from "vitest";
import {
  defineContractSuite,
  embeddingContractCases,
  startBedrockStub,
  startVertexStub,
  startVllmStub,
  stubCredential,
  type AiStub,
} from "@infrabyx/testing";
import { BedrockEmbedding, VertexEmbedding, VllmEmbedding } from "../index.js";

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

defineContractSuite(
  "EMBEDDING",
  () =>
    new BedrockEmbedding({
      endpoint: bedrock.url,
      allowLoopbackHttp: true,
      credentials: { accessKeyId: "AKIASTUB", secretAccessKey: stubCredential() },
    }),
  embeddingContractCases("amazon.titan-embed-text-v2:0"),
  { leg: "hermetic" },
);
defineContractSuite(
  "EMBEDDING",
  () =>
    new VertexEmbedding({
      project: "infrabyx-test",
      accessToken: async () => token,
      baseUrl: vertex.url,
      allowLoopbackHttp: true,
    }),
  embeddingContractCases("text-embedding-contract"),
  { leg: "hermetic" },
);
defineContractSuite(
  "EMBEDDING",
  () => new VllmEmbedding({ baseUrl: vllm.url, allowLoopbackHttp: true }),
  embeddingContractCases("bge-m3"),
  { leg: "hermetic" },
);
