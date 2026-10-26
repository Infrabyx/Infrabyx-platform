# Standards, Regulations and Platform Terms: Quick Reference

**Prepared:** 25 October 2026. One row per item: current version/date, link, one-line relevance to an India-first legal-tech / RegTech / NBFC lending / ODR SaaS stack. Items whose date or detail could not be confirmed against a primary source in this pass are marked **[VERIFY]**.

## A. Indian cyber and data regulation

| Item | Version / date | Link | Relevance |
|---|---|---|---|
| CERT-In Directions under s.70B(6) IT Act | Issued 28 Apr 2022, effective 28 Jun 2022; 6-hour incident reporting, 180-day logs in India, NTP sync, 5-year subscriber records for cloud/VPN providers; no substantive 2025–26 amendment found in sources reviewed **[VERIFY]** | https://nishithdesai.com/research-and-articles/hotline/technology-law-analysis/cyber-security-india-revamps-rules-on-mandatory-incident-reporting-allied-compliances-5507 ; FAQs: https://nishithdesai.com/research-and-articles/hotline/technology-law-analysis/cert-in-releases-faqs-explaining-the-direction-on-cybersecurity-6139 | Applies to every body corporate; drives logging, NTP and incident runbooks |
| CERT-In Technical Guidelines on BOM v2.0 (SBOM, CBOM, QBOM, AIBOM, HBOM) | 9 Jul 2025 (SBOM v1 was 3 Oct 2024) | https://khaitanco.com/thought-leadership/CERT-Ins-Expanded-BOM-Guidelines-Preparing-for-the-Next-Phase-of-Cyber-Regulation ; https://www.azbpartners.com/bank/cert-ins-technical-guidelines-on-sbom-qbom-and-cbom-aibom-and-hbom/ | Government, essential-services and software-export clients will ask for SBOM/AIBOM |
| CERT-In Cyber Security Audit Policy Guidelines | 2025 **[VERIFY exact date]** | https://www.lawrbit.com/article/comprehensive-cyber-security-audit-policy-guidelines/ | Shapes empanelled-auditor scope for RBI/SEBI-regulated clients |
| IT (Intermediary Guidelines) Rules amendment: synthetically generated information | Notified 10 Feb 2026, effective 20 Feb 2026; labelling + permanent provenance metadata; 3-hour takedown | https://www.hlc.com/en/publications/india-introduces-mandatory-labelling-for-ai-and-3hour-takedown-for-illegal-content | Label and watermark all AI-generated content |
| DPDP Act 2023 | Enacted August 2023 (assent 11 Aug 2023 **[VERIFY]**) | https://www.hlc.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force- | Parent statute for consent, breach, children's data |
| DPDP Rules 2025 | Notified 13 Nov 2025; Board provisions immediate; consent-manager rules 13 Nov 2026; substantive duties (notice, security, breach, SDF, children, cross-border) 13 May 2027 | same; https://www.deccanherald.com/amp/story/india%2Fcentre-notifies-dpdp-rules-implementation-planned-in-phases-spread-over-12-18-months-3798465 | Hard dates for consent ledger, 72-hour breach follow-up, DPO |

## B. International management-system and assurance standards

