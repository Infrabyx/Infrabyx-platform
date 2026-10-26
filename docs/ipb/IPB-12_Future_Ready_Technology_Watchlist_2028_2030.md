# IPB-12 — Future-Ready Technology Watchlist 2028–2030  (Infrabyx Platform Baseline Standard v1.0, 25 October 2026)

> **Status:** Binding for LD, LDC, EQ, FBX, UDF, OH unless a product records an `IPB-DEV` deviation.
> **Related:** IPB-01 (reference stack, ports, release cadence), IPB-02 (security baseline: identity, consent, audit hash chain, data classes), IPB-03 (AI Gateway, MCP, provenance), IPB-07 (settings tree and flags), IPB-08 (Trust Centre, SBOM/AIBOM evidence), IPB-09 (engineering governance, release cadence), IPB-10 (API, webhooks, events), IPB-11 (`fut.*` seeded OFF), IPB-13 (artefacts; ADR format for adoption decisions); Ecosystem Spec v1.2 §2 (identity), §3 (events), §5 (data classes), consent part **[VERIFY: section number]**. Research basis: `/home/claude/work/research/R_FutureTech_2028_2030.md` and `R_Standards_Quick_Reference.md` (both 25 Oct 2026). Every date and figure below is taken from those notes; items they mark **[VERIFY]** keep that mark here.
> **Owner decisions applied:** IPB-D-01 (Node 24.22.1 now; 26 via ADR not before Q2 2027), IPB-D-02 (ports with two or more adapters), IPB-D-05 (modular monolith), IPB-D-06 (multi-provider AI).

## 12.1 Purpose and scope

This file converts the research note into a **binding watchlist**. Its job is to make sure that nothing arriving between now and 2030 forces a rewrite: every item lands behind a named feature flag (`fut.<slug>`), on a named port, module or package that already exists in the reference architecture, with a named owner role and a dated adoption trigger.

It does three things:

1. Lists 46 watch items in seven groups, each with what it is, status and source, why it matters and to which products, adoption trigger, flag, architecture touchpoint, owner role, and the risk if ignored.
2. Fixes a **design-now, adopt-later** checklist of ten things the architecture must contain today.
3. Defines the **flag register** and a **yearly review ritual** recorded in decision logs.

Nothing here authorises adopting a technology. Adoption happens through a dated ADR (IPB-13 §13.4.2 format) that cites the trigger event, flips the flag's default, and records the decision as `ADR-FUT-<slug>-<yyyy>`.

## 12.2 Definitions

| Term | Meaning |
|---|---|
| **Watch item** | A technology, standard or regulation expected to affect the products between 2026 and 2030. |
| **Trigger** | The observable event or date after which adoption is evaluated (not after which it is mandatory, unless the item is a law in force). |
| **`fut.<slug>` flag** | An OpenFeature flag (`FEATURE_FLAG_PORT`) registered in `packages/config`, PLATFORM tier, default OFF unless the register says otherwise. A `fut.` flag gates *code paths*; once adopted and stable, the flag is retired and the behaviour becomes default (recorded in the ADR). |
| **Touchpoint** | The port, module or package that absorbs the item with no change to callers. |
| **Owner role** | The platform role (brief §3) or product lead accountable for watching the item and raising the ADR. "FBX lead" and similar denote the product owner in that product's phase files. |
| **Status markers** | **[LAW]** legal text in force; **[INTERP]** our reading; **[REC]** recommendation; **[VERIFY: what, where]** unverified; **[OWNER]** owner decision needed. |
| **Tier (requirements)** | `M` mandatory; `S` should; `O` optional. |

