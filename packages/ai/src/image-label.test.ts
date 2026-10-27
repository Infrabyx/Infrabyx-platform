// Image labelling (IPB-03-06; OWN-10): the caption band and the XMP packet.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { labelImage, pngSize, readXmp, solidPng, SGI_LABEL_TEXT } from "./image-label.js";

describe("labelImage", () => {
  it("adds a caption band and an XMP packet naming the model and run", () => {
    const src = solidPng(320, 200, [40, 120, 200]);
    const out = labelImage(src, "image/png", {
      modelId: "gemini_imagen/imagen-test",
      runId: "run_x",
    });
    expect(out.width).toBe(320);
    expect(out.height).toBeGreaterThan(200);
    expect(pngSize(out.bytes)).toEqual({ width: 320, height: out.height });
    const xmp = readXmp(out.bytes)!;
    expect(xmp).toContain('infrabyx:SGI="true"');
    expect(xmp).toContain('infrabyx:Model="gemini_imagen/imagen-test"');
    expect(xmp).toContain('infrabyx:Run="run_x"');
    expect(xmp).toContain("trainedAlgorithmicMedia");
    expect(xmp).toContain(SGI_LABEL_TEXT);
    expect(xmp).toContain("Infrabyx-SGI: true; model=gemini_imagen/imagen-test; run=run_x");
    expect(Buffer.from(out.bytes).toString("latin1")).toContain(
      "Infrabyx-SGI\0true; model=gemini_imagen/imagen-test; run=run_x",
    );
  });

  it("the band holds white label pixels on a dark background; the picture is unchanged", () => {
    const out = labelImage(solidPng(400, 100, [40, 120, 200]), "image/png", {
      modelId: "m",
      runId: "r",
    });
    // The labeller writes one IDAT with filter 0 on every row, so the raster can be read directly.
    const idat = Buffer.from(out.bytes);
    const start = idat.indexOf("IDAT") + 4;
    const len = idat.readUInt32BE(start - 8);
    const raw = inflateSync(idat.subarray(start, start + len));
    const stride = 400 * 3 + 1;
    const px = (x: number, y: number) => [
      ...raw.subarray(y * stride + 1 + x * 3, y * stride + 4 + x * 3),
    ];
    expect(px(10, 10)).toEqual([40, 120, 200]);
    let white = 0;
    let dark = 0;
    for (let y = 100; y < out.height; y++)
      for (let x = 0; x < 400; x++) {
        const p = px(x, y).join(",");
        if (p === "255,255,255") white++;
        else if (p === "17,17,17") dark++;
      }
    expect(white).toBeGreaterThan(100);
    expect(dark).toBeGreaterThan(white);
  });

  it("refuses what it cannot label", () => {
    expect(() =>
      labelImage(new Uint8Array([1, 2, 3]), "image/jpeg", { modelId: "m", runId: "r" }),
    ).toThrow(/cannot be labelled/);
    expect(() =>
      labelImage(new Uint8Array([1, 2, 3]), "image/png", { modelId: "m", runId: "r" }),
    ).toThrow(/not a PNG/);
  });
});

describe("SPEECH (deferred, #28)", () => {
  it("every call is IPB-AI-010", async () => {
    const { SpeechGateway } = await import("./speech.js");
    const g = new SpeechGateway();
    const ctx = { tenantId: "tnt_x", principal: { id: "usr_x", type: "user" as const, roles: [] } };
    await expect(g.stt(ctx, new Uint8Array(), { lang: "hi" })).rejects.toMatchObject({
      code: "IPB-AI-010",
    });
    await expect(g.tts(ctx, "x", { voice: "v", lang: "en" })).rejects.toMatchObject({
      code: "IPB-AI-010",
    });
  });
});
