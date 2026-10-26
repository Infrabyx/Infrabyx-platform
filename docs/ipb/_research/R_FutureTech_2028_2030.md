# Future Technology, Standards and Regulation Watch: 2028–2030

**Scope:** India-first SaaS ecosystem (legal tech, RegTech/GRC, NBFC LOS/LMS, digital lending app, ODR platform, internal operations hub) built as NestJS + Next.js monoliths on PostgreSQL.
**Prepared:** 25 October 2026. Every factual claim cites a source; items not verified against a primary source are marked **[VERIFY]**.
**How to read:** each item gives what it is, status/date, why it matters to these products, the adoption trigger, a suggested feature-flag name and a one-line architecture touchpoint.

---

## 0. Executive summary

| Theme | What changes by 2028–2030 | Architectural posture now |
|---|---|---|
| Identity | Passkeys become the default sign-in; WebAuthn Level 3 is a W3C Recommendation (25 Aug 2026); India's DPDP consent-manager regime goes live 13 Nov 2026 | Ship passkeys behind a flag; model consent as a first-class entity |
| Cryptography | Hybrid ML-KEM TLS is already ~25% of Chrome handshakes; CNSA 2.0 wants browsers/servers PQ-exclusive by 2033; ML-DSA certificates expected 2027–28 | Build a crypto-agility layer (algorithm registry, CBOM) now; do not hard-code RSA/ECDSA anywhere |
| Indian DPI | AA at 390M+ consents; ULI at 64 lenders/136 data services; UPI credit lines now under formal prudential norms (June 2026); e-rupee stays pilot | Treat AA, ULI, UPI as pluggable "rails" adapters with their own flags |
| AI regulation | IT Rules synthetic-media labelling in force since 20 Feb 2026; EU AI Act Annex III high-risk delayed to 2 Dec 2027; OWASP LLM Top 10 2026 and Agentic Top 10 published | Provenance metadata on every AI output; AI inventory and ISO 42001-shaped controls |
| Agent protocols | MCP (stateless 2026-07-28 spec) and A2A 1.0 both under the Linux Foundation's Agentic AI Foundation | Expose internal capabilities as MCP tools; keep agent identity pluggable |
| Runtime | Node 24 LTS to Apr 2028, Node 26 LTS from Oct 2026, annual releases from Node 27; Next.js 16.4; NestJS 12 ESM; PostgreSQL 18 GA, 19 at RC1 | Pin Node 24 LTS now, plan Node 26 in 2027; prepare ESM migration for NestJS 12 |

---

## 1. Identity and authentication

### 1.1 Passkeys / FIDO2

| | |
|---|---|
| What | Phishing-resistant public-key credentials synced across devices, replacing passwords and OTPs. |
| Status | FIDO Alliance estimates ~5 billion passkeys in use; 90% consumer awareness, 75% have one on at least one account, 68% of enterprises deploying for workforce (State of Passkeys 2026, 7 May 2026). Source: https://fidoalliance.org/fido-alliance-reports-accelerating-global-passkey-adoption-on-world-passkey-day-2026/ |
| Why it matters | OTP-over-SMS is the weakest link in NBFC and legal-tech logins; RBI's KYC direction already requires liveness/spoof detection, and passkeys remove credential-phishing from the threat model. Workforce passkeys for the internal ops hub reduce password-reset load. |
| Trigger | >50% of your mobile user base on OS versions with synced passkeys (already true for iOS 16+/Android 9+); any RBI/SEBI nudge toward phishing-resistant MFA. |
| Flag | `auth.passkeys.enabled` (plus `auth.passkeys.required_for_staff`) |
| Touchpoint | NestJS auth module: add a WebAuthn credential table (`credential_id`, `public_key`, `sign_count`, `aaguid`, `backup_eligible`), keep OTP as fallback behind its own flag. |

### 1.2 WebAuthn Level 3 and conditional UI

| | |
|---|---|
| What | The W3C spec that underpins passkeys; Level 3 adds conditional mediation (autofill UI), related-origin requests (one passkey across up to five related domains), PRF and hints. |
| Status | W3C Recommendation on 25 August 2026; new work moves to Level 4. Source: https://www.w3.org/news/2026/web-authentication-an-api-for-accessing-public-key-credentials-level-3-is-now-a-w3c-recommendation/ ; related-origins coverage: https://ppc.land/webauthn-level-3-lets-one-passkey-cover-at-least-five-related-domains/ |
| Why it matters | Related origins let one passkey serve lawdocs.in, lawdocscomply.com and sibling brands; conditional UI means a passkey login box that looks like a normal username field (no "do you have a passkey?" friction). |
| Trigger | Immediately for new login UI; related-origins once a second brand shares the identity provider. |
| Flag | `auth.webauthn.conditional_ui`, `auth.webauthn.related_origins` |
| Touchpoint | Serve `/.well-known/webauthn` listing related origins from the identity service; Next.js login component uses `navigator.credentials.get({mediation:"conditional"})`. |

### 1.3 Verifiable credentials and digital identity wallets

