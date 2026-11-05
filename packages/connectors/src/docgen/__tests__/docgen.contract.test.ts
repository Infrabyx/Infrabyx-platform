// DOCGEN contract leg (#120, R1-D-100; R1-plan M71). Hermetic: the pinned Gotenberg image (Chromium
// and LibreOffice, fonts-noto-core). The generic `renderHtml` cases, then Hindi and Punjabi: the PDF
// must embed Noto Sans Devanagari and Noto Sans Gurmukhi, so the text is shaped with real fonts
// (no missing-glyph boxes from a fallback font).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defineContractSuite,
  docgenHtmlContractCases,
  MemoryStorage,
  startService,
  type StartedService,
} from "@infrabyx/testing";
import { GotenbergDocgen } from "../gotenberg.js";

let gb: StartedService;
const storage = new MemoryStorage();
let adapter: GotenbergDocgen;

beforeAll(async () => {
  gb = await startService("gotenberg", {
    ports: [3000],
    readyHttp: { path: "/health", port: 3000 },
  });
  adapter = new GotenbergDocgen({
    baseUrl:
      gb.url ?? `http://${gb.host === "localhost" ? "127.0.0.1" : gb.host}:${gb.ports[3000]}`,
    storage,
    enabled: () => true,
    allowLoopbackHttp: true,
  });
}, 240_000);
afterAll(async () => gb?.stop());

defineContractSuite("DOCGEN", () => adapter, docgenHtmlContractCases(), { leg: "hermetic" });

describe("DOCGEN gotenberg: vernacular documents (#120)", () => {
  it("renders Hindi and Punjabi with Noto Sans Devanagari and Gurmukhi embedded", async () => {
    const html =
      `<!doctype html><html lang="hi"><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
      `<style>body{font-family:'Noto Sans Devanagari','Noto Sans Gurmukhi','Noto Sans',sans-serif}</style></head><body>` +
      `<h1>मुख्य तथ्य विवरण</h1><p>ऋण राशि: ₹1,25,000; ब्याज दर: 18% वार्षिक</p>` +
      `<p lang="pa">ਮੁੱਖ ਤੱਥ ਬਿਆਨ: ਕਰਜ਼ੇ ਦੀ ਰਕਮ ₹1,25,000</p></body></html>`;
    const r = await adapter.renderHtml({ html, format: "pdf", outputPrefix: "tenant/tnt_a/kfs" });
    const pdf = Buffer.from((await storage.get(r.file.storageKey)).body).toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toMatch(/NotoSansDevanagari/);
    expect(pdf).toMatch(/NotoSansGurmukhi/);
    expect(r.pageCount).toBe(1);
  }, 120_000);
});
