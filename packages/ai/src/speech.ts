// SPEECH and RERANK (IPB-03-07, 03-08; owner answer #28, PL4-D-05): interfaces in `contracts`,
// fakes in `testing`, no adapters in PL4. Voice and audio wait for the surface that needs them, and
// retrieval runs without a reranker. Every speech call therefore fails with `IPB-AI-010`, and no
// audio or text reaches a provider outside the gateway's routing.
import { IpbError } from "@infrabyx/contracts/errors";
import type { KernelContext } from "@infrabyx/contracts/kernel";

const unavailable = (what: string) =>
  new IpbError("IPB-AI-010", {
    detail: `no SPEECH adapter is configured for ${what} (deferred, OWNER-QUESTIONS #28)`,
  });

export class SpeechGateway {
  async stt(_ctx: KernelContext, _audio: Uint8Array, _o: { lang: string }): Promise<never> {
    throw unavailable("speech to text");
  }

  async tts(
    _ctx: KernelContext,
    _text: string,
    _o: { voice: string; lang: string },
  ): Promise<never> {
    throw unavailable("text to speech");
  }
}
