# IPB-08 — Vendor Assurance Room and Trust Centre  (Infrabyx Platform Baseline Standard v1.0, 25 October 2026)

> **Status:** Binding for LD, LDC, EQ, FBX, UDF, OH unless a product records an `IPB-DEV` deviation.
> **Related:** IPB-D-09 (owner decision: Vendor Assurance Room; Operations Hub OH14.6 is system of record); IPB-06 (accessibility statement is a published assurance document); IPB-07 (Settings tree node 18 `Security & trust`; help keys; confirmation standard); IPB-01 (storage with Object Lock behind `STORAGE_PORT`; audit ledger); the IPB files covering the public website/CMS (Trust Centre page template, Claims Register), AI and Vidhi (questionnaire drafting skill), engineering and release (SBOM, patch status, VAPT inputs), integrations (status page); Ecosystem Spec v1.2 (CloudEvents envelope, identity, data classes); research note `R_Standards_Quick_Reference.md` §§A–C.

## 08.1 Purpose and scope

Infrabyx entities are **vendors to regulated entities**. Finbyx and Udofin serve NBFCs, banks, co-operative banks and lending service providers; LawDocsComply serves listed companies, NBFCs and insurers; Equator Resolution serves MIIs, insurers and banks that refer disputes; LawDocs serves law firms acting for all of them. Each of those clients must obtain, review and retain documents about us before signing and on a continuing basis. The obligation sits with the client, but the burden of producing the documents, on time, in the form their regulator expects, sits with us. Doing this by email, one PDF at a time, does not scale and leaves no evidence trail on either side.

The regulatory drivers, as we read them (**[INTERP]** unless tagged otherwise; clause numbers **[VERIFY]** against the primary text before any client-facing citation):