## 12.3 Requirements

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-12-01 | Every watch item in 12.4 has a registered `fut.<slug>` flag in `packages/config` with the default stated in the flag register (12.5), seeded by IPB-11. | M | Flag registry snapshot equals 12.5. |
| IPB-12-02 | Code behind a `fut.` flag is reachable only through the stated touchpoint (port or module); no product module imports a `fut.`-gated implementation directly. | M | Dependency-cruiser rule. |
| IPB-12-03 | Flipping a `fut.` flag default to ON in any environment above `dev` requires an ADR `ADR-FUT-<slug>-<yyyy>` in `docs/decisions/` and a changelog entry; CI checks that the ADR exists when the default changes. | M | CI gate on `flags.defaults.json` diff. |
| IPB-12-04 | The ten design-now items (12.6) are implemented in v1 of every product; a product that cannot records `IPB-DEV-12` with a date. | M | Checklist tests per item. |
| IPB-12-05 | Every signature, hash and key in the platform is created through `packages/crypto` (the crypto-provider module) and records `alg`, `key_id`, `created_at`; no direct `crypto.sign`/`createHash` calls outside it. | M | Lint `@infrabyx/no-direct-crypto`. |
| IPB-12-06 | Every AI output carries provenance and a visible label (IPB-03-53); flag `fut.ai-provenance-label` is ON and may not be turned off. **[LAW]** IT Rules amendment in force 20 Feb 2026. | M | IPB-03-AT-06. |
| IPB-12-07 | The consent aggregate (IPB-02 / Ecosystem Spec consent part) exposes a consent-manager-shaped API behind `fut.dpdp-consent-manager-api` so a registered consent manager can read and write consent records after 13 Nov 2026 **[LAW]** DPDP Rules 2025, Rule 4. | M | API contract tests. |
| IPB-12-08 | CI emits a CycloneDX SBOM and an AIBOM per release (`fut.sbom-aibom-publish` ON); the Trust Centre publishes them to tenants with an NDA gate. | M | Release artefacts present. |
| IPB-12-09 | The yearly review ritual (12.7) runs in the first fortnight of each October (after Node's LTS promotion and before DPDP/CNSA year-end dates), and its outcome is recorded as `DL-FUT-<yyyy>` in the platform decision log. | M | Decision log entry exists each year. |
| IPB-12-10 | Any watch item whose trigger is a dated legal obligation (DPDP, IT Rules, RBI DL, EU AI Act) appears in the compliance calendar (LDC module) with a 90-day and 30-day reminder to the owner role. | M | Calendar seed test. |
| IPB-12-11 | Items marked **[VERIFY]** in 12.4 are re-verified against a primary source at each yearly review; the research note is updated and re-dated. | M | Review minutes list verification results. |
| IPB-12-12 | Products never implement a watch item outside the stated touchpoint "just for now". | M | Architecture review checklist in PR template. |

## 12.4 Watch items

Each item: **What** · **Status/date (source)** · **Why / products** · **Trigger** · **Flag** · **Touchpoint** · **Owner** · **Risk if ignored**.

### 12.4.A Identity and cryptography

**A1. Passkeys as default sign-in**
- What: Synced FIDO2/WebAuthn credentials replacing passwords and OTP.
- Status: FIDO Alliance State of Passkeys 2026 (7 May 2026): ~5 billion passkeys, 75 % of consumers hold one, 68 % of enterprises deploying. Source: https://fidoalliance.org/fido-alliance-reports-accelerating-global-passkey-adoption-on-world-passkey-day-2026/
- Why: SMS OTP is the weakest link for FBX, UDF and LD logins; passkeys remove credential phishing. OH staff passkeys cut reset load. All products.
- Trigger: Now for availability; default for new sign-ups by Q2 2027; `required_for_staff` when OH SSO migrates.
- Flag: `fut.passkeys-default` (availability already ON via `auth.passkeys.enabled`).
- Touchpoint: `IDENTITY_PORT` (Keycloak WebAuthn policy) + `packages/ui` login component; credential table already in IPB-02.
- Owner: PLT_SECURITY_OFFICER.
- Risk if ignored: continued OTP fraud exposure; RBI or SEBI nudges toward phishing-resistant MFA arrive with short notice.

**A2. WebAuthn Level 3 — conditional UI and related origins**
- What: W3C Recommendation adding conditional mediation (autofill), related-origin requests (one passkey across up to five related domains), PRF, hints.
- Status: Recommendation 25 Aug 2026. Source: https://www.w3.org/news/2026/web-authentication-an-api-for-accessing-public-key-credentials-level-3-is-now-a-w3c-recommendation/ ; related origins: https://ppc.land/webauthn-level-3-lets-one-passkey-cover-at-least-five-related-domains/
- Why: One passkey across lawdocs.in, lawdocscomply.com and sibling brands; passwordless login box without a "do you have a passkey?" step. All products; white-label brands (UDF, FBX) via brand host maps.
- Trigger: Conditional UI now; related origins when a second brand shares the IdP.
- Flag: `fut.webauthn-related-origins`; `fut.webauthn-conditional-ui`.
- Touchpoint: `/.well-known/webauthn` served by `IDENTITY_PORT` adapter; login component in `packages/ui`.
- Owner: PLT_SECURITY_OFFICER.
- Risk: duplicate passkey enrolment per brand; poorer conversion on UDF onboarding.

**A3. FAPI 2.0 for partner APIs**
- What: OpenID Financial-grade API profile (PAR, PKCE, DPoP or mTLS sender-constrained tokens).
- Status: Final Feb 2025; conformance tests 9 Jul 2025. Source: https://openid.net/specs/fapi-security-profile-2_0-final.html
- Why: AA, ULI and bank partner APIs converge on FAPI; FBX and LDC partner endpoints (`/partner/*`) should not be re-plumbed later.
- Trigger: first bank or NBFC partner demanding mTLS/DPoP; ULI onboarding.
- Flag: `fut.fapi2-partner-profile`.
- Touchpoint: NestJS API gateway guards in `apps/api/partner`; Keycloak client policies.
- Owner: Platform architect (PLT_RELEASE_MANAGER as flag owner).
- Risk: failed bank security reviews; bespoke per-partner auth.

**A4. Post-quantum signatures (ML-DSA, SLH-DSA) and hybrid signing**
- What: FIPS 204 ML-DSA and FIPS 205 SLH-DSA (Aug 2024); HQC backup KEM selected Mar 2025 **[VERIFY exact date]**; FIPS 206 FN-DSA in draft.
- Status: NIST roadmap and IR 8547 propose deprecating 112-bit classical algorithms by 2030, disallowing by 2035 **[VERIFY against final IR 8547]**. Sources: https://csrc.nist.gov/csrc/media/presentations/2025/nist-pqc-project/nist_pqc_the_road_ahead-moody_1.1.pdf ; https://unveilscan.unveiltech.com/blog/post-quantum-tls.html
- Why: Loan agreements (FBX, UDF), arbitral awards (EQ) and e-signed documents (LD) must stay verifiable for 10–30 years; "harvest now, forge later".
- Trigger: CCA-licensed CA (e.g. eMudhra) issuing ML-DSA certificates; a client questionnaire asking for PQC roadmap.
- Flag: `fut.pqc-hybrid-sign`.
- Touchpoint: `packages/crypto` algorithm registry; signature records store `alg`, `key_id`, `cert_chain_ref`; `DOCGEN_PORT` sidecar signatures.
- Owner: PLT_SECURITY_OFFICER.
- Risk: long-lived documents signed only with RSA/ECDSA; re-signing campaigns later.

**A5. Hybrid TLS key exchange (X25519MLKEM768)**
- What: TLS 1.3 key exchange combining X25519 with ML-KEM-768.
- Status: ~25 % of Chrome TLS 1.3 handshakes; Cloudflare default-on; OpenSSL 3.5+ supports (default off); AWS ALB/NLB added 2025-Q3; ML-DSA WebPKI certificates not before 2027–28. Source: https://unveilscan.unveiltech.com/blog/post-quantum-tls.html
- Why: Near-free PQ confidentiality for all products' traffic; mobile UDF users benefit.
- Trigger: Available now at CDN/ALB — enable.
- Flag: `fut.tls-hybrid-kem` (default ON at edge).
- Touchpoint: Terraform module for CDN/ALB; no application code.
- Owner: PLT_RELEASE_MANAGER.
- Risk: none technical; reputational in security reviews.

**A6. Crypto-agility layer and CBOM**
- What: An algorithm registry, key metadata and Cryptographic Bill of Materials export.
- Status: CERT-In Technical Guidelines on BOM v2.0 (9 Jul 2025) define CBOM alongside SBOM/AIBOM. Source: https://khaitanco.com/thought-leadership/CERT-Ins-Expanded-BOM-Guidelines-Preparing-for-the-Next-Phase-of-Cyber-Regulation
- Why: Prerequisite for A4/A5/A7; bank and government clients will ask for CBOM by 2027–28. All products.
- Trigger: Design now (12.6 item 1); export when first questionnaire asks.
- Flag: `fut.cbom-export`.
- Touchpoint: `packages/crypto` registry → CycloneDX CBOM generator in CI.
- Owner: PLT_SECURITY_OFFICER.
- Risk: inability to answer "where do you use RSA?"; multi-quarter migration later.

**A7. CNSA 2.0 timeline as a proxy for global PQ pace**
- What: NSA's suite and dates: prefer PQ for web/cloud by 2025; new acquisitions support PQ from 1 Jan 2027; exclusive use by 2030 (signing) / 2033 (web, cloud); mandatory 31 Dec 2031.
- Status: Source: https://postquantum.com/security-pqc/nsa-cnsa-2-0-faq-v2-1-update/
- Why: International EQ counterparties and foreign-bank FBX clients will carry these dates into vendor questionnaires by 2028.
- Trigger: 1 Jan 2027 (acquisition date) — add to compliance calendar; first questionnaire.
- Flag: none (process); tracked via `fut.cbom-export`.
- Touchpoint: Trust Centre PQC roadmap page generated from `packages/crypto` registry.
- Owner: PLT_SECURITY_OFFICER.
- Risk: lost international deals on questionnaire grounds.

### 12.4.B Digital identity and verifiable credentials

**B1. DigiLocker consented pull and possible VC-format APIs**
- What: DigiLocker as the dominant Indian document-fetch rail for KYC (Aadhaar, PAN, DL); vendors wrap it as "DigiLocker eKYC". A national W3C-VC programme is **[VERIFY]**, treated as 2028+.
- Status: Source: https://hyperverge.co/blog/power-of-video-kyc-through-c-kyc-and-digilocker/
- Why: FBX and UDF KYC; LD identity for eSign; EQ party verification.
- Trigger: DigiLocker publishes VC-format APIs; vendor contract.
- Flag: `fut.digilocker-pull`; `fut.digilocker-vc`.
- Touchpoint: `credential` table with `format` (`digilocker-xml`, `sd-jwt-vc`, `mdoc`) and `issuer_did`; KYC provider adapter in `packages/connectors`.
- Owner: FBX lead (with PLT_DPO).
- Risk: schema churn when formats change; duplicate KYC stores.

**B2. W3C Verifiable Credentials 2.0 and Digital Credentials API**
- What: VC Data Model 2.0 (Recommendation May 2025); browser-mediated presentation via the Digital Credentials API.
- Status: Sources: https://www.w3.org/press-releases/2025/verifiable-credentials-2-0 ; https://www.w3.org/blog/2025/w3c-digital-credentials-api-publication-the-next-step-to-privacy-preserving-identities-on-the-web
- Why: Clean model for KYC artefacts, arbitrator credentials (EQ), advocate enrolment (LD), and signed awards.
- Trigger: first issuer or verifier partner; EQ neutral-panel credentialing.
- Flag: `fut.vc-verify`.
- Touchpoint: `packages/crypto` (proof verification) + `credential` table; verifier adapter swappable without schema change.
- Owner: PLT_SECURITY_OFFICER.
- Risk: bespoke credential formats per partner.

**B3. EU Digital Identity Wallet (eIDAS 2.0)**
- What: Member States must offer a wallet by end-2026; regulated private relying parties (banks, PSPs) must accept it by end-2027.
- Status: Source: https://virtualbadge.io/blog-articles/verifiable-credentials-and-the-eudi-wallet-practical-timeline
- Why: EQ cross-border matters with EU parties from 2027; FBX foreign-bank clients.
- Trigger: first EQ matter with an EU party; relying-party registration need.
- Flag: `fut.eudi-wallet-verify`.
- Touchpoint: same verifier adapter as B2 (`sd-jwt-vc`, `mdoc` formats).
- Owner: EQ lead (with PLT_LEGAL_REVIEWER).
- Risk: manual identity checks for EU parties; eIDAS non-acceptance.

### 12.4.C Payments and digital public infrastructure

**C1. UPI-linked credit lines**
- What: Pre-sanctioned credit lines drawn through UPI; prudential treatment follows the underlying facility.
- Status: RBI circular DOR.STR.REC.128/21-07-001/2026-27 (23 Jun 2026) for banks, parallel SFB circular; NBFC issuing scope **[VERIFY current RBI position]**. UPI July 2026: 2,365.8 crore transactions, ₹29.87 lakh crore. Sources: https://www.taxmann.com/post/blog/rbi-issues-prudential-norms-for-upi-linked-credit-facilities/ ; https://pib.gov.in/FactsheetDetails.aspx?Id=150962
- Why: FBX LMS must model revolving facilities with per-transaction drawdowns and daily accrual; UDF may distribute bank credit lines.
- Trigger: RBI permits NBFC-issued UPI credit lines, or a bank co-lending partner asks.
- Flag: `fut.upi-credit-line`.
- Touchpoint: FBX loan account `facility_type=revolving` with drawdown ledger (schema present at v1); PSP settlement webhook consumer (Standard Webhooks).
- Owner: FBX lead.
- Risk: ledger redesign under partner deadline.

**C2. UPI Circle (delegated payments) and UPI autopay for collections**
- What: Delegated UPI payments (2024) and recurring mandates.
- Status: Covered in the UPI factsheet above (PIB, July 2026 figures). **[VERIFY: UPI Circle adoption figures]**
- Why: UDF/FBX collections via mandates; family-delegated repayments.
- Trigger: collections product design; partner PSP support.
- Flag: `fut.upi-autopay-collections`.
- Touchpoint: `PAYMENTS_PORT` mandate methods; collections module (human-run; Vidhi locked per IPB-03-71).
- Owner: FBX lead.
- Risk: dependence on eNACH only; higher bounce rates.

**C3. e-Rupee (CBDC) programmable disbursement**
- What: RBI retail CBDC pilot with programmability and offline mode.
- Status: ₹1,016 crore in circulation (Mar 2025), ~7 million users, 17 banks; non-bank PSP wallets since Apr 2024; RBI "in no hurry"; cross-border pilots 2026–27. Source: https://ecorpit.com/programmable-digital-rupee-cbdc-fintech-builder-guide-2026/ **[VERIFY figures against RBI Annual Report 2025-26]**
- Why: Purpose-bound loan proceeds (FBX) is a plausible 2028–30 feature. Low priority.
- Trigger: RBI opens CBDC APIs to NBFC disbursement or ULI includes e₹ rails.
- Flag: `fut.cbdc-rail`.
- Touchpoint: disbursement rail enum (`imps`,`neft`,`upi`,`cbdc`) in FBX; `PAYMENTS_PORT` rail adapter; no schema change.
- Owner: FBX lead.
- Risk: none if the enum exists; otherwise a rail re-model.

**C4. Account Aggregator growth and FIU operations**
- What: RBI-licensed consent-based data sharing (ReBIT specs).
- Status: 390M+ cumulative consents, 21M+/month, 913 FIUs, 17 AAs; ~1 in 10 personal loans; ₹1.47 lakh crore disbursed via AA in H1 FY26; NBFC share ~60 % (FY25). Sources: https://sahamati.org.in/varta-the-sahamati-newsletter-january-2026/ ; https://www.business-standard.com/finance/news/nbfcs-lead-account-aggregator-consents-in-fy25-with-60-share-125100600872_1.html
- Why: De-facto income verification for FBX/UDF; AA consent artefacts overlap with DPDP consent manager rules (Nov 2026).
- Trigger: live; FIU licence or TSP partnership is the gate.
- Flag: `fut.aa-fiu` (ON where licensed).
- Touchpoint: consent aggregate stores AA artefact, purpose code, FI types, expiry; mapped to DPDP consent records (one consent system).
- Owner: FBX lead with PLT_DPO.
- Risk: two consent systems; audit findings.

**C5. RBI Unified Lending Interface (ULI)**
- What: RBIH API gateway for consented data (land records, KYC, GST, satellite, dairy, credit guarantee).
- Status: 64 lenders (41 banks, 23 NBFCs), 136+ data services, 12 journeys (12 Dec 2025); RBI holds no consent or customer data. Sources: https://www.medianama.com/2026/01/223-united-lending-interface-64-lenders-136-data-services/ ; https://www.business-standard.com/india-news/finance-ministry-rbi-discuss-scaling-up-unified-lending-interface-125062300951_1.html
- Why: One adapter replaces dozens of FBX data-provider integrations; NBFC-ML clients will ask.
- Trigger: a client NBFC onboarded to ULI, or RBIH public sandbox.
- Flag: `fut.uli-gateway`.
- Touchpoint: `DataSourceAdapter` abstraction in FBX with ULI as one implementation; ULI consent artefacts alongside AA consents.
- Owner: FBX lead.
- Risk: bespoke integrations multiply.

**C6. ONDC financial services and OCEN**
- What: Beckn-protocol open network with a credit track; OCEN credit protocol.
- Status: ONDC 200M cumulative transactions by Mar 2025; credit on ONDC six lenders live mid-2024 with low volumes; 2026 credit volumes **[VERIFY]**. Sources: https://cxotoday.com/media-coverage/ondc-surpasses-200-million-transactions-with-the-last-100mn-coming-in-just-6-months/ ; https://www.business-standard.com/companies/start-ups/credit-on-ondc-and-ocen-awaits-their-upi-moment-as-deployment-begins-124072400964_1.html
- Why: Distribution channel for UDF; FBX offer engine as Beckn provider.
- Trigger: client wants embedded credit via a buyer app; ONDC credit > ~1 lakh loans/month.
- Flag: `fut.ondc-credit-channel`.
- Touchpoint: offer engine exposes Beckn `search/select/init/confirm` adapter in `packages/connectors`; LOS API unchanged.
- Owner: UDF lead.
- Risk: missed channel; nothing structural.

### 12.4.D Regulation

**D1. DPDP Rules 2025 — consent managers (13 Nov 2026)**
- What: Rule 4 consent-manager registration and obligations (Indian company, net-worth and independence conditions). **[LAW]**
- Status: Rules notified 13 Nov 2025; Rule 4 live 13 Nov 2026. Sources: https://www.hlc.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force- ; https://www.deccanherald.com/amp/story/india%2Fcentre-notifies-dpdp-rules-implementation-planned-in-phases-spread-over-12-18-months-3798465
- Why: All products are data fiduciaries; LDC can sell DPDP tooling; consent manager API shape needed.
- Trigger: dated — now.
- Flag: `fut.dpdp-consent-manager-api`.
- Touchpoint: consent aggregate (IPB-02; Ecosystem Spec consent part) with append-only history and a public consent-manager-shaped API.
- Owner: PLT_DPO.
- Risk: rework when a consent manager asks to integrate.

**D2. DPDP Rules 2025 — substantive duties (13 May 2027)**
- What: Notice/consent, security safeguards, breach intimation ("without delay" then 72-hour follow-up), children's verifiable parental consent, Significant Data Fiduciary duties (India-based DPO, annual DPIA/audit, algorithmic-harm checks), cross-border rules. **[LAW]**
- Status: same sources as D1.
- Why: Consent withdrawal and erasure flows (UDF, FBX); breach runbook; SDF readiness if designated.
- Trigger: dated — 13 May 2027; 90/30-day reminders.
- Flag: `fut.dpdp-consent-ledger` (ON), `fut.dpdp-sdf-controls`.
- Touchpoint: consent aggregate; incident module in OH; LDC algorithmic-harm check template; data-erasure workflow in `packages/workflow`.
- Owner: PLT_DPO.
- Risk: statutory penalties; blocked enterprise deals.

**D3. IT Rules amendment — synthetically generated information**
- What: Prominent labels and permanent provenance metadata for SGI; 3-hour takedown on lawful order. **[LAW]**
- Status: Notified 10 Feb 2026, in force 20 Feb 2026. Sources: https://www.hlc.com/en/publications/india-introduces-mandatory-labelling-for-ai-and-3hour-takedown-for-illegal-content ; https://www.medianama.com/2026/02/223-meity-amendments-it-rules-synthetic-media-deepfakes/
- Why: Every AI draft, summary, image and audio in all products; EQ recordings need tamper-evident provenance; UDF video-KYC deepfakes.
- Trigger: in force.
- Flag: `fut.ai-provenance-label` (ON, not switchable).
- Touchpoint: IPB-03 provenance sidecar and `<AiLabel>`; CMS publish gate; takedown runbook in OH support.
- Owner: PLT_LEGAL_REVIEWER.
- Risk: regulatory exposure; takedown misses.

**D4. RBI (Digital Lending) Directions 2025**
- What: Consolidated digital lending rules: digitally signed KFS with APR, cooling-off 1 or 3 days, multi-lender LSP obligations (digital view of all matching offers, documented matching logic, no dark patterns), data in India, offshore-processed data deleted within 24 hours, nodal grievance officers on every DLA. **[LAW]**
- Status: In force 8 May 2025; CIMS DLA reporting by 15 Jun 2025; multi-lender rules from 1 Nov 2025; no 2026 amendment found **[VERIFY]**. Sources: https://www.legal500.com/developments/thought-leadership/reserve-bank-of-india-digital-lending-directions-2025-brief-overview-analysis/ ; https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=60403
- Why: UDF is an LSP/DLA; FBX generates KFS and must log offer matching.
- Trigger: in force.
- Flag: `fut.dla-multi-lender-view` (ON for UDF), `fut.kfs-digital-sign` (ON).
- Touchpoint: immutable `offer_decision_log`; KFS generator in `DOCGEN_PORT` with APR JSON; grievance officer surface from brand pack.
- Owner: UDF lead.
- Risk: RE partners refuse to integrate; regulatory action against RE.

**D5. RBI Managing Risks in Outsourcing Directions 2025 (banks, NBFCs, payments banks)**
- What: Replaces 2023 IT outsourcing direction; cloud, concentration, exit, sub-contractor lists, 30-day grievance, 6-hour cyber reporting; Chapter IV (IT) applies to NBFC-ML and above. **[LAW]**
- Status: 28 Nov 2025, immediate effect; existing agreements by renewal or 10 Apr 2026. Sources: https://rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13139 ; https://vinodkothari.com/2026/02/it-outsourcing-under-the-rbis-2025-directions-what-has-changed/
- Why: FBX and LDC clients' contract terms (audit access, exit plans, sub-contractor lists, incident reporting into the RE's 6-hour clock).
- Trigger: in force; every bank/NBFC contract.
- Flag: `fut.outsourcing-evidence-pack`.
- Touchpoint: Vendor Assurance Room (OH14.6 → Trust Centre) templates: exit plan, sub-processor list, audit-rights clause, incident SLA.
- Owner: PLT_SECURITY_OFFICER with PLT_LEGAL_REVIEWER.
- Risk: contracts stall at bank legal review.

