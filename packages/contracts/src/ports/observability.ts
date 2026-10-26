// OBSERVABILITY port (IPB-01 §01.4.4.2). The only OTel import site; every routed port call runs in
// `port.<name>.<method>` (IPB-01 §01.4.4.1). Attributes never carry payloads or raw identifiers.
import type { Port } from "./common.js";

export type AttrValue = string | number | boolean;
export type Attrs = Readonly<Record<string, AttrValue>>;

export interface SpanHandle {
  setAttributes(attrs: Attrs): void;
  end(outcome: "ok" | "error"): void;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ObservabilityPort extends Port {
  startSpan(name: string, attrs?: Attrs): SpanHandle;
  recordMetric(name: string, value: number, attrs?: Attrs): void;
  /** Context values pass the IPB-02-23 scrubber before export. */
  log(level: LogLevel, msg: string, ctx?: Readonly<Record<string, unknown>>): void;
  /** OTel GenAI semantic conventions; content capture off (`eng.otel.genai.capture_content`). */
  aiTrace(op: string, attrs: Attrs): SpanHandle;
  exportConfig(): { endpoint: string | null; samplingRatio: number; profile: string };
}
