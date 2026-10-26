// OBSERVABILITY reference adapter `otel` (PL2 plan §6.3): OpenTelemetry SDK → OTLP/HTTP. Two exporter
// profiles share one code path (A-05): `collector` (in-cluster Collector) and `otlp-direct` (a vendor
// OTLP intake with auth headers from SECRETS). Every attribute, log context and message passes the
// IPB-02-23 scrubber; tenant and user IDs are C-21 hashes. Exporter failures never reach the caller.
import { SpanStatusCode, type Attributes, type Meter, type Tracer } from "@opentelemetry/api";
import { SeverityNumber, type Logger } from "@opentelemetry/api-logs";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import type {
  AdapterDescriptor,
  Attrs,
  LogLevel,
  ObservabilityPort,
  PortHealth,
  SpanHandle,
} from "@infrabyx/contracts/ports";
import type { CallObserver } from "../core/router.js";
import { createScrubber, type Scrubber } from "./scrub.js";

export type OtelProfile = "collector" | "otlp-direct";

export interface OtelOptions {
  serviceName: string;
  serviceNamespace?: string;
  env: string;
  profile: OtelProfile;
  /** OTLP/HTTP base URL (`…:4318`); null disables export (spans are still scrubbed and counted). */
  endpoint: string | null;
  /** `otlp-direct` only: auth headers resolved from SECRETS (`OBS_OTLP_HEADERS_REF`). */
  headers?: Readonly<Record<string, string>>;
  samplingRatio: number;
  /** C-21 hasher (`telemetryIdHasher` from @infrabyx/crypto). */
  hashId: (id: string) => string;
  logLevel?: LogLevel;
  /** Plain HTTP to the endpoint; only `OBS_OTLP_INSECURE` in local and test sets it. */
  allowInsecure?: boolean;
  metricIntervalMs?: number;
  /** Locked false (`eng.otel.genai.capture_content`); a true value is refused. */
  captureGenAiContent?: boolean;
}

const LEVELS: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

/** GenAI attributes that carry content; never exported while capture is off. */
const GENAI_CONTENT =
  /^gen_ai\.(prompt|completion|input\.messages|output\.messages|system_instructions|tool\.call\.(arguments|result))/;

const ROUTER_HASHED: ReadonlySet<string> = new Set(["tenant_id"]);

/** Records the last export outcome so health() can report a degraded exporter. */
class TrackedExporter implements SpanExporter {
  lastError: string | null = null;
  constructor(private readonly inner: SpanExporter) {}
  export(spans: ReadableSpan[], done: (r: ExportResult) => void): void {
    this.inner.export(spans, (r) => {
      this.lastError =
        r.code === ExportResultCode.SUCCESS ? null : (r.error?.message ?? "export failed");
      done(r);
    });
  }
  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

export class OtelObservability implements ObservabilityPort {
  readonly descriptor: AdapterDescriptor = {
    port: "OBSERVABILITY",
    adapter: "otel",
    residency: "IN",
    maxDataClass: "INTERNAL",
  };
  private readonly scrub: Scrubber;
  private readonly tracer: Tracer;
  private readonly meter: Meter;
  private readonly logger: Logger;
  private readonly traces: BasicTracerProvider;
  private readonly metrics: MeterProvider;
  private readonly logs: LoggerProvider;
  private readonly exporter: TrackedExporter | null;
  private readonly instruments = new Map<string, { record(v: number, a?: Attributes): void }>();
  private readonly minLevel: number;

