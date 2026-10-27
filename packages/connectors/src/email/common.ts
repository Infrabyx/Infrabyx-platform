// Shared EMAIL pieces (PL2 plan §6.10).
import type { EmailEvent } from "@infrabyx/contracts/ports";

/** A bounce or complaint event becomes a suppression (the caller applies it with `suppress`). */
export function suppressionFor(
  e: EmailEvent,
): { address: string; reason: "bounce" | "complaint" } | null {
  if (!e.recipient) return null;
  if (e.type === "bounced") return { address: e.recipient, reason: "bounce" };
  if (e.type === "complained") return { address: e.recipient, reason: "complaint" };
  return null;
}
