// Consent texts (IPB-05 template 18; IPB-04-76, 04-81, 04-84; PL5 plan §6.1). Each notice or consent
// string is a versioned row so the ledger records exactly what was shown. A PLT_DPO drafts, a
// PLT_LEGAL_REVIEWER approves (never the maker); an approved text never changes, and a new version
// of the banner re-prompts (`web.consent.reprompt_on_change`). The defaults below are IPB-05
// template 18's strings and the IPB-04-81 region variants; they ship as drafts for review.
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import type { ConsentRegion } from "@infrabyx/contracts/ports";
import { newId } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";

export const TEXT_MAKER = "PLT_DPO";
export const TEXT_CHECKER = "PLT_LEGAL_REVIEWER";

export interface DefaultText {
  key: string;
  region?: ConsentRegion;
  body: string;
}

/** IPB-05 template 18 and the banner wording per region (IPB-04-81). Drafts until approved. */
export const DEFAULT_TEXTS: readonly DefaultText[] = [
  {
    key: "consent.cookie.banner",
    body: "We use cookies to run this site and, with your consent, to understand usage and measure campaigns. Choose Accept all, Reject all or Manage. You can change your choice any time.",
  },
  {
    key: "consent.cookie.banner",
    region: "EU",
    body: "We use necessary cookies to run this site. With your consent we also use functional, analytics and marketing cookies; each category has its own lawful basis, shown under Manage. Choose Accept all, Reject all or Manage. You can change your choice any time.",
  },
  {
    key: "consent.cookie.banner",
    region: "US-CA",
    body: "We use cookies to run this site and, with your consent, to understand usage and measure campaigns. You can opt out of the sale or sharing of personal information with Do Not Sell or Share. Choose Accept all, Reject all or Manage.",
  },
  {
    key: "consent.cookie.gpc",
    body: "Your browser sent a privacy signal (Global Privacy Control). We have turned off analytics and marketing cookies. You can still turn them on under Manage.",
  },
  {
    key: "consent.cookie.category.necessary",
    body: "Needed for the site to work and to remember your choices. Always on.",
  },
  {
    key: "consent.cookie.category.functional",
    body: "Remember settings such as language and help us show embedded content you ask for.",
  },
  {
    key: "consent.cookie.category.analytics",
    body: "Help us understand how the site is used, with first-party, self-hosted tools only.",
  },
  {
    key: "consent.cookie.category.marketing",
    body: "Measure campaigns and show relevant offers on other sites.",
  },
  {
    key: "consent.signup.terms",
    body: "I have read and agree to the Terms of Use and the Payment & Subscription Terms (v{{version_label}}).",
  },
  {
    key: "consent.signup.privacy_notice",
    body: "I have read the Privacy Notice. My account data will be used to provide {{product_name}}, secure my account and meet legal duties.",
  },
  {
    key: "consent.marketing.email",
    body: "Send me product updates and offers by email. I can unsubscribe any time.",
  },
  {
    key: "consent.marketing.whatsapp",
    body: "Contact me on WhatsApp at {{phone}} for updates about my enquiry/account. Standard messaging terms of WhatsApp apply. Reply STOP to opt out.",
  },
  {
    key: "consent.contact_form",
    body: "We will use your details to respond to your enquiry. See our Privacy Notice (Contact enquiries).",
  },
  {
    key: "consent.resource_gate",
    body: "We will email you the download link. Your details are used as described in the Privacy Notice (Resources).",
  },
  {
    key: "consent.careers",
    body: "Your application will be processed by {{entity_name}} HR for recruitment and kept for 12 months if unsuccessful. See Privacy Notice (Job applicants).",
  },
  {
    key: "consent.ai.first_use",
    body: "{{ai_display_name}} is an AI assistant. Outputs may be wrong and are labelled; review before use. Your content is not used to train models. See the AI Use & Transparency Policy.",
  },
  {
    key: "consent.ugc.terms",
    body: "I accept the Blog & User-Generated Content Terms (v{{version_label}}) and confirm this post is my own work and not professional advice.",
  },
  {
    key: "consent.rights.nominee",
    body: "I nominate {{nominee_name}} to exercise my data rights if I die or cannot act (DPDP Act s.14).",
  },
  {
    key: "consent.dpa.clickwrap",
    body: "I am authorised to accept the Data Processing Agreement (v{{version_label}}) on behalf of {{org_name}}.",
  },
  {
    key: "notice.policy.change",
    body: "We have updated our {{policy_name}} (v{{version_label}}), effective {{effective_date}}. Read the summary of changes and the full text.",
  },
];

export interface ConsentText {
  id: string;
  key: string;
  version: string;
  locale: string;
  region: ConsentRegion;
  body: string;
  state: "draft" | "approved" | "retired";
}

interface TextRow {
  id: string;
  key: string;
  version: string;
  locale: string;
  region: ConsentRegion;
  body: string;
  state: ConsentText["state"];
  maker_id: string;
}

const toText = (r: TextRow): ConsentText => ({
  id: r.id,
  key: r.key,
  version: r.version,
  locale: r.locale,
  region: r.region,
  body: r.body,
  state: r.state,
});

const readCtx: KernelContext = {
  tenantId: PLATFORM_TENANT_ID,
  principal: { id: "svc_consent_public", type: "service", roles: [] },
};

export class ConsentTexts {
  constructor(private readonly o: { kernel: MutationKernel; audit: AuditSink }) {}

