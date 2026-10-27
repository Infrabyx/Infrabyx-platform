// Shared pieces of the PUSH adapters (PL3 plan §6.7): the payload guard (title, deep link and at
// most 8 INTERNAL data keys; anything else is IPB-NTF-006 before any request), tokens kept in a
// `PushTokenStore` (sealed by NOTIFY), and the unsupported-capability error.
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import { PushNotification, type PortCall } from "@infrabyx/contracts/ports";

/** Validate the payload; the push channel carries INTERNAL data only (IPB-NTF-006). */
export function guardPush(n: unknown, call?: PortCall): PushNotification {
  if (call?.dataClass && call.dataClass !== "INTERNAL" && call.dataClass !== "PUBLIC")
    throw new IpbError("IPB-NTF-006", { detail: `${call.dataClass} content never goes in a push` });
  const p = PushNotification.safeParse(n);
  if (!p.success)
    throw new IpbError("IPB-NTF-006", { detail: p.error.issues[0]?.message ?? "push payload" });
  return p.data;
}

export function unsupported(adapter: string, method: string): PortError {
  return new PortError("IPB-PORT-001", "PUSH", {
    adapter,
    detail: `${adapter} does not provide ${method}`,
    meta: { reason: "unsupported" },
  });
}

export const chunks = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