**D6. SEBI ODR framework revamp**
- What: Proposal to move ODR administration to MIIs, sole arbitrator up to ₹30 lakh, three-member tribunal above, flat ₹6,000 conciliation fee paid by the regulated entity, award within 3 months (+2), 100 % deposit on appeal.
- Status: Consultation 23 Jul 2026; comments closed 13 Aug 2026; effective three months from final circular. Sources: https://taxguru.in/sebi/sebi-proposes-streamlined-online-dispute-resolution-framework-securities-market.html ; https://www.nseindia.com/complaints/online-dispute-resolution
- Why: EQ case flows if empanelled or integrating with an ODR institution.
- Trigger: final circular.
- Flag: `fut.sebi-odr-v2`.
- Touchpoint: EQ scheme-as-data (thresholds, fee schedule, panel rules, timelines) in `EQ_SCHEME_CONFIG_PATH`; no code change.
- Owner: EQ lead.
- Risk: hard-coded thresholds; three-month scramble.

**D7. EU AI Act timeline**
- What: Prohibitions since 2 Feb 2025; GPAI duties since 2 Aug 2025; Article 50 transparency from 2 Aug 2026; Digital Omnibus agreement (6 May 2026) postpones Annex III high-risk to 2 Dec 2027 and Annex I to 2 Aug 2028, pending Official Journal publication.
- Status: Source: https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines/
- Why: "Administration of justice" and credit scoring are Annex III categories; EQ with EU parties and FBX with EU-linked lenders may be in scope. **[INTERP]**
- Trigger: any EU-resident party on EQ; EU client RFP.
- Flag: `fut.eu-ai-act-annex3`.
- Touchpoint: AI system register (LDC) with `risk_class`, human-oversight record, logging; IPB-03 eval evidence.
- Owner: PLT_LEGAL_REVIEWER.
- Risk: inability to serve EU parties; contract clauses unmet.