  private platform(ctx: KernelContext, role: string): void {
    if (
      ctx.scope !== "platform" ||
      ctx.tenantId !== PLATFORM_TENANT_ID ||
      !ctx.principal.roles.includes(role)
    )
      throw new IpbError("IPB-UX-011", {
        detail: `consent texts need ${role} in the platform context`,
      });
  }

  /** Draft a new version of a text (the next MINOR unless `major`). */
  async draft(
    ctx: KernelContext,
    t: { key: string; body: string; locale?: string; region?: ConsentRegion; major?: boolean },
  ): Promise<ConsentText> {
    this.platform(ctx, TEXT_MAKER);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const last = await tx.query<{ version: string }>(
          `select version from consent.text where key = $1 and locale = $2 and region = $3
            order by string_to_array(version, '.')::int[] desc limit 1`,
          [t.key, t.locale ?? "en-IN", t.region ?? "IN"],
        );
        const prev = last.rows[0]?.version;
        const [maj, min] = (prev ?? "0.0").split(".").map(Number) as [number, number];
        const version = !prev ? "1.0" : t.major ? `${maj + 1}.0` : `${maj}.${min + 1}`;
        const id = newId("ctx");
        const r = await tx.query<TextRow>(
          `insert into consent.text (id, key, version, locale, region, body, maker_id) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
          [id, t.key, version, t.locale ?? "en-IN", t.region ?? "IN", t.body, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "consent.text.draft",
          resourceType: "consent_text",
          resourceId: id,
          after: { key: t.key, version },
        });
        return toText(r.rows[0]!);
      },
      { action: "consent.text.draft" },
    );
  }

  /** Approve a draft (PLT_LEGAL_REVIEWER, never its maker); the previous approved version retires. */
  async approve(ctx: KernelContext, id: string): Promise<ConsentText> {
    this.platform(ctx, TEXT_CHECKER);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = (
          await tx.query<TextRow>("select * from consent.text where id = $1 for update", [id])
        ).rows[0];
        if (!cur || cur.state !== "draft") throw new NotFoundError("draft consent text");
        if (cur.maker_id === ctx.principal.id) throw new IpbError("IPB-CMS-004");
        await tx.query(
          `update consent.text set state = 'retired' where key = $1 and locale = $2 and region = $3 and state = 'approved'`,
          [cur.key, cur.locale, cur.region],
        );
        const r = await tx.query<TextRow>(
          "update consent.text set state = 'approved', checker_id = $2, approved_at = now() where id = $1 returning *",
          [id, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "consent.text.approve",
          resourceType: "consent_text",
          resourceId: id,
          after: { key: cur.key, version: cur.version },
        });
        return toText(r.rows[0]!);
      },
      { action: "consent.text.approve" },
    );
  }

  /** The approved text for a key, falling back from the region to IN and from the locale to en-IN. */
  async current(
    key: string,
    o: { locale?: string; region?: ConsentRegion } = {},
  ): Promise<ConsentText | null> {
    return this.o.kernel.read(readCtx, async (tx) => {
      const r = await tx.query<TextRow>(
        `select * from consent.text where key = $1 and state = 'approved'
          order by (region = $3) desc, (region = 'IN') desc, (locale = $2) desc, (locale = 'en-IN') desc limit 1`,
        [key, o.locale ?? "en-IN", o.region ?? "IN"],
      );
      return r.rows[0] ? toText(r.rows[0]) : null;
    });
  }

  /** A given version of a text as shown (approved or since retired), region falling back to IN. */
  async version(
    key: string,
    version: string,
    region: ConsentRegion = "IN",
    locale = "en-IN",
  ): Promise<ConsentText | null> {
    return this.o.kernel.read(readCtx, async (tx) => {
      const r = await tx.query<TextRow>(
        `select * from consent.text where key = $1 and version = $2 and state <> 'draft' and region in ($3, 'IN')
          order by (region = $3) desc, (locale = $4) desc limit 1`,
        [key, version, region, locale],
      );
      return r.rows[0] ? toText(r.rows[0]) : null;
    });
  }

  /** Every text and version (Studio's Consent texts section), for the DPO and the legal reviewer. */
  async list(ctx: KernelContext): Promise<ConsentText[]> {
    this.platform(ctx, ctx.principal.roles.includes(TEXT_MAKER) ? TEXT_MAKER : TEXT_CHECKER);
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<TextRow>(
          "select * from consent.text order by key, region, locale, created_at desc, id desc limit 1000",
        )
      ).rows.map(toText),
    );
  }

  /** Texts waiting for the legal reviewer (the Studio queue, IPB-04 §04.3.12 section 12). */
  async drafts(ctx: KernelContext): Promise<ConsentText[]> {
    this.platform(ctx, TEXT_CHECKER);
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<TextRow>(
          "select * from consent.text where state = 'draft' order by key, region, locale",
        )
      ).rows.map(toText),
    );
  }

  /** Seed the template 18 defaults as drafts (any key and region without a text yet). */
  async seedDefaults(ctx: KernelContext): Promise<number> {
    let n = 0;
    for (const t of DEFAULT_TEXTS) {
      const exists = await this.o.kernel.read(
        readCtx,
        async (tx) =>
          (
            await tx.query("select 1 from consent.text where key = $1 and region = $2", [
              t.key,
              t.region ?? "IN",
            ])
          ).rowCount,
      );
      if (exists) continue;
      await this.draft(ctx, {
        key: t.key,
        body: t.body,
        ...(t.region ? { region: t.region } : {}),
      });
      n++;
    }
    return n;
  }
}
