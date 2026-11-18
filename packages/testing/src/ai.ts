// AI test doubles (PL4 plan §2): a scripted `FakeLlm` and a deterministic `FakeEmbedding`. They
// implement the contracts ports, record every request (so a test can prove which adapter was or
// was not called), and never reach a network. No test in this repository calls a paid provider.
export {
  type FakeAiOptions,
  type FakeLlmReply,
  FakeLlm,
  providerError,
  FakeEmbedding,
  FakeImageGen,
  FakeSpeech,
  FakeRerank,
} from "@infrabyx/fakes";
