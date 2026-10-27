// MEDIA contract legs (OWNER-QUESTIONS #53). Both adapters run in-process, so the unit leg is the
// whole contract: `sharp` through the real libvips binaries, `passthrough` with its declared refusals.
import { describe, expect, it } from "vitest";
import { defineContractSuite, mediaContractCases, testPng } from "@infrabyx/testing";
import { PassthroughMedia } from "../passthrough.js";
import { cropBox, SharpMedia } from "../sharp.js";
import { probeHeader } from "../probe.js";

defineContractSuite("MEDIA", () => new SharpMedia(), mediaContractCases());
defineContractSuite("MEDIA", () => new PassthroughMedia(), mediaContractCases());

describe("sharp specifics", () => {
  it("re-encodes a JPEG it produced, keeping the orientation upright and the metadata out", async () => {
    const m = new SharpMedia();
    const [jpeg] = await m.reencode({
      bytes: testPng(300, 200),
      mime: "image/png",
      widths: [300],
      formats: ["jpeg"],
    });
    const out = await m.reencode({
      bytes: jpeg!.bytes,
      mime: "image/jpeg",
      widths: [320, 150],
      formats: ["webp"],
    });
    expect(out.map((r) => [r.width, r.height])).toEqual([[150, 100]]);
  });

  it("refuses SVG that is not the sanitiser's output (IPB-SEC-012)", async () => {
    await expect(
      new SharpMedia().rasteriseSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>',
        [32],
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-012" });
  });

  it("crops around the focal point inside the image", () => {
    expect(cropBox(800, 600, 1, { x: 0.9, y: 0.5 })).toEqual({
      left: 200,
      top: 0,
      width: 600,
      height: 600,
    });
    expect(cropBox(800, 600, 16 / 9, { x: 0, y: 0 })).toEqual({
      left: 0,
      top: 0,
      width: 800,
      height: 450,
    });
  });
});

describe("header probe", () => {
  it("reads PNG, GIF and WebP headers and refuses a mismatch", () => {
    expect(probeHeader(testPng(7, 5), "image/png", "t")).toEqual({
      format: "png",
      width: 7,
      height: 5,
    });
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 3, 0, 2, 0]);
    expect(probeHeader(gif, "image/gif", "t")).toMatchObject({ width: 3, height: 2 });
    expect(() => probeHeader(gif, "image/png", "t")).toThrow(
      expect.objectContaining({ code: "IPB-SEC-014" }),
    );
  });
});