| | |
|---|---|
| What | W3C Verifiable Credentials Data Model 2.0 (Recommendation, May 2025) and the W3C Digital Credentials API for browser-mediated presentation; EU Digital Identity Wallet under eIDAS 2.0 (in force 20 May 2024). |
| Status | VC 2.0: https://www.w3.org/press-releases/2025/verifiable-credentials-2-0 ; Digital Credentials API: https://www.w3.org/blog/2025/w3c-digital-credentials-api-publication-the-next-step-to-privacy-preserving-identities-on-the-web ; EUDI: Member States must offer a wallet by end-2026; regulated private relying parties (banks, PSPs) must accept it by end-2027. Source: https://virtualbadge.io/blog-articles/verifiable-credentials-and-the-eudi-wallet-practical-timeline |
| India | DigiLocker remains the dominant document-fetch rail for KYC (Aadhaar, PAN, DL via consented pull) rather than a W3C-VC issuer; vendors wrap it as "DigiLocker eKYC". Source: https://hyperverge.co/blog/power-of-video-kyc-through-c-kyc-and-digilocker/ . A native India W3C-VC programme at national scale is **[VERIFY]**; treat as 2028+. |
| Why it matters | ODR with foreign parties will meet EUDI-wallet users from 2027; VC-shaped data (issuer, subject, proof, status) is a clean model for KYC artefacts, arbitrator credentials and signed awards. |
| Trigger | First cross-border ODR matter with an EU party; DigiLocker publishing VC-format APIs. |
| Flag | `identity.vc.verify_eudi`, `identity.digilocker.pull` |
| Touchpoint | Store KYC artefacts in a `credential` table with `format` (`digilocker-xml`, `sd-jwt-vc`, `mdoc`) and `issuer_did` columns so a verifier can be swapped without schema change. |

### 1.4 FAPI 2.0

| | |
|---|---|
| What | OpenID Foundation's Financial-grade API security profile (PAR, PKCE, sender-constrained tokens via DPoP or mTLS). |
| Status | FAPI 2.0 Security Profile and Attacker Model approved Final in February 2025; conformance tests released 9 July 2025. Source: https://openid.net/fapi2-0-final-conformance-tests-available/ and https://openid.net/specs/fapi-security-profile-2_0-final.html |
| Why it matters | ULI, AA and any bank partner API are converging on FAPI-grade OAuth. Using FAPI 2.0 for your own partner APIs (LOS webhooks, GRC data exports) avoids re-plumbing later. |
| Trigger | First bank/NBFC partner demanding mTLS or DPoP; ULI onboarding. |
| Flag | `api.oauth.fapi2_profile` |
| Touchpoint | NestJS API gateway: enforce PAR + PKCE + DPoP on `/partner/*` routes; keep plain OAuth for first-party apps. |

---

## 2. Cryptography

### 2.1 Post-quantum cryptography (FIPS 203/204/205, HQC, FIPS 206)

| | |
|---|---|
| What | NIST's finalised PQC standards: FIPS 203 ML-KEM (key encapsulation), FIPS 204 ML-DSA and FIPS 205 SLH-DSA (signatures), finalised August 2024; HQC selected as a backup KEM in March 2025 **[VERIFY exact date]**; FIPS 206 FN-DSA (Falcon) still in draft and excluded from CNSA 2.0. Sources: https://unveilscan.unveiltech.com/blog/post-quantum-tls.html ; https://postquantum.com/security-pqc/nsa-cnsa-2-0-faq-v2-1-update/ ; NIST roadmap: https://csrc.nist.gov/csrc/media/presentations/2025/nist-pqc-project/nist_pqc_the_road_ahead-moody_1.1.pdf |
| Why it matters | Loan agreements, arbitral awards and e-signed documents must remain verifiable for 10–30 years; signatures made today with RSA/ECDSA face "harvest now, decrypt later" and future forgery risk. |
| Trigger | NIST IR 8547 proposes deprecating 112-bit classical algorithms by 2030 and disallowing them by 2035 **[VERIFY against final IR 8547]**; CCA/eMudhra issuing ML-DSA certificates. |
| Flag | `crypto.pqc.sign_hybrid`, `crypto.pqc.kem_hybrid` |
| Touchpoint | Introduce a `crypto-provider` module in NestJS with an algorithm registry; every signature record stores `alg`, `key_id`, `cert_chain_ref`. |

### 2.2 Hybrid TLS (X25519MLKEM768) and HTTP/3

| | |
|---|---|
| What | TLS 1.3 key exchange combining X25519 with ML-KEM-768; HTTP/3 over QUIC (RFC 9114). |
| Status | ~25% of Chrome TLS 1.3 handshakes already use the hybrid; Cloudflare default-on; OpenSSL 3.5+ supports it (provider-loadable, default off); AWS ALB/NLB added it 2025-Q3; ML-DSA WebPKI certificates not expected before 2027–28. Source: https://unveilscan.unveiltech.com/blog/post-quantum-tls.html . HTTP/3 carried ~20% of Cloudflare Radar requests in Q3 2026 (HTTP/2 52%, HTTP/1.x 27%). Source: https://technologychecker.io/blog/http-protocol-adoption |
| Why it matters | Mobile lending app users on flaky networks benefit from QUIC's loss recovery; hybrid TLS is a near-free PQ win at the edge. |
| Trigger | Already available at CDN/edge; enable now. |
| Flag | `edge.http3.enabled`, `edge.tls.hybrid_kem` |
| Touchpoint | Terminate TLS at a CDN/ALB that supports both; Node.js itself does not serve HTTP/3 natively, so do not plan on in-process QUIC. |

### 2.3 CNSA 2.0 timelines and crypto-agility

