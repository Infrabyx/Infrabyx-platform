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
import {
  inChainOrder,
  resolve,
  scopeChain,
  tierAllowed,
  unitChain,
  type Resolution,
} from "./resolve.js";
import { MAX_HISTORY_PAGE, historyCursor, type SettingsStore } from "./store.js";
import type { ResolutionScope, SettingDef, SettingHistoryPage, SettingScopeRef } from "./types.js";
import { assertValid, tightenError } from "./validate.js";

export const SETTING_CHANGE_ACTION = "settings.setting.change";
/** Tenant roles that read a TENANT or ENTITY setting's change history besides its changers. */
export const HISTORY_READER_ROLES = ["ORG_OWNER", "ORG_ADMIN", "ORG_AUDITOR_RO"] as const;
/** Ledger action of a DPDP erasure of a person's USER settings (#110, R1-D-95). */
export const SETTING_USER_ERASE_ACTION = "settings.user.erase";
/** Tenant roles that may erase a person's USER settings; a service principal (the product's erasure workflow) may too. */
export const USER_ERASURE_ROLES = ["ORG_OWNER", "ORG_ADMIN"] as const;
const ERASURE_REQUEST_REF = /^[A-Za-z0-9_.:-]{1,128}$/;

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
    const units = unitChain(scope.unitIds ?? ctx.unitIds);
    const refs = scopeChain({
      tenantId: ctx.tenantId,
      ...(ctx.entityId ? { entityId: ctx.entityId } : {}),
      ...scope,
      unitIds: units,
    });
    const rows = await this.o.kernel.read(ctx, (tx) => this.o.store.read(tx, key, refs));
    return { ...resolve(def, inChainOrder(rows, refs)), def };
  }

  /**
   * Each change of `key` at `scope`, newest first and paged (PR-LDC-17, R1-D-82): who, when, the
   * old and new value, the version and the approval request that carried it, each linked to its
   * `settings.setting.change` ledger entry. Read in the caller's context, so RLS keeps it to the
   * caller's tenant (PLATFORM, PLAN and BRAND to a platform context). A USER scope is its owner's
   * alone; TENANT and ENTITY need a role that may change the key, ORG_OWNER, ORG_ADMIN or
   * ORG_AUDITOR_RO; the platform tiers a platform role. Changes are kept from config/0003 on.
   */
  async history(
    ctx: KernelContext,
    key: string,
    scope: SettingScopeRef,
    page: { limit?: number; cursor?: string } = {},
  ): Promise<SettingHistoryPage> {
    const def = this.registry.require(key);
    this.assertHistoryReadable(ctx, def, scope);
    const store = this.o.store;
    if (!store.history) throw new Error("this settings store keeps no change history");
    const limit = Math.floor(page.limit ?? 50);
    if (!(limit >= 1 && limit <= MAX_HISTORY_PAGE))
      throw new RangeError(`limit is 1 to ${MAX_HISTORY_PAGE}`);
    historyCursor(page.cursor);
    return this.o.kernel.read(ctx, (tx) =>
      store.history!(tx, {
        key,
        tier: scope.tier,
        scopeId: scope.scopeId,
        limit,
        ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
      }),
    );
  }

  /**
   * Erase a person's USER settings in the caller's tenant on a DPDP erasure request (OWNER-QUESTIONS
   * #110; R1-D-95): their USER values and their USER change history, in one ledgered transaction
   * whose `settings.user.erase` entry keeps the counts and the request reference, never a value.
   * Called by the product's erasure workflow (a service principal) or an ORG_OWNER or ORG_ADMIN in
   * the tenant; agents, externals and platform contexts are refused. Other tiers are untouched.
   */
  async eraseUser(
    ctx: KernelContext,
    userId: string,
    request: { requestRef: string; reason: string },
  ): Promise<{ erasureId: string; values: number; changes: number }> {
    const p = ctx.principal;
    const deny = (why: string) =>
      new IpbError("IPB-UX-011", { detail: `erasing USER settings: ${why}` });
    if (p.type === "agent")
      throw new IpbError("IPB-SEC-004", { detail: "an agent cannot erase settings" });
    if (p.type === "external") throw deny("not by an external principal");
    if (ctx.scope === "platform") throw deny("USER settings are erased in the person's tenant");
    if (p.type !== "service" && !USER_ERASURE_ROLES.some((r) => p.roles.includes(r)))
      throw deny(`requires a service principal or one of ${USER_ERASURE_ROLES.join(", ")}`);
    if (typeof userId !== "string" || userId.length < 1 || userId.length > 128)
      throw new RangeError("a user id of 1 to 128 characters");
    if (!ERASURE_REQUEST_REF.test(request.requestRef))
      throw new RangeError("an erasure request reference of 1 to 128 of [A-Za-z0-9_.:-]");
    const reason = request.reason.trim();
    if (reason.length < 10 || reason.length > 500)
      throw new RangeError("a reason of 10 to 500 characters");
    const store = this.o.store;
    if (!store.eraseUser) throw new Error("this settings store cannot erase USER settings");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await store.eraseUser!(tx, {
          tenantId: ctx.tenantId,
          userId,
          requestRef: request.requestRef,
          actorId: p.id,
        });
        await this.o.audit.record(tx, {
          action: SETTING_USER_ERASE_ACTION,
          resourceType: "user_settings",
          resourceId: userId,
          after: {
            erasure_id: r.erasureId,
            request_ref: request.requestRef,
            values: r.values,
            changes: r.changes,
          },
        });
        return r;
      },
      { action: SETTING_USER_ERASE_ACTION, reason },
    );
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
        const riskClass = def.mc || (await this.deactivationClass(tx, def, target, value));
        if (riskClass) {
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
          // The checker sees what changes at this scope (IPB-07-15, @IPB-07-AT-06).
          const [cur] = await this.o.store.read(tx, key, [target]);
          const req = await this.o.approvals.request(tx, {
            action: SETTING_CHANGE_ACTION,
            riskClass,
            payload: payload as unknown as Record<string, unknown>,
            summary: `Change ${key} at ${target.tier}`,
            diff: { before: cur ? { [key]: cur.value } : null, after: { [key]: value } },
          });
          return { status: "pending", requestId: req.id } as const;
        }
        const version = await this.write(tx, ctx, def, target, value, null);
        return { status: "applied", version } as const;
      },
      { action: SETTING_CHANGE_ACTION },
    );
  }

  /**
   * A new tenant's initial tenant-tier value, inside `TenantBootstrap`'s transaction (`@infrabyx/
   * tenancy`; PR-LDC-12, R1-D-67): the same validation, tighten check, ledger entry and event as
   * `set`. Only in the platform context of the tenant being created (`tx.ctx.scope` platform, its
   * `tenantId` the new tenant), and refused for a locked setting, one not settable at TENANT, and
   * one whose changes need maker-checker (set it through `set` once the tenant exists).
   */
  async setInitial(tx: Tx, key: string, value: unknown): Promise<number> {
    const def = this.registry.require(key);
    const ctx = tx.ctx;
    if (ctx.scope !== "platform")
      throw new IpbError("IPB-UX-011", {
        detail: `${key}: initial values are written only while a tenant is created`,
        meta: { key },
      });
    if (def.locked)
      throw new IpbError("IPB-SEC-020", { detail: `${key} is platform-locked`, meta: { key } });
    if (!tierAllowed(def, "TENANT"))
      throw new IpbError("IPB-UX-008", {
        detail: `${key} cannot be set at TENANT`,
        meta: { key, tier: "TENANT" },
      });
    if (def.mc)
      throw new IpbError("IPB-UX-008", {
        detail: `${key} changes under maker-checker; set it after the tenant exists`,
        meta: { key, tier: "TENANT" },
      });
    assertValid(def, value);
    const target: SettingScopeRef = { tier: "TENANT", scopeId: ctx.tenantId };
    await this.assertTighten(tx, ctx, def, target, value);
    return this.write(tx, ctx, def, target, value, null);
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

  /** `mcDeactivate` keys: switching an explicit true at this scope to false needs a checker. */
  private async deactivationClass(
    tx: Tx,
    def: SettingDef,
    target: SettingScopeRef,
    value: unknown,
  ): Promise<SettingDef["mcDeactivate"] | false> {
    if (!def.mcDeactivate || value !== false) return false;
    const [cur] = await this.o.store.read(tx, def.key, [target]);
    return cur?.value === true ? def.mcDeactivate : false;
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
      target.tier === "TENANT" ||
      target.tier === "ENTITY" ||
      target.tier === "UNIT" ||
      target.tier === "USER"
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
    const { id: ledgerId } = await this.o.audit.record(tx, {
      action: SETTING_CHANGE_ACTION,
      resourceType: "setting",
      resourceId: `${key}@${target.tier}:${target.scopeId ?? "platform"}`,
      before: { value: old },
      after: { value },
    });
    // The readable side of the ledgered change (PR-LDC-17, R1-D-82): the ledger keeps the digests
    // of { value: old } and { value }, this row the values, linked by the entry's id.
    await this.o.store.appendChange?.(tx, {
      ledgerId,
      key,
      tier: target.tier,
      scopeId: target.scopeId,
      tenantId,
      actorId: ctx.principal.id,
      old,
      new: value,
      version,
      approvalRequestId: mcRequestId,
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
      case "UNIT":
        if (target.tier === "TENANT" && target.scopeId !== ctx.tenantId)
          throw deny("outside the caller's tenant");
        if (target.tier === "ENTITY" && target.scopeId !== ctx.entityId)
          throw deny("outside the caller's legal entity");
        if (target.tier === "UNIT" && !unitChain(ctx.unitIds).includes(target.scopeId ?? ""))
          throw deny("outside the caller's organisation units");
        break;
      default:
        if (ctx.scope !== "platform" || !p.roles.some(isPlatformRole))
          throw deny(`${target.tier} settings need a platform context`);
    }
    if (!def.change.some((r) => roles.has(r)))
      throw deny(`requires one of ${def.change.join(", ")}`);
  }

  private assertHistoryReadable(ctx: KernelContext, def: SettingDef, scope: SettingScopeRef): void {
    const p = ctx.principal;
    const deny = (why: string) =>
      new IpbError("IPB-UX-011", {
        detail: `${def.key} history: ${why}`,
        meta: { key: def.key, tier: scope.tier },
      });
    if (p.type === "external" || p.type === "agent")
      throw deny("not readable by an external principal or an agent");
    switch (scope.tier) {
      case "USER":
        if (scope.scopeId !== p.id) throw deny("a user reads only their own preferences' history");
        return;
      case "TENANT":
      case "ENTITY":
      case "UNIT": {
        if (scope.tier === "TENANT" && scope.scopeId !== ctx.tenantId)
          throw deny("outside the caller's tenant");
        if (p.type === "service") return;
        const readers = new Set([...def.change, ...HISTORY_READER_ROLES]);
        if (!p.roles.some((r) => readers.has(r)))
          throw deny(`requires one of ${[...readers].filter((r) => r !== "self").join(", ")}`);
        return;
      }
      default:
        if (ctx.scope !== "platform" || (p.type !== "service" && !p.roles.some(isPlatformRole)))
          throw deny(`${scope.tier} history needs a platform context`);
    }
  }

  private async assertTighten(
    tx: Tx,
    ctx: KernelContext,
    def: SettingDef,
    target: SettingScopeRef,
    value: unknown,
  ): Promise<void> {
    if (def.tighten === undefined || target.tier === "PLATFORM") return;
    const units = unitChain(ctx.unitIds);
    // A UNIT write inherits from the units outside it (the chain before it), not from itself.
    const outer =
      target.tier === "UNIT" ? units.slice(0, units.indexOf(target.scopeId ?? "")) : units;
    const refs = scopeChain({
      tenantId: ctx.tenantId,
      ...(ctx.entityId ? { entityId: ctx.entityId } : {}),
      unitIds: outer,
      userId: ctx.principal.id,
    });
    const rows = inChainOrder(await this.o.store.read(tx, def.key, refs), refs);
    const inherited =
      target.tier === "UNIT"
        ? resolve(
            def,
            rows.filter((r) => r.tier !== "USER"),
          ).value
        : resolve(def, rows, target.tier).value;
    const why = tightenError(def, inherited, value);
    if (why)
      throw new IpbError("IPB-UX-008", {
        detail: `${def.key}: ${why}`,
        meta: { key: def.key, tier: target.tier },
      });
  }
}
