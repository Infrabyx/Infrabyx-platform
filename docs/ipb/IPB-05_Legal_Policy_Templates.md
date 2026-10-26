# IPB-05 — Legal Policy Templates  (Infrabyx Platform Baseline Standard v1.0, 25 October 2026)

> **Status:** Binding for LD, LDC, EQ, FBX, UDF, OH unless a product records an `IPB-DEV` deviation.
> **Related:** IPB-04 (CMS `legal_page`, policy sets, CMP, footer, pricing display), IPB-01 (identity and consent capture at sign-up via `IDENTITY_PORT`), IPB-02 (security baseline — breach and incident controls the Privacy Notice and DPA describe), IPB-03 (AI Gateway and Vidhi AI kernel — disclosures in Template 6), IPB-06 (accessibility — Template 10), IPB-07 (settings tree — `Settings › Privacy & consents › Legal documents` placement (IPB-07 node 3)), IPB-08 (Vendor Assurance Room — documents referenced by Templates 15 and 17), Ecosystem Spec v1.2 Part 5 (billing, selling entity), Part 6 (consent ledger).

## 05.1 Purpose and scope

This file supplies **review-ready, parameterised templates** for every public-facing legal document each product must publish. They are drafting baselines for counsel, not legal advice. Each template is marked where a lawyer must decide (**[COUNSEL]**), where a statutory reference must be confirmed before publication (**[VERIFY]**), and where the owner must choose a commercial position (**[OWNER]**). No product publishes a template without the review checklist completed and `PLT_LEGAL_REVIEWER` sign-off recorded in the CMS approval (IPB-04-06).

Scope: 18 templates (Privacy Notice; Terms of Use; Payment & Subscription Terms; Refund & Cancellation Policy; Cookie Policy; AI Use & Transparency Policy; Grievance Redressal Policy; Acceptable Use Policy; Data Retention & Deletion Schedule; Accessibility Statement; Security & Responsible Disclosure; Blog & User-Generated Content Terms; Resources Download Terms; Marketplace / Professional Terms outline; Data Processing Agreement; SLA outline; Vendor / Outsourcing Assurance Statement; Consent Manager and notice texts), the parameter block, placement rules, product-specific insert tables, version and re-consent mechanics, a payment-gateway onboarding checklist and a search-engine trust checklist.

Out of scope: tenant-to-customer documents generated inside the products (loan agreements, KFS, mediation agreements, engagement letters) — those are product features governed by product packs; employment and HR policies (OH HRMS); board-level policies (OH controls), except where the Governance page lists them.

Drafting conventions used in the templates: plain English, second person ("you"), defined terms in Title Case, numbered clauses, one obligation per sentence. Indian spelling. Statutory references name the instrument and provision. Where a template gives alternatives, they appear as `{{#if …}}` blocks or `[Option A | Option B]`.

## 05.2 Definitions

| Term | Meaning |
|---|---|
| **Template** | A versioned Markdown document in `packages/cms/policies/<key>/<template_version>.md` with Handlebars-style parameters. |
| **Policy instance** | A rendered template bound to a brand pack with parameter values, `effective_at`, `version_label` and approvals (`cms.policy_instance`, IPB-04). |
| **Policy set** | The collection of instances a brand pack publishes; the footer Legal column renders the set. |
| **Parameter** | A `{{name}}` placeholder resolved from the brand pack's legal entity record, settings, or the instance's own `params`. Unresolved parameters block publish. |
| **Re-consent trigger** | A flag on an instance that forces affected users to acknowledge or re-consent on next login (material changes to Privacy Notice, Terms, Payment Terms, AI Policy, UGC Terms). |
| **Selling entity** | The Operations Hub legal entity that is merchant of record for a product (`{{selling_entity_name}}`); may differ from the operating entity shown as data fiduciary. |
| **Data Fiduciary / Data Processor / Data Principal** | As in the Digital Personal Data Protection Act 2023, s.2(i), s.2(k), s.2(j) [LAW]. |
| **Significant Data Fiduciary (SDF)** | As notified under DPDP Act s.10; none of the products is assumed to be an SDF at v1.0 [OWNER to confirm per product]. |
| **Consent Manager** | Registered person under DPDP Act s.6(7)–(9) and the DPDP Rules 2025 (registration regime from 13 Nov 2026 per research `R_Standards_Quick_Reference.md` §A) [VERIFY]. |
| **Tier (requirements)** | M mandatory; S should; O optional, controlled by toggle. |

## 05.3 Requirements