| | |
|---|---|
| What | US NSA's Commercial National Security Algorithm Suite 2.0 timeline, widely used as a proxy for global PQ migration pace. |
| Status | Prefer CNSA 2.0 for software/firmware signing and web browsers/servers/cloud by 2025; exclusive use by 2030 (signing) and 2033 (web/cloud); new acquisitions must support it from 1 Jan 2027; mandatory across the board 31 Dec 2031. Source: https://postquantum.com/security-pqc/nsa-cnsa-2-0-faq-v2-1-update/ |
| Why it matters | International ODR counterparties and foreign-bank clients will push these dates into vendor questionnaires by 2028. |
| Trigger | First security questionnaire asking for a PQC roadmap or a CBOM. |
| Flag | `crypto.agility.cbom_export` |
| Touchpoint | Generate a Cryptographic Bill of Materials from the crypto-provider registry; CERT-In's BOM Guidelines v2.0 (9 July 2025) already define CBOM. Source: https://khaitanco.com/thought-leadership/CERT-Ins-Expanded-BOM-Guidelines-Preparing-for-the-Next-Phase-of-Cyber-Regulation |

---

## 3. India digital public infrastructure and payments

### 3.1 UPI: credit lines, UPI Circle, scale

| | |
|---|---|
| What | UPI as a funding rail for pre-sanctioned credit lines (since 2023) and delegated payments (UPI Circle, 2024). |
| Status | July 2026: 2,365.8 crore transactions worth ₹29.87 lakh crore, 741 live banks, live in 11 countries. Source: https://pib.gov.in/FactsheetDetails.aspx?Id=150962 . RBI circular DOR.STR.REC.128/21-07-001/2026-27 (23 June 2026) brought UPI-linked credit facilities under the Commercial Banks – Credit Facilities Directions 2025 (prudential treatment follows the underlying facility). Source: https://www.taxmann.com/post/blog/rbi-issues-prudential-norms-for-upi-linked-credit-facilities/ ; parallel SFB circular: https://www.taxmann.com/post/blog/rbi-issues-prudential-norms-for-upi-linked-credit-by-sfbs/ . NBFCs remain outside the issuing scope **[VERIFY current RBI position]**. |
| Why it matters | LMS must handle revolving, UPI-drawn credit lines with per-transaction drawdowns and interest accrual; collections via UPI mandates/autopay. |
| Trigger | RBI permitting NBFC-issued credit lines on UPI, or a bank co-lending partner asking for a UPI credit-line product. |
| Flag | `lms.product.upi_credit_line`, `collections.upi_autopay` |
| Touchpoint | Loan account model needs `facility_type = revolving` with drawdown ledger; webhook consumer for PSP settlement events (Standard Webhooks envelope). |

### 3.2 e-Rupee (CBDC)

| | |
|---|---|
| What | RBI retail CBDC pilot with programmability and offline mode. |
| Status | Retail circulation ₹1,016 crore (Mar 2025), ~7 million users, 17 banks; non-bank PSPs allowed wallets since April 2024; RBI "in no hurry" for full rollout; cross-border pilots (Project Nexus, MAS corridor) planned 2026–27. Source: https://ecorpit.com/programmable-digital-rupee-cbdc-fintech-builder-guide-2026/ **[VERIFY figures against RBI Annual Report 2025-26]** |
| Why it matters | Programmable disbursement (purpose-bound loan proceeds) is a plausible 2028–30 LOS feature; low priority until RBI signals scale. |
| Trigger | RBI opens CBDC APIs to NBFC disbursement or ONDC/ULI includes e₹ rails. |
| Flag | `disbursement.rail.cbdc` |
| Touchpoint | Disbursement service already abstracts rails (IMPS/NEFT/UPI); add `cbdc` as a rail enum, no schema change. |

### 3.3 RBI Unified Lending Interface (ULI)

| | |
|---|---|
| What | RBIH-operated API gateway standardising lender access to consented data (land records, KYC, GST, satellite, dairy, credit-guarantee). |
| Status | 64 lenders (41 banks, 23 NBFCs) and 136+ data services across 12 loan journeys as of 12 Dec 2025; RBI does not hold consent or customer data, so consent/grievance remains the lender's job. Source: https://www.medianama.com/2026/01/223-united-lending-interface-64-lenders-136-data-services/ . Scale-up discussions between FinMin and RBI: https://www.business-standard.com/india-news/finance-ministry-rbi-discuss-scaling-up-unified-lending-interface-125062300951_1.html |
| Why it matters | A single ULI adapter replaces dozens of bespoke data-provider integrations in the LOS; NBFC-ML clients will ask for it. |
| Trigger | A client NBFC is onboarded to ULI, or RBIH publishes a public sandbox. |
| Flag | `los.data.uli_gateway` |
| Touchpoint | Data-provider abstraction (`DataSourceAdapter`) with ULI as one implementation; store ULI consent artefacts alongside AA consents. |

### 3.4 Account Aggregator growth

| | |
|---|---|
| What | RBI-licensed consent-based financial data sharing (ReBIT specs). |
| Status | 390M+ cumulative consents, 21M+/month, 263M+ accounts linked, 177 FIPs, 913 FIUs, 17 AAs; ~1 in 10 personal loans flows through AA; ₹1.47 lakh crore disbursed via AA across 1.5 crore loans in H1 FY26. Source: https://sahamati.org.in/varta-the-sahamati-newsletter-january-2026/ ; NBFC share of consents ~60% in FY25: https://www.business-standard.com/finance/news/nbfcs-lead-account-aggregator-consents-in-fy25-with-60-share-125100600872_1.html |
| Why it matters | AA is the de-facto income-verification rail for digital lending; DPDP consent-manager rules (Nov 2026) will overlap with AA consent artefacts. |
| Trigger | Already live; FIU licence or TSP partnership is the gate. |
| Flag | `los.data.aa_fiu` |
| Touchpoint | Consent store must keep the AA consent artefact, purpose code, FI types and expiry; map these to DPDP consent records to avoid two consent systems. |

