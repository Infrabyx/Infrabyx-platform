// Shared WHATSAPP pieces (PL2 plan §6.12).
// - Session (free-form) messages only inside the 24-hour customer-service window: when the caller
//   gives the time of the recipient's last inbound message, a send outside the window is refused
//   before any request; the vendor's own refusal maps to the same error.
// - Marketing templates stay off (`mkt.meta.enabled=false`, OWN-08): a template's category is read
//   (cached) before sending and a marketing template is refused unless the flag is on.
// - `getConversationCost` reads the deployment's rate card (configuration, never committed);
//   without one it is unsupported.
import { PortError } from "@infrabyx/contracts/errors";
import { WHATSAPP_TEMPLATE_CATEGORIES, type AdapterDescriptor } from "@infrabyx/contracts/ports";

export type TemplateCategory = (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number];
export type TemplateStatus = "approved" | "pending" | "rejected" | "paused";

export const SESSION_WINDOW_MS = 24 * 3600_000;
const CATEGORY_TTL_MS = 10 * 60_000;

export interface WhatsappPolicyOptions {
  /** `mkt.meta.enabled`; marketing templates are refused while false (default). */
  marketingEnabled?: () => boolean;
  /** Time of the recipient's last inbound message (the module's session store). */
  lastInboundAt?: (to: string) => Promise<Date | undefined>;
  /** `int.whatsapp.rate_card`: minor units per message by category (configuration only). */
  rateCard?: { currency: string; amountMinor: Partial<Record<TemplateCategory, number>> };
  now?: () => number;
}

export class WhatsappPolicy {
  private readonly categories = new Map<string, { c: TemplateCategory; at: number }>();

  constructor(
    private readonly d: AdapterDescriptor,
    private readonly o: WhatsappPolicyOptions,
  ) {}

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  outsideWindow(): PortError {
    return new PortError("IPB-PORT-001", "WHATSAPP", {
      adapter: this.d.adapter,
      detail: "free-form messages only inside the 24-hour customer-service window; send a template",
      meta: { reason: "outside_session_window", definite: true },
    });
  }

  async assertSessionOpen(to: string): Promise<void> {
    if (!this.o.lastInboundAt) return;
    const last = await this.o.lastInboundAt(to);
    if (!last || this.now() - last.getTime() > SESSION_WINDOW_MS) throw this.outsideWindow();
  }

  assertCategory(category: TemplateCategory): void {
    if (category === "marketing" && !(this.o.marketingEnabled?.() ?? false))
      throw new PortError("IPB-PORT-001", "WHATSAPP", {
        adapter: this.d.adapter,
        detail: "marketing templates are off (mkt.meta.enabled=false, OWN-08)",
        meta: { reason: "marketing_disabled", definite: true },
      });
  }

  /** Category of a template, cached for 10 minutes. */
  async category(
    name: string,
    read: () => Promise<{ status: TemplateStatus; category: TemplateCategory }>,
  ): Promise<TemplateCategory> {
    const c = this.categories.get(name);
    if (c && this.now() - c.at < CATEGORY_TTL_MS) return c.c;
    const t = await read();
    if (t.status !== "approved")
      throw new PortError("IPB-PORT-001", "WHATSAPP", {
        adapter: this.d.adapter,
        detail: `template ${name} is ${t.status}, not approved`,
        meta: { reason: "template_not_approved", definite: true },
      });
    this.categories.set(name, { c: t.category, at: this.now() });
    return t.category;
  }

  cost(category: TemplateCategory): { currency: string; amountMinor: number } {
    const amount = this.o.rateCard?.amountMinor[category];
    if (!this.o.rateCard || amount === undefined)
      throw new PortError("IPB-PORT-001", "WHATSAPP", {
        adapter: this.d.adapter,
        detail: "no rate card configured (int.whatsapp.rate_card)",
        meta: { reason: "unsupported" },
      });
    return { currency: this.o.rateCard.currency, amountMinor: amount };
  }
}

export const toCategory = (s: string | undefined): TemplateCategory => {
  const c = (s ?? "").toLowerCase();
  return (WHATSAPP_TEMPLATE_CATEGORIES as readonly string[]).includes(c)
    ? (c as TemplateCategory)
    : "marketing"; // unknown is treated as the most restricted category
};

export const toStatus = (s: string | undefined): TemplateStatus => {
  switch ((s ?? "").toUpperCase()) {
    case "APPROVED":
    case "ENABLED":
      return "approved";
    case "PENDING":
    case "SUBMITTED":
    case "IN_APPEAL":
      return "pending";
    case "PAUSED":
      return "paused";
    default:
      return "rejected";
  }
};

/** Body parameter texts of Cloud-API-style components, in order. */
export function bodyParams(components: ReadonlyArray<Record<string, unknown>>): string[] {
  const body = components.find((c) => String(c.type).toLowerCase() === "body");
  const params = (body?.parameters as Array<{ text?: unknown }> | undefined) ?? [];
  return params.map((p) => String(p.text ?? ""));
}
