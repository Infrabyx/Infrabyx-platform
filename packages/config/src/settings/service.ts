// Settings reads and writes (IPB-07 §07.3.3). Writes go through the mutation kernel so every change
// writes the audit ledger and SettingChanged / UserPreferenceChanged in the same transaction
// (IPB-07-39); maker-checker keys create an approval request instead (IPB-SEC-006).
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  ApprovalGateway,
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { isPlatformRole } from "@infrabyx/contracts/roles";
import type { SecretKey } from "@infrabyx/crypto";
import { internalEvent } from "../events.js";
import { defaultRegistry, type SettingsRegistry } from "./registry.js";
import type { SettingKey, SettingValueMap } from "./registry.generated.js";
import { resolve, scopeChain, tierAllowed, type Resolution } from "./resolve.js";
import type { SettingsStore } from "./store.js";
import type { ResolutionScope, SettingDef, SettingScopeRef } from "./types.js";
import { assertValid, tightenError } from "./validate.js";

export const SETTING_CHANGE_ACTION = "settings.setting.change";

export interface SettingsServiceOptions {
  store: SettingsStore;
  kernel: MutationKernel;
  audit: AuditSink;
  outbox?: OutboxWriter;
  approvals?: ApprovalGateway;
  product: string;
  registry?: SettingsRegistry;
  pseudonymKey?: SecretKey;
}

export type SetResult =
  { status: "applied"; version: number } | { status: "pending"; requestId: string };

export interface SettingChangePayload {
  key: string;
  tier: SettingScopeRef["tier"];
  scopeId: string | null;
  value: unknown;
}

export class SettingsService {
  private readonly o: SettingsServiceOptions;
  private readonly registry: SettingsRegistry;

  constructor(opts: SettingsServiceOptions) {
    this.o = opts;
    this.registry = opts.registry ?? defaultRegistry;
  }

  /** Typed read; an unregistered key fails typecheck and throws IPB-UX-007 at runtime. */
  async get<K extends SettingKey>(
    ctx: KernelContext,
    key: K,
    scope: ResolutionScope = {},
  ): Promise<SettingValueMap[K]> {
    return (await this.explain(ctx, key, scope)).value as SettingValueMap[K];
  }

  async explain(
    ctx: KernelContext,
    key: string,
    scope: ResolutionScope = {},
  ): Promise<Resolution & { def: SettingDef }> {
    const def = this.registry.require(key);
    const refs = scopeChain({
      tenantId: ctx.tenantId,
      ...(ctx.entityId ? { entityId: ctx.entityId } : {}),
      ...scope,
    });
    const rows = await this.o.kernel.read(ctx, (tx) => this.o.store.read(tx, key, refs));
    return { ...resolve(def, rows), def };
  }