| Item | Version / date | Link | Relevance |
|---|---|---|---|
| ISO/IEC 27001:2022 | Published Oct 2022; Annex A has 93 controls in 4 themes (organisational 37, people 8, physical 14, technological 34) **[VERIFY counts against the standard]** | https://www.iso.org/standard/27001 | Baseline ISMS for all products; transition from 2013 closed Oct 2025 |
| ISO/IEC 27701:2025 | Published 14 Oct 2025; now a stand-alone PIMS standard (no longer an extension of 27001); transition period not yet fixed by IAF | https://www.dnv.com/assurance/Management-Systems/new-iso/transition/revision-of-iso-iec-27701/ | DPDP evidence; GRC product can map controls to it |
| ISO/IEC 42001:2023 | Published Dec 2023; first bank certification (Axis Bank, BSI) Jan 2026 | https://fcms.bsigroup.com/en-IN/insights-and-media/media-centre/press-releases/2026/february/axis-bank-emerges-as-the-first-financial-services-institution-globally-to-receive-bsis-isoiec-42001--certification/ ; https://www.iso.org/standard/42001 | AI management system; bank RFP requirement by 2027 |
| ISO 22301:2019 | 2019 edition current | https://www.iso.org/standard/75106.html | Business continuity; referenced by RBI IT governance and outsourcing directions |
| AICPA SOC 2 | 2017 Trust Services Criteria with 2022 revised points of focus | https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022 **[VERIFY URL]** | Expected by foreign clients and ODR counterparties |
| PCI DSS v4.0.1 | Published Jun 2024; v4.0 retired 31 Dec 2024; future-dated requirements effective 31 Mar 2025; SAQ A (Jan 2025) removes 6.4.3/11.6.1/12.3.1 and adds script-attack eligibility criterion, effective 31 Mar 2025 | https://blog.pcisecuritystandards.org/important-updates-announced-for-merchants-validating-to-self-assessment-questionnaire-a ; https://www.akamai.com/blog/security/pci-dss-v4-0-1-changes-qualify-saq-a | Fee and EMI collection pages; scope minimised by redirect/iframe PA checkout |

## C. Indian financial-sector regulation