**D8. ISO/IEC 42001 AI management system**
- What: AI management system standard (2023).
- Status: Axis Bank certified by BSI (ceremony 19 Jan 2026), first financial institution globally per BSI. Source: https://fcms.bsigroup.com/en-IN/insights-and-media/media-centre/press-releases/2026/february/axis-bank-emerges-as-the-first-financial-services-institution-globally-to-receive-bsis-isoiec-42001--certification/
- Why: Bank RFPs will ask vendors for 42001-shaped evidence by 2027; LDC can sell the register.
- Trigger: first bank RFP citing 42001; Infrabyx certification decision **[OWNER]**.
- Flag: `fut.ai-inventory` (ON).
- Touchpoint: AI system register table (`purpose`, `risk_class`, `model`, `data`, `human_oversight`, `eval_results`) in LDC; IPB-03 registry feeds it.
- Owner: PLT_SECURITY_OFFICER.
- Risk: evidence assembled by hand under RFP deadline.

**D9. CERT-In Directions and BOM guidelines (SBOM, AIBOM, CBOM)**
- What: 6-hour incident reporting, 180-day India logs, NTP sync (Direction 28 Apr 2022); BOM Guidelines v2.0 (9 Jul 2025) for government, essential services and software exporters, cascading to suppliers; Cyber Security Audit Policy Guidelines 2025 **[VERIFY date]**.
- Status: Sources: https://nishithdesai.com/research-and-articles/hotline/technology-law-analysis/cyber-security-india-revamps-rules-on-mandatory-incident-reporting-allied-compliances-5507 ; https://khaitanco.com/thought-leadership/CERT-Ins-Expanded-BOM-Guidelines-Preparing-for-the-Next-Phase-of-Cyber-Regulation
- Why: Government and bank procurement will demand SBOM/AIBOM by 2027–28; all products.
- Trigger: first tender asking; any bank contract.
- Flag: `fut.sbom-aibom-publish` (ON).
- Touchpoint: CI (CycloneDX) per release; AIBOM from IPB-03 registry; 180-day WORM logs in `STORAGE_BUCKET_LOGS`.
- Owner: PLT_RELEASE_MANAGER.
- Risk: disqualification from tenders.

### 12.4.E AI

**E1. MCP under the Agentic AI Foundation**
- What: Model Context Protocol (app-to-tool); spec 2026-07-28 made the protocol stateless; donated to the Linux Foundation's Agentic AI Foundation (Dec 2025).
- Status: Source: https://datalakehousehub.com/blog/state-of-agentic-ai-standards-2026
- Why: Expose GRC checks, case lookups and LOS reads once; every client-side agent can use them. All products (IPB-03-75).
- Trigger: first enterprise ask "connect your AI to our data".
- Flag: `fut.mcp-server` (aliases `ai.mcp.server_enabled` per tenant).
- Touchpoint: `packages/vidhi/mcp` server reusing the service layer and Cerbos; one tool per bounded action.
- Owner: Platform architect.
- Risk: bespoke integrations per client AI.

**E2. A2A 1.0 and signed Agent Cards**
- What: Agent-to-agent protocol; 1.0 released Mar 2026 with signed Agent Cards; moved into AAIF Aug 2026; IBM ACP merged into A2A.
- Status: Sources: https://datalakehousehub.com/blog/state-of-agentic-ai-standards-2026 ; https://www.morphllm.com/ai-agent-framework
- Why: EQ agent negotiating with a bank's agent; OH agents coordinating across products. Agent identity is the unresolved fight expected in 2027.
- Trigger: first partner agent integration; agent identity standard settles.
- Flag: `fut.a2a-agent-card`.
- Touchpoint: `/.well-known/agent-card.json` from `packages/vidhi/mcp`; delegation behind `vidhi.a2a.enabled` (IPB-03-68).
- Owner: Platform architect.
- Risk: none now; lock-in to a vendor SDK if adopted early.