  constructor(private readonly o: OtelOptions) {
    if (o.captureGenAiContent)
      throw new Error("eng.otel.genai.capture_content is locked false (IPB-02-23)");
    if (!(o.samplingRatio >= 0 && o.samplingRatio <= 1))
      throw new Error("samplingRatio must be within [0, 1]");
    if (o.endpoint) {
      const u = new URL(o.endpoint);
      if (u.protocol !== "https:" && !(u.protocol === "http:" && o.allowInsecure))
        throw new Error(
          "OTLP endpoint must be https (OBS_OTLP_INSECURE is for local and test only)",
        );
      if (o.profile === "otlp-direct" && !o.headers)
        throw new Error(
          "profile otlp-direct needs auth headers from SECRETS (OBS_OTLP_HEADERS_REF)",
        );
      if (o.profile === "collector" && o.headers)
        throw new Error(
          "profile collector sends no auth headers; use otlp-direct for a vendor intake",
        );
    }
    this.scrub = createScrubber(o.hashId);
    this.minLevel = LEVELS[o.logLevel ?? "info"];
    const resource = resourceFromAttributes({
      "service.name": o.serviceName,
      "service.namespace": o.serviceNamespace ?? "infrabyx",
      "deployment.environment.name": o.env,
    });
    const url = (signal: string) => `${o.endpoint?.replace(/\/$/, "")}/v1/${signal}`;
    const headers = o.headers ? { ...o.headers } : undefined;
    this.exporter = o.endpoint
      ? new TrackedExporter(
          new OTLPTraceExporter({ url: url("traces"), ...(headers ? { headers } : {}) }),
        )
      : null;
    this.traces = new BasicTracerProvider({
      resource,
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(o.samplingRatio) }),
      spanProcessors: this.exporter
        ? [new BatchSpanProcessor(this.exporter, { scheduledDelayMillis: 1000 })]
        : [],
    });
    this.metrics = new MeterProvider({
      resource,
      readers: o.endpoint
        ? [
            new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter({
                url: url("metrics"),
                ...(headers ? { headers } : {}),
              }),
              exportIntervalMillis: o.metricIntervalMs ?? 60_000,
            }),
          ]
        : [],
    });
    this.logs = new LoggerProvider({
      resource,
      processors: o.endpoint
        ? [
            new BatchLogRecordProcessor({
              exporter: new OTLPLogExporter({ url: url("logs"), ...(headers ? { headers } : {}) }),
              scheduledDelayMillis: 1000,
            }),
          ]
        : [],
    });
    this.tracer = this.traces.getTracer("@infrabyx/connectors");
    this.meter = this.metrics.getMeter("@infrabyx/connectors");
    this.logger = this.logs.getLogger("@infrabyx/connectors");
  }

  startSpan(name: string, attrs?: Attrs): SpanHandle {
    return this.span(name, attrs);
  }

  private span(name: string, attrs?: Attrs, hashed?: ReadonlySet<string>): SpanHandle {
    const span = this.tracer.startSpan(name, { attributes: this.scrub.attrs(attrs, hashed) });
    return {
      setAttributes: (a) => span.setAttributes(this.scrub.attrs(a)),
      end: (outcome) => {
        span.setAttribute("outcome", outcome);
        if (outcome === "error") span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
      },
    };
  }

  /** `*_total` names are counters; everything else is a histogram. */
  recordMetric(name: string, value: number, attrs?: Attrs): void {
    let inst = this.instruments.get(name);
    if (!inst) {
      if (name.endsWith("_total")) {
        const c = this.meter.createCounter(name);
        inst = { record: (v, a) => c.add(v, a) };
      } else inst = this.meter.createHistogram(name);
      this.instruments.set(name, inst);
    }
    inst.record(value, this.scrub.attrs(attrs));
  }

  log(level: LogLevel, msg: string, ctx?: Readonly<Record<string, unknown>>): void {
    if (LEVELS[level] < this.minLevel) return;
    this.logger.emit({
      severityNumber: LEVELS[level],
      severityText: level.toUpperCase(),
      body: this.scrub.text(msg),
      attributes: this.scrub.attrs(ctx),
    });
  }

  /** GenAI client span (`{operation} {model}`); content attributes are dropped (capture off). */
  aiTrace(op: string, attrs: Attrs): SpanHandle {
    const kept = Object.fromEntries(Object.entries(attrs).filter(([k]) => !GENAI_CONTENT.test(k)));
    const model = attrs["gen_ai.request.model"];
    return this.startSpan(model ? `${op} ${String(model)}` : op, {
      ...kept,
      "gen_ai.operation.name": op,
    });
  }

  exportConfig(): { endpoint: string | null; samplingRatio: number; profile: string } {
    return {
      endpoint: this.o.endpoint,
      samplingRatio: this.o.samplingRatio,
      profile: this.o.profile,
    };
  }

  /** Telemetry is never critical: a failing exporter reports `degraded`, never `down`. */
  async health(): Promise<PortHealth> {
    return {
      status: this.exporter?.lastError ? "degraded" : "up",
      latency_ms: 0,
      checked_at: new Date().toISOString(),
    };
  }

  /** CallObserver for the Router: spans plus `port_call_duration_ms` and `port_call_total` (plan §3.4). */
  callObserver(now: () => number = () => performance.now()): CallObserver {
    return {
      start: (name, attrs) => {
        const t0 = now();
        // The Router already hashed tenant_id with the same C-21 hasher.
        const span = this.span(name, attrs, ROUTER_HASHED);
        const [, port = "", method = ""] = name.split(".");
        return {
          end: (outcome) => {
            span.end(outcome);
            const a = { port, method, adapter: attrs.adapter ?? "", outcome };
            this.recordMetric("port_call_duration_ms", now() - t0, a);
            this.recordMetric("port_call_total", 1, a);
          },
        };
      },
    };
  }

  async flush(): Promise<void> {
    await Promise.allSettled([
      this.traces.forceFlush(),
      this.metrics.forceFlush(),
      this.logs.forceFlush(),
    ]);
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([
      this.traces.shutdown(),
      this.metrics.shutdown(),
      this.logs.shutdown(),
    ]);
  }
}
