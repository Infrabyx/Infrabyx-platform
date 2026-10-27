// provider_routing runtime (IPB-01-16/18, plan §5.2). For every call the router:
//   1. works out the effective data class (a caller may only raise it, PL2-D-03);
//   2. picks the adapter: the primary while its breaker passes, else the secondary when the
//      failover mode allows it for this kind of call;
//   3. refuses, before any I/O, an adapter whose residency or max class cannot take the call, and a
//      GLOBAL adapter receiving recipients without a DPA (IPB-01-16, IPB-DEV-05);
//   4. runs side effects through the idempotency store (plan §3.5);
//   5. records the span `port.<name>.<method>` and feeds the breaker.
import {
  atLeast,
  residencyAllows,
  type DataClass,
  type Residency,
} from "@infrabyx/contracts/data-class";
import { PortError, isIpbError } from "@infrabyx/contracts/errors";
import {
  effectiveDataClass,
  payloadClass,
  type PayloadClassReport,
  type Port,
  type PortCall,
} from "@infrabyx/contracts/ports";
import type { AdapterInstance, RoutingFile } from "@infrabyx/contracts/routing";
import type { z } from "zod";
import { CircuitBreaker, type BreakerSettings } from "./breaker.js";
import { HealthRegistry, type HealthRegistryOptions } from "./health.js";
import { runIdempotent, type IdempotencyRequest, type IdempotencyStore } from "./idempotency.js";
import { LOCAL_METHODS, methodSpec } from "./specs.js";

export interface AdapterFactoryInput {
  port: string;
  role: "primary" | "secondary";
  instance: AdapterInstance;
  env: string;
}
export type AdapterFactory = (input: AdapterFactoryInput) => Port | Promise<Port>;

export type RoutingEvent = "AdapterFailedOver" | "AdapterRecovered" | "ResidencyViolationBlocked";
export interface PlatformEventSink {
  emit(event: RoutingEvent, data: Record<string, string>): void | Promise<void>;
}

export interface CallSpan {
  end(outcome: "ok" | "error"): void;
}
export interface CallObserver {
  start(name: string, attrs: Readonly<Record<string, string>>): CallSpan;
}

export interface RouterOptions {
  routing: {
    env: string;
    file: RoutingFile;
    policyFor(port: string): Record<DataClass, Residency[]>;
  };
  factories: Readonly<Record<string, AdapterFactory>>;
  events?: PlatformEventSink;
  observer?: CallObserver;
  idempotency?: IdempotencyStore;
  onUnresolved?: (req: IdempotencyRequest, reason: string) => Promise<void> | void;
  /** Tenant of the current call when the PortCall names none (tenancy context). */
  tenantId?: () => string | undefined;
  /** Keyed hash for span attributes (C-21); without it no tenant attribute is recorded. */
  hashId?: (id: string) => string;
  traceId?: () => string | undefined;
  /** Module name reported in ResidencyViolationBlocked. */
  module?: string;
  now?: () => number;
  health?: HealthRegistryOptions;
}

interface Slot {
  role: "primary" | "secondary";
  instance: AdapterInstance;
  adapter: Port;
  breaker: CircuitBreaker;
}

interface PortSlots {
  primary: Slot;
  secondary?: Slot;
  mode: "read_only_failover" | "active_failover" | "none";
  policy: Record<DataClass, Residency[]>;
}

const reports = new WeakMap<z.ZodType, PayloadClassReport>();
const reportFor = (s: z.ZodType): PayloadClassReport => {
  let r = reports.get(s);
  if (!r) reports.set(s, (r = payloadClass(s)));
  return r;
};

/** Errors that say the adapter is unhealthy, as opposed to a refused or invalid request. */
export function tripsBreaker(e: unknown): boolean {
  return !isIpbError(e) || e.code === "IPB-PORT-002";
}

export class Router {
  readonly health: HealthRegistry;
  private readonly ports = new Map<string, PortSlots>();
  private readonly facades = new Map<string, unknown>();

  private constructor(private readonly o: RouterOptions) {
    this.health = new HealthRegistry(o.health);
  }

  /** Build every routed adapter; refuses an adapter that claims less than its routing entry (IPB-PORT-005). */
  static async create(o: RouterOptions): Promise<Router> {
    const r = new Router(o);
    const defaults = o.routing.file.defaults?.circuit_breaker ?? {};
    for (const [port, pr] of Object.entries(o.routing.file.ports)) {
      if (!pr.primary) continue;
      const settings = { ...defaults, ...(pr.circuit_breaker ?? {}) } as Partial<BreakerSettings>;
      const primary = await r.slot(port, "primary", pr.primary, settings);
      const secondary = pr.secondary
        ? await r.slot(port, "secondary", pr.secondary, settings)
        : undefined;
      r.ports.set(port, {
        primary,
        ...(secondary ? { secondary } : {}),
        mode: pr.secondary?.mode ?? "none",
        policy: o.routing.policyFor(port),
      });
      r.health.register(port, "primary", primary.adapter);
      if (secondary) r.health.register(port, "secondary", secondary.adapter);
    }
    return r;
  }

