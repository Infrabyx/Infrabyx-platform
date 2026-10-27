// IMAGE_GEN adapters (IPB-03-05; PL4 plan §6): the reference on Vertex AI and the self-hosted
// alternative. Both return PNG for labelling and are `unproven` until their sandbox legs run.
export { GeminiImagen, imagenAspectRatio, IMAGEN_ADAPTER_KEY } from "./gemini_imagen.js";
export { FluxSelfHosted, FLUX_ADAPTER_KEY, type FluxOptions } from "./flux_self_hosted.js";
