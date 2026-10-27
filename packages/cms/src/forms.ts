// Forms hand-off (IPB-04-67; `@IPB-04-AT-47`; OWNER-QUESTIONS #47; PL5 plan §5.8). A submission is
// checked (known fields, required fields, formats), refused by the honeypot or the rate limit
// (`IPB-WEB-003`, never a CAPTCHA puzzle, IPB-06-40), refused without consent for personal fields
// (`IPB-WEB-002`), recorded in the CONSENT ledger, and handed server-side straight to the port of
// its destination. `cms.form_submission` keeps only the id, destination reference, consent receipt
// and state; field values are never stored, also when the hand-off fails (the person retries).
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, MutationKernel, OutboxWriter } from "@infrabyx/contracts/kernel";
import type {
  ConsentPort,
  ConsentRegion,
  CrmPort,
  HrPort,
  SupportPort,
  WebConsentPurpose,
} from "@infrabyx/contracts/ports";
import { newId } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";
import { BODY_SCHEMAS } from "./bodies.js";
import { publicReadContext } from "./public.js";
import { cmsServiceContext, emit, type Deps } from "./repo.js";

export const CMS_FORMS_PRINCIPAL_ID = "svc_cms_forms";
/** The honeypot field rendered off-screen; any value means a bot. */
export const HONEYPOT_FIELD = "website_url";

type FormBody = ReturnType<(typeof BODY_SCHEMAS)["form"]["parse"]>;

export interface FormSubmission {
  packId: string;
  formId: string;
  fields: Readonly<Record<string, string>>;
  /** The consent control for the form's notice (unticked by default). */
  consent: boolean;
  /** Separate, optional marketing controls (each its own purpose, IPB-05 template 18). */
  marketing?: { email?: boolean; whatsapp?: boolean };
  honeypot?: string;
  clientKey: string;
  cid?: string;
  region?: ConsentRegion;
  gpc?: boolean;
  pageUrl: string;
}

export interface FormResult {
  submissionId: string;
  /** The reference shown to the person (lead, application or ticket). */
  reference: string;
  consentReceiptId: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()-]{6,20}$/;

