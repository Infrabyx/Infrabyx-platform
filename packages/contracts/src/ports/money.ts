// Money movement through a port (PAYOUTS, payment mandates, stamp duty; Finbyx PR-FBX-29, R1-D-46).
// Every call that moves money, or authorises a future debit, carries: an idempotency key, the
// amount in integer paise, the reference of the approved maker-checker request that allowed it,
// and the person or service that initiates it. An agent principal is never accepted (IPB-02-10:
// agents never disburse); the kernel refuses the verb as well. No vendor adapter moves money until
// the owner approves it (locked list: payments and money movement).
import { z } from "zod";
import { PortError } from "../errors.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/** Who started a money-moving call: a named user or a service, never an agent. */
export const MoneyInitiator = z
  .object({
    principalId: internal(z.string().min(1).max(255)),
    principalType: internal(z.enum(["user", "service"])),
  })
  .strict();
export type MoneyInitiator = z.infer<typeof MoneyInitiator>;

/** The authorisation every money-moving call carries. */
export const MoneyAuthorisation = z
  .object({
    /** The approved maker-checker request (`apr_…` or the product's approval id). */
    approvalRef: internal(z.string().min(3).max(120)),
    initiatedBy: MoneyInitiator,
  })
  .strict();
export type MoneyAuthorisation = z.infer<typeof MoneyAuthorisation>;

/** Idempotency keys of money-moving calls: 8 to 128 of A-Z a-z 0-9 _ . : - */
export const MoneyIdempotencyKey = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/);

/**
 * The check every money-moving adapter (and fake) runs first. An agent initiator is refused with
 * `IPB-SEC-004`; a missing or malformed key or approval with `IPB-UX-004`.
 */
export function assertMoneyCall(port: string, auth: unknown, idempotencyKey: unknown): void {
  const type = (auth as { initiatedBy?: { principalType?: unknown } } | undefined)?.initiatedBy
    ?.principalType;
  if (type === "agent")
    throw new PortError("IPB-SEC-004", port, { detail: "agents never move money (IPB-02-10)" });
  const a = MoneyAuthorisation.safeParse(auth);
  if (!a.success || !MoneyIdempotencyKey.safeParse(idempotencyKey).success)
    throw new PortError("IPB-UX-004", port, {
      detail:
        "a money-moving call needs an idempotency key, an approved maker-checker request and a user or service initiator",
    });
}
