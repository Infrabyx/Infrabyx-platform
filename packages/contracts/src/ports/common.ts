// Common port conventions (IPB-01 §01.4.4.1).
import { z } from "zod";
import { DataClass, Residency } from "../data-class.js";

export const PortHealth = z.object({
  status: z.enum(["up", "degraded", "down"]),
  latency_ms: z.number().nonnegative(),
  checked_at: z.iso.datetime({ offset: true }),
});
export type PortHealth = z.infer<typeof PortHealth>;

/** How an adapter provides a catalogue method (PL2-D-21, plan §3.3). */
export const CAPABILITY_LEVELS = ["native", "emulated", "unsupported"] as const;
export type Capability = (typeof CAPABILITY_LEVELS)[number];

/** Every adapter instance declares where it processes data and the highest class it accepts (IPB-01-16). */
export interface AdapterDescriptor {
  port: string;
  adapter: string;
  residency: Residency;
  maxDataClass: DataClass;
  /** Methods the adapter emulates or cannot provide; unlisted methods are native. */
  capabilities?: Readonly<Record<string, Capability>>;
  /** Vendor Assurance Room reference of the DPA; required for GLOBAL adapters that receive recipients (IPB-DEV-05). */
  dpaRef?: string;
}

export interface Port {
  readonly descriptor: AdapterDescriptor;
  health(): Promise<PortHealth>;
}

export interface Idempotent {
  idempotencyKey?: string;
}

/**
 * Optional trailing argument of every method that sends data to a vendor (PL2-D-20).
 * `dataClass` may only raise the port default, never lower it (PL2-D-03).
 */
export interface PortCall extends Idempotent {
  dataClass?: DataClass;
  /** Defaults to the tenancy context. */
  tenantId?: string;
}

/**
 * What the inbound-webhook helper knows about the request besides body and headers (plan §3.8).
 * `sourceIp` comes from the socket, never from a forwarded header the caller did not set itself.
 */
export interface WebhookRequestMeta {
  sourceIp?: string;
  /** Raw query string without `?`, for vendors that report by GET. */
  query?: string;
}

/** Result of looking a side-effect up at the vendor by its idempotency key (plan §3.5). */
export type LookupResult<T> =
  { status: "found"; result: T } | { status: "absent" } | { status: "unknown"; reason: string };

/** Adapters whose side effects can be re-checked at the vendor before a retry (plan §3.5, PL2-D-08). */
export interface IdempotencyLookup {
  lookup(operation: string, idempotencyKey: string): Promise<LookupResult<unknown>>;
}

/** The thirteen Tier-0 ports PL2 builds (IPB-14 §14.3). */
export const PL2_PORTS = [
  "SECRETS",
  "KMS",
  "OBSERVABILITY",
  "FEATURE_FLAG",
  "IDENTITY",
  "AUTHZ",
  "STORAGE",
  "QUEUE",
  "WORKFLOW",
  "EMAIL",
  "SMS",
  "WHATSAPP",
  "PAYMENTS",
] as const;
export type Pl2Port = (typeof PL2_PORTS)[number];

/** Default data class of a call when the caller states none (plan §3.1). */
export const PORT_DEFAULT_DATA_CLASS: Readonly<Record<string, DataClass>> = Object.freeze({
  EMAIL: "INTERNAL",
  SMS: "INTERNAL",
  WHATSAPP: "INTERNAL",
  QUEUE: "INTERNAL",
  FEATURE_FLAG: "INTERNAL",
  OBSERVABILITY: "INTERNAL",
  PAYMENTS: "REGULATED",
});

/** Port default data class; CONFIDENTIAL for every port not listed (plan §3.1). */
export function portDefaultDataClass(port: string): DataClass {
  return PORT_DEFAULT_DATA_CLASS[port] ?? "CONFIDENTIAL";
}

/** Ports whose payloads carry delivery recipients (IPB-DEV-05). */
export const MESSAGING_PORTS: readonly string[] = Object.freeze(["EMAIL", "SMS", "WHATSAPP"]);