export class FormService {
  private readonly deps: Deps;
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      product: string;
      consent: ConsentPort;
      crm: CrmPort;
      hr?: HrPort;
      support?: SupportPort;
      outbox?: OutboxWriter;
      /** The anti-spam rate limit per client (IPB-04 §04.3.1 form block). */
      allow?: (clientKey: string) => Promise<boolean> | boolean;
      /** The version of a consent text key (`@infrabyx/consent` texts). */
      textVersion?: (key: string, packId: string) => Promise<string>;
    },
  ) {
    this.deps = { audit: o.audit, outbox: o.outbox, product: o.product };
  }

  private async form(packId: string, formId: string): Promise<FormBody> {
    return this.o.kernel.read(publicReadContext, async (tx) => {
      const r = await tx.query<{ body: FormBody }>(
        `select r.body from cms.content_item i join cms.revision r on r.id = i.published_revision_id
          where i.id = $1 and i.brand_pack_id = $2 and i.content_type = 'form' and i.deleted_at is null and i.status <> 'archived'`,
        [formId, packId],
      );
      if (!r.rows[0]) throw new NotFoundError("form");
      return r.rows[0].body;
    });
  }

  async submit(s: FormSubmission): Promise<FormResult> {
    if (s.honeypot?.trim()) throw new IpbError("IPB-WEB-003", { detail: "anti-spam check" });
    if (this.o.allow && !(await this.o.allow(s.clientKey)))
      throw new IpbError("IPB-WEB-003", { detail: "too many submissions" });
    const form = await this.form(s.packId, s.formId);
    const known = new Map(form.fields.map((f) => [f.name, f]));
    const errors: { path: string; code: string; message: string }[] = [];
    for (const k of Object.keys(s.fields))
      if (!known.has(k)) errors.push({ path: k, code: "IPB-CMS-001", message: "unknown field" });
    for (const f of form.fields) {
      const v = s.fields[f.name]?.trim() ?? "";
      if (f.required && !v)
        errors.push({ path: f.name, code: "IPB-CMS-001", message: `${f.label} is required` });
      else if (v && f.kind === "email" && !EMAIL.test(v))
        errors.push({ path: f.name, code: "IPB-CMS-001", message: "enter an email address" });
      else if (v && f.kind === "tel" && !PHONE.test(v))
        errors.push({ path: f.name, code: "IPB-CMS-001", message: "enter a phone number" });
      else if (v && f.kind === "select" && f.options && !f.options.includes(v))
        errors.push({ path: f.name, code: "IPB-CMS-001", message: "choose an option" });
      else if (v.length > 5000)
        errors.push({ path: f.name, code: "IPB-CMS-001", message: "too long" });
    }
    if (errors.length) throw new IpbError("IPB-CMS-001", { detail: errors[0]!.message, errors });
    const personal = form.fields.some((f) => f.personal && s.fields[f.name]?.trim());
    if (personal && !s.consent) throw new IpbError("IPB-WEB-002");

    const textKey =
      form.consent_text_ref ??
      (form.destination === "hr_application" ? "consent.careers" : "consent.contact_form");
    const textVersion = (await this.o.textVersion?.(textKey, s.packId)) ?? "1.0";
    const purposes: WebConsentPurpose[] = [
      form.destination === "hr_application" ? "CAREER_APPLICATION" : "LEAD_CONTACT",
      ...(s.marketing?.email ? (["MARKETING_EMAIL"] as const) : []),
      ...(s.marketing?.whatsapp ? (["MARKETING_WHATSAPP"] as const) : []),
    ];
    const email = Object.entries(s.fields).find(([k]) => known.get(k)?.kind === "email")?.[1];
    const receipt = await this.o.consent.recordConsent({
      ...(s.cid
        ? { cid: s.cid }
        : { principalRef: `form:${(email ?? newId("fsb")).toLowerCase()}`.slice(0, 120) }),
      brandPackId: s.packId,
      method: "FORM",
      purposes,
      textKey,
      textVersion,
      region: s.region ?? "IN",
      gpc: s.gpc ?? false,
    });

    let reference: string | null = null;
    let failure: string | null = null;
    try {
      reference = await this.handOff(form, s, receipt.receiptId, textVersion);
    } catch (e) {
      failure = (e as { code?: string }).code ?? "IPB-PORT-002";
    }
    const submissionId = newId("fsb");
    await this.o.kernel.mutate(
      cmsServiceContext(CMS_FORMS_PRINCIPAL_ID),
      async (tx) => {
        await tx.query(
          `insert into cms.form_submission (id, form_item_id, destination, destination_ref, consent_receipt_id, state, error_code)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            submissionId,
            s.formId,
            form.destination,
            reference,
            receipt.receiptId,
            reference ? "handed_off" : "failed",
            failure,
          ],
        );
        await this.o.audit.record(tx, {
          action: reference ? "cms.form.handed_off" : "cms.form.failed",
          resourceType: "cms_form",
          resourceId: s.formId,
          after: { submission_id: submissionId, destination: form.destination, error: failure },
        });
        if (reference && form.destination === "crm_lead")
          await emit(
            tx,
            this.deps,
            { module: "mkt", name: "LeadCaptured" },
            {
              lead_ref: reference,
              source: "FORM",
              consent_receipt_id: receipt.receiptId,
            },
          );
      },
      { action: "cms.form.submit" },
    );
    if (!reference)
      throw new IpbError("IPB-PORT-002", {
        detail: "we could not send your message; please try again",
      });
    return { submissionId, reference, consentReceiptId: receipt.receiptId };
  }

  private async handOff(
    form: FormBody,
    s: FormSubmission,
    receiptId: string,
    noticeVersion: string,
  ): Promise<string> {
    switch (form.destination) {
      case "crm_lead":
        return (
          await this.o.crm.upsertLead({
            source: "FORM",
            product: this.o.product,
            brandPackId: s.packId,
            fields: { ...s.fields },
            consentReceiptId: receiptId,
            noticeVersion,
            pageUrl: s.pageUrl.slice(0, 500),
          })
        ).leadId;
      case "hr_application": {
        if (!this.o.hr) throw new IpbError("IPB-PORT-001", { detail: "HR port" });
        const { role_id: roleId = "general", ...fields } = s.fields;
        return (
          await this.o.hr.createApplication({
            roleId,
            brandPackId: s.packId,
            fields,
            consentReceiptId: receiptId,
            noticeVersion,
          })
        ).applicationId;
      }
      default: {
        if (!this.o.support) throw new IpbError("IPB-PORT-001", { detail: "SUPPORT port" });
        const kind = form.destination === "support_ticket" ? "support" : form.destination;
        return (
          await this.o.support.createTicket({
            kind,
            category: "CONTENT",
            summary: Object.entries(s.fields)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")
              .slice(0, 4000),
            contactOk: true,
            consentReceiptId: receiptId,
          })
        ).ref;
      }
    }
  }
}