### 3.5 ONDC and OCEN

| | |
|---|---|
| What | Open commerce network (Beckn protocol) with a financial-services track; OCEN as a credit protocol. |
| Status | ONDC passed 200M cumulative transactions by March 2025 (https://cxotoday.com/media-coverage/ondc-surpasses-200-million-transactions-with-the-last-100mn-coming-in-just-6-months/); credit on ONDC had six lenders live by mid-2024 with low volumes (https://www.business-standard.com/companies/start-ups/credit-on-ondc-and-ocen-awaits-their-upi-moment-as-deployment-begins-124072400964_1.html). 2026 credit volumes **[VERIFY]**. |
| Why it matters | A distribution channel for the digital lending app; OCEN/Beckn message schemas are JSON and map well to LOS offer/accept flows. |
| Trigger | A client wants embedded credit via a buyer app; ONDC credit volumes exceed, say, 1 lakh loans/month. |
| Flag | `los.channel.ondc_credit` |
| Touchpoint | Offer engine exposes a Beckn-compatible `search/select/init/confirm` adapter; keep LOS internal API unchanged. |

---

## 4. Data protection and cyber law

### 4.1 DPDP Rules 2025: consent managers and phased timelines

| | |
|---|---|
| What | Rules under the Digital Personal Data Protection Act 2023, notified 13 November 2025. |
| Status | Immediate: Board constitution (Rules 1, 2, 17–21). **13 Nov 2026:** consent-manager registration and obligations (Rule 4; Indian company, net-worth and independence conditions). **13 May 2027:** notice/consent, security safeguards, breach intimation (initial "without delay", 72-hour follow-up), children's verifiable parental consent, Significant Data Fiduciary duties (India-based DPO, annual DPIA/audit, algorithmic-harm checks), cross-border rules. Source: https://www.hlc.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force- ; phased rollout reporting: https://www.deccanherald.com/amp/story/india%2Fcentre-notifies-dpdp-rules-implementation-planned-in-phases-spread-over-12-18-months-3798465 |
| Why it matters | Every product is a data fiduciary; the GRC product can sell DPDP compliance tooling; lending apps must support consent withdrawal and erasure flows by May 2027. |
| Trigger | Already dated; begin now. |
| Flag | `privacy.dpdp.consent_ledger`, `privacy.dpdp.consent_manager_api` |
| Touchpoint | A `consent` aggregate (purpose, data categories, notice version, channel, withdrawal) in PostgreSQL with append-only history; a public API shaped so a registered consent manager can read/write it. |

### 4.2 IT Rules amendment: synthetic media labelling and 3-hour takedown

| | |
|---|---|
| What | Amendments to the IT (Intermediary Guidelines) Rules 2021 on synthetically generated information (SGI). |
| Status | Notified 10 February 2026, in force 20 February 2026. SGI must be prominently labelled and carry permanent metadata/provenance markers with a unique identifier linking to the generating resource; SSMIs must collect user declarations and verify them; takedown on lawful order within 3 hours (was 36). Source: https://www.hlc.com/en/publications/india-introduces-mandatory-labelling-for-ai-and-3hour-takedown-for-illegal-content ; MeitY coverage: https://www.medianama.com/2026/02/223-meity-amendments-it-rules-synthetic-media-deepfakes/ |
| Why it matters | AI-drafted notices, summaries and chatbots in legal tech produce SGI; ODR hearing recordings/transcripts need tamper-evident provenance; video-KYC deepfakes are a lending fraud vector. |
| Trigger | Already in force for intermediaries; apply to all AI outputs regardless. |
| Flag | `ai.output.provenance_label` |
| Touchpoint | Every AI-generated artefact stores `generated_by`, `model_id`, `prompt_hash`, C2PA-style manifest or signed JSON sidecar; UI renders a visible label. |

### 4.3 CERT-In Directions and BOM guidelines

| | |
|---|---|
| What | CERT-In Direction of 28 April 2022 (6-hour incident reporting, 180-day logs in India, NTP sync) plus Technical Guidelines on BOM v2.0 (SBOM, CBOM, QBOM, AIBOM, HBOM). |
| Status | Direction unchanged in substance (https://nishithdesai.com/research-and-articles/hotline/technology-law-analysis/cyber-security-india-revamps-rules-on-mandatory-incident-reporting-allied-compliances-5507); BOM Guidelines v2.0 released 9 July 2025, aimed at government, essential services and software exporters, cascading to suppliers (https://khaitanco.com/thought-leadership/CERT-Ins-Expanded-BOM-Guidelines-Preparing-for-the-Next-Phase-of-Cyber-Regulation). Cyber Security Audit Policy Guidelines 2025 exist **[VERIFY date]**: https://www.lawrbit.com/article/comprehensive-cyber-security-audit-policy-guidelines/ |
| Why it matters | Government and bank clients will demand SBOM/AIBOM in procurement by 2027–28; RBI outsourcing directions already push 6-hour reporting to the regulated entity. |
| Trigger | First tender asking for SBOM/AIBOM; any bank client contract. |
| Flag | `supplychain.sbom_publish`, `supplychain.aibom_publish` |
| Touchpoint | CI generates CycloneDX SBOM per release and an AIBOM listing models, datasets and providers; store 180-day logs in an India-region bucket with WORM. |

### 4.4 RBI Digital Lending Directions 2025

| | |
|---|---|
| What | Consolidated digital lending rules for REs and their LSPs. |
| Status | Issued and in force 8 May 2025; DLA reporting on CIMS by 15 June 2025; multi-lender LSP obligations from 1 November 2025 (digital view of all matching offers, no dark patterns, documented matching logic); digitally signed KFS with APR; cooling-off of 1 or 3 days; data in India, offshore-processed data deleted within 24 hours; nodal grievance officers of RE and LSP on every DLA. Source: https://www.legal500.com/developments/thought-leadership/reserve-bank-of-india-digital-lending-directions-2025-brief-overview-analysis/ ; RBI press release: https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=60403 . No 2026 amendment found in sources reviewed **[VERIFY]**. |
| Why it matters | The lending app is an LSP/DLA; the LOS must generate KFS, enforce cooling-off and log offer-matching logic for audit. |
| Trigger | In force. |
| Flag | `dla.multi_lender_view`, `los.kfs.digital_sign` |
| Touchpoint | Offer-matching service writes an immutable `offer_decision_log`; KFS generator produces a signed PDF with APR computation stored as JSON. |

### 4.5 Video KYC changes

| | |
|---|---|
| What | V-CIP under RBI KYC Master Direction 2016 (as amended). |
| Status | Para 18 requires face liveness/spoof detection and face matching with high accuracy; AI may be used; forged-identity attempts must be reported as cyber events; an August 2025 amendment addresses accessibility of liveness checks for persons with special needs. Source (vendor blog quoting the Direction; treat interpretations as opinion): https://hyperverge.co/blog/rbi-video-kyc-deepfake-guidelines/ **[VERIFY against RBI Master Direction text]** |
| Why it matters | Deepfake-resistant V-CIP is now table stakes; the IT Rules SGI amendment adds a labelling duty for any synthetic content in the loop. |
| Trigger | In force. |
| Flag | `kyc.vcip.liveness_v2` |
| Touchpoint | V-CIP session record stores liveness score, face-match score, geo, official ID and the vendor model version; pluggable liveness provider interface. |

---

## 5. AI: sovereign models, agents, edge, confidential compute, governance

### 5.1 IndiaAI Mission and sovereign LLMs

| | |
|---|---|
| What | ₹10,000+ crore mission funding 12 sovereign model projects; three model families unveiled at the AI Impact Summit, Delhi (Feb 2026). |
| Status | Sarvam: 30B ("Vikram", 32k context) and 105B (128k) models via API; Gnani.ai Vachana TTS/STT in 12 Indian languages; BharatGen Param2 17B MoE covering all 22 scheduled languages, open on Hugging Face. Source: https://www.freepressjournal.in/amp/tech/ai-summit-2026-meet-the-3-sovereign-ai-llm-models-that-were-unveiled-in-delhi-to-rival-global-tech-giants . BharatGen allocation ₹1,058.52 crore (largest); Sarvam and Soket described as open-source; models available on AIKosh. Source: https://www.medianama.com/2026/04/223-centre-funds-12-ai-projects-sovereign-models-bharatgen-4x-next-highest-allocation-rs-1000-crore/ |
| Why it matters | Data-localisation-friendly inference for KYC documents, Hindi/regional-language notices and ODR transcripts; government tenders may prefer sovereign models. |
| Trigger | Sovereign model reaches acceptable quality on your eval set; client demands India-hosted inference. |
| Flag | `ai.provider.sovereign_primary` |
| Touchpoint | Model-router with provider abstraction (OpenAI-compatible endpoints); evaluation harness per task; store `model_id` on every output. |

### 5.2 AI agent protocols (MCP, A2A, AGNTCY, OpenAI Agents SDK, Claude Agent SDK)

| | |
|---|---|
| What | MCP (app-to-tool), A2A (agent-to-agent), AGNTCY (Cisco-led agent directory/identity), vendor SDKs. |
| Status | Agentic AI Foundation formed under the Linux Foundation in December 2025 (MCP, goose, AGENTS.md donated); A2A 1.0 released March 2026 with signed Agent Cards and moved into AAIF in August 2026; MCP spec 2026-07-28 made the protocol stateless; WebMCP in Chrome origin trial from Chrome 149. Source: https://datalakehousehub.com/blog/state-of-agentic-ai-standards-2026 . OpenAI Agents SDK (Mar 2025; Python/TS; MCP adopted); Claude Code SDK renamed Claude Agent SDK in early 2026; IBM ACP merged into A2A. Source: https://www.morphllm.com/ai-agent-framework . AGNTCY status **[VERIFY]**. |
| Direction | Layered stack is settling: MCP for tools, A2A for delegation; agent identity is the unresolved standards fight expected in 2027. |
| Why it matters | Expose GRC checks, case lookups and LOS actions as MCP tools once and every client-side agent (Claude, ChatGPT, Copilot) can use them; A2A lets your ODR agent negotiate with a bank's collections agent. |
| Trigger | First enterprise client asking for "connect your AI to our data"; internal ops hub adopting an agent runtime. |
| Flag | `ai.mcp.server_enabled`, `ai.a2a.agent_card` |
| Touchpoint | NestJS module exposing MCP over Streamable HTTP with OAuth, reusing existing service layer and RBAC; one tool per bounded action, never raw SQL. |

### 5.3 On-device / edge AI (WebGPU, WebNN, small language models)

| | |
|---|---|
| What | Browser-side inference via WebGPU; WebNN for NPU access; Chrome built-in Gemini Nano APIs; Edge's Phi-4-mini. |
| Status | WebGPU broadly supported but still needs feature detection; WebNN partial in Chrome; Chrome Summarizer/Translator/Language Detector stable, Prompt API stable for extensions only; Transformers.js v3 and ONNX Runtime Web run quantised models of tens to hundreds of MB. Source: https://blog.openreplay.com/on-device-ai-browser/ ; Chrome docs: https://developer.chrome.com/docs/ai |
| Why it matters | PII-sensitive tasks (document classification, redaction, field extraction) can run client-side, keeping raw data off servers; useful for the Expo lending app on mid-range Android only when model size is small. |
| Trigger | A task with a sub-1B model that passes your accuracy bar; regulatory pressure to minimise server-side PII. |
| Flag | `ai.edge.local_inference` |
| Touchpoint | Next.js: hybrid pattern (try local, fall back to server) behind a capability check; never assume privacy from local inference alone. |

### 5.4 Confidential computing for regulated AI

| | |
|---|---|
| What | GPU trusted execution environments (NVIDIA H100/Blackwell confidential mode), Azure NCC H100 v5, GCP Confidential A3, Google Confidential Space; AWS Nitro Enclaves (CPU only). |
| Status | Azure confidential H100 GA (~27% price premium), GCP Confidential A3 GA, Blackwell G4 preview; measured overhead under 7% on H100, near-zero on Blackwell. Source: https://www.buildmvpfast.com/blog/confidential-inference-gpu-tee-founders-guide-2026 ; Google positioning: https://cloud.google.com/blog/products/identity-security/how-confidential-computing-lays-the-foundation-for-trusted-ai/ |
| Why it matters | Lets a bank client accept LLM processing of loan files under RBI outsourcing rules with attestation evidence; relevant for ODR evidence summarisation. |
| Trigger | First client whose outsourcing policy forbids plaintext data at a third-party model provider. |
| Flag | `ai.inference.confidential_only` |
| Touchpoint | Model-router adds `attestation_required` policy; store attestation report hash with each inference log. |

### 5.5 ISO/IEC 42001 and EU AI Act timeline

| | |
|---|---|
| What | ISO/IEC 42001:2023 AI management system standard; EU AI Act obligations. |
| Status | Axis Bank certified to ISO/IEC 42001 by BSI (ceremony 19 Jan 2026), first financial institution globally per BSI. Source: https://fcms.bsigroup.com/en-IN/insights-and-media/media-centre/press-releases/2026/february/axis-bank-emerges-as-the-first-financial-services-institution-globally-to-receive-bsis-isoiec-42001--certification/ . EU AI Act: prohibitions since 2 Feb 2025; GPAI duties since 2 Aug 2025; Article 50 transparency from 2 Aug 2026; Digital Omnibus agreement (6 May 2026) postpones Annex III high-risk to 2 Dec 2027 and Annex I to 2 Aug 2028, pending Official Journal publication. Source: https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines/ |
| Why it matters | "Administration of justice and democratic processes" and credit scoring are Annex III high-risk categories; an ODR platform with AI-assisted settlement proposals serving EU parties would be in scope from Dec 2027. Indian banks will ask vendors for 42001-shaped evidence. |
| Trigger | Any EU-resident party on the ODR platform; bank RFP citing 42001. |
| Flag | `governance.ai_inventory`, `governance.ai_risk_class` |
| Touchpoint | AI system register table (`purpose`, `risk_class`, `model`, `data`, `human_oversight`, `eval_results`) that the GRC product can also sell. |

### 5.6 OWASP ASVS 5.0, LLM Top 10 2025/2026, Agentic Top 10

| | |
|---|---|
| What | Application security verification standard; GenAI risk lists. |
| Status | ASVS 5.0.0 stable release 30 May 2025 (https://asvs.owasp.org/). OWASP Top 10 for LLM Applications 2026 published 3 Aug 2026 (adds LLM08 Hidden Context Exposure); Top 10 for Agentic Applications published December 2025 (ASI01–ASI10: goal hijacking, tool misuse, identity/privilege abuse, cascading failures); Agent Control Standard v0.1 unveiled Sept 2026. Source: https://labs.cloudsecurityalliance.org/research/csa-research-note-owasp-genai-top10-2026-agent-control-stand/ |
| Why it matters | Pen-test acceptance criteria for bank clients will reference ASVS 5 and LLM Top 10 by 2027. |
| Trigger | Next pen-test scope. |
| Flag | n/a (process), but `ai.guardrails.v2` for runtime controls |
| Touchpoint | Map ASVS 5 L2 to NestJS guards/interceptors; MCP tools get allow-lists, output schemas and per-tool rate limits. |

### 5.7 OpenTelemetry GenAI semantic conventions

| | |
|---|---|
| What | Standard span/metric names for LLM and agent calls (`gen_ai.*`). |
| Status | Still "Development" (not Stable) as of July 2026; moved to a separate `semantic-conventions-genai` repo at semconv v1.42.0 (June 2026); `gen_ai.system` replaced by `gen_ai.provider.name`; operations include `chat`, `execute_tool`, `invoke_agent`, `invoke_workflow`; content capture opt-in. Source: https://dev.to/azena-ai/opentelemetrys-genai-semantic-conventions-are-not-stable-yet-heres-what-actually-shipped-in-2026-3mke |
| Why it matters | Token-cost attribution per tenant and per feature; audit trail for AI decisions in lending and ODR. |
| Trigger | Now, with a thin wrapper so renames are one-line changes. |
| Flag | `otel.genai.capture_content` (default off) |
| Touchpoint | Single `aiTrace()` helper in NestJS emitting current attribute names; export to your OTel collector. |

---

## 6. API, event and security protocols

| Item | Status | Why / trigger | Flag | Touchpoint |
|---|---|---|---|---|
| HTTP/3 | RFC 9114; ~20% of requests at Cloudflare edge (Q3 2026). Source: https://technologychecker.io/blog/http-protocol-adoption | Mobile latency; enable at CDN now | `edge.http3.enabled` | CDN config only |
| Standard Webhooks 1.0 | `webhook-id`, `webhook-timestamp`, `webhook-signature` (HMAC-SHA256 `v1`, ed25519 `v1a`). Source: https://raw.githubusercontent.com/standard-webhooks/standard-webhooks/main/spec/standard-webhooks.md | Partner webhooks for LOS/GRC; adopt now | `webhooks.standard_envelope` | Outbound webhook service |
| RFC 9457 Problem Details | Published July 2023 (obsoletes RFC 7807) **[VERIFY]** | Uniform API errors across monoliths | `api.errors.rfc9457` | NestJS exception filter |
| RFC 9421 HTTP Message Signatures | Published Feb 2024 **[VERIFY]** | Non-repudiation on partner API calls | `api.signatures.rfc9421` | Gateway middleware |
| OpenAPI 3.2.0 / AsyncAPI 3.0 | OpenAPI 3.2.0 released 19 Sep 2025 (https://www.speakeasy.com/openapi/release-notes); AsyncAPI 3.0 Dec 2023 **[VERIFY]** | Contract-first docs for MCP tools and webhooks | n/a | Generate from NestJS decorators |

---

## 7. Legal and justice infrastructure (India)

### 7.1 eCourts Phase III and NJDG

| | |
|---|---|
| Status | Phase III 2023–2027, ₹7,210 crore; ₹2,740.86 crore released by April 2026; 32.46 crore cases and 39.79 crore orders accessible on NJDG (July 2026); 1.07 crore e-filings by 31 Jan 2026; 660 crore pages digitised; 30 virtual courts; NJDG linked with CIS 4.0, e-Filing, Virtual Courts and ICJS. Source: https://www.impriindia.com/?p=74271 . Public programmatic APIs for third parties remain limited **[VERIFY]**. |
| Why it matters | Litigation-management features (cause lists, order fetch) depend on scraping or eCourts services; an official API would change the architecture. |
| Trigger | eCommittee publishes third-party API access or an API Setu listing. |
| Flag | `litigation.ecourts_api` |
| Touchpoint | Court-data adapter with cache and provenance; never store scraped data as authoritative. |

### 7.2 National e-stamp developments

| | |
|---|---|
| Status | Draft Indian Stamp Bill (released 17 Jan 2024) would recognise electronic signatures and paperless e-stamps and replace criminal penalties with civil penalties; not yet enacted as far as sources show. Source: https://www.mondaq.com/india/commoditiesderivativesstock-exchanges/1433270/stamping-out-antiquity-discussing-the-indian-stamp-bill-2023 **[VERIFY Parliament status 2026]**. Practice today relies on state e-stamping (SHCIL as CRA in most states) and NeSL for bank documents. Source: https://www.leegality.com/blog/digital-stamping-legal-india |
| Why it matters | LawDocs eSign and loan-agreement execution need per-state stamp logic; a national regime would simplify it. |
| Trigger | Bill passage; or SHCIL/NeSL exposing a uniform API. |
| Flag | `esign.stamp.national_regime` |
| Touchpoint | Stamp-duty rules engine keyed by state and instrument; provider adapters (SHCIL, NeSL, state portals). |

### 7.3 SEBI ODR framework

| | |
|---|---|
| Status | SEBI consultation (23 July 2026) proposes shifting ODR administration to MIIs, sole arbitrator up to ₹30 lakh, three-member tribunal above, flat ₹6,000 conciliation fee paid by the regulated entity, award within 3 months (+2), 100% deposit on appeal; comments closed 13 Aug 2026; effective three months from final circular. Source: https://taxguru.in/sebi/sebi-proposes-streamlined-online-dispute-resolution-framework-securities-market.html ; NSE ODR page: https://www.nseindia.com/complaints/online-dispute-resolution |
| Why it matters | If the ODR platform is or integrates with an empanelled ODR institution, its case flows must follow SEBI's thresholds, fee tables and timelines. |
| Trigger | Final circular. |
| Flag | `odr.scheme.sebi_v2` |
| Touchpoint | Scheme-driven case workflow (thresholds, fee schedule, panel rules as data, not code). |

---

## 8. Runtime and framework status (as at 25 Oct 2026)

| Item | Status | Source | Action |
|---|---|---|---|
| Node.js 24 (LTS "Krypton") | Latest LTS v24.22.1 (20 Oct 2026); EOL expected April 2028 | https://nodejs.org/en/about/previous-releases ; https://dev.to/mr_manushukla/one-nodejs-release-a-year-from-2027-what-the-node-27-lts-change-means-for-your-upgrade-cadence-2fo3 | Pin 24.x in production now |
| Node.js 26 | v26.12.1 (21 Oct 2026) listed as "Current"; scheduled to enter LTS October 2026, EOL April 2029 | same | Adopt in 2027 after LTS promotion **[VERIFY promotion date]** |
| October 2026 security release | Node blog links a "Wednesday, October 21, 2026 Security Releases" post; 24.22.1 / 26.12.1 / 22.23.4 dated 20–21 Oct 2026 | https://nodejs.org/en/about/previous-releases ; July release for context: https://nodejs.org/pt/blog/vulnerability/july-2026-security-releases | Patch immediately; the July release fixed 11 CVEs incl. HTTP/2 and Permission Model issues |
| Release model | From Node 27: one major per year (Current April, LTS October), 6-month alpha from Oct 2026, ~30-month support | same dev.to source | Budget one Node upgrade per year |
| Next.js 16 | 16.0 GA 21 Oct 2025; 16.4 (6 Oct 2026) adds lazy compilation, React 19.3, Cache Components; monthly security releases since July 2026; out-of-band fixes 22 Sep and 14 Oct 2026 | https://nextjs.org/blog | Track `next@16.4.x`; subscribe to security feed |
| NestJS 11 / 12 | v11 current (11.1.x); v12 targeted early Q3 2026: all packages ESM, Vitest and oxlint defaults, Rspack over webpack, Standard Schema in decorators; final GA **[VERIFY]** | https://infoq.com/news/2026/04/nestjs-12-roadmap-esm | Start ESM readiness (no `require` cycles, `"type":"module"` dry run) |
| PostgreSQL 18 / 19 | 18.0 GA 25 Sep 2025 (18.2 in Feb 2026); 19 RC1 on 15 Oct 2026; PG14 EOL 12 Nov 2026 | https://www.postgresql.org/about/newsarchive/pgsql/20260212/ ; https://wz-it.com/en/blog/postgresql-14-end-of-life-upgrade-guide/ | Run 18 now; evaluate 19 after GA (expected Q4 2026 **[VERIFY]**) |
| Temporal | Replay 2026 (May): Nexus GA for Python, public preview for TypeScript; Worker Versioning GA; multi-region replication GA; OpenAI Agents SDK integration GA | https://temporal.io/blog/replay-2026-product-announcements | Use for loan lifecycle and ODR case timers; wait for TS Nexus GA before cross-namespace calls |
| Expo SDK 57 | Released 30 June 2026; React Native 0.86, React 19.2; prebuild now clears native dirs; iOS 27 scene-based lifecycle opt-in; SDK 58 makes it default | https://expo.dev/changelog/sdk-57 | Upgrade lending app to 57.0.23+; enable `ios.enableSceneSupport` |

---

## 9. Consolidated feature-flag register

| Flag | Default | Owner | Earliest sensible date |
|---|---|---|---|
| `auth.passkeys.enabled` | off → on by Q2 2027 | Identity | Now |
| `auth.webauthn.related_origins` | off | Identity | When second brand shares IdP |
| `identity.vc.verify_eudi` | off | Identity/ODR | 2027 |
| `api.oauth.fapi2_profile` | off | Platform | First bank partner |
| `crypto.pqc.sign_hybrid` | off | Security | 2027 (when CA issues ML-DSA) |
| `edge.tls.hybrid_kem`, `edge.http3.enabled` | on | Platform | Now |
| `lms.product.upi_credit_line` | off | Finbyx | RBI/NBFC scope change |
| `los.data.uli_gateway` | off | Finbyx | Client onboarding to ULI |
| `los.data.aa_fiu` | on where licensed | Finbyx | Now |
| `privacy.dpdp.consent_ledger` | on | All | Before 13 May 2027 |
| `privacy.dpdp.consent_manager_api` | off | GRC | After 13 Nov 2026 |
| `ai.output.provenance_label` | on | All AI | Now (in force) |
| `supplychain.sbom_publish` | on | Platform | Now |
| `ai.mcp.server_enabled` | off | Platform | First enterprise ask |
| `ai.provider.sovereign_primary` | off | AI | After eval |
| `ai.inference.confidential_only` | off | AI | Bank client policy |
| `governance.ai_inventory` | on | GRC | Now |
| `odr.scheme.sebi_v2` | off | Equator | Final SEBI circular |
| `esign.stamp.national_regime` | off | LawDocs | Stamp Bill enactment |

---

## 10. Architecture preparation checklist (what to do in the next two quarters)

1. **Crypto-provider module** in the shared NestJS library: algorithm registry, key metadata, CBOM export. Nothing calls `crypto.sign` directly.
2. **Consent aggregate** shared across products with append-only history and a consent-manager-shaped API, aligned to DPDP Rule 4 (13 Nov 2026) and Rules 3/5–16 (13 May 2027).
3. **Provenance on AI outputs**: model, prompt hash, timestamp, signed manifest; visible label in UI (IT Rules, in force 20 Feb 2026).
4. **Rail adapters** for AA, ULI, UPI, ONDC and (later) CBDC behind a single `DataSourceAdapter`/`DisbursementRail` interface.
5. **Passkeys with conditional UI** on the shared login; related-origins file served from the IdP.
6. **MCP server module** reusing the service layer with RBAC and per-tool rate limits; OTel GenAI wrapper from day one.
7. **ESM readiness** for NestJS 12; pin Node 24 LTS; plan Node 26 in 2027; stay on PostgreSQL 18, test 19.
8. **SBOM/AIBOM in CI**, 180-day India-resident logs, 6-hour incident runbook (CERT-In and RBI outsourcing directions).
9. **AI system register** in the GRC product that doubles as your own ISO 42001 / EU AI Act Annex III evidence.
10. **Scheme-as-data** for ODR (SEBI thresholds, fees, panel rules) so regulatory changes are configuration, not code.