  private async slot(
    port: string,
    role: "primary" | "secondary",
    instance: AdapterInstance,
    settings: Partial<BreakerSettings>,
  ): Promise<Slot> {
    const factory = this.o.factories[instance.adapter];
    if (!factory)
      throw new PortError("IPB-PORT-001", port, {
        adapter: instance.adapter,
        detail: `no factory registered for adapter ${instance.adapter}`,
      });
    const adapter = await factory({ port, role, instance, env: this.o.routing.env });
    const d = adapter.descriptor;
    if (
      d.port !== port ||
      d.residency !== instance.residency ||
      !atLeast(d.maxDataClass, instance.max_data_class)
    )
      throw new PortError("IPB-PORT-005", port, {
        adapter: instance.adapter,
        detail: `adapter declares ${d.port}/${d.residency}/${d.maxDataClass}; routing says ${port}/${instance.residency}/${instance.max_data_class}`,
      });
    return { role, instance, adapter, breaker: new CircuitBreaker(settings, this.o.now) };
  }

  /** Direct access to one adapter instance, e.g. to verify its inbound webhooks. */
  adapter<P extends Port>(port: string, role: "primary" | "secondary" = "primary"): P {
    const s = this.slots(port)[role];
    if (!s) throw new PortError("IPB-PORT-001", port, { detail: `no ${role} adapter routed` });
    return s.adapter as P;
  }

  /**
   * A facade pinned to one routed adapter, for calls on something that adapter owns (an order's
   * refund goes to the PA that captured it, P-07/P-08). Pinned calls never fail over.
   */
  portFor<P extends Port>(port: string, adapter: string): P {
    const ps = this.slots(port);
    const slot = [ps.primary, ps.secondary].find((s) => s?.instance.adapter === adapter);
    if (!slot)
      throw new PortError("IPB-PORT-001", port, {
        adapter,
        detail: `${adapter} is not routed for ${port}`,
      });
    return new Proxy({} as P, {
      get: (_t, prop) => {
        if (typeof prop !== "string") return undefined;
        if (prop === "descriptor") return slot.adapter.descriptor;
        if (prop === "then") return undefined;
        if (LOCAL_METHODS.has(prop)) {
          const v = (slot.adapter as unknown as Record<string, unknown>)[prop];
          return typeof v === "function" ? v.bind(slot.adapter) : v;
        }
        return (...args: unknown[]) => this.route(port, prop, args, slot);
      },
    });
  }

  /** A routed facade with the port's interface. */
  port<P extends Port>(port: string): P {
    let f = this.facades.get(port);
    if (!f) {
      const slots = this.slots(port);
      f = new Proxy({} as P, {
        get: (_t, prop) => {
          if (typeof prop !== "string") return undefined;
          if (prop === "descriptor") return slots.primary.adapter.descriptor;
          if (prop === "then") return undefined;
          if (LOCAL_METHODS.has(prop)) {
            const v = (slots.primary.adapter as unknown as Record<string, unknown>)[prop];
            return typeof v === "function" ? v.bind(slots.primary.adapter) : v;
          }
          return (...args: unknown[]) => this.route(port, prop, args);
        },
      });
      this.facades.set(port, f);
    }
    return f as P;
  }

  breakerState(port: string, role: "primary" | "secondary" = "primary"): string | undefined {
    return this.slots(port)[role]?.breaker.state;
  }

  private slots(port: string): PortSlots {
    const s = this.ports.get(port);
    if (!s)
      throw new PortError("IPB-PORT-001", port, {
        detail: `${port} is not routed in this environment`,
      });
    return s;
  }

  private admissible(
    slot: Slot,
    cls: DataClass,
    report: PayloadClassReport | undefined,
    policy: Record<DataClass, Residency[]>,
  ): string | undefined {
    const residency = slot.instance.residency;
    if (!atLeast(slot.instance.max_data_class, cls))
      return `${slot.instance.adapter} takes at most ${slot.instance.max_data_class}`;
    if (!residencyAllows(residency, cls, policy)) return `${residency} is not allowed for ${cls}`;
    if (report?.recipientFields.length && residency === "GLOBAL") {
      const allowGlobal = this.o.routing.file.defaults?.recipient_delivery?.allow_global ?? true;
      if (!allowGlobal) return "recipients may not go to a GLOBAL provider in this environment";
      if (!slot.instance.dpa_ref && !slot.adapter.descriptor.dpaRef)
        return `${slot.instance.adapter} has no DPA reference for recipients`;
    }
    return undefined;
  }