  /** Validate and apply (or route to maker-checker) a change at `target`. */
  async set(
    ctx: KernelContext,
    key: string,
    target: SettingScopeRef,
    value: unknown,
  ): Promise<SetResult> {
    const def = this.registry.require(key);
    this.assertWritable(ctx, def, target);
    assertValid(def, value);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.assertTighten(tx, ctx, def, target, value);
        if (def.mc) {
          if (!this.o.approvals)
            throw new Error(
              `setting ${key} requires maker-checker but no ApprovalGateway is configured`,
            );
          const payload: SettingChangePayload = {
            key,
            tier: target.tier,
            scopeId: target.scopeId,
            value,
          };
          const req = await this.o.approvals.request(tx, {
            action: SETTING_CHANGE_ACTION,
            riskClass: def.mc,
            payload: payload as unknown as Record<string, unknown>,
            summary: `Change ${key} at ${target.tier}`,
          });
          return { status: "pending", requestId: req.id } as const;
        }
        const version = await this.write(tx, ctx, def, target, value, null);
        return { status: "applied", version } as const;
      },
      { action: SETTING_CHANGE_ACTION },
    );
  }

  /** Executor for an approved change, called by the approvals engine inside its transaction. */
  async applyApproved(tx: Tx, payload: SettingChangePayload, requestId: string): Promise<number> {
    const def = this.registry.require(payload.key);
    assertValid(def, payload.value);
    await this.assertTighten(
      tx,
      tx.ctx,
      def,
      { tier: payload.tier, scopeId: payload.scopeId },
      payload.value,
    );
    return this.write(
      tx,
      tx.ctx,
      def,
      { tier: payload.tier, scopeId: payload.scopeId },
      payload.value,
      requestId,
    );
  }

  private async write(
    tx: Tx,
    ctx: KernelContext,
    def: SettingDef,
    target: SettingScopeRef,
    value: unknown,
    mcRequestId: string | null,
  ): Promise<number> {
    const key = def.key;
    const tenantId =
      target.tier === "TENANT" || target.tier === "ENTITY" || target.tier === "USER"
        ? ctx.tenantId
        : null;
    const { old, version } = await this.o.store.write(tx, {
      key,
      tier: target.tier,
      scopeId: target.scopeId,
      tenantId,
      value,
      actorId: ctx.principal.id,
    });
    await this.o.audit.record(tx, {
      action: SETTING_CHANGE_ACTION,
      resourceType: "setting",
      resourceId: `${key}@${target.tier}:${target.scopeId ?? "platform"}`,
      before: { value: old },
      after: { value },
    });
    if (this.o.outbox) {
      const userTier = target.tier === "USER";
      const envelope = internalEvent({
        product: this.o.product,
        event: userTier ? "UserPreferenceChanged" : "SettingChanged",
        tenantId: ctx.tenantId,
        data: userTier
          ? { user_id: target.scopeId, key, old, new: value }
          : {
              key,
              tier: target.tier,
              scope_id: target.scopeId,
              old,
              new: value,
              actor: ctx.principal.id,
              mc_request_id: mcRequestId,
            },
        actorId: ctx.principal.id,
        ...(this.o.pseudonymKey ? { pseudonymKey: this.o.pseudonymKey } : {}),
        ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
      });
      await this.o.outbox.publish(tx, "config", { envelope });
    }
    return version;
  }

  private assertWritable(ctx: KernelContext, def: SettingDef, target: SettingScopeRef): void {
    if (def.locked)
      throw new IpbError("IPB-SEC-020", {
        detail: `${def.key} is platform-locked`,
        meta: { key: def.key },
      });
    if (!tierAllowed(def, target.tier)) {
      throw new IpbError("IPB-UX-008", {
        detail: `${def.key} cannot be set at ${target.tier}`,
        meta: { key: def.key, tier: target.tier },
      });
    }
    const p = ctx.principal;
    const roles = new Set(p.roles);
    const deny = (why: string) =>
      new IpbError("IPB-UX-011", {
        detail: `${def.key}: ${why}`,
        meta: { key: def.key, tier: target.tier },
      });
    if (def.change.length === 0) throw deny("no role may change this setting");
    if (def.change.every((c) => c === "pipeline" || c === "system")) {
      if (p.type !== "service") throw deny("changed only by the deploy pipeline or system");
      return;
    }
    switch (target.tier) {
      case "USER":
        if (target.scopeId !== p.id) throw deny("users may change only their own preferences");
        if (!def.change.includes("self")) throw deny("not a self-service setting");
        return;
      case "TENANT":
      case "ENTITY":
        if (target.tier === "TENANT" && target.scopeId !== ctx.tenantId)
          throw deny("outside the caller's tenant");
        if (target.tier === "ENTITY" && target.scopeId !== ctx.entityId)
          throw deny("outside the caller's legal entity");
        break;
      default:
        if (ctx.scope !== "platform" || !p.roles.some(isPlatformRole))
          throw deny(`${target.tier} settings need a platform context`);
    }
    if (!def.change.some((r) => roles.has(r)))
      throw deny(`requires one of ${def.change.join(", ")}`);
  }

  private async assertTighten(
    tx: Tx,
    ctx: KernelContext,
    def: SettingDef,
    target: SettingScopeRef,
    value: unknown,
  ): Promise<void> {
    if (def.tighten === undefined || target.tier === "PLATFORM") return;
    const refs = scopeChain({
      tenantId: ctx.tenantId,
      ...(ctx.entityId ? { entityId: ctx.entityId } : {}),
      userId: ctx.principal.id,
    });
    const rows = await this.o.store.read(tx, def.key, refs);
    const inherited = resolve(def, rows, target.tier).value;
    const why = tightenError(def, inherited, value);
    if (why)
      throw new IpbError("IPB-UX-008", {
        detail: `${def.key}: ${why}`,
        meta: { key: def.key, tier: target.tier },
      });
  }
}