**E3. WebMCP and browser-native agent hooks**
- What: WebMCP in Chrome origin trial from Chrome 149.
- Status: Source: same as E1. **[VERIFY: trial status and spec home]**
- Why: Public sites (`apps/public`) and tenant apps could expose page actions to browser agents.
- Trigger: WebMCP reaches stable Chrome and a second engine.
- Flag: `fut.webmcp-page-tools`.
- Touchpoint: `packages/ui` action registry (same manifest as MCP tools).
- Owner: PLT_RELEASE_MANAGER.
- Risk: none.

**E4. On-device and edge AI (WebGPU, WebNN, Chrome built-in APIs, small models)**
- What: Browser-side inference (Transformers.js v3, ONNX Runtime Web), WebNN for NPUs, Chrome Summarizer/Translator/Language Detector stable, Prompt API stable for extensions only.
- Status: Sources: https://blog.openreplay.com/on-device-ai-browser/ ; https://developer.chrome.com/docs/ai
- Why: PII-sensitive classification, redaction and field extraction client-side (LD, FBX, UDF); mid-range Android constraints for UDF.
- Trigger: a sub-1B model passing the accuracy bar for a task; regulatory pressure to minimise server-side PII.
- Flag: `fut.edge-local-inference`.
- Touchpoint: `packages/ai` client-side adapter with hybrid pattern (try local, fall back to Gateway) behind a capability check; privacy claims never assumed from local inference alone.
- Owner: AI lead.
- Risk: none structural.

**E5. Sovereign and small Indian models (IndiaAI Mission)**
- What: Sarvam 30B "Vikram" (32k) and 105B (128k) via API; Gnani.ai Vachana TTS/STT in 12 languages; BharatGen Param2 17B MoE covering 22 scheduled languages, open on Hugging Face; ₹10,000+ crore mission, 12 projects; BharatGen allocation ₹1,058.52 crore.
- Status: Sources: https://www.freepressjournal.in/amp/tech/ai-summit-2026-meet-the-3-sovereign-ai-llm-models-that-were-unveiled-in-delhi-to-rival-global-tech-giants ; https://www.medianama.com/2026/04/223-centre-funds-12-ai-projects-sovereign-models-bharatgen-4x-next-highest-allocation-rs-1000-crore/
- Why: India-resident inference for KYC documents, Hindi notices, EQ transcripts; tenders may prefer sovereign models.
- Trigger: eval scores acceptable; client demands India-hosted inference.
- Flag: `fut.sovereign-model-primary`.
- Touchpoint: IPB-03 registry (`sarvam`, `self_hosted_vllm` adapters); eval harness.
- Owner: AI lead.
- Risk: none; the registry absorbs it.

**E6. Confidential computing for regulated AI**
- What: GPU TEEs (NVIDIA H100/Blackwell confidential mode), Azure NCC H100 v5 GA (~27 % premium), GCP Confidential A3 GA, Google Confidential Space; AWS Nitro Enclaves (CPU only); overhead < 7 % on H100.
- Status: Sources: https://www.buildmvpfast.com/blog/confidential-inference-gpu-tee-founders-guide-2026 ; https://cloud.google.com/blog/products/identity-security/how-confidential-computing-lays-the-foundation-for-trusted-ai/
- Why: Lets a bank accept LLM processing of loan files under RBI outsourcing rules with attestation evidence (FBX); EQ evidence summarisation.
- Trigger: first client whose outsourcing policy forbids plaintext at a third-party model provider.
- Flag: `fut.confidential-inference`.
- Touchpoint: IPB-03 router policy `attestation_required`; attestation report hash stored with each run.
- Owner: PLT_SECURITY_OFFICER.
- Risk: lost bank deal.

**E7. OpenTelemetry GenAI semantic conventions**
- What: `gen_ai.*` spans and metrics; still Development status (July 2026); moved to `semantic-conventions-genai` repo at semconv v1.42.0 (June 2026); `gen_ai.system` replaced by `gen_ai.provider.name`; operations `chat`, `execute_tool`, `invoke_agent`, `invoke_workflow`; content capture opt-in.
- Status: Source: https://dev.to/azena-ai/opentelemetrys-genai-semantic-conventions-are-not-stable-yet-heres-what-actually-shipped-in-2026-3mke
- Why: Token-cost attribution per tenant and feature; audit trail for AI decisions (FBX, EQ).
- Trigger: now (thin wrapper); re-map on Stable release.
- Flag: `fut.otel-genai-stable` (flip when Stable; renames attribute map).
- Touchpoint: `aiTrace()` helper and single attribute map file (IPB-03-50).
- Owner: PLT_RELEASE_MANAGER.
- Risk: rename sweep across code.

**E8. OWASP LLM Top 10 2026, Agentic Top 10, Agent Control Standard**
- What: LLM Top 10 2026 (3 Aug 2026; adds LLM08 Hidden Context Exposure); Agentic Top 10 (Dec 2025; ASI01–ASI10); Agent Control Standard v0.1 (Sept 2026); ASVS 5.0.0 (30 May 2025).
- Status: Sources: https://labs.cloudsecurityalliance.org/research/csa-research-note-owasp-genai-top10-2026-agent-control-stand/ ; https://asvs.owasp.org/
- Why: Bank pen-test acceptance criteria will cite them by 2027; IPB-03 guardrails map to them.
- Trigger: next pen-test scope.
- Flag: `fut.guardrails-v2` (runtime controls).
- Touchpoint: `packages/ai/guard`; MCP tool allow-lists, output schemas, per-tool rate limits.
- Owner: PLT_SECURITY_OFFICER.
- Risk: failed pen-tests.

### 12.4.F Platform and runtime

**F1. Node.js release cadence (24 LTS → 26 → annual from 27)**
- What: Node 24 LTS to Apr 2028; Node 26 enters LTS Oct 2026 (EOL Apr 2029) **[VERIFY promotion date]**; from Node 27 one major per year (Current April, LTS October), ~30-month support; Oct 2026 security releases 24.22.1 / 26.12.1 / 22.23.4.
- Status: Sources: https://nodejs.org/en/about/previous-releases ; https://dev.to/mr_manushukla/one-nodejs-release-a-year-from-2027-what-the-node-27-lts-change-means-for-your-upgrade-cadence-2fo3
- Why: IPB-D-01 pins 24.22.1; 26 only via ADR not before Q2 2027. All products.
- Trigger: Node 26 LTS promotion confirmed; dependency verification green.
- Flag: `fut.node26-runtime` (CI matrix entry, not a runtime flag).
- Touchpoint: `.nvmrc`, `engines`, Dockerfile base, CI matrix, Renovate pin — all generated from one `runtime.json`.
- Owner: PLT_RELEASE_MANAGER.
- Risk: unpatched runtime after Apr 2028.

**F2. Next.js 16.x monthly security cadence**
- What: 16.0 GA 21 Oct 2025; 16.4 (6 Oct 2026) adds lazy compilation, React 19.3, Cache Components; monthly security releases since Jul 2026; out-of-band fixes 22 Sep and 14 Oct 2026.
- Status: Source: https://nextjs.org/blog
- Why: `apps/public`, `apps/web`, `apps/console` in all products.
- Trigger: each security release (patch within 7 days); 17.x via ADR.
- Flag: none; Renovate grouping `next-security`.
- Touchpoint: Renovate config; `packages/ui` compatibility tests.
- Owner: PLT_RELEASE_MANAGER.
- Risk: known-CVE exposure on public sites.

**F3. NestJS 12 (ESM, Vitest, oxlint, Rspack, Standard Schema)**
- What: All packages ESM, Vitest and oxlint defaults, Rspack over webpack, Standard Schema in decorators; v12 targeted early Q3 2026, final GA **[VERIFY]**.
- Status: Source: https://infoq.com/news/2026/04/nestjs-12-roadmap-esm
- Why: `apps/api` and `apps/worker` in all products (IPB-D-05 uses NestJS 11).
- Trigger: NestJS 12 GA plus two minor releases; all shared packages ESM-clean.
- Flag: `fut.nest12-esm` (build matrix).
- Touchpoint: `"type":"module"` dry run in CI; no `require` cycles; Standard Schema adapters for Zod DTOs.
- Owner: PLT_RELEASE_MANAGER.
- Risk: stuck on 11 after its support window; ESM migration under pressure.

