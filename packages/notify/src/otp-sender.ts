// Customer sign-in codes through NOTIFY (OWNER-QUESTIONS #84 (b), R1-D-19): the
// `CustomerOtpSender` the IDENTITY customer adapters call. Each code goes out at once through
// `NotifyService.sendOneTimeCode` on the product's security class for the channel; the code and the
// address are never stored. A delivery that is not sent (killed channel, suppressed address, vendor
// failure) is refused with IPB-NTF-004 (kill switch) or IPB-NTF-003, so the customer sees that no code is on its way.
import { IpbError } from "@infrabyx/contracts/errors";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { CustomerOtpChannel, CustomerOtpSender } from "@infrabyx/contracts/ports";
import type { NotifyService } from "./service.js";

export function notifyOtpSender(o: {
  notify: Pick<NotifyService, "sendOneTimeCode">;
  /** The product's security class per channel, e.g. `{ sms: "security.sign_in_code" }`. */
  classes: Partial<Record<CustomerOtpChannel, string>>;
  /** The service context NOTIFY records the delivery under, for the customer's tenant. */
  context(tenantId: string): KernelContext;
}): CustomerOtpSender {
  return {
    async send(m) {
      const cls = o.classes[m.channel];
      if (!cls)
        throw new IpbError("IPB-NTF-003", {
          detail: `no sign-in code class for ${m.channel}`,
          meta: { channel: m.channel },
        });
      const state = await o.notify.sendOneTimeCode(o.context(m.tenantId), {
        class: cls,
        recipientRef: `cus:${m.userId}`,
        channel: m.channel,
        address: m.to,
        code: m.code,
        expiresAt: m.expiresAt,
        ...(m.locale ? { locale: m.locale } : {}),
        idempotencyKey: m.idempotencyKey,
      });
      if (state !== "sent" && state !== "delivered")
        throw new IpbError(state === "killed" ? "IPB-NTF-004" : "IPB-NTF-003", {
          detail: "the sign-in code was not sent",
          meta: { channel: m.channel, state },
        });
    },
  };
}
