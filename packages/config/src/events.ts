// Build internal CloudEvents envelopes (IPB-10-37) for the kernel packages' outbox writes.
// Cross-product events use the Ecosystem envelope and are built by the products (D-13).
import {
  InternalEnvelope,
  PLATFORM_EVENTS,
  type PlatformEventName,
} from "@infrabyx/contracts/events";
import type { DataClass } from "@infrabyx/contracts/data-class";
import { hashedActorId, ulid, type SecretKey } from "@infrabyx/crypto";

export const EVENT_SCHEMA_BASE = "https://developers.infrabyx.in/events";

export interface InternalEventInput {
  product: string;
  event: PlatformEventName | { module: string; name: string; version?: number };
  tenantId: string;
  data: Record<string, unknown>;
  dataclass?: DataClass;
  subject?: string;
  actorId?: string;
  /** HMAC key for the hashed `actorid` (PL1-C-02); without it `actorid` is omitted. */
  pseudonymKey?: SecretKey;
  traceId?: string;
  time?: Date;
  environment?: "live" | "test";
}

export function internalEvent(input: InternalEventInput): InternalEnvelope {
  const e =
    typeof input.event === "string"
      ? { ...PLATFORM_EVENTS[input.event], version: 1 }
      : { version: 1, ...input.event };
  const product = input.product.toLowerCase();
  const type = `in.${product}.${e.module}.${e.name}.v${e.version}`;
  const env: Record<string, unknown> = {
    specversion: "1.0",
    id: ulid((input.time ?? new Date()).getTime()),
    source: `/infrabyx/${product}/${e.module}`,
    type,
    time: (input.time ?? new Date()).toISOString(),
    datacontenttype: "application/json",
    dataschema: `${EVENT_SCHEMA_BASE}/${type}.schema.json`,
    tenantid: input.tenantId,
    dataclass: input.dataclass ?? "INTERNAL",
    data: input.data,
  };
  if (input.subject) env.subject = input.subject;
  if (input.traceId) env.traceid = input.traceId;
  if (input.actorId && input.pseudonymKey)
    env.actorid = hashedActorId(input.pseudonymKey, input.actorId);
  if (input.environment) env.environment = input.environment;
  return InternalEnvelope.parse(env);
}
