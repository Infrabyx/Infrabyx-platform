// The reference deployment's BOM (IPB-01-40; PL6 plan §9.2). The cosign keyless signature of
// @IPB-01-AT-18 is made and verified in the release job (PL6-D-16); here the BOM itself.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBom, main, npmPurl, validateBom } from "./bom.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

describe("@IPB-01-AT-18 BOM generation (signed in the release job)", () => {
  it("writes docs/bom/<release>.cdx.json as valid CycloneDX 1.6 listing Node 24.22.1 and PostgreSQL 18", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "bom-")), "rc-1.cdx.json");
    const log = console.log;
    console.log = () => {};
    try {
      expect(await main(["--release", "rc-1", "--out", out])).toBe(0);
    } finally {
      console.log = log;
    }
    const bom = JSON.parse(readFileSync(out, "utf8"));
    expect(validateBom(bom)).toEqual([]);
    expect(bom.specVersion).toBe("1.6");
    expect(bom.metadata.component.version).toBe("rc-1");
    const node = bom.components.find((c) => c.type === "platform" && c.name === "node");
    expect(node.version).toBe(readFileSync(join(ROOT, ".nvmrc"), "utf8").trim());
    expect(node.version).toBe("24.22.1");
    expect(bom.components.find((c) => c["bom-ref"] === "database:postgresql@18")?.version).toBe(
      "18",
    );
    expect(bom.metadata.properties.find((p) => p.name === "infrabyx:signature").value).toMatch(
      /^cosign keyless.*release\.yml@refs\/heads\/main/,
    );
  });

  it("lists the lockfile's packages with their integrity, the workspace packages and the pinned images", async () => {
    const bom = await buildBom({ release: "t", now: new Date("2026-10-28T00:00:00Z") });
    const refs = bom.components.map((c) => c["bom-ref"]);
    expect(new Set(refs).size).toBe(refs.length);
    const zod = bom.components.find((c) => c.name === "zod" && c.type === "library");
    expect(zod.purl).toBe(npmPurl("zod", zod.version));
    expect(zod.hashes[0].alg).toBe("SHA-512");
    expect(bom.components.some((c) => c.group === "@infrabyx" && c.name === "connectors")).toBe(
      true,
    );
    const images = bom.components.filter((c) => c.type === "container");
    expect(images.length).toBeGreaterThan(5);
    for (const i of images.filter((x) => x.purl.includes("@sha256:")))
      expect(i.hashes[0].content).toMatch(/^[a-f0-9]{64}$/);
    expect(images.some((i) => i.name === "node" && i.version === "24.22.1-bookworm-slim")).toBe(
      true,
    );
  });

  it("is reproducible for the same release and refuses an invalid document", async () => {
    const a = await buildBom({ release: "x", now: new Date("2026-10-28T00:00:00Z") });
    const b = await buildBom({ release: "x", now: new Date("2026-10-28T00:00:00Z") });
    expect(a).toEqual(b);
    expect(npmPurl("@infrabyx/ui", "0.3.0")).toBe("pkg:npm/%40infrabyx/ui@0.3.0");
    expect(validateBom({ ...a, bomFormat: "SPDX" }).length).toBeGreaterThan(0);
    expect(validateBom({ ...a, components: [{ name: "no-type" }] }).length).toBeGreaterThan(0);
  });
});
