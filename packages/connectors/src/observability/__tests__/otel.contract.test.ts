// OBSERVABILITY contract legs (PL2 plan §6.3, A-05). Unit leg: no exporter. Hermetic leg: one OTel
// Collector with two OTLP receivers — `collector` (open) and `otlp-direct` (bearer-token auth, like a
// vendor intake) — each written to its own file. Both profiles must yield the same scrubbed telemetry.
import { chmodSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineContractSuite, startService, type StartedService } from "@infrabyx/testing";
import { OtelObservability, type OtelOptions, type OtelProfile } from "../otel.js";

const TOKEN = "contract-intake-token";
const CONFIG = `
extensions:
  bearertokenauth/intake:
    token: "${TOKEN}"
receivers:
  otlp/collector:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
  otlp/direct:
    protocols:
      http:
        endpoint: 0.0.0.0:4319
        auth:
          authenticator: bearertokenauth/intake
exporters:
  file/collector:
    path: /out/collector.jsonl
    flush_interval: 100ms
  file/direct:
    path: /out/direct.jsonl
    flush_interval: 100ms
service:
  extensions: [bearertokenauth/intake]
  pipelines:
    traces/collector: { receivers: [otlp/collector], exporters: [file/collector] }
    metrics/collector: { receivers: [otlp/collector], exporters: [file/collector] }
    logs/collector: { receivers: [otlp/collector], exporters: [file/collector] }
    traces/direct: { receivers: [otlp/direct], exporters: [file/direct] }
    metrics/direct: { receivers: [otlp/direct], exporters: [file/direct] }
    logs/direct: { receivers: [otlp/direct], exporters: [file/direct] }
`;

const hashId = (id: string) => `h_${id.length}`;
const base: OtelOptions = {
  serviceName: "contract",
  env: "test",
  profile: "collector",
  endpoint: null,
  samplingRatio: 1,
  hashId,
  allowInsecure: true,
  metricIntervalMs: 500,
};

defineContractSuite("OBSERVABILITY", () => new OtelObservability(base), [], { leg: "unit" });

describe("OBSERVABILITY hermetic leg (otel → Collector 0.162.0)", () => {
  let svc: StartedService;
  let out: string;
  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), "otelcol-"));
    chmodSync(out, 0o777);
    svc = await startService("otelcol", {
      ports: [4318, 4319],
      files: [{ content: CONFIG, target: "/etc/otelcol-contrib/contract.yaml" }],
      command: ["--config=/etc/otelcol-contrib/contract.yaml"],
      readyLog: /Everything is ready/,
      configure: (c) => c.withBindMounts([{ source: out, target: "/out", mode: "rw" }]),
    });
  });
  afterAll(async () => svc?.stop());

  const adapter = (profile: OtelProfile, token = TOKEN) =>
    new OtelObservability({
      ...base,
      profile,
      endpoint: `http://${svc.host}:${svc.ports[profile === "collector" ? 4318 : 4319]}`,
      ...(profile === "otlp-direct" ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });

  /** Emit the same telemetry through one profile and return what the Collector wrote. */
  async function emit(profile: OtelProfile) {
    const o = adapter(profile);
    const obs = o.callObserver(() => 5);
    obs
      .start("port.EMAIL.send", {
        adapter: "ses",
        residency: "IN",
        data_class: "INTERNAL",
        tenant_id: hashId("tnt_a"),
      })
      .end("ok");
    o.aiTrace("chat", {
      "gen_ai.request.model": "reasoning-large",
      "gen_ai.input.messages": "patient PAN ABCDE1234F",
      "gen_ai.usage.input_tokens": 12,
    }).end("ok");
    o.log("warn", "refund failed for ravi@example.in", {
      pan: "ABCDE1234F",
      tenant_id: "tnt_a",
      token: "t",
    });
    await o.flush();
    await o.shutdown();
    const file = join(out, profile === "collector" ? "collector.jsonl" : "direct.jsonl");
    for (let i = 0; i < 50 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 500));
    return readFileSync(file, "utf8");
  }

  /** Normalised view: span names and attributes, metric names, log bodies and attributes. */
  function view(raw: string) {
    const spans: string[] = [];
    const metrics = new Set<string>();
    const logs: string[] = [];
    const attrs = (a: Array<{ key: string; value: Record<string, unknown> }> = []) =>
      Object.fromEntries(a.map((x) => [x.key, Object.values(x.value)[0]]).sort());
    for (const line of raw.split("\n").filter(Boolean)) {
      const j = JSON.parse(line);
      for (const rs of j.resourceSpans ?? [])
        for (const ss of rs.scopeSpans)
          for (const s of ss.spans) spans.push(JSON.stringify([s.name, attrs(s.attributes)]));
      for (const rm of j.resourceMetrics ?? [])
        for (const sm of rm.scopeMetrics) for (const m of sm.metrics) metrics.add(m.name);
      for (const rl of j.resourceLogs ?? [])
        for (const sl of rl.scopeLogs)
          for (const l of sl.logRecords) logs.push(JSON.stringify([l.body, attrs(l.attributes)]));
    }
    return { spans: spans.sort(), metrics: [...metrics].sort(), logs };
  }

  it("collector profile exports scrubbed spans, metrics and logs", async () => {
    const raw = await emit("collector");
    for (const leak of ["ABCDE1234F", "ravi@example.in", "tnt_a", '"t"'])
      expect(raw).not.toContain(leak);
    const v = view(raw);
    const call = v.spans.find((s) => s.startsWith('["port.EMAIL.send"'));
    expect(JSON.parse(call ?? "[]")[1]).toMatchObject({
      adapter: "ses",
      outcome: "ok",
      tenant_id: hashId("tnt_a"),
    });
    expect(v.spans.some((s) => s.startsWith('["chat reasoning-large"'))).toBe(true);
    expect(raw).not.toContain("gen_ai.input.messages");
    expect(v.metrics).toEqual(["port_call_duration_ms", "port_call_total"]);
    expect(v.logs[0]).toContain("rXXX@example.in");
    expect(v.logs[0]).toContain("ABCXX1234X");
  });

  it("otlp-direct profile with auth headers yields identical telemetry (A-05)", async () => {
    const collector = view(readFileSync(join(out, "collector.jsonl"), "utf8"));
    expect(view(await emit("otlp-direct"))).toEqual(collector);
  });

  it("a rejected or unreachable exporter never blocks or throws to the caller", async () => {
    const bad = adapter("otlp-direct", "wrong-token");
    bad.startSpan("port.EMAIL.send").end("ok");
    await bad.flush();
    expect((await bad.health()).status).toBe("degraded");
    await bad.shutdown();
    const down = new OtelObservability({ ...base, endpoint: "http://127.0.0.1:9" });
    const t0 = Date.now();
    down.log("error", "x");
    down.startSpan("s").end("error");
    expect(Date.now() - t0).toBeLessThan(50);
    await down.shutdown();
  });
});
