import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PORT_CATALOGUE } from "@infrabyx/contracts/ports";
import { PORT_EXIT } from "./exit.js";

const SRC = fileURLToPath(new URL(".", import.meta.url));
/** Adapter folders under src/ and their ports (`llm` is LLM; shared folders have no port). */
const NOT_PORTS = new Set(["__tests__", "ai", "core", "messaging"]);
const portFolders = readdirSync(SRC).filter(
  (d) => statSync(join(SRC, d)).isDirectory() && !NOT_PORTS.has(d),
);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : sources(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [readFileSync(p, "utf8")] : [];
  });
}

describe("PORT_EXIT (IPB-01 §01.4.13)", () => {
  it("has one entry for every port this package builds adapters for, and only catalogue ports", () => {
    const ports = PORT_EXIT.map((e) => e.port);
    expect(new Set(ports).size).toBe(ports.length);
    for (const d of portFolders) expect(ports).toContain(d.toUpperCase().replace(/-/g, "_"));
    for (const p of ports) expect(Object.keys(PORT_CATALOGUE)).toContain(p);
  });

  it("names adapters that exist in this package (their descriptor names)", () => {
    const text = sources(SRC).join("\n");
    for (const e of PORT_EXIT)
      for (const name of [e.primary, e.exitTarget])
        expect(
          text.includes(`"${name}"`) || text.includes(`"${name.replace(/-/g, "_")}"`),
          `${e.port}: adapter ${name}`,
        ).toBe(true);
  });

  it("states a data-move method and the lock-in residue for every port", () => {
    for (const e of PORT_EXIT) {
      expect(e.dataMove.length, e.port).toBeGreaterThan(10);
      expect(e.lockIn.length, e.port).toBeGreaterThan(3);
      expect(["S", "M", "L"]).toContain(e.volumeClass);
    }
  });
});
