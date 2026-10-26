// Kill-switch changes (IPB-09-26, IPB-02-83): PLT_RELEASE_MANAGER or PLT_SECURITY_OFFICER only,
// ledgered and announced (KillSwitchChanged) in the same transaction. `fut.*` defaults change by
// ADR (IPB-12-03); runtime `fut.*` changes go through maker-checker.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  ApprovalGateway,
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { FlagValue } from "@infrabyx/contracts/ports";
import type { SecretKey } from "@infrabyx/crypto";
import { internalEvent } from "../events.js";
import { defaultFlagRegistry, type FlagKey, type FlagRegistry } from "./registry.js";

export const KILL_SWITCH_ROLES = ["PLT_RELEASE_MANAGER", "PLT_SECURITY_OFFICER"] as const;
export const FUT_FLAG_CHANGE_ROLE = "PLT_RELEASE_MANAGER";
export const FLAG_CHANGE_ACTION = "flags.flag.change";

/** Where a flag value is written; PgFlagProvider joins the kernel transaction. */
export interface FlagWriter {
  setValueInTx?(tx: Tx, key: string, value: FlagValue, actor: string): Promise<void>;
  setValue(key: string, value: FlagValue, actor: string): Promise<void>;
}

export interface FlagAdminOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  writer: FlagWriter;
  product: string;
  outbox?: OutboxWriter;
  approvals?: ApprovalGateway;
  registry?: FlagRegistry;
  pseudonymKey?: SecretKey;
}

export type FlagChangeResult = { status: "applied" } | { status: "pending"; requestId: string };

export class FlagAdmin {
  private readonly registry: FlagRegistry;
  constructor(private readonly o: FlagAdminOptions) {
    this.registry = o.registry ?? defaultFlagRegistry;
  }

  async set(ctx: KernelContext, key: FlagKey, on: boolean): Promise<FlagChangeResult> {
    const def = this.registry.require(key);
    const p = ctx.principal;
    const platform = ctx.scope === "platform" && p.type === "user";
    if (def.locked)
      throw new IpbError("IPB-SEC-020", { detail: `${key} is not switchable`, meta: { key } });
    if (def.kind === "kill") {
      if (!platform || !p.roles.some((r) => (KILL_SWITCH_ROLES as readonly string[]).includes(r))) {
        throw new IpbError("IPB-ENG-016", {
          detail: `${key} needs ${KILL_SWITCH_ROLES.join(" or ")}`,
          meta: { key },
        });
      }
      return this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await this.apply(tx, key, on);
          return { status: "applied" } as const;
        },
        { action: FLAG_CHANGE_ACTION },
      );
    }
    if (!platform || !p.roles.includes(FUT_FLAG_CHANGE_ROLE)) {
      throw new IpbError("IPB-UX-011", {
        detail: `${key} is changed only by ${FUT_FLAG_CHANGE_ROLE}`,
        meta: { key },
      });
    }
    if (!this.o.approvals)
      throw new Error(`${key} requires maker-checker but no ApprovalGateway is configured`);
    const approvals = this.o.approvals;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const req = await approvals.request(tx, {
          action: FLAG_CHANGE_ACTION,
          riskClass: "R3",
          payload: { key, value: on },
          summary: `Set ${key} ${on ? "ON" : "OFF"} (checker: PLT_SECURITY_OFFICER)`,
        });
        return { status: "pending", requestId: req.id } as const;
      },
      { action: FLAG_CHANGE_ACTION },
    );
  }

  /** Executor for an approved `fut.*` change. */
  async applyApproved(tx: Tx, payload: { key: string; value: boolean }): Promise<void> {
    await this.apply(tx, payload.key, payload.value);
  }

  private async apply(tx: Tx, key: string, on: boolean): Promise<void> {
    const def = this.registry.require(key);
    const actor = tx.ctx.principal.id;
    await this.o.audit.record(tx, {
      action: FLAG_CHANGE_ACTION,
      resourceType: "flag",
      resourceId: key,
      after: { value: on },
    });
    if (this.o.writer.setValueInTx) await this.o.writer.setValueInTx(tx, key, on, actor);
    else await this.o.writer.setValue(key, on, actor);
    if (def.kind === "kill" && this.o.outbox) {
      const envelope = internalEvent({
        product: this.o.product,
        event: "KillSwitchChanged",
        tenantId: tx.ctx.tenantId,
        data: { key, on, actor },
        actorId: actor,
        ...(this.o.pseudonymKey ? { pseudonymKey: this.o.pseudonymKey } : {}),
        ...(tx.ctx.traceId ? { traceId: tx.ctx.traceId } : {}),
      });
      await this.o.outbox.publish(tx, "config", { envelope });
    }
  }
}
