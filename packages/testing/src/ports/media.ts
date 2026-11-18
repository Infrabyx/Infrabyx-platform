// MEDIA port contract cases (IPB-01-15; OWNER-QUESTIONS #53). Every adapter passes the same suite;
// `passthrough` declares `reencode` and `rasteriseSvg` unsupported, so those cases assert the typed
// refusal instead. Fixtures are built here with node:zlib (no image library in tests' inputs).
import { expect } from "vitest";
import { MEDIA_FORMAT_MIME, type MediaPort } from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import { testPng, isFormat, oversizedPngHeader } from "@infrabyx/fakes";
export { testPng, oversizedPngHeader, isFormat } from "@infrabyx/fakes";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#1F4E79"/></svg>';

const errorCode = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );

export function mediaContractCases(): ContractCase<MediaPort>[] {
  const src = testPng(800, 600);
  return [
    {
      name: "probe reads the format and size of an image",
      method: "probe",
      async run(p) {
        expect(await p.probe(src, "image/png")).toEqual({ format: "png", width: 800, height: 600 });
      },
    },
    {
      name: "probe refuses bytes that are not an image of the declared type (IPB-SEC-014)",
      method: "probe",
      async run(p) {
        expect(await errorCode(p.probe(new TextEncoder().encode("<html>"), "image/png"))).toBe(
          "IPB-SEC-014",
        );
      },
    },
    {
      name: "reencode writes AVIF, WebP and the fallback at the fixed widths, never upscaled, without metadata",
      method: "reencode",
      invoke: (p) => p.reencode({ bytes: src, mime: "image/png", widths: [320], formats: ["png"] }),
      async run(p) {
        const out = await p.reencode({
          bytes: src,
          mime: "image/png",
          widths: [320, 640, 960],
          formats: ["avif", "webp", "png"],
        });
        expect(out.map((r) => `${r.format}@${r.width}x${r.height}`).sort()).toEqual(
          ["avif", "webp", "png"].flatMap((f) => [`${f}@320x240`, `${f}@640x480`]).sort(),
        );
        for (const r of out) {
          expect(r.mime).toBe(MEDIA_FORMAT_MIME[r.format]);
          expect(isFormat(r.format, r.bytes), `${r.format} magic`).toBe(true);
          expect(new TextDecoder("latin1").decode(r.bytes)).not.toContain(
            "contract-secret-metadata",
          );
        }
      },
    },
    {
      name: "reencode crops to an aspect ratio around the focal point",
      method: "reencode",
      invoke: (p) => p.reencode({ bytes: src, mime: "image/png", widths: [320], formats: ["png"] }),
      async run(p) {
        const [r] = await p.reencode({
          bytes: src,
          mime: "image/png",
          widths: [400],
          formats: ["png"],
          aspect: 1,
          focal: { x: 0.9, y: 0.5 },
        });
        expect([r!.width, r!.height]).toEqual([400, 400]);
      },
    },
    {
      name: "reencode refuses an image above the pixel limit before decoding (IPB-SEC-013)",
      method: "reencode",
      invoke: (p) => p.reencode({ bytes: src, mime: "image/png", widths: [320], formats: ["png"] }),
      async run(p) {
        expect(
          await errorCode(
            p.reencode({
              bytes: oversizedPngHeader(),
              mime: "image/png",
              widths: [320],
              formats: ["webp"],
            }),
          ),
        ).toBe("IPB-SEC-013");
      },
    },
    {
      name: "reencode refuses a type it does not re-encode (IPB-SEC-014)",
      method: "reencode",
      invoke: (p) => p.reencode({ bytes: src, mime: "image/png", widths: [320], formats: ["png"] }),
      async run(p) {
        expect(
          await errorCode(
            p.reencode({ bytes: src, mime: "image/gif", widths: [320], formats: ["webp"] }),
          ),
        ).toBe("IPB-SEC-014");
      },
    },
    {
      name: "rasteriseSvg returns square PNGs at each size",
      method: "rasteriseSvg",
      invoke: (p) => p.rasteriseSvg(SVG, [32]),
      async run(p) {
        const out = await p.rasteriseSvg(SVG, [32, 180]);
        expect(out.map((r) => [r.format, r.width, r.height])).toEqual([
          ["png", 32, 32],
          ["png", 180, 180],
        ]);
        for (const r of out) expect(isFormat("png", r.bytes)).toBe(true);
      },
    },
  ];
}
