// The NOTIFY side of `@infrabyx/workflow`'s `ApprovalNotifier` (PL3-D-07): reminders and escalations
// go out as the mandatory classes `approval.reminder` and `approval.escalated` (and escalated inbox
// items, such as UNDETERMINED rule decisions, as `inbox.escalated`, PL3-D-21), recorded inside the
// timer's transaction (`enqueue`) and delivered by the dispatcher, so a rolled-back timer sends
// nothing. Role members come from the product (the identity directory).
import type { KernelContext, Tx } from "@infrabyx/contracts/kernel";
import type { NotifyService } from "./service.js";

interface ApprovalLike {
  id: string;
  action: string;
  makerId: string;
}

export function notifyApprovalNotifier(
  notify: NotifyService,
  members: (ctx: KernelContext, role: string) => Promise<readonly string[]>,
): {
  reminder(tx: Tx, r: ApprovalLike, roles: readonly string[]): Promise<void>;
  escalated(tx: Tx, r: ApprovalLike, role: string): Promise<void>;
  itemEscalated(
    tx: Tx,
    item: { id: string; productModule: string },
    role: string,
    excludePrincipal: string | null,
  ): Promise<void>;
} {
  const to = async (tx: Tx, roles: readonly string[], maker: string) => {
    const refs = new Set<string>();
    for (const role of roles)
      for (const u of await members(tx.ctx, role)) if (u !== maker) refs.add(u);
    return [...refs].map((ref) => ({ ref }));
  };
  return {
    async reminder(tx, r, roles) {
      const recipients = await to(tx, roles, r.makerId);
      if (!recipients.length) return;
      await notify.enqueue(tx, {
        class: "approval.reminder",
        to: recipients,
        vars: { action: r.action, id: r.id },
        deepLink: `/approvals/${r.id}`,
        idempotencyKey: `approval.reminder:${r.id}`,
      });
    },
    async escalated(tx, r, role) {
      const recipients = await to(tx, [role], r.makerId);
      if (!recipients.length) return;
      await notify.enqueue(tx, {
        class: "approval.escalated",
        to: recipients,
        vars: { action: r.action, id: r.id },
        deepLink: `/approvals/${r.id}`,
        idempotencyKey: `approval.escalated:${r.id}`,
      });
    },
    async itemEscalated(tx, item, role, excludePrincipal) {
      const recipients = await to(tx, [role], excludePrincipal ?? "");
      if (!recipients.length) return;
      await notify.enqueue(tx, {
        class: "inbox.escalated",
        to: recipients,
        vars: { module: item.productModule, id: item.id },
        deepLink: `/inbox/${item.id}`,
        idempotencyKey: `inbox.escalated:${item.id}`,
      });
    },
  };
}