  private async route(
    port: string,
    method: string,
    args: unknown[],
    pinned?: Slot,
  ): Promise<unknown> {
    const spec = methodSpec(port, method);
    const call =
      spec.callArg !== undefined ? (args[spec.callArg] as PortCall | undefined) : undefined;
    const report = spec.payload ? reportFor(spec.payload.schema) : undefined;
    const cls = effectiveDataClass(port, call, report);
    const ps = this.slots(port);

    let slot = pinned ?? ps.primary;
    if (!slot.breaker.tryPass()) {
      const sec = pinned || spec.noFailover ? undefined : ps.secondary;
      const modeAllows =
        ps.mode === "active_failover" || (ps.mode === "read_only_failover" && spec.kind === "read");
      if (
        sec &&
        modeAllows &&
        !this.admissible(sec, cls, report, ps.policy) &&
        sec.breaker.tryPass()
      )
        slot = sec;
      else
        throw new PortError(
          port === "STORAGE" && spec.kind === "write" ? "IPB-STOR-002" : "IPB-PORT-002",
          port,
          {
            adapter: slot.instance.adapter,
            detail: `${slot.instance.adapter} circuit open; no admissible secondary for this ${spec.kind}`,
          },
        );
    }

    const refusal = this.admissible(slot, cls, report, ps.policy);
    if (refusal) {
      await this.o.events?.emit("ResidencyViolationBlocked", {
        port,
        adapter: slot.instance.adapter,
        data_class: cls,
        module: this.o.module ?? "unknown",
        trace_id: this.o.traceId?.() ?? "",
      });
      throw new PortError("IPB-PORT-003", port, {
        adapter: slot.instance.adapter,
        detail: refusal,
        meta: { data_class: cls },
      });
    }

    const adapter = slot.adapter as unknown as Record<string, unknown>;
    const fn = adapter[method];
    if (
      slot.adapter.descriptor.capabilities?.[method] === "unsupported" ||
      typeof fn !== "function"
    )
      throw new PortError("IPB-PORT-001", port, {
        adapter: slot.instance.adapter,
        detail: `${method} is not supported`,
        meta: { reason: "unsupported" },
      });

    const tenantId = call?.tenantId ?? this.o.tenantId?.();
    const attrs: Record<string, string> = {
      adapter: slot.instance.adapter,
      residency: slot.instance.residency,
      data_class: cls,
      role: slot.role,
    };
    if (tenantId && this.o.hashId) attrs.tenant_id = this.o.hashId(tenantId);
    const span = this.o.observer?.start(`port.${port}.${method}`, attrs);
    const exec = () => (fn as (...a: unknown[]) => Promise<unknown>).apply(slot.adapter, args);

    try {
      let result: unknown;
      const key = spec.idempotent
        ? spec.idempotent.keyArg === "call"
          ? call?.idempotencyKey
          : (args[spec.idempotent.keyArg] as string | undefined)
        : undefined;
      if (spec.idempotent && key && this.o.idempotency) {
        const lookupFn = adapter.lookup;
        const req: IdempotencyRequest = {
          port,
          adapter: slot.instance.adapter,
          operation: method,
          key,
          request: args.filter((_, i) => i !== spec.callArg && i !== spec.idempotent?.keyArg),
          dataClass: cls,
          money: spec.idempotent.money === true,
        };
        result = await runIdempotent({
          store: this.o.idempotency,
          req,
          call: exec,
          ...(typeof lookupFn === "function"
            ? {
                lookup: () =>
                  (lookupFn as (op: string, k: string) => Promise<never>).call(
                    slot.adapter,
                    method,
                    key,
                  ),
              }
            : {}),
          ...(this.o.onUnresolved ? { onUnresolved: this.o.onUnresolved } : {}),
        });
      } else if (spec.idempotent?.money && !key) {
        throw new PortError("IPB-PORT-001", port, {
          adapter: slot.instance.adapter,
          detail: `${method} requires an idempotency key (P-05)`,
        });
      } else result = await exec();
      if (slot.breaker.onSuccess() === "closed")
        await this.o.events?.emit("AdapterRecovered", { port, adapter: slot.instance.adapter });
      span?.end("ok");
      return result;
    } catch (e) {
      if (
        tripsBreaker(e) &&
        slot.breaker.onFailure() === "opened" &&
        slot.role === "primary" &&
        ps.secondary &&
        ps.mode !== "none"
      )
        await this.o.events?.emit("AdapterFailedOver", {
          port,
          from_adapter: slot.instance.adapter,
          to_adapter: ps.secondary.instance.adapter,
          reason: "circuit_open",
          data_class_max: slot.instance.max_data_class,
        });
      span?.end("error");
      throw e;
    }
  }
}