| Item | Version / date | Link | Relevance |
|---|---|---|---|
| RBI Master Direction on IT Governance, Risk, Controls and Assurance Practices | 7 Nov 2023; effective 1 Apr 2024 | https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12562 ; PDF: https://website.rbi.org.in/documents/87730/39710850/Master+Directions+-+IT+Governance+and+Practices+-FINAL.pdf | Applies to NBFC-ML and above; IT strategy committee, BCP, audit |
| RBI Master Direction on Outsourcing of IT Services (2023) | 10 Apr 2023, effective 1 Oct 2023; **repealed** for banks and NBFCs by the Nov 2025 outsourcing directions | https://vinodkothari.com/2026/02/it-outsourcing-under-the-rbis-2025-directions-what-has-changed/ | Historical reference; clauses carried into Chapter IV of 2025 directions |
| RBI (Commercial Banks – Managing Risks in Outsourcing) Directions, 2025 | 28 Nov 2025, immediate effect; existing IT agreements to comply by renewal or 10 Apr 2026; cloud, concentration, exit, 30-day grievance, 6-hour cyber reporting | https://rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13139 | Your bank clients' contract terms (audit access, exit, sub-contractor lists) |
| RBI (NBFC – Managing Risks in Outsourcing) Directions, 2025 | 28 Nov 2025; same transition date; Chapter IV (IT) applies to NBFC-ML and above; sub-contractor coverage, ongoing due diligence, pooled audits | https://vinodkothari.com/2026/02/it-outsourcing-under-the-rbis-2025-directions-what-has-changed/ ; RBI index: https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12941 **[VERIFY id]** | Direct obligations for Finbyx NBFC clients; replaces 2017 NBFC outsourcing directions |
| RBI (Payments Banks – Managing Risks in Outsourcing) Directions, 2025 | 28 Nov 2025 | https://www.rbi.org.in/SCRIPTs/BS_ViewMasDirections.aspx?id=13088 | Parallel text for payments-bank partners |
| RBI (Digital Lending) Directions, 2025 | 8 May 2025; CIMS DLA reporting by 15 Jun 2025; multi-lender LSP rules from 1 Nov 2025 | https://www.legal500.com/developments/thought-leadership/reserve-bank-of-india-digital-lending-directions-2025-brief-overview-analysis/ ; https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=60403 | KFS, cooling-off, data residency, grievance officers in-app |
| RBI circular on UPI-linked credit facilities | DOR.STR.REC.128/21-07-001/2026-27, 23 Jun 2026 (banks); parallel SFB circular | https://www.taxmann.com/post/blog/rbi-issues-prudential-norms-for-upi-linked-credit-facilities/ | LMS treatment of revolving UPI credit lines |
| SEBI Cybersecurity and Cyber Resilience Framework (CSCRF) | Circular 20 Aug 2024; compliance extended to 31 Aug 2025 for REs other than MIIs/KRAs/QRTAs (circular 30 Jun 2025) | https://www.taxmann.com/post/blog/sebi-extends-cscrf-deadline-for-regulated-entities ; https://foxmandal.in/News/sebi-issues-clarifications-on-cybersecurity-framework/ | Applies if any client is a SEBI RE; SBOM and SOC requirements |
| SEBI ODR framework (proposed revision) | Consultation 23 Jul 2026; thresholds ₹30 lakh / ₹1 crore; MII-administered | https://taxguru.in/sebi/sebi-proposes-streamlined-online-dispute-resolution-framework-securities-market.html | Equator Resolution case-flow configuration |
| IRDAI (Protection of Policyholders' Interests, Operations and Allied Matters of Insurers) Regulations, 2024 + Operations Master Circular 19 Jun 2024 | 2024; repeals Outsourcing of Activities by Indian Insurers Regulations 2017; board outsourcing policy, barred decision-making activities, reporting of all arrangements | https://www.mondaq.com/india/insurance-laws-and-products/1497308/strategic-shift-irdai-redefines-insurance-outsourcing-practices | Insurer clients of the GRC or ODR platform |

## D. Accessibility and government web standards

| Item | Version / date | Link | Relevance |
|---|---|---|---|
| WCAG 2.2 | W3C Recommendation 5 Oct 2023, updated 12 Dec 2024 **[VERIFY]** | https://www.w3.org/TR/WCAG22/ | Target AA for all public UIs; RPwD Act 2016 |
| IS 17802 (Accessibility for ICT products and services) | Part 1 (requirements) 2021, Part 2 (conformance) 2022 **[VERIFY]** | https://www.bis.gov.in | Indian national standard referenced in procurement |
| GIGW 3.0 | Current edition (page updated 23 Oct 2026); cites WCAG 2.1, ISO 23026, RPwD Act; basis for STQC website certification | https://guidelines.india.gov.in/scope-and-objective/ | Any government or court-facing deployment |

## E. API, event and webhook specifications

| Item | Version / date | Link | Relevance |
|---|---|---|---|
| Standard Webhooks | v1.0.0; `webhook-id`, `webhook-timestamp`, `webhook-signature`; HMAC-SHA256 `v1`, ed25519 `v1a` | https://raw.githubusercontent.com/standard-webhooks/standard-webhooks/main/spec/standard-webhooks.md ; https://github.com/standard-webhooks/standard-webhooks | Outbound webhooks for LOS/GRC/ODR events |
| RFC 9457 Problem Details for HTTP APIs | Jul 2023 (obsoletes RFC 7807) **[VERIFY]** | https://www.rfc-editor.org/rfc/rfc9457 | Uniform error envelope |
| RFC 9421 HTTP Message Signatures | Feb 2024 **[VERIFY]** | https://www.rfc-editor.org/rfc/rfc9421 | Signed partner API calls |
| CloudEvents | v1.0.2 (CNCF) **[VERIFY date]** | https://github.com/cloudevents/spec | Event envelope for internal bus and ops hub |
| OpenAPI Specification | 3.1.1 (24 Oct 2024); 3.2.0 (19 Sep 2025) | https://www.speakeasy.com/openapi/release-notes ; https://spec.openapis.org/oas/latest.html | API docs; MCP tool schemas |
| AsyncAPI | 3.0.0 (Dec 2023) **[VERIFY]** | https://www.asyncapi.com/docs/reference/specification/v3.0.0 | Webhook and event contracts |
| OpenID FAPI 2.0 Security Profile | Final Feb 2025; conformance tests 9 Jul 2025 | https://openid.net/specs/fapi-security-profile-2_0-final.html | Partner/open-finance APIs |
| WebAuthn Level 3 | W3C Recommendation 25 Aug 2026 | https://www.w3.org/TR/2026/REC-webauthn-3-20260825/ | Passkeys |
| W3C Verifiable Credentials Data Model 2.0 | Recommendation May 2025 | https://www.w3.org/press-releases/2025/verifiable-credentials-2-0 | Credential modelling |

## F. Platform commercial terms

| Item | Version / date | Link | Relevance |
|---|---|---|---|
| Meta WhatsApp Business Platform pricing | Per-message pricing since 1 Jul 2025 (marketing, utility, authentication templates; service and Meta Business Agent in 24-hour window); 1,000 free service messages/number/month; utility-in-window and over-tier service messages charged from 1 Oct 2026; India marketing rate up 1 Jan 2026, auth-international up 1 Apr 2026; INR billing required by 31 Dec 2026; quarterly rate calendar | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing | Notice, reminder and collections messaging cost model |
| Meta Business Verification | Required for WhatsApp Business API access and higher messaging tiers; documents: registration, address, phone/domain proof **[VERIFY current list]** | https://developer.exotel.com/docs/whatsapp-support/business-verification | Prerequisite per legal entity/brand |
| Google Tag Manager server-side tagging | GA since 2021; server container on Cloud Run or self-hosted; first-party cookies and data redaction **[VERIFY current docs]** | https://developers.google.com/tag-platform/tag-manager/server-side | Consent-aware analytics under DPDP |
| Razorpay – Payment Aggregator authorisation | Final RBI PA authorisation Dec 2023 | https://www.moneylife.in/article/razorpay-cashfree-get-final-approval-from-rbi-to-function-as-payment-aggregators/72912.html | Fee collection rail |
| Cashfree – PA authorisation | Final RBI PA authorisation Dec 2023 | same | Fee collection rail |
| PayU – PA authorisation | Final RBI PA authorisation May 2025 | https://www.business-standard.com/finance/news/payu-secures-final-rbi-approval-as-online-payment-aggregator-125051301470_1.html | Fee collection rail |

## G. Runtime versions (for completeness)

| Item | Version / date | Link |
|---|---|---|
| Node.js | 24.22.1 LTS (20 Oct 2026); 26.12.1 Current (21 Oct 2026); 22.23.4; annual releases from Node 27 | https://nodejs.org/en/about/previous-releases |
| Next.js | 16.4 (6 Oct 2026); security update 14 Oct 2026 | https://nextjs.org/blog |
| NestJS | 11.1.x current; 12 (ESM) targeted Q3 2026 **[VERIFY GA]** | https://infoq.com/news/2026/04/nestjs-12-roadmap-esm |
| PostgreSQL | 18 GA 25 Sep 2025; 19 RC1 15 Oct 2026; 14 EOL 12 Nov 2026 | https://www.postgresql.org/about/newsarchive/pgsql/20260212/ |
| Expo SDK | 57 (30 Jun 2026), RN 0.86 | https://expo.dev/changelog/sdk-57 |
| Temporal | Replay 2026 (May): Worker Versioning GA, Nexus GA (Python) | https://temporal.io/blog/replay-2026-product-announcements |

## H. Dates to put in the compliance calendar

| Date | Event |
|---|---|
| 12 Nov 2026 | PostgreSQL 14 end of life |
| 13 Nov 2026 | DPDP Rule 4: consent-manager registration regime begins |
| 2 Dec 2026 | EU AI Act Article 50(2) watermarking grace period ends for legacy systems (subject to Omnibus publication) |
| 31 Dec 2026 | Meta requires INR billing for India WhatsApp accounts |
| 1 Jan 2027 | CNSA 2.0: new acquisitions must support PQ algorithms |
| 13 May 2027 | DPDP Rules: notice, consent, breach, SDF, children's data, cross-border provisions in force |
| 2 Dec 2027 | EU AI Act Annex III high-risk obligations (post-Omnibus) |
| Apr 2028 | Node.js 24 end of life |
| 2 Aug 2028 | EU AI Act Annex I high-risk obligations (post-Omnibus) |