**F4. PostgreSQL 18 now, 19 on GA**
- What: 18.0 GA 25 Sep 2025 (18.2 Feb 2026); 19 RC1 15 Oct 2026; PG14 EOL 12 Nov 2026.
- Status: Sources: https://www.postgresql.org/about/newsarchive/pgsql/20260212/ ; https://wz-it.com/en/blog/postgresql-14-end-of-life-upgrade-guide/
- Why: Only database engine (IPB-D-02); RLS and pgvector in all products.
- Trigger: 19 GA (expected Q4 2026 **[VERIFY]**) plus managed-service availability in ap-south-1.
- Flag: `fut.pg19` (CI matrix).
- Touchpoint: Drizzle migrations tested on 18 and 19 in CI; no engine-specific extensions beyond pgvector, pg_trgm, pgcrypto.
- Owner: PLT_RELEASE_MANAGER.
- Risk: missing performance and RLS improvements; EOL drift.

**F5. Temporal Nexus and Worker Versioning**
- What: Replay 2026 (May): Nexus GA for Python, public preview for TypeScript; Worker Versioning GA; multi-region replication GA; OpenAI Agents SDK integration GA.
- Status: Source: https://temporal.io/blog/replay-2026-product-announcements
- Why: Loan lifecycle (FBX), ODR case timers (EQ), Vidhi missions (IPB-03) run on Temporal; Nexus enables cross-namespace calls across products.
- Trigger: Nexus GA for TypeScript.
- Flag: `fut.temporal-nexus`.
- Touchpoint: `packages/workflow` client; cross-product calls remain Ecosystem events until Nexus GA.
- Owner: Platform architect.
- Risk: ad-hoc cross-namespace hacks.

**F6. Expo SDK 57 → 58 (scene-based lifecycle)**
- What: SDK 57 (30 Jun 2026): RN 0.86, React 19.2, prebuild clears native dirs, iOS 27 scene-based lifecycle opt-in; SDK 58 makes it default.
- Status: Source: https://expo.dev/changelog/sdk-57
- Why: UDF app and FBX field app.
- Trigger: SDK 58 release; store policy deadlines.
- Flag: `fut.expo-scene-lifecycle`.
- Touchpoint: `apps/mobile` config (`ios.enableSceneSupport`); EAS profiles.
- Owner: UDF lead.
- Risk: App Store rejection.

**F7. HTTP/3 (QUIC)**
- What: RFC 9114; ~20 % of Cloudflare Radar requests (Q3 2026); Node does not serve HTTP/3 natively.
- Status: Source: https://technologychecker.io/blog/http-protocol-adoption
- Why: Mobile latency for UDF on lossy networks; all public sites.
- Trigger: now at CDN/ALB.
- Flag: `fut.http3-edge` (ON).
- Touchpoint: CDN/ALB Terraform; no in-process QUIC.
- Owner: PLT_RELEASE_MANAGER.
- Risk: none.

**F8. WebTransport**
- What: Bidirectional, low-latency transport over HTTP/3 for browsers, an alternative to WebSockets.
- Status: W3C Working Draft; browser support partial **[VERIFY: W3C status and browser matrix, w3.org/TR/webtransport]**.
- Why: EQ hearing rooms, live collaboration in LD; today WebSockets suffice.
- Trigger: Safari support and a Node-side server library with production maturity.
- Flag: `fut.webtransport`.
- Touchpoint: realtime adapter in `packages/notify` (WebSocket reference adapter; WebTransport as second adapter).
- Owner: EQ lead.
- Risk: none.

**F9. API protocol set — Standard Webhooks 1.0, RFC 9457, RFC 9421, OpenAPI 3.2 / AsyncAPI 3.0**
- What: Standard Webhooks envelope (`webhook-id`, `webhook-timestamp`, `webhook-signature`; HMAC-SHA256 `v1`, ed25519 `v1a`); RFC 9457 Problem Details (Jul 2023, obsoletes 7807 **[VERIFY]**); RFC 9421 HTTP Message Signatures (Feb 2024 **[VERIFY]**); OpenAPI 3.2.0 (19 Sep 2025); AsyncAPI 3.0 (Dec 2023 **[VERIFY]**).
- Status: Sources: https://raw.githubusercontent.com/standard-webhooks/standard-webhooks/main/spec/standard-webhooks.md ; https://www.speakeasy.com/openapi/release-notes
- Why: Partner webhooks (FBX, LDC, EQ), uniform API errors, non-repudiation on partner calls, contract-first docs for MCP tools.
- Trigger: now for Standard Webhooks and RFC 9457; RFC 9421 at first partner needing non-repudiation.
- Flag: `fut.webhooks-standard-envelope` (ON), `fut.api-errors-rfc9457` (ON), `fut.api-signatures-rfc9421`.
- Touchpoint: outbound webhook service in `packages/notify`; NestJS exception filter; gateway middleware; generated OpenAPI from decorators.
- Owner: Platform architect.
- Risk: inconsistent partner integrations.

### 12.4.G Courts and legal infrastructure

**G1. eCourts Phase III and NJDG programmatic access**
- What: Phase III 2023–2027, ₹7,210 crore; ₹2,740.86 crore released by Apr 2026; 32.46 crore cases and 39.79 crore orders on NJDG (Jul 2026); 1.07 crore e-filings by 31 Jan 2026; NJDG linked with CIS 4.0, e-Filing, Virtual Courts, ICJS. Public third-party APIs remain limited **[VERIFY]**.
- Status: Source: https://www.impriindia.com/?p=74271
- Why: LD litigation management (cause lists, order fetch); EQ enforcement tracking.
- Trigger: eCommittee publishes third-party API access or an API Setu listing.
- Flag: `fut.ecourts-api`.
- Touchpoint: court-data adapter in `packages/connectors` with cache and provenance; scraped data never stored as authoritative.
- Owner: LD lead.
- Risk: fragile scraping; legal exposure.

**G2. National e-stamp regime (Indian Stamp Bill)**
- What: Draft Indian Stamp Bill (17 Jan 2024) recognising electronic signatures and paperless e-stamps, civil penalties; not enacted as far as sources show **[VERIFY Parliament status 2026]**. Practice: state e-stamping (SHCIL as CRA in most states), NeSL for bank documents.
- Status: Sources: https://www.mondaq.com/india/commoditiesderivativesstock-exchanges/1433270/stamping-out-antiquity-discussing-the-indian-stamp-bill-2023 ; https://www.leegality.com/blog/digital-stamping-legal-india
- Why: LD eSign and FBX loan-agreement execution need per-state stamp logic.
- Trigger: Bill passage; SHCIL/NeSL uniform API.
- Flag: `fut.stamp-national-regime`.
- Touchpoint: stamp-duty rules in `RULES_PORT` keyed by state and instrument; provider adapters (SHCIL, NeSL, state portals).
- Owner: LD lead.
- Risk: hard-coded state logic.

**G3. Video KYC (V-CIP) deepfake resistance**
- What: RBI KYC Master Direction 2016 (as amended), para 18: face liveness/spoof detection, high-accuracy face match, AI permitted, forged-identity attempts reported as cyber events; Aug 2025 amendment on accessibility of liveness checks for persons with special needs **[VERIFY against RBI Master Direction text]**.
- Status: Source (vendor blog; treat interpretation as opinion): https://hyperverge.co/blog/rbi-video-kyc-deepfake-guidelines/
- Why: UDF and FBX onboarding; SGI labelling duty (D3) for any synthetic content in the loop.
- Trigger: in force.
- Flag: `fut.vcip-liveness-v2`.
- Touchpoint: V-CIP session record (liveness score, face-match score, geo, official ID, vendor model version); pluggable liveness provider in `packages/connectors`.
- Owner: FBX lead.
- Risk: fraud losses; RBI findings.

**G4. ODR market practice and SEBI/RBI scheme convergence**
- What: Scheme-driven ODR (thresholds, fees, panels, timelines) across SEBI (D6), RBI Integrated Ombudsman and institutional rules.
- Status: See D6; RBI scheme details **[VERIFY: current RBI Integrated Ombudsman Scheme terms]**.
- Why: EQ must run several schemes simultaneously as data.
- Trigger: each scheme circular.
- Flag: `fut.odr-scheme-registry` (ON — the registry exists; schemes are added as data).
- Touchpoint: EQ scheme registry; Vidhi never decides outcomes (IPB-03).
- Owner: EQ lead.
- Risk: code forks per scheme.

