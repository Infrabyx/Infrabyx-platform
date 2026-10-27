// MEDIA port contract cases (IPB-01-15; OWNER-QUESTIONS #53). Every adapter passes the same suite;
// `passthrough` declares `reencode` and `rasteriseSvg` unsupported, so those cases assert the typed
// refusal instead. Fixtures are built here with node:zlib (no image library in tests' inputs).
import { crc32, deflateSync } from "node:zlib";
import { expect } from "vitest";
import {
  MEDIA_FORMAT_MIME,
  MEDIA_MAX_INPUT_PIXELS,
  type MediaFormat,
  type MediaPort,
} from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";

const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  const td = new Uint8Array(4 + data.length);
  td.set(new TextEncoder().encode(type), 0);
  td.set(data, 4);
  out.set(td, 4);
  v.setUint32(8 + data.length, crc32(td));
  return out;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function ihdr(width: number, height: number): Uint8Array {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  d.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, deflate, no filter method, no interlace
  return chunk("IHDR", d);
}

/**
 * An RGB PNG test image (a horizontal gradient), with a `tEXt` chunk the adapters must not carry
 * into any output.
 */
export function testPng(width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const g = Math.round((x / Math.max(1, width - 1)) * 255);
      raw.set([g, 96, 255 - g], row + 1 + x * 3);
    }
  }
  return concat([
    PNG_SIG,
    ihdr(width, height),
    chunk("tEXt", new TextEncoder().encode("Comment\0contract-secret-metadata")),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** A PNG whose header claims more pixels than `MEDIA_MAX_INPUT_PIXELS` (its data is not valid). */
export function oversizedPngHeader(): Uint8Array {
  const side = Math.ceil(Math.sqrt(MEDIA_MAX_INPUT_PIXELS)) + 1000;
  return concat([
    PNG_SIG,
    ihdr(side, side),
    chunk("IDAT", deflateSync(new Uint8Array(16))),
    chunk("IEND", new Uint8Array()),
  ]);
}

const MAGIC: Record<MediaFormat, (b: Uint8Array) => boolean> = {
  png: (b) => PNG_SIG.every((v, i) => b[i] === v),
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
  webp: (b) =>
    new TextDecoder().decode(b.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(b.subarray(8, 12)) === "WEBP",
  avif: (b) =>
    new TextDecoder().decode(b.subarray(4, 8)) === "ftyp" &&
    /avi[fs]/.test(new TextDecoder().decode(b.subarray(8, 32))),
};

/** True when the bytes are of `format` (by magic number). */
export const isFormat = (format: MediaFormat, b: Uint8Array) => MAGIC[format](b);

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
