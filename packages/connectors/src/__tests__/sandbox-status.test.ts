// sandbox-status.json is complete (Udofin PR-UDF-078; R1-D-268; IPB-DEV-04 gate B). A product's
// `infrabyx-routing check --sandbox-status` reads this file alone, so an adapter missing from it is
// never refused above staging. Every adapter this package publishes (each descriptor's `adapter`,
// found in the sources) is listed once: under `adapters` (vendor or counterparty sandbox leg,
// refused while unproven) or under `hermetic` (self-hosted, in-process or composite; never refused
// for this file). Runs on every unit run, so a new adapter cannot ship unlisted.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadUnprovenAdapters } from "@infrabyx/config/routing";
import { defaultRegistry } from "@infrabyx/config/settings";
import { PORT_CATALOGUE } from "@infrabyx/contracts/ports";
import { checkRouting } from "@infrabyx/contracts/routing";
import { PORT_EXIT } from "../exit.js";

interface SandboxEntry {
  status: string;
  needs: string;
  issue?: number;
  offBy?: string[];
}
interface SandboxStatus {
  adapters: Record<string, SandboxEntry>;
  hermetic: Record<string, { port: string; kind: string }>;
}

const SRC = fileURLToPath(new URL("..", import.meta.url));
const STATUS_PATH = fileURLToPath(new URL("../../sandbox-status.json", import.meta.url));
const status = JSON.parse(readFileSync(STATUS_PATH, "utf8")) as SandboxStatus;

/** Labels the scan finds that are not port adapters. */
const NOT_ADAPTERS = new Map([
  // The customer sign-in DPoP replay store's error label (identity/customer.ts), not a port adapter.
  ["redis-replay", "replay store"],
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : sourceFiles(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

/** Every adapter name in the sources, with the files that declare it. */
function publishedAdapters(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (name: string, file: string) =>
    found.set(name, [...(found.get(name) ?? []), file.slice(SRC.length)]);
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    // `adapter: "x"`, `adapter: "a" | "b"` and `adapter: "a" | "b" = "a"` (descriptors, options).
    for (const m of text.matchAll(/\badapter\??:\s*((?:"[a-z0-9-]+"\s*\|?\s*)+)/g))
      for (const q of (m[1] as string).matchAll(/"([a-z0-9-]+)"/g)) add(q[1] as string, file);
    // `const ADAPTER = "x"`, `export const BEDROCK_ADAPTER_KEY = "bedrock_claude_in"` (the AI
    // descriptors turn `_` into `-`), `SHARP_MEDIA_ADAPTER`.
    for (const m of text.matchAll(/\bconst\s+[A-Z_]*ADAPTER(?:_KEY)?\s*=\s*"([a-z0-9_-]+)"/g))
      add((m[1] as string).replace(/_/g, "-"), file);
    // The in-process engines name themselves (`readonly name = "zen"`).
    for (const m of text.matchAll(/\breadonly name = "([a-z0-9-]+)"/g)) add(m[1] as string, file);
  }
  for (const n of NOT_ADAPTERS.keys()) found.delete(n);
  return found;
}

describe("sandbox-status.json (IPB-DEV-04 gate B)", () => {
  const published = publishedAdapters();
  const listed = [...Object.keys(status.adapters), ...Object.keys(status.hermetic)];

  it("finds the adapters of every port folder (the scan is not blind)", () => {
    expect(published.size).toBeGreaterThan(60);
    for (const name of ["s3", "minio", "leegality", "nsdl-esign", "bedrock-claude-in", "zen"])
      expect(published.has(name), name).toBe(true);
  });

  it("lists every published adapter", () => {
    const missing = [...published.keys()].filter((n) => !listed.includes(n));
    expect(missing, `add to sandbox-status.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists only published adapters, each once", () => {
    expect(new Set(listed).size).toBe(listed.length);
    for (const n of listed) expect(published.has(n), `${n} is not an adapter here`).toBe(true);
    for (const e of PORT_EXIT)
      for (const n of [e.primary, e.exitTarget])
        if (published.has(n)) expect(listed, `${e.port}: ${n}`).toContain(n);
  });

  it("lists every ESIGN and ESTAMP adapter as unproven (PR-UDF-078)", () => {
    for (const n of [
      "leegality",
      "digio",
      "nsdl-esign",
      "nesl-dde",
      "shcil-estamp",
      "digio-estamp",
      "manual-paper",
    ])
      expect(status.adapters[n]?.status, n).toBe("unproven");
  });

  it("an unproven adapter names its port-contract issue or the settings that keep it off", () => {
    for (const [name, a] of Object.entries(status.adapters)) {
      expect(["unproven", "proven"], name).toContain(a.status);
      expect(a.needs.length, name).toBeGreaterThan(10);
      if (a.status === "proven" || name === "minio") continue;
      if (Number.isInteger(a.issue)) continue;
      expect(a.offBy?.length, `${name}: an issue or offBy`).toBeGreaterThan(0);
      for (const key of a.offBy ?? []) {
        const def = defaultRegistry.find(key);
        expect(def, `${name}: ${key} is registered`).toBeDefined();
        expect(def?.type, key).toBe("bool");
        expect(def?.default, `${key} defaults to off`).toBe(false);
      }
    }
  });

  it("the routing check reading this file alone refuses them above staging", async () => {
    const unproven = await loadUnprovenAdapters(STATUS_PATH);
    const doc = (port: string, adapter: string) => ({
      version: 1,
      ports: { [port]: { primary: { adapter, residency: "IN", max_data_class: "INTERNAL" } } },
    });
    const ports: Record<string, string> = {
      "nsdl-esign": "ESIGN",
      "nesl-dde": "ESTAMP",
      "shcil-estamp": "ESTAMP",
      "digio-estamp": "ESTAMP",
      "manual-paper": "ESTAMP",
    };
    const problems = (port: string, adapter: string, env: string): string => {
      try {
        checkRouting(doc(port, adapter), { env, unprovenAdapters: unproven });
        return "";
      } catch (e) {
        expect(e, `${adapter} in ${env}`).toMatchObject({ code: "IPB-PORT-005" });
        return ((e as { meta?: { problems?: string[] } }).meta?.problems ?? []).join("; ");
      }
    };
    for (const [adapter, port] of Object.entries(ports)) {
      for (const env of ["staging", "pre-prod", "prod", "dr"])
        expect(problems(port, adapter, env), `${adapter} in ${env}`).toContain(
          `adapter ${adapter} is unproven`,
        );
      expect(problems(port, adapter, "dev"), `${adapter} in dev`).toBe("");
    }
    expect(problems("IDENTITY", "keycloak", "prod")).toBe("");
  });

  it("a hermetic adapter names its catalogue port and why it has no sandbox leg", () => {
    for (const [name, h] of Object.entries(status.hermetic)) {
      expect(Object.keys(PORT_CATALOGUE), name).toContain(h.port);
      expect(["self-hosted", "in-process", "composite"], name).toContain(h.kind);
    }
  });
});
