// IMAGE_GEN reference adapter `gemini_imagen` (IPB-03-05; owner decision OWN-10): Imagen on Vertex AI
// in asia-south1, `:predict` over plain HTTPS with the same access-token provider as Gemini
// (`vertexServiceAccountToken`, C-24 / PL4-C-01, or workload identity). Prompts are INTERNAL.
// - Output is always PNG (`outputOptions.mimeType`), because only PNG can be labelled before it is
//   stored (`@infrabyx/ai` refuses anything else).
// - `personGeneration: "dont_allow"`: no images of people at all, on top of the gateway's refusal
//   of real identifiable persons (IPB-03-05).
// - `size` maps to the nearest supported aspect ratio; `edit` and `variations` are not offered in
//   PL4 (they need Imagen's capability model and reference images).
// Vendor facts are [VERIFY] until the sandbox leg runs with the owner's approval (#64).
import type {
  GeneratedImageBytes,
  ImageGenPort,
  ImageGenPortRequest,
  ModelCapability,
} from "@infrabyx/contracts";
import { refuse } from "../llm/common.js";
import { VertexBase, type VertexOptions } from "../llm/gemini_vertex_asia_south1.js";

export const IMAGEN_ADAPTER_KEY = "gemini_imagen";

const RATIOS: readonly [string, number][] = [
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["3:4", 3 / 4],
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
];

/** `WIDTHxHEIGHT` → the nearest Imagen aspect ratio. */
export function imagenAspectRatio(size: string): string {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(size);
  if (!m) throw refuse(IMAGEN_ADAPTER_KEY, `size ${size} is not WIDTHxHEIGHT`);
  const r = Number(m[1]) / Number(m[2]);
  return [...RATIOS].sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0]![0];
}

interface PredictResponse {
  predictions?: { bytesBase64Encoded?: string; mimeType?: string; raiFilteredReason?: string }[];
}

export class GeminiImagen extends VertexBase implements ImageGenPort {
  constructor(o: VertexOptions) {
    super(
      o,
      "IMAGE_GEN",
      { edit: "unsupported", variations: "unsupported" },
      {
        adapterKey: IMAGEN_ADAPTER_KEY,
        maxDataClass: "INTERNAL",
      },
    );
  }

  capabilities(): readonly ModelCapability[] {
    return ["image"];
  }

  async generate(req: ImageGenPortRequest): Promise<GeneratedImageBytes[]> {
    if (req.n < 1 || req.n > 4) throw refuse(IMAGEN_ADAPTER_KEY, "n must be 1 to 4");
    const url = `${this.base}/v1/projects/${this.o.project}/locations/${this.location}/publishers/google/models/${encodeURIComponent(req.model)}:predict`;
    const { json } = await this.post<PredictResponse>(
      url,
      {
        instances: [{ prompt: req.prompt }],
        parameters: {
          sampleCount: req.n,
          aspectRatio: imagenAspectRatio(req.size),
          personGeneration: "dont_allow",
          outputOptions: { mimeType: "image/png" },
        },
      },
      req.timeoutMs,
    );
    const out = (json.predictions ?? []).filter((p) => p.bytesBase64Encoded);
    if (!out.length) throw refuse(IMAGEN_ADAPTER_KEY, "no image returned (filtered)");
    return out.map((p) => ({
      bytes: new Uint8Array(Buffer.from(p.bytesBase64Encoded as string, "base64")),
      mimeType: p.mimeType === "image/png" ? "image/png" : "image/jpeg",
    }));
  }

  async edit(): Promise<GeneratedImageBytes[]> {
    throw refuse(IMAGEN_ADAPTER_KEY, "edit is not offered in PL4");
  }

  async variations(): Promise<GeneratedImageBytes[]> {
    throw refuse(IMAGEN_ADAPTER_KEY, "variations are not offered in PL4");
  }
}