### 05.3.1 Publication, placement and parameters

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-05-01 | Every product publishes instances of templates 1, 2, 5, 6, 7, 8, 9, 10, 11 and 18 before its public site goes live. Templates 3 and 4 are mandatory where the product sells online. Template 12 where UGC is enabled; 13 where Resources are gated; 14 where a marketplace exists; 15, 16, 17 where business customers are onboarded. | M | AT-01 |
| IPB-05-02 | Placement is binding: footer Legal column (all); checkout and plan-selection screens (3, 4 linked above the CTA; GST display per IPB-04-35); sign-up (1, 2, 6 linked next to the consent control; 18 texts inline); Settings › Privacy & consents › Legal documents in `apps/web` (all, with version history and the user's own acceptance records); resource gate (13); UGC editor (12); DPA request form (15); Trust Centre (11, 15, 16, 17); grievance page (7). | M | AT-02 |
| IPB-05-03 | The parameter block below is the complete allowed set. All parameters resolve from the brand pack's `legal_entity`, `policy_set` params or registered settings. A template with an unresolved parameter cannot publish (`IPB-POL-001`). | M | AT-03 |
| IPB-05-04 | Each instance shows: title, `version_label` (semantic: `MAJOR.MINOR`), effective date, "last reviewed" date, a "what changed" summary, and a link to every prior version (immutable). | M | AT-04 |
| IPB-05-05 | Material changes (MAJOR bump) to templates 1, 2, 3, 6, 12 set `reconsent_required=true`; the app shows a blocking-but-dismissible notice at next login with a diff summary and an explicit "I have read and agree" action for Terms-class documents, and a notice-only acknowledgement for Privacy-class documents (consent is purpose-based, not document-based [INTERP]); refusal of Terms leads to a read-only mode with export, never silent lock-out. | M | AT-05 |
| IPB-05-06 | Notice period: MAJOR changes to templates 2 and 3 take effect no earlier than 30 days after publication for existing customers (`pol.notice_days`, default 30), with email notice through `NOTIFY_PORT`; MINOR changes (clarifications, contact details) are effective on publication. | M | AT-05 |
| IPB-05-07 | Every instance is available in `en-IN` and `hi-IN` (summary at minimum in `hi-IN`, full text where `pol.full_hindi=true`); machine translation drafts cannot publish without human legal review (IPB-04-14). The English version is stated to prevail **[COUNSEL]**. | M | AT-06 |
| IPB-05-08 | Each instance is downloadable as tagged PDF (via `DOCGEN_PORT`) with version and effective date in the footer; the PDF hash is stored with the instance. | S | AT-04 |
| IPB-05-09 | A machine-readable policy index is published at `/legal/index.json` (keys, versions, effective dates, URLs) for OH compliance calendar and for tenants' GRC tooling. | S | CI |
| IPB-05-10 | Review cadence: Privacy Notice, Cookie Policy, Retention Schedule, AI Policy — every 6 months or on legal change; others annually. Overdue instances surface in Studio › Policies and emit `PolicyReviewDue`. | M | AT-07 |
| IPB-05-11 | Legal pages are server-rendered, indexable, printable, and WCAG 2.2 AA; headings follow the template numbering so deep links (`#clause-7`) are stable across versions. | M | AT-02 |
| IPB-05-12 | Publication requires `PLT_LEGAL_REVIEWER` as maker and `PLT_SUPER_ADMIN` as checker; privacy-class documents (1, 5, 9, 15, 18) additionally require `PLT_DPO` approval. | M | AT-08 |

### 05.3.2 Parameter block (binding names)

| Parameter | Source | Example / note |
|---|---|---|
| `{{entity_name}}` | brand pack legal entity | operating entity (data fiduciary) |
| `{{entity_short}}` | brand pack | "LawDocs" |
| `{{entity_type}}` | brand pack | "a private limited company incorporated under the Companies Act 2013" |
| `{{cin}}` | brand pack | 21-character CIN |
| `{{gstin}}` | brand pack | 15-character GSTIN |
| `{{registered_office}}` | brand pack | full postal address |
| `{{corporate_office}}` | offices | optional |
| `{{selling_entity_name}}`, `{{selling_entity_cin}}`, `{{selling_entity_gstin}}`, `{{selling_entity_address}}` | OH8 selling entity for the product | merchant of record placeholder |
| `{{product_name}}` | `brand.app_name` | "Udofin" or white-label name |
| `{{product_code}}` | product | LD, LDC, EQ, FBX, UDF, OH |
| `{{domain}}` | brand pack primary host | "lawdocs.in" |
| `{{app_url}}` | settings | login URL |
| `{{support_email}}`, `{{support_phone}}`, `{{support_hours}}` | footer | |
| `{{dpo_name}}`, `{{dpo_email}}`, `{{dpo_address}}` | policy set | Data Protection Officer or "person able to answer questions" under DPDP s.8(9) [LAW] |
| `{{grievance_officer}}`, `{{grievance_email}}`, `{{grievance_phone}}`, `{{grievance_address}}` | policy set | |
| `{{nodal_officer}}` | policy set (UDF/FBX) | RBI nodal/principal nodal officer where required [VERIFY] |
| `{{security_email}}` | policy set | security@ |
| `{{refund_window_days}}` | plan setting | e.g., 7 |
| `{{refund_timeline_days_min}}` / `{{refund_timeline_days_max}}` | setting | 5 / 7 working days |
| `{{trial_days}}` | catalogue | e.g., 14 |
| `{{trial_auto_convert}}` | product policy | `true`/`false` |
| `{{renewal_notice_days}}` | setting | e.g., 7 |
| `{{billing_cycles}}` | catalogue | "monthly, annual" |
| `{{currency_list}}` | catalogue | "INR; USD for customers outside India" |
| `{{governing_law_city}}` | policy set | "New Delhi" |
| `{{arbitration_seat}}` | policy set | "New Delhi" |
| `{{odr_provider_name}}` | policy set | "Equator Resolution" |
| `{{odr_rules_url}}` | policy set | |
| `{{min_age}}` | product | 18 |
| `{{retention_schedule_url}}` | policy set | link to template 9 instance |
| `{{sub_processor_list_url}}` | Trust Centre | |
| `{{status_page_url}}` | settings | |
| `{{effective_date}}`, `{{version_label}}`, `{{last_reviewed}}` | instance | auto |
| `{{ai_display_name}}` | `brand.terminology.vidhi` or "Vidhi" | |
| `{{regulator_refs}}` | product insert | list for grievance escalation |
| `{{lending_partners_url}}` | UDF/FBX | |
| `{{consent_manager_name}}` | policy set | if integrated; else "none at present" |

## 05.4 Design — templates

Each template below gives: purpose; where displayed; parameters beyond the common block; template text; product-specific inserts; review checklist. Version mechanics are common (§05.3) and restated only where the template has special triggers.

---

### Template 1 — Privacy Notice

**Purpose.** The notice required of a Data Fiduciary when seeking consent (DPDP Act 2023 s.5; DPDP Rules 2025 r.3 [LAW; VERIFY rule number]) and the general privacy disclosure for visitors and users. **Where displayed.** Footer Legal; sign-up consent control; CMP preference centre link; Settings › Privacy & consents › Legal documents; every form with personal fields links to the relevant section. **Extra parameters.** `{{purposes_table}}` (product insert), `{{categories_table}}`, `{{third_party_table}}`, `{{transfer_countries}}`, `{{analytics_adapter_names}}`.

**Template text.**

> # Privacy Notice — {{product_name}}
> Version {{version_label}} · Effective {{effective_date}} · Last reviewed {{last_reviewed}} · [Prior versions]
>
> **Summary.** {{entity_name}} ("we") operates {{product_name}} at {{domain}} and {{app_url}}. We process your personal data to provide the service you ask for, to meet legal duties, and — only with your consent — for the other purposes listed below. You can withdraw consent, access and correct your data, ask for erasure, nominate someone to act for you, and complain to us or to the Data Protection Board of India. This notice is available in English and Hindi.
>
> **1. Who we are (Data Fiduciary).** {{entity_name}}, {{entity_type}}, CIN {{cin}}, registered office {{registered_office}}. Contact for privacy questions: {{dpo_name}}, {{dpo_email}}, {{dpo_address}} (DPDP Act 2023 s.8(9)). Grievance Officer: {{grievance_officer}}, {{grievance_email}} (s.13). {{#if white_label}}{{product_name}} is provided to you by {{entity_name}} using technology from Infrabyx Group; Infrabyx entities act as our Data Processors under contract.{{/if}}
>
> **2. What this notice covers.** Visitors to {{domain}}; people who create accounts; people whose data a customer uploads into {{product_name}} (where our customer is the Data Fiduciary and we are its Data Processor — see clause 12); job applicants; people who contact us.
>
> **3. Personal data we process and why.** {{purposes_table}} — a table with columns: Purpose · Personal data · Basis (consent under s.6 / legitimate use under s.7 — e.g., s.7(a) voluntarily provided for a specified purpose, s.7(b) State functions where applicable, s.7(e) employment, s.7(i) compliance with law) · Retention (see clause 9) · Who receives it. Each purpose is itemised; we do not bundle purposes. Consent for one purpose is not a condition for another unless the service cannot be provided without it.
>
> **4. Categories of personal data.** {{categories_table}} — identity and contact; account and authentication (including passkeys and MFA metadata); billing (tokenised payment reference only; card data is held by our payment gateway, never by us); usage and device data; communications; content you upload; {{product insert}}.
>
> **5. How we collect.** Directly from you; automatically through our service (logs, first-party cookies — see the Cookie Policy); from our customers who use {{product_name}} to process your data; from public registers where the law allows (e.g., MCA, GST portals) [product insert]; from identity verification providers you authorise.
>
> **6. Consent and how to withdraw.** Where we rely on consent, it is free, specific, informed, unconditional and unambiguous, given by a clear affirmative action (s.6(1)). You may withdraw at any time at Settings › Privacy & consents, through the Cookie settings link, by email to {{dpo_email}}, or through a registered Consent Manager where we support one ({{consent_manager_name}}). Withdrawal is as easy as giving consent (s.6(4)) and does not affect processing already done lawfully (s.6(5)). After withdrawal we stop the processing and erase the data unless retention is required by law (s.6(6)).
>
> **7. Children.** {{product_name}} is for persons aged {{min_age}} and above. We do not knowingly process data of children (under 18) or persons with disabilities who have a lawful guardian without verifiable consent of the parent or guardian (s.9; DPDP Rules 2025 r.10 [VERIFY]). We do not track or target advertising at children (s.9(3)). If you believe a child has provided data, contact {{dpo_email}}.
>
> **8. Sharing and processors.** We share personal data with: our Data Processors (hosting, email, payment gateway, support tooling, analytics where consented) listed at {{sub_processor_list_url}}; our customers' administrators (for data they control); auditors, regulators and courts where required by law; successors in a merger (with notice). We do not sell personal data. {{third_party_table}}.
>
> **9. Retention and erasure.** We keep personal data only as long as the purpose requires or the law demands, then erase it and cause our processors to erase it (s.8(7)). The schedule is at {{retention_schedule_url}}. Where the law sets a minimum (tax records, KYC, audit logs) we state it there. Before erasing data for inactivity we will notify you where the Rules require (DPDP Rules 2025 r.8 and Third Schedule [VERIFY applicability — applies to notified classes of fiduciaries]).
>
> **10. Your rights (Data Principal).** Access a summary of your data and processing (s.11); correction, completion, updating and erasure (s.12); grievance redressal (s.13) — see our Grievance Redressal Policy; nominate a person to exercise your rights if you die or are incapacitated (s.14) at Settings › Privacy & consents › Nominee. We respond within the period stated in the Grievance Redressal Policy. You have duties too: do not impersonate, suppress material information, or make false complaints (s.15).
>
> **11. Security and breach notice.** We apply reasonable security safeguards (s.8(5); DPDP Rules 2025 r.6 [VERIFY]): encryption in transit and at rest, access control, logging, backups, and tested incident response. If a personal data breach occurs we will inform the Data Protection Board and each affected Data Principal without delay in the form and timelines the Rules require (s.8(6); r.7 — initial intimation without delay, detailed report within 72 hours [VERIFY]). We also report cyber incidents to CERT-In within six hours of noticing them where the CERT-In Directions of 28 April 2022 apply [LAW].
>
> **12. When we act as a Processor.** When a customer uses {{product_name}} to process your data, the customer is the Data Fiduciary. We process only on its instructions under a Data Processing Agreement. Direct your requests to that customer; we will help it respond.
>
> **13. Cross-border transfer.** Our primary systems are in India (reference region: Mumbai; disaster recovery: Hyderabad). Where a processor is outside India we transfer data only to countries not restricted by the Central Government under s.16 and the Rules (r.14 [VERIFY]), under contract. Current list: {{transfer_countries}}. Regulated financial data and other restricted classes are not transferred outside India [product insert; RBI directions where applicable].
>
> **14. Cookies and similar technologies.** See the Cookie Policy. We ask for consent before any non-essential cookie and honour the Global Privacy Control signal.
>
> **15. Automated decisions and AI.** See the AI Use & Transparency Policy. We do not make legally significant decisions about you solely by automated means without human review, and we do not use your content to train AI models.
>
> **16. Changes to this notice.** We publish every version with its effective date. Material changes are notified in the app or by email at least {{renewal_notice_days}} days before they take effect where practicable.
>
> **17. Contact and complaints.** {{dpo_name}}, {{dpo_email}}. Grievance Officer: {{grievance_officer}}, {{grievance_email}}, {{grievance_address}}. If unresolved, you may complain to the Data Protection Board of India (s.27) [VERIFY portal URL once operational].
>
> **Annex A — GDPR / UK GDPR switch** (rendered only when `pol.gdpr_annex=true` for packs serving EEA/UK users): controller identity and EU/UK representative; lawful bases per purpose (Art. 6(1)(a), (b), (c), (f)); rights (Arts. 15–22) incl. objection and portability; transfers under adequacy or SCCs (Art. 46); supervisory authority complaint (Art. 77); retention; automated decision-making (Art. 22) **[COUNSEL]**.
>
> **Annex B — California (CCPA/CPRA) switch** (`pol.ccpa_annex=true`): categories collected and disclosed in the last 12 months; "Do Not Sell or Share"; sensitive personal information; right to know, delete, correct, limit; non-discrimination; authorised agents; metrics disclosure if thresholds met **[COUNSEL]**.

**Product-specific inserts.**

| Product | Purposes/categories to add | Transfer and regulatory notes |
|---|---|---|
| LD | Document content and metadata; eSign audit trails (Aadhaar eSign/DSC metadata via licensed providers); client-matter records; payment for stamp duty and filings | eSign data processed by ESP under IT Act s.3A and CCA rules [LAW]; privilege statement: we never read matter content except on instruction or for abuse investigation under process |
| LDC | Compliance calendars, filings, officer names/DINs, uploaded evidence | Regulatory filings data may be shared with authorities only on customer instruction |
| EQ | Case files, party and neutral identity, hearing recordings, settlement terms | Confidentiality of mediation (Mediation Act 2023 s.22–23 [VERIFY]) and arbitration (Arbitration and Conciliation Act 1996 s.42A [LAW]); recordings retention per Rules & Procedures |
| FBX | Borrower KYC, credit bureau data, bank statements, repayment history — as Processor for the lender | India-only storage for regulated data; RBI Digital Lending Directions 2025 data-storage limits (only minimal data, no biometrics unless permitted) [LAW; VERIFY para]; bureau data under CICRA 2005 [LAW] |
| UDF | As Data Fiduciary for app users and as LSP: KYC, device data (no contact list, media or call log access — explicit prohibition), location only for KYC/fraud with consent, bureau pulls | RBI Digital Lending Directions 2025 consent/data limits, purpose-specific one-time access, no sale of data, borrower may revoke app access; partner lender identity disclosed [LAW; VERIFY] |
| OH | Staff, candidate, vendor and customer-contact data for the group; CRM leads from all products | Group-internal sharing described; staff `product_scope` segregation (IPB-D-12) |

**Review checklist.** ☐ Entity, CIN, office, DPO, Grievance Officer verified against MCA/board records ☐ Purposes table itemised, no bundling ☐ Each s.7 legitimate-use reliance confirmed by counsel ☐ Children clause matches product age gate ☐ Retention links resolve ☐ Sub-processor list current ☐ Transfer list matches actual processors ☐ Breach timelines match the IPB-02 incident runbook ☐ Hindi version reviewed ☐ Annexes toggled correctly per pack ☐ No "Privacy Shield" or pre-DPDP language ☐ Effective date ≥ publication date.

---

### Template 2 — Terms of Use

**Purpose.** The user agreement required of an intermediary (IT Act 2000 s.79; IT Rules 2021 r.3(1)(a) [LAW]) and the contract for the service. **Where displayed.** Footer; sign-up acceptance; Settings; checkout (linked). **Extra parameters.** `{{service_description}}`, `{{professional_boundary}}`, `{{liability_cap}}` (e.g., "fees paid in the 12 months before the claim"), `{{plan_terms_url}}`.

**Template text (clause headings and binding content; counsel to finalise wording).**

> # Terms of Use — {{product_name}}
> Version {{version_label}} · Effective {{effective_date}}
>
> **1. Agreement.** These Terms are between you and {{entity_name}} (CIN {{cin}}, {{registered_office}}). By creating an account, clicking "I agree", or using {{product_name}}, you accept them. If you act for an organisation, you confirm you are authorised. The Privacy Notice, Payment & Subscription Terms, Refund & Cancellation Policy, Acceptable Use Policy, AI Use & Transparency Policy and any order form are part of this agreement. In a conflict, an executed order form prevails, then these Terms, then the policies.
>
> **2. The service.** {{service_description}}. We may improve or change features; we will not remove a material feature of a paid plan during its term without notice and a pro-rata remedy. Availability commitments are in the SLA where your plan includes one.
>
> **3. Eligibility and accounts.** You must be {{min_age}} or older and able to contract (Indian Contract Act 1872 s.11 [LAW]). Keep credentials confidential; use MFA where we require it; tell us promptly at {{security_email}} of unauthorised use. You are responsible for activity under your account unless caused by our breach.
>
> **4. Professional-services boundary.** {{professional_boundary}} — see product insert. {{product_name}} provides software and information; it does not create an advocate–client, adviser–client or fiduciary relationship with you, except where a separately engaged professional expressly accepts an engagement in writing. Content on {{domain}}, including blog posts, templates and AI outputs, is general information, not advice.
>
> **5. Acceptable use.** You will comply with the Acceptable Use Policy and with IT Rules 2021 r.3(1)(b) content restrictions [LAW]. We may remove content and suspend access as the AUP describes.
>
> **6. Your content and our licence.** You own content you upload. You grant us a non-exclusive, worldwide, royalty-free licence to host, process, display and transmit it only to provide the service, to prevent abuse, and as the law requires. We do not use your content to train AI models. You warrant you have the rights to upload it.
>
> **7. Our intellectual property.** {{product_name}}, its software, designs, documentation, templates and trade marks belong to {{entity_name}} or its licensors. You receive a limited, revocable, non-transferable right to use them for your internal business or personal purposes. No reverse engineering except as permitted by law (Copyright Act 1957 s.52(1)(ab)–(ad) [LAW]). Feedback you give may be used freely without obligation.
>
> **8. AI-generated content.** {{ai_display_name}} and other AI features generate outputs that may be inaccurate or incomplete. Outputs are labelled and dated. You must review them before relying on them, and a qualified human must approve any output used in a legal, financial or regulatory filing. See the AI Use & Transparency Policy. We disclaim warranties as to AI outputs to the extent the law allows.
>
> **9. Fees.** Fees, taxes, billing cycles, renewals and refunds are governed by the Payment & Subscription Terms and the Refund & Cancellation Policy. Statutory fees we pay on your behalf (stamp duty, filing fees, gateway charges) are passed through at cost unless stated.
>
> **10. Third-party services.** Payment gateways, eSign providers, video providers, credit bureaus and lending partners act under their own terms. We are not responsible for their services except as our contract with you states.
>
> **11. Suspension and termination.** We may suspend for non-payment (after notice and a cure period of at least 7 days), security risk, legal demand, or material breach. You may terminate at any time from Settings; cancellation is as easy as sign-up. On termination you may export your data for at least 30 days (`<PRODUCT>-EXPORT-1.0`); after that we delete it per the Retention Schedule, except what the law requires us to keep. Clauses that by nature survive, survive.
>
> **12. Warranties and disclaimers.** We provide the service with reasonable skill and care. Except as expressly stated, the service is provided "as is", and we exclude implied warranties to the extent permitted. Nothing excludes liability that cannot be excluded under the Consumer Protection Act 2019 where you are a consumer [LAW].
>
> **13. Limitation of liability.** To the extent permitted by law, neither party is liable for indirect, consequential or punitive loss, loss of profit or data (other than data we are contracted to safeguard), and our aggregate liability is capped at {{liability_cap}}. The cap does not apply to death or personal injury caused by negligence, fraud, wilful misconduct, breach of confidentiality or data-protection obligations to the extent the law does not permit a cap **[COUNSEL]**.
>
> **14. Indemnity.** You indemnify us against third-party claims arising from your content or your unlawful use. We indemnify you against third-party claims that the service, used as permitted, infringes Indian intellectual property rights, subject to notice, control of defence and mitigation.
>
> **15. Confidentiality.** Each party protects the other's confidential information with reasonable care and uses it only for this agreement. Disclosure compelled by law is permitted with notice where lawful.
>
> **16. Governing law and dispute resolution.** Indian law governs. Courts at {{governing_law_city}} have exclusive jurisdiction, subject to this clause. Before any claim, the parties will attempt resolution through the Grievance Redressal Policy. Either party may then refer the dispute to online mediation administered by {{odr_provider_name}} under its rules ({{odr_rules_url}}) [Option A: mandatory step; Option B: optional]. Unresolved disputes [Option A: are referred to arbitration by a sole arbitrator seated at {{arbitration_seat}} under the Arbitration and Conciliation Act 1996, conducted online under the {{odr_provider_name}} Arbitration Rules; language English | Option B: may be brought in the courts named above]. Nothing prevents a consumer from approaching a consumer commission under the Consumer Protection Act 2019 or a regulator's ombudsman [LAW] **[COUNSEL: enforceability of pre-dispute arbitration against consumers; where EQ is the ODR provider, disclose that it is a group company and that neutrals are independent]**.
>
> **17. Notices.** To us: {{support_email}} and {{registered_office}}. To you: your account email and in-app notices.
>
> **18. General.** Entire agreement; severability; no waiver; assignment only with consent except to an affiliate or successor; force majeure; electronic records and signatures are valid (IT Act 2000 s.4, s.5, s.10A [LAW]); English version prevails; we publish prior versions.

**Product-specific inserts (`{{professional_boundary}}` and extras).**

| Product | Boundary text (draft) | Extra clauses |
|---|---|---|
| LD | "LawDocs is a technology platform. It is not a law firm and does not practise law. Advocates who offer services through LawDocs are independent; your engagement is with them." | Marketplace clause referencing Template 14; eSign terms; stamp duty pass-through |
| LDC | "LawDocsComply provides compliance-management software and curated regulatory information. It does not provide legal, secretarial or audit opinions." | Customer remains responsible for filings; regulatory-change feed accuracy disclaimer with correction commitment |
| EQ | "Equator Resolution administers dispute-resolution proceedings under its Rules. Neutrals are independent. Equator does not represent any party." | Rules, Procedures & Fees incorporated; confidentiality; recording consent; enforceability note |
| FBX | "Finbyx provides loan origination and management software to regulated lenders. It is not a lender and does not take credit decisions." | Enterprise order-form precedence; data-processor role; RBI outsourcing clauses via DPA |
| UDF | "Udofin is a Lending Service Provider for the regulated lenders listed at {{lending_partners_url}}. The loan agreement is between you and the lender. Udofin does not lend." | KFS, cooling-off period, grievance officer of lender and LSP, no auto-increase of credit limit, RBI Digital Lending Directions 2025 references [LAW; VERIFY paras] |
| OH | Internal and group services; customer-facing terms apply to the group website only | Group-site terms minimal; vendor portal terms separate |

**Review checklist.** ☐ Boundary clause approved by counsel per product ☐ Liability cap position set [OWNER] ☐ Consumer carve-outs present ☐ Arbitration/ODR option chosen; group-company disclosure present ☐ Export period matches product (≥30 days) ☐ Cure period for non-payment ≥7 days ☐ No clause conflicts with Refund Policy ☐ Hindi summary ☐ Version/notice days configured.

---

### Template 3 — Payment & Subscription Terms

**Purpose.** Gateway-suitable commercial terms for online purchase of plans, credits and pass-through fees; what Razorpay/PayU/Cashfree/Stripe reviewers and the RBI e-mandate framework expect. **Where displayed.** Footer; pricing page (above the fold); plan selection; checkout; invoice footer link. **Extra parameters.** `{{gateway_names}}`, `{{emandate_enabled}}`, `{{credits_expiry_months}}`, `{{dunning_days}}` (e.g., 3, 7, 14), `{{grace_days}}`.

**Template text.**

> # Payment & Subscription Terms — {{product_name}}
> Version {{version_label}} · Effective {{effective_date}}
>
> **1. Who you pay.** Plans for {{product_name}} are sold and invoiced by {{selling_entity_name}} (CIN {{selling_entity_cin}}, GSTIN {{selling_entity_gstin}}, {{selling_entity_address}}) ("Seller"), the merchant of record. {{#if selling_entity_differs}}The Seller is a group company of {{entity_name}}, which operates the service.{{/if}} Your statement will show "{{selling_entity_short}}".
>
> **2. Prices and taxes.** Prices are shown in {{currency_list}}. For customers in India prices are shown [exclusive of GST with the applicable rate stated beside each price | inclusive of GST] and the total payable including GST is shown before you confirm payment. GST is charged at the rate in force (currently 18% on information technology and SaaS services under the CGST Act 2017 and the rate notifications [LAW; VERIFY rate for each SAC code used]). Provide your GSTIN to receive a tax invoice with input credit details. Prices may change; changes apply to existing subscriptions only from the next renewal after at least {{renewal_notice_days}} days' notice.
>
> **3. No hidden charges.** All mandatory fees are shown on the pricing page and at checkout before payment. Optional add-ons are never pre-selected. Pass-through statutory fees (stamp duty, government filing fees, eSign charges) are displayed as separate line items at cost before you confirm.
>
> **4. Billing cycles and renewal.** Plans bill {{billing_cycles}} in advance. Subscriptions renew automatically for the same term unless you cancel before the renewal date. We send a renewal reminder at least {{renewal_notice_days}} days before each renewal showing the amount, date and how to cancel. You can cancel in Settings › Billing in as few steps as it took to subscribe.
>
> **5. Free trials.** Trials last {{trial_days}} days where offered. {{#if trial_auto_convert}}We tell you at sign-up that the trial converts to a paid plan at the end, send a reminder {{renewal_notice_days}} days before, and you may cancel before conversion at no charge.{{else}}Your trial does not convert to a paid plan unless you expressly choose a plan and authorise payment. At the end of the trial your account moves to read-only with export available for 30 days.{{/if}} We do not collect payment details for a trial unless we say so clearly before you start.
>
> **6. Recurring payments and e-mandates (India).** Where you authorise recurring card or UPI payments, we and our payment gateway follow the Reserve Bank of India framework for e-mandates on recurring transactions: additional factor of authentication at registration; a pre-debit notification at least 24 hours before each debit with the amount and date; a simple way to pause, modify or cancel the mandate; and additional authentication for any debit above the limit the RBI permits without it [LAW: RBI circular DPSS.CO.PD.No.447/02.14.003/2019-20 dated 21 August 2019 and subsequent circulars; VERIFY current AFA-exempt limit and categories]. UPI Autopay mandates follow NPCI rules [VERIFY]. We never store your card number; the gateway tokenises it under RBI card-on-file tokenisation rules [LAW; VERIFY circular].
>
> **7. Payment methods and gateways.** Payments are processed by {{gateway_names}}, RBI-authorised payment aggregators (or, for international payments, Stripe). We use hosted or tokenised checkout only; your card data never touches our servers (PCI DSS SAQ A). Accepted methods are shown at checkout.
>
> **8. Failed payments and dunning.** If a payment fails we retry and notify you on days {{dunning_days}}. Your service continues for a grace period of {{grace_days}} days. After that, paid features are suspended (read-only with export) until payment; we do not delete your data for non-payment before the Retention Schedule period for suspended accounts. Reactivation restores the same plan.
>
> **9. Invoices and credit notes.** A GST-compliant tax invoice (CGST Act 2017 s.31; CGST Rules r.46 [LAW]) is issued for every charge and available in Settings › Billing; credit notes are issued for refunds and adjustments (s.34). E-invoicing applies where the Seller's turnover requires it [VERIFY threshold].
>
> **10. Currency and international payments.** Customers outside India may be charged in USD or other listed currencies; your bank may apply conversion charges. Export-of-services treatment for GST and FEMA compliance (purpose codes, FIRC) is handled by the Seller [LAW; VERIFY].
>
> **11. Chargebacks and disputes.** Contact {{support_email}} before raising a chargeback; most issues resolve within {{refund_timeline_days_max}} working days. We respond to gateway disputes with transaction records. A chargeback found to be without basis may lead to suspension until resolved.
>
> **12. Credits and prepaid usage.** Prepaid credits (where offered) expire {{credits_expiry_months}} months after purchase unless the law or the plan says otherwise, are non-transferable, and are refundable only as the Refund & Cancellation Policy states.
>
> **13. Refunds and cancellation.** See the Refund & Cancellation Policy, which forms part of these terms.
>
> **14. Changes.** Material changes take effect after {{renewal_notice_days}} days' notice and never mid-term for a prepaid period without your consent.
>
> **15. Contact.** Billing queries: {{support_email}}, {{support_phone}} ({{support_hours}}). Grievances: see Grievance Redressal Policy.

**Product inserts.**

| Product | Insert |
|---|---|
| LD | Stamp duty, eSign and government fee pass-through; per-document pricing; advocate fee escrow (if marketplace) is held per Template 14, not as our revenue |
| LDC | Seat-based and entity-based pricing; add-on regulatory feeds; enterprise invoicing on PO |
| EQ | Case filing fees, administrative fees and neutral fees per the Fee Schedule; split between parties; refund of neutral fees per Rules; fees are not contingent on outcome |
| FBX | Enterprise subscription with implementation fees; invoiced on order form; usage tiers (loan accounts) |
| UDF | Udofin charges no fee to borrowers unless stated in the KFS; any platform fee is disclosed in the KFS and APR [LAW: RBI Digital Lending Directions 2025; VERIFY]; e-mandate for EMI repayment is between you and the lender |
| OH | Group selling entity table maintained in OH8; this template is the master for all products |

**Review checklist.** ☐ Selling entity and GST registration verified ☐ SAC codes and GST rate confirmed by tax adviser ☐ GST display mode matches IPB-04-35 ☐ Trial conversion position matches product policy [OWNER] ☐ E-mandate clause matches current RBI limits [VERIFY] ☐ Dunning days and grace match billing engine configuration in OH8 ☐ Gateway names match live adapters ☐ No drip-pricing wording ☐ Invoice format tested ☐ Links from pricing and checkout present (IPB-04-39).

---

### Template 4 — Refund & Cancellation Policy

**Purpose.** Consumer-clear statement of cancellation and refunds; a gateway onboarding requirement. **Where displayed.** Footer; pricing page; checkout; cancellation flow. **Extra parameters.** `{{refund_rule}}` (`prorated` | `none_after_window` | `full_within_window`), `{{refund_window_days}}`, `{{nonrefundable_items}}`.

**Template text.**

> # Refund & Cancellation Policy — {{product_name}}
> Version {{version_label}} · Effective {{effective_date}}
>
> **1. Cancelling is as easy as signing up.** Cancel any time at Settings › Billing › Cancel, or by email to {{support_email}}. No phone call, retention screen or hidden step is required. Cancellation stops future renewals; you keep access until the end of the paid period unless you request immediate closure.
>
> **2. Refund windows.** {{#if refund_rule == "full_within_window"}}If you cancel within {{refund_window_days}} days of a first purchase or renewal, we refund the full amount.{{/if}}{{#if refund_rule == "prorated"}}If you cancel a plan, we refund the unused whole months (annual plans) or the unused portion from the next billing date (monthly plans) on a pro-rata basis.{{/if}}{{#if refund_rule == "none_after_window"}}Refunds are available within {{refund_window_days}} days of first purchase. After that, fees for the current period are non-refundable; cancellation stops future charges.{{/if}} Plan-specific rules are shown on the pricing page beside each plan and prevail where stricter in your favour.
>
> **3. Non-refundable items.** Statutory fees paid to third parties on your behalf (stamp duty, government filing fees, court or tribunal fees), eSign and notarisation charges, completed professional services, used prepaid credits, and {{nonrefundable_items}}. Where a statutory fee is itself refundable by the authority, we assist you in applying.
>
> **4. Service failure.** If we fail to meet an SLA commitment or a material feature is unavailable for a prolonged period, you may claim service credits under the SLA or, where the failure is material and uncured for 30 days, terminate and receive a pro-rata refund of prepaid fees.
>
> **5. Mistaken or duplicate payments.** Report within 30 days; we refund in full after verification.
>
> **6. How and when we refund.** Approved refunds are issued to the original payment instrument within {{refund_timeline_days_min}}–{{refund_timeline_days_max}} working days of approval. Your bank or card issuer may take additional time to show the credit. We issue a credit note for every refund. We do not refund to a different instrument except where the original is closed, on verification.
>
> **7. Trials.** No charge is made during a trial; trial-to-paid conversion rules are in the Payment & Subscription Terms.
>
> **8. Consumer rights.** Nothing in this policy limits your rights under the Consumer Protection Act 2019 or any regulator's rules [LAW].
>
> **9. Contact.** {{support_email}}, {{support_phone}}. Unresolved refund complaints go to the Grievance Officer: {{grievance_officer}}, {{grievance_email}}.

**Product inserts.**

| Product | Insert |
|---|---|
| LD | Document drafts started by an advocate are non-refundable after acceptance; templates are refundable within {{refund_window_days}} days if not downloaded [OWNER] |
| LDC | Enterprise contracts: refund per order form; self-serve plans per this policy |
| EQ | Filing and administrative fees per Fee Schedule: administrative fee non-refundable once the case is registered; neutral fees refundable for sessions not held; see Rules [COUNSEL] |
| FBX | Enterprise only; termination assistance and pro-rata per order form |
| UDF | Loan amounts, interest and lender charges are governed by the loan agreement and KFS; cooling-off period right to exit by repaying principal and proportionate APR without penalty [LAW: RBI Digital Lending Directions 2025; VERIFY para]; platform charges, if any, refundable within cooling-off |
| OH | Group master; selling entity's finance team processes refunds within the stated window |

**Review checklist.** ☐ Refund rule set per plan [OWNER] ☐ Timeline 5–7 working days achievable with gateway refund API ☐ Non-refundable list accurate ☐ Cooling-off text (UDF) verified ☐ Cancellation flow tested for step parity with sign-up ☐ Credit-note process confirmed with finance.

---

### Template 5 — Cookie Policy

**Purpose.** Disclosure of cookies and similar technologies, categories, vendors and durations; shared data source with the CMP (IPB-04-76). **Where displayed.** Footer; CMP preference centre; Privacy Notice link. **Extra parameters.** `{{cookie_table}}` generated from the CMP vendor registry.

**Template text.**

> # Cookie Policy — {{product_name}}
> Version {{version_label}} · Effective {{effective_date}} · [Open cookie settings]
>
> **1. What cookies are.** Small files or similar identifiers (local storage, pixels, SDK identifiers) placed on your device.
>
> **2. How we ask.** On your first visit to {{domain}} we show a banner with Accept all, Reject all and Manage of equal prominence. We set no non-essential cookie before you choose. Closing the banner without choosing means Reject. We honour the Global Privacy Control browser signal. You can change your choice at any time from the Cookie settings link in the footer. Your choice is recorded with a receipt identifier so we can prove what you agreed to.
>
> **3. Categories.** *Necessary* — needed for the site and app to work (session, security, consent record, load balancing); cannot be switched off. *Functional* — remember preferences (language, currency, video click-to-load). *Analytics* — help us understand use of the site; {{analytics_adapter_names}}; on logged-in pages we use only first-party analytics. *Marketing* — measure and target campaigns on third-party platforms; never used on logged-in or sensitive pages.
>
> **4. Cookies we use.** {{cookie_table}} — columns: Name · Provider · Category · Purpose · Duration · First/third party. (Generated from the consent registry; the policy and the banner always match.)
>
> **5. Third-party content.** Embedded videos and maps load only after you click and, where needed, consent. Once loaded, the provider's own policy applies (we use privacy-enhanced modes where available).
>
> **6. Mobile apps.** The {{product_name}} app uses device identifiers only for security, crash reporting and, with consent, first-party analytics. No advertising SDKs are included [product insert].
>
> **7. Changes.** We update this policy when our cookies change; the banner re-asks when a change is material.
>
> **8. Contact.** {{dpo_email}}.

**Product inserts.** UDF/FBX: statement that no advertising or third-party analytics SDK runs in the lending app and that device access is limited to camera (KYC), microphone (video KYC), location (one-time, KYC/fraud) per RBI Digital Lending Directions 2025 [LAW; VERIFY]. EQ: hearing-room cookies (necessary) and recording consent. LD/LDC/OH: none beyond standard.

**Review checklist.** ☐ Table generated, not typed ☐ Every third-party in the table has a DPA or terms reference ☐ Durations verified ☐ GPC statement true in code (IPB-04-77) ☐ Mobile SDK inventory matches app build (SBOM) ☐ Settings link works.

---

### Template 6 — AI Use & Transparency Policy

**Purpose.** Disclose how {{ai_display_name}} (Vidhi AI kernel, IPB-D-03) and other AI features work, their limits, and user controls; satisfy the IT Rules 2021 synthetic-media labelling amendment (notified 10 February 2026, effective 20 February 2026 per `R_Standards_Quick_Reference.md` §A [VERIFY rule numbering]) and align to ISO/IEC 42001 transparency expectations [REC]. **Where displayed.** Footer; first use of any AI feature (inline summary with link); Settings › AI & Vidhi. **Extra parameters.** `{{ai_features_table}}`, `{{llm_providers}}`, `{{human_review_list}}`.

**Template text.**

> # AI Use & Transparency Policy — {{product_name}}
> Version {{version_label}} · Effective {{effective_date}}
>
> **1. Our AI assistant.** {{product_name}} includes an AI assistant called {{ai_display_name}} (built on the Infrabyx "Vidhi AI" system). It drafts, summarises, classifies, extracts and suggests. It does not decide. Every action with external or irreversible effect requires a human to confirm it.
>
> **2. Where AI is used.** {{ai_features_table}} — columns: Feature · What it does · Data it uses · Human review required · How to opt out.
>
> **3. Labelling.** Content produced or materially altered by AI is labelled "AI-generated — review before use", carries the generation date and the model family, and, for images, audio and video, carries visible and embedded provenance markers as required for synthetically generated information under the IT Rules 2021 as amended in 2026 [LAW; VERIFY]. We do not remove such labels and you must not remove them when sharing within the platform.
>
> **4. Limits.** AI outputs may be wrong, outdated or incomplete. They may cite law that has changed. They are not legal, financial, tax or medical advice and do not replace a qualified professional. {{product insert: reserved activities}}.
>
> **5. Human review.** The following always require a qualified human's approval before use: {{human_review_list}} (for example filings, notices, legal documents sent to third parties, credit decisions, settlement terms, regulatory submissions).
>
> **6. Your data and AI.** Your content is processed by AI providers only to produce the output you asked for. We contractually require zero retention and no training on your data. We do not use your content to train our or anyone's models. Regulated and confidential data classes are processed only on India-resident endpoints; if none is available the feature fails closed rather than sending data abroad.
>
> **7. Providers.** We use multiple model providers ({{llm_providers}}) through a routing layer; the provider for each run is shown in the output's details panel. The list is updated here and at {{sub_processor_list_url}}.
>
> **8. Automated decisions.** We do not make decisions that produce legal or similarly significant effects about you solely by automated processing. Where AI assists a decision (for example flagging a document for review), a human makes the decision and you may ask for an explanation and a review.
>
> **9. Opt-out and controls.** You may turn off AI features at Settings › AI & Vidhi (organisation administrators may do so for all users). Some features are then unavailable. You may delete AI run history from Settings; audit copies required by law are retained per the Retention Schedule.
>
> **10. Agents.** Where {{ai_display_name}} runs multi-step tasks ("missions"), each step is logged, visible to you, and bounded by autonomy limits set by your administrator. Agents cannot approve, sign or pay.
>
> **11. Misuse.** You may not use AI features to generate unlawful, deceptive, defamatory or infringing content, to impersonate, or to produce unlabelled synthetic media. See the Acceptable Use Policy.
>
> **12. Feedback and incidents.** Report harmful or incorrect outputs through the in-app feedback control; we review and may suspend a feature. Serious incidents are handled under our incident process and reported where the law requires.
>
> **13. Contact.** {{dpo_email}}.

**Product inserts.**

| Product | Reserved-activity statement | Human-review list examples |
|---|---|---|
| LD | AI does not give legal advice or appear for you; drafts are reviewed by you or your advocate | Notices, petitions, agreements for signature, eSign requests |
| LDC | AI does not certify compliance or file with regulators | Filings, board minutes, compliance certificates |
| EQ | AI does not act as mediator, arbitrator or decide any dispute; neutrals may use AI for summaries only with party disclosure | Settlement drafts, awards (never AI-authored), hearing summaries sent to parties |
| FBX | AI does not take credit decisions; model-assisted scoring is explainable and reviewed by the lender's credit officer under its board-approved policy | Sanction, rejection, repossession notices, regulatory returns |
| UDF | AI does not approve or price loans; chatbot answers are informational | Any communication affecting loan terms; collections messages |
| OH | Internal staff tooling; customer-facing only via support drafts, which staff approve | Outbound support replies, offers, HR letters |

**Review checklist.** ☐ Feature table matches shipped features ☐ Provider list matches `LLM_PORT` configuration ☐ Zero-retention contracts on file for every provider ☐ Labelling implementation verified (IPB-03) ☐ Human-review list matches the product's locked approval list ☐ Synthetic-media provenance metadata tested ☐ Opt-out control exists.

---

### Template 7 — Grievance Redressal Policy

**Purpose.** Publish the grievance mechanism and officer required by IT Rules 2021 r.3(2) and r.4(1)(c) (where applicable) [LAW], DPDP Act s.13 [LAW], Consumer Protection (E-Commerce) Rules 2020 r.4(4)–(5) where a product is an e-commerce entity [LAW; INTERP], RBI Digital Lending Directions 2025 (UDF, lenders via FBX) [LAW] and sector ombudsman references. **Where displayed.** Footer officers line; `/grievance`; Settings › Tutorials & help; every notice email footer. **Extra parameters.** `{{ack_hours}}` (default 48; 24 for intermediary complaints), `{{resolve_days}}` (default 30; 15 for IT Rules complaints), `{{escalation_table}}`.

**Template text.**

> # Grievance Redressal Policy — {{product_name}}
> Version {{version_label}} · Effective {{effective_date}}
>
> **1. Grievance Officer.** {{grievance_officer}}, {{grievance_email}}, {{grievance_phone}}, {{grievance_address}}. Hours: {{support_hours}}. {{#if nodal_officer}}Principal Nodal Officer (regulated services): {{nodal_officer}}.{{/if}}
>
> **2. How to complain.** In-app: Help › Raise a grievance (gives you a reference number); web form at {{domain}}/grievance; email; post. Include your account email, what happened, when, and what outcome you seek. You may complain about content, privacy, service, billing, accessibility or conduct.
>
> **3. Timelines.** We acknowledge within {{ack_hours}} hours with a reference number. We resolve within {{resolve_days}} days. Where the law sets a shorter time we follow it: complaints about unlawful content as an intermediary are acknowledged within 24 hours and disposed of within 15 days; certain classes of content are removed within 72 hours or, for unlawful synthetically generated content, within 3 hours of a complaint or order [LAW: IT Rules 2021 r.3(2)(a)–(b) as amended; VERIFY current text and the 2026 amendment]. Data-principal requests under the DPDP Act are answered within the period the Rules prescribe [VERIFY r.13/14 period once in force; default 30 days]. Lending grievances (Udofin and lender services) are resolved within 30 days, after which you may approach the RBI Integrated Ombudsman [LAW: RBI Integrated Ombudsman Scheme 2021; VERIFY].
>
> **4. Escalation.** If you are not satisfied: (a) ask for review by {{escalation_officer}} within 7 days; (b) use mediation through {{odr_provider_name}} at no cost to you for consumer disputes [OWNER]; (c) approach the external bodies in the table below. {{escalation_table}}.
>
> **5. Records.** We keep a register of grievances, actions and outcomes and report aggregate numbers in our Transparency Report. Personal data in complaints is processed under the Privacy Notice.
>
> **6. No retaliation.** Making a complaint in good faith will never affect your service.

**Product inserts (`{{escalation_table}}`).**

| Product | External escalation |
|---|---|
| LD | Bar Council of the relevant State for advocate conduct; Consumer Commission (Consumer Protection Act 2019); Data Protection Board of India |
| LDC | Consumer Commission; Data Protection Board |
| EQ | Appeals as the Rules provide; Mediation Council of India once functional [VERIFY]; courts under the Arbitration and Conciliation Act 1996; Data Protection Board |
| FBX | The lender's grievance officer and RBI Integrated Ombudsman (for borrowers); Data Protection Board |
| UDF | Lender's grievance officer → RBI Integrated Ombudsman / RBI CMS portal; Sachet portal for unregistered lending reports [VERIFY URLs]; Data Protection Board |
| OH | Group grievance officer; Data Protection Board |

**Review checklist.** ☐ Officer appointed by board resolution and named consistently across footer, policy and MCA filings where applicable ☐ Timelines match ticketing SLAs in OH support ☐ Regulator references current ☐ Reference-number generation tested ☐ Hindi version ☐ Transparency report cadence set.

---

### Template 8 — Acceptable Use Policy

**Purpose.** Define prohibited conduct, mapped to IT Rules 2021 r.3(1)(b) categories [LAW], and our enforcement steps. **Where displayed.** Footer; sign-up (linked); content editors. **Extra parameters.** `{{rate_limits_url}}`, `{{api_terms_url}}`.

**Template text (headings with binding content).**

> **1. Prohibited content.** Content that belongs to another person without right; is defamatory, obscene, pornographic, paedophilic, invasive of privacy including bodily privacy, insulting or harassing on the basis of gender, racially or ethnically objectionable, relating to or encouraging money laundering or gambling, or otherwise unlawful; harmful to children; infringes any patent, trade mark, copyright or other proprietary right; deceives or misleads about the origin of a message or communicates information that is patently false or misleading and is published to cause injury; impersonates another; threatens the unity, integrity, defence, security or sovereignty of India, friendly relations with foreign States, or public order, or incites an offence; contains software viruses or malicious code; or is patently false and untrue and published to mislead or harass for financial gain or injury (IT Rules 2021 r.3(1)(b)(i)–(xi) [LAW; VERIFY current list]). **2. Prohibited conduct.** Unauthorised access, credential sharing beyond licence, scraping beyond published API limits ({{rate_limits_url}}), security testing outside the Responsible Disclosure Policy, circumventing usage limits, reselling without a reseller agreement, using the service to provide a competing service, sending unsolicited commercial messages, removing AI labels, uploading unlabelled synthetic media, processing data you have no right to process, or using the service for a purpose that violates sanctions or export laws. **3. Regulated-use limits.** {{product insert}}. **4. Enforcement.** Warning; content removal; feature restriction; suspension; termination; referral to law enforcement. We notify you with reasons and a route to the Grievance Officer except where notice is prohibited or would frustrate an investigation. Content removal timelines follow the Grievance Redressal Policy. **5. Reporting.** Report abuse at {{grievance_email}} or in-app.

**Product inserts.** LD: no unauthorised practice of law; no advertising by advocates in breach of BCI Rule 36 [LAW]. LDC: no filing of knowingly false regulatory information. EQ: no recording or sharing of hearings without consent; no contact with neutrals outside the platform; no tampering with evidence. FBX/UDF: no use for unlicensed lending; no harassment in collections; collections conduct per RBI Fair Practices Code [LAW; VERIFY reference]. OH: staff conduct per HR policy.

**Review checklist.** ☐ Rule 3(1)(b) list verbatim-checked ☐ Enforcement ladder matches product moderation tooling ☐ Collections conduct text (UDF/FBX) reviewed by counsel.

---

### Template 9 — Data Retention & Deletion Schedule

**Purpose.** Publish retention periods per record type to satisfy DPDP Act s.8(7) and the Privacy Notice reference; drive automated deletion jobs. **Where displayed.** Footer (under Privacy); Privacy Notice clause 9; Trust Centre; DPA annex. **Extra parameters.** `{{schedule_table}}` from the registered retention registry.

**Template text.**

> # Data Retention & Deletion Schedule — {{product_name}}
> Version {{version_label}} · Effective {{effective_date}}
>
> **1. Principle.** We keep personal data only as long as needed for the stated purpose or as the law requires, then delete it securely and instruct processors to do the same. "Delete" means removal from live systems and backups within the backup rotation period stated below; cryptographic erasure is used for immutable storage.
>
> **2. Schedule.** {{schedule_table}} — binding columns: Record type · Legal/business basis · Retention trigger · Period · Deletion method · Exceptions. Baseline rows:
>
> | Record type | Basis | Trigger | Period | Method |
> |---|---|---|---|---|
> | Account profile | Contract | Account closure | 30 days export window, then delete; 90 days for billing linkage | Hard delete + processor instruction |
> | Authentication logs | Security; CERT-In Directions 2022 | Event | 180 days (India-resident) [LAW] | Rolling delete |
> | Audit ledger (hash-chained) | Legal duty, evidence | Event | 8 years (Companies Act 2013 s.128 books and records [LAW; INTERP as to applicability]) or product regulator period if longer | Object Lock then delete |
> | Tax invoices and payment records | CGST Act 2017 s.36 (72 months from annual return due date [LAW]) ; Income-tax Act 1961 s.44AA/Rule 6F [VERIFY] | Financial year end | 8 years | Archive then delete |
> | Consent ledger records | Proof of consent | Withdrawal/closure | Life of consent + 3 years [INTERP limitation period] | Delete |
> | Support tickets | Contract | Closure | 3 years | Delete |
> | Marketing leads (no customer relationship) | Consent | Last interaction | 24 months or withdrawal | Delete |
> | Website analytics (first-party) | Consent | Collection | 14 months aggregate; raw 90 days | Rolling delete |
> | Server logs (non-security) | Operations | Collection | 90 days | Rolling delete |
> | Backups | Resilience | Snapshot | 35 days rotation | Expire |
> | Job applications | Consent | Decision | 12 months (unsuccessful) | Delete |
> | Grievance register | Legal duty | Closure | 3 years (or regulator period) | Archive |
> | AI run logs (prompts/outputs) | Contract, audit | Run | 90 days user-visible; audit metadata per audit ledger row; provider zero-retention | Delete |
> | Inactive account data | DPDP Rules 2025 r.8 / Third Schedule where applicable [VERIFY] | Last activity | Notice at least 48 hours before erasure; erase after 3 years of inactivity unless law requires otherwise | Delete |
>
> **3. Product-specific records.** {{product insert}}.
>
> **4. Legal hold.** Deletion is suspended for records subject to litigation, regulatory inquiry or a lawful request; the hold is logged and lifted when the reason ends.
>
> **5. Your requests.** Erasure requests under DPDP Act s.12 are honoured within the Grievance Redressal timeline unless a listed retention duty applies, in which case we tell you which.

**Product inserts.**

| Product | Rows to add |
|---|---|
| LD | Executed documents and eSign audit trails: duration of the document's limitation period + 3 years, or as the customer sets; eSign transaction logs per ESP/CCA rules [VERIFY] |
| LDC | Compliance evidence and filings: 8 years (Companies Act 2013 s.128) or statute-specific |
| EQ | Case records: per Rules; arbitration records per Arbitration and Conciliation Act 1996 and limitation for challenge (s.34: 3 months + 30 days) plus 3 years [INTERP]; recordings deleted 90 days after closure unless parties direct otherwise |
| FBX | Lender records as Processor: per lender instruction and RBI KYC Master Direction (5 years after relationship ends [LAW; VERIFY para]) ; audit trails per RBI IT Governance Direction 2023 |
| UDF | Borrower data as LSP: minimum necessary; deletion on loan closure plus period the lender instructs; KYC records 5 years [LAW; VERIFY]; device data not retained |
| OH | HR records per labour law (varies, 3–8 years [VERIFY]); vendor contracts 8 years after expiry |

**Review checklist.** ☐ Every row maps to an automated job or a documented manual process ☐ Statutory minima verified by counsel ☐ Backup rotation stated matches IPB-01 configuration ☐ Legal-hold tooling exists ☐ Processor deletion instructions in DPA annex.

---

### Template 10 — Accessibility Statement

**Purpose.** Statement under the Rights of Persons with Disabilities Act 2016 s.40 and s.46 and the RPwD Rules 2017 r.15 (ICT accessibility standards) [LAW; VERIFY], aligned to WCAG 2.2 AA, IS 17802 (Part 1: 2021, Part 2: 2022 [VERIFY]) and GIGW 3.0 (for government-facing deployments). **Where displayed.** Footer "Accessibility"; `/accessibility`; app Settings › Accessibility. **Extra parameters.** `{{conformance_status}}` (`fully` | `partially` | `not assessed`), `{{known_issues_table}}` (from the a11y backlog), `{{last_audit_date}}`, `{{audit_method}}`, `{{a11y_email}}`.

**Template text.**

> # Accessibility Statement — {{product_name}}
> Version {{version_label}} · Last reviewed {{last_reviewed}}
>
> **1. Commitment.** {{entity_name}} wants everyone to use {{product_name}}, including people who use assistive technology. We design to the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA, Indian Standard IS 17802 and, where deployed for government bodies, the Guidelines for Indian Government Websites (GIGW) 3.0. Our apps follow the platform accessibility guidelines of iOS and Android.
>
> **2. Conformance status.** {{product_name}} web ({{domain}}, {{app_url}}) is {{conformance_status}} conformant with WCAG 2.2 AA as at {{last_audit_date}}, assessed by {{audit_method}} (automated testing with axe-core on every build, manual testing with NVDA/Firefox, JAWS/Chrome, VoiceOver/Safari and TalkBack, keyboard-only testing, 200% zoom, high-contrast and reduced-motion modes).
>
> **3. What we do.** Keyboard access to every function; visible focus; skip links; text alternatives for images; captions (English and Hindi) for every video and transcripts; colour contrast of at least 4.5:1 enforced by our design tooling; resizable text; no time limits without extension; error messages in text; consistent navigation; language tags; accessible PDFs or an accessible alternative on request; Indian Sign Language renditions for selected videos.
>
> **4. Known limitations.** {{known_issues_table}} — columns: Area · Issue · WCAG criterion · Workaround · Target fix date. Third-party content (payment gateway pages, embedded videos, maps) may not fully conform; we choose vendors that commit to accessibility and provide alternatives.
>
> **5. Feedback and requests.** Email {{a11y_email}} or use the "Report a problem" control on any page (works without JavaScript). We acknowledge within 2 working days and aim to fix or provide an alternative within 10 working days. For documents, ask for an accessible format and we will provide one free of charge.
>
> **6. Enforcement.** If you are not satisfied, use the Grievance Redressal Policy. You may also approach the Chief Commissioner for Persons with Disabilities or the State Commissioner under the RPwD Act 2016 [LAW].
>
> **7. Technical.** Relies on HTML, WAI-ARIA, CSS, JavaScript (progressive enhancement; core content works without it), WebVTT. Tested on current versions of major browsers and screen readers.

**Product inserts.** EQ: hearing-room accessibility (live captions, ISL interpreter slot, document reading order); FBX/UDF: statement on accessible KFS and voice guidance in the app; LD: eSign flow accessibility and alternative signing route; LDC/OH: none beyond baseline.

**Review checklist.** ☐ Known-issues table generated from backlog, dated ☐ Audit date within 6 months ☐ Contact monitored ☐ Claims match axe/CI results (no over-claiming) ☐ Hindi version.

---

### Template 11 — Security & Responsible Disclosure (VDP)

**Purpose.** Invite good-faith security research, promise safe harbour, publish `security.txt` (RFC 9116 [REC]), and summarise our security posture without over-claiming. **Where displayed.** Footer; Trust Centre; `/.well-known/security.txt`; `/security`. **Extra parameters.** `{{pgp_key_url}}`, `{{scope_list}}`, `{{out_of_scope_list}}`, `{{bounty}}` (`none` | `discretionary` | `programme_url`), `{{certifications_held}}` (from IPB-08 registry).

**Template text.**

> # Security & Responsible Disclosure — {{product_name}}
> **1. Our posture.** We follow OWASP ASVS 5.0 Level 2 (Level 3 for authentication and payments), encrypt data in transit (TLS 1.2+) and at rest, enforce MFA for administrators, log and monitor access, test our code and dependencies on every build, and run independent penetration tests at least annually. Certifications and audit reports we actually hold are listed in the Trust Centre with issuer, scope and validity: {{certifications_held}}. We do not claim certifications we do not hold.
> **2. Reporting a vulnerability.** Email {{security_email}} (PGP: {{pgp_key_url}}) or use the form at {{domain}}/security/report. Include steps to reproduce, affected URL or component, and impact. We acknowledge within 2 working days, give an initial assessment within 7 days, and keep you informed until resolution. Critical issues are triaged within 24 hours.
> **3. Scope.** {{scope_list}} (our domains and apps). Out of scope: {{out_of_scope_list}} (third-party services, social engineering, physical attacks, denial of service, rate-limit findings without impact, best-practice findings without a demonstrated vulnerability).
> **4. Rules of engagement.** Do not access, modify or exfiltrate data that is not yours; use test accounts; stop and report at the first sign of personal data exposure; no automated scanning that degrades service; no public disclosure before we fix or 90 days pass, whichever is earlier, unless we agree otherwise.
> **5. Safe harbour.** If you follow these rules we will not pursue civil action or a complaint under the IT Act 2000 (including s.43 and s.66) and will not report you to law enforcement for your research; we will support you if a third party does **[COUNSEL: wording; Indian law has no statutory safe harbour — this is a contractual undertaking]**. We will credit you in our acknowledgements if you wish.
> **6. Rewards.** {{bounty}}.
> **7. Incidents.** We report cyber incidents to CERT-In within six hours of noticing them (CERT-In Directions, 28 April 2022 [LAW]), notify affected users and the Data Protection Board as the DPDP framework requires, and publish a post-incident summary in the Trust Centre where appropriate.
> **8. security.txt.** Canonical: https://{{domain}}/.well-known/security.txt — fields: Contact, Expires (≤ 1 year), Encryption, Acknowledgments, Preferred-Languages: en, hi, Canonical, Policy.

**Product inserts.** FBX/UDF: reference to RBI cyber-incident reporting to the lender's regulator through the lender; EQ: hearing-room integrity scope; LD: eSign provider scope exclusion.

**Review checklist.** ☐ security.txt served with correct Expires ☐ Mailbox monitored, PGP key valid ☐ Scope matches live hosts ☐ Certifications list from registry only ☐ Safe-harbour wording approved by counsel ☐ Bounty position set [OWNER].

---

### Template 12 — Blog & User-Generated Content Terms

**Purpose.** Govern user-authored posts, comments and submissions (IPB-04-47): licence, moderation, takedown, liability, no professional advice. **Where displayed.** UGC editor acceptance; footer (when UGC enabled); author profile. **Extra parameters.** `{{ugc_licence}}` (`non_exclusive_perpetual` default), `{{attribution_rule}}`, `{{moderation_sla_days}}`.

**Template text.**

> # Blog & User-Generated Content Terms — {{product_name}}
> **1. Eligibility.** You may submit posts if your account meets the eligibility shown in the editor. Submissions are reviewed before publication; we may decline without reasons where the law permits, and we tell you the decision within {{moderation_sla_days}} days.
> **2. Your content, your responsibility.** You confirm the content is yours or licensed to you, is accurate to your knowledge, does not infringe rights, is not defamatory, and complies with the Acceptable Use Policy and IT Rules 2021 r.3(1)(b) [LAW]. You must disclose conflicts of interest and any paid relationship. You must label AI-assisted writing where it is material and never submit unlabelled synthetic media.
> **3. Not professional advice.** Posts express the author's view. They are not legal, financial, tax or regulatory advice from {{entity_name}} or the author to any reader. We display an "Author's view" label and this notice on every user post. Authors who are advocates must comply with Bar Council of India Rules, Part VI, Chapter II, Rule 36 (restrictions on advertising and solicitation) [LAW]; posts that solicit work will be declined.
> **4. Licence.** You grant {{entity_name}} a {{ugc_licence}}, worldwide, royalty-free licence to publish, reproduce, adapt (for format, length and accessibility), translate, and distribute the content on {{domain}}, in our newsletters, feeds and social channels, with attribution per {{attribution_rule}}. You keep ownership and may republish elsewhere after publication with a canonical link to {{domain}}. You may ask us to unpublish at any time; copies in feeds, caches and archives may persist.
> **5. Moderation and edits.** We may edit for style, accessibility, legal compliance and accuracy of citations, and will show material edits to you before publication. We may add editor's notes, corrections and dates.
> **6. Takedown and complaints.** Anyone may complain about a post through the Grievance Redressal Policy. We may remove content on complaint, legal order or our own judgement, within the timelines that policy states, and will notify you with the reason and a route to respond. Repeated violations end eligibility.
> **7. Defamation and indemnity.** You indemnify {{entity_name}} against claims arising from your content. We may disclose your identity when lawfully required.
> **8. Comments.** Where comments are enabled, they are pre-moderated, must follow these Terms, and may be closed on any post.
> **9. Our role.** {{entity_name}} acts as an intermediary for user content under the IT Act 2000 s.79 and observes due diligence under the IT Rules 2021 [LAW; INTERP as to the platform's status for its own editorial content].

**Product inserts.** LD: BCI Rule 36 screening mandatory; LDC: no regulatory-filing instructions presented as official; EQ: no discussion of pending cases on the platform, confidentiality; FBX/UDF: no financial product promotion; collections-related content barred; OH: staff posts subject to HR social-media policy.

**Review checklist.** ☐ Licence scope agreed [OWNER] ☐ Advocate screening process defined ☐ Takedown SLA matches Template 7 ☐ "Author's view" label implemented (IPB-04-47) ☐ Terms version captured at acceptance.

---

### Template 13 — Resources Download Terms

**Purpose.** Licence and disclaimer for downloadable artefacts (IPB-04-59). **Where displayed.** Resource detail page (link); gate step; inside each PDF footer. **Extra parameters.** `{{resource_licence}}` (`personal_internal` default | `cc_by_nd` | `custom`).

**Template text.**

> **1. Licence.** Unless an item states a different licence, you may download, store and use the resource for your personal or internal business purposes, and share unmodified copies with attribution and a link to the source page. You may not sell it, remove notices, present it as your own, or use it to train AI models. Templates and checklists may be adapted for your own internal use. **2. Currency.** Each resource shows its version, date and review date. Law and regulation change; check the source page for the current version and do not rely on an item past its review date. **3. No advice.** Resources are general information, not legal, financial or regulatory advice. Seek professional advice for your situation. **4. Accuracy.** We take care but give no warranty of completeness; report errors to {{support_email}} and we will correct and re-version. **5. Gated items.** Where we ask for your name and email, we use them as the notice on the form states and under the Privacy Notice; marketing contact needs your separate, unticked consent. **6. Citation.** Cite as shown on the item page.

**Product inserts.** EQ: Rules, Procedures & Fees documents are binding institutional rules, not "resources" — label and link separately; UDF/FBX: KFS samples are illustrative and not an offer of credit.

**Review checklist.** ☐ Default licence set ☐ PDF footer injection tested ☐ Gate form notice matches Template 18.

---

### Template 14 — Marketplace / Professional Terms (outline)

**Purpose.** Where a product connects users with independent professionals (LD advocates and company secretaries; EQ neutrals), set the platform's role, listing rules and payment flow within professional-conduct constraints. **Where displayed.** Marketplace entry; professional onboarding; footer (where enabled). Full text is **[COUNSEL]**; the outline is binding on structure.

| Clause | Binding content |
|---|---|
| Platform role | {{entity_name}} is a technology intermediary; it does not provide professional services, does not guarantee outcomes, does not recommend one professional over another except by neutral, disclosed criteria (availability, area, language, user ratings with method) |
| Professional eligibility | Verified enrolment/registration (Bar Council enrolment number; ICSI membership; EQ panel criteria), undertaking to comply with professional rules, insurance where applicable [OWNER] |
| BCI Rule 36 constraints (LD) | No advertising or solicitation by advocates; profile limited to name, address, enrolment, areas of practice, professional qualifications and experience as permitted by the Rule 36 proviso [LAW]; no ratings or "top lawyer" badges for advocates **[COUNSEL]**; no fee-splitting with the platform (BCI Rules Part VI Ch. II r.2 [VERIFY]) — platform fee is a technology fee paid by the client or a subscription paid by the professional, never a share of professional fees |
| Engagement | Engagement letter between client and professional generated in-platform; platform is not party; conflict-check attestation |
| Fees and escrow | Client fees held in a nodal/escrow arrangement compliant with RBI payment-aggregator rules [LAW; VERIFY]; release on milestones; disputes via Grievance Policy then ODR |
| Confidentiality and privilege | Platform access to matter content only on instruction or abuse investigation; privilege preserved; professionals bound by their own duties |
| Reviews | Verified-client reviews only, moderated, no incentives; for advocates, reviews disabled unless counsel confirms permissibility |
| Termination and delisting | Grounds, notice, appeal; immediate for professional misconduct findings |
| EQ neutrals | Code of Conduct, disclosure of conflicts, fee schedule, appointment procedure per Rules; neutrals are not employees; independence statement |

**Review checklist.** ☐ Counsel opinion on Rule 36 compliance on file ☐ Escrow structure approved ☐ No outcome guarantees anywhere on marketing pages (Claims lint word list updated).

---

### Template 15 — Data Processing Agreement (processor terms)

**Purpose.** Terms under which {{entity_name}} processes personal data on behalf of business customers (Data Fiduciaries) and, for regulated customers, satisfies RBI outsourcing requirements. **Where displayed.** Trust Centre (DPA request → signed copy); enterprise order forms; self-serve acceptance at organisation creation (`pol.dpa_clickwrap=true`). **Extra parameters.** `{{customer_name}}`, `{{sub_processor_list_url}}`, `{{audit_frequency}}`, `{{exit_assistance_days}}` (default 90), `{{regulated_customer}}` (bool), `{{rbi_entity_type}}`.

**Template text (clauses with binding content).**

> # Data Processing Agreement — {{product_name}}
> **1. Roles.** Customer is the Data Fiduciary (or Data Processor to its own principals); {{entity_name}} is the Data Processor (DPDP Act 2023 s.8(2): a Data Fiduciary may engage a Processor only under a valid contract [LAW]). Infrabyx group companies and listed sub-processors act as sub-processors.
> **2. Instructions.** We process personal data only on Customer's documented instructions, including through the product's settings and APIs, and as the law requires (with notice unless prohibited).
> **3. Confidentiality and personnel.** Staff bound by confidentiality; access on need-to-know with `product_scope` segregation; background checks per our HR policy.
> **4. Security.** Measures in Annex 2 (ASVS 5.0 L2/L3, encryption, MFA, logging, backups, Object Lock, vulnerability management, penetration testing annually, incident response). We maintain certifications listed in the Trust Centre and notify Customer of loss of any.
> **5. Sub-processors.** Current list at {{sub_processor_list_url}}. We give at least 30 days' notice of additions or replacements by email and Trust Centre subscription; Customer may object on reasonable data-protection grounds; if unresolved Customer may terminate the affected service with a pro-rata refund. Sub-processors are bound by equivalent terms; we remain liable for them.
> **6. Data Principal requests and assistance.** We forward requests received directly and assist Customer with access, correction, erasure, nomination and grievance obligations through product features or within 10 working days.
> **7. Personal data breach.** We notify Customer without undue delay and in any case within 24 hours of confirming a breach affecting its data, with the information needed for Customer's notification to the Data Protection Board and Data Principals (DPDP Act s.8(6); Rules r.7 [VERIFY]), followed by updates and a root-cause report within 72 hours where available. We report to CERT-In within 6 hours as the Directions require [LAW].
> **8. Audits.** Customer (or its appointed auditor, under confidentiality) may audit once in any 12 months ({{audit_frequency}}) on 30 days' notice, and after a breach. We provide SOC 2/ISO reports, penetration-test summaries and completed questionnaires through the Vendor Assurance Room first; on-site or remote audits where reports do not suffice. {{#if regulated_customer}}Customer's regulator (the Reserve Bank of India or other regulator) has the right to access our premises, systems, records and personnel relating to Customer's data and to conduct or commission audits, and we will co-operate at no additional charge [LAW: RBI (NBFC – Managing Risks in Outsourcing) Directions, 2025 and commercial-bank equivalent, 28 November 2025 — audit and access clauses; VERIFY paragraph numbers].{{/if}}
> **9. Location and transfers.** Data stored and processed in India (Mumbai; DR Hyderabad). Transfer outside India only with Customer's prior written approval and to permitted countries (DPDP Act s.16). {{#if regulated_customer}}Regulated data stays in India as the RBI requires; where any processing abroad is permitted, Customer's regulator retains access rights.{{/if}}
> **10. Business continuity.** Documented BCP/DR tested at least annually; RPO and RTO as the SLA states; results summarised in the Vendor Assurance Room. {{#if regulated_customer}}Aligned to ISO 22301 and RBI IT Governance Direction 2023 expectations [REC].{{/if}}
> **11. Sub-contracting chain and concentration.** We disclose material sub-contractors and their locations; we inform Customer of changes that could create concentration risk at Customer's level.
> **12. Return and deletion; exit assistance.** On termination Customer may export all data in `<PRODUCT>-EXPORT-1.0` format for {{exit_assistance_days}} days; we then delete and certify deletion within 30 days, except what the law requires us to keep (Retention Schedule). {{#if regulated_customer}}We provide reasonable exit assistance, including transition support, data migration and continued service for up to {{exit_assistance_days}} days, so that Customer's services to its own customers are not disrupted (RBI outsourcing exit-strategy requirements [LAW; VERIFY]).{{/if}}
> **13. Liability.** As in the main agreement; data-protection breaches are not excluded from liability to the extent the law requires.
> **14. Term.** Co-terminous with the service agreement; survives for data still held.
> **Annex 1** — Processing details (categories, purposes, data classes). **Annex 2** — Security measures. **Annex 3** — Sub-processors (generated). **Annex 4** — RBI outsourcing clauses (regulated customers): access for RE and regulator; confidentiality; sub-contracting approval; monitoring and reporting; BCP; exit; dispute resolution; India-law governing; no transfer of outsourced activity without consent.

**Product inserts.** FBX: Annex 4 mandatory for all NBFC/bank customers; UDF: DPA with each lending partner where Udofin is Processor and a separate data-sharing agreement where Udofin is Fiduciary [COUNSEL]; LD/LDC/EQ: standard DPA; EQ adds confidentiality of proceedings; OH: group intra-company processing agreement template.

**Review checklist.** ☐ Breach timelines consistent with the IPB-02 incident runbook ☐ Sub-processor notice automation live ☐ RBI annex paragraphs verified against the 28 Nov 2025 Directions ☐ Export format implemented ☐ Deletion certificate template exists ☐ Clickwrap flow captures signatory authority.

---

### Template 16 — Service Level Agreement (outline)

**Purpose.** Uptime and support commitments per plan tier, credits, exclusions. **Where displayed.** Pricing comparison; Trust Centre; order forms; Settings › Plans & subscription. **Parameters.** `{{tiers_table}}` from the catalogue (`BILLING_PORT`), `{{status_page_url}}`, `{{rpo_hours}}`, `{{rto_hours}}`.

| Element | Binding content |
|---|---|
| Measurement | Monthly uptime % = (minutes in month − downtime minutes) ÷ minutes in month, measured by our external monitoring published at {{status_page_url}}; downtime = core functions unavailable for all users of a region for ≥5 consecutive minutes |
| Tiers (defaults; catalogue prevails) | Free/Starter: no SLA, best effort · Business: 99.5% · Enterprise: 99.9% · Regulated Enterprise (FBX): 99.95% with RPO {{rpo_hours}} h and RTO {{rto_hours}} h |
| Credits | Business: 5% of monthly fee per 0.5% below target, cap 25%; Enterprise: 10% per 0.5%, cap 50%; claimed within 30 days; applied to next invoice; sole remedy for availability except termination right after three consecutive months of breach |
| Support | Response targets by severity (S1 15 min 24×7 for Enterprise; S2 1 h business hours; S3 1 business day; S4 3 business days); channels; Hindi and English |
| Maintenance | Scheduled windows announced ≥72 h ahead on the status page, outside 09:00–21:00 IST, excluded from downtime up to 4 h/month |
| Exclusions | Customer-caused; third-party services outside our control (payment gateways, eSign providers, telecom); force majeure; suspension under the Terms; beta features |
| Reporting | Monthly availability report in Settings and the Vendor Assurance Room; incident post-mortems for S1 within 5 business days |

**Review checklist.** ☐ Tier values pulled from the catalogue ☐ Monitoring independent of production ☐ Credit process in OH8 ☐ Status page public.

---

### Template 17 — Vendor / Outsourcing Assurance Statement

**Purpose.** Tell business customers what assurance documents we publish, on what cadence, and where — the public face of the Vendor Assurance Room (IPB-08; OH14.6 system of record). **Where displayed.** Trust Centre; DPA Annex; RFP responses. **Parameters.** `{{assurance_table}}` from the IPB-08 registry.

**Template text.**

> # Vendor Assurance Statement — {{product_name}}
> {{entity_name}} publishes the following to customers through the Vendor Assurance Room (Settings › Security & trust). Each document shows issuer, scope, period, and next-review date. We publish only documents we hold; items marked "planned" are not certifications.
>
> | Document | Cadence | Audience |
> |---|---|---|
> | ISO/IEC 27001:2022 certificate and Statement of Applicability summary | Annual (surveillance), on change | All customers |
> | SOC 2 Type II report (or bridge letter) | Annual; bridge letter quarterly | Under NDA |
> | Penetration test executive summary | Annual and after major release | All customers |
> | VAPT certificate (CERT-In empanelled auditor) | Annual [REC for regulated customers] | All customers |
> | Vulnerability management and patch statistics | Quarterly | All customers |
> | Business continuity and DR test summary | Annual | All customers |
> | Sub-processor list and change log | Continuous; notice 30 days | Public |
> | Data-flow and architecture overview | Half-yearly | Under NDA |
> | Insurance certificates (cyber, professional indemnity) | Annual | Under NDA |
> | Board-approved information security, outsourcing and AI policies (summaries) | Annual | All customers |
> | Financial standing summary (for RBI due diligence) | Annual | Regulated customers under NDA |
> | Transparency report (grievances, takedowns, law-enforcement requests, AI incidents) | Half-yearly | Public |
> | Accessibility audit report | Annual | Public summary |
> | SBOM / AIBOM for delivered software (CERT-In BOM guidelines v2.0, July 2025 [REC]) | Each release | Under NDA |
> | Completed standard questionnaires (CAIQ, SIG Lite) | Annual | Under NDA |
>
> Regulated customers may request additional documents required by their regulator; we respond within 10 working days. We notify customers of any material adverse change (certification loss, significant incident, change of control) within 5 working days.

**Review checklist.** ☐ Table matches IPB-08 registry ☐ No "planned" item displayed as held ☐ NDA flow works ☐ Cadence calendar in OH compliance calendar.

---

### Template 18 — Consent Manager and notice texts

**Purpose.** Short, specific notices and consent strings for forms, sign-up, WhatsApp opt-in, marketing, cookies, and data-principal rights; each is a versioned string in `cms.consent_text` so the consent ledger can record exactly what was shown (DPDP Act s.5 notice content: data and purpose, how to exercise rights, how to complain [LAW]). **Where displayed.** Inline at the point of capture. **Rules.** Unticked boxes; one purpose per control; link to the Privacy Notice section; no bundling with Terms acceptance; plain Hindi versions.

| Key | Text (English) | Notes |
|---|---|---|
| `consent.signup.terms` | "I have read and agree to the Terms of Use and the Payment & Subscription Terms (v{{version_label}})." | Required; acceptance, not consent |
| `consent.signup.privacy_notice` | "I have read the Privacy Notice. My account data will be used to provide {{product_name}}, secure my account and meet legal duties." | Notice acknowledgement; not a consent control |
| `consent.marketing.email` | "Send me product updates and offers by email. I can unsubscribe any time." | Optional, unticked, separate ledger purpose |
| `consent.marketing.whatsapp` | "Contact me on WhatsApp at {{phone}} for updates about my enquiry/account. Standard messaging terms of WhatsApp apply. Reply STOP to opt out." | Optional, unticked; template-category mapping (utility vs marketing) recorded; Meta Business policy requires opt-in [VERIFY current policy text] |
| `consent.contact_form` | "We will use your details to respond to your enquiry. See our Privacy Notice (Contact enquiries)." | Notice; marketing needs separate control |
| `consent.resource_gate` | "We will email you the download link. Your details are used as described in the Privacy Notice (Resources)." plus optional `consent.marketing.email` | |
| `consent.careers` | "Your application will be processed by {{entity_name}} HR for recruitment and kept for 12 months if unsuccessful. See Privacy Notice (Job applicants)." | |
| `consent.cookie.banner` | "We use cookies to run this site and, with your consent, to understand usage and measure campaigns. Choose Accept all, Reject all or Manage. You can change your choice any time." | Equal buttons; region variants GDPR/CCPA |
| `consent.ai.first_use` | "{{ai_display_name}} is an AI assistant. Outputs may be wrong and are labelled; review before use. Your content is not used to train models. See the AI Use & Transparency Policy." | Shown once per user; acknowledgement |
| `consent.ugc.terms` | "I accept the Blog & User-Generated Content Terms (v{{version_label}}) and confirm this post is my own work and not professional advice." | Required for UGC |
| `consent.rights.nominee` | "I nominate {{nominee_name}} to exercise my data rights if I die or cannot act (DPDP Act s.14)." | Settings › Privacy & consents |
| `consent.kyc.udf` | "I consent to {{product_name}} collecting my {{data_items}} for KYC and credit assessment on behalf of {{lender_name}} for this loan application only. I can revoke access in Settings; see the KFS and Privacy Notice." | UDF; one-time, purpose-specific; RBI Digital Lending Directions 2025 [LAW; VERIFY] |
| `consent.recording.eq` | "This session may be recorded for the record of proceedings with all parties' consent. Recordings are confidential and deleted per the Rules." | EQ hearing room |
| `consent.dpa.clickwrap` | "I am authorised to accept the Data Processing Agreement (v{{version_label}}) on behalf of {{org_name}}." | Organisation creation |
| `notice.breach.user` | Subject: "Important: a security incident affecting your {{product_name}} data" — body states what happened, data involved, when, what we did, what you should do, contact, reference | Template for Rules r.7 intimation [VERIFY content list] |
| `notice.policy.change` | "We have updated our {{policy_name}} (v{{version_label}}), effective {{effective_date}}. Summary of changes: … Read the full text. {{#if reconsent}}Please review and accept to continue.{{/if}}" | Re-consent notice |

**Review checklist.** ☐ Every control unticked by default ☐ One purpose per control ☐ Ledger records key + version ☐ Hindi strings reviewed ☐ WhatsApp template categories mapped and Meta opt-in rules followed ☐ UDF KYC consent reviewed against Directions.

---

### 05.4.19 Version, effective-date and re-consent mechanics (common)

| Step | Mechanism |
|---|---|
| Authoring | `PLT_LEGAL_REVIEWER` edits parameters or template text in Studio › Policies; diff view against the live instance; lint for unresolved parameters, banned words (guarantee, assured, risk-free, "fully compliant"), stale citations (law register), and missing mandatory sections (template schema). |
| Classification | Editor marks the change MAJOR (new purpose, new data category, new sub-processor class, fee/renewal/refund change, liability change, dispute-resolution change, AI data-use change) or MINOR (typo, contact detail, clarification). MAJOR forces `reconsent_required` for templates 1, 2, 3, 6, 12 and `pol.notice_days` lead time for 2 and 3. |
| Approval | Maker-checker (IPB-05-12). Approval record stores template version, parameter snapshot and rendered hash. |
| Scheduling | `effective_at` ≥ now + notice days for MAJOR; publish creates the new instance, supersedes the old (archived, still reachable), emits `PolicyEffective`. |
| Notice | `NOTIFY_PORT` email to account owners/administrators (and all users for Privacy Notice MAJOR) using `notice.policy.change`; in-app banner from publication to effective date. |
| Re-consent / acknowledgement | On first login after `effective_at`: Terms-class → explicit accept with version recorded in the user's acceptance ledger; Privacy-class → acknowledgement, and where a *new consent purpose* is introduced, a separate unticked control for that purpose (consent never implied by continued use [INTERP: DPDP s.6 requires affirmative action]). Refusal: read-only mode with export; organisation administrators are notified. |
| Evidence | Each user's acceptance ledger (document key, version, timestamp, IP class, UI version) is exportable by the user and the tenant auditor. |
| Archive | Prior versions remain at `/legal/{slug}/v/{version_label}` with a banner "superseded on {{date}}"; PDFs retained with hash. |
| CMS mapping | `cms.policy_instance` (IPB-04 §04.4.1); events `in.<p>.cms.PolicyEffective.v1`; proposed `in.infrabyx.grc.PolicyEffective.v1`. |

### 05.4.20 Payment-gateway onboarding checklist (what Razorpay, PayU, Cashfree and Stripe reviewers look for on the site)

| # | Check | Where on our site | Owner |
|---|---|---|---|
| 1 | Legal entity name, CIN, GSTIN and registered office visible in the footer and on Contact; match the gateway KYC documents and bank account name | Footer entity line; `/contact` | PLT_LEGAL_REVIEWER |
| 2 | Working contact details: phone, email, postal address; support hours | Footer; `/contact` | PLT_CONTENT_EDITOR |
| 3 | Terms of Use and Payment & Subscription Terms linked from footer and checkout; identify the merchant of record (selling entity) | Templates 2, 3 | PLT_LEGAL_REVIEWER |
| 4 | Refund & Cancellation Policy with concrete timelines (5–7 working days to original instrument) and non-refundable items | Template 4 | PLT_LEGAL_REVIEWER |
| 5 | Privacy Notice current (DPDP-aligned), grievance officer named | Template 1, 7 | PLT_DPO |
| 6 | Clear description of what is sold, pricing with GST treatment, currencies, billing cycles; no hidden fees | `/pricing`; IPB-04-35 | PLT_CONTENT_EDITOR |
| 7 | Delivery/service-activation statement (digital service activated immediately on payment; invoice emailed) | Template 3 cl. 9; checkout success page | PLT_CONTENT_EDITOR |
| 8 | Site on HTTPS with valid certificate on all hosts; no mixed content | CI | PLT_RELEASE_MANAGER |
| 9 | Business category consistent with gateway MCC and permitted business list (legal tech / SaaS / ODR; lending-adjacent flows disclosed for UDF) | Gateway application | OH finance |
| 10 | No prohibited content or unlicensed regulated activity implied (no "we lend" on UDF; no "legal advice" on LD) | Boundary statements | PLT_LEGAL_REVIEWER |
| 11 | Checkout uses hosted/tokenised flow; no card fields on our pages (SAQ A) | Payments adapter | PLT_SECURITY_OFFICER |
| 12 | E-mandate flows show amount, frequency, pre-debit notice, cancel path | Billing UI | OH8 |
| 13 | Social and "About" pages show a real team and address (fraud screening) | `/about`, `/team` | PLT_CONTENT_EDITOR |
| 14 | Stripe (international): export-of-services description, supported countries, currency, and Stripe-required restricted-business check | Template 3 cl. 10 | OH finance |
| 15 | Website live (not under construction), no placeholder text, test transaction completed | Release checklist | PLT_RELEASE_MANAGER |

### 05.4.21 Search-engine trust checklist

| # | Check | Implementation reference |
|---|---|---|
| 1 | Every page server-rendered with unique title, description, canonical, structured data | IPB-04-08, IPB-04-16 |
| 2 | `Organization` JSON-LD with legal name, logo, address, `sameAs`, contact points | IPB-04-70 |
| 3 | Visible legal entity, address, phone, email, grievance and DPO identities | Footer spec IPB-04 §04.3.8 |
| 4 | Dated and versioned legal pages; prior versions linked | IPB-05-04 |
| 5 | Named authors with bios for articles; `Article` schema with `author`, `datePublished`, `dateModified` | IPB-04-52 |
| 6 | Statistics with sources and as-of dates; no unverifiable superlatives | Claims Register IPB-04-07 |
| 7 | Certifications shown only when held, with issuer and scope, linking to Trust Centre | IPB-04-68 |
| 8 | No doorway or thin pages; landing pages `noindex` by default | IPB-04 content types |
| 9 | Clean redirects (no chains), 410 for retired pages, custom 404 with search | IPB-04-10 |
| 10 | Sitemap, robots, llms.txt, IndexNow, RSS valid | IPB-04-09 |
| 11 | Core Web Vitals within budget on mobile; self-hosted fonts; images optimised | IPB-04-91, IPB-04-25 |
| 12 | Accessibility statement and conformance; axe clean | Template 10; IPB-04-74 |
| 13 | HTTPS everywhere, HSTS, security.txt | IPB-04 §04.4.4; Template 11 |
| 14 | Consent-compliant analytics; no pre-consent tags (also a trust signal to privacy-focused crawlers) | IPB-04-79 |
| 15 | Consistent NAP (name, address, phone) across site, Google Business Profile, LinkedIn, MCA records | OH marketing |
| 16 | Hreflang correct for en/hi; language switch visible | IPB-04-14 |

## 05.5 Settings keys

| Key | Tier | Type | Default | Who may change | MC |
|---|---|---|---|---|---|
| `pol.notice_days` | BRAND | int | 30 | PLT_LEGAL_REVIEWER | yes |
| `pol.reconsent.terms_class_keys` | PLATFORM | string[] | `[terms, payment_terms, ugc_terms]` | PLT_LEGAL_REVIEWER | yes |
| `pol.reconsent.notice_class_keys` | PLATFORM | string[] | `[privacy, ai_policy]` | PLT_LEGAL_REVIEWER | yes |
| `pol.refusal_mode` | PLATFORM | enum | `read_only_with_export` | — (locked) | — |
| `pol.full_hindi` | BRAND | bool | false (UDF: true) | PLT_LEGAL_REVIEWER | no |
| `pol.gdpr_annex` | BRAND | bool | false | PLT_DPO | yes |
| `pol.ccpa_annex` | BRAND | bool | false | PLT_DPO | yes |
| `pol.dpa_clickwrap` | BRAND | bool | true | PLT_LEGAL_REVIEWER | yes |
| `pol.review_cadence_months.<key>` | PLATFORM | int | 6 (privacy, cookie, retention, ai) / 12 (others) | PLT_LEGAL_REVIEWER | no |
| `pol.refund.rule` | PLAN | enum | `full_within_window` | PLT_LEGAL_REVIEWER | yes |
| `pol.refund.window_days` | PLAN | int | 7 | PLT_LEGAL_REVIEWER | yes |
| `pol.refund.timeline_days_min` / `max` | BRAND | int | 5 / 7 | PLT_LEGAL_REVIEWER | yes |
| `pol.trial.auto_convert` | PLAN | bool | false | PLT_LEGAL_REVIEWER | yes |
| `pol.billing.renewal_notice_days` | BRAND | int | 7 | PLT_LEGAL_REVIEWER | yes |
| `pol.billing.dunning_days` | BRAND | int[] | `[3,7,14]` | OH8 admin | yes |
| `pol.billing.grace_days` | BRAND | int | 14 | OH8 admin | yes |
| `pol.grievance.ack_hours` | BRAND | int | 48 | PLT_GRIEVANCE_OFFICER | no |
| `pol.grievance.resolve_days` | BRAND | int | 30 | PLT_GRIEVANCE_OFFICER | no |
| `pol.grievance.intermediary_ack_hours` / `resolve_days` | PLATFORM | int | 24 / 15 | — (locked to law) | — |
| `pol.dpa.exit_assistance_days` | PLAN | int | 90 | PLT_LEGAL_REVIEWER | yes |
| `pol.dpa.subprocessor_notice_days` | PLATFORM | int | 30 | PLT_DPO | yes |
| `pol.vdp.bounty` | BRAND | enum | `none` | PLT_SECURITY_OFFICER | yes |
| `pol.vdp.disclosure_days` | PLATFORM | int | 90 | PLT_SECURITY_OFFICER | no |
| `pol.ugc.licence` | BRAND | enum | `non_exclusive_perpetual` | PLT_LEGAL_REVIEWER | yes |
| `pol.resources.default_licence` | BRAND | enum | `personal_internal` | PLT_LEGAL_REVIEWER | no |
| `pol.dispute.odr_mandatory` | BRAND | bool | false | PLT_LEGAL_REVIEWER | yes |
| `pol.dispute.arbitration` | BRAND | bool | true (B2B) / false (consumer) | PLT_LEGAL_REVIEWER | yes |
| `pol.liability_cap_formula` | PLAN | string | `fees_12_months` | PLT_LEGAL_REVIEWER | yes |

## 05.6 Events and error codes

| Event | When |
|---|---|
| `in.<p>.cms.PolicyDrafted.v1` | new draft instance |
| `in.<p>.cms.PolicyApproved.v1` | maker-checker complete |
| `in.<p>.cms.PolicyEffective.v1` | effective; payload: key, version, reconsent, notice sent count |
| `in.<p>.cms.PolicyReviewDue.v1` | cadence breached |
| `in.<p>.pol.AcceptanceRecorded.v1` | user accepts a Terms-class version |
| `in.<p>.pol.AcknowledgementRecorded.v1` | user acknowledges Privacy-class |
| `in.<p>.pol.AcceptanceRefused.v1` | user refuses; read-only mode entered |
| `in.<p>.pol.DpaExecuted.v1` | clickwrap or signed DPA for an organisation |
| Proposed ecosystem: `in.infrabyx.grc.PolicyEffective.v1`, `in.infrabyx.grc.PolicyAttested.v1` | compliance calendar and OH CRM |

| Code | Meaning | Remedy |
|---|---|---|
| `IPB-POL-001` | Unresolved parameter in template | fill brand pack / policy set field |
| `IPB-POL-002` | Mandatory section missing (template schema) | add section |
| `IPB-POL-003` | Banned wording detected (guarantee, assured, "fully compliant", forward-looking) | rewrite |
| `IPB-POL-004` | Stale citation (law register marks instrument repealed/superseded) | update citation |
| `IPB-POL-005` | Effective date earlier than notice period allows for MAJOR change | move date |
| `IPB-POL-006` | DPO approval missing for privacy-class document | route to PLT_DPO |
| `IPB-POL-007` | Hindi version missing or machine-translated unreviewed | review |
| `IPB-POL-008` | Attempt to edit a published instance in place | create new version |
| `IPB-POL-009` | Policy set incomplete for brand pack (mandatory templates absent) | publish missing |
| `IPB-POL-010` | User action blocked pending acceptance of Terms-class version | accept or export |
| `IPB-POL-011` | DPA not executed for organisation attempting to upload personal data classes | execute DPA |

## 05.7 Product adoption notes

**LD.** Adopt all 18; Template 14 mandatory for the advocate/CS marketplace with BCI Rule 36 opinion on file before launch; Template 2 boundary statement and footer disclaimer; eSign and stamp-duty pass-through in Templates 3 and 4; UGC Template 12 with advocate screening. Existing LD legal pages are migrated as version 1.0 instances with a dated "what changed" summary.

**LDC.** Adopt all except 14; emphasise in Template 2 that the customer remains responsible for filings; Template 9 adds filings evidence rows; LDC's law register is the shared stale-citation source for `IPB-POL-004` across products (cross-file assumption shared with IPB-04 §04.7).

**EQ.** Adopt all; Template 14 becomes "Neutral Panel Terms"; Rules, Procedures & Fees, Code of Conduct for Neutrals and ODR Standards are institutional documents published alongside the policy set with year-versioning (research: SAMA, Presolv360 patterns); Template 2 cl. 16 discloses that Equator is a group company when other Infrabyx products name it as ODR provider; confidentiality clauses per Mediation Act 2023 and Arbitration and Conciliation Act 1996 s.42A [LAW].

**FBX.** Adopt 1, 2, 5, 6, 7, 8, 9, 10, 11, 15 (with Annex 4), 16, 17, 18; 3 and 4 only for self-serve plans if offered; the DPA's RBI outsourcing annex is non-negotiable for NBFC and bank customers and must be re-verified against the 28 November 2025 Directions before the first enterprise signature [VERIFY].

**UDF.** Adopt all except 14 and 16; full Hindi text mandatory (`pol.full_hindi=true`); GST-inclusive display; Templates 1, 7 and 18 carry the RBI Digital Lending Directions 2025 insertions (LSP disclosure, KFS, cooling-off, grievance officer of lender and LSP, data-access limits, no automatic credit-limit increase) [LAW; VERIFY paragraph numbers]; lending-partner list is a legal page requiring legal review on every change.

**OH.** Master instances of 3 and 4 (selling entities), 15 (intra-group), 17 (registry source); group website uses 1, 2, 5, 6, 7, 8, 9, 10, 11, 18; OH also hosts the compliance calendar that consumes `PolicyReviewDue` and `PolicyEffective` from all products.

## 05.8 Acceptance tests

```gherkin
@IPB-05-AT-01 Mandatory policy set
  Given a brand pack without a published Grievance Redressal Policy
  When the pack is submitted for publish
  Then the response is IPB-POL-009 naming the missing templates

@IPB-05-AT-02 Placement
  Given the pricing page, checkout, sign-up, resource gate, UGC editor and footer
  Then each shows the links required by IPB-05-02 and each legal page is server-rendered with stable clause anchors

@IPB-05-AT-03 Parameters
  Given a Privacy Notice draft with {{dpo_email}} unset in the policy set
  When published
  Then the response is IPB-POL-001

@IPB-05-AT-04 Versions and archive
  Given Terms v1.0 effective 1 Jan and v2.0 effective 1 Mar
  Then /legal/terms shows v2.0 with "what changed", /legal/terms/v/1.0 renders v1.0 with a superseded banner, and both PDFs' hashes match the stored values

@IPB-05-AT-05 Re-consent and notice period
  Given a MAJOR Terms change approved on 1 Feb
  When effective_at is set to 10 Feb
  Then the response is IPB-POL-005 (30-day notice)
  Given effective_at 3 Mar
  Then account owners receive notice.policy.change on approval, an in-app banner shows until 3 Mar, and on first login after 3 Mar the user must accept; refusing enters read-only mode with export and emits AcceptanceRefused

@IPB-05-AT-06 Hindi
  Given a Privacy Notice with a machine-translated hi-IN draft not reviewed
  When published
  Then the response is IPB-POL-007

@IPB-05-AT-07 Review cadence
  Given a Cookie Policy last reviewed 7 months ago
  Then it appears in Studio › Policies as overdue and PolicyReviewDue is emitted

@IPB-05-AT-08 Approvals
  Given a Privacy Notice approved by PLT_LEGAL_REVIEWER and PLT_SUPER_ADMIN but not PLT_DPO
  When published
  Then the response is IPB-POL-006

@IPB-05-AT-09 Banned wording and stale citations
  Given a Terms draft containing "we guarantee" and a Retention Schedule citing the RBI 2017 NBFC outsourcing directions
  When submitted
  Then the responses are IPB-POL-003 and IPB-POL-004 with locations

@IPB-05-AT-10 Consent strings in the ledger
  Given a contact form submission with consent.marketing.email ticked
  Then the ledger record stores key, version and the exact text shown; a later version change does not alter the stored text

@IPB-05-AT-11 Refund timeline
  Given an approved refund
  Then the gateway refund is initiated to the original instrument within 1 working day and a credit note is issued; the policy text shows the configured 5–7 working days

@IPB-05-AT-12 DPA gate
  Given an organisation that has not executed the DPA
  When a user attempts to upload a file classified as containing personal data
  Then the response is IPB-POL-011 with a link to execute the DPA (clickwrap by an authorised role)

@IPB-05-AT-13 Gateway checklist
  Given the release checklist for a new brand pack
  Then every row in §05.4.20 is ticked with evidence links before the gateway application is submitted

@IPB-05-AT-14 Grievance timelines
  Given an intermediary content complaint
  Then the ticket SLA is 24 h acknowledgement and 15 days disposal regardless of pol.grievance.ack_hours
```

## 05.9 Open items

| ID | Item | Owner | Default |
|---|---|---|---|
| IPB-OI-05-01 | Counsel sign-off on each product's boundary statement and the pre-dispute arbitration/ODR clause for consumers. | [COUNSEL] | ODR optional, arbitration B2B only |
| IPB-OI-05-02 | Confirm DPDP Rules 2025 rule numbers and in-force dates for notice (r.3), security (r.6), breach (r.7), retention (r.8), children (r.10), SDF (r.12–13), transfer (r.14) before 13 May 2027. | PLT_DPO [VERIFY] | Templates carry [VERIFY] tags until confirmed |
| IPB-OI-05-03 | Current RBI e-mandate AFA-exempt limit and categories; card-on-file tokenisation circular references. | OH8 / [VERIFY] | Describe mechanism without quoting the limit |
| IPB-OI-05-04 | BCI Rule 36 opinion for LD marketplace profiles and reviews. | LD lead / [COUNSEL] | Reviews OFF for advocates |
| IPB-OI-05-05 | Whether any product qualifies as an "e-commerce entity" under the Consumer Protection (E-Commerce) Rules 2020, triggering r.4 disclosures. | [COUNSEL] | Comply voluntarily (48 h / 30 days) |
| IPB-OI-05-06 | Safe-harbour wording for VDP under Indian law. | PLT_SECURITY_OFFICER / [COUNSEL] | Contractual undertaking text as drafted |
| IPB-OI-05-07 | Full Hindi text for all policies in LD/LDC/EQ/FBX (summary only at v1.0). | [OWNER] | `pol.full_hindi=false` except UDF |
| IPB-OI-05-08 | RBI (NBFC/Bank – Managing Risks in Outsourcing) Directions 2025 paragraph mapping for DPA Annex 4. | FBX lead [VERIFY] | Annex carries generic clause text |
| IPB-OI-05-09 | Mediation Council of India status for EQ escalation references. | EQ lead [VERIFY] | Omit reference until functional |
| IPB-OI-05-10 | Data Protection Board complaint portal URL and procedure. | PLT_DPO [VERIFY] | Text says "as notified by the Board" |
| IPB-OI-05-11 | GDPR/CCPA annex full text when an EEA/UK/California brand pack is created. | [COUNSEL] | Annexes OFF |
| IPB-OI-05-12 | SAC codes and GST rate per product line for Template 3. | OH finance [VERIFY] | "applicable rate" wording |
