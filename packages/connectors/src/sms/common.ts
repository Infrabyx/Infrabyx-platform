// Shared SMS pieces (PL2 plan §6.11): Indian traffic uses DLT-registered templates and headers only.
// A send is refused before any request when its template is not registered, its header (sender
// id) is not a registered DLT header, its entity id is not ours, or its variables do not fit the
// template. Registration itself happens on the DLT portal; `registerTemplate` records the mapping.
import { PortError } from "@infrabyx/contracts/errors";
import type { AdapterDescriptor, SmsMessage } from "@infrabyx/contracts/ports";

/** DLT variable placeholder in template text. */
const VAR = /\{#var#\}/gi;

export interface DltTemplate {
  /** Logical template id (`int.sms.template_map` key). */
  templateId: string;
  /** 19-digit DLT content template id. */
  dltTemplateId: string;
  /** Approved text with `{#var#}` placeholders. */
  text: string;
}

export interface DltOptions {
  /** `int.sms.dlt_entity_id` (MSG_SMS_DLT_ENTITY_ID). */
  entityId: string;
  /** DLT-registered headers (`int.sms.sender_id.<brand>` values). */
  senders: readonly string[];
  /** Initial template map (`int.sms.template_map`). */
  templates?: readonly DltTemplate[];
}

export class DltRegistry {
  private readonly templates = new Map<string, DltTemplate>();

  constructor(
    private readonly d: AdapterDescriptor,
    private readonly o: DltOptions,
  ) {
    if (!/^\d{19}$/.test(o.entityId))
      throw new PortError("IPB-PORT-005", d.port, {
        adapter: d.adapter,
        detail: "the DLT entity id is 19 digits",
      });
    for (const t of o.templates ?? []) this.register(t);
  }

  register(t: DltTemplate): void {
    if (!/^\d{19}$/.test(t.dltTemplateId) || !t.text || !t.templateId)
      throw new PortError("IPB-PORT-005", this.d.port, {
        adapter: this.d.adapter,
        detail: `template ${t.templateId}: a 19-digit DLT template id and its text are required`,
      });
    this.templates.set(t.templateId, t);
  }

  private refuse(detail: string, reason: string): PortError {
    return new PortError("IPB-PORT-001", this.d.port, {
      adapter: this.d.adapter,
      detail,
      meta: { reason, definite: true },
    });
  }

  /** Check a message against DLT before sending; returns the template and the rendered text. */
  check(m: SmsMessage): { template: DltTemplate; text: string } {
    const t = this.templates.get(m.templateId);
    if (!t)
      throw this.refuse(
        `template ${m.templateId} is not DLT-registered`,
        "template_not_registered",
      );
    if (!this.o.senders.includes(m.senderId))
      throw this.refuse(
        `header ${m.senderId} is not a registered DLT header`,
        "header_not_registered",
      );
    if (m.dltEntityId !== this.o.entityId)
      throw this.refuse("the DLT entity id is not this deployment's", "entity_mismatch");
    const slots = t.text.match(VAR)?.length ?? 0;
    if (slots !== m.vars.length)
      throw this.refuse(
        `template ${m.templateId} takes ${slots} variables, got ${m.vars.length}`,
        "variables_mismatch",
      );
    let i = 0;
    return { template: t, text: t.text.replace(VAR, () => m.vars[i++] ?? "") };
  }
}

/** E.164 `+919812345678` to the `919812345678` form Indian gateways take. */
export const msisdn = (e164: string): string => e164.replace(/^\+/, "");
