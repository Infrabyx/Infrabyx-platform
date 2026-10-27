// The tenant's tighten-only maker-checker keys (PL3-D-08) read from `@infrabyx/config` settings,
// for `ApprovalsEngine({ tenantPolicy })` and `ApprovalWorkflow({ reminderHours, bulkThreshold })`.
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { TenantApprovalPolicy } from "@infrabyx/tenancy";

/** The slice of `SettingsService` this needs. */
export interface SettingsReader {
  get(ctx: KernelContext, key: string): Promise<unknown>;
}

const ACTION_SEGMENT = /^[a-z0-9_-]+$/;
/** `payments.refund` → `payments_refund`, the `{action}` segment of the `mc.*` keys. */
export const mcActionSegment = (action: string): string => action.replace(/\./g, "_");

export function settingsApprovalPolicy(settings: SettingsReader): {
  tenantPolicy: (ctx: KernelContext, action: string) => Promise<TenantApprovalPolicy>;
  reminderHours: (ctx: KernelContext) => Promise<number>;
  bulkThreshold: (ctx: KernelContext) => Promise<number>;
} {
  const read = async (ctx: KernelContext, key: string): Promise<unknown> => {
    try {
      return await settings.get(ctx, key);
    } catch {
      return null; // unset or unregistered: the platform policy applies
    }
  };
  return {
    async tenantPolicy(ctx, action) {
      const seg = mcActionSegment(action);
      if (!ACTION_SEGMENT.test(seg) || ctx.scope === "platform") return {};
      const roles = await read(ctx, `mc.checker_roles.${seg}`);
      const dual = await read(ctx, `mc.dual_checker_above.${seg}`);
      return {
        checkerRoles: Array.isArray(roles)
          ? roles.filter((r): r is string => typeof r === "string")
          : null,
        dualCheckerAbove: typeof dual === "number" ? dual : null,
      };
    },
    async reminderHours(ctx) {
      const h = await read(ctx, "mc.reminder_hours");
      return typeof h === "number" ? h : 24;
    },
    async bulkThreshold(ctx) {
      const n = await read(ctx, "ux.bulk.confirm_threshold");
      return typeof n === "number" ? n : 20;
    },
  };
}