## 12.5 Flag register (settings keys)

All `fut.*` flags are PLATFORM tier, type bool, changed only by `PLT_RELEASE_MANAGER` with maker-checker by `PLT_SECURITY_OFFICER`, and require an ADR to change the default above `dev` (IPB-12-03).

| Flag | Default | Owner role | Earliest sensible date / trigger | Retire when |
|---|---|---|---|---|
| `fut.passkeys-default` | OFF → ON by Q2 2027 | PLT_SECURITY_OFFICER | Now | Passkeys default for 90 days |
| `fut.webauthn-conditional-ui` | ON | PLT_SECURITY_OFFICER | Now | Stable |
| `fut.webauthn-related-origins` | OFF | PLT_SECURITY_OFFICER | Second brand shares IdP | Stable |
| `fut.fapi2-partner-profile` | OFF | Platform architect | First bank partner | Stable |
| `fut.pqc-hybrid-sign` | OFF | PLT_SECURITY_OFFICER | CA issues ML-DSA (2027+) | 2030 review |
| `fut.tls-hybrid-kem` | ON | PLT_RELEASE_MANAGER | Now | Stable |
| `fut.cbom-export` | OFF | PLT_SECURITY_OFFICER | First questionnaire | Stable |
| `fut.digilocker-pull` | OFF | FBX lead | Vendor contract | Stable |
| `fut.digilocker-vc` | OFF | FBX lead | DigiLocker VC APIs | — |
| `fut.vc-verify` | OFF | PLT_SECURITY_OFFICER | First issuer/verifier partner | — |
| `fut.eudi-wallet-verify` | OFF | EQ lead | First EU party (2027) | — |
| `fut.upi-credit-line` | OFF | FBX lead | RBI/NBFC scope change | — |
| `fut.upi-autopay-collections` | OFF | FBX lead | Collections design | — |
| `fut.cbdc-rail` | OFF | FBX lead | RBI CBDC APIs for NBFCs | — |
| `fut.aa-fiu` | ON where licensed | FBX lead | Now | Stable |
| `fut.uli-gateway` | OFF | FBX lead | Client onboarded to ULI | — |
| `fut.ondc-credit-channel` | OFF | UDF lead | Client demand / volume | — |
| `fut.dpdp-consent-manager-api` | OFF → ON after 13 Nov 2026 | PLT_DPO | 13 Nov 2026 | Stable |
| `fut.dpdp-consent-ledger` | ON | PLT_DPO | Now (before 13 May 2027) | Stable |
| `fut.dpdp-sdf-controls` | OFF | PLT_DPO | SDF designation or 13 May 2027 readiness | — |
| `fut.ai-provenance-label` | ON (locked) | PLT_LEGAL_REVIEWER | In force | Never |
| `fut.dla-multi-lender-view` | ON (UDF) | UDF lead | In force | Stable |
| `fut.kfs-digital-sign` | ON | UDF lead | In force | Stable |
| `fut.outsourcing-evidence-pack` | ON | PLT_SECURITY_OFFICER | In force | Stable |
| `fut.sebi-odr-v2` | OFF | EQ lead | Final SEBI circular | Scheme live |
| `fut.eu-ai-act-annex3` | OFF | PLT_LEGAL_REVIEWER | First EU party; 2 Dec 2027 | — |
| `fut.ai-inventory` | ON | PLT_SECURITY_OFFICER | Now | Stable |
| `fut.sbom-aibom-publish` | ON | PLT_RELEASE_MANAGER | Now | Stable |
| `fut.mcp-server` | OFF (per tenant) | Platform architect | First enterprise ask | Stable |
| `fut.a2a-agent-card` | OFF | Platform architect | Agent identity standard settles | — |
| `fut.webmcp-page-tools` | OFF | PLT_RELEASE_MANAGER | Stable in two engines | — |
| `fut.edge-local-inference` | OFF | AI lead | Model passes eval | — |
| `fut.sovereign-model-primary` | OFF | AI lead | Eval pass | — |
| `fut.confidential-inference` | OFF | PLT_SECURITY_OFFICER | Bank policy | — |
| `fut.otel-genai-stable` | OFF | PLT_RELEASE_MANAGER | Semconv Stable | Stable |
| `fut.guardrails-v2` | ON | PLT_SECURITY_OFFICER | Now | Stable |
| `fut.node26-runtime` | OFF | PLT_RELEASE_MANAGER | Not before Q2 2027 (IPB-D-01) | Node 26 default |
| `fut.nest12-esm` | OFF | PLT_RELEASE_MANAGER | Nest 12 GA + 2 minors | Migrated |
| `fut.pg19` | OFF | PLT_RELEASE_MANAGER | PG 19 GA + managed availability | Migrated |
| `fut.temporal-nexus` | OFF | Platform architect | Nexus TS GA | Stable |
| `fut.expo-scene-lifecycle` | OFF | UDF lead | SDK 58 | Migrated |
| `fut.http3-edge` | ON | PLT_RELEASE_MANAGER | Now | Stable |
| `fut.webtransport` | OFF | EQ lead | Safari + server maturity | — |
| `fut.webhooks-standard-envelope` | ON | Platform architect | Now | Stable |
| `fut.api-errors-rfc9457` | ON | Platform architect | Now | Stable |
| `fut.api-signatures-rfc9421` | OFF | Platform architect | First partner need | — |
| `fut.ecourts-api` | OFF | LD lead | API published | — |
| `fut.stamp-national-regime` | OFF | LD lead | Bill enactment | — |
| `fut.vcip-liveness-v2` | ON (FBX, UDF) | FBX lead | In force | Stable |
| `fut.odr-scheme-registry` | ON | EQ lead | Now | Stable |

Additional non-`fut.` settings introduced by this file:

| Key | Tier | Type | Default | Who may change | Maker-checker |
|---|---|---|---|---|---|
| `eng.watchlist.review_month` | PLATFORM | int | 10 (October) | PLT_RELEASE_MANAGER | No |
| `eng.watchlist.reminder_days` | PLATFORM | int[] | [90, 30] | PLT_RELEASE_MANAGER | No |
| `eng.watchlist.decision_log_prefix` | PLATFORM | string | `DL-FUT` | PLT_RELEASE_MANAGER | No |

## 12.6 Design-now, adopt-later checklist (binding in v1)

| # | Build today | Absorbs later | Verification |
|---|---|---|---|
| 1 | **`packages/crypto` crypto-provider module**: algorithm registry, key metadata (`alg`, `key_id`, `created_at`, `cert_chain_ref`), CBOM export. Nothing calls `crypto.sign` or `createHash` directly. | A4, A5, A6, A7, B2 | Lint rule; CBOM generated in CI |
| 2 | **Consent aggregate** with append-only history, purpose, data categories, notice version, channel, withdrawal; consent-manager-shaped API; AA/ULI consent artefacts stored in the same aggregate. | D1, D2, C4, C5 | API contract tests; one consent system |
| 3 | **Provenance on every AI output**: model, prompt hash, run id, timestamp, signed manifest, visible label. | D3, D7, D8 | IPB-03-AT-06 |
| 4 | **Rail and data-source adapters**: `DataSourceAdapter` (AA, ULI, DigiLocker, CIC) and `DisbursementRail` (IMPS, NEFT, UPI, CBDC enum) interfaces in FBX/UDF with mock adapters. | C1–C6, B1 | Adapter contract tests; `cbdc` enum present |
| 5 | **Passkeys with conditional UI** on the shared login; `/.well-known/webauthn` served by the IdP adapter. | A1, A2 | Login e2e |
| 6 | **MCP server module** reusing the service layer with Cerbos and per-tool rate limits; **OTel GenAI wrapper** (`aiTrace()`) from day one. | E1, E2, E3, E7 | IPB-03 MCP conformance; span tests |
| 7 | **ESM readiness** (no `require` cycles, `"type":"module"` dry run in CI); Node 24 pinned from one `runtime.json`; PostgreSQL 18 with 19 in the CI matrix. | F1, F3, F4 | CI matrix green |
| 8 | **SBOM/AIBOM in CI**, 180-day India-resident WORM logs, 6-hour incident runbook (CERT-In; RBI outsourcing). | D5, D9 | Release artefacts; runbook drill |
| 9 | **AI system register** in LDC (purpose, risk class, model, data, human oversight, eval results) populated from the IPB-03 registry. | D7, D8 | Register rows per skill |
| 10 | **Scheme-as-data** for EQ (thresholds, fees, panels, timelines) and **stamp rules as data** for LD/FBX (state × instrument). | D6, G2, G4 | Scheme loaded from file set; no code constants |

