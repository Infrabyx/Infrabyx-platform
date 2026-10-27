// EMBEDDING adapters (IPB-03-04; PL4 plan §5): the same providers as the LLM adapters.
export { BedrockEmbedding } from "../llm/bedrock_claude_in.js";
export { VertexEmbedding } from "../llm/gemini_vertex_asia_south1.js";
export { VllmEmbedding } from "../llm/self_hosted_vllm.js";
