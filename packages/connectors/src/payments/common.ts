// Shared PAYMENTS pieces: the locked list of PL2 plan §8 (approved 26 Oct 2026; P-05 and P-07
// revised by the owner). Test mode only in PL2: no live key anywhere.
// - P-03 live keys: a live credential is refused outside prod/dr, a test credential inside them.
// - P-04 money: integer minor units, INR only, exact equality on the way back.
// - P-05 idempotency: our references are derived from the key so the PA can be asked first.
// - P-07 refunds: R3 maker-checker; the approval must be `approved` for `payments.refund` with the
//   same payload digest, else IPB-SEC-006; never retried blindly.
// - P-12 kill switch: `kill.payments` on refuses new money operations with a maintenance error;
//   webhooks and reconciliation continue.
import type { AppEnv } from "@infrabyx/contracts/env";
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import type { AdapterDescriptor, RefundSpec } from "@infrabyx/contracts/ports";
import { canonicalDigest, sha256Hex } from "@infrabyx/crypto";

export const LIVE_ENVS: readonly AppEnv[] = ["prod", "dr"];

/** P-03: refuse a live credential outside prod/dr and a test credential inside them. */
export function assertCredentialMode(
  d: AdapterDescriptor,
  env: AppEnv,
  mode: "test" | "live",
  opts: { healthProbe?: boolean } = {},
): void {
  const liveEnv = LIVE_ENVS.includes(env);
  if (mode === "live" && !liveEnv)
    throw new PortError("IPB-PORT-005", d.port, {
      adapter: d.adapter,
      detail: `a live ${d.adapter} credential is refused outside prod/dr (P-03)`,
    });
  if (mode === "test" && liveEnv && !opts.healthProbe)
    throw new PortError("IPB-PORT-005", d.port, {
      adapter: d.adapter,
      detail: `a test ${d.adapter} credential is refused in ${env} except for the health probe (P-03, P-14)`,
    });
}

/** Our reference for an operation, derived from its idempotency key (P-05). */
export function reference(prefix: string, idempotencyKey: string, length = 32): string {
  if (!idempotencyKey)
    throw new PortError("IPB-PORT-001", "PAYMENTS", {
      detail: "an idempotency key is mandatory for money operations (P-05)",
    });
  return `${prefix}${sha256Hex(`ipb/payments/${idempotencyKey}`).slice(0, length)}`;
}

/** P-04: the vendor's amount must equal ours exactly. */
export function assertSameAmount(d: AdapterDescriptor, ours: number, theirs: number): void {
  if (ours !== theirs)
    throw new PortError("IPB-PORT-002", d.port, {
      adapter: d.adapter,
      detail: `${d.adapter} returned ${theirs} minor units for a ${ours} request (P-04)`,
      meta: { reason: "amount_mismatch" },
    });
}

/** What the port needs from the PL1 approvals engine (`ApprovalsEngine.get`). */
export interface RefundApprovals {
  get(approvalRef: string): Promise<{
    action: string;
    state: string;
    payloadDigest: string;
    delayUntil: Date | null;
  }>;
}

export const REFUND_ACTION = "payments.refund";

/** The approval payload a refund is checked against: everything but the approval itself. */
export const refundPayload = (s: RefundSpec) => ({
  paymentId: s.paymentId,
  amountMinor: s.amountMinor,
  reason: s.reason,
});

/** P-07: the refund must carry an approved R3 request for exactly this payload. */
export async function assertRefundApproved(
  d: AdapterDescriptor,
  approvals: RefundApprovals | undefined,
  spec: RefundSpec,
  now: () => number = Date.now,
): Promise<void> {
  const refuse = (detail: string) =>
    new IpbError("IPB-SEC-006", { detail, meta: { action: REFUND_ACTION, adapter: d.adapter } });
  if (!approvals) throw refuse("refunds need the approvals engine (P-07)");
  let a: Awaited<ReturnType<RefundApprovals["get"]>>;
  try {
    a = await approvals.get(spec.approvalRef);
  } catch {
    throw refuse("the refund's approval request was not found");
  }
  if (a.action !== REFUND_ACTION) throw refuse("the approval is for another action");
  if (a.state !== "approved") throw refuse(`the approval is ${a.state}, not approved`);
  if (a.delayUntil && a.delayUntil.getTime() > now())
    throw refuse("the approval is still in its delay window");
  if (a.payloadDigest !== canonicalDigest(refundPayload(spec)))
    throw refuse("the refund does not match the approved request");
}

/** P-12: `kill.payments` on refuses new money operations with a maintenance error. */
export async function assertNotKilled(
  d: AdapterDescriptor,
  killed: (() => boolean | Promise<boolean>) | undefined,
  method: string,
): Promise<void> {
  if (killed && (await killed()))
    throw new PortError("IPB-PORT-002", d.port, {
      adapter: d.adapter,
      detail: `${method} is paused for maintenance (kill.payments)`,
      meta: { reason: "kill_switch", maintenance: true },
    });
}

/** P-10: payment method categories the port reports (no card or account data). */
export type MethodCategory = "card" | "upi" | "netbanking" | "wallet" | "emi" | "other";

export const methodCategory = (m: string | undefined): MethodCategory => {
  const x = (m ?? "").toLowerCase();
  if (x.includes("card")) return "card";
  if (x === "upi" || x.includes("upi")) return "upi";
  if (x === "netbanking" || x === "net_banking" || x === "nb") return "netbanking";
  if (x.includes("wallet") || x === "app") return "wallet";
  if (x.includes("emi") || x.includes("paylater") || x.includes("cardless")) return "emi";
  return "other";
};