| Client regulator | Instrument | What the client must obtain or do about its vendors (our reading) |
|---|---|---|
| RBI (NBFCs) | **RBI (NBFC – Managing Risks in Outsourcing) Directions, 2025** (28 Nov 2025; existing arrangements to comply by renewal or 10 Apr 2026; Chapter IV on IT outsourcing applies to NBFC-ML and above) | Board-approved outsourcing policy; due diligence before engagement and ongoing; written agreement covering confidentiality, audit and inspection access for the NBFC and RBI, sub-contracting only with consent, BCP/DR, data location and exit; ongoing monitoring and periodic review; concentration risk; cloud-specific controls; sub-contractor coverage; pooled audits permitted; cyber incident reporting within 6 hours; 30-day grievance timelines. **[VERIFY: chapter and paragraph numbers; RBI index id 12941.]** |
| RBI (banks) | **RBI (Commercial Banks – Managing Risks in Outsourcing) Directions, 2025** (28 Nov 2025) | Parallel text for bank clients; audit access, exit, sub-contractor lists. |
| RBI (all REs covered) | **RBI Master Direction on IT Governance, Risk, Controls and Assurance Practices** (7 Nov 2023; effective 1 Apr 2024) | IT and IS governance, IS audit, VAPT, BCP/DR testing, vendor risk as part of IT risk framework; evidence from vendors feeds the RE's IS audit. |
| RBI (digital lending) | **RBI (Digital Lending) Directions, 2025** (8 May 2025) | REs remain responsible for LSP conduct; due diligence on LSPs and DLAs; data storage in India; LSP disclosures. Udofin as LSP must furnish these. |
| SEBI | **Cybersecurity and Cyber Resilience Framework (CSCRF)** (20 Aug 2024; compliance for most REs by 31 Aug 2025) | REs to ensure vendors and third parties meet cyber controls; SBOM for critical systems; SOC monitoring; VAPT; audit by CERT-In empanelled auditors; vendor risk management. **[VERIFY: CSCRF standards on third-party/vendor management and SBOM scope.]** |
| IRDAI | **IRDAI (Protection of Policyholders' Interests, Operations and Allied Matters of Insurers) Regulations, 2024** and **Operations Master Circular 19 Jun 2024** (repealing the 2017 outsourcing regulations) | Board outsourcing policy; barred activities; reporting of arrangements; due diligence and agreements with service providers. **[VERIFY: specific clauses on information to be obtained from service providers.]** |
| DPDP | **Digital Personal Data Protection Act 2023** and **DPDP Rules 2025** (notified 13 Nov 2025; substantive duties from 13 May 2027) | **[LAW]** s.8(2): a data fiduciary may engage a data processor only under a valid contract; s.8(5): reasonable security safeguards; s.8(6): breach intimation. Our clients are fiduciaries and we are usually processors; they will ask for our safeguards evidence, sub-processor list and breach procedures. **[VERIFY: Rules 2025 rule numbers on security safeguards and breach intimation (Rule 6, Rule 7 in the draft).]** |
| CERT-In | **Directions of 28 Apr 2022** under s.70B(6) IT Act | 6-hour incident reporting, 180-day logs in India, NTP sync — our own obligation; clients want evidence that we meet it. |
| CERT-In | **Cyber Security Audit Policy Guidelines (2025)** and empanelled-auditor scheme | Clients expect VAPT and IS audits by CERT-In empanelled auditors; the auditor's certificate is a document type here. |
| Companies Act / SEBI LODR | Listed-company clients' audit committees and risk committees | Vendor assurance evidence for their internal control over financial reporting where our software is in scope. |

This file specifies the **Vendor Assurance Room** (the super-admin "Compliance Documents" function with Operations Hub as system of record), the **tenant view** at `Settings › Security & trust › Vendor documents`, the public **Trust Centre**, the data model, state machine, events, settings, roles, retention, row-level security, the OH→product mirroring, reporting, product adoption and acceptance tests.

Out of scope: our own vendor management (how Infrabyx assesses *its* suppliers) — that is an OH controls module; the Vendor Assurance Room may publish its outputs (sub-processor list) but does not run the assessments.

## 08.2 Definitions

| Term | Meaning |
|---|---|
| **Assurance document** (`vad_`) | A versioned artefact Infrabyx publishes to evidence a control, certification, policy, legal fact or status to clients. |
| **Document type** | A catalogue entry describing a kind of assurance document, its cadence, default gating and evidence class. |
| **Cadence** | How often a document type must be refreshed: monthly, quarterly, half-yearly, annual, ad hoc. |
| **Validity / expiry** | The period during which a version is current; after expiry it is superseded or marked expired. |
| **Gating level** | Who may see a document: `public`, `login` (any authenticated tenant user with role), `nda` (tenant has accepted the standard NDA or has a signed MSA with confidentiality clause on file), `per_tenant` (published to named tenants only). |
| **Publication** | The act of making a document version visible to a tenant, plan or the public. |
| **Acknowledgement** | A logged event that a named tenant user viewed or downloaded a version. |
| **Evidence pack** | A ZIP export of selected documents with a signed manifest and framework mapping. |
| **Grant** | A time-boxed, scoped permission for an external auditor or regulator to access a tenant's view of documents. |
| **Questionnaire responder** | The standard-answers library and drafting workflow for security/outsourcing questionnaires (SIG-Lite, CAIQ, client-specific). |
| **Trust Centre** | The public page per product listing certifications held, sub-processors, status, policies and request routes. |
| **Claims Register** | The register (shared with the public-website IPB file) of every externally stated claim about certifications, controls, uptime or compliance, each linked to evidence; nothing is published outside the register. |
| **System of record (SoR)** | Operations Hub module OH14.6, where documents are created, reviewed, approved and published; products hold read-only mirrors. |
| **Security officer** | `PLT_SECURITY_OFFICER`; the maker or checker for assurance documents. |
| **CS** | The Company Secretary's office, acting as `PLT_LEGAL_REVIEWER` checker for affidavits, undertakings, board-approved policies, financial statements and incorporation documents. |
| **SIG-Lite / CAIQ** | Shared Assessments Standardized Information Gathering (Lite) questionnaire; Cloud Security Alliance Consensus Assessments Initiative Questionnaire. **[VERIFY: current versions — SIG 2026, CAIQ v4.x.]** |

## 08.3 Requirements

### 08.3.1 System of record and catalogue

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-08-01 | Operations Hub OH14.6 **Compliance Documents** is the single system of record for assurance documents for all Infrabyx legal entities and products. Products hold read-only mirrors (§08.4.6). No product UI allows creating or editing a `vad_` document. | PLATFORM | Product consoles have no write endpoints for `vad_`; mirror tables are read-only roles. |
| IPB-08-02 | The super-admin menu **Compliance Documents** in `apps/console` of OH (mirrored read-only as **Compliance Documents** in each product's console) has: Catalogue (types), Documents (list and detail), Cadence calendar (due/overdue), Publications, Acknowledgements, Grants, Requests, Questionnaires, Claims Register, Reports. | PLATFORM | Nav snapshot. |
| IPB-08-03 | **Document types catalogue** ships with the entries in §08.4.1, each with cadence, default gating, evidence class, owner role, checker role, template (if any) and the regulatory frameworks it maps to (`RBI-OUT-2025`, `RBI-ITG-2023`, `RBI-DL-2025`, `SEBI-CSCRF`, `IRDAI-OPS-2024`, `DPDP`, `CERT-IN`, `ISO27001`, `SOC2`, `SIG-LITE`, `CAIQ`). New types require `PLT_SECURITY_OFFICER` maker and `PLT_LEGAL_REVIEWER` checker. | PLATFORM | Seed test; type creation maker-checker. |
| IPB-08-04 | Every document version records: type, legal entity (Infrabyx entity it concerns), products in scope, title, version, issuer (internal or third party with name), issue date, valid-from, valid-to, cadence instance (for example `2026-Q4`), gating level, file (PDF/A preferred) with SHA-256 checksum, size, page count, summary (plain language, ≤120 words, help key), related claims, supersedes/superseded-by, maker, checker, approval timestamp, publication records. | PLATFORM | Schema test; checksum computed on upload and verified on download. |
| IPB-08-05 | **Cadence engine**: for each type with a cadence, the system computes `next_due_at` from the last approved version's `valid_from` and the cadence; reminders to `PLT_SECURITY_OFFICER` and `PLT_SUPER_ADMIN` at T-30, T-14, T-7, T-1 days and daily when overdue (`trust.cadence.reminder_days`); overdue items appear on the OH controls dashboard and in the Work Inbox. Ad hoc types have no due date but have expiry. | PLATFORM | Reminder schedule test with fixed clock. |
| IPB-08-06 | **Validity and expiry**: a version with `valid_to` in the past transitions to `EXPIRED` automatically unless superseded; expired versions remain downloadable to tenants who previously acknowledged them (for their records) but are labelled "Expired — superseded by vX" or "Expired — renewal in progress". The Trust Centre never shows an expired certification as current (`IPB-TRUST-004`). | PLATFORM | Clock-advance test; Trust Centre render. |
| IPB-08-07 | **Version history**: all versions retained; diff of metadata between versions shown; files never overwritten (Object Lock, compliance mode, retention per §08.4.9). | PLATFORM | Attempt to overwrite returns error; history lists all. |
| IPB-08-08 | **NDA gating**: `nda` gating requires the tenant to have an accepted NDA record (click-through standard NDA accepted by `ORG_OWNER`/`ORG_ADMIN`, or an MSA with confidentiality clause flagged by OH legal); the acceptance is stored as a consent-type event with document version and acceptor. `per_tenant` requires an explicit publication row for that tenant. | PLATFORM/ORG | Download without NDA returns `IPB-TRUST-002`. |
| IPB-08-09 | **Watermarking**: every download of a `login`, `nda` or `per_tenant` document is rendered on the fly with a visible watermark on every page ("Prepared for <Tenant legal name> · <user email> · <timestamp IST> · <acknowledgement id>") and an invisible metadata/XMP stamp with the acknowledgement id; the original file is never served directly; the watermarked PDF's checksum is recorded on the acknowledgement. Public documents are served unwatermarked with the published checksum. | PLATFORM | Download inspection; checksum recorded. |
| IPB-08-10 | **Checksum and integrity**: the published checksum of the original appears on the document detail and in the manifest; the download page offers a "Verify" action that recomputes the checksum of the unwatermarked original on request (served only to `PLT_AUDITOR_RO` or by evidence-pack manifest). | PLATFORM | Verify matches. |
| IPB-08-11 | **Supersession**: publishing a new version of a type for the same entity and scope marks the previous version `SUPERSEDED` and notifies subscribed tenants; supersession never deletes. | PLATFORM | State test; notification. |
| IPB-08-12 | **Maker-checker**: every transition to `APPROVED` and `PUBLISHED`, every gating change, every withdrawal and every catalogue change requires a checker different from the maker. Checker roles per type are in §08.4.1 (security officer for technical documents; CS/`PLT_LEGAL_REVIEWER` for legal, corporate and financial documents; both for policies). A `PLT_SUPER_ADMIN` cannot bypass (`IPB-TRUST-005`). Vidhi agents may draft metadata and summaries as makers only. | PLATFORM | Attempted self-approval rejected; super admin bypass rejected. |
| IPB-08-13 | **Gated financial statements**: `financial_statements` and `management_accounts` types are `per_tenant` by default, published only on written request approved by `PLT_SUPER_ADMIN` and CS, and watermarked; the Trust Centre never lists them. | PLATFORM | Gating default test. |

### 08.3.2 Tenant view — `Settings › Security & trust › Vendor documents`

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-08-14 | The tenant view lists documents visible to the tenant (by gating, plan and per-tenant publications) grouped by **type** and filterable by **cadence**, framework, product, legal entity and status (current / expiring within 60 days / expired-retained). Each row: title, version, issue date, valid-to, cadence, gating badge, checksum (short), "Download", "Acknowledged by" count for the tenant. | TENANT | List renders with filters; only visible rows. |
| IPB-08-15 | **Download** produces the watermarked PDF (IPB-08-09) and writes an **acknowledgement** (`vada_`): tenant, user, document version, timestamp, IP class (not full IP on display), user agent class, purpose (optional free text "for RBI inspection"), watermark id, checksum of delivered file. The acknowledgement log is visible to `ORG_OWNER`, `ORG_ADMIN` and `ORG_AUDITOR_RO` and exportable (signed CSV/PDF) as **evidence for the tenant's own regulator** that due diligence was performed on a date. | TENANT | Download → acknowledgement row; export signed. |
| IPB-08-16 | **Subscribe to updates**: per type or all; notifications (IPB-07 classes `trust.document_published`, `trust.document_expiring`, `trust.document_withdrawn`) via chosen channels; the `trust.document_withdrawn` class is mandatory for tenants who acknowledged that document. | ORG/USER | Subscription test; withdrawal notice. |
| IPB-08-17 | **Request additional document**: a form (document type or free description, purpose, regulator deadline) creating a `vadr_` request and an OH support ticket routed to `PLT_SECURITY_OFFICER`; SLA `trust.request.ack_hours` (default 24) and `trust.request.fulfil_days` (default 10; 3 for `regulator_deadline=true`); status visible to the tenant. | TENANT | Request → ticket; SLA timers. |
| IPB-08-18 | **Evidence pack export**: tenant selects documents (or a framework preset: "RBI outsourcing due diligence", "RBI IT Governance IS audit inputs", "SEBI CSCRF vendor", "IRDAI outsourcing", "DPDP processor", "SIG-Lite", "CAIQ") → ZIP with watermarked PDFs, `manifest.json` (document ids, versions, checksums of originals and of watermarked copies, gating, issue/valid dates, framework mapping, generated-at, generated-by, tenant, signature of the manifest by the platform signing key), `mapping.csv` (framework control → document → page reference where recorded), `README.txt` (how to verify). Pack generation is itself an acknowledgement for every included document and emits `VendorEvidencePackExported`. | TENANT | ZIP structure test; signature verifies; acknowledgements written. |
| IPB-08-19 | **Auditor / regulator grant**: `ORG_OWNER` or `ORG_ADMIN` creates a grant (`vadg_`) for a named external person (email, organisation, role: statutory auditor / IS auditor / RBI inspector / SEBI / IRDAI / internal auditor), scoped to selected documents or framework preset, time-boxed (`trust.grant.max_days` ceiling 90; default 30), optionally read-only without download; the grantee authenticates by magic link + OTP (no account creation), sees only the scoped documents, and every view/download is acknowledged under the grant; grants are revocable at any time, auto-expire, and are logged in the tenant's audit trail and in OH. Creating a grant requires maker-checker when `trust.grant.require_mc` is true (default true for `per_tenant` documents). | TENANT | Grant lifecycle test; expired grant returns `IPB-TRUST-003`; revocation immediate. |
| IPB-08-20 | **Questionnaire responder**: tenants may upload a questionnaire (XLSX/CSV/PDF) or pick a standard (SIG-Lite, CAIQ, RBI outsourcing checklist); the system maps questions to the **standard answers library** (`vadq_` answers maintained in OH, each with answer text, evidence document links, owner, review date, framework tags); **Vidhi drafts** responses for unmatched questions from the library and published documents only, labelled as drafts; the `PLT_SECURITY_OFFICER` reviews and approves each response before release; the released questionnaire is itself a `per_tenant` assurance document (type `questionnaire_response`) with acknowledgement on download. | ORG/PLATFORM | Upload → mapping → draft → review → release; no release of unreviewed AI text. |
| IPB-08-21 | The tenant view shows **what the tenant's regulator typically expects** per framework preset as a checklist with coverage status (covered by document X / not applicable / request pending), using the mapping of §08.4.1; the wording is [INTERP] and carries help keys with citations. | TENANT | Checklist renders coverage. |
| IPB-08-22 | The tenant view also lists **sub-processors** (current list with purpose, location, data classes, DPA status, date added; change notice history), **certifications** (with certificate document link), **status and uptime** (link and last 90 days from the status page), **incident notices** affecting the tenant, **DPA** (download executed DPA or request one), **security contact** and **VDP** link. | TENANT | Render test. |

### 08.3.3 Public Trust Centre

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-08-23 | Each product publishes `/trust` on `apps/public` (standard page per IPB-D-08) rendered from the SoR: certifications **actually held** (type, issuer, scope, valid-to, certificate id where issuer permits), VAPT summary (date, auditor empanelment, scope summary, "no open critical/high" status or remediation status — never the report), sub-processor list, uptime and status link, DPA request route, Vulnerability Disclosure Policy, policy summaries (privacy, security, acceptable use, AI use), accessibility statement (IPB-06), compliance mappings available on request, contact for security and DPO, grievance officer. | PLATFORM | Page renders only `public`-gated items in `PUBLISHED` state. |
| IPB-08-24 | **Claims Register rule**: no statement on the Trust Centre, the public website, sales material, tutorials or social clips asserts a certification, audit, control, uptime figure or compliance status unless a `clm_` entry exists linking the claim text to a current `PUBLISHED` assurance document (or a `LEDGER`/`COMPUTED` metric for uptime); the CMS and the Trust Centre renderer refuse unregistered claims (`IPB-TRUST-006`); a claim whose evidence expires is auto-flagged and the rendered text changes to the register's fallback wording ("ISO/IEC 27001 — recertification in progress"). | PLATFORM | CMS lint; expiry flip test. |
| IPB-08-25 | The Trust Centre states "in progress" or "planned" items only with a target quarter and never with a logo or badge. Badges of certification bodies appear only with the certificate linked and within the body's trademark rules. | PLATFORM | Content lint. |
| IPB-08-26 | A "Request access to gated documents" action on `/trust` leads to login or to a lead form (OH CRM) with the standard NDA click-through for prospects on a `prospect` grant (max 14 days, `login`-gated documents only). | PLATFORM | Prospect grant path. |

### 08.3.4 Mirroring, availability and fallback

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-08-27 | OH publishes changes as Ecosystem events (§08.6.2); each product's `trust` module consumes them into a read-only mirror (`vad_mirror_*`) holding metadata, gating, publication targets and a reference to the file object (shared `STORAGE_PORT` bucket with Object Lock; products never copy files). | PLATFORM | Event replay rebuilds mirror identically. |
| IPB-08-28 | **Product-side fallback when OH is offline**: the tenant view and Trust Centre serve from the mirror; downloads still succeed via the storage port with watermarking performed by the product's `DOCGEN_PORT` adapter; acknowledgements are written locally and queued for OH with idempotency keys; requests and grant creation are accepted locally in `PENDING_SYNC` and reconciled when OH returns; the UI shows "Last synchronised <time>" when the mirror is older than `trust.mirror.stale_minutes` (default 60). | PLATFORM | Chaos test: OH down → downloads, acks, requests still work; reconciliation on recovery. |
| IPB-08-29 | Mirror consistency check daily: product recomputes a hash of its mirror and compares with OH's publication digest; mismatches raise `IPB-TRUST-009` to the OH controls dashboard. | PLATFORM | Digest test. |

### 08.3.5 Reporting

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-08-30 | **Cadence compliance dashboard** (OH, `PLT_SUPER_ADMIN`, `PLT_SECURITY_OFFICER`): per type and entity — current version, valid-to, next due, status (on time / due soon / overdue / expired), days overdue, assigned owner, open requests; roll-up percentage "assurance documents in cadence"; widgets carry evidence class `LEDGER`. | PLATFORM | Dashboard renders from fixtures with correct statuses. |
| IPB-08-31 | **Per-tenant acknowledgement report**: for a tenant — which documents were downloaded, by whom, when, under which grant (if any), with checksums; exportable signed PDF/CSV; available to the tenant (its own) and to OH. | ORG/PLATFORM | Export test. |
| IPB-08-32 | **Regulator-ready "vendor file" per client**: OH generates, per tenant, a pack containing the executed agreement references (from OH CRM), DPA, current certifications, latest VAPT summary, BCP/DR test summary, sub-processor list, incident notices to that tenant, SLA performance (from OH8/status), acknowledgement history and open requests — the file the client would show its regulator about us; refreshed on demand or quarterly; delivered through the tenant view as a `per_tenant` document. | PLATFORM | Pack generation test. |
| IPB-08-33 | Requests and grants reports: SLA performance, open requests ageing, active and expired grants, grantee activity. | PLATFORM | Report renders. |

### 08.3.6 Security, privacy and retention

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-08-34 | **Row-level security**: tenant-side tables (`vad_mirror_publication`, `vada_acknowledgement`, `vadg_grant`, `vadr_request`) carry `tenant_id` with RLS deny-by-default; a tenant can never see another tenant's publications, acknowledgements, grants or requests; `per_tenant` documents are resolvable only through the tenant's own publication row. | PLATFORM | Adversarial test @IPB-08-AT-10. |
| IPB-08-35 | Download URLs are single-use, short-lived (≤5 minutes), bound to the acknowledgement id and the requesting session; the storage port never exposes a direct object URL. | PLATFORM | Replay of URL fails. |
| IPB-08-36 | Grantee sessions are isolated (separate identity realm, no tenant role), rate-limited, and bound to the grant scope at the policy layer (Cerbos) and at RLS. | PLATFORM | Grantee cannot list beyond scope. |
| IPB-08-37 | **Retention**: assurance document versions and acknowledgements are retained for 10 years from supersession/expiry (`trust.retention.years`, floor 8 — **[INTERP]** aligned to the eight-year record-keeping norms clients cite under Companies Act 2013 s.128(5) and RBI directions **[VERIFY]**); Object Lock compliance mode for files; grants retained with acknowledgements; requests 5 years. Legal hold overrides deletion. | PLATFORM | Retention policy applied on bucket; deletion blocked. |
| IPB-08-38 | Personal data in acknowledgements (user email, IP class) is minimised, purpose-tagged `vendor_due_diligence_evidence`, and exportable to the data principal under DPDP access requests. | PLATFORM | DSAR export includes acknowledgements. |
| IPB-08-39 | All actions write the hash-chained audit ledger in the same transaction (publish, gating change, download, grant create/revoke, request, pack export, claim register changes). | PLATFORM | Ledger entries per action. |

## 08.4 Design

### 08.4.1 Document types catalogue (seed)

Checker: **SO** = `PLT_SECURITY_OFFICER`; **CS** = `PLT_LEGAL_REVIEWER` (Company Secretary's office); **SO+CS** = both. Gating is the default and may be tightened per version.

| Type key | Document | Cadence | Default gating | Maker | Checker | Frameworks |
|---|---|---|---|---|---|---|
| `cert_iso27001` | ISO/IEC 27001:2022 certificate and scope statement | annual (certificate validity 3 years; surveillance annual) | public (certificate), login (scope) | SO | CS | RBI-OUT, RBI-ITG, SEBI-CSCRF, IRDAI, ISO27001 |
| `cert_iso27701` | ISO/IEC 27701:2025 certificate | annual | public | SO | CS | DPDP |
| `cert_iso42001` | ISO/IEC 42001:2023 certificate | annual | public | SO | CS | AI governance |
| `cert_iso22301` | ISO 22301:2019 certificate | annual | public | SO | CS | RBI-ITG (BCP) |
| `soc2_report` | SOC 2 Type II report | annual | nda | SO | CS | SOC2, SEBI-CSCRF |
| `soc2_bridge` | SOC 2 bridge letter | quarterly (gap periods) | nda | SO | CS | SOC2 |
| `vapt_report` | VAPT full report (CERT-In empanelled auditor) | half-yearly | per_tenant (regulated clients on request) | SO | CS | RBI-ITG, SEBI-CSCRF, CERT-IN |
| `vapt_summary` | VAPT executive summary and closure status | half-yearly | login | SO | SO (second officer) | as above |
| `cert_in_auditor_cert` | CERT-In empanelled auditor certificate/attestation of audit | half-yearly | login | SO | CS | CERT-IN, SEBI-CSCRF |
| `is_audit_report` | Information systems audit report | annual | nda | SO | CS | RBI-ITG |
| `internal_audit_summary` | Internal audit summary (IT and controls) | annual | nda | SO | CS | RBI-OUT |
| `bcp_dr_test_report` | BCP/DR test report (RTO/RPO achieved) | quarterly | login | SO | SO | RBI-ITG, RBI-OUT, ISO22301 |
| `patch_vuln_status` | Patch and vulnerability status (open by severity, SLA adherence) | monthly | login | SO | SO | SEBI-CSCRF, RBI-ITG |
| `uptime_report` | Availability and SLA performance | monthly | login | SO (auto-generated from status) | SO | RBI-OUT |
| `sbom` | SBOM/AIBOM per product release (CERT-In BOM guidelines v2.0) | ad hoc (per release) and quarterly snapshot | nda | Release manager | SO | SEBI-CSCRF, CERT-IN |
| `access_review` | Privileged access review attestation | quarterly | nda | SO | CS | RBI-ITG |
| `incident_summary` | Security incident summary (count, class, status; no client identifiers) | quarterly | login | SO | CS | RBI-OUT, CERT-IN |
| `incident_notice_tenant` | Incident notice to a specific tenant | ad hoc | per_tenant | SO | CS | DPDP, RBI-OUT |
| `subprocessor_list` | Sub-processor list with locations, purposes, data classes | ad hoc (on change) and annual confirmation | public | SO | CS | DPDP, RBI-OUT |
| `data_flow_diagram` | Data-flow diagrams per product | annual | nda | SO | SO | RBI-OUT, DPDP |
| `dpia_summary` | DPIA summary per product | annual | nda | `PLT_DPO` | CS | DPDP |
| `dpa_template` / `dpa_executed` | Data processing agreement (template; executed per tenant) | ad hoc | public (template) / per_tenant (executed) | CS | SO | DPDP |
| `insurance_certificate` | Cyber liability and professional indemnity certificates | annual | login | CS | SO | RBI-OUT |
| `incorporation_docs` | Certificate of incorporation, PAN, GST registration, MSME/Udyam | annual confirmation | login | CS | SO | KYC of vendor |
| `affidavit_undertaking` | Affidavits/undertakings: no sub-contracting without consent; data localisation; non-disclosure; no adverse regulatory action; beneficial ownership | annual or ad hoc | per_tenant | CS | SO | RBI-OUT, RBI-DL |
| `policy_board_approved` | Board-approved policies: information security, access control, incident response, BCP, vendor/outsourcing, data retention, privacy, AI use, acceptable use, change management | annual | login (summaries public) | SO | SO+CS | all |
| `financial_statements` | Audited financial statements | annual | per_tenant (gated) | CS | `PLT_SUPER_ADMIN` + CS | RBI-OUT (financial soundness) |
| `management_attestation` | Management attestation of control operation | quarterly | nda | SO | CS | RBI-OUT |
| `compliance_mapping` | RBI/SEBI/IRDAI/DPDP compliance mapping sheets (our controls → their clauses) | half-yearly | login | SO | CS | all |
| `rbi_dl_lsp_disclosure` | Digital Lending Directions LSP disclosure set (Udofin) | annual and on change | login | Product lead | CS | RBI-DL |
| `accessibility_statement` | Accessibility statement (IPB-06) | per release | public | Accessibility lead | CS | RPwD |
| `pen_test_attestation_letter` | Attestation letter for clients (no findings detail) | half-yearly | login | SO | CS | RBI-ITG |
| `exit_plan` | Exit and transition plan summary | annual | nda | Product lead | CS | RBI-OUT (exit) |
| `concentration_statement` | Cloud and sub-contractor concentration statement | annual | nda | SO | CS | RBI-OUT |
| `questionnaire_response` | Released questionnaire response | ad hoc | per_tenant | SO | SO | SIG-LITE, CAIQ |
| `vendor_file` | Regulator-ready vendor file for a client | quarterly / on demand | per_tenant | system | SO | all |

### 08.4.2 Data model (`trust` schema in OH; `vad_mirror_*` in products)

| Table | Key columns | Notes |
|---|---|---|
| `vadt_document_type` | `id (vadt_)`, `key`, `name`, `cadence enum(monthly, quarterly, half_yearly, annual, ad_hoc)`, `default_gating`, `maker_role`, `checker_roles[]`, `frameworks[]`, `template_res_id`, `evidence_class`, `active` | Catalogue. |
| `vad_document` | `id (vad_)`, `type_id`, `legal_entity_id`, `products[]`, `title`, `version`, `issuer_name`, `issuer_kind enum(internal, third_party)`, `issue_date`, `valid_from`, `valid_to`, `cadence_instance`, `gating enum(public, login, nda, per_tenant)`, `file_object_key`, `sha256`, `size_bytes`, `pages`, `summary`, `help_key`, `state`, `supersedes_id`, `superseded_by_id`, `maker_id`, `checker_id`, `approved_at`, `published_at`, `withdrawn_reason` | One row per version. |
| `vad_cadence_schedule` | `type_id`, `legal_entity_id`, `next_due_at`, `last_version_id`, `status enum(on_time, due_soon, overdue, expired)`, `owner_id` | Computed; drives reminders. |
| `vadp_publication` | `id (vadp_)`, `document_id`, `target_kind enum(public, plan, tenant, brand)`, `target_id`, `published_at`, `published_by`, `revoked_at` | Visibility rows; `per_tenant` requires `target_kind=tenant`. |
| `vada_acknowledgement` | `id (vada_)`, `document_id`, `tenant_id`, `user_id`, `grant_id?`, `kind enum(view, download, pack)`, `at`, `ip_class`, `ua_class`, `purpose`, `watermark_id`, `delivered_sha256` | Evidence for tenant. |
| `vadg_grant` | `id (vadg_)`, `tenant_id`, `grantee_email`, `grantee_org`, `grantee_role`, `scope_document_ids[]` or `scope_preset`, `download_allowed`, `starts_at`, `ends_at (≤ starts_at + trust.grant.max_days)`, `state enum(pending_mc, active, revoked, expired)`, `created_by`, `approved_by`, `revoked_by`, `revoked_at` | Time-boxed access. |
| `vadr_request` | `id (vadr_)`, `tenant_id`, `type_id?`, `description`, `purpose`, `regulator_deadline?`, `state enum(open, acknowledged, in_progress, fulfilled, declined)`, `ticket_ref`, `fulfilled_document_id?`, `sla_ack_due`, `sla_fulfil_due` | Tenant requests. |
| `vadq_answer` | `id (vadq_)`, `question_key`, `frameworks[]`, `answer_text`, `evidence_document_ids[]`, `owner_id`, `reviewed_at`, `review_by`, `state` | Standard answers library. |
| `vadq_questionnaire` | `id`, `tenant_id`, `source_file`, `standard?`, `items[] {question, mapped_answer_id?, draft_text?, draft_run_id?, approved_text?, approver_id?}`, `state`, `released_document_id?` | Responder workflow. |
| `clm_claim` | `id (clm_)`, `claim_text`, `surface enum(trust, website, sales, tutorial, clip)`, `evidence_kind enum(document, metric)`, `evidence_ref`, `valid_until`, `fallback_text`, `state enum(active, flagged, retired)`, `approved_by` | Claims Register. |
| `vad_nda_acceptance` | `tenant_id`, `nda_version`, `accepted_by`, `accepted_at`, `msa_ref?` | Gating prerequisite. |
| `vad_subscription` | `tenant_id`, `user_id`, `type_id?` (null = all), `channels[]` | Update subscriptions. |
| `vad_mirror_document`, `vad_mirror_publication`, `vad_mirror_type` | subset of columns; `synced_at`, `source_event_id` | Product mirrors; read-only. |

IDs follow prefix + ULID; prefixes `vadt_`, `vadp_`, `vada_`, `vadg_`, `vadr_`, `vadq_`, `clm_` are proposed additions to the IPB prefix list (brief lists `vad_`). Business reference for documents: `<ENTITY>-VAD-<YYYY>-<NNNNNN>`.

### 08.4.3 State machine

```
DRAFT ──submit──▶ REVIEW ──approve (checker ≠ maker)──▶ APPROVED ──publish (publisher + confirmer ≠ publisher)──▶ PUBLISHED
  ▲                 │                                      │                                                         │
  │               reject                                   │                                       ┌─────────────────┼─────────────────┐
  └─────────────────┘                                  withdraw                                    ▼                 ▼                 ▼
                                                           │                                   SUPERSEDED         EXPIRED          WITHDRAWN
                                                           ▼                                   (new version       (valid_to        (reason; notice
                                                       WITHDRAWN                                published)         passed)          to acknowledgers)
```

Publication is a second maker-checker step: the publisher sets targets and a confirmer (second role per type) confirms; neither may be the original maker of the version.

Transition rules:

| From → To | Actor | Conditions | Effects |
|---|---|---|---|
| DRAFT → REVIEW | maker (type's maker role or `AGT_` for metadata only) | file uploaded, checksum computed, mandatory metadata present, summary ≤120 words, help key exists | `VendorAssuranceDocumentSubmitted` |
| REVIEW → APPROVED | checker per type, ≠ maker | checker confirms issuer, dates, gating, frameworks | `…Approved` |
| REVIEW → DRAFT | checker | rejection with reason | notify maker |
| APPROVED → PUBLISHED | publisher (SO) + confirmer (second role per type) ≠ publisher | publication targets set; for `per_tenant` at least one tenant target; Claims Register entries created or updated for any claim the document supports | previous version → SUPERSEDED; `…Published`; notifications to subscribers; mirrors updated |
| PUBLISHED → SUPERSEDED | system | newer version PUBLISHED for same type/entity/scope | retained; label |
| PUBLISHED → EXPIRED | system | `valid_to` passed, no supersession | Trust Centre flips claim to fallback; reminders escalate |
| PUBLISHED/APPROVED → WITHDRAWN | SO maker + CS checker | reason recorded (error, revocation by issuer, legal) | mandatory notice to acknowledgers; claims flagged; downloads blocked except for acknowledged tenants' archival copy marked WITHDRAWN |
| any → gating change | SO + CS | never loosens `per_tenant` financials | re-evaluate publications |
| APPROVED → DRAFT *(rev. 26 Oct 2026)* | maker | any change to the file or to approval-relevant metadata (issuer, dates, gating, frameworks, entity, scope) after approval | approval voided; the `…Approved` evidence row is retained; a new checker cycle starts |
| APPROVED → (publish refused) *(rev. 26 Oct 2026)* | system | a newer version of the same type/entity/scope is already PUBLISHED, or `valid_from` is earlier than the current PUBLISHED version's `valid_from` | `IPB-TRUST-015`; the maker withdraws the stale version or rebases it as a new version |
| EXPIRED → (none) *(rev. 26 Oct 2026)* | — | `valid_to` of a published version can never be extended; a new version is required (the cadence engine opens it) | — |
| SUPERSEDED → PUBLISHED (reinstate) *(rev. 26 Oct 2026)* | SO maker + CS checker | the superseding version was WITHDRAWN, the reinstated version is still within `valid_to`, and no other version is PUBLISHED | `…Published` with `reinstated=true`; acknowledgers of the withdrawn version notified; Claims Register re-evaluated |
| REVIEW → WITHDRAWN *(rev. 26 Oct 2026)* | SO maker + CS checker | document must never be published (issuer revocation discovered in review) | as WITHDRAWN, without acknowledger notice |

Scenario walk *(rev. 26 Oct 2026)*:

| Scenario | Expected behaviour |
|---|---|
| Happy path | DRAFT → REVIEW → APPROVED → PUBLISHED; previous version SUPERSEDED; subscribers notified once |
| Failure — checker rejects | REVIEW → DRAFT with reason; file and checksum unchanged; maker edits and resubmits |
| Concurrency — two versions approved | v3 and v4 both APPROVED; v4 PUBLISHED first; publishing v3 is refused `IPB-TRUST-015` |
| Concurrency — withdraw racing download | withdrawal commits first → download returns `IPB-TRUST-001`/`-003`; download commits first → acknowledgement row exists and the mandatory withdrawal notice reaches that acknowledger |
| Rollback | v4 WITHDRAWN within 30 days → v3 reinstated by SO + CS; otherwise the gap is flagged on the cadence calendar and the Trust Centre shows the fallback claim |

### 08.4.4 Tenant screens

1. **Vendor documents list** — grouped by type; filters; status chips; "Request a document"; "Export evidence pack"; "Auditor access" (grants); "Questionnaires".
2. **Document detail** — summary, metadata, framework mapping, version history (tenant-visible versions), checksum, "Download (watermarked)" with purpose field, acknowledgement log for this tenant.
3. **Evidence pack builder** — preset selector, document picker, pack options (include acknowledgement log, include mapping), generate → download; history of packs.
4. **Auditor access** — grants list; create grant (grantee, role, scope, duration ≤ ceiling, download allowed), maker-checker status, activity log, revoke.
5. **Questionnaires** — upload or choose standard; progress (mapped / drafted / under review / released); download released response.
6. **Sub-processors, certifications, status, DPA, incidents, contacts** — tabs within `Security & trust`.

Super-admin screens (OH): Catalogue; Documents (list, detail, new version wizard: type → entity → file → metadata → gating → targets → submit); Cadence calendar; Publications; Acknowledgements (cross-tenant, with tenant filter); Grants (cross-tenant, read); Requests queue; Questionnaire library and queue; Claims Register; Reports.

### 08.4.5 Evidence pack manifest

```json
{
  "pack_id": "vpk_01J...",
  "generated_at": "2026-10-25T09:30:00+05:30",
  "generated_by": {"tenant_id": "ten_...", "user_id": "usr_...", "grant_id": null},
  "tenant_legal_name": "Ratnaa Finance Private Limited",
  "preset": "RBI-OUT-2025-NBFC",
  "documents": [
    {"id": "vad_01J...", "type": "cert_iso27001", "version": "2026.1", "issue_date": "2026-03-10",
     "valid_to": "2029-03-09", "gating": "public", "sha256_original": "…", "sha256_delivered": "…",
     "watermark_id": "vada_01J...", "file": "01_cert_iso27001_2026.1.pdf"}
  ],
  "mapping_file": "mapping.csv",
  "signature": {"alg": "ed25519", "key_id": "infrabyx-trust-2026", "value": "…"},
  "verify_url": "https://trust.<product domain>/verify"
}
```

### 08.4.6 Operations Hub → product mirroring

OH emits Ecosystem events (§08.6.2) on publish, supersession, expiry, withdrawal, gating change and publication target change. Each product's `trust` module subscribes, validates the CloudEvents envelope and signature, and upserts `vad_mirror_*`. Files live once in the shared assurance bucket (`STORAGE_PORT`, Object Lock); products receive the object key and generate watermarked copies on demand through their own `DOCGEN_PORT` adapter. Acknowledgements, grants and requests originate in products and flow to OH as events with idempotency keys; OH is the SoR for those too, but products keep their rows for RLS-scoped tenant display. Daily digest reconciliation (IPB-08-29). When OH is unreachable, products operate from the mirror with the fallback of IPB-08-28; nothing a tenant does is lost, and nothing a tenant sees is stale without a label.

### 08.4.7 Roles and permissions

| Role | May |
|---|---|
| `PLT_SECURITY_OFFICER` | Create/edit drafts of technical documents; approve as checker for technical types; publish with confirmer; manage answers library; review questionnaire drafts; manage catalogue (maker) |
| `PLT_LEGAL_REVIEWER` (CS office) | Create legal/corporate/financial drafts; checker for legal, corporate, financial, policy types; approve catalogue changes; approve withdrawals |
| `PLT_DPO` | Maker for DPIA summaries and sub-processor list; checker for DPA |
| `PLT_SUPER_ADMIN` | View everything; approve financial statement publications jointly with CS; cannot self-approve or bypass maker-checker; manage `trust.*` PLATFORM settings with checker |
| `PLT_RELEASE_MANAGER` | Maker for SBOM, accessibility statement, patch status |
| `PLT_AUDITOR_RO` | Read all documents, acknowledgements, grants; verify checksums; no changes |
| `OPS_SUPPORT` | View requests queue; respond to tickets; no document changes |
| `AGT_VIDHI_TRUST` | Draft metadata, summaries, questionnaire answers; never approve, publish or release |
| `ORG_OWNER`, `ORG_ADMIN` | Tenant view; download; subscribe; request; export pack; create/revoke grants; accept NDA |
| `ORG_AUDITOR_RO` | Tenant view; download; export pack; view acknowledgement log; no grants |
| `ORG_MEMBER` | No access unless granted permission `trust.view` by `ORG_ADMIN` |
| Grantee (external) | Scoped read/download under grant only |

### 08.4.8 Questionnaire responder flow

Upload → parse to items → match to `vadq_answer` by question key and semantic similarity (pgvector) → for matched items propose the library answer with evidence links → for unmatched items Vidhi drafts from library and published documents only (retrieval constrained; `run_id` recorded; labelled "AI draft — not released") → `PLT_SECURITY_OFFICER` reviews each item (accept / edit / decline with reason) → released response assembled as PDF and XLSX → stored as `questionnaire_response` document, `per_tenant`, with acknowledgement on download → new approved answers may be promoted to the library (maker-checker). No response text reaches a tenant without a human approval record per item.

### 08.4.9 Retention and storage

Bucket `infrabyx-assurance` (reference: S3 ap-south-1 with Object Lock compliance mode; adapters for Azure Blob immutability and GCS retention lock), retention `trust.retention.years` (default 10) from supersession/expiry; versions immutable; legal hold supported; cross-region replication to ap-south-2. Acknowledgements and grants in PostgreSQL with append-only ledger entries; purge jobs respect legal hold.

## 08.5 Settings keys

| Key | Tier | Type | Default | Who may change | Maker-checker |
|---|---|---|---|---|---|
| `trust.sor.product` | PLATFORM | const | `OH` | — | n/a |
| `trust.cadence.reminder_days` | PLATFORM | list | `[30, 14, 7, 1]` | `PLT_SECURITY_OFFICER` | yes |
| `trust.cadence.overdue_daily` | PLATFORM | bool | true | `PLT_SECURITY_OFFICER` | yes |
| `trust.gating.nda_version` | PLATFORM | string | current NDA version | `PLT_LEGAL_REVIEWER` | yes |
| `trust.watermark.template` | PLATFORM | string | "Prepared for {tenant} · {email} · {ts} · {ack}" | `PLT_SECURITY_OFFICER` | yes |
| `trust.download.url_ttl_s` | PLATFORM | int ≤300 | 300 | `PLT_SECURITY_OFFICER` | yes |
| `trust.grant.max_days` | PLATFORM | int ≤90 | 90 | `PLT_SECURITY_OFFICER` | yes (cannot exceed 90) |
| `trust.grant.default_days` | TENANT | int ≤ max | 30 | `ORG_ADMIN` | no |
| `trust.grant.require_mc` | TENANT | bool | true | `ORG_OWNER` | yes (turning off) |
| `trust.grant.prospect_max_days` | PLATFORM | int ≤14 | 14 | `PLT_SECURITY_OFFICER` | yes |
| `trust.request.ack_hours` | PLATFORM | int | 24 | `PLT_SECURITY_OFFICER` | yes |
| `trust.request.fulfil_days` | PLATFORM | json `{default:10, regulator_deadline:3}` | as shown | `PLT_SECURITY_OFFICER` | yes |
| `trust.pack.presets` | PLATFORM | json | RBI-OUT-2025-NBFC, RBI-OUT-2025-BANK, RBI-ITG-2023, RBI-DL-2025-LSP, SEBI-CSCRF, IRDAI-OPS-2024, DPDP-PROCESSOR, SIG-LITE, CAIQ | `PLT_SECURITY_OFFICER` | yes |
| `trust.pack.signing_key_id` | PLATFORM | string | `infrabyx-trust-<year>` | `PLT_SECURITY_OFFICER` | yes |
| `trust.mirror.stale_minutes` | PLATFORM | int | 60 | `PLT_RELEASE_MANAGER` | no |
| `trust.mirror.fallback_enabled` | PLATFORM | bool | true (locked) | — | n/a |
| `trust.retention.years` | PLATFORM | int ≥8 | 10 | `PLT_LEGAL_REVIEWER` | yes |
| `trust.claims.enforce` | PLATFORM | bool | true (locked) | — | n/a |
| `trust.trust_centre.enabled` | BRAND | bool | true | `PLT_CONTENT_EDITOR` | yes (disabling) |
| `trust.trust_centre.sections` | BRAND | json | all | `PLT_CONTENT_EDITOR` | no |
| `trust.subprocessors.notice_days` | PLATFORM | int | 30 | `PLT_DPO` | yes |
| `trust.questionnaire.vidhi_draft_enabled` | PLATFORM | bool | true | `PLT_SECURITY_OFFICER` | yes |
| `trust.questionnaire.release_requires_item_approval` | PLATFORM | bool | true (locked) | — | n/a |
| `trust.tenant.view_roles` | TENANT | list | `[ORG_OWNER, ORG_ADMIN, ORG_AUDITOR_RO]` | `ORG_ADMIN` | no |
| `trust.tenant.subscriptions_default` | TENANT | enum `all\|none` | `all` for owners | `ORG_ADMIN` | no |
| `trust.vendor_file.cadence` | PLATFORM | enum | quarterly | `PLT_SECURITY_OFFICER` | no |
| `trust.financials.gating` | PLATFORM | const | `per_tenant` | — | n/a (cannot loosen) |

## 08.6 Events and error codes

### 08.6.1 Internal events (OH `trust` module; products re-emit mirror events under their own prefix)

| Event | Key payload |
|---|---|
| `in.oh.trust.VendorAssuranceDocumentSubmitted.v1` | vad_id, type, entity, version, maker |
| `in.oh.trust.VendorAssuranceDocumentApproved.v1` | vad_id, checker |
| `in.oh.trust.VendorAssuranceDocumentPublished.v1` | vad_id, type, entity, version, gating, targets, sha256, valid_to, supersedes |
| `in.oh.trust.VendorAssuranceDocumentSuperseded.v1` | vad_id, superseded_by |
| `in.oh.trust.VendorAssuranceDocumentExpired.v1` | vad_id, type, entity |
| `in.oh.trust.VendorAssuranceDocumentWithdrawn.v1` | vad_id, reason_class, acknowledger_tenant_count |
| `in.oh.trust.VendorAssuranceGatingChanged.v1` | vad_id, old, new |
| `in.oh.trust.CadenceDue.v1` / `CadenceOverdue.v1` | type, entity, due_at, days |
| `in.<product>.trust.VendorAssuranceDocumentAcknowledged.v1` | vada_id, vad_id, tenant, user, kind, grant_id |
| `in.<product>.trust.VendorEvidencePackExported.v1` | pack_id, tenant, document_ids, preset |
| `in.<product>.trust.VendorDocumentRequested.v1` / `RequestFulfilled.v1` | vadr_id, tenant, type, sla dates |
| `in.<product>.trust.AuditorGrantCreated.v1` / `Approved.v1` / `Revoked.v1` / `Expired.v1` | vadg_id, tenant, grantee_org, scope, ends_at |
| `in.<product>.trust.GranteeAccessDenied.v1` | vadg_id, reason (expired, out_of_scope, revoked) |
| `in.oh.trust.QuestionnaireReleased.v1` | questionnaire_id, tenant, released_document_id |
| `in.oh.trust.ClaimFlagged.v1` / `ClaimRetired.v1` | clm_id, reason |
| `in.<product>.trust.MirrorDigestMismatch.v1` | product, expected, actual |
| `in.oh.trust.NdaAccepted.v1` | tenant, nda_version, accepted_by |

### 08.6.2 Proposed Ecosystem events (cross-product; OH → products and back)

| Proposed event | Direction | Rationale |
|---|---|---|
| `in.infrabyx.trust.VendorAssuranceDocumentPublished.v1` | OH → products | Mirror creation/update; payload as internal Published plus `file_object_key`. |
| `in.infrabyx.trust.VendorAssuranceDocumentStateChanged.v1` | OH → products | Superseded, expired, withdrawn, gating changed, publication targets changed. |
| `in.infrabyx.trust.VendorAssuranceDocumentAcknowledged.v1` | products → OH | Acknowledgements and pack exports with idempotency key. |
| `in.infrabyx.trust.VendorAssuranceRequestOpened.v1` | products → OH | Tenant requests to the OH support queue. |
| `in.infrabyx.trust.AuditorGrantChanged.v1` | products ↔ OH | Grant lifecycle for cross-product visibility and reporting. |
| `in.infrabyx.trust.ClaimRegisterChanged.v1` | OH → products | Claims Register updates for CMS renderers. |

### 08.6.3 Error codes

| Code | Meaning | HTTP | User message pattern |
|---|---|---|---|
| `IPB-TRUST-001` | Document not visible to this tenant (no publication) | 404 | "This document is not available to your organisation. You can request it." |
| `IPB-TRUST-002` | NDA acceptance required for gated document | 403 | "Accept the standard NDA to view this document. Your organisation's owner or admin can do this under Security & trust." |
| `IPB-TRUST-003` | Grant expired, revoked or out of scope | 403 | "This access link has expired or does not cover this document. Ask the organisation that granted access to renew it." |
| `IPB-TRUST-004` | Attempt to render an expired or withdrawn certification as current | build/runtime | "Claim <clm_id> has no current evidence; fallback wording applied." |
| `IPB-TRUST-005` | Maker-checker violation (same person, or super admin bypass) | 403 | "A different approver is required for this step." |
| `IPB-TRUST-006` | Unregistered claim in content | 422 | "This statement asserts a certification or control without a Claims Register entry. Register the claim with evidence." |
| `IPB-TRUST-007` | Download link expired or reused | 410 | "This download link has expired. Open the document again to download." |
| `IPB-TRUST-008` | Grant duration exceeds ceiling | 422 | "Auditor access can be granted for up to 90 days." |
| `IPB-TRUST-009` | Mirror digest mismatch | internal | — |
| `IPB-TRUST-010` | Financial statements gating cannot be loosened | 422 | "Financial statements are available only to named organisations on request." |
| `IPB-TRUST-011` | Questionnaire release blocked: unapproved items | 409 | "<n> answers are not yet approved by the security officer." |
| `IPB-TRUST-012` | Watermark generation failed | 503 | "We could not prepare your watermarked copy. Try again; the problem is logged." |
| `IPB-TRUST-013` | Publication of `per_tenant` document without a tenant target | 422 | "Choose at least one organisation." |
| `IPB-TRUST-014` | Request SLA breached | internal | — |
| `IPB-TRUST-015` | Publish refused: a newer version of this document is already published, or `valid_from` precedes the published version | 409 | "A newer version is already published. Withdraw it or publish this as a new version." |

## 08.7 Product adoption notes

### LD — LawDocs
No vendor assurance feature today. Add the `trust` module mirror and the `Security & trust` node (IPB-07 node 18) with the tenant view; LawDocs tenants are law firms whose own clients (NBFCs, listed companies) may ask them for vendor evidence of their tooling, so the evidence-pack preset "Law firm tooling (DPDP processor)" is useful. Trust Centre on lawdocs.in from the SoR. The accessibility statement is published through this module.

### LDC — LawDocsComply
Has `SCR-ENG-22` (a client-facing compliance evidence screen). Extend it to the full tenant view: acknowledgement log, evidence packs, grants, questionnaires, sub-processors. Because LDC tenants are themselves compliance teams, the framework checklist (IPB-08-21) is the most-used feature; wire it to LDC's own regulation mapping so the client can file the pack into its own compliance calendar. LDC may also *consume* assurance documents from its tenants' other vendors (a GRC feature) — that is a separate LDC module and must not share tables with `vad_mirror_*`.

### EQ — Equator Resolution
No feature today. Add the mirror and tenant view. MII and insurer clients need the SEBI CSCRF and IRDAI presets; court-facing deployments need the GIGW/STQC artefacts from IPB-06 published as `per_tenant` documents. Hearing-recording and transcript handling evidence (data-flow diagram, retention) belongs in the DPDP preset.

### FBX — Finbyx
Has a **due-diligence pack builder** for NBFC clients. Merge it into this standard: its pack becomes the "RBI-OUT-2025-NBFC" preset; its document list becomes catalogue entries; its hand-maintained acknowledgement spreadsheet is replaced by `vada_`. Finbyx-specific types: `rbi_dl_lsp_disclosure` where Finbyx powers an LSP arrangement; CIMS/DLA reporting evidence; e-NACH and bureau connector sub-processors. Bank clients use the "RBI-OUT-2025-BANK" preset. Finbyx must also expose the `exit_plan` and `concentration_statement` types prominently because the 2025 Directions emphasise exit and concentration **[INTERP]**.

### UDF — Udofin
Has a due-diligence pack builder for lender partners. Merge as for FBX; the audience is the lender's compliance team (lender console), never the borrower app. Udofin as LSP publishes the Digital Lending Directions disclosure set (`rbi_dl_lsp_disclosure`), DLA details, data-localisation undertaking, and the grievance-officer details; lenders acknowledge these as part of their LSP due diligence. White-label brand packs show the Trust Centre under the lender's domain only where the lender is the data fiduciary and Infrabyx is named as processor — content remains Infrabyx's claims about Infrabyx.

### OH — Operations Hub
Build OH14.6 as specified: catalogue, documents, cadence engine, publications, acknowledgements, grants, requests, questionnaire library, Claims Register, reports, event emission. OH's own `apps/console` hosts the super-admin menu. OH CRM supplies tenant legal names, MSA/NDA references and the regulated-entity classification (NBFC-BL/ML/UL, bank, co-op, insurer, listed, MII) that drives default presets. OH8 supplies SLA performance for the vendor file. OH controls dashboard shows cadence compliance and SLA breaches.

## 08.8 Acceptance tests

```gherkin
@IPB-08-AT-01 @sor
Feature: Operations Hub is the system of record
  Scenario: Product console cannot create documents
    Given a PLT_SECURITY_OFFICER is logged into the Finbyx console
    When they open Compliance Documents
    Then every document is read-only and there is no "New version" action
    And a direct API call to create a vad_ document in Finbyx returns 405

@IPB-08-AT-02 @mc
Feature: Publishing requires maker-checker
  Scenario: Super admin publishing without a checker
    Given a PLT_SUPER_ADMIN uploads a new SOC 2 report version and submits it
    When the same user attempts to approve it
    Then the system returns "IPB-TRUST-005"
    When the same user attempts to publish it directly
    Then the system returns "IPB-TRUST-005" and the state remains REVIEW
  Scenario: Proper chain
    Given the maker is the security officer and the checker is the legal reviewer
    When the checker approves and a second officer confirms publication
    Then the state is PUBLISHED, the previous version is SUPERSEDED and subscribers are notified

@IPB-08-AT-03 @cadence
Feature: Cadence reminders and overdue status
  Scenario: Half-yearly VAPT summary falls due
    Given the last VAPT summary has valid_from 2026-04-01 and cadence half_yearly
    When the clock reaches 2026-09-01
    Then a reminder is sent to the security officer and super admin (T-30)
    When the clock reaches 2026-10-02 with no new version
    Then the schedule status is overdue, a daily reminder is sent and the item appears on the OH controls dashboard

@IPB-08-AT-04 @expiry @claims
Feature: Expired certification never shown as current
  Scenario: ISO certificate passes valid_to
    Given the ISO/IEC 27001 certificate version 2023.1 has valid_to 2026-10-24 and no new version
    When the clock reaches 2026-10-25
    Then the document state is EXPIRED
    And the Trust Centre shows the claim's fallback wording "ISO/IEC 27001 — recertification in progress" without a badge
    And a ClaimFlagged event is emitted
  Scenario: Unregistered claim blocked in CMS
    Given an editor writes "We are SOC 2 Type II certified" on the pricing page with no clm_ entry
    When the page is published
    Then the publish fails with "IPB-TRUST-006"

@IPB-08-AT-05 @download @watermark
Feature: Watermarked download and acknowledgement
  Scenario: Tenant downloads a login-gated document
    Given user U of tenant "Ratnaa Finance Private Limited" opens the VAPT summary
    When U downloads it with purpose "RBI inspection Nov 2026"
    Then the delivered PDF has a visible watermark on every page containing the tenant name, U's email, the timestamp and the acknowledgement id
    And the PDF metadata contains the acknowledgement id
    And an acknowledgement row records the purpose, the watermark id and the SHA-256 of the delivered file
    And the acknowledgement appears in the tenant's acknowledgement log and export

@IPB-08-AT-06 @nda
Feature: NDA gating
  Scenario: Download without NDA
    Given tenant T has not accepted the standard NDA
    When an ORG_ADMIN of T attempts to download the SOC 2 report (nda-gated)
    Then the response is "IPB-TRUST-002" with a link to accept the NDA
    When the ORG_OWNER accepts the NDA
    Then an NdaAccepted event is recorded and the download succeeds

@IPB-08-AT-07 @pack
Feature: Evidence pack export
  Scenario: RBI NBFC preset
    Given tenant T is classified NBFC-ML
    When an ORG_ADMIN exports the "RBI-OUT-2025-NBFC" preset
    Then a ZIP is produced containing watermarked PDFs, manifest.json, mapping.csv and README.txt
    And the manifest signature verifies against the published key "infrabyx-trust-2026"
    And one acknowledgement of kind "pack" is recorded per included document
    And documents gated per_tenant for other tenants are absent

@IPB-08-AT-08 @grant
Feature: Auditor grant lifecycle
  Scenario: Create and use a grant
    Given an ORG_ADMIN creates a grant for auditor "a@auditfirm.in" scoped to the IS audit report and BCP test report for 30 days
    And trust.grant.require_mc is true
    Then the grant is pending until an ORG_CHECKER approves
    When approved, the auditor receives a magic link and authenticates with OTP
    Then the auditor sees exactly two documents and downloading either records an acknowledgement with the grant id
  Scenario: Grant beyond ceiling
    When an ORG_ADMIN requests a 120-day grant
    Then the system returns "IPB-TRUST-008"
  Scenario: Expired grant use
    Given the grant ends_at has passed
    When the auditor opens the link
    Then access is denied with "IPB-TRUST-003" and a GranteeAccessDenied event is recorded
  Scenario: Revocation
    When the ORG_ADMIN revokes an active grant
    Then the auditor's next request is denied immediately and the revocation appears in the tenant audit trail

@IPB-08-AT-09 @request
Feature: Request additional document with SLA
  Scenario: Regulator deadline
    Given an ORG_ADMIN requests "Data localisation undertaking" with regulator_deadline true
    Then a vadr_ request and an OH ticket are created and the tenant sees status "Open"
    And the acknowledgement SLA is 24 hours and the fulfilment SLA is 3 days
    When the security officer publishes the undertaking per_tenant to T and links it
    Then the request state is fulfilled and the tenant is notified

@IPB-08-AT-10 @adversarial @rls
Feature: Tenant isolation of gated documents
  Scenario: Tenant A attempts to download tenant B's gated document
    Given document D is published per_tenant to tenant B only
    When an ORG_ADMIN of tenant A requests D by its id via the API
    Then the response is 404 "IPB-TRUST-001"
    And no acknowledgement row is created
    And the RLS test harness confirms zero rows of vad_mirror_publication for D visible to tenant A's role
  Scenario: Tenant A enumerates acknowledgements
    When tenant A lists acknowledgements
    Then only tenant A's rows are returned

@IPB-08-AT-11 @adversarial @watermark
Feature: Watermark bypass attempts
  Scenario: Direct object access
    Given an attacker knows the storage object key of a gated document
    When they request the object URL directly
    Then the storage port denies the request (no public access; signed URLs only from the trust module)
  Scenario: Reuse of download link
    Given a single-use signed URL was consumed
    When it is requested again within its TTL
    Then the response is 410 "IPB-TRUST-007"
  Scenario: Original file request
    When a tenant user requests the unwatermarked original
    Then the request is refused; only PLT_AUDITOR_RO may fetch originals for checksum verification and that access is logged

@IPB-08-AT-12 @adversarial @mc
Feature: Gating cannot be loosened for financials
    Given the audited financial statements document is per_tenant
    When a PLT_SECURITY_OFFICER with a checker attempts to change gating to login
    Then the system returns "IPB-TRUST-010"

@IPB-08-AT-13 @questionnaire
Feature: Questionnaire responder with human approval per item
  Scenario: SIG-Lite upload
    Given tenant T uploads a SIG-Lite questionnaire with 120 items
    When processing completes
    Then 95 items are matched to library answers with evidence links and 25 are Vidhi drafts labelled "AI draft — not released" with run ids
    When the security officer approves 110 items and declines 10 with reasons
    Then release is blocked with "IPB-TRUST-011" until every remaining item is approved or declined
    When all items are approved or declined
    Then a questionnaire_response document is published per_tenant to T and downloading it records an acknowledgement

@IPB-08-AT-14 @mirror @fallback
Feature: Product fallback when Operations Hub is offline
  Scenario: OH unreachable
    Given the Finbyx mirror was synchronised 20 minutes ago and OH is unreachable
    When a tenant lists, downloads and requests a document
    Then the list is served from the mirror, the download is watermarked locally and acknowledged with state PENDING_SYNC, and the request is accepted with state PENDING_SYNC
    And the UI shows "Last synchronised 20 minutes ago"
    When OH returns
    Then the acknowledgement and request are delivered exactly once (idempotency key) and states become synced
  Scenario: Digest mismatch
    Given a mirror row differs from OH's publication digest
    When the daily check runs
    Then "IPB-TRUST-009" is raised to the OH controls dashboard

@IPB-08-AT-15 @withdraw
Feature: Withdrawal notifies acknowledgers
    Given 12 tenants acknowledged version 2026.1 of the sub-processor list
    When the security officer (maker) and legal reviewer (checker) withdraw it with reason "error"
    Then every acknowledging tenant receives the mandatory trust.document_withdrawn notice
    And those tenants can still download their archival copy marked WITHDRAWN while new downloads are blocked

@IPB-08-AT-16 @reports
Feature: Regulator-ready vendor file
    Given tenant T is an NBFC-ML with an executed MSA and DPA
    When the super admin generates T's vendor file
    Then the pack contains agreement references, DPA, current certifications, latest VAPT summary, latest BCP/DR test summary, sub-processor list, incident notices to T, SLA performance and T's acknowledgement history
    And it is published per_tenant to T as type vendor_file

@IPB-08-AT-17 @trust_centre
Feature: Trust Centre shows only held certifications
    Given ISO/IEC 42001 is "planned Q2 2027" with no certificate document
    When /trust renders
    Then ISO/IEC 42001 appears under "Planned" with the quarter and no badge
    And no financial statements or VAPT report files are linked

@IPB-08-AT-19 @state @concurrency
Feature: Stale approved version cannot be published
  Scenario: Two approved versions
    Given versions v3 and v4 of the ISO 27001 certificate for Infrabyx Technologies are both APPROVED
    When the publisher publishes v4 with a confirmer
    And the publisher then attempts to publish v3
    Then the second publish is refused with 409 IPB-TRUST-015
    And v3 remains APPROVED until withdrawn or rebased
  Scenario: Metadata edit after approval
    Given version v5 is APPROVED
    When the maker changes valid_to
    Then v5 returns to DRAFT and the approval is recorded as voided

@IPB-08-AT-18 @retention
Feature: Immutability and retention
    When a PLT_SUPER_ADMIN attempts to delete a superseded document file
    Then the storage port refuses (Object Lock compliance mode) and the audit ledger records the attempt
    And the retention policy on the bucket equals trust.retention.years
```

## 08.9 Open items

| ID | Item | Owner | Flag (default OFF) |
|---|---|---|---|
| IPB-OI-08-01 | Verify chapter/paragraph citations of the RBI (NBFC and Commercial Banks – Managing Risks in Outsourcing) Directions 2025 for the framework mapping and help keys. | Company Secretary | — |
| IPB-OI-08-02 | Verify SEBI CSCRF third-party and SBOM provisions and IRDAI 2024 outsourcing clauses to cite in presets. | Company Secretary / counsel | — |
| IPB-OI-08-03 | Confirm DPDP Rules 2025 rule numbers for security safeguards and breach intimation; align `incident_notice_tenant` timing (72-hour follow-up noted in research). | `PLT_DPO` | — |
| IPB-OI-08-04 | Standard NDA text and click-through validity for `nda` gating; whether an MSA confidentiality clause suffices. | CS / counsel | — |
| IPB-OI-08-05 | Choose the ed25519 manifest signing key custody (HSM/KMS) and publish the verification endpoint. | Security officer | `flg_trust_pack_signing` |
| IPB-OI-08-06 | Current SIG-Lite and CAIQ versions and licensing for distributing responses in those formats. | Security officer | `flg_trust_questionnaire` |
| IPB-OI-08-07 | Whether Trust Centre is served under white-label lender domains for Udofin (content remains Infrabyx's). | Owner | `flg_trust_whitelabel` |
| IPB-OI-08-08 | Which Infrabyx legal entity holds each certification; multi-entity scope statements. | Owner / CS | — |
| IPB-OI-08-09 | Prospect grants from the Trust Centre — include in v1 or defer to OH CRM. | Owner | `flg_trust_prospect_grant` |
| IPB-OI-08-10 | Add the proposed `vadt_`, `vadp_`, `vada_`, `vadg_`, `vadr_`, `vadq_`, `clm_`, `vpk_` prefixes to the IPB prefix list (IPB-01 or the brief). | Pack lead | — |
| IPB-OI-08-11 | Retention floor citation (Companies Act 2013 s.128(5); RBI record-keeping) for `trust.retention.years` minimum 8. | Company Secretary | — |
