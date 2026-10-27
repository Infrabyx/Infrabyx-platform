// IMAGE_GEN contract legs (PL4 plan §6, §15). Hermetic: the Vertex AI stub (Imagen `:predict`) and
// the FLUX stub. The sandbox legs need the owner's accounts, a host and an approved paid run (O-6):
// they are not defined until then, so nothing here can reach a provider.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defineContractSuite,
  imageGenContractCases,
  startFluxStub,
  startVertexStub,
  stubCredential,
  type AiStub,
} from "@infrabyx/testing";
import { FluxSelfHosted } from "../flux_self_hosted.js";
import { GeminiImagen, imagenAspectRatio } from "../gemini_imagen.js";

let vertex: AiStub;
let flux: AiStub;
const token = stubCredential();
beforeAll(async () => {
  vertex = await startVertexStub(token);
  flux = await startFluxStub();
});
afterAll(async () => {
  await Promise.all([vertex?.close(), flux?.close()]);
});

const imagen = () =>
  new GeminiImagen({
    project: "infrabyx-test",
    accessToken: async () => token,
    baseUrl: vertex.url,
    allowLoopbackHttp: true,
  });
const fluxAdapter = () => new FluxSelfHosted({ baseUrl: flux.url, allowLoopbackHttp: true });

defineContractSuite("IMAGE_GEN", imagen, imageGenContractCases("imagen-contract"), {
  leg: "hermetic",
});
defineContractSuite("IMAGE_GEN", fluxAdapter, imageGenContractCases("flux-contract"), {
  leg: "hermetic",
});

describe("gemini_imagen specifics", () => {
  it("asks for PNG, no people, the nearest aspect ratio, in asia-south1", async () => {
    await imagen().generate({
      model: "imagen-contract",
      prompt: "A line diagram of a payment flow.",
      size: "1920x1080",
      n: 1,
      timeoutMs: 2000,
    });
    const sent = vertex.requests.at(-1)!;
    expect(sent.path).toMatch(
      /\/locations\/asia-south1\/publishers\/google\/models\/imagen-contract:predict$/,
    );
    expect(sent.json()).toMatchObject({
      parameters: {
        aspectRatio: "16:9",
        personGeneration: "dont_allow",
        outputOptions: { mimeType: "image/png" },
      },
    });
    expect(imagenAspectRatio("600x800")).toBe("3:4");
  });

  it("is IN-resident, INTERNAL only, and refuses edit and variations", async () => {
    const a = imagen();
    expect(a.descriptor).toMatchObject({
      adapterKey: "gemini_imagen",
      aiResidency: "IN",
      region: "asia-south1",
      maxDataClass: "INTERNAL",
    });
    await expect(a.edit()).rejects.toMatchObject({ retryable: false });
    await expect(a.variations()).rejects.toMatchObject({ retryable: false });
  });
});

describe("flux_self_hosted specifics", () => {
  it("is the SELF route and calls only its configured host", async () => {
    expect(fluxAdapter().descriptor).toMatchObject({
      aiResidency: "SELF",
      maxDataClass: "INTERNAL",
    });
    const other = new FluxSelfHosted({ baseUrl: "http://flux.internal.example" });
    await expect(
      other.generate({ model: "m", prompt: "x", size: "64x64", n: 1, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ retryable: false });
  });
});