## 12.7 Yearly review ritual

**When:** first fortnight of October each year (Node LTS promotion has happened; DPDP, CNSA and EU AI Act year-end dates are ahead). An interim check in April covers Node Current releases and any regulator circulars with short effective dates.

**Who:** chaired by the PLT_RELEASE_MANAGER; attendees PLT_SECURITY_OFFICER, PLT_DPO, PLT_LEGAL_REVIEWER, platform architect, the six product leads; the owner (Company Secretary) approves the output.

**How:**
1. Re-verify every **[VERIFY]** item against a primary source; update `R_FutureTech_2028_2030.md` with a new "Prepared" date and a diff section.
2. For each watch item: trigger reached? If yes, open an ADR `ADR-FUT-<slug>-<yyyy>` with a decision (adopt, defer, drop) and a date. If no, record "not triggered" with the next check date.
3. Review the flag register: flip defaults only through ADRs; retire flags whose behaviour has been default for ≥ 90 days; add new items (with new `fut.` flags) proposed by any attendee with a source.
4. Re-run the design-now checklist (12.6) across all six products; record any `IPB-DEV-12` deviations and their closure dates.
5. Update the compliance calendar (LDC) with new dated obligations and 90/30-day reminders.
6. Record the whole outcome as decision log entry `DL-FUT-<yyyy>` in `docs/decisions/` (Claude Docs copy per IPB-13), listing: items reviewed, verifications done, ADRs opened, flags changed, deviations, next review date. Publish a one-page summary to the Trust Centre internal view.

**Evidence:** the decision log entry, the ADRs, the updated research note and the flag registry snapshot are stored as `res_` artefacts in the Resources library (IPB-13 §13.4.5) and linked from the Vendor Assurance Room so that bank clients can see a dated technology-roadmap review.

## 12.8 Product adoption notes

### LD — LawDocs
Owns G1 (eCourts), G2 (e-stamp), and benefits from A4 (PQC signatures on e-signed documents) and B2 (advocate credentials). Stamp rules as data from v1; court-data adapter with provenance; never store scraped court data as authoritative. Flags `fut.ecourts-api`, `fut.stamp-national-regime` OFF.

### LDC — LawDocsComply
Owns the AI system register (D7, D8) and the compliance calendar that carries every dated item in this file. Sells DPDP consent tooling (D1, D2) built on the shared consent aggregate. Generates SBOM/AIBOM evidence views (D9) for clients from the Trust Centre feed.

### EQ — Equator Resolution
Strictest regulatory watch: D6 (SEBI ODR), D7 (EU AI Act, "administration of justice"), B3 (EUDI wallet), G4 (scheme registry), F8 (WebTransport for hearing rooms). Scheme-as-data from v1. Every case with an EU-resident party is tagged for Annex III assessment.

### FBX — Finbyx
Most DPI exposure: C1–C5, B1, G3, D4, D5, E6 (confidential inference for banks). Build the rail and data-source adapters (12.6 item 4) with mock implementations in v1; `facility_type=revolving` in the loan model now. FAPI 2.0 (A3) for `/partner/*`.

### UDF — Udofin
D4 (RBI DL 2025) in force: multi-lender view, KFS signing, offer-match log, grievance officers. C6 (ONDC channel) and C2 (UPI autopay) as growth options. F6 (Expo scene lifecycle). E4 (edge inference) for on-device document classification when a small model passes evals. Vidhi never does collections (IPB-03).

### OH — Operations Hub
Hosts the Vendor Assurance Room feed and the incident runbook (D5, D9); runs the yearly review logistics; maintains `runtime.json` and the Renovate policy (F1–F4). Staff passkeys required (`auth.passkeys.required_for_staff`) once SSO migrates (A1).

## 12.9 Acceptance tests

```gherkin
@IPB-12-AT-01
Feature: Every watch item has a registered flag with the documented default
  Scenario: Flag registry snapshot
    Given the platform flag registry is exported
    Then it contains every fut.* flag listed in IPB-12 §12.5
    And each default matches the register
    And fut.ai-provenance-label is ON and marked non-switchable

@IPB-12-AT-02
Feature: Default change requires an ADR
  Scenario: Flip without ADR
    Given a PR changes fut.pqc-hybrid-sign default from OFF to ON in flags.defaults.json
    And no file docs/decisions/ADR-FUT-pqc-hybrid-sign-*.md is added
    When CI runs
    Then the ADR gate fails and names the missing ADR

@IPB-12-AT-03
Feature: No direct cryptography outside packages/crypto
  Scenario: Direct call
    Given a module calls crypto.createSign directly
    When lint runs
    Then rule @infrabyx/no-direct-crypto fails

@IPB-12-AT-04
Feature: Design-now checklist present in each product
  Scenario: Rail enum
    Given the FBX disbursement rail enum
    Then it contains imps, neft, upi and cbdc
    And the cbdc adapter is a mock in all environments while fut.cbdc-rail is OFF

  Scenario: Consent aggregate single store
    Given an AA consent artefact is stored
    Then it appears in the shared consent aggregate with purpose code and expiry
    And no second consent table exists in the product schema

@IPB-12-AT-05
Feature: SBOM and AIBOM per release
  Scenario: Release pipeline
    When a release is cut
    Then a CycloneDX SBOM and an AIBOM listing models, providers and datasets are attached
    And the Trust Centre lists them behind the NDA gate

@IPB-12-AT-06
Feature: Compliance calendar reminders for dated items
  Scenario: DPDP 13 May 2027
    Given the compliance calendar is seeded
    Then an entry exists for 13 May 2027 owned by PLT_DPO
    And reminders are scheduled at 90 and 30 days before

@IPB-12-AT-07
Feature: Yearly review recorded
  Scenario: October review
    Given the review has been held
    Then a decision log entry DL-FUT-<yyyy> exists in docs/decisions/
    And it lists verification results for every [VERIFY] item
    And it is stored as a res_ artefact in the Resources library

@IPB-12-AT-08
Feature: Scheme-as-data for EQ
  Scenario: New SEBI scheme
    Given a new scheme file with thresholds and fees is added to EQ_SCHEME_CONFIG_PATH
    When the service reloads
    Then cases can be opened under the new scheme without a code deployment
```

## 12.10 Open items

| ID | Open item | Owner | Flag (default OFF) |
|---|---|---|---|
| IPB-OI-12-01 | Verify all **[VERIFY]** dates (HQC selection, IR 8547 final, NestJS 12 GA, PG 19 GA, Node 26 LTS promotion, UPI Circle figures, ONDC credit volumes, RBI DL 2026 amendments, Stamp Bill status, WebTransport status, Cyber Security Audit Policy Guidelines date, V-CIP para text) at first review. | PLT_RELEASE_MANAGER | n/a |
| IPB-OI-12-02 | Decide whether Infrabyx seeks ISO/IEC 42001 certification itself or supplies 42001-shaped evidence only. **[OWNER]** | Owner | `fut.ai-inventory` (ON) |
| IPB-OI-12-03 | Choose the PQC-ready CA for document signing once ML-DSA certificates are available in India. | PLT_SECURITY_OFFICER | `fut.pqc-hybrid-sign` |
| IPB-OI-12-04 | Agent identity standard (A2A vs AGNTCY vs vendor) — defer until 2027 fight resolves. | Platform architect | `fut.a2a-agent-card` |
| IPB-OI-12-05 | EU AI Act applicability analysis for EQ and FBX. **[COUNSEL]** | PLT_LEGAL_REVIEWER | `fut.eu-ai-act-annex3` |
| IPB-OI-12-06 | FIU licence vs TSP partnership for AA in FBX/UDF. **[OWNER]** | FBX lead | `fut.aa-fiu` |
| IPB-OI-12-07 | Add items not in the current research (e.g., RBI Integrated Ombudsman scheme changes, GST e-invoice changes for OH8) at the April interim check. | PLT_RELEASE_MANAGER | n/a |
