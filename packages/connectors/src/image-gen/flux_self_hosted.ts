// IMAGE_GEN alternative adapter `flux_self_hosted` (IPB-03-05; owner answer #29, PL4-D-05): a FLUX
// model on our own inference host behind an OpenAI-compatible images endpoint
// (`POST /v1/images/generations`, `response_format: "b64_json"`). Residency SELF. There is no host
// yet (owner, 27 Oct 2026: no recurring GPU cost until a product needs one), so the adapter stays
// unproven (#65) and its API shape is [VERIFY] against the server chosen for the host.
import type {
  AiAdapterDescriptor,
  GeneratedImageBytes,
  ImageGenPort,
  ImageGenPortRequest,
  ModelCapability,
  PortHealth,
} from "@infrabyx/contracts";
import { createEgress } from "../core/http.js";
import { aiDescriptor, refuse, toProviderError } from "../llm/common.js";

export const FLUX_ADAPTER_KEY = "flux_self_hosted";

export interface FluxOptions {
  /** e.g. `https://flux.ai.svc.internal`; its host is the only one the adapter may call. */
  baseUrl: string;
  /** `secrets/<env>/ai/flux/api_key`, when the server requires one. */
  apiKey?: () => Promise<string | undefined> | string | undefined;
  /** Tests only. */
  allowLoopbackHttp?: boolean;
}

export class FluxSelfHosted implements ImageGenPort {
  readonly descriptor: AiAdapterDescriptor;
  private readonly base: string;
  private readonly host: string;

  constructor(private readonly o: FluxOptions) {
    const u = new URL(o.baseUrl);
    this.host = u.hostname;
    this.base = o.baseUrl.replace(/\/$/, "");
    this.descriptor = aiDescriptor({
      port: "IMAGE_GEN",
      adapterKey: FLUX_ADAPTER_KEY,
      aiResidency: "SELF",
      region: null,
      observedRegion: null,
      maxDataClass: "INTERNAL",
      capabilities: { edit: "unsupported", variations: "unsupported" },
    });
  }

  capabilities(): readonly ModelCapability[] {
    return ["image"];
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  async generate(req: ImageGenPortRequest): Promise<GeneratedImageBytes[]> {
    if (req.n < 1 || req.n > 4) throw refuse(FLUX_ADAPTER_KEY, "n must be 1 to 4");
    if (!/^\d{2,5}x\d{2,5}$/.test(req.size)) throw refuse(FLUX_ADAPTER_KEY, "size is not WxH");
    const egress = createEgress({
      port: "IMAGE_GEN",
      adapter: FLUX_ADAPTER_KEY,
      allow: [this.host],
      retries: 0,
      timeoutMs: req.timeoutMs,
      ...(this.o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
    const key = await this.o.apiKey?.();
    let res;
    try {
      res = await egress(`${this.base}/v1/images/generations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model: req.model,
          prompt: req.prompt,
          n: req.n,
          size: req.size,
          response_format: "b64_json",
          output_format: "png",
        }),
      });
    } catch (e) {
      throw toProviderError(e, FLUX_ADAPTER_KEY);
    }
    if (res.status >= 400)
      throw toProviderError(
        { name: "FluxError", $metadata: { httpStatusCode: res.status } },
        FLUX_ADAPTER_KEY,
      );
    const data = res.json<{ data?: { b64_json?: string }[] }>().data ?? [];
    if (!data.length) throw refuse(FLUX_ADAPTER_KEY, "no image returned");
    return data.map((d) => {
      const bytes = new Uint8Array(Buffer.from(d.b64_json ?? "", "base64"));
      const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
      return { bytes, mimeType: png ? "image/png" : "image/jpeg" };
    });
  }

  async edit(): Promise<GeneratedImageBytes[]> {
    throw refuse(FLUX_ADAPTER_KEY, "edit is not offered in PL4");
  }

  async variations(): Promise<GeneratedImageBytes[]> {
    throw refuse(FLUX_ADAPTER_KEY, "variations are not offered in PL4");
  }
}
