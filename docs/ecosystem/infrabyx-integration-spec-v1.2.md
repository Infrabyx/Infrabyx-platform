# INFRABYX ECOSYSTEM INTEGRATION SPECIFICATION

**Canonical contract for events, APIs, data ownership, identity and connectors across LawDocs, Finbyx, Udofin, the Infrabyx Operations Hub, Equator Resolution, LawDocsComply, the Recovery Suite (future Udolex), non-RE lenders, future ecosystem apps and third parties**

Version 1.2 · 26 October 2026 · Companion to the Infrabyx Platform Baseline Standard (IPB) v1.0, the LawDocs Build Prompt Pack v1.1, the LawDocsComply Build Prompt Pack v1.3, the Equator Build Prompt Pack v3.2, the Finbyx Master Build Prompt v1.6, the Udofin Master Build Prompt v1.3 and the Infrabyx Operations Hub Master Build Prompt v1.1, whose event, API and layout tables remain as summaries and point here as canonical · Supersedes v1.1 of 24 October 2026 (changes in Part 16.1) *(v1.2)*

---

## WHAT CHANGED IN v1.2 *(v1.2)*

Minor version (Part 14.1): new owner code, product, principles, entities, domains, events, APIs, optional fields, scopes, code-table values, layouts and certification groups; no published schema changes meaning, ownership or a mandatory field, so no parallel run is required.

1. **IPB v1.0 registered as a companion** and placed in the precedence chain: product master prompt → IPB → this Specification (prevails for every cross-product contract) → product phase files → appendices (How to use; Part 14.1).
2. **LawDocs registered** as an ecosystem product with owner code `LD`, `source` `urn:infrabyx:lawdocs:[tenantid]`, link types `legal_sor_link`, `signing_handoff_link`, `deposit_link`, `finbyx_legal_link`, entities 46–54, domains `legal`, `esign`, `ip`, `engagement`, scopes, archive profiles and layouts — absorbed from the LawDocs change request (LawDocs Pack v1.1 Appendix Y, proposal `2026-10-25-add-lawdocs-ld`). Every absorbed item is marked *(v1.2, from LD App. Y)*.
3. **Principles 14–16**: Consumer Help wall; eSign capability never shared (hosted hand-off contract, 6.32); cross-product agent delegation only by event with consent and the receiving product's autonomy ceiling.
4. **Legal-matter system-of-record rule** for organisations using both LawDocs and LawDocsComply (`legal_sor_link`; 4.1, 6.31, 6.23 routing amendment, `SystemOfRecordSwitched`).
5. **Cross-product customer sign-in by token exchange** (4.4) and consent flows (`IN_APP_AUTHORISATION`, `CONSENT_MANAGER`; new purpose codes; `CONTRACT_PERFORMANCE_CUSTOMER` legal basis with a closed field list).
6. **Twenty-seven IPB-proposed Ecosystem events registered** (IPB-01, -02, -03, -04, -05, -06, -07, -08, -09, -10 "Proposed Ecosystem events" tables) in new domains `trust`, `feedback`, `crm`, `vidhi`, `tenancy`, `consent`, `messaging`, `cms`, `content`, `eng`, `identity` and in existing domains `platform`, `grc`, `billing`, `workforce` (6.15, 6.16, 6.27, 6.34–6.40), each with `data` fields and types, data class, `consentref` or `legalbasis` rule, producer and consumer matrix and idempotency key; every other IPB proposal is mapped to an existing or new canonical name in 6.17 and is never emitted under its proposed name.
7. **`product_scope[]` on Hub staff identity** (4.8): staff tokens and `group_grant`s carry product scope alongside legal-entity scope; default deny; grants at most 90 days; acceptance tests.
8. **Shared `brand_pack` object and `terminology_override`** (5.4) with the white-label tenant provisioning contract for Udofin and Finbyx resale: merchant of record, data ownership, the DLA and RE ownership rule for Udofin brands, and exit.
9. **Vidhi cross-product delegation contract** (4.9; events 6.36): a Vidhi task in one product requests data or action from another only through `VidhiTaskDelegated` with an explicit `consentref` and under the receiving product's autonomy ceiling; locked-list actions can never be delegated.
10. **Vendor assurance publication contract** (6.34): OH14.6 is the system of record; products hold read-only mirrors keyed by `vad_id` and digest; acknowledgement events return to OH.
11. **Runtime and version pins** (3.12; Appendix C): Node.js 24.22.1 for every product; capability-port names per IPB-01 §01.4.4 and TCP port variables per IPB-11; error-code prefixes confirmed non-colliding; export package and MCP resource names per product.
12. Part 14: IPB change-propagation rule; three new certification groups (Legal-tech boundaries; Product scope, brand and white-label; Delegation, trust and content). Part 15: website and CMS, Vidhi and trust-publication waves plus LawDocs rows. Part 16 becomes the cumulative change log (16.1 v1.2, 16.2 v1.1). New Appendix C (cross-pack consistency table).
13. Error codes added (3.9): `product-scope-denied`, `delegation-not-permitted`, `locked-action`, `brand-host-unknown`, `mirror-digest-mismatch`.

---

## HOW TO USE THIS SPECIFICATION

**Project owner.** (1) Commit this file unchanged to every product repository (Finbyx, Udofin, the Operations Hub, Equator, LawDocsComply and every certified connector) as `docs/ecosystem/infrabyx-integration-spec.md`; edit it only in `infrabyx-contracts` (Part 3.3); CI fails if a copy's SHA-256 differs from the tagged version. (2) Approve changes once per affected product. (3) `[VERIFY: …]` marks a fact to re-check against the primary source before the related connector goes live; **[LAW]** = statute or RBI text, **[INTERP]** = our reading, **[REC]** = recommendation.

**Claude Code (any repository).** (1) Read this file before designing or changing any cross-product event, API, file, identity flow or connector; it overrides conflicting product text, ADRs or code: raise conflicts, never resolve them silently. (2) Never invent or rename an event, add a field to a published schema version, or move ownership of an entity: write a proposal (Part 14.2) and stop for approval. (3) Generate types and validators from the registry; no hand-written duplicates. (4) No connector touches real data before certification (Part 14.3). (5) Refuse any design letting Udofin, Equator, an agency or a vendor take a credit, KYC, classification, settlement, referral or enforcement decision for the RE; any design that stores or scripts a regulator-portal credential or OTP, or files a return or bureau file without an authorised human (principle 11); any flow that sends borrower, member or tenant HR personal data to the Operations Hub (principle 12); and any flow that moves Udofin wellness add-on data out of Udofin's separate store (principle 13).

**Companion prompts (v1.1).** The Finbyx Master Build Prompt v1.5 (Parts 7B–7L; phases 13b to 20b), the Udofin Master Build Prompt v1.2 (Parts 7B–7H; phases 3c to 20d) and the Infrabyx Operations Hub Master Build Prompt v1.0 (OH1–OH14; phases O0 to O13) implement this version. Their event, API and layout lists are summaries; where they differ from Parts 4, 6 and 12 of this specification, this specification prevails and the difference is raised as a proposal (Part 14.2).

**Companion prompts (v1.2).** *(v1.2)* The LawDocs Build Prompt Pack v1.1 (P19 owner; Appendices I, K, X, Y), the LawDocsComply Build Prompt Pack v1.3, the Equator Build Prompt Pack v3.2, the Finbyx Master Build Prompt v1.6, the Udofin Master Build Prompt v1.3 and the Infrabyx Operations Hub Master Build Prompt v1.1 implement this version. Their event, API and layout lists are summaries; where they differ from Parts 4, 5, 6 and 12 of this specification, this specification prevails and the difference is raised as a proposal (Part 14.2).

**Infrabyx Platform Baseline Standard (IPB) v1.0.** *(v1.2)* The IPB (`docs/ipb/`, IPB-01 to IPB-13) is the shared product-internal baseline: runtime and stack, ports and adapters, security controls, the AI gateway and Vidhi kernel, the public website and Studio, policies, accessibility, settings tree and help, the vendor assurance room, engineering governance, the `/v1` API standard, environment and seeds, the technology watchlist and Claude artefacts. **Precedence on conflict:** product master prompt → IPB → **this Specification (prevails for every cross-product contract: event names, envelopes, schemas, ownership, scopes, links, layouts)** → product phase files → product appendices. A product may tighten an IPB or Specification rule, never loosen it; a deviation is an `IPB-DEV-nn` entry in the product's decision log. Internal events use the IPB-10 grammar `in.[product].[module].[Event].v[n]` and never leave the product; cross-product events use only `in.infrabyx.[domain].[Event].v[major]` types registered in Part 6 (IPB-10-41; the event-catalogue lint fails any unregistered `in.infrabyx.*` type). Claude Code reads `docs/ipb/00_README.md` and then this file in every session before a phase file.

**Change-control rule.** The specification changes only by a merged pull request to `infrabyx-contracts` carrying an impact note (products, events, APIs, schemas, tests), approved by the owner of every affected product, with a version bump (Part 14.1), propagated to every repository within 10 working days. Published schemas are never broken in place: a new major version runs in parallel for at least 90 days. Emergency security changes may be applied first and ratified within 5 working days.

---

# 1 — PURPOSE, SCOPE AND PRODUCTS

The single source for cross-product events, APIs, data ownership, identity, connectors, export formats and integration security, written so that a conforming producer, consumer or connector can be built without reading another product's code. Internal module boundaries, commercial terms and legal advice are out of scope.

| Product or party | Role | Regulatory position | System of record for |
|---|---|---|---|
| **Finbyx** | Staff-operated LOS, LMS, accounting, collections, Recovery Suite, risk, returns, embedded compliance | IT service provider to each RE; material outsourcing for ML/UL [INTERP] (Finbyx Part 10.6) | The RE's sanction, KFS, loan, ledger, classification, provisioning, CIC reporting, collateral and pledge book, DLG ledger, recovery, notices, litigation, settlements |
| **Udofin** | Borrower-facing platform of an LSP serving several REs | LSP and agent of each RE (CF para 4(1)(xix)); RE fully liable (para 6(7)) | Borrower journey, its consents and captured evidence, DLA register, LSP grievances, its DLG records and accounts; never a loan |
| **Equator Resolution** | ODR institution: conciliation, mediation, arbitration, Lok Adalat facilitation | Independent institution [INTERP] | Docket, panel and selection log, disclosures, hearings, orders, original awards and settlements, service logs, fees |
| **LawDocsComply** | GRC platform for RBI, SEBI and IFSCA regulated entities | Technology service provider | Obligations, calendar, policies, issues, attestations (external or group mode) |
| **Infrabyx Operations Hub (OH)** | Internal operations platform of the Infrabyx group: CRM, onboarding and delivery, support desk, customer success, marketing and brand, revenue catalogue and billing (Razorpay), professional and advocate directory, staff HRMS and payroll, internal controls, workplace integration, engineering operations, certification readiness | Infrabyx's own system; holds no RE customer data, so it is not an outsourced service for any RE's lending [INTERP]; group-outsourcing rules apply where a group company serves an RE (OUT paras 45–51, 90–92) | Infrabyx commercial records (organisations, contracts, plans, invoices, payments), entitlements as issued, usage aggregates, tickets, implementation projects, professional directory, Infrabyx staff and payroll, change and control evidence (Part 4.6) |
| **Recovery Suite** | Attachable pack in Finbyx (full) and Udofin (LSP subset); later standalone **Udolex** | Runs in the RE's tenancy | Recovery cases, notices, settlements, litigation, asset sales |
| **Field-investigation app** (future) | Field verification, skip tracing | Service provider (OUT Ch III) | Visit evidence |
| **Non-RE lenders** | Credit co-operative societies (State or multi-State) lending to their members through Udofin, on Finbyx or another certified LOS/LMS | Not REs; governed by the State Co-operative Societies Act or the MSCS Act 2002 and their Registrar; never co-lenders, transferors or transferees with NBFCs (TDCR paras 7, 12(4), 97) | Membership, share capital, deposits where the Act permits, the society's loans and recovery |
| **LawDocs** (`lawdocs.in`; web and iOS/Android apps) *(v1.2, from LD App. Y)* | Legal-documents and legal-operations platform for individuals and companies: drafting and templates, contract lifecycle, eSign and eStamp execution, Legal Vault, litigation and IP tracking, notices and pleadings, legal department tools, marketplace of legal and compliance services; operates a separately branded Consumer Help service behind an ethical wall | Technology platform and intermediary for user content [INTERP]; eSign only through a licensed ESP, via a contracted aggregator acting as Application Service Provider or LawDocs' own ASP arrangement (`asp_mode` per vendor), never sublet; DigiLocker Requester; e-commerce entity for its marketplace [INTERP]; does not practise law (Advocates Act 1961 ss.29, 33) — reserved services are delivered by practitioners under direct engagement | Agreements and their versions; signing requests and eSign evidence (as ASP); stamp instruments it procured or attached; Legal Vault documents; legal matters and the court cases it tracks; IP assets; contract obligations; engagements and retainers (operational records — commercial records stay with OH) |
| **Infrabyx Platform Baseline Standard (IPB) v1.0** *(v1.2)* | Not a party: the shared product-internal baseline every product adopts by reference (How to use) | — | Nothing cross-product; it defines the `in.[product].*` internal grammar, ports, runtime pins and the proposal route for new `in.infrabyx.*` events (IPB-10 §10.6.2) |
| **Third parties** | Other LOS/LMS (incl. Fineract-based), accounting, GRC tools, legal-tech and court data, e-auction, agencies and diallers, ODR providers, KYC, credit information companies, AA, eSign, eStamp, depository, RTA, custodians and market data, payments and Razorpay, insurers, storage and workplace providers, CRM and voice providers | Own regulation and contract | Their own records; never RE decisions |

---

# 2 — PRINCIPLES

1. **Separate databases; contracts only.** No product touches another's tables, stores or queues; every interaction is a registered event, API or file layout with a versioned JSON Schema.
2. **Data ownership.** One owner per canonical entity per tenant (Part 5); copies are projections with source and as-of time, never edited, reconciled daily; on conflict the owner wins and `ReconciliationBreakRaised` is opened.
3. **Regulated decisions stay with the RE:** credit and KYC decisions, sanction, pricing, KFS, disbursement, classification, provisioning, CIC reporting, settlement and write-off approval, ADR referral, legal notices, enforcement, grievance closure (OUT para 15; KYC para 13; CF paras 6(7), 12; RSA para 16).
4. **Money never through the LSP.** RE account to borrower or permitted end-beneficiary; repayment to the RE or a co-lender-controlled escrow; no LSP pool or merchant account; LSP fees paid by the RE, never deducted from recoveries (CF para 10(1)–(5)). Equator, agencies and connectors are bound equally; validators reject any other account.
5. **Consent and purpose limitation.** Personal data travels only with a `consentref` (purpose, named RE, categories, expiry) or a `legalbasis` code (CF para 13(4); DPDP Act ss.7, 17(1)(a) [VERIFY: wording and commencement]), only to the RE the borrower chose.
6. **India-only residency** of data, backups, logs, event logs, DLQs and sub-processors; anything processed abroad repatriated within 24 hours (CF para 14(4); OUT para 74(vi)).
7. **Least privilege** by scope (Part 4.5); recovery and litigation data reach Udofin only as the RE-permitted LSP projection (OUT paras 15, 24).
8. **Failure containment:** each product keeps working when another fails (queues, circuit breakers, DLQs, replay, reconciliation).
9. **Versioning** of schemas, events, APIs, mappings and connectors; breaking changes get a new major with ≥ 90 days' parallel run.
10. **Auditability:** every message signed, correlated, stored with its hash at both ends and producible to the RE, auditors and RBI (OUT paras 34, 81; CYB paras 46, 57).
11. **Prepare, validate, a human files.** Products generate, validate, reconcile, package and evidence regulatory returns, bureau files, tax returns and statutory filings; authorised humans approve and file. No regulator-portal credential, OTP, DSC PIN or session token is stored or scripted, and machine channels are used only where the regulator documents them for that entity class (Parts 6.18–6.20).
12. **Aggregates only to the Operations Hub.** The Hub receives commercial records, usage aggregates and operational metadata; never borrower, applicant, member, guarantor or depositor personal data, loan-level data or tenant HR data (Parts 4.6, 6.27).
13. **Wellness data is never shared.** Udofin's credit-report, score-simulator and expense data live in a separate store under Udofin's own fiduciary role, have no cross-product events and never reach an RE, Finbyx, LawDocsComply, the Hub or any RE archive (Udofin Part 7D; Part 13.2 `WELLNESS`).
14. **Consumer Help data is walled.** *(v1.2, from LD App. Y)* LawDocs' Consumer Help service (loan, lending and insurance grievances, credit-report disputes, challans, vehicle matters) keeps its case data in class `CONSUMER_HELP` (13.2). No cross-product schema may declare it; gateways reject any message carrying it; it never reaches Finbyx, Udofin, Equator, LawDocsComply, the Operations Hub (except anonymous counts) or any RE archive; no product may refer, route or advertise to it.
15. **eSign capability is never shared.** *(v1.2, from LD App. Y)* No product calls another product's ESP or ASP route, receives its ESP credentials, or frames its ceremony. A user of one product signs through another product only as that product's own customer, in its own tenant and under its consent screen; signer consent and eSign logs stay with the hosting ASP; the requesting product receives status and evidence by document reference (6.32). [LAW: IT Act 2000 s.3A and Second Schedule; CCA eSign FAQ — an ASP may integrate eSign only for applications it owns or operates]
16. **Agents delegate only by contract.** *(v1.2)* A Vidhi task in one product obtains data or action from another product only through `VidhiTaskDelegated` (6.36) carrying an explicit `consentref` or `legalbasis`, executed under the receiving product's own autonomy ceiling, role model and locked human-approval list (IPB-03-71); no agent-to-agent channel, shared agent token or direct MCP call across products exists, and a locked-list action can never be delegated (4.9).

---

# 3 — INTEGRATION ARCHITECTURE

## 3.1 Topology and transports

Each product exposes partner APIs through its own gateway (TLS 1.3, mTLS for machines, token and schema validation, rate limits, WAF). Events travel by **HTTP push** (default): CloudEvents structured JSON as Standard Webhooks with RFC 9421 signatures; or by **streaming** between Infrabyx products on the same AWS ap-south-1 estate (MSK or Redpanda, CloudEvents Kafka binding, one topic per domain per producer). Every producer serves `GET /v1/events?after=[cursor]&types=[list]` for catch-up; files are the fallback (3.11).

## 3.2 CloudEvents 1.0 envelope

| Attribute | Rule |
|---|---|
| `id` | UUIDv7 (RFC 9562); with `source`, the de-duplication key |
| `source` | `urn:infrabyx:[product]:[tenantid]` (finbyx, udofin, oh, equator, ldc, udolex, fiapp, and from v1.2 `lawdocs` *(v1.2, from LD App. Y)*; for `oh` the tenant segment is the Infrabyx group company's `legal_entity_id`: `urn:infrabyx:oh:[legalentityid]`) or `urn:ext:[connector-id]:[tenantid]` |
| `type` | `in.infrabyx.[domain].[EventName].v[major]`, `[EventName]` exactly as Part 6 |
| `subject` | Aggregate id; ordering and partition key |
| `time`, `dataschema`, `data` | RFC 3339 (IST); `[registry-base]/schemas/[domain]/[EventName]/[semver].json`; payload |
| `tenantid`, `reid` | Producer tenant (Part 4.1); ecosystem RE id, or for a non-RE lender its ecosystem lender id (`lnd_` + ULID, with `lender_type` in the payload, Part 6.24); `none` only for platform and Operations Hub internal events |
| `productfamily` | PL, PDL, MSME, LAP, HL, VL, GOLD, LAS, LAMF, CD, MFI, SCF, MED, LEF, RF, DR, CORP, STAFF, DCL, EDU, PF (codes as Finbyx Part 6.3.3); co-lent loans `CLN-[base]` (e.g. `CLN-PL`); `na` for non-loan events |
| `correlationid`, `causationid` | Journey id; id of the causing event or request |
| `consentref` or `legalbasis` | Required with personal data; `legalbasis` ∈ STATUTORY_REPORTING, LEGAL_CLAIM, CONTRACT_PERFORMANCE_RE, REGULATOR_REQUEST; from v1.1 CONTRACT_PERFORMANCE_VENDOR (business contact data of a customer's staff exchanged under the customer's contract with an Infrabyx company, e.g. the first-admin work email in `TenantProvisioned`; never borrower, member or loan data) |
| `dataclass`, `schemaver`, `seq`, `traceparent` | Highest class (13.2); full schema semver; per-subject sequence; W3C Trace Context |
| `brandid`, `environment` *(v1.2)* | Optional extensions: `brandid` = the `brand_pack` id under which the producer served the actor (white-label and multi-brand, 5.4; omitted for the product default brand); `environment` ∈ `live`, `test` (IPB-10 §10.4.7; sandbox events are never consumed by production inboxes). From v1.2 `legalbasis` also admits `CONTRACT_PERFORMANCE_CUSTOMER` (5.3) |

`specversion` 1.0 (spec 1.0.2), JSON content. Consumers reject invalid events, personal data without `consentref` or `legalbasis`, and unmapped `reid`s.

## 3.3 Contracts and registry

`infrabyx-contracts` holds this specification, JSON Schema 2020-12 documents, OpenAPI 3.1 (3.2 only for streaming after an ADR) and AsyncAPI 3.0 documents, code tables, mapping packs and the certification suite. An India-hosted registry serves immutable versions; compatibility is **BACKWARD** (minors add optional fields or `x-extensible-enum` values only). Paths `/v[major]/`, `snake_case` fields, `UPPER_SNAKE_CASE` enums, prefixed opaque ids, cursor pagination (`limit` ≤ 500), `updated_since` on reconciliation lists. Products pin versions in `contracts.lock`; Pact consumer-driven tests gate every deployment.

## 3.4 Webhooks and idempotency

- **Standard Webhooks:** `webhook-id` (= `id`), `webhook-timestamp`, `webhook-signature` (HMAC-SHA256 over `id.timestamp.body`, `whsec_` secret); Infrabyx-to-Infrabyx deliveries add RFC 9421. Timestamps more than 5 minutes off are rejected.
- **At-least-once:** `2xx` only after durable inbox write; exponential back-off with jitter for 72 hours, then DLQ and alert to both sides.
- **Idempotency-Key** (UUIDv7) on every state-changing request (`draft-ietf-httpapi-idempotency-key-header`, still a draft [VERIFY: status]); stored with body hash and response ≥ 24 hours (7 days for money); same key with a different body returns 422 and a retry while the original is still processing returns 409, as the draft specifies.
- **Business keys** (Part 6) are unique constraints at the consumer.

## 3.5 Outbox, inbox, ordering and replay

Producers write to a transactional outbox with the state change; consumers store `(source, id)` and the business key before processing. Order is guaranteed per `subject` by `seq`; gaps are parked 15 minutes, then replayed, else `ReconciliationBreakRaised`. Replay retention ≥ 90 days (365 for collateral, recovery, ADR, litigation and DLG); owners expose `GET /v1/[aggregate]/{id}` snapshots with the last `seq`.

## 3.6 Tokens, signatures and documents

- **Machine clients:** OAuth client credentials profiled to the OAuth 2.1 draft [VERIFY: status] and RFC 9700; certificate-bound (RFC 8705) or `private_key_jwt` (RFC 7523); tokens ≤ 10 minutes, audience-restricted.
- **Borrower-delegated access** (an LSP or app acting for a borrower against RE APIs, e.g. drawdowns): **FAPI 2.0 Security Profile** (Final, Feb 2025) with PAR (RFC 9126), PKCE, mTLS or DPoP (RFC 9449), passing `acr` and `auth_time`. **Token exchange** (RFC 8693) for Equator launch (4.4).
- **mTLS** with Infrabyx Ecosystem PKI certificates (separate sandbox and production CAs, ≤ 397 days, automated rotation).
- **RFC 9421** (`ed25519`) on Infrabyx-to-Infrabyx calls, webhooks and regulated messages, covering the components `@method`, `@target-uri`, `content-digest` (RFC 9530), `content-type` and `idempotency-key`, with the signature parameters `created`, `keyid` and `alg`; keys in India KMS or HSM, JWKS per product and environment.
- **Regulated messages** (signature mandatory and retained: RFC 9421 in transit plus a detached JWS over the CloudEvent, stored with it so the proof can be re-verified after the HTTP exchange): `DecisionMade`, `KFSIssued`, `SanctionLetterIssued`, `ESignCompleted`, `EStampCompleted`, `LoanDisbursed`, `CollateralPledgeCreated`, `MarginCallRaised`, `CollateralInvoked`, `CollateralReleased`, `ClassificationSynced`, `SettlementApproved`, `SettlementOfferIssued`, `LegalNoticeIssued`, `ADRReferralCreated`, `ADRConsentRecorded`, `ADROutcomeRecorded`, `OrderRecorded`, `RecoveryReceiptPosted`; from v1.1 also `ReturnApproved`, `ReturnFiled`, `BureauFileSubmitted`, `FinancialStatementsApproved`, `InterestCertificateIssued`, `CapitalRatioComputed`, `LimitBreached`, `ExternalAccessGranted`, `ExternalAccessRevoked`, `ResolutionPassed`, `ShareCapitalPosted`, `GroupCollectionPosted`, `AssetAcquired`, `SecurityReceiptIssued`, `ServicerRemittanceMade`, `ExportCompleted`, `EntitlementChanged`, `InvoiceIssued`, `SubscriptionPaymentReceived`, `LenderDealApproved`, `LenderDealActivated`, `LenderDealSuspended`, `LenderDealTerminated`, `TenantProvisioned`, `PolicyIssued`.
- **Documents** travel by reference (`document_id`, `sha256`) with a **detached JWS** (RFC 7515, 7797) for transfer integrity; legal effect rests on the document's own eSign, DSC or PAdES signature and e-stamp.
- **Regulated messages added in v1.2** *(v1.2)*: `AgreementExecuted`, `CourtOrderRecorded`, `SigningRequestCompleted`, `StampInstrumentVerified`, `SystemOfRecordSwitched`, `TenantRegistered`, `MarketplacePayoutSettled`, `MarketplaceTransferInstructed`, `ServiceCreditIssued` (from LD App. Y), `WhiteLabelTenantProvisioned`, `WhiteLabelTenantExited`. Each carries RFC 9421 in transit and a detached JWS over the CloudEvent, stored with it.

## 3.7 Sandbox and certification

Per-counterparty sandbox: synthetic data, rail mocks, personas per product and recovery path, a time-travel clock for statutory deadlines. Real data only after the suite (14.3) passes and `ConnectorCertified` is emitted; recertify on schema, hosting, key or sub-processor change and annually.

## 3.8 Service levels

| Measure | Target | Basis |
|---|---|---|
| Event delivery ("std") | Outbox lag p95 ≤ 30 s; delivery p95 ≤ 5 min; retries 72 h then DLQ | [REC] |
| Synchronous APIs | p95 ≤ 800 ms excluding third parties; `EligibilityCheck` ≤ 3 s | Finbyx Part 10.3 |
| Availability | Finbyx, Udofin 99.9%; Equator, LawDocsComply 99.5% monthly | [REC] |
| Co-lender classification sync | By 23:59 IST next working day | TDCR para 124 |
| Agent cash posting | Same day | CF para 10(5) |
| Provider incident to RE | ≤ 2 h, so the RE reports within 6 h of provider detection | OUT para 61 |
| Daily reconciliation file | By 06:00 IST | [REC] |

## 3.9 Error model

RFC 9457 problem details: `type` `[registry-base]/problems/[code]`, `title`, `status`, `detail` (no personal data), `instance`, `code`, `correlation_id`, `retryable`, `errors[]` (JSON Pointers). Codes: `schema-validation-failed` 422, `consent-missing` 403, `scope-insufficient` 403, `tenant-unknown` 404, `idempotency-key-reuse` 422, `request-in-progress` 409, `state-transition-invalid` 409, `regulatory-guard` 422 (names rule and citation, e.g. LSP-controlled account, un-notified NBFC attempting SARFAESI, referral without arbitration basis), `rate-limited` 429, `dependency-unavailable` 503; added in v1.1: `dataclass-not-permitted` 422 (payload class above the consumer's ceiling, for example personal data sent to the Operations Hub), `residency-blocked` 422 (storage target outside India for the data class), `channel-not-confirmed` 422 (regulator machine channel without documented confirmation), `grant-expired` 403 (group or external-access grant past `valid_to`), `entitlement-missing` 403 (module not licensed; never raised for a regulated tenant's read or export of its own data). Added in v1.2 *(v1.2)*: `product-scope-denied` 403 (request outside the staff token's `product_scope[]`, 4.8), `delegation-not-permitted` 403 (`vidhi.a2a.enabled` off, kill switch, or target not in the capability floor, 4.9), `locked-action` 403 (a delegated or agent-initiated action on the locked human-approval list; never retryable), `brand-host-unknown` 404 (a request on a host no published `brand_pack` claims; the default pack is served with `noindex`, 5.4), `mirror-digest-mismatch` 409 (a vendor-assurance mirror whose fetched file does not match the announced `sha256`, 6.34).

## 3.10 Rate limits and observability

Token buckets per client, tenant and operation class, advertised in `RateLimit` headers [VERIFY: draft header names]; regulated commands never share a bucket with bulk reads. OpenTelemetry to India collectors without personal data; integration monitors (Finbyx M21, Udofin U21) show health, latency, errors, DLQ depth and certification status.

## 3.11 File-transfer fallback

SFTP from allow-listed Indian IPs or signed-URL upload; CloudEvents batches (`application/cloudevents-batch+json`), NDJSON or registered CSV/XML layouts (Part 12); a manifest (layout, version, count, control totals, period, SHA-256) signed by detached JWS; an acknowledgement file of accepted and rejected records. Name: `[producer]_[reid]_[layoutid]_v[major]_[yyyymmdd]_[seq].[ext]`.

## 3.12 Runtime, port and error-code alignment with the IPB *(v1.2)*

Every product that produces or consumes a message under this Specification runs the same pinned runtime and names its dependencies the same way, so that a connector, SDK or certification runner built for one product runs unchanged against the next. The full per-product table is Appendix C; the binding rules are:

| Item | Rule | Source |
|---|---|---|
| Runtime | **Node.js 24.22.1** in every product, pinned exactly in `.nvmrc`, `package.json#engines.node`, every Dockerfile and the CI matrix; `engine-strict=true`. Node 26.x only through a dated ADR after Q2 2027. Every SDK generated from this Specification's OpenAPI and AsyncAPI documents targets the same runtime line | IPB-01-01 to IPB-01-04; IPB-D-01 |
| Capability ports | External capabilities sit behind IPB-01 §01.4.4 ports (`IDENTITY`, `AUTHZ`, `STORAGE`, `QUEUE`, `WORKFLOW`, `CACHE`, `SEARCH`, `VECTOR`, `SECRETS`, `KMS`, `EMAIL`, `SMS`, `WHATSAPP`, `PUSH`, `VOICE`, `ESIGN`, `ESTAMP`, `KYC`, `COMPANY_DATA`, `EMBEDDING`, `IMAGE_GEN`, `TRANSLATE`, `OCR`, `DOCGEN`, `PDF`, `VIDEO_MEET`, `CALENDAR`, `ANALYTICS`, `TAG_MANAGER`, `FEATURE_FLAG`, `OBSERVABILITY`, `ERROR_TRACKING`, `DNS_CDN`, `RULES`, `LLM`, `SPEECH`, `PAYMENTS`, `PAYOUTS`, `BILLING`, `CRM`, `GEO/MAPS`, `WORKSPACE`, plus supplementary `RERANK`, `INTERPRETER`, `NOTIFY`, `TRUST`, `SUPPORT`, `BACKLOG`, `CONSENT`, `MEDIA`, `AV`, `PLAGIARISM`, `EGRESS`, `LAW_REGISTER`, `HR`, and the product ports `BUREAU`, `AA_FIU`, `ULI_GATEWAY`, `DISBURSEMENT_RAIL`, `ODR`). This Specification's connector names (`OdrProvider`, `ESignProvider`, `WorkplaceProvider`, …) are adapters behind those ports; the SPI in Part 10.1 is unchanged. `ESIGN` in every product other than LawDocs is a hosted hand-off adapter (principle 15), never a credential-bearing ESP adapter | IPB-01 §01.4.4; Part 10 |
| TCP port variables | `APP_PORT`, `MSG_SMTP_PORT`, `OBS_METRICS_PORT` are environment variables catalogued in IPB-11 and are never called "ports" in a contract document; a reference to a *port* in this Specification means a capability port | IPB-11 |
| Error codes | Product problem codes are `[PRODUCT]-[AREA]-[NNN]` with the prefixes in the table below; this Specification's cross-product problem codes stay hyphenated lower-case (`consent-missing`, `regulatory-guard`, …, 3.9) and are re-exported by products under `[PRODUCT]-ECO-[NNN]`. The two code families never collide because one is upper-case prefixed and the other lower-case hyphenated; the catalogue lint rejects a product code that reuses another product's prefix | IPB-10-04; 3.9 |

| Product | Problem-code prefix | Reserved by | API-key prefix (IPB-10-14) |
|---|---|---|---|
| LawDocs | `LD-` | LawDocs Pack v1.1 | `ldk_` |
| LawDocsComply | `LDC-` | LawDocsComply Pack v1.3 | `ldck_` |
| Equator Resolution | `EQ-` | Equator Pack v3.2 | `eqk_` |
| Finbyx | `FBX-` | Finbyx v1.6 | `fbxk_` |
| Udofin | `UDF-` | Udofin v1.3 | `udfk_` |
| Operations Hub | `OH-` | Operations Hub v1.1 | `ohk_` |
| Recovery Suite / Udolex | `RS-` (inside FBX or UDF until standalone; `UDX-` reserved for standalone Udolex) | Part 11.4 | — |
| Shared baseline | `IPB-` with the area prefixes catalogued in each IPB file's §nn.6: `IPB-API`, `IPB-PORT`, `IPB-WHK`, `IPB-INT`, `IPB-MCP`, `IPB-EVT`, `IPB-TRUST`, `IPB-CMS`, `IPB-BRD`, `IPB-VID`, `IPB-AI`, `IPB-SEC`, `IPB-IDN`, `IPB-AUTHZ`, `IPB-KMS`, `IPB-CACHE`, `IPB-STOR`, `IPB-MOD`, `IPB-DB`, `IPB-ENV`, `IPB-SEED`, `IPB-ENG`, `IPB-UX`, `IPB-HLP`, `IPB-TUT`, `IPB-FB`, `IPB-NTF`, `IPB-CST`, `IPB-POL`, `IPB-RES`, `IPB-WEB`, `IPB-RPT`; the draft `IPB-LLM` area is retired in favour of `IPB-AI` *(v1.2 rev. 26 Oct 2026)* | IPB-01 to IPB-13 | — |
| This Specification | hyphenated lower-case problem names (3.9) | Part 3.9 | — |

Collision check (26 October 2026): no two rows share a prefix; `RS-` is used only inside a Finbyx or Udofin deployment and is re-exported as `FBX-RS-NNN` or `UDF-RS-NNN` on the wire. [VERIFY: each product pack confirms its prefix in its own error-code appendix at v1.6 / v1.3 / v1.1 / v3.2 / v1.3 / v1.1]

---

# 4 — IDENTITY, TENANCY AND ACCESS ACROSS PRODUCTS

## 4.1 Organisations, tenants and RE identifiers

- **Organisation registry:** one `org_id` per legal organisation (name, constitution, CIN, masked PAN, GSTIN, LEI, `group_id`, role flags `is_re`, `is_lsp`, `is_odr_institution`, `is_service_provider`, and from v1.1 `is_non_re_lender` (credit co-operative societies) and `is_group_operator` (Infrabyx group companies, Part 4.6)). Groups drive LawDocsComply group mode and group-outsourcing controls (OUT paras 45–51, 90–92).
- **Tenant map:** each product maps its `tenantid` to `org_id` (with environment, status and effective dates), served by `GET /v1/tenant-map` to authorised counterparts only.
- **Links** are explicit, dated and authorise every message between two parties: `re_lsp_link` (products, territories, recovery-agent appointment, DLG flag), `re_odr_link` (rules, fees, clause refs), `re_grc_link` (compliance mode), `cla_link` (co-lenders), `re_sp_link` (service provider or agency appointment under OUT Ch III: services, territories, recovery-agent appointment, scopes, dates; used by agencies, AGY connectors and the field-investigation app). From v1.1: `lender_lsp_link` (a non-RE lender's deal with Udofin; fields as `re_lsp_link` plus `lender_type = NON_RE_SOCIETY`), `tenant_link` (a contract between two tenants for investment, ARC, servicing or look-through data: parties, purpose, events and layouts, dates; Part 6.25) and `group_grant` (Part 4.6).
- **Links added in v1.2** *(v1.2, from LD App. Y)*: `legal_sor_link` (one organisation's tenants in LD and LDC under the same `org_id`: LD tenant, LDC tenant, kernel choices — `GOVERNANCE` → LD or LDC; `HRMS` → LD or LDC; `LEGAL` → LD, or LDC P26 only where no LD tenant exists — effective dates, migration state, approvals by both tenants' admins under maker-checker; decides which product is the system of record per kernel and authorises the projections in 6.31 and 6.23); `signing_handoff_link` (an organisation's tenant in a requesting product, for example Finbyx, and the same organisation's LD tenant: OAuth client id, document classes, `valid_from`, `valid_to`, approver = LD tenant admin; lets the requesting product create LawDocs-hosted signing requests in the organisation's own LD tenant, principle 15); `deposit_link` (one individual's accounts in a depositing product, for example Udofin, and LD: pairwise link ref, depositor client id, LD folder, `valid_from`, `revoked_at`; opt-in deposit of the individual's own documents into their Legal Vault, 6.13); `finbyx_legal_link` (an RE's Finbyx tenant and the same RE's LD tenant: `reid`, `org_id`, both tenants, permitted contracts — template packs, `DocumentShared` to recovery cases, litigation projection — approvals; lets the RE's legal department see recovery litigation and share drafted documents). **Legal-matter system-of-record rule:** where an organisation holds tenants in both LawDocs and LawDocsComply, exactly one product is the system of record for the `LEGAL` kernel (`legal_matter`, `court_case`, `agreement`, `contract_obligation`), recorded in `legal_sor_link`; the default is LawDocs; LawDocsComply P26 holds a projection only and is system of record solely for organisations with no LD tenant. A switch is a `SystemOfRecordSwitched` event (6.29) after a reconciled export and import; until it completes the outgoing product remains the owner. **White-label link** *(v1.2)*: `whitelabel_link` (a reseller or partner `org_id`, the operating Infrabyx legal entity, the `brand_pack` id, the product, the end-customer tenant ids it covers, merchant-of-record choice, DLA and RE references for Udofin brands, `valid_from`, `valid_to`; 5.4).
- **RE identifiers:** `reid` (`re_` + ULID, stable); `rbi_cor_no` verified at onboarding [VERIFY: source for automated checks]; `re_category` and `sbr_layer` from Finbyx `entity_regulatory_profile`; `sarfaesi_notified` (NBFC only with assets ≥ ₹100 crore and debt ≥ ₹20 lakh: S.O. 856(E) of 24 Feb 2020 as amended by S.O. 652(E) of 12 Feb 2021) and `rdb_notified` (false for NBFCs and HFCs unless notified under RDB s.2(h)(ii)) with gazette refs; a SARFAESI notification does not make an NBFC a financial institution under RDB s.2(h) (*Tata Motors Finance v Naushad Khan*, Bom HC, 2023); `lsp_id`; one `dla_id` per DLA per platform per RE (CF para 18).

## 4.2 Service accounts and staff access

- One OAuth client per (product, counterparty, environment, purpose), certificate-bound or `private_key_jwt`, secrets never stored in clear and rotated ≤ 90 days, with owner, scopes, authorising link and expiry; an expired link disables the client.
- Staff use OIDC (preferred) or SAML 2.0 against their organisation's IdP with MFA; **SCIM 2.0** (RFC 7643, 7644) provisions users and groups; leavers removed within 4 hours (privileged within 1 hour) [REC]. An Infrabyx IdP serves the staff of every Infrabyx group company, provisioned by SCIM from the Operations Hub (Part 4.6); authorisation stays per product.
- Roles are product-specific. Neutrals exist only in Equator and counsel only in Finbyx's counsel portal; no Finbyx or Udofin user may be a neutral for the same RE (Part 8.6).
- **LawDocs realms** *(v1.2, from LD App. Y)*: LawDocs keeps realm `ld` (customers, counterparties, professionals) and staff realm `ld-staff`, provisioned by SCIM from OH10 with `group_grant` memberships (4.6). No Finbyx, Udofin or LawDocs delivery user may be a neutral for the same party (8.6).

## 4.3 Borrower identity

Borrower identities are not shared across products without consent (Udofin Part 2). Each product keeps its own account; links use **pairwise pseudonymous `party_ref`s** unique per product pair and RE, so no product can correlate a borrower across REs.

## 4.4 Udofin → Equator without a separate app

1. Equator emits `ADRCaseStatusChanged` with `borrower_action_required` for a case whose RE permits Udofin presentation.
2. On tap, Udofin's backend calls Equator's token-exchange endpoint (RFC 8693) with a signed subject token: pairwise `sub`, `reid`, `adr_case_id`, `acr`, `auth_time`, `consentref`.
3. Equator returns a single-use launch URL valid ≤ 10 minutes, opened in an in-app browser tab.
4. Equator binds the session to the referral's party record and requires **OTP step-up to the RE-registered mobile** before any consent, statement, acceptance or signature (Aadhaar eSign or DSC).
5. Udofin never receives hearing content, the RE's mandate, the selection log or other parties' documents.

Borrowers not on Udofin get a signed magic link from Equator by SMS and email to RE-supplied contacts (never WhatsApp: its Business Messaging Policy bars debt-collection use; Finbyx 7A.0.6, Udofin UR3), valid ≤ 72 hours, with the same step-up. The Finbyx borrower portal follows the Udofin pattern.

**Cross-product customer sign-in by token exchange** *(v1.2, from LD App. Y; LawDocs OI-P01-12)*. The launch pattern above is generalised for **customers of the same organisation** moving between two Infrabyx products (first use: LawDocs ↔ LawDocsComply, Finbyx → LawDocs for signing requests), in addition to the organisation's own enterprise IdP federated into both products (preferred).

| Rule | Detail |
|---|---|
| Mechanism | OAuth 2.0 Token Exchange (RFC 8693) at the **target** product's identity provider; the source presents a short-lived subject token (≤ 60 s, audience = target product, single use, `jti` logged); the target issues its own session — no session, cookie or refresh token is shared |
| Subject | Pairwise subject identifier per product pair; the target resolves it to an existing account of the same person in the same organisation (`org_id` match) or offers sign-up; never creates a membership or role by itself |
| Assurance | Target applies its own step-up (OTP or passkey) before any legal-effect action; Aadhaar is never a login method on either side |
| Scope of launch | Deep link to a named screen (for example "open this signing request", "open this agreement projection"); no data travels in the token beyond `org_id`, pairwise subject, `acr` and the deep-link target |
| Excluded | Consumer Help (principle 14) is never a source or target; staff realms use `group_grant` and SCIM (4.6), not this flow; Equator case-level roles follow the 4.6 neutrality wall; borrowers follow the Udofin → Equator pattern above, never this one |
| Evidence | Both products log launch id, time, subject pair, target and outcome; sharing-ledger entry with `legalbasis = CONTRACT_PERFORMANCE_CUSTOMER` or the customer's `consentref` |
| Open | Token lifetime and pairwise-subject algorithm to be accepted by the LDC, Finbyx and Udofin identity owners [OWNER; LawDocs OI-Y-09]; until then the customer's own IdP federated into both products, otherwise separate sign-in |

## 4.5 Authorisation scopes

Scopes are `[domain].[resource]:[action]`; producers filter fields, and LSP projections are separate registry subjects (`[EventName].lsp`).

| Scope | Granted to |
|---|---|
| `origination.application:write`, `origination.decision:read` | LSPs, DSAs, co-lending originators (own applications) |
| `servicing.loan:read.lsp`, `payments.mandate:write` | LSPs (loans they sourced or service) |
| `collateral.pledge:orchestrate`, `collateral.position:read.lsp` | LSPs as the RE's technology provider (OTP steps, display; never accept, invoke or release) |
| `collateral.position:write`, `recovery.case:write`, `adr.referral:create` | RE system only |
| `colending.share:write` | Co-lender RE systems |
| `collections.allocation:read`, `collections.activity:write` | Appointed agents and LSPs while the appointment is active |
| `origination.verification:read`, `origination.verification:write` | Field-investigation apps and verification agencies with an active `re_sp_link` (own tasks only: `VerificationRequested`, `VerificationCompleted`, `RiskSignalRaised`) |
| `recovery.case:read.lsp`, `litigation.case:read.lsp` | LSPs, if the RE permits (`legal_stage`, RE wording, next action) |
| `recovery.settlement:request` | LSPs and borrower portals (relay only) |
| `adr.case:read.party`, `adr.case:write.institution` | Borrower-facing products; ODR institutions |
| `grc.obligation:read`, `grc.evidence:write`, `privacy.request:write` | Products in a GRC link; every product |
| `platform.module:admin`, `platform.connector:certify` | Entitlement and certification services |
| `ops.tenant:provision`, `billing.entitlement:write`, `platform.entitlement:read` | Operations Hub provisioning and billing services only (Parts 4.6, 6.27, 6.29) |
| `ops.provisioning:ack`, `ops.ticket:write`, `crm.request:write`, `billing.quote:write`, `billing.order:write`, `billing.dispute:write`, `billing.catalogue:read`, `ops.claims:check` | Finbyx and Udofin product services calling the Hub (Equator and LawDocsComply: provisioning acknowledgement, catalogue and claims gate only) (Parts 6.27, 6.29) |
| `billing.usage:write` | Finbyx and Udofin metering services (aggregates only) |
| `members.member:read`, `members.application:write` | Udofin, for a society with an active deal (Part 6.24) |
| `directory.professional:read`, `directory.allocation:write` | Finbyx RS and Udolex (Part 6.29) |
| `directory.conflict:read` | Equator (counts only, Part 4.6) |
| `risk.feed:write`, `grc.kri:read` | Finbyx and Udofin risk services; KRI and obligation pull from LawDocsComply (Part 6.22) |
| `external.workspace:read`, `external.grant:write` | Named external users under an active grant; the RE's system and Udofin's lender portal on a recorded RE approval (Part 4.7) |
| `templates.pack:read` *(v1.2, from LD App. Y)* | Finbyx, LawDocsComply, Operations Hub (signed LawDocs template packs, `GET /v1/template-packs/{pack}/versions/{v}`) |
| `legal.agreement:read`, `legal.matter:read`, `legal.obligation:read` *(v1.2, from LD App. Y)* | LawDocsComply tenant of the same organisation under `legal_sor_link`; Finbyx for linked agreements under `finbyx_legal_link` (`legal.agreement:read` only) |
| `esign.request:create`, `esign.request:read` *(v1.2, from LD App. Y)* | A product acting for an organisation in that organisation's own LawDocs tenant under `signing_handoff_link`, approved by the organisation's LawDocs admin with step-up |
| `documents.deposit:write` *(v1.2, from LD App. Y)* | Delegated user tokens issued by LawDocs to approved apps (Udofin first) for one individual's chosen folder |
| `litigation.case:read.legal` *(v1.2, from LD App. Y)* | The RE's own LawDocs tenant under `finbyx_legal_link` |
| `adr.referral:create.party` *(v1.2, from LD App. Y)* | LawDocs only (non-loan disputes; 6.9) |
| `governance.resolution:read`, `governance.kmp:read` *(v1.2, from LD App. Y)* | LawDocs under `legal_sor_link` (same organisation) |
| `ops.client_conflict:check` *(v1.2, from LD App. Y)* | LawDocs Consumer Help conflict service only (flags only) |
| `directory.application:write`, `crm.lead:write`, `crm.activity:write`, `ops.asset:write`, `ops.delivery_assignment:write` *(v1.2, from LD App. Y)* | LawDocs → OH9, OH3, OH7 (`int` only); Operations Hub OH4 → LawDocs for delivery assignments |
| `ops.provisioning:ack`, `ops.ticket:write`, `crm.request:write`, `billing.*`, `ops.claims:check`, `billing.usage:write`, `directory.professional:read`, `directory.allocation:write`, `ops.conflict:check`, `adr.case:read.party` *(v1.2, from LD App. Y)* | Existing rows: LawDocs added as grantee on the same terms as Finbyx and Udofin (LawDocs runs B2C and B2B checkout on OH8) |
| `trust.document:read`, `trust.document:ack` *(v1.2)* | Every product's TRUST port client, for its own tenants' mirrors (6.34) |
| `vidhi.task:delegate`, `vidhi.task:report` *(v1.2)* | A product's Vidhi kernel acting for a named user under `consentref` or `legalbasis`; read-only skills until the `vidhi.a2a.enabled` ADR (4.9) |
| `tenancy.whitelabel:provision`, `brand.pack:read` *(v1.2)* | Operations Hub provisioning service and the owning product's Brand Studio; any product reading a published pack for its own hosts (5.4) |
| `cms.content:syndicate`, `crm.lead:write`, `consent.marketing:write`, `messaging.template:read`, `feedback.item:write`, `eng.release_note:write`, `identity.preferences:sync` *(v1.2)* | Product public-site and platform services calling the Hub or sibling products for the 6.37–6.40 events; never tenant customer data |

## 4.6 Group identity, cross-company roles and the Operations Hub

The **Infrabyx Operations Hub** (product code `OH`; CloudEvents `source` `urn:infrabyx:oh:[legalentityid]`: the OH tenant segment is always the owning Infrabyx group company's `legal_entity_id`, because the only OH tenants are group legal entities) is the group's internal operations platform: CRM, client onboarding and delivery, support desk, customer success, marketing and brand, the revenue catalogue and billing engine, the professional and advocate directory, Infrabyx staff HRMS and payroll, internal controls, workplace integration, the engineering-operations console and the certification control library (Operations Hub Master Build Prompt v1.0, OH1–OH14). It is a separate application, repository, database, KMS key hierarchy and admin group. It is **never** a super-admin console of Finbyx, Udofin, Equator or LawDocsComply and holds no credential, token or session that can act inside a customer tenant.

**Group SSO.**

- One Infrabyx identity provider (Microsoft Entra ID or Google Workspace, per the owner's office-suite decision; OIDC; phishing-resistant MFA for privileged roles) authenticates the staff of every group company; a group company may federate its own IdP instead.
- OH10 is the joiner-mover-leaver source: SCIM 2.0 provisions identities and group memberships into each group product's **staff realm**; leavers are removed within 4 hours and privileged leavers within 1 hour (4.2).
- Authentication is group-wide; **authorisation stays per product and per legal entity.** Staff tokens carry `org_id` (employing entity), `entity_scope[]`, `product_scope[]` *(v1.2; 4.8)*, `grant_ids[]`, `acr` and `auth_time`; each product evaluates its own roles and never trusts an OH role name as a product permission.
- RE, society and borrower users never authenticate through the Infrabyx IdP (4.2, 4.3).

**Legal-entity scopes.** The organisation registry (4.1) carries every group company as an `org_id` under the Infrabyx `group_id` with the role flag `is_group_operator`. Every OH record carries `legal_entity_id` (the Infrabyx company that owns it: the company selling Finbyx, the company running Udofin, Equator Resolution, LawDocs, LawDocsComply, LawDocs Trainings, Shikargah Hospitality and others) and is visible by default only to that entity's staff. Group views are aggregates unless a grant says otherwise.

**Purpose-bound, time-limited grants.** Cross-company access is denied by default and exists only as a `group_grant`:

| Field | Rule |
|---|---|
| `principal` | Named user or service account; never a shared login |
| `role` | A role from the target product's own catalogue |
| `entity_scope[]`, `tenant_scope[]` | Target `org_id`s; product tenant ids (empty for OH-internal work) |
| `data_class_max` | Highest class reachable (13.2); `HR` and `SPI` need the DPO's specific approval |
| `purpose` | SHARED_SERVICE_PAYROLL, SHARED_SERVICE_FINANCE, SHARED_SUPPORT, IMPLEMENTATION_DELIVERY, CUSTOMER_SUCCESS, GROUP_REPORTING_AGGREGATE, GROUP_INTERNAL_AUDIT, ENGINEERING_OPS, DIRECTORY_ADMIN, INCIDENT_RESPONSE |
| `valid_from`, `valid_to` | At most 90 days; renewal is a fresh approval, never an automatic extension |
| `approvers` | Head of the principal's entity, head of each target entity and the DPO; maker-checker; self-approval blocked |
| `evidence_ref` | Intra-group agreement or DPA clause (purpose, security, sub-processing, 24-hour breach notice, return and deletion, audit) |

- Grants reach products as SCIM group memberships carrying `valid_to`; each product enforces expiry itself (no dependency on OH availability) and ends sessions within 60 seconds of `valid_to` or revocation.
- Every grant use is logged in the target product; each entity reviews its grants quarterly (`AccessReviewCompleted`, `review_scope = OH`, 6.23).
- Where a group company supplies services to an RE, the RE's group-outsourcing controls apply: Board policy and SLAs, customer disclosure of the actual provider, confidentiality of customer data, demarcation, stand-alone risk management and arm's-length, objectively selected arrangements (OUT paras 45–51, 90–92).
- A shared operations user (for example, a support engineer serving Finbyx and LawDocsComply tenants) holds one identity with separate product roles. Access to **customer tenant data** happens only inside the product, through its break-glass procedure (Finbyx M19; Udofin U23), time-boxed, reason-coded, logged and visible to the tenant; never through the Hub.

**What the Hub may and may not receive.**

| Data | Hub receives | Rule |
|---|---|---|
| Commercial records (organisations, contracts, plans, invoices, payments, business contacts of customer staff) | Yes; the Hub is their system of record | DPDP notice for business contacts; CRM consent per OH3 |
| Usage | Aggregates per tenant, legal entity, meter and period (`usage_aggregate_v1`) | Never loan, borrower, member, user or record ids (6.27) |
| Operations | Release, change and control-evidence metadata; export, backup and restore status; external-access counts; support tickets; implementation milestones | No customer content (6.26, 6.29) |
| Filing metadata | Return code, period, due date and status (`ReturnDue`, `ReturnFiled`, `PeriodClosed`) | Only where the tenant opts in to Infrabyx filing-support monitoring; never values |
| Borrower, applicant, guarantor, member, depositor or policyholder personal data; loan-level, KYC, bureau, grievance, recovery, litigation or ADR content; tenant HR data; Udofin wellness add-on data; insurance proposal data | **Never** | Gateways reject with `dataclass-not-permitted` (3.9); OH-bound schema subjects carry `x-dataclass` no higher than `INTERNAL` |

- **Client data migration** (OH4) runs inside the client's own product tenant with the product's import tools; the Hub tracks milestones, record counts and reconciliation results only. No client file is staged in the Hub, its document store, its email, its CRM or a shared drive.
- Infrabyx staff personal data (HR class) stays inside OH10 under OH's own fiduciary role; customer staff business contacts are the only customer personal data the Hub holds.

**Equator neutrality wall.**

- Equator keeps its own tenant, database, KMS keys and admin group (8.1, 8.6). OH1 enforces a separation-of-duties rule: no `group_grant` combines any Equator case-level role (case manager, panel administrator, neutral) with any Finbyx, Udofin, LawDocsComply or RE-facing sales, collections or customer-success role, and no Finbyx or Udofin user is ever a neutral (8.6). *(v1.2, from LD App. Y)* From v1.2 the rule also bars combining any Equator case-level role with a LawDocs delivery role (`OPS_RM`, `OPS_PROFESSIONAL`, `OPS_DELIVERY_LEAD`, `OPS_CONSUMER_CASE_MANAGER`) for the same party, and every grant carries `product_scope[]` (4.8).
- The Hub may hold Equator's own commercial records and case counts by status. It never holds case content, selection logs, neutral performance, or outcomes broken down by RE, and never links an Equator outcome to an RE's commercial account, renewal, discount, CRM score or sales incentive (no outcome-linked fees or rewards: 8.6).
- **Directory conflict service:** Equator screens a proposed neutral with `POST /v1/conflicts/check` (6.29; look-back `P3Y` by default) and receives only the count of allocations by that RE in the window and a relationship flag with its category, enough for its Sixth and Seventh Schedule disclosure and per-lender caps; never matter, contract or pipeline details. Finbyx RS receives the identity-level `equator_neutral` flag and blocks allocating an Equator panel neutral as counsel in a matter that RE has referred to Equator [REC].
- Wall breaches (attempted grant, blocked query, misrouted event) are logged and reviewed by Equator's independent oversight; the annual independence audit (8.6) covers the Hub's Equator-related grants.

**Other group products.** LawDocsComply keeps per-RE compliance modes (9.1); Infrabyx's own obligations (CERT-In, DPDP, Labour Codes, GST, Companies Act) run in an `LDC_GROUP` instance for the Infrabyx group, and no RE's LawDocsComply data is visible to the Hub. LawDocs supplies templates and the public face of the directory (BCI Rule 36 fields only). Customers are told which group company supplies each service (OUT para 46).

## 4.7 External auditor and supervisor access

**Principle.** The **RE authorises every grant**; each product provisions only on the RE's recorded approval, read-only, time-limited and logged (OUT paras 34(ii), 34(vii)–(ix), 74(ii), 74(xii), 81; CYB paras 46, 57). Finbyx Part 7D AU7 is the RE-side register and workspace; Udofin Part 7H RA2 is the LSP-side workspace for the RE's slice; LawDocsComply provides the same where it hosts the RE's compliance records. A **direct RBI request** to Udofin or Finbyx as the RE's service provider (contract right under OUT paras 34(ix), 74(xii)) is honoured after verifying the officers' authority; the product notifies the RE within 1 hour unless legally barred (counsel's reference recorded) [VERIFY: counsel opinion; Finbyx Appendix B]; the RE's approval records awareness and cannot narrow RBI's scope.

**Applicability.** Mandatory for BL NBFCs with assets of ₹500 crore and above (CYB Chapter IV, paras 46, 57); a supervisory expectation for ML and UL [INTERP; SBR para 32]; available to every tenant. Non-RE lenders: Registrar and co-operative auditors reach records only through the society's contract and its State or MSCS Act [VERIFY per Act]. No s.45N power reaches a non-group LSP; access to Udofin rests on the LSP agreement.

| Code table | Values |
|---|---|
| `grantee_type` | RBI_SUPERVISOR, RBI_INSPECTION_TEAM, NHB, NABARD, IFSCA, REGISTRAR_INSPECTOR, RE_STATUTORY_AUDITOR, RE_INTERNAL_AUDITOR, RE_CONCURRENT_AUDITOR, RE_IS_AUDITOR, RE_SECRETARIAL_AUDITOR, RE_TAX_AUDITOR, POOLED_AUDIT_FIRM, COOP_AUDITOR, CO_LENDER_OR_INVESTOR_AUDITOR, PROVIDER_ASSURANCE |
| `basis_code` | RBI_S45N, RBI_S45NAA, OUT_34_VII, OUT_34_VIII, OUT_34_IX, OUT_74_II, OUT_74_XII, OUT_81, OUT_77_POOLED, CYB_46, CYB_57, CA13_S143_1, CA13_S204, IAF_40, BR_S35, NHB_ACT, NABARD, IFSCA, STATE_COOP_ACT, MSCS, CONTRACT |
| `pii_level` | MASKED (default), UNMASK_ON_REQUEST, FULL (second RE approval) |
| `export_level` | NONE, AGGREGATE, CAPPED_RECORDS, FULL (second RE approval) |
| `query_level` | DASHBOARDS, REPORT_CATALOGUE, ADHOC_READONLY |

**Grant record** (`external_access_grant`, owner: the RE's register): grant_id, reid (exactly one; a pooled audit gets one slice per RE, each approved by its RE), grantee type, organisation, named grantee identities (pseudonymous user refs plus verified e-mail domain: `rbi.org.in` for RBI officials, the firm's domain for auditors), basis code, inspection or engagement reference, legal entities, periods, products and dataset catalogue, record filters, PII, export and query levels, valid_from, valid_to, RE maker and checker (CCO or nominee as maker; CISO or MD and CEO delegate as checker; CFO as maker for statutory auditors), state.

**Lifecycle.** `REQUESTED → BASIS_RECORDED → SCOPE_DEFINED → RE_APPROVED → PROVIDER_APPROVED → PROVISIONED → ACTIVE ⇄ EXTENDED → EXPIRED or REVOKED → ARCHIVED`. Default duration: the engagement or inspection window in Finbyx, 30 days in Udofin; **maximum 90 days per grant**, renewable by fresh approval (Finbyx Appendix B). A provider may not refuse a valid RE-approved or RBI request; it may only confirm provisioning against scope.

**Federation.** The RE's register is the master. `POST /v1/external-access/grants` (6.21) carries the grant to Udofin, LawDocsComply or another Finbyx tenant of the same RE; each provisions locally and returns status; `DELETE /v1/external-access/grants/{id}` revokes everywhere. Each product emits `ExternalAccessGranted`, `ExternalAccessUsed` and `ExternalAccessRevoked` to the RE's register, the RE's GRC destination and SIEM; the Operations Hub receives counts only. The same three events are allowed in the `oh` scope only for `PROVIDER_ASSURANCE` grants to the OH14 room (below).

**Common controls (every product).**

- Read-only replica or point-in-time snapshot per grant; SELECT-only database roles; scope `external.workspace:read` only; no write route reachable with a workspace token (enforced at database, gateway and UI).
- Named accounts, MFA, optional IP allow-list, device-session binding, confidentiality banner citing the basis; no shared logins and no reuse of break-glass accounts.
- Row-level security by RE, entity, branch and period; masking of PAN, Aadhaar references, account numbers, phone and e-mail by default; unmasking per record with a typed reason, logged and shown in the RE's daily report.
- Exports watermarked (grantee, organisation, grant id, time, "Confidential — supplied under [basis]"), hashed, capped (Finbyx default 50,000 rows), delivered only through the workspace (never e-mail); bulk PII export needs the scope and a second RE approval.
- Idle timeout 15 minutes, absolute session 8 hours; anomaly alerts (volume above 10 times the grant's daily median, out-of-window access, repeated unmask attempts) to the RE's CCO and CISO; daily activity report to the CCO.
- Out of scope always: Udofin wellness add-on and insurance data (separate fiduciary role), other REs' data, Infrabyx's own HR data. Privileged legal material only with counsel's approval (13.2 `LEGAL`).
- Grant, scope, logs and exports retained for the inspection cycle plus 8 years [REC; CA13 s.128(5) 8 years; PMLA 5 years].
- **Provider assurance:** auditors and supervisors auditing an Infrabyx product itself (OUT paras 34(vii), 74(ii), 76–81) receive a `PROVIDER_ASSURANCE` grant to a separate room served from OH14 (SOC and ISO reports once issued, VAPT summaries, BCP and DR evidence, sub-processor list); it contains no tenant data. The grant follows the same lifecycle, 90-day maximum and controls, but is approved by the owning Infrabyx entity (head and CISO, maker-checker) on the requesting RE's or auditor's written request; OH14 emits the `ExternalAccess*` events with `source` `urn:infrabyx:oh:[legalentityid]` and `reid` of the requesting RE (or `none` for Infrabyx's own assurance auditors).

| Scope | Granted to |
|---|---|
| `external.workspace:read` | Named external users under an ACTIVE grant (own RE slice only) |
| `external.grant:write` | The RE's system (Finbyx AU7) and Udofin's lender portal acting on a recorded RE approval |

Scopes for the other v1.1 domains are listed in 4.5.

## 4.8 Product scope for Hub and group staff *(v1.2)*

IPB-D-12: Operations Hub staff are segregated by **product scope in addition to legal entity**. A support engineer serving LawDocsComply tenants must not see Finbyx tenants of the same group company; a Finbyx implementation lead must not open Equator's commercial records. 4.6 already scopes by `entity_scope[]`; this section adds the second axis.

| Field or rule | Detail |
|---|---|
| `product_scope[]` on staff tokens | Values from the `product` code table (5.3): `FX`, `UD`, `EQ`, `LDC`, `LD`, `OH`, `RS`; `OH` means Hub-internal work only. Issued by the Infrabyx IdP from SCIM group membership; a token without `product_scope` is treated as `[]` (nothing) |
| `product_scope[]` on `group_grant` (entity 44) | **Mandatory and non-empty**; a grant to several products is several grants; `purpose` must be consistent with the product (for example `CUSTOMER_SUCCESS` for `EQ` is refused by the OH1 separation-of-duties rule for anyone holding an Equator case-level role) |
| SCIM group naming | `grp:[legal_entity_id]:[product]:[role]`; products map only groups whose `[product]` segment is their own code (OH maps `OH` and, for read-only group views, `GROUP_REPORTING_AGGREGATE` grants) |
| Default deny | A request to product data whose product is not in `product_scope[]` is refused with `product-scope-denied` (403) even when `entity_scope[]` and role match; OH screens filter every list, search, export and report by `product_scope[]` before `entity_scope[]`; Cmd+K and Vidhi in OH search only inside scope |
| Duration | At most 90 days (as 4.6); renewal is a fresh approval; expiry ends sessions within 60 seconds; the product enforces expiry itself |
| Audit | Every grant use is ledgered with `product`, `legal_entity_id`, `tenantid` (hashed), purpose and outcome; quarterly `AccessReviewCompleted` with `review_scope = OH` lists grants by product |
| Customer tenant data | Unchanged: never through the Hub; only inside the product through its break-glass procedure, time-boxed and visible to the tenant (4.6) |

```gherkin
@ECO-4.8-AT-01
Feature: Product scope default deny
  Scenario: Entity matches, product does not
    Given a Hub user with entity_scope [ent_lawdocs] and product_scope [LDC]
    When they request GET /v1/crm/accounts?product=FX for ent_lawdocs
    Then 403 product-scope-denied and an audit entry with outcome DENIED
  Scenario: Grant without product scope
    When a group_grant is submitted with product_scope []
    Then it is rejected at validation and no SCIM group is created
  Scenario: Expiry
    Given a grant with valid_to T
    When T+60s passes
    Then every session issued under the grant is ended and the SCIM group membership is gone
  Scenario: Equator wall
    Given a user holding an Equator case-level role
    When a group_grant with product_scope [FX] and purpose CUSTOMER_SUCCESS is requested for them
    Then OH1 refuses it under the separation-of-duties rule (4.6)
```

## 4.9 Vidhi cross-product delegation *(v1.2)*

One AI employee, Vidhi, runs in every product on the shared kernel (IPB-D-03, IPB-03). A task in one product may need data or an action from another (for example, LawDocsComply's compliance-calendar skill needs the execution status of an agreement held in LawDocs; Finbyx's collections skill needs an Equator case status). Principle 16 and this section are the only route.

| Rule | Detail |
|---|---|
| Channel | Only `VidhiTaskDelegated` (6.36) over the standard event path, answered by `VidhiTaskAccepted`, `VidhiTaskCompleted` or `VidhiTaskRejected`; there is no agent-to-agent token, shared MCP session, cross-product MCP server call or direct API call by an agent principal into another product (IPB-10-19 `act` tokens are product-local) |
| Consent | Every delegation carries the acting user's `consentref` naming the target product and purpose, or a `legalbasis`; the target rejects a delegation without one (`consent-missing`) and never infers consent from the link between tenants |
| Autonomy | The target executes the task as **its own** Vidhi task, under its own skill manifest, the tenant's operating level and the **lower** of the requested `autonomy_ceiling` and the target skill's ceiling; until the dated ADR behind `vidhi.a2a.enabled` (IPB-03-68) only read skills (L0–L1) may be delegated |
| Locked list | An action on the IPB-03-71 locked human-approval list, or on the target product's own locked list (IPB-03-74), can never be delegated: the target rejects with `locked-action` (403), emits `in.[product].vidhi.LockedActionAttempted.v1` internally and auto-demotes the requesting skill through `VidhiTaskRejected` with `reason = LOCKED_ACTION`. Equator case-level skills are never a delegation target from Finbyx, Udofin or LawDocs (8.6) |
| Identity | `requested_by` is a pairwise pseudonymous user ref; the target maps it to a user holding the required role in its own tenant of the same `org_id`; if none exists the delegation is rejected (`scope-insufficient`) |
| Data class | Inputs travel by reference (`inputs_ref` resolvable only in the source product with the target's scopes); outputs likewise (`outputs_ref`); the envelope `dataclass` is the highest class referenced; `REGULATED`, `SPI`, `HR`, `WELLNESS` and `CONSUMER_HELP` are never delegable |
| Budget and time | `due_at` ≤ 7 days; the target may lower the budget; an expired delegation is `VidhiTaskRejected` with `reason = EXPIRED`; one open delegation per (`msn_id`, `task_type`, target) |
| Evidence | Both products record the delegation in their Vidhi ledger and "What Vidhi did today"; the source shows the result with the target product's provenance block (IPB-02-72) |
| Kill switch | `kill.vidhi.a2a` (platform) pauses all delegations; the target returns `delegation-not-permitted` (403) |

**Delegation state machine** (subject = `msn_id`/`dtask_id`; ordering by `seq`).

| From | Event | To | Who |
|---|---|---|---|
| — | `VidhiTaskDelegated` | REQUESTED | Source Vidhi |
| REQUESTED | `VidhiTaskAccepted` | ACCEPTED | Target Vidhi (manifest, consent, ceiling, locked-list checks passed) |
| REQUESTED | `VidhiTaskRejected` (`CONSENT_MISSING`, `LOCKED_ACTION`, `CEILING_EXCEEDED`, `NO_USER`, `FLAG_OFF`, `DATA_CLASS`) | REJECTED | Target |
| ACCEPTED | `VidhiTaskCompleted` | COMPLETED | Target (outputs by reference) |
| ACCEPTED | `VidhiTaskRejected` (`EXPIRED`, `CANCELLED_BY_TARGET`, `APPROVAL_DECLINED`, `CONSENT_WITHDRAWN` *(v1.2 rev. 26 Oct 2026)*) | REJECTED | Target (`CONSENT_WITHDRAWN` when `ConsentWithdrawn` for the `consentref` arrives mid-task; partial outputs are discarded) |
| REQUESTED, ACCEPTED | `VidhiTaskDelegated` with `action = CANCEL` | CANCELLED | Source (idempotent) |
| COMPLETED, REJECTED, CANCELLED *(v1.2 rev. 26 Oct 2026)* | any later event for the same `dtask_id` | unchanged (terminal) | Both: a `CANCEL` arriving after `VidhiTaskCompleted` is a no-op and the result stands; a `VidhiTaskCompleted` arriving after the source cancelled is ledgered as `late_result`, its `outputs_ref` is never dereferenced, and the target is told through `VidhiTaskDelegated` `action = CANCEL` (idempotent) |

| Scenario | Expected behaviour |
|---|---|
| Happy path | LDC delegates "agreement execution status" to LD with `consentref`; LD accepts (read skill), completes with `outputs_ref`; LDC renders with LD provenance |
| Failure — locked action | FX delegates "initiate eSign" to LD; LD rejects `LOCKED_ACTION`; FX skill auto-demoted; sponsor notified within one minute |
| Failure — no consent | Delegation without `consentref`; gateway rejects `consent-missing`; nothing reaches the target skill |
| Concurrency | Two identical `VidhiTaskDelegated` with the same idempotency key (`msn_id`, `task_type`, `to_product`, `attempt`): one task; the second returns the stored acceptance |
| Out of order | `VidhiTaskCompleted` arrives before `VidhiTaskAccepted` at the source: parked 15 minutes by `seq`, then replayed (3.5) |
| Cross-over cancel *(v1.2 rev. 26 Oct 2026)* | Source cancels at T, target completes at T+1 s: terminal-state precedence applies; the first terminal event the *source* ledgered wins at the source, the first the *target* ledgered wins at the target, and both sides record the other's late event; nothing is re-opened |
| Consent withdrawn mid-task *(v1.2 rev. 26 Oct 2026)* | `ConsentWithdrawn` (6.14) for the `consentref`: target rejects `CONSENT_WITHDRAWN`, discards partial outputs; source shows "stopped: consent withdrawn" |
| Rollback | `kill.vidhi.a2a` on: open delegations are rejected `delegation-not-permitted` with `reason = FLAG_OFF`; completed outputs remain as data with provenance; no state in the target is changed because only read skills are delegable before the ADR |

```gherkin
@ECO-4.9-AT-01
Feature: Vidhi delegation boundaries
  Scenario: Locked action never delegated
    Given vidhi.a2a.enabled is on in LD and FX
    When FX emits VidhiTaskDelegated with task_type INITIATE_ESIGN
    Then LD emits VidhiTaskRejected with reason LOCKED_ACTION and 403 locked-action is logged
    And no signing request exists in LD
  Scenario: Ceiling is the lower of the two
    Given the LD skill ceiling is L1 and the request asks L3
    When LD accepts
    Then the task runs at L1 and VidhiTaskAccepted carries autonomy_level L1
  Scenario: Consent missing
    When a VidhiTaskDelegated arrives without consentref or legalbasis
    Then the gateway rejects it with consent-missing before any skill runs
```

---

# 5 — CANONICAL DATA MODEL

## 5.1 Conventions

Every entity has `id` (prefix + ULID), `reid`, `tenantid`, `owner_system`, `version`, `created_at`, `updated_at`, `source_refs[]`; every schema field carries `x-dataclass`. Money `{"amount": "125000.00", "currency": "INR"}`; rates as percent per annum with day count. PAN and bank accounts travel masked plus keyed token; Aadhaar numbers never; clear identifiers (`SPI`) only to the RE. Owners: **FX** Finbyx or the lender's certified LMS (an RE, or a non-RE lender such as a credit co-operative society); **UD** Udofin; **EQ** Equator or another ODR institution; **LDC** LawDocsComply or the RE's GRC tool; **RS** Recovery Suite (in FX or standalone Udolex); **OH** Infrabyx Operations Hub; **LD** LawDocs *(v1.2, from LD App. Y)*; **INS** insurer or IRDAI-registered partner; **CIC** credit information company; **EXT** external provider.

## 5.2 Entity catalogue and owners

| # | Entity | Owner | Key fields (beyond 5.1) | Copies |
|---|---|---|---|---|
| 1 | `party` | Onboarding product; FX CIF for the RE | type, name, DOB, pan_token, contacts and addresses with source, is_deceased, legal_heirs | UD, EQ, RS |
| 2 | `borrower` | FX | party, loans, ucic, household income (CF para 51), udyam, fraud and WD flags, ibc_state | UD, EQ, RS |
| 3 | `guarantor` | FX | party, loan, type, amount, invoked_at, is_pg_to_corporate_debtor | RS, EQ |
| 4 | `regulated_entity`, `lsp` | Ecosystem registry | category, layer, SARFAESI and RDB flags, GRO; LSP is_company (CF para 19), nodal officer (CF para 12), DLAs | All |
| 5 | `product` | FX | family, version, collateral types, rate model, charges, KFS template, cooling-off, recovery playbook, LAS haircut table | UD |
| 6 | `application` | UD journey; FX once submitted | product, amount, tenor, purpose, applicants, consents, KYC, bureau and AA refs, documents, collateral offers, dla_id, status | Both |
| 7 | `offer`, `kfs` | FX | APR, EMI, penal charges, proposal_no, validity (RBC para 29), KFS Part 2 items 1, 4, 5, 6(ii), hash | UD |
| 8 | `loan` | FX | lender of record, co-lenders and shares, outstanding by component, dpd, asset_class, npa_date, restructured, technical write-off, servicer, transferred interests | UD, RS, EQ |
| 9 | `schedule` | FX | version, instalments, moratorium, tranches | UD |
| 10 | `payment` | FX | utr, rail, value date, amount, allocation by component and co-lender share, collected_by (RE, APPOINTED_AGENT, LSP_AS_AGENT) | UD, RS, EQ |
| 11 | `mandate` | FX; UD evidence | umrn, type, sponsor bank, limits, beneficiary (must be RE) | UD |
| 12 | `collateral` | FX | collateral_type (5.3), owners, valuations, charge {type, registry, registry_ref, satisfied_at}, insurance, custody, release status | UD, RS |
| 13 | `securities_position` | FX; depository or RTA external truth | ISIN or scheme, folio or BOID token, units, pledge_ref, provider, status (7.3), price and as_of, haircut, eligible value | UD |
| 14 | `drawing_power_snapshot` | FX | eligible value, haircut version, DP, limit, utilised, reservations, available, LTV, breach and stale flags | UD |
| 15 | `margin_call` | FX | LTV, shortfall, cure options, cure_deadline (working days), basis (CF para 106(1) or Board policy), status | UD |
| 16 | `dlg_arrangement` | FX ledger; UD own records | form (CF para 23), fixed set, cap base (amount disbursed, CF para 24; CLA outstanding, TDCR para 123), cap, invocations, recovery shares | UD |
| 17 | `colending_arrangement` | Each co-lender for its share | cla_regime, shares (NBFC ≥ 10%, TDCR para 102), blended rate, escrow (REs only), appropriation, customer-interface and servicer RE, recovery matrix, DLG provider | Partner, UD (disclosure) |
| 18 | `loan_transfer` | Transferor, transferee | mode (ASSIGNMENT, NOVATION, PARTICIPATION, SECURITISATION, ARC_SALE), transferee, share, servicer, payment instructions, trade-report ref (TDCR para 94) | UD, EQ |
| 19 | `recovery_case` | RS | trigger, strategy {permitted, blocked with reasons, selected, rule version}, limitation dates, stage, officer, agency, counsel, holds | UD (projection), EQ, LDC |
| 20 | `notice` | RS | instrument (e.g. LRN, S13_2, S13_4, RULE_8_6, S138, S25_PSS, ARB_S21, CONCILIATION_S62, IBC_DEMAND, AGENT_INTIMATION, GOLD_AUCTION, OTS_OFFER), statute ref, template version, language, addressees, dues snapshot, signer | UD, EQ |
| 21 | `service_proof` | RS (EQ for its notices) | per party per mode: booking or message id, status, evidence hashes, deemed service date and rule, deadlines | EQ, courts |
| 22 | `settlement` | RS; EQ holds ADR instruments | origin (DIRECT, LSP_REQUEST, ADR, LOK_ADALAT, COURT), sacrifice, approver level (RSA para 16(5)), Board ref, schedule, restructuring (para 89), consent decree (para 100), cooling end (para 95) | UD, EQ |
| 23 | `adr_case` | EQ docket; RS referral | process, basis (PRE_NAMED_INSTITUTION, POST_DISPUTE_CONSENT, CONCILIATION_INVITATION, COURT_REFERRAL), clause ref, seat, claim, parties, state (8.3), neutral, clocks | RS, UD |
| 24 | `litigation_case` | RS | role, mechanism, forum, case no, CNR, claim, stage, next date, counsel, linked matters, stay, outcome | UD, LDC |
| 25 | `hearing`, `order` | RS (courts); EQ (ADR) | date, mode, purpose, attendance, next date; order type (INTERIM, FINAL, DECREE, AWARD, RECOVERY_CERTIFICATE, STAY), directions with due dates | UD (date), LDC |
| 26 | `asset_sale` | RS | mode, platform, reserve and basis, notices, H1, 25% deposit and balance dates (SARFAESI Rules 9(3)–(4)), certificate, proceeds, surplus or shortfall | UD |
| 27 | `compliance_obligation`, `control`, `evidence` | LDC (obligations); operating product (controls, evidence in its India store) | obligation_ref (e.g. `RBI/DOR/2025-26/352#124`), paragraph, applicability; control component and frequency; evidence hashes, masked sample, hash-chain pointer | All |
| 28 | `document` | Producing product | type, version, sha256, signed URI, signatures (eSign, DSC, PAdES), e-stamp, retention class, legal hold | Per permission |
| 29 | `consent_artefact` | Capturer (UD, FX, AA, EQ) | consentref, party_ref, named recipients, purpose, categories, notice version, method (OTP, ESIGN, AA_ARTEFACT, WRITTEN), expiry, withdrawal, evidence hash | Recipients |
| 30 | `return_definition`, `return_version` | FX | regulator, portal, return code, applicability rule, frequency and due rule, template hash, cell-map version, effective dates, citation (e.g. SR para 21) | LDC (metadata) |
| 31 | `return_run`, `return_acknowledgement` | FX | return code, period, run no, snapshot hash, state (Finbyx RR3.1), validation and reconciliation hashes, approvals, package hash (`return_package_v1`), acknowledgement ref, revision reason | LDC; OH (metadata, tenant opt-in) |
| 32 | `bureau_cycle`, `bureau_file`, `bureau_rejection` | FX | CIC, layout and version, cycle (DL, W1–W3, ME, DC, AH, RR), reference date, counts, file hash, transmission and acknowledgement times, rejections by uniform reason code, DQI | LDC |
| 33 | `lender_deal`, `deal_config_version` | UD (deal record); the RE approves | lender org, lender_type, state (Udofin UP1), mode (PILOT, GENERAL), products, channels, states, configuration sections without commercial terms (`deal_config_v1`), RE approval refs, storage target ref | FX (LSP register), LDC |
| 34 | `member`, `share_ledger` | FX or the society's certified system | lender id, member party_ref, class (ORDINARY_VOTING, NOMINAL, ASSOCIATE, NON_VOTING_SHAREHOLDER, INSTITUTIONAL), status, admission and exit dates, borrowing eligibility, share holding and transactions | UD (members who applied through Udofin or consented) |
| 35 | `group`, `centre`, `centre_meeting` | FX (or the lender's LMS); UD for meetings closed in its tools | type (JLG, SHG), member party_refs, state, centre and designated place (RBC para 90), meeting schedule, attendance, receipts, postings | UD |
| 36 | `investment_position`, `security_receipt` | FX (investment book; ARC for SRs it issues) | ISIN, category, classification, quantity, cost, fair value and level, valuation method and price source; SR scheme, class, QB holder, units, NAV, rating | Investor, holder and transferor tenants under a `tenant_link`; LDC (aggregates) |
| 37 | `securitisation_transaction` (servicing) | FX as originator-servicer | SPE, trustee, pool, waterfall version, collections held in trust, remittances, deficiency ledgers, triggers, reports (`servicer_report_v1`) | Trustee, investor tenants |
| 38 | `plan`, `entitlement`, `invoice`, `subscription_payment` | OH (catalogue, invoices, payments); FX or UD (entitlement as applied) | SKU, modules, meters, price book, revenue-stream flags, legal-entity scope, limits, start, end; invoice GST fields; payment status | FX, UD |
| 39 | `usage_aggregate` | FX, UD (metered at source) | tenant, legal entity, meter, meter_kind, period, quantity, statement hash; never record ids (`usage_aggregate_v1`) | OH |
| 40 | `export_job`, `archive` | Producing product | scope, requester, approvers, as_of, folder profile, manifest hash, destination type, file count, bytes, predecessor archive (`archive_manifest_v1`) | Tenant compliance destination; OH (counts) |
| 41 | `storage_target` | Producing product (per tenant, or per deal in UD) | provider, region, residency evidence, data classes allowed, key mode (PLATFORM, BYOK, HYOK, CLIENT_SIDE), write-once, certification version, health | OH (status only) |
| 42 | `professional`, `matter_allocation` | OH (directory identity and status); the RE's system (panel approval and allocation, Finbyx R11) | BCI Rule 36 fields (name, address, contacts, enrolment no and State Bar Council, enrolment date, qualifications, practice areas), courts, languages, status, equator_neutral flag; allocation: matter type, forum, basis, conflict-check ref | FX (RS), Udolex; OH (allocation counts) |
| 43 | `external_access_grant` | The RE's register (Finbyx AU7, or Udofin RA2 on the RE's approval) | grantee type, basis code, scope, PII, export and query levels, valid_from, valid_to (≤ 90 days), approvals, state (Part 4.7) | UD, LDC, other FX tenants of the RE; OH (counts) |
| 44 | `group_grant` | OH | principal, role, entity_scope, tenant_scope, data_class_max, purpose, valid_from, valid_to (≤ 90 days), approvers (Part 4.6) | Product staff realms (SCIM) |
| 45 | `risk_metric_value`, `limit_breach`, `loss_event` | FX (UD for LSP metrics) | metric id and version, value, threshold version, RAG; limit_type (incl. PCA_RT1–PCA_RT3), status, pseudonymised counterparty ref; loss taxonomy and three dates | LDC, RE GRC |
| 46 | `agreement` *(v1.2, from LD App. Y)* | LD | business ref (`LD-AGR-…`), type, title, party_refs with roles, governing law, value (money), term, status (DRAFT, NEGOTIATION, APPROVED, EXECUTED, AMENDED, TERMINATED, EXPIRED), executed_at, formalities record (stamp, witnesses, registration, board approval), dispute clause (institution, seat, rules ref), document version refs (#28), stamp refs (#48) | LDC (projection under `legal_sor_link`), FX (when linked to a recovery case), EQ (only inside a referral pack) |
| 47 | `signing_request` *(v1.2, from LD App. Y)* | LD (hosting platform; ASP of record per route `asp_mode`) | document_id and sha256 (final, stamped), eligibility result and rule version, signers (pseudonymous refs, order, `signing_method`), ESP route, status, ESP transaction ids, evidence-pack ref, requesting product and link ref | Requesting product (status and evidence by reference) |
| 48 | `stamp_instrument` *(v1.2, from LD App. Y)* | LD (procurer or attacher) | State, article, consideration, duty (money), `stamp_channel`, certificate number/UIN, first party, purchase date, verification status and method, lock status, linked document sha256 | Requesting product; EQ (inside a referral pack) |
| 49 | `legal_matter` *(v1.2, from LD App. Y)* | The organisation's legal system of record: LD; LDC P26 only for organisations without an LD tenant (recorded in `legal_sor_link`) | business ref (`LD-MAT-…`), `legal_matter_type`, status, risk rating, claim amount and contingent-liability band (FINANCIAL), counsel refs (#42), linked agreements (#46), court cases (#50), ADR cases (#23), privileged flag | LDC (projection) |
| 50 | `court_case` *(v1.2, from LD App. Y)* | LD | business ref (`LD-CAS-…`), forum, court, State, case type, number, year, CNR, party role, stage, next date, `court_case_source`, as_of, linked `litigation_case` ref (#24) where the same proceeding is a recovery proceeding in RS; child records hearings and orders. Kept separate from #24 so that an RE tenant using both RS and LD has one owner per entity (principle 2): RS wins for recovery fields, LD shows its projection | LDC (projection) |
| 51 | `ip_asset` *(v1.2, from LD App. Y)* | LD | business ref (`LD-TMK-…`), `ip_asset_type`, office, application number, mark or title, classes, `ip_status`, filing, advertisement, registration and renewal dates, source, as_of | LDC (opt-in projection) |
| 52 | `engagement` *(v1.2, from LD App. Y)* | LD (operational); OH (order, invoice, payment) | business ref (`LD-ENG-…`), service id, `supplier_type`, professional ref (#42) or LawDocs, client org/tenant, SLA tier, status, dates; scope description and deliverables stay LD-internal (`CONFIDENTIAL`) | OH (commercial fields only) |
| 53 | `retainer` *(v1.2, from LD App. Y)* | LD (operational); OH (contract, invoices) | engagement refs, hour bank, SLA (eSigned document ref), term, renewal, delivery-grant refs | OH (commercial fields only) |
| 54 | `contract_obligation` *(v1.2, from LD App. Y)* | LD | agreement ref, obligation type (PAYMENT, DELIVERY, REPORTING, INSURANCE, NOTICE, RENEWAL, CONFIDENTIALITY, OTHER), owner position, due rule, next due date, status, evidence ref | LDC (projection) |
| 55 | `brand_pack` *(v1.2)* | The product whose Brand Studio publishes it (FX, UD, LD, LDC, EQ for their own hosts; OH for Infrabyx internal brands); OH holds the commercial record of a white-label brand | `brd_` id, product, hosts[], status, app_name, terminology_override, legal_entity, logo and favicon refs, tokens, email_identity, policy_set_id, consent_banner, store_identity, analytics adapters, published_revision_id (5.4) | OH (hosts, legal entity, display name, revision; for billing documents, CRM and DNS automation); DNS_CDN automation |
| 56 | `terminology_override` *(v1.2)* | Same as #55 (embedded in `brand_pack`) | flat key → string map (`vidhi`, `workspace`, `tenant`, product nouns); kernel identifiers never change (IPB-04-27) | None (read with the pack) |
| 57 | `vendor_assurance_document` *(v1.2)* | OH (OH14.6 Vendor Assurance Room) | `vad_` id, title, category (CERTIFICATE, AUDIT_REPORT, AFFIDAVIT, DPA, POLICY, STATEMENT, ACCESSIBILITY_STATEMENT, EXIT_RUNBOOK, BOM), cadence, valid_from, valid_until, storage_ref, sha256, visibility (PUBLIC, TENANT, GATED_NDA, AUDITOR), publication targets (products), state (6.34) | Every product (read-only mirror keyed by `vad_id` and sha256; Settings › Security & trust and Trust Centre) |
| 58 | `vidhi_delegation` *(v1.2)* | Source product's Vidhi kernel (request); target product's Vidhi kernel (its own task) | `dtask_` id, `msn_id`, from_product, to_product, task_type, requested_by (pairwise), consentref or legalbasis, autonomy_ceiling, due_at, inputs_ref, state (4.9), outputs_ref, reason | Both products' Vidhi ledgers |

**Amendments to existing entities in v1.2 (additive)** *(v1.2, from LD App. Y unless marked)*.

| # | Entity | Change |
|---|---|---|
| 20 | `notice` | Add LD as producer **for non-recovery instruments only**; add instrument codes `GENERAL_LEGAL_NOTICE`, `CONTRACT_NOTICE`, `REPLY_NOTICE`, `CONSUMER_NOTICE`. Recovery instruments (LRN, S13_2, S13_4, S138 by an RE, ARB_S21 for loans, etc.) remain RS only |
| 23 | `adr_case` | Owner "EQ docket; RS referral" becomes "EQ docket; RS or LD referral"; Copies add LD (party view) |
| 24 | `litigation_case` | Owner unchanged (RS). Copies add LD (read-only projection for the RE's own legal department under `finbyx_legal_link`) |
| 25 | `hearing`, `order` | Unchanged. LawDocs hearings and orders are child records of #50 |
| 28 | `document` | Add optional fields `origin` (`document_origin`), `vault_scope` (PERSONAL, COMPANY), `rendition_of` (source document id for derived renditions — OCR, type copy, translation), `evidence_pack_ref`, `privileged` (bool), `bsa63_certificate_ref`. This reconciles the proposed `vault_document`: no new entity; a vault document is a `document` with `vault_scope` set |
| 29 | `consent_artefact` | Capturer adds LD and every product's public-site CMP (IPB-04); `method` adds `IN_APP_AUTHORISATION` (OAuth consent screen), `CONSENT_MANAGER` (DPDP consent-manager artefact) and `CMP_BANNER` *(v1.2)*; purpose codes add `DOCUMENT_COPY_TO_PERSONAL_VAULT`, `ADR_REFERRAL_PACK`, `LEGAL_SOR_SYNC`, `SIGNING_HANDOFF`, `PARTNER_ONBOARDING_PREFILL`, and *(v1.2)* `MARKETING_EMAIL`, `MARKETING_SMS`, `MARKETING_WHATSAPP`, `ANALYTICS`, `VIDHI_DELEGATION`, `LEAD_CONTACT`, `CAREER_APPLICATION` |
| 38 | `plan`, `entitlement`, `invoice`, `subscription_payment` | Copies add LD, LDC, EQ; `plan` gains optional `brand_pack_id` for white-label price books *(v1.2)* |
| 39 | `usage_aggregate` | Producers add LD, LDC, EQ; meter codes may include AI meters (`AI_CREDITS`, `AI_TOKENS_IN`, `AI_TOKENS_OUT`) so that IPB-03's proposed `ai.UsageMetered` is carried by `UsageRecorded` *(v1.2)* |
| 40, 41 | `export_job`, `archive`, `storage_target` | LD as producing product; folder profiles in 12.5 |
| 42 | `professional`, `matter_allocation` | `professional` copies add LD (Rule 36 fields only, for directory display that is OFF by default). `matter_allocation` producers add LD for engagements of advocates by organisations through the LawDocs marketplace; optional `org_id` where the client has no `reid`; allocation basis adds `CLIENT_CHOICE` |
| 44 | `group_grant` | LD staff realm added as a consumer (SCIM); mandatory `product_scope[]` *(v1.2; 4.8)* |
| 36 (tenant map, 4.1) | `tenant` | Optional `brand_pack_id` and `whitelabel_link` ref on every tenant-map entry so that counterparts can resolve the brand under which a tenant is served *(v1.2)* |

## 5.3 Code tables

- **`collateral_type`:** RESIDENTIAL_PROPERTY, COMMERCIAL_PROPERTY, PLOT, UNDER_CONSTRUCTION_AGREEMENT, VEHICLE, EQUIPMENT, STOCK, BOOK_DEBTS, RECEIVABLE_INVOICE, TREDS_FACTORING_UNIT, GOLD_JEWELLERY, SILVER_JEWELLERY, GOLD_COIN, LISTED_SHARE_DEMAT, BOND_DEMAT, MF_UNIT_SOA, MF_UNIT_DEMAT, FIXED_DEPOSIT, INSURANCE_POLICY, PERSONAL_GUARANTEE, CORPORATE_GUARANTEE, CREDIT_GUARANTEE_CGTMSE. Barred collateral is blocked by rule pack (primary-gold-backed units, CF para 35(2); own shares, para 105).
- **`recovery_mechanism`:** NEGOTIATION_OTS, CONCILIATION, MEDIATION, ARBITRATION, LOK_ADALAT, PERMANENT_LOK_ADALAT, S138_NI, S25_PSS, SARFAESI_S13, SARFAESI_S14, PLEDGE_SALE, CONTRACTUAL_REPOSSESSION, CIVIL_SUIT, ORDER_XXXVII, COMMERCIAL_S12A_MEDIATION, DRT_OA, IBC_S7, IBC_PG_S95, IBC_CLAIM, REVENUE_RECOVERY, SET_OFF, CGTMSE_CLAIM, DLG_INVOCATION, LOAN_SALE_ARC, WRITE_OFF; litigation adds SARFAESI_S17, DRAT_APPEAL, S9_INTERIM, S11_APPOINTMENT, S34_CHALLENGE, S36_EXECUTION, CONSUMER_COMPLAINT, WRIT_226, RBIOS (offensive and defensive).
- **`legal_stage`** (LSP projection): NONE, PRE_LEGAL, NOTICE_ISSUED, ADR_IN_PROGRESS, SETTLEMENT_IN_PROGRESS, ENFORCEMENT_IN_PROGRESS, LITIGATION_PENDING, DECREE_OR_AWARD, CLOSED; the RE approves borrower wording per stage.

- **Code tables added in v1.2** *(v1.2, from LD App. Y unless marked)*: **`product`** *(v1.2)* — `FX`, `UD`, `EQ`, `LDC`, `LD`, `OH`, `RS` (standalone Udolex `UDX` reserved; `TenantProvisioned.product` and `module.yaml.product` take the long forms `FINBYX`, `UDOFIN`, `EQUATOR`, `LAWDOCSCOMPLY`, `LAWDOCS`, `OPERATIONS_HUB`); **`instrument_eligibility_result`** — ELIGIBLE_ESIGN, ELIGIBLE_DSC_ONLY, WET_INK_REQUIRED (IT Act First Schedule), REGISTRATION_REQUIRED (Registration Act s.17), NOTARISATION_REQUIRED; **`signing_method`** — AADHAAR_OTP_ESIGN, AADHAAR_BIO_ESIGN, ACCOUNT_ESIGN (eSign API 3.x), DSC, E_ACCEPTANCE_OTP (IT Act s.10A; not an electronic signature), WET_INK; **`stamp_channel`** — SHCIL, STATE_PORTAL, GRAS, FRANKING, PHYSICAL, NESL_DDE; **`stamp_verification_method`** — VENDOR_API, CRA_PUBLIC_CHECK_HUMAN, SUB_REGISTRAR_LOCK; **`legal_matter_type`** — ADVISORY, CONTRACT_DISPUTE, LITIGATION, NOTICE, REGULATORY, IP, EMPLOYMENT, PROPERTY, CONSUMER, FAMILY, CRIMINAL_COMPLAINT, OTHER; **`court_case_source`** — LICENSED_AGGREGATOR, USER_ENTERED, OFFICIAL_API_CLIENT_CREDENTIALS; **`ip_asset_type`** — TRADEMARK, PATENT, DESIGN, COPYRIGHT, GEOGRAPHICAL_INDICATION; **`ip_status`** — FILED, FORMALITIES_DEFECT, UNDER_EXAMINATION, OBJECTED, HEARING_SCHEDULED, ACCEPTED_ADVERTISED, OPPOSED, REGISTERED, RENEWAL_DUE, REFUSED, ABANDONED, WITHDRAWN, REMOVED; **`supplier_type`** — LAWDOCS, ADVOCATE, CHARTERED_ACCOUNTANT, COMPANY_SECRETARY, COST_ACCOUNTANT, TRADEMARK_AGENT, NON_REGULATED_PROVIDER, GOVERNMENT_FEE, STAMP_DUTY_PURE_AGENT; **`dispute_origin`** — LOAN (RS path only), CONTRACT, CONSUMER, EMPLOYMENT, PROPERTY, COMMERCIAL_OTHER, FAMILY_PROPERTY; **`document_origin`** — USER_UPLOAD, DIGILOCKER_URI, PRODUCED, SIGNED, RECEIVED_FROM_PRODUCT, DEPOSITED; **`vad_category`** *(v1.2)* — CERTIFICATE, AUDIT_REPORT, AFFIDAVIT, DPA, POLICY, STATEMENT, ACCESSIBILITY_STATEMENT, EXIT_RUNBOOK, BOM, PENTEST_SUMMARY, INSURANCE; **`vad_visibility`** *(v1.2)* — PUBLIC, TENANT, GATED_NDA, AUDITOR; **`feedback_category`** *(v1.2)* — BUG, IDEA, UX, ACCESSIBILITY, CONTENT, HELP_ARTICLE, SECURITY (routed to OH13, never public); **`lead_source`** *(v1.2)* — FORM, CHAT, PRICING, WEBINAR, RESOURCE_GATE, DEMO_REQUEST, PARTNER; **`marketing_purpose`** *(v1.2)* — MARKETING_EMAIL, MARKETING_SMS, MARKETING_WHATSAPP, ANALYTICS, PERSONALISATION; **`whatsapp_template_category`** *(v1.2)* — MARKETING, UTILITY, AUTHENTICATION; **`release_channel`** *(v1.2)* — IN_APP, EMAIL, PORTAL, STATUS_PAGE, RSS; **`delegation_reason`** *(v1.2)* — CONSENT_MISSING, LOCKED_ACTION, CEILING_EXCEEDED, NO_USER, FLAG_OFF, DATA_CLASS, EXPIRED, CANCELLED_BY_TARGET, APPROVAL_DECLINED.
- **Legal basis added in v1.2** *(v1.2, from LD App. Y)*: `CONTRACT_PERFORMANCE_CUSTOMER` — the billing identity of an individual customer buying from an Infrabyx company, sent only to OH8 billing subjects for quotes, orders, tax invoices, credit notes and refunds. **Permitted fields (closed list):** name, email, phone (mobile), GSTIN (optional), billing address and billing State (place of supply; address optional where the invoice rules allow), amounts and tax lines, SKU and quantity. Never vault, matter, case, document, consumer-case, respondent-institution, grievance-narrative or credential data. Consumer Help purchases use the same basis and list, invoiced by the Consumer Help selling entity with generic SKUs (for example `CH-LETTER-DRAFT`) that name neither the respondent institution nor the vertical; any other field is rejected with `dataclass-not-permitted` (principle 14). [OWNER] [TAX MEMO] [COUNSEL] — DPO sign-off before the first B2C invoice.

## 5.4 Shared `brand_pack`, `terminology_override` and the white-label tenant contract *(v1.2)*

IPB-D-10 makes `brand_pack` the one object that carries a brand across the group; IPB-04 §04.3.2 defines its editing (Brand Studio), host map, contrast guard, SVG sanitising and email-identity verification. This section fixes what travels **between** products and the commercial and regulatory rules of a white-label tenant. Resale of Udofin and Finbyx under a partner's brand is the first use; OH internal brands (LawDocs Trainings, Shikargah Hospitality) and the LawDocs multi-brand public app are the others.

**Shared shape (registry schema `tenancy/brand_pack/1.0.0`; fields beyond this list are product-internal and never published).**

```json
{"id": "brd_01J…", "product": "UD", "status": "PUBLISHED", "published_revision_id": "brv_01J…",
 "hosts": [{"host": "app.partnerbank.in", "role": "APP", "verified": true}, {"host": "www.partnerbank.in", "role": "PUBLIC", "verified": true}, {"host": "api.partnerbank.in", "role": "API", "verified": true}],
 "app_name": "PartnerBank Loans",
 "terminology_override": {"vidhi": "Sahayak", "workspace": "Branch"},
 "legal_entity": {"org_id": "org_01J…", "name": "…", "cin": "…", "gstin": "…", "registered_office": "…", "entity_type": "PRIVATE_LIMITED", "role": "LSP"},
 "operating_entity": {"legal_entity_id": "ent_01J…", "merchant_of_record": true},
 "tokens": {"colour": {"primary": "#4338CA", "accent": "#F59E0B", "surface": "#FFFFFF", "on_surface": "#111827"}, "font": {"sans": "Plus Jakarta Sans", "mono": "JetBrains Mono"}, "density": "comfortable", "radius": "md", "contrast_guard_passed": true},
 "logo": {"svg_media_ref": "…", "png_media_refs": {"32": "…", "64": "…", "192": "…", "512": "…"}, "dark_variant_media_ref": "…"}, "favicon_set_ref": "…", "og_default_media_ref": "…",
 "policy_set_id": "pol_01J…",
 "consent_config": {"region_default": "IN", "regions": ["IN"], "categories": ["necessary", "functional", "analytics", "marketing"], "style": "bottom_sheet", "cmp_notice_version": "2026-10"},
 "store_identity": {"ios_bundle_id": "…", "android_package": "…", "store_listing_name": "…", "developer_account_owner": "PARTNER"},
 "email_identity": {"from_name": "…", "from_address": "no-reply@partnerbank.in", "reply_to": "…", "dkim_selector": "…", "verified": true},
 "email_domain": "partnerbank.in",
 "regulatory": {"dla_ids": ["dla_01J…"], "reids": ["re_01J…"], "re_website_dla_listing_verified": true},
 "whitelabel_link_id": "wll_01J…", "created_by": "…", "approved_by": "…"}
```

| Field | Rule |
|---|---|
| `hosts[]` | Each host has one role (`APP`, `PUBLIC`, `API`, `SANDBOX_API`, `MAIL`); a host appears in exactly one pack group-wide (the OH host registry rejects duplicates across products); only verified hosts are published; unknown `Host` headers get the product default pack with `noindex` and never a tenant's pack (IPB-04-29); `api.[host]` follows IPB-10 §10.4.1 |
| `tokens` | Published only after the contrast guard passes (WCAG 2.2 SC 1.4.3, 1.4.11); tenants may override within the guard; fonts are self-hosted WOFF2 (IPB-04-25) |
| `logo`, `favicon_set_ref`, `og_default_media_ref` | Media **references** (`STORAGE_PORT` object keys plus sha256), never inline binaries; SVG sanitised at upload (IPB-04-21) |
| `app_name`, `terminology_override` | The application display name everywhere (title, manifest, email subject prefix, PDF headers, store listing, login) and the flat key → string map applied through `packages/i18n`; "Vidhi AI" appears as `terminology_override.vidhi` when set; kernel identifiers, event names, scopes and schema fields never change (IPB-04-27) |
| `legal_entity` | The organisation whose brand is shown; must exist in the organisation registry (4.1) with a role flag (`is_lsp`, `is_re`, `is_group_operator`, `is_service_provider`); for Udofin brands see the DLA rule below |
| `operating_entity` | The Infrabyx group company operating the product for this brand (OH `legal_entity_id`); `merchant_of_record` states whether that company or the partner invoices end-customers (below) |
| `policy_set_id`, `consent_config` | The IPB-05 policy set (privacy, terms, cookie, grievance, …) parameterised with the partner's particulars and reviewed by counsel; CMP categories and notice version; consent artefacts captured under the brand carry `brand_pack_id` and the notice version (entity 29) |
| `store_identity` | iOS bundle id, Android package, listing name and who owns the developer account; for Udofin brands the listing must be the one declared in the RE's DLA list [LAW: RBI Digital Lending Directions 2025 — the RE publishes its DLAs and LSPs on its website; the DLA named must match] |
| `email_identity`, `email_domain` | SPF, DKIM and DMARC verified through `NOTIFY_PORT` before publish (IPB-04-28); transactional and regulatory messages from a white-label tenant are sent under this identity, marketing only with `MarketingConsentUpdated` state `GRANTED` |
| `regulatory` | Udofin only: `dla_ids[]` (one per RE, CF para 18) and `reids[]`; publish is blocked until `re_website_dla_listing_verified` is true or the owner records a dated exception |

**White-label tenant provisioning contract** (Udofin and Finbyx resale; `whitelabel_link` in 4.1; events `WhiteLabelTenantProvisioned`, `WhiteLabelTenantExited`, `BrandPackPublished` in 6.35).

| Question | Rule |
|---|---|
| Who provisions | OH4 raises `TenantProvisioned` for the end-customer tenant as today (6.29); the owning product's Brand Studio publishes the pack; OH4 then emits `WhiteLabelTenantProvisioned` binding tenant, pack, hosts, legal entity and plan after maker-checker. A tenant is never served under a pack whose `whitelabel_link` is inactive |
| Merchant of record | Default: the **operating Infrabyx entity** (OH8 invoices the partner under the plan and the partner invoices its own end-customers outside Infrabyx systems). Alternative: the partner is merchant of record for end-customers on OH8 only under a signed reseller agreement and a Razorpay Route or sub-merchant arrangement operated by OH8; Infrabyx never pools partner money (principle 4 applies by analogy; OH8 is the billing engine of record, IPB-D-07). `operating_entity.merchant_of_record` records the choice; invoices carry the brand's `legal_entity` particulars only where that entity is the seller [TAX MEMO] |
| Data ownership | Tenant data belongs to the **tenant** (the RE, LSP, society or company), never to the reseller and never to Infrabyx; the reseller sees aggregates (6.27 `usage_aggregate_v1`) and support metadata only; a reseller `group_grant` into a tenant is impossible — reseller staff are tenant users of that tenant or nothing |
| DLA and RE ownership (Udofin) | A white-label Udofin brand is **still an LSP's Digital Lending App of the RE(s) it serves**: the RE remains responsible for the app, its disclosures, grievance redress and data practices; the LSP (the brand's `legal_entity` with `is_lsp`) is the RE's agent; each RE–brand pair has its own `dla_id` and `re_lsp_link`; the brand's privacy policy, KFS presentation, cooling-off, grievance officer and the "lending by [RE]" statement are the RE's; borrower data stays in the Udofin tenant under the named RE; money never passes through the brand's entity (principle 4). [LAW: RBI (Digital Lending) Directions 2025 — LSP and RE roles, DLA listing on the RE website, data and consent rules, RE liability for LSP conduct] [INTERP: re-branding does not create a new lender or a new LSP; it changes the display layer only] |
| Finbyx resale | A Finbyx white-label tenant stays the RE's tenant; the reseller is a service provider under the RE's outsourcing policy (OUT Ch III); the RE's Board-approved outsourcing disclosure names Infrabyx as the actual provider (OUT para 46); the brand never hides the processor from the RE or its regulator |
| Vidhi | `terminology_override.vidhi` renames the display only; autonomy ceilings, locked list, data-class routing and evals are unchanged (IPB-D-03) |
| Exit | On reseller or partner termination OH emits `WhiteLabelTenantExited` (6.35): hosts enter a 90-day redirect window to the product default host, the pack revision is frozen, the store identity transfers or is withdrawn per the agreement, end-customer tenants continue under the product default brand (data untouched) or are exported under 12.1 at the tenant's election; nothing is deleted; `whitelabel_link.valid_to` closes |

---

# 6 — EVENT AND API CATALOGUE v2

## 6.1 Reading the tables

**Tags:** **(E)** existing Finbyx Part 5.2 interface, unchanged; **(A)** one of the six Udofin Part 5.2 proposals, **adopted in v1.0 of this specification subject to approval by both the Finbyx and Udofin product owners** (until both approvals are recorded, send through the RE's agreed manual channel and log); **(N)** new canonical name fixed in v1.0 for the Finbyx v1.4 and Udofin v1.1 prompts; **(N+)** added by this specification; **(N11)** new canonical name adopted in v1.1 for the Finbyx v1.5, Udofin v1.2 and Operations Hub v1.0 prompts (the (A) approval rule applies until the Finbyx and Udofin owners approve v1.1); **(N11+)** API or field added by v1.1. **Signed** = regulated message (3.6); **API** = synchronous. Parties as Part 5.1 plus **AGY** agency or dialler, **FIA** field-investigation app, **CL** co-lender, **DSP** dispatch adapter, **CDA** court-data adapter, **OH** Operations Hub, **INS** insurer or registered insurance partner, **CIC** credit information company, **TR** securitisation trustee or SPE, **SOC** a non-RE lender's (society's) own system; an RE on another LMS takes the FX role, and FIA working for an appointed agent takes the AGY role in 6.7 (allocations, activity, PTP, visits, receipts). The idempotency key is the consumer's business unique constraint (besides `(source, id)`). **std** = delivery p95 ≤ 5 minutes (3.8). LSP consumers receive `.lsp` projections; scopes in 4.5. Events in 6.18–6.30 carry `productfamily = na` unless they concern one loan; every subscription to them is checked at registration against the routing rules of its section (for example 6.23 tenant-internal, 6.27 aggregates only to the Hub, 6.30 Udofin and insurer only).


**Tags added in v1.2** *(v1.2)*: **(N12)** new canonical name adopted in v1.2 for the LawDocs v1.1, LawDocsComply v1.3, Equator v3.2, Finbyx v1.6, Udofin v1.3 and Operations Hub v1.1 prompts; **(N12+)** API or field added by v1.2; **(IPB)** the event was proposed in an IPB "Proposed Ecosystem events" table and is registered here under its canonical name (the proposed name, where different, is in 6.17 and is never emitted). Until every affected owner records approval of v1.2 (Part 16.1), the (A) rule applies to (N12) events: send through the agreed manual channel and log. Tables for the v1.2 domains (6.34–6.40) carry two further columns — `data` field types and the `dataclass` / consent rule — because their consumers include public-site and marketing systems where the data-class ceiling is the main control.

## 6.2 Origination (`origination`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `ProductCatalogPublished` (E) | FX → UD, other LSPs | RE approves a product version | product_code, version, eligibility, pricing grid, charges, KFS template, cooling-off days, grievance contacts, DLA disclosures, LAS haircut-table version | FX | (product_code, version) | Before effective date; UD live after RE approval (CMP paras 15(2), 31) |
| `EligibilityCheck` (E) API `POST /v1/eligibility-checks` | UD → FX | Borrower asks for offers | minimum consented fields, consentref | FX (RE BRE, rule version) | Idempotency-Key | ≤ 3 s; timeout = "lender unavailable" |
| `ApplicationSubmitted` (E) | UD → FX | Borrower submits | applicants, KYC evidence refs (KYC para 13), OTP e-KYC declaration (para 25(8)), bureau and AA refs, documents, consents, household data (CF para 51) | UD; FX once submitted | lsp_application_ref | Ack ≤ 5 min |
| `ApplicationStatusChanged` (E) | FX → UD | State change | from, to, reason_code | FX | (application_id, seq) | std |
| `AdditionalInfoRequested` (E) | FX → UD | RE query | request_id, items, due date | FX | request_id | std |
| `DecisionMade` (E) signed | FX → UD | Sanction or rejection | decision, reason codes, rule version, offers | FX | (application_id, decision_version) | std |
| `KFSIssued` (E) signed | FX → UD | KFS generated | proposal_no, validity_expiry, APR, document hash | FX | (kfs_id, version) | Before acceptance |
| `SanctionLetterIssued` (E) signed | FX → UD | Sanction letter generated | sanction_id, terms, document hash | FX | (sanction_id, version) | std |
| `BorrowerAccepted` (E) | UD → FX | Acceptance within KFS validity | accepted_at, explanation acknowledgement | UD evidence | kfs_id | Rejected after validity |
| `ESignCompleted` (E) signed | UD → FX | ESP confirms | ESP txn id, certificate, signed hash; never a bare flag | UD evidence | (document_id, esp_txn_id) | std |
| `EStampCompleted` (E) signed | UD → FX | Stamp certificate issued | certificate_no, state, duty | UD evidence | (document_id, certificate_no) | std |
| `RiskSignalRaised` (A) | UD, FIA → FX | Fraud or EWS signal, any stage | type, score, evidence; signals, not determinations (FRM paras 15, 19–23) | Signal UD or FIA; decision FX | signal_id | ≤ 15 min pre-disbursal |
| `VerificationRequested` (N+) | FX → FIA, AGY | FI, PD, RCU, legal, technical or skip-trace task | type, address token, due, consentref or legalbasis | FX | task_id | std |
| `VerificationCompleted` (N+) | FIA, AGY → FX | Task done or failed | findings, geo, time, evidence hash, agent police verification (RBC para 94) | FIA | (task_id, attempt) | ≤ 15 min |

## 6.3 Servicing (`servicing`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `LoanDisbursed` (E) signed | FX → UD, CL | Bank confirms settlement | utr, amount, value date, beneficiary type, kind (INITIAL, TRANCHE, DRAWDOWN), cooling-off end | FX | (loan_id, utr) | std |
| `DisbursementFailed` (E) | FX → UD | Payout failed or returned | attempt, reason, next step | FX | (loan_id, attempt) | std |
| `DrawdownRequested` (N+) API `POST /v1/facilities/{loan_id}/drawdowns` | UD → FX (FAPI 2.0) | Borrower requests a drawdown | amount, acr, auth_time | FX decides; executes as `LoanDisbursed` | Idempotency-Key | Accept or reject ≤ 2 s |
| `CoolingOffExitRequested` (E) | UD → FX | Exit within cooling-off (CF para 11) | requested_at, evidence | UD request; FX payable | loan_id | std |
| `ScheduleIssued` (E) | FX → UD | Loan booked | schedule_version, instalments | FX | (loan_id, schedule_version) | std |
| `ScheduleChanged` (E) | FX → UD, CL | Reset, tranche, restructuring, moratorium end, settlement | schedule_version, reason, effective date | FX | (loan_id, schedule_version) | std |
| `DueReminderTrigger` (E) | FX → UD | Reminder due under RE policy | due date, amount, template_id | FX | (loan_id, due_date, seq) | Within contact window |
| `DPDChanged` (E) | FX → UD, CL, AGY | Day-end | dpd, as_of | FX | (loan_id, as_of) | By 06:00 IST |
| `AssetClassificationChanged` (E) | FX → UD, CL | Day-end, borrower-level (IRACP para 23) | from, to, as_of (borrower wording RE-approved) | FX | (loan_id, as_of) | By 06:00 IST |
| `LoanClosed` (E) | FX → UD, CL | Zero dues | closed_on, closure type | FX | loan_id | std |
| `NOCIssued` (E) | FX → UD | NOC generated | document hash, pending release actions | FX | loan_id | ≤ 1 working day [REC] |
| API `GET /v1/facilities/{loan_id}/summary` | UD → FX | Display | limit, utilised, DP, available, as_of | FX | n/a | p95 ≤ 800 ms |

## 6.4 Payments and mandates (`payments`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `MandateRegistered` (E) | UD → FX | Mandate confirmed | umrn, type, sponsor bank, limits, validity, beneficiary = RE | FX; UD evidence | umrn | std |
| `PaymentReceived` (E) | FX → UD, CL, EQ (under settlement) | Receipt allocated | utr, rail, amount, allocation by component and share, collected_by | FX | (loan_id, utr) | Same day; agent cash same day (CF para 10(5)) |
| `PaymentBounced` (E) | FX → UD, RS | Mandate, cheque or UPI return | instrument, return reason (feeds s.138 and s.25 PSS checks) | FX | (loan_id, instrument_ref, presentation_no) | ≤ 1 h of return file |
| `DailyReconciliationFile` (E) file | FX ↔ UD, CL | Day close | all flows with control totals | Each side | (producer, business_date) | By 06:00 IST |

## 6.5 Collateral (`collateral`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `CollateralHoldingsShared` (N+) | UD → FX | Holdings fetched with consent (CDSL LAS, NSDL, RTA or MF Central) | ISIN or scheme, units, source, as_of | Depository or RTA data; FX stores | (application_id, snapshot_id) | std |
| API `POST /v1/collateral/eligibility-quotes` | UD → FX | Indicative value | returns indicative eligible value and DP | FX | Idempotency-Key | ≤ 2 s |
| `CollateralPledgeRequested` (N) | FX → UD (or provider) | Sanction requires pledge or lien | securities, quantities, pledgee DP or RTA, agreement no, deadline | FX | pledge_request_id | std |
| `CollateralPledgeCreated` (N) signed | FX → UD, CL | Provider confirms encumbrance (NSDL, CDSL, RTA, sealed gold packet) | pledge_ref, units or weight, provider, evidence hash | FX; provider is external truth | (provider, pledge_ref) | std; disbursement gate |
| `CollateralPledgeFailed` (N+) | FX → UD | Rejection, OTP failure, expiry | reason, retry allowed | FX | (pledge_request_id, attempt) | std |
| `CollateralChargeRegistered` (N+) | FX → UD, CL | Mortgage, hypothecation, assignment or guarantee cover registered | charge type, registry (CERSAI, VAHAN, TREDS, CGTMSE), registry_ref | FX; registry external | (registry, registry_ref) | Per SARFAESI s.23 and CERSAI Rules [VERIFY: filing window] |
| `CollateralValuationUpdated` (N) | FX → UD, CL | Valuation run, revaluation, gold assay | value, price source and as_of, haircut version, DP, LTV, freeze flag | FX | (loan_id, valuation_run_id) | LAS daily by 09:30 IST [REC] |
| `MarginCallRaised` (N) signed | FX → UD | LTV above permitted level | LTV, shortfall, cure options, cure_deadline, basis | FX | margin_call_id | ≤ 15 min; borrower told same day |
| API `POST /v1/margin-calls/{id}/cure-intents` | UD → FX | Borrower chooses a cure | top-up, part payment or sell-to-cure | FX decides | Idempotency-Key | ≤ 2 s |
| `MarginCallCured` (N) | FX → UD | Shortfall cleared | method, cured_at, post-cure LTV | FX | margin_call_id | ≤ 15 min |
| `MarginCallLapsed` (N+) | FX → UD, RS | Deadline passed uncured | shortfall, next step, freeze status | FX | margin_call_id | At deadline |
| `CollateralInvoked` (N) signed | FX → UD, CL, RS | Pledge invoked, guarantee claimed, deposit set off | quantity, proceeds, notice ref | FX | (provider, invocation_ref) | std |
| `CollateralReleased` (N) signed | FX → UD, CL | Pledge closed, lien revoked, CERSAI satisfied, Vahan NOC, gold or documents returned | release type, registry_ref, delay days, compensation (RBC paras 39, 69) | FX | (collateral_id, release_ref) | Gold ≤ 7 working days (RBC para 58); documents ≤ 30 days (RBC para 35) |

## 6.6 Co-lending, transfers and consortium (`colending`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `CoLendingSplitConfirmed` (N) | CL partner → originator | Partner books its share | share_pct, booked_on | Each RE for its share | (cla_id, loan_id) | ≤ 15 calendar days of disbursement (TDCR paras 113, 115) |
| `CoLendingReceiptAllocated` (N+) | Escrow-managing RE → other CL | Escrow receipt appropriated | utr, allocation by component and share | Escrow-managing RE | (cla_id, utr) | Same day [REC]; escrow routing and appropriation per TDCR para 117 |
| `ClassificationSynced` (N) signed | Either CL → other | CLA exposure moves to SMA or NPA, or upgrades | borrower ref, class, as_of, dpd, reason | Classifying RE | (cla_id, borrower, as_of) | By 23:59 IST next working day (TDCR para 124) |
| `LoanTransferred` (N) | FX → transferee, UD (if servicing or mirroring), RS, EQ | Transfer effective | mode, transferee, share, servicer, payment instructions, notice ref (TPA s.131) | Transferor | (loan_id, transfer_id) | ≤ 1 working day |
| `ServicerChanged` (N) | FX → UD, CL, transferee | Servicer appointed or replaced (TDCR para 30; SEC para 70) | new servicer, date, borrower notice ref | Transferor or SPE | (loan_id, change_id) | Borrower told before effect [REC] |
| API `POST /v1/ica/{ica_id}/votes` | Lenders → ICA lead | ICA decision | resolution id, lender, value, vote | ICA lead | Idempotency-Key | Passes at 75% by value and 60% by number (RSA para 32) |

## 6.7 Collections (`collections`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `CollectionAllocated` (E) | FX → UD, AGY | Allocation under an active appointment | bucket, contact rules, agents, territory | FX | allocation_id | Receiver rejects without matching appointment |
| `CollectionDeallocated` (E) | FX → UD, AGY | Recall, cure, settlement, hold, appointment end | reason | FX | allocation_id | Contact stops immediately |
| `RecoveryAgentNoticeSent` (N+) | FX → UD, AGY | Agent particulars sent to borrower by email or SMS | agent details, delivery evidence | FX | (allocation_id, borrower) | Before first contact (CF para 9(6); RBC paras 95–96) |
| `CollectionActivityLogged` (E) | UD, AGY → FX | Call, message or visit attempt | channel, outcome, recording ref, policy check id | UD or AGY | attempt_id | ≤ 15 min |
| `PTPCaptured` (E) | UD, AGY → FX | Promise to pay | amount, date, evidence | UD or AGY | ptp_id | ≤ 15 min |
| `FieldVisitLogged` (E) | UD, AGY, FIA → FX | Field visit | geo, time, premises photo, outcome | Visiting system | visit_id | ≤ 15 min |
| `ReceiptIssued` (E) | UD, AGY → FX | Cash or instrument collected by appointed agent | receipt_no, amount, deposit ref into RE account | FX posting | receipt_no | Posted same day, no fee deducted (CF para 10(5)) |

## 6.8 Recovery (`recovery`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `RecoveryCaseOpened` (N) | RS → UD (projection), LDC | Rule trigger (DPD, NPA, bounce, fraud, death) or manual | trigger, permitted and blocked mechanisms, limitation dates, legal_stage | RS | recovery_case_id | ≤ 15 min |
| `RecoveryStrategyChanged` (N) | RS → UD (projection), AGY | Re-evaluation on a material event | mechanisms, rule version, approver, legal_stage | RS | (case_id, strategy_version) | ≤ 15 min |
| `LegalNoticeIssued` (N) signed | RS → DSP, UD (copy if permitted), EQ (ADR notices) | Notice approved and signed | instrument, statute ref, template version, addressees, dues, document hash, signer | RS | notice_id | Dispatch same day [REC] |
| `NoticeServiceUpdated` (N) | DSP, EQ, UD (own in-app, SMS-link or email delivery only) → RS; RS → UD (projection, if the RE permits) | Delivery event per party per mode | channel (dispatch mode, EQUATOR or UDOFIN_APP), status, evidence, deemed service date (never set from a UD channel event), deadlines | Provider event; RS register | (notice_id, party_id, mode, provider_event_id) | ≤ 1 h |
| `SettlementRequested` (A) API `POST /v1/recovery-cases/{id}/settlement-requests` | UD, borrower portal → RS | Borrower asks to settle | proposal, reason, documents | UD request; RS decision | request_id | Ack ≤ 1 working day [REC] |
| `SettlementApproved` (N) signed | RS → UD (projection), EQ | Approval at required level | terms, approver level (RSA para 16(5)), Board ref (fraud, WD), restructuring (para 89), consent decree (para 100), cooling end (para 95) | RS | (settlement_id, approval_version) | ≤ 15 min |
| `SettlementOfferIssued` (N) signed | RS → UD, EQ | Offer within approval or approved band | document, validity, RE-account payment instructions | RS | (settlement_id, offer_version) | ≤ 15 min |
| `SettlementOfferAccepted` (N+) | UD, EQ, portal → RS | Borrower accepts by eSign or OTP | acceptance evidence | Capturer evidence; RS record | (settlement_id, offer_version) | std |
| `SettlementBreached` (N) | RS → UD, EQ | Instalment unpaid beyond grace | breach details, consequence | RS | (settlement_id, breach_seq) | ≤ 1 working day |
| `AssetRepossessed` (N) | RS → UD (projection) | Repossession or SARFAESI possession | mode, date, possession memo or panchnama, inventory | RS | (collateral_id, repossession_id) | ≤ 1 h |
| `AuctionScheduled` (N) | RS → UD (projection), auction adapter | Sale notice published | platform, reserve, date, notice refs | RS | (asset_sale_id, attempt) | ≥ 30 days after sale notice (SARFAESI Rule 9(1)); gold RBC paras 60–66 |
| `AuctionConcluded` (N) | RS, auction adapter → UD (projection) | Auction closed | result, price, deposit and balance dates | RS | (asset_sale_id, attempt) | 25% by next working day; balance ≤ 15 days (Rule 9(3)–(4)) |
| `RecoveryReceiptPosted` (N) signed | RS (FX ledger) → UD, EQ, CL, DLG provider | Recovery receipt appropriated | source, amount, appropriation (s.13(7) for SARFAESI), shares | FX | (loan_id, receipt_ref) | Same day |
| `SurplusRefunded` (N+) | RS → UD | Surplus paid to borrower or persons entitled | amount, utr, days from receipt | RS | asset_sale_id | Gold ≤ 7 working days (RBC para 66) |
| `RecoveryCaseClosed` (N) | RS → UD, LDC | Case ends | closure reason | RS | recovery_case_id | ≤ 15 min |
| API `GET /v1/recovery-cases/{id}` | UD, EQ → RS | Display or referral | projection by scope | RS | n/a | p95 ≤ 800 ms |

## 6.9 ADR — Equator or another provider (`adr`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `ADRReferralCreated` (N) signed; API `POST /v1/adr/referrals` at EQ | RS → EQ, UD (projection), LDC | RE referral after Part 8.2 gates | process, basis, clause ref, stamp proof, claim, parties, pack hashes, sealed mandate ref | RS referral; EQ docket | referral_id | Sync ack; screening ≤ 2 business days |
| `ADRConsentRecorded` (N) signed | EQ (or RS) → RS, UD | Consent, decline or deemed decline | consent type, decision, method, evidence hash | Capturer | (adr_case_id, party_id, consent_type) | std |
| `ADRNeutralAppointed` (N) | EQ → RS, UD (name only) | Appointment accepted after disclosure | neutral, selection-log ref, Sixth Schedule disclosure, challenge end | EQ | (adr_case_id, appointment_seq) | ≤ 7 days [REC] |
| `ADRHearingScheduled` (N) | EQ → RS, UD | Hearing or session fixed | date, mode; party link via launch flow (4.4) | EQ | (adr_case_id, hearing_id) | ≥ 3 days before [REC] |
| `ADRCaseStatusChanged` (N) | EQ → RS, UD (projection) | Transition (Part 8.3) | from, to, reason, clocks, borrower_action_required | EQ | (adr_case_id, seq) | std |
| `ADROutcomeRecorded` (N) signed | EQ → RS, UD (summary) | Award or settlement signed and stamped; non-settlement; withdrawal | outcome type, terms, document hash, e-stamp, served_at, s.34 window | EQ instrument; RS loan effect | (adr_case_id, outcome_seq) | Stamp at signing; certified copy ≤ 2 business days [REC] |
| `ADROutcomeComplianceUpdated` (N) | RS → EQ, UD | Payment or breach against schedule | status, amounts | RS | (adr_case_id, compliance_seq) | ≤ 1 working day |
| API `PUT /v1/adr/cases/{id}/settlement-mandate` | RS → EQ | Set or change settlement band | floor, tenor, waiver limit, approver, expiry | RS | Idempotency-Key | Never visible to borrower or UD |
| API `POST /v1/adr/cases/{id}/withdrawal` | RS → EQ | RE withdraws | reason | RS | Idempotency-Key | ≤ 1 working day |


**Party-initiated referrals from LawDocs** *(v1.2, from LD App. Y)*.

| Change | Detail |
|---|---|
| `ADRReferralCreated` producer | Add LD for **non-loan disputes** where the LawDocs user (individual or organisation) is a party. LD can never refer an RE's loan dispute (`regulatory-guard`); 8.1 "only the RE refers" remains the rule for loan disputes |
| New optional fields (N12+) | `dispute_origin` (5.3), `referring_party_role` (CLAIMANT, RESPONDENT, JOINT), `referrer_product` (RS, LD) |
| New scope | `adr.referral:create.party` — issued only to LD (4.5); `adr.referral:create` unchanged (RE systems only) |
| LD gates before referral (logged) | Arbitration only with a clause naming an institution or written post-dispute consent (A&C Act s.7, s.7(4)(b)); no unilateral appointment (*Perkins Eastman v HSCC* (2020) 20 SCC 760; *CORE v ECI-SPIC-SMO-MCML (JV)*, SC, 8 Nov 2024); non-arbitrable categories blocked (matrimonial status, custody, testamentary validity, criminal matters, insolvency in rem; *Vidya Drolia* tests); a pending consumer complaint cannot be compelled to arbitration (*Emaar MGF v Aftab Singh*); IBC moratorium where known; commercial suits route through Commercial Courts Act s.12A pre-institution mediation (statutory authorities, not Equator) where the user intends to sue without urgent relief [LAW] |
| Consumers | Add LD (party view, projection subject `[EventName].party`) for `ADRCaseStatusChanged`, `ADRHearingScheduled`, `ADRNeutralAppointed` (name only), `ADROutcomeRecorded` (summary and document reference); LD never receives hearing content, selection logs, mandates or other parties' documents (4.4, 8.4) |
| Disclosure and neutrality | Every LD screen presenting Equator states "Equator Resolution is an Infrabyx group company" and shows other configured providers (8.1); in LawDocs, Equator is one ODR provider behind LawDocs' provider-neutral `ODR` port, never pre-selected, default or mandatory; the user (or both parties under the clause) chooses; provider ordering is neutral; a model clause naming Equator is offered only alongside clauses naming other institutions |
| eSign | Equator signs awards and settlement agreements through its own ESP route; where a LawDocs user executes a settlement in LawDocs it is a LawDocs-hosted ceremony in the user's own tenant and Equator receives evidence by document reference only (principle 15). The optional `lawdocs_esign` route on Equator's `ESIGN` port (EQ Appendix AC) is withdrawn |

## 6.10 Litigation (`litigation`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `LitigationCaseOpened` (N) | RS → LDC, UD (if permitted) | RE filing, or borrower-initiated proceeding received (s.17, consumer, writ, PLA) | role, mechanism, forum, CNR, claim, linked ids | RS | lit_case_id | ≤ 1 working day |
| `LitigationCaseUpdated` (N) | RS (from CDA and counsel) → LDC, UD (projection) | Stage, stay, substitution, counsel change | stage, stay, substitution, legal_stage | RS | (lit_case_id, seq) | ≤ 1 working day |
| `HearingScheduled` (N) | RS → counsel portal, LDC, UD (date only) | Next date or cause-list match | date, bench, item, purpose | RS | (lit_case_id, date, item) | Same day |
| `OrderRecorded` (N) signed | RS → LDC | Order or decree verified | order type, directions with due dates, document hash | RS | (lit_case_id, order_id) | ≤ 1 working day |
| `LitigationCaseClosed` (N) | RS → LDC, UD | Disposal, withdrawal, consent decree | outcome, amount, date | RS | lit_case_id | ≤ 1 working day |


**Consumer added in v1.2** *(v1.2, from LD App. Y)*: LD consumes `LitigationCaseOpened`, `LitigationCaseUpdated`, `HearingScheduled`, `OrderRecorded` and `LitigationCaseClosed` through a new projection subject `[EventName].legal`, delivered only to the RE's own LD tenant under `finbyx_legal_link` with scope `litigation.case:read.legal` and `legalbasis = LEGAL_CLAIM`. RS remains owner; LD shows a read-only projection; no producer or schema change.

## 6.11 DLG (`dlg`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `DLGArrangementRegistered` (E) | FX ↔ UD | Entered or renewed | form (CF para 23), fixed set, cap, tenor, auditor declaration (para 20(3)) | FX ledger; UD own records | (dlg_id, version) | Before reliance |
| `DLGInvocationRaised` (E) | FX → UD | RE invokes | loans, amount, overdue days | FX | invocation_id | Within 120 days overdue (CF para 27(1)) |
| `DLGInvocationSettled` (E) | FX ↔ UD | Cover appropriated | amount, method | FX | invocation_id | ≤ 1 working day |
| `DLGPortfolioCoverage` (E) | FX → UD | Month end | disbursed, cap, cover, invoked, remaining | FX | (dlg_set_id, month) | ≤ 3 working days |
| `DLGDisclosurePublished` (A) | UD → FX, LDC | Monthly disclosure published | month, URL, document hash | UD | (lsp_id, month) | ≤ 7 working days of month end (CF para 28) |
| `DLGRecoveryShared` (N+) | FX → UD | Post-invocation recovery shared per contract (CF para 25(3)); never credited to the loan (25(2)) | loan, receipt_ref, share | FX | (dlg_id, receipt_ref) | Per contract |

## 6.12 Grievance (`grievance`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `GrievanceRaised` (E) | UD, FX, EQ → grievance host | Complaint on any channel | channel, category, description, attachments | Host (FX, UD lender portal or LDC) | grievance_id | Ack same day |
| `GrievanceUpdated` (E) | Host → UD, FX | Status or response | status, response | Host | (grievance_id, seq) | RE clock (CF para 12; IO rules) |
| `GrievanceEscalated` (E) | Host → UD, FX | Escalation to IO, RB-IOS information, or ADR suggested | level, reason, ADR-suggested flag (only the RE refers) | Host | (grievance_id, level) | Per IO and RB-IOS rules |
| `OmbudsmanReferralRecorded` (N11) | UD (borrower-declared filing), FX or RE system (Ombudsman stages the RE reports) → grievance host, UD, LDC | Borrower declares a filing with the RBI Ombudsman (CMS or CRPC) or another external forum; RE reports later stages | external reference, forum (RBIOS_2026, COOP_OMBUDSMAN, REGISTRAR, CONSUMER_COMMISSION, OTHER), declared_at, stage (FILED, FACILITATION, CONCILIATION, ADVISORY, AWARD, CLOSED); the borrower files, never Udofin | Declarant; RE for stages | (grievance_id, forum, external_ref, stage) | std; Udofin shows the external route from the RE's final reply or the end of its 30-day period until 90 days after that period (RB-IOS 2026 cl.10(1)(f)–(g)) [VERIFY: day-count convention]; never shown to society members |
| `GrievanceReopened` (N11) | UD, FX borrower portal → grievance host | Borrower reopens within 30 days of closure with a reason [REC] | reason, reopened_at; same case id; the RE treats it as a fresh receipt | Host | (grievance_id, reopen_seq) | Ack same day |
| `GrievanceRated` (N11) | UD, FX borrower portal → grievance host; LDC (aggregates) | Borrower rates the resolution after closure | rating 1–5, optional text; never shown to the handling agent before closure; a low rating offers escalation, never a retention offer | Host | (grievance_id, rating_seq) | std |

## 6.13 Documents (`documents`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `DocumentShared` (N+) | Any → permitted consumer | Document made available | type, sha256, JWS, retention class, legal hold | Producer | (document_id, version) | std |
| API `GET /v1/documents/{id}` | Consumer → producer | Retrieve | signed India-hosted URL valid ≤ 15 min, sha256, JWS | Producer | n/a | p95 ≤ 800 ms |
| API `POST /v1/document-deposits` (N12+) *(v1.2, from LD App. Y)* | UD (or another approved app, on a delegated user token under `deposit_link`) → LD | Individual saves their own document to their Legal Vault | document_id at source, sha256, JWS, document type, consentref (purpose `DOCUMENT_COPY_TO_PERSONAL_VAULT`); LD fetches bytes from the source `GET /v1/documents/{id}`; `WELLNESS` documents are refused | LD (stored copy); source (original) | Idempotency-Key | Ack ≤ 2 s |
| `DocumentDeposited` (N12) *(v1.2, from LD App. Y)* | LD → depositor | Deposit verified and stored | deposit id, source document_id, sha256, status (STORED, REJECTED + reason); never LD folder or account data | LD | (source, document_id) | ≤ 5 min |

## 6.14 Consent and privacy (`privacy`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `ConsentRecorded` (N+) | Capturer → named recipients | Consent captured after the application (holdings, ADR sharing) | consent artefact (Part 5.2 row 29) | Capturer | consentref | std |
| `ConsentWithdrawn` (A) | Capturer → every recipient | Withdrawal | scope, withdrawn_at; processing stops except legal retention | Capturer | (consentref, withdrawn_at) | ≤ 1 h [REC] |
| `DataPrincipalRequest` (A) | Any ↔ any | Access, correction, erasure, grievance, nomination; status | type, party_ref, scope, status, due | Receiving fiduciary | (request_id, status) | Forward ≤ 1 working day [REC]; DPDP Rules timelines [VERIFY] |
| `LegalHoldChanged` (N+) | RS, FX → every holder | Hold applied or released | scope (party, loan, case), reason, start, end | RS or FX | (hold_id, version) | ≤ 1 h; deletion suspended |

## 6.15 Compliance and GRC (`grc`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `ObligationPublished` (N) | LDC (or FX embedded) → products | Obligation added, amended, repealed (change feed) | obligation_ref, change type, dates, applicability | LDC | (obligation_ref, version) | ≤ 1 working day |
| `ControlTestResultPublished` (N) | FX, UD, EQ, RS → LDC | Control test run | result, population, masked sample, evidence | Operating product | (control_id, run_id) | ≤ 1 h |
| `EvidenceSubmitted` (N) | Any → LDC | Evidence artefact | control, URIs, sha256, signer | Producer | evidence_id | ≤ 1 h |
| `ComplianceIssueRaised` (N) | Any → LDC, RE | Test failure, audit or RBI observation, breach | source, severity, owner, due | Raiser; LDC tracks | issue_id | ≤ 15 min (severity 1) |
| `ReturnStatusUpdated` (N) | FX → LDC | Return generated, validated, filed, acknowledged | return_code, period, status, ack ref | FX | (return_code, period, status) | Same day |
| `PolicyAttested` (N) | Any → LDC | User attests a policy version | policy, version, user ref | Attesting product | (policy_id, version, user) | ≤ 1 h |
| `SecurityIncidentNotified` (A) | Any service provider → RE system, LDC; OH13 (copy without personal data, for clock tracking) | Cyber or data incident detected | detected_at, class, affected data, status | Notifier | (incident_id, update_seq) | ≤ 2 h target; RE to RBI within 6 h of provider detection (OUT para 61); data breach notified immediately by the RE (OUT para 28) |
| `PolicyEffective` (N12) (IPB) *(v1.2)* | Any product's CMS (IPB-05 policy instance) → LDC (compliance calendar; `LDC_GROUP` for Infrabyx's own policies), OH3 (re-consent tracking for business contacts) | A legal page or policy version becomes effective | policy_key, version, effective_at, reconsent_required (bool), notice_url, brand_pack_id, product; `dataclass = PUBLIC` | Publishing product | (product, brand_pack_id, policy_key, version) | ≤ 1 h |
| `VulnerabilityRecorded` (N12) (IPB) *(v1.2)* | Any product (IPB-02 vulnerability management) → LDC GRC register (`LDC_GROUP`), OH13 risk register | A vulnerability is triaged (never the raw finding) | vuln_id, product, severity (CRITICAL, HIGH, MEDIUM, LOW), cvss, source (SCA, SAST, DAST, PENTEST, DISCLOSURE), affected_component (generic), sla_due_at, status (OPEN, MITIGATED, FIXED, ACCEPTED), fix_release?; `dataclass = INTERNAL`; no hostnames, paths, exploit detail or tenant ids | Recording product | (vuln_id, status) | ≤ 1 h |

- **Mapping of IPB-02 proposals** *(v1.2)*: `security.IncidentOpened` is carried by the existing `SecurityIncidentNotified` (same row, OH13 copy without personal data); `security.EvidenceCollected` by `ControlEvidenceCollected` (6.29); `policy.AcceptanceRecorded` (IPB-05) by `PolicyAttested`. None of the proposed names is emitted (6.17).

## 6.16 Platform and module lifecycle (`platform`)

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `ModuleAttached` (N) | Product entitlement service (FX, UD) → product services, LDC, OH8 | Module enabled for a tenant on a signed `EntitlementChanged` (6.27) | version, capabilities, SKU, entitlement_id and version, approvers | Product entitlement service (module state as applied); OH8 is the source of truth for issued entitlements | (tenantid, module_id, version) | On publication |
| `ModuleDetached` (N) | Product entitlement service (FX, UD) → product services, LDC, counterparties, OH8 | Module detached to read-only | mode READ_ONLY, export-pack hash, records on hold, entitlement_id and version | Product entitlement service; OH8 source of truth | (tenantid, module_id, detached_at) | Writes stop at once; export ≤ 5 working days [REC] |
| `ConnectorCertified` (N) | Certification service → LDC, counterparties, OH13 (status) | Suite passed or certification revoked | suite version, result, report hash, valid_to | Certification service | (connector_id, version, suite_version) | Before production |
| `ReconciliationBreakRaised` (N+) | Any → owner, counterpart, LDC | Reconciliation or ordering break | run, break type, records, amount, owner | Detector | (recon_run_id, break_id) | ≤ 15 min |
| `ProviderIncident` (N12) (IPB) *(v1.2)* | Any product (adapter failover, AI gateway `BLOCKED`, PA or ESP outage) → OH13 (status page, vendor risk register), every product using the same adapter (advisory), LDC `LDC_GROUP` (outsourcing concentration risk) | Circuit breaker opens for ≥ 5 minutes, a provider is set `BLOCKED`, or a kill switch is pulled for a vendor | incident_id, product, port, adapter, residency, severity, started_at, status (OPEN, DEGRADED, RECOVERED), eta?, affected_capabilities[]; `dataclass = INTERNAL`; never tenant ids. Carries both IPB-01's `platform.ProviderIncident` and IPB-03's `ai.ProviderIncident` proposals | Detecting product | (incident_id, status) | ≤ 15 min; OH relays to affected REs under 3.8 (≤ 2 h) [OUT para 61] |
| `ExitDrillCompleted` (N12) (IPB) *(v1.2)* | Any product → OH14.6 (Vendor Assurance Room; evidence for `EXIT_RUNBOOK`), LDC `LDC_GROUP` | An exit or portability drill completes (IPB-01 §01.4.13) | drill_id, product, ports[], from_adapter, to_adapter, measured_rto_hours, target_rto_hours, result (PASS, FAIL), evidence_ref (sha256), performed_at; `dataclass = INTERNAL` | Product | drill_id | ≤ 1 working day |

## 6.17 Superseded names

Non-canonical names from pre-v1.0 working papers, the Equator draft and the owner's LAS proposal (`las.txt`) are never published; they map to the names above (for example CollateralPledgeConfirmed → `CollateralPledgeCreated`, MarginCallIssued → `MarginCallRaised`, MarginCallExpired → `MarginCallLapsed`, CoLendingClassificationChanged → `ClassificationSynced`, LegalStageChanged → `legal_stage` in LSP projections, EquatorCaseOpened → `ADRReferralCreated`, EquatorOutcome → `ADROutcomeRecorded`; Equator native names per Part 8.9).

**v1.1 additions.** Billing `PaymentReceived` and `PaymentFailed` (and any `in.infrabyx.billing.Payment*` type) → `SubscriptionPaymentReceived` and `SubscriptionPaymentFailed` (6.27); dotted risk names `risk.metric.computed` → `RiskSnapshotPublished` (capital runs: `CapitalRatioComputed`), `capital.crar.computed` → `CapitalRatioComputed`, `risk.limit.breached`, `risk.limit.cleared`, `alm.tolerance.breached`, `alm.lcr.below_min`, `concentration.breached` and `capital.pca.crossed` → `LimitBreached` (`limit_type`; `status` OPEN or CURED), `oprisk.loss_event.recorded` → `LossEventRecorded`, `stress.run.completed` → `StressTestCompleted`, `control.test.result` → `ControlTestResultPublished`, `supervisor_access.granted`, `.viewed`, `.exported` and `.revoked` → `ExternalAccessGranted`, `ExternalAccessUsed`, `ExternalAccessRevoked`, `kri.definition.published` → KRI resource pull (6.22); `EmployeeProvisioned` → `EmployeeOnboarded` plus `MailboxProvisioned`; entities `return_catalogue_entry` → `return_definition` and `return_version`, `return_submission` → `return_run` and `return_acknowledgement`, `cic_submission`, `cic_rejection`, `cic_dqi_review` and other `cic_*` → `bureau_cycle`, `bureau_file`, `bureau_rejection`, `dqi_review_report`; field `lendertype` with `NON_RE_COOP` → `lender_type` with `NON_RE_SOCIETY`; `mode` values `pilot`, `general` → `PILOT`, `GENERAL`; risk-feed extensions `as_of`, `metric_version`, `prev_hash` → `asof`, `metricversion`, `prevhash`; `meter_class` → `meter_kind`; Udofin's internal tenant class `lender_class = NON_RE_COOP` never appears in an event (events carry `lender_type = NON_RE_SOCIETY`); allocation basis `RECORDED_EXCEPTION` → `REASONED_EXCEPTION`; OH `source` spellings `[legal-entity-id]` and `[legal_entity_id]` → `urn:infrabyx:oh:[legalentityid]`. APIs: `GET /v1/catalogue/{version}` → `GET /v1/catalogue/versions/{v}`; `POST /v1/billing/checkout-sessions` → `POST /v1/billing/orders`; `GET /v1/billing/invoices?org_id=` → `?tenantid=`; `GET /v1/professionals` → `GET /v1/directory/professionals`; `GET /v1/professionals/{id}/conflicts` → `POST /v1/conflicts/check`.


**v1.2 additions** *(v1.2)*. IPB proposals and LawDocs drafts map to canonical names as follows; the left-hand names are never emitted and the event-catalogue lint (IPB-10-41) rejects them.

| Name used elsewhere | Canonical in v1.2 |
|---|---|
| `in.infrabyx.trust.AssuranceDocumentPublished.v1` (IPB-08), `in.infrabyx.trust.RoomDocumentPublished.v1` (IPB-04), `in.infrabyx.trust.AccessibilityStatementPublished.v1` (IPB-06) | `trust.VendorAssuranceDocumentPublished` (6.34; accessibility statements are `category = ACCESSIBILITY_STATEMENT`) |
| `in.infrabyx.feedback.ItemCreated.v1` (IPB-04), `in.infrabyx.ops.FeedbackItemCreated.v1` (IPB-07), `in.infrabyx.ops.AccessibilityIssueOpened.v1` (IPB-06) | `feedback.FeedbackSubmitted` (6.40; accessibility issues are `category = ACCESSIBILITY` with SLA metadata) |
| `in.infrabyx.feedback.ItemStatusChanged.v1` (IPB-04) | `feedback.FeedbackStatusChanged` (6.40) |
| `in.infrabyx.crm.LeadCreated.v1` (IPB-04) | `crm.LeadCaptured` (6.39) |
| `in.infrabyx.consent.Recorded.v1` (IPB-04) | `privacy.ConsentRecorded` for product consents (6.14); `consent.MarketingConsentUpdated` for marketing and analytics purposes (6.39) |
| `in.infrabyx.hr.ApplicationReceived.v1` (IPB-04) | `workforce.CareerApplicationReceived` (6.39) |
| `in.infrabyx.vidhi.DelegationRequested.v1` (IPB-03) | `vidhi.VidhiTaskDelegated` (6.36) |
| `in.infrabyx.ai.UsageMetered.v1` (IPB-03) | `billing.UsageRecorded` with AI meter codes (6.27) |
| `in.infrabyx.ai.ProviderIncident.v1` (IPB-03), `in.infrabyx.platform.ProviderIncident.v1` (IPB-01) | `platform.ProviderIncident` (6.16) |
| `in.infrabyx.platform.ExitDrillCompleted.v1` (IPB-01) | `platform.ExitDrillCompleted` (6.16) |
| `in.infrabyx.security.IncidentOpened.v1` (IPB-02) | `grc.SecurityIncidentNotified` (6.15) |
| `in.infrabyx.security.EvidenceCollected.v1` (IPB-02) | `ops.ControlEvidenceCollected` (6.29) |
| `in.infrabyx.security.VulnerabilityRecorded.v1` (IPB-02) | `grc.VulnerabilityRecorded` (6.15) |
| `in.infrabyx.policy.Effective.v1` (IPB-04, IPB-05) | `grc.PolicyEffective` (6.15) |
| `in.infrabyx.policy.AcceptanceRecorded.v1` (IPB-05) | `grc.PolicyAttested` (6.15) |
| `in.infrabyx.release.ReleasePublished.v1` (IPB-07) | `ops.ReleasePublished` (deployment fact, 6.29) for What's new regeneration; `eng.ReleaseNotePublished` (communication artefact, 6.37) for cards and changelog |
| `in.infrabyx.identity.AccessibilityPreferencesSynced.v1` (IPB-06) | `identity.UserPreferencesSynced` with `preference_set = a11y` (6.40) |
| `in.infrabyx.identity.UserDeactivated.v1` (IPB-01 example) | `identity.UserDeactivated` (6.40) |
| `in.infrabyx.billing.CatalogueChanged.v1` (IPB-04) | registered unchanged (6.27) |
| `in.infrabyx.compliance.ServiceOrderStatusChanged`, `in.infrabyx.services.ServiceOrderRouted` (LawDocs P14, P16 drafts) | `ops.ServiceOrderStatusChanged`, `ops.ServiceOrderRouted` (6.29) |
| Internal `in.lawdocs.web.ContentPublished` (LawDocs App. X draft) | `ops.ContentPublished` (6.29) |
| "LawDocs eSign (group)" as an `ESignProvider` adapter (OH v1.0; LDC P18 FR-P18-40); `lawdocs_esign` on Equator `ESIGN_PORT` (EQ App. AC) | Hosted signing hand-off: `POST /v1/signing-requests` under `signing_handoff_link`; `SigningRequestCompleted` (6.32); the Equator route is withdrawn |
| `vault_document` (draft entity) | `document` (#28) with `vault_scope` and `origin` |
| LawDocs-internal `in.lawdocs.*` names | Mapped in LawDocs Appendix I §I.8; never published to the ecosystem |
| LDC P26 `lit.matters` for organisations with an LD tenant | Projection of `legal_matter` (#49) and `court_case` (#50) |
| "Equator as default ADR route" (any draft) | Equator is one provider behind `ODR`; never default or mandatory (6.9) |

## 6.18 Regulatory returns (`reporting`)

Finbyx Part 7B (RR1–RR5, RR8). **Prepare, validate, reconcile, package and evidence; an authorised RE user files** (Part 2 principle 11). `ReturnStatusUpdated` (6.15) continues on every transition for GRC tools; the lifecycle events below carry the richer payloads. Return packages are `CONFIDENTIAL` and travel by document reference (6.13), never inside events. All events: `productfamily = na`, `legalbasis = STATUTORY_REPORTING` where any field could identify a person (DNBS08, DNBS09, FMR, LEF lines).

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `ReturnDue` (N11) | FX → LDC or embedded M14; OH (metadata, tenant opt-in) | Due instance reaches T−7, T−3, T−1 or breach; event-driven instances (FMR + 14 days, FUA immediate, cyber + 6 hours, CKYCR + 10 days, CERSAI + 30 days, DNBS10 and audited returns + 5 working days of the audit report) | instance_id, regulator, portal, return_code, legal_entity, period, due_at, alert_stage, basis citation (e.g. SR para 21 item n) | FX | (instance_id, alert_stage) | At each alert stage |
| `ReturnGenerated` (N11) | FX → LDC | Template filled from a frozen snapshot | instance_id, run_no, template hash and version, cell-map version, snapshot hash, file hash | FX | (instance_id, run_no) | std |
| `ReturnValidated` (N11) | FX → LDC | Validation and trial-balance reconciliation passed (RR3.3, RR3.4) | rule-pack version, warnings accepted count, reconciliation hash, explained-variance count | FX | (instance_id, run_no) | std |
| `ReturnApproved` (N11) signed | FX → LDC | Signatory signs off (SIGNED_OFF); SoD check passed (GOV para 21(3)–(4); CMP para 27) | maker, checker and signatory roles, SoD check ref, package manifest hash (`return_package_v1`), JWS | FX | (instance_id, run_no) | std |
| `ReturnFiled` (N11) signed | FX → LDC; OH (metadata, tenant opt-in) | Authorised RE user uploaded on the portal and the acknowledgement is recorded (ACKNOWLEDGED) | portal, ack reference, filed_at, filer alias (never a credential), ack document ref and hash, contingency flag (SR para 18) | FX record; RE user files | (instance_id, run_no) | Same day as acknowledgement |
| `ReturnRevised` (N11) | FX → LDC | Revised run n+1 acknowledged | prior run_no, reason (RBI_QUERY, INTERNAL_ERROR, AUDIT_ADJUSTMENT, LATE_POSTING, FORMAT_CHANGE), trigger ref, cell-level diff hash | FX | (instance_id, run_no) | Same day |
| API `GET /v1/return-instances/{id}` (N11+) | LDC, external workspace (4.7) → FX | Display and evidence | state (RR3.1), versions, hashes, approvals, acknowledgement; package by document reference | FX | n/a | p95 ≤ 800 ms |

- **No credentials, no scripting:** no regulator-portal user id, password, OTP, DSC PIN, cookie or token is stored, proxied or carried in any payload, vault or connector; no RPA or scraping. A connector configured for a regulator domain fails certification (`regulatory-guard`, 14.3).
- **Machine channels only where documented for the entity class:** CIMS ADF or system-to-system collection is documented for banks and is not assumed for NBFCs or UCBs; the adapter returns `channel-not-confirmed` until RBI's written confirmation is attached and a second approver enables it [VERIFY: Sankalan documentation]. E-mail filing only as an RBI-advised contingency followed by online resubmission (SR para 18).
- **Instruments:** NBFC – Supervisory Returns Directions, 2026 (RBI/DoS/2026-27/466, 31 July 2026; it replaces the 28 November 2025 text cited in earlier prompt versions); HFC returns go to NHB [VERIFY]; Registrar returns of credit co-operative societies use the same events with `regulator = REGISTRAR`.
- **Never a filer:** Udofin or any LSP. The RE reports DLAs on CIMS and DLA loans to CICs (CF paras 17, 18); Udofin supplies DLA facts through the `re_audit_pack_v1` P1 pack (6.28).

## 6.19 Credit bureau (`bureau`)

Finbyx Part 7B RR6–RR7. Reporting to all four CICs needs no borrower consent (CIR para 11); cross-product events carry counts and pseudonymous references only, and bureau files go only to the CIC under `legalbasis = STATUTORY_REPORTING`. Cadence from 1 July 2026: incremental files for the 9th, 16th and 23rd within 4 calendar days; month-end full file by the 5th; rejected data rectified before or with the next reference-date file (CIR paras 10(2) and 15 as substituted by the RBI (NBFC – Credit Information Reporting) Amendment Directions 2025, RBI/DOR/2025-26/117, DoR.FIN.REC.No.324/20.16.056/2025-26, 4 December 2025). CIC side: uniform validation rules and rejection reasons, file-level DQI and rejection reports within 3 calendar days of receipt (RBI (Credit Information Companies) Amendment Directions 2025, RBI/DOR/2025-26/119, DoR.FIN.REC.No.326/20.16.056/2025-26, paras 19, 20 and 39).

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `BureauFileGenerated` (N11) | FX → LDC | File built, validated and approved by the CIC nodal officer | cic (CIBIL, CRIF, EXPERIAN, EQUIFAX), layout (`bureau_consumer_v374`, `bureau_commercial_v310`, `bureau_mfi_v331`), cycle (DL, W1, W2, W3, ME, DC, AH, RR), reference date, counts by segment, status and DPD bucket, held-back count, file hash | FX | (cic, layout, cycle, reference_date, file_seq) | Before the due date |
| `BureauFileSubmitted` (N11) signed | FX → LDC | SFTP transmission acknowledged by the CIC server | transmitted_at, transmitting host attestation (tenant-controlled host or agent), server acknowledgement, file hash, encryption mode | FX | (cic, file_hash) | std; late transmission raises `ComplianceIssueRaised` |
| `BureauRejectionReceived` (N11) | FX (CIC adapter) → LDC | Rejection report or DQI ingested (CICs return both within 3 days) | rejected count by uniform reason code, DQI score, resubmission due date (with or before the next reference-date file) | CIC data; FX register | (cic, cycle, reference_date, report_seq) | ≤ 1 h of ingestion |
| `BureauCorrectionRequested` (N11) | FX (RR7.4 dispute, CIC request or data-quality finding) → FX bureau operations, LDC; a borrower dispute received by Udofin arrives first as `GrievanceRaised` (category CREDIT_INFORMATION) | Correction needed for an account | correction_id, cic list, account party_ref, source (BORROWER_DISPUTE, CIC_REQUEST, INTERNAL_DQ), received_at, clocks (CIR paras 34–35: 21 and 30 days) | FX | correction_id | std |
| `BureauCorrectionCompleted` (N11) | FX → LDC; UD (status only, when the dispute came through Udofin) | Every affected CIC confirms the correction (DC cycle or online maintenance) | cics updated, completed_at, compensation due flag and amount (CIR para 35), evidence hash | FX | correction_id | ≤ 1 working day of the last confirmation |

- Microfinance loans go only in the MFI file, never also in the consumer file; non-individual borrowers and guarantors go in the commercial file; co-lenders report their own shares (TDCR para 122); LSPs never report (CF para 17).
- A credit co-operative society reports only if a CIC admits it as a member [VERIFY]; no tenant ever uses another lender's membership or bureau access.
- SFTP and PGP keys live in the tenant vault (BYOK; unreadable by Infrabyx staff); transmission from a tenant-controlled host or the on-premises agent (12.2). Correction uploads follow each CIC's encryption rule [VERIFY: per CIC].
- Format packs are data, never code; specification inconsistencies are resolved in writing with the bureau, never coded around.

## 6.20 Finance and tax (`finance`)

Finbyx Part 7C. Amounts and statements travel by document reference (6.13); events carry hashes and status. The Operations Hub never receives `InterestCertificateIssued`, any amount or any trial-balance hash; with tenant opt-in it receives a `PeriodClosed` status projection only (`PeriodClosed.oh`: legal_entity, period, book, lock_version, status).

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `PeriodClosed` (N11) | FX → FX Part 7B (internal), LDC; OH (status projection, tenant opt-in) | Period locked per book, or re-locked after an approved reopen | legal_entity, period, book (STAT, PRUD, TAX), `lock_version` (a higher version supersedes the earlier lock), trial-balance hashes (never in the OH projection) | FX | (legal_entity, period, book, lock_version) | std |
| `FinancialStatementsApproved` (N11) signed | FX → FX Part 7B, LDC | Board approval with the auditor's report date recorded | legal_entity, financial year, framework (IND_AS, AS, COOP, IFRS_IFSC), Board date, audit report date, statement hashes (PDF/A, XLSX, MCA payload) | FX | (legal_entity, financial_year, version) | std; starts the DNBS10 and audited-return clocks |
| `GstReturnPrepared` (N11) | FX → LDC | GST package approved | gstin, period, return type (GSTR-1, GSTR-1A, GSTR-3B, GSTR-9, GSTR-9C), package hash (`gst_export_v1`), reconciliation status | FX | (gstin, period, return_type, version) | Before the return due date |
| `TdsStatementPrepared` (N11) | FX → LDC | Form 140 (or 144, 143; Form 138 for salary from Finbyx GV6 payroll) data file approved (Income-tax Act 2025 s.397(3)(b)) | tan, quarter, form, file hash (`tds_export_v1`), deductee count, validation utility version [VERIFY: utility name] | FX | (tan, quarter, form, version) | Before 31 Jul, 31 Oct, 31 Jan or 31 May |
| `InterestCertificateIssued` (N11) signed | FX → UD | RE-signed borrower certificate generated | loan ref, tax year, certificate type (interest and principal for the borrower's s.22, s.123 or s.129 claims [VERIFY]), document ref and hash; `legalbasis = CONTRACT_PERFORMANCE_RE` | FX | (loan_id, tax_year, version) | std |

- Filing is always by an authorised user on the GST, TRACES or income-tax portal (principle 11). Obligations for FY 2025-26 and earlier use the Income-tax Act 1961 forms; tax year 2026-27 onwards uses the Income-tax Act 2025 (in force 1 April 2026), selected by payment or credit date [VERIFY: CBDT transition guidance].
- **Udofin displays RE-signed certificates and never issues tax certificates in its own name** (Udofin UB2).
- Tally Prime and ERP sinks remain `AccountingSink` (10.2); Finbyx stays the book of record.

## 6.21 Audit and external access (`audit`)

Finbyx Part 7D; Udofin Part 7H RA2 and RA4; Part 4.7 for grant rules. Audit findings carry masked sample references only; workpapers stay in the producing product.

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `AuditEngagementOpened` (N11) | FX, UD → LDC, tenant GRC | Engagement approved | engagement_id, type (INTERNAL, RBIA, CONCURRENT, IS, IT, STATUTORY, SECRETARIAL, TAX, VAPT), period, scope summary, lead auditor role, workpaper index ref (`audit_workpaper_index_v1`) | FX or UD | engagement_id | std |
| `AuditFindingRaised` (N11) | FX, UD → LDC, tenant GRC | Finding issued after the auditor's sign-off | finding_id, engagement_id, rating, criteria citation, owner role, due date, masked sample refs | Auditor; data in FX or UD | (finding_id, version) | ≤ 1 working day |
| `AuditFindingClosed` (N11) | FX, UD → LDC, tenant GRC | Closure validated by the auditor (ATR) | closure evidence hashes, validator role, closed_at | Auditor | finding_id | ≤ 1 working day |
| `ExternalAccessGranted` (N11) signed | FX, UD, LDC → RE register (FX AU7 or RE GRC), LDC, RE SIEM; OH (counts). OH14 (`oh` scope, `PROVIDER_ASSURANCE` grants only) → requesting RE's register, OH14 evidence | Grant PROVISIONED (4.7) | grant_id, grantee type, basis code, scope summary, PII, export and query levels, valid_to, pseudonymous user refs | Granting RE | grant_id | ≤ 15 min |
| `ExternalAccessUsed` (N11) | FX, UD, LDC, OH14 → same | Daily aggregate per grant (per session as well in Udofin) | views, queries, rows viewed, exports (count, bytes, hashes), unmask events, alerts | Product | (grant_id, date, session_id) | By 09:00 IST next day |
| `ExternalAccessRevoked` (N11) signed | FX, UD, LDC, OH14 → same | Expiry, RE revocation or security event | reason (EXPIRY, RE_REVOCATION, SECURITY_EVENT), sessions_terminated_at | Granting RE (OH entity for provider assurance) | grant_id | Sessions end ≤ 60 s; event ≤ 15 min |
| API `POST /v1/external-access/grants` (N11+) | RE system (FX AU7) or UD lender portal on RE approval → UD, LDC, other FX tenant of the same RE | Federated grant | grant record (4.7) with RE approval refs | RE | Idempotency-Key | Provisioned ≤ 1 working day [REC]; RBI requests same day [REC] |
| API `DELETE /v1/external-access/grants/{id}` (N11+) | Granting RE → each provisioned product | Revocation | reason | RE | Idempotency-Key | Sessions end ≤ 60 s |

## 6.22 Risk and capital (`risk`)

Finbyx Part 7E (RK2.4 LawDocsComply risk feed, RK3, RK4, RK5, RK7); Udofin Part 7H RA1 (LSP metrics only; Udofin never computes or shows RE prudential ratios). **Finbyx computes facts and metrics; LawDocsComply runs register, RCSA and appetite logic** when the tenant's compliance mode is LDC_EXTERNAL or LDC_GROUP (9.1; Finbyx RK2.1). Only aggregates and pseudonymised references leave the producing product.

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `KriBreached` (N11) | FX, UD → LDC, RE GRC (Udofin: RE-scoped KRIs only) | KRI observation turns red; cure updates the episode | kri_id, metric id and version, value, threshold version, RAG, episode_id, status (OPEN or CURED) | Producer | (kri_id, episode_id, update_seq) | ≤ 15 min (Udofin KFS-acknowledgement KRI ≤ 5 min) |
| `LossEventRecorded` (N11) | FX, UD → LDC | Loss, near-miss or gain event approved | taxonomy (Basel event type and levels 2–3), occurrence, discovery and accounting dates (ORM para 42), gross, recoveries, net (banded for individual borrowers), root cause, controls failed | Producer | (loss_event_id, version) | ≤ 1 working day of approval |
| `CapitalRatioComputed` (N11) signed | FX → LDC | Shadow, monthly or quarterly capital run | legal_entity, run type, as_of, owned fund, CET1, Tier 1, Tier 2, RWA by class, CRAR, leverage (BL only), headroom, PCA proximity (bps), rule-pack version | FX | (legal_entity, as_of, run_type, run_no) | std |
| `LimitBreached` (N11) signed | FX, UD → LDC, RE GRC; FX also blocks new exposure internally (CON paras 45–46) | Regulatory, Board or internal limit breached or projected; cure | limit_id, `limit_type` (REGULATORY, BOARD, INTERNAL, LE, SSE, CME, SLS_TOLERANCE, LCR, HQLA_STRESS, DLG_CAP, SR_SELF_INVESTMENT, INVESTMENT, PCA_RT1, PCA_RT2, PCA_RT3), `status` (OPEN or CURED), value, limit, first_breach_at, `projected` (boolean: true for a forecast crossing such as a PCA year-end projection), citation, pseudonymised counterparty or group ref | Producer | (limit_id, episode_id, update_seq) | ≤ 15 min; a cure is an update with a higher `update_seq` |
| `StressTestCompleted` (N11) | FX → LDC | Stress or reverse-stress run approved | scenario id and version, horizon, snapshot hash, model versions, summary per period (CRAR, Tier 1, CET1, LCR, SLS, PCA proximity) | FX | (scenario_id, run_id) | std |
| `RiskSnapshotPublished` (N11) | FX → LDC (daily and month-end); UD → RE GRC and Udofin's own LDC tenant (quarterly RE pack, Udofin RA1.6) | Metric run computed or certified | metric ids, versions, values, thresholds, RAG, grain, lineage ref, certification state (`risk_snapshot_v1`) | Producer | (producer, scope, as_of, run_no) | FX daily by 09:00 IST [REC]; UD ≤ 15 days after quarter-end [REC] |
| `RiskSignalRaised` (A, unchanged) | UD, FIA → FX (6.2); FX → LDC as part of the feed | EWS or fraud signal | as 6.2 | Signal UD or FIA; decision FX | signal_id | As 6.2 |
| API `GET /v1/grc/kris?updated_since=[ts]` and `GET /v1/grc/obligations?updated_since=[ts]` at LDC (N11+) | FX, UD → LDC | Inbound pull of approved KRI definitions, thresholds and obligations, plus `ObligationPublished` | KRI mapped to a metric id; threshold version with LDC approval ref; obligation_ref | LDC | n/a | Daily and on `ObligationPublished` |

**LawDocsComply risk-feed rules.**

- **Envelope:** `type` = `in.infrabyx.risk.[EventName].v[major]` (Finbyx RK2.4; Udofin RA1); `subject` = the metric, limit, KRI, run or loss-event id.
- **Extension attributes** (CloudEvents 1.0.2 names are lower-case alphanumeric): `asof`, `metricversion`, `citation`, `contenthash` (SHA-256 of `data`) and `prevhash` (per producer and tenant hash chain). `source` stays `urn:infrabyx:[product]:[tenantid]`; the legal entity travels as `data.legal_entity_id`. Replaying a period reproduces identical hashes and an unbroken chain.
- **HMAC pseudonyms:** every counterparty and group reference is `ps_[epoch]_[base64url(HMAC-SHA256(tenant_feed_key, internal_id))]`; the key lives in the tenant's KMS (BYOK where chosen) and rotates annually with a new epoch; LawDocsComply cannot reverse it; only authorised users resolve it inside the producing product. Individual-borrower amounts are banded; corporate exposure amounts appear only in LE and concentration events.
- **No raw PII:** no name, PAN, phone, e-mail, account number or Aadhaar reference in any `risk` payload (schema test, 14.3).
- **Inbound:** formula logic is never accepted from LawDocsComply; a KRI whose metric does not exist in the producer's metric library (Finbyx RK6) is rejected with a "metric required" task. RAS thresholds approved in LawDocsComply become a new threshold version with the LDC approval reference.
- **PCA (MSD paras 16–17):** crossing a risk threshold on CRAR, Tier 1, NNPA, CIC ANW to RWA or CIC leverage emits `LimitBreached` with `limit_type = PCA_RTn`; proximity within 150 bps of RT1 [REC default; Finbyx Appendix B] is a `KriBreached` on the PCA-proximity metric, not a breach. RBI placement and restrictions are recorded internally (restriction register), not published.
- **Reconciliation:** daily count and hash of events sent versus acknowledged; monthly sample of metric values in LawDocsComply versus the producer; breaks raise `ReconciliationBreakRaised`.
- `InvestmentLimitBreached` (6.25) is always accompanied by `LimitBreached` with `limit_type = INVESTMENT`, so LawDocsComply needs only the `risk` domain.

## 6.23 Governance and workforce (`governance`, `workforce`)

Finbyx Part 7F (GV1–GV3, GV5–GV7) and the Operations Hub (OH10, OH12). These domains are **tenant-internal**: the routing rules below are enforced at every gateway.

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `BoardMeetingScheduled` (N11) | FX → tenant compliance destination only (embedded M14 or LDC) | Meeting SCHEDULED | meeting type (BOARD, COMMITTEE, AGM, EGM, GENERAL_BODY), date, mode, mandatory items covered, notice dispatched_at | FX | (meeting_id, version) | std |
| `ResolutionPassed` (N11) signed | FX → tenant compliance destination only | Each resolution passed | meeting and resolution type (BOARD, CIRCULAR, ORDINARY, SPECIAL), subject code, effective date, filings started (e.g. MGT-14), evidence hash | FX | resolution_id | std |
| `KmpChanged` (N11) | FX → tenant compliance destination only | Director or KMP appointment, cessation or redesignation | role, DIN (directors only), effective date, evidence hash, obligations started; never PAN or date of birth | FX | (person_ref, role, effective_date) | std |
| `TaskAssigned` (N11) | FX → tenant compliance destination only | Task sourced from an obligation, audit finding or resolution | source ref, due date, owner position, evidence requirement | FX | task_id | std |
| `EmployeeOnboarded` (N11) | FX GV6 → tenant-internal consumers; OH10 → OH modules and the Infrabyx LDC_GROUP tenant | Employee reaches JOINED | employee_ref (pseudonymous), legal entity, department, position, worker type, start date | Employer system | (employee_ref, lifecycle_seq) | std |
| `EmployeeOffboarded` (N11) | Same boundary as above | LAST_WORKING_DAY reached or dismissal | employee_ref, last working day, access_off_at, final-wage timer start (Code on Wages s.17(2): 2 working days) | Employer system | (employee_ref, lifecycle_seq) | Access off same day |
| `MailboxProvisioned` (N11) | FX GV7 → tenant-internal; OH12 → OH modules | Mailbox and licence assigned through `WorkplaceProvider` | provider (M365, GOOGLE, ONPREM), mailbox alias ref, licence SKU, residency attestation ref, action (CREATE, SUSPEND, RETAIN, DELETE) | Employer system | (employee_ref, provider, action) | std |
| `AccessReviewCompleted` (N11) | FX, UD, OH → routed by `review_scope`: TENANT → tenant compliance destination only; PLATFORM (Infrabyx staff access to Finbyx or Udofin production) → OH13, OH14; OH → OH14 | Access attestation completed | review_scope, system, period, population count, exceptions, revocations, reviewer roles, evidence hash | Reviewing system | review_id | ≤ 1 working day |

**Tenant-internal routing rules.**

1. Governance events and tenant workforce events (`review_scope = TENANT`) never leave the tenant boundary except to the tenant's own compliance destination (9.1); never to the Operations Hub, Equator, another group company or another tenant. An OH subscription to these subjects from a product source is refused at registration and at the gateway. *(v1.2, from LD App. Y)* Exception from v1.2: governance events may reach the **same organisation's legal system of record** (LawDocs) under an active `legal_sor_link`, limited to `BoardMeetingScheduled`, `ResolutionPassed` and `KmpChanged`, for checking execution formalities and signing authority; no other governance event type is delivered to LD.
2. The Hub's own HRMS emits the same names with `source = urn:infrabyx:oh:[legalentityid]`; identities reach group products through SCIM (4.6), not through events.
3. Payloads never carry PAN, Aadhaar, date of birth, bank account, salary, leave reason or health data; those stay in the employer system under the `HR` class (13.2).
4. Prohibited monitoring data (keystroke or mouse scores, screenshots, webcam capture, off-duty location, covert monitoring, AI productivity scores used for discipline or pay) is never captured, so no schema may contain it (DPDP; Finbyx GV6.3).
5. Wage, leave, overtime, gratuity and State tables come from the shared Labour Code rule pack (12.3).

**v1.2 amendments** *(v1.2, from LD App. Y)*. Producers: LDC also produces `BoardMeetingScheduled`, `ResolutionPassed` and `KmpChanged` where LDC is the organisation's governance system of record (today only FX produces them). APIs added: `GET /v1/governance/resolutions?updated_since=` (N12+; LD → LDC or FX; resolutions by subject code and date for the formalities gate; scope `governance.resolution:read`; p95 ≤ 800 ms) and `GET /v1/governance/kmp` (N12+; LD → LDC or FX; current directors, KMP and authorised signatories — role, DIN for directors, effective dates; never PAN or date of birth; scope `governance.kmp:read`; p95 ≤ 800 ms). Workforce events are unchanged; LD reads only a minimal people projection through the HRMS system of record's API (`hr.employee:read.minimal`), never salary, leave, attendance or identity documents (rule 3). `CareerApplicationReceived` (6.39) is Infrabyx's own recruitment intake from public sites into OH10 and is not a tenant workforce event; it follows rule 2's boundary (OH source and OH consumers only).

## 6.24 Member and group lending (`members`)

Finbyx Part 7G (IP2 credit co-operative societies, IP4 microfinance JLG and SHG); Udofin Part 7E (MG1–MG4) and Part 7B UP4. **Producer rule:** the lender's system of record (Finbyx or another certified LOS/LMS) produces `MemberAdmitted`, `ShareCapitalPosted`, `GroupFormed` and `GroupCollectionPosted`; Udofin consumes them. Udofin produces `CentreMeetingHeld` only when the meeting is closed in Udofin's assisted tools; otherwise the lender produces it. A credit co-operative society is a **non-RE lender**: it uses the same contracts with `lender_type = NON_RE_SOCIETY` and its ecosystem lender id in `reid` (4.1).

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `MemberAdmitted` (N11) | Lender (FX IP2 or society's certified LOS) → UD | Member reaches ACTIVE | lender id, member party_ref (pairwise for Udofin), member class (ORDINARY_VOTING, NOMINAL, ASSOCIATE, NON_VOTING_SHAREHOLDER, INSTITUTIONAL), borrowing eligibility, area-of-operation check, admitted_at | Lender | (lender_id, member_ref) | std |
| `ShareCapitalPosted` (N11) signed | Lender → UD | Allotment, top-up, transfer, redemption or forfeiture posted | member party_ref, transaction type, amount, shares held after, receipt ref | Lender | (lender_id, share_txn_id) | Same day |
| `GroupFormed` (N11) | Lender (FX IP4 or the RE's LMS) → UD | Group ACTIVE after GRT | group_id, type (JLG, SHG), centre_id, member party_refs, GRT evidence ref | Lender | group_id | std; Udofin marks a group RECOGNISED only on this event |
| `CentreMeetingHeld` (N11) | UD → lender when closed in Udofin tooling; otherwise lender → UD | Meeting closed and reconciled | centre_id, date, designated place (RBC para 90), start and end time, attendance per member, receipts (receipt_no, amount, mode UPI or CASH, collector role), issues, next meeting | Closing system; lender posts | (centre_id, meeting_date) | Same day |
| `GroupCollectionPosted` (N11) signed | Lender → UD | Meeting collections posted to loans | centre_id, meeting date, per-member postings (loan ref, amount, UTR or receipt_no), shortfall and cash-variance flags | Lender | (centre_id, meeting_date, posting_seq) | Same day [REC; mirrors CF para 10(5)] |
| API `GET /v1/societies/{id}/members/{ref}` (N11+) | UD → society system | Membership verification before any loan screen | returns class, status (ACTIVE, DEFAULTER, RESIGNED, EXPELLED, DECEASED), borrowing eligibility, share-holding sufficiency; consentref required | Society | n/a | p95 ≤ 800 ms |
| API `POST /v1/societies/{id}/membership-applications` (N11+) | UD → society system | Applicant applies for membership | KYC evidence refs (no Aadhaar number), area-of-operation proof, nominee, declared other-society borrowings, consentref | Society decides | Idempotency-Key | Ack ≤ 5 min; decision timer per Act (MSCS s.25(4): 4 months, then deemed refused) |
| Field `lender_type` on `ApplicationSubmitted` (N11+) | UD → lender | As 6.2 | `lender_type` ∈ RE, NON_RE_SOCIETY; optional in v1.x minor, absent means RE | As 6.2 | As 6.2 | As 6.2 |

- **Hard blocks** (`regulatory-guard`): deposits from anyone other than an active voting member (MSCS s.67 Explanation; SCS-MH s.144-5A; BUDS Act First Schedule item 8), and Udofin never lists, solicits, markets or collects deposits (no deposit API exists); co-lending, loan sale, direct assignment, participation or DLG between a society or co-operative bank and any NBFC (TDCR paras 7, 12(4), 97); loans on the security of the society's own shares (MSCS s.66(1)); society products in the RE multi-lender offer view; the RBI Ombudsman route for society members (societies are outside RB-IOS 2026).
- **Money:** admission fee, share money and repayments go only to the society's own account; Udofin never collects, holds or nets them (CF para 10 applied by contract [REC]).
- Society loans on Udofin run on web and assisted channels only until app-store policy for non-RE lenders is confirmed [VERIFY].
- **Microfinance:** each loan is an individual contract; joint liability is voluntary and no member's payment, savings or disbursal is applied to another's loan; UPI QR per member per instalment on the lender's merchant account is the default; cash at centre meetings on Udofin-sourced loans only with the RE's legal opinion (CF paras 10(2), 10(5)), and Udofin staff collect cash only as the RE's appointed agent on overdue loans (Udofin UR4); contact hours 09:00–18:00 until 31 December 2026, then the RBC Third Amendment rule pack (RBI/2026-27/230) from 1 January 2027 [VERIFY: final window]; household cap and MFI-only bureau reporting (6.19).
- Full registers (`member_register_v1`, `share_ledger_v1`, `jlg_group_v1`) are for archives, Registrar or auditor packs and migration; Udofin receives member data only for members who applied through Udofin or consented to Udofin presentation.

## 6.25 Investments, ARC and servicing (`investments`)

Finbyx Part 7H (IV1–IV7) and Part 7G IP5 (ARCs). **Finbyx records, checks, values, accounts and reports; it never executes trades, routes orders or gives investment advice.** Consumers that are other tenants (SR holders, transferors, investors, trustees) receive these events only under a contract recorded as a link (4.1) between the two tenants.

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `TradeBooked` (N11) | FX → FX 7C and 7E (internal), custodian or depository reconciliation adapter, tenant compliance destination (PIT evidence where relevant) | Contract note matched and posted (trade-date accounting) | order_id, ISIN, side, quantity, price, contract-note hash, posting id, approval refs | FX | (order_id, contract_note_hash) | std |
| `PositionValued` (N11) | FX → FX 7E (internal), LDC (aggregates), investor tenants under a look-through contract | Valuation run per position | position_id, method, price source, fair-value level, value, run type (INDICATIVE, OFFICIAL), hash | FX | (position_id, valuation_run_id) | Official month-end run by WD+3 [REC] |
| `InvestmentLimitBreached` (N11) | FX → FX 7E (internal), LDC (always with `LimitBreached`, 6.22) | Investment, exposure or category limit breached | limit_id, rule (INV, CON, CICD, ARC para 21, RBI-AIF), value, limit, citation, pseudonymised issuer ref | FX | (limit_id, episode_id, update_seq) | ≤ 15 min |
| `AssetAcquired` (N11) signed | ARC tenant (FX IP5) → transferor's system (FX R13 or other LMS), LDC | Acquisition completed | scheme_id, trust_id, mode (AUCTION, BILATERAL), acquisition price, transferor org, account refs (pseudonymous), settlement UTR | ARC | (scheme_id, acquisition_id) | ≤ 1 working day |
| `SecurityReceiptIssued` (N11) signed | ARC → QB holder tenants (FX IV4), transferor | SRs issued | ISIN, scheme, class, units, face value, holder ref (QB), ARC self-investment percentage (ARC para 81) | ARC | (isin, issue_id) | ≤ 1 working day |
| `SrNavPublished` (N11) | ARC → SR holders (FX IV4), transferors (FX R13) | NAV as on 30 June and 31 December (ARC para 90) | ISIN, scheme, class, NAV, CRA recovery range, rating, as_of | ARC | (isin, as_of) | Per ARC Directions |
| `ServicerRemittanceMade` (N11) signed | Originator-servicer (FX IV7) → trustee (TR), investor tenants | Waterfall payout instruction executed by the trustee | transaction_id, period, collected, remitted, retained fee, principal and interest deficiency, trigger status | Servicer; the trustee pays | (transaction_id, period, remittance_seq) | Per servicing agreement (daily or T+1 sweep) |
| `InvestorReportPublished` (N11) | Servicer → TR, investor tenants, CRAs | Monthly servicer report or SEC disclosure released | report type (SERVICER_MONTHLY, MHP_MRR, MATERIAL_CHANGE, STC_DATA), period, document ref and hash (`servicer_report_v1`) | Servicer | (transaction_id, report_type, period) | SEC paras 18–22, 112–113; material change ≤ 14 days |

- **Recycling rule:** the originator may use the upfront sale consideration freely; post-sale collections belong to the SPE, post to a held-in-trust liability sub-ledger and never fund the originator's lending (SEC para 95(2)–(4)); replenishment only within a documented period and never to improve a deteriorated pool (CAP para 27(9)); clean-up call only at or below 10% (CAP para 27(8)).
- **Co-operatives** never co-lend or sell loans (6.24); IFSC entities as co-lending partners await the owner's decision (Finbyx Appendix B).
- The GV4.4 restricted list (listed borrowers whose UPSI lender staff hold) is consumed only inside the tenant by the pre-trade check; it is never published cross-product.
- AIF tenants deliver RBI-AIF para 6 debtor look-through files to RE investor tenants through the file contract (3.11) using `investment_position_v1` with the look-through profile.
- Market data only under a recorded licence (Finbyx IV1); prices never leave the tenant except as valuation results.

## 6.26 Portability and storage (`portability`)

Finbyx Part 7J (DP1–DP5); Udofin Part 7H RA3 and Part 7B UP3, UP5; archive standard 12.1; storage contract 12.2. Payloads describe jobs and archives, never their content. Borrower self-service exports (Udofin UB1) are internal to Udofin and publish no cross-product event; wellness add-on data never appears in any archive.

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `ExportRequested` (N11) | FX, UD → tenant compliance destination (UD: the RE); OH4 (exit projects) and OH13 (status and counts only) | Export job REQUESTED | job_id, scope type (DATASET, LEGAL_ENTITY, MODULE, AUDIT_PACK, RE_PACK, FULL_TENANT, EXIT), data classes, destination type, requester role | Producer | job_id | std |
| `ExportCompleted` (N11) signed | Same | Job CONFIRMED by recipient or target | archive_id, archive standard version, folder profile, file count, bytes, manifest hash, destination type, predecessor archive_id | Producer | archive_id | std |
| `StorageTargetConnected` (N11) | Same | `verifyResidency()` and `testWrite()` pass (12.2) | target_id, provider, region, data classes allowed, key mode, write-once flag, connector certification version | Producer | (target_id, version) | std |
| `BackupCompleted` (N11) | FX, UD → tenant compliance destination; OH13 (status); OH (own platform, `oh` scope) → OH13 | Customer-held backup delivered and verified, or platform backup evidence produced | archive_id, type (DAILY_INCREMENTAL, WEEKLY, MONTHLY_FULL, FY_FULL, PLATFORM), bytes, manifest hash, target_id | Producer | (target_id, archive_id) | Daily by 06:00 IST [REC] |
| `RestoreTested` (N11) | FX, UD, OH (`oh` scope) → tenant compliance destination (product tests); OH13 (status) and OH14 (control evidence) | Restore test completed | test_id, type (INTEGRITY, READABILITY, REHYDRATION, DR_DRILL), archive_id, result, discrepancy count, approver role | Producer | test_id | ≤ 1 working day |

- A storage-target health failure (credential revoked, residency check failed, canary mismatch) is published as `ControlTestResultPublished` (control `STORAGE_TARGET_HEALTH`, result FAIL) to the tenant's compliance destination; jobs pause and are never retried silently against another target.
- Export and read access are never suspended for non-payment (6.27); exit exports use scope EXIT (Finbyx DP5; Udofin UP5) and the OUT para 87 freeze applies.

## 6.27 Plans, billing and usage (`billing`)

Operations Hub OH8 (catalogue, prices, invoices, Razorpay account, revenue accounting); Finbyx Part 7K and Udofin Part 7G (tenant pages, server-side entitlement enforcement, metering at source). **Aggregates only reach the Hub.** Billing payment events are named `SubscriptionPaymentReceived` and `SubscriptionPaymentFailed`; the servicing `PaymentReceived` (6.4) is never used for vendor billing, and consumers key on the full CloudEvents `type`.

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `PlanChanged` (N11) | OH → FX, UD | Plan created, upgraded, downgraded or switched (an RE deal switch arrives through Udofin UP2 and OH8) | tenantid, legal entity scope, plan, SKU, effective_at, proration ref, catalogue version | OH | (tenantid, plan_change_id) | std |
| `EntitlementChanged` (N11) signed | OH → FX, UD | Entitlement set or changed | SKU, modules, limits, start, end, contract ref, JWS by the pinned Hub key | OH | (tenantid, entitlement_id, version) | std |
| `UsageRecorded` (N11) | FX, UD → OH | Usage statement closed (monthly; daily provisional) | tenantid, legal entity, meter, period, quantity, `meter_kind` (USAGE, REVENUE_AGGREGATE), statement hash (`usage_aggregate_v1`); never loan, borrower, member, user or record ids | Product | (tenantid, meter, period, statement_version) | Monthly by WD+3 [REC] |
| `InvoiceIssued` (N11) signed | OH → FX, UD | Tax invoice or credit note issued | invoice_no, supplier and recipient GSTINs, place of supply, SAC [VERIFY], taxable value, GST, IRN and QR where applicable, due date, document ref | OH | invoice_no | std |
| `SubscriptionPaymentReceived` (N11) signed | OH → FX, UD | Razorpay payment verified server-side (webhook signature and API fetch) | invoice or subscription ref, amount, method class, Razorpay payment id, captured_at | OH | razorpay_payment_id | ≤ 15 min of capture |
| `SubscriptionPaymentFailed` (N11) | OH → FX, UD | Failure, mandate failure or subscription halt | ref, reason class, retry schedule, dunning stage | OH | (ref, attempt) | ≤ 15 min |
| `SubscriptionCancelled` (N11) | OH → FX, UD | Cancellation or non-renewal effective | subscription_id, effective_at, reason, exit path (DP5 or UP5 for regulated tenants) | OH | subscription_id | std |
| API `GET /v1/catalogue/versions/{v}` (N11+) | FX, UD, EQ, LDC → OH | Catalogue fetch (on `PlanChanged` and daily) | signed catalogue document (JWS by the pinned Hub key); SKUs mapped to `module.yaml` `licence_sku` (11.1); explainers | OH | n/a | p95 ≤ 800 ms |
| API `POST /v1/billing/quotes` (N11+) | FX, UD billing page → OH | Priced quote and proration preview before a plan or add-on change | input: tenantid, target plan or add-on, effective date; returns quote_id, price, prorated charge or credit (IST calendar-day proration), GST, entitlement diff, valid_until (default 7 days); products compute no price or tax | OH | Idempotency-Key | ≤ 2 s |
| API `POST /v1/billing/orders` (N11+) | FX, UD billing page → OH | Order, payment link, subscription or mandate created from an approved quote or an invoice | quote_id or invoice ref; returns a Razorpay-hosted URL for top-level redirect | OH | Idempotency-Key | ≤ 2 s |
| API `GET /v1/billing/invoices?tenantid=[id]` (N11+) | FX, UD → OH | Display on billing pages | invoices, credit notes, statements of account, documents | OH | n/a | p95 ≤ 800 ms |
| API `POST /v1/usage-disputes` (N11+) | FX, UD billing page → OH | Tenant disputes a meter within 7 days of statement issue | tenantid, meter, period, statement_version, reason; holds invoicing for that meter only; an upheld dispute is answered by a new `UsageRecorded` with a higher `statement_version` | OH decides | Idempotency-Key | Ack ≤ 2 s; decision ≤ 5 working days [REC] |
| API `GET /v1/entitlements?tenant=[tenantid]` (N11+) | OH8 → FX, UD | Daily reconciliation of entitlements as applied against OH8 (the source of truth for issued entitlements) | applied entitlement ids and versions, modules, limits, module states (11.1); a mismatch raises `ReconciliationBreakRaised` | Product (as applied) | n/a | p95 ≤ 800 ms; by 06:00 IST daily |
| `CatalogueChanged` (N12) (IPB) *(v1.2)* | OH8 → FX, UD, LD, LDC, EQ public sites and tenant plan pages | Plan, price, coupon, trial length or feature matrix changes in the revenue catalogue for a product or brand pack | product, brand_pack_id?, catalogue_version, changed (PLANS, PRICES, COUPONS, FEATURES, TRIALS), effective_at, catalogue_hash; consumers re-read `BILLING_PORT.getCatalogue(product, brand_pack_id)`; hand-typed prices remain impossible (IPB-04-33); `dataclass = PUBLIC` | OH8 | (product, brand_pack_id, catalogue_version) | ≤ 5 min |
| Fields on `POST /v1/billing/quotes` and `/orders` (N12+) *(v1.2, from LD App. Y)* | LD → OH8 | Marketplace and service orders | `line_items[].supplier_type`, `line_items[].supplier_ref`, `line_items[].pure_agent` (bool), `route_transfers[]` (linked-account ref, amount, on_hold), `buyer_billing_identity` (closed list under `CONTRACT_PERFORMANCE_CUSTOMER`, 5.3) | OH8 | Idempotency-Key | As this Part |
| `UsageRecorded` — producers LD, LDC, EQ added *(v1.2, from LD App. Y)* | LD, LDC, EQ → OH8 | Usage statement closed | As the existing row; LD meter codes `ESIGN_AADHAAR`, `ESIGN_OTP`, `ESTAMP_FACILITATION`, `AI_CREDITS`, `AGENT_SEATS`, `COURT_DATA_REFRESH`, `TM_WATCH_MARKS`, `STORAGE_GB_MONTH`, `API_CALLS`, `EXTRA_SEATS_PEAK`, `DATA_ROOMS`; AI meters group-wide `AI_CREDITS`, `AI_TOKENS_IN`, `AI_TOKENS_OUT` (IPB-03 `UsageMetered` carried here); counts only, never document or matter identifiers | Product (readings); OH8 (rating) | (tenantid, meter, period, statement_id) | ≤ 1 working day after period close |

- **Dunning never interrupts regulated functions, read access or export.** Non-payment ends in a termination notice leading into the exit process (Finbyx DP5; Udofin UP5), never a hard cancel, remote kill switch or remote deletion; products keep the last valid signed entitlement for 30 days if the Hub is unreachable [REC].
- A browser redirect is never proof of payment; card data is never stored, processed or logged (Razorpay-hosted pages; PCI DSS v4.0.1 scope minimised; CoFT circular 2021); Razorpay keys and webhook secrets live only in the Hub (and in Udofin's separate B2C billing service).
- **Udofin B2C plans** are billed by Udofin's own billing service on Udofin's own Razorpay account; their plan, entitlement, invoice and payment events are Udofin-internal and are not registered cross-product subjects. The Hub receives only monthly `UsageRecorded` with `meter_kind = REVENUE_AGGREGATE` per plan (subscriber count, gross, GST); no subscriber key, borrower identity or wellness data.
- **Borrowers are never charged for anything loan-related** (CF para 10(4)); a separate non-credit add-on needs Udofin's FW4 gates, an owner decision and a legal opinion, and no plan, price or upsell may appear inside a loan journey.
- The billing service has no access to tenants' loan-payment credentials and loan money never uses billing rails (CF paras 10(1)–(3)); a revenue stream is shown only after its legality gate is approved (OH8; Finbyx CM5; Udofin RV1).

## 6.28 Lender partnerships (`partners`)

Udofin Part 7B (UP1–UP5). Udofin produces the deal events; the RE's system (Finbyx LSP register, OUT para 36 central record of material outsourcing) or the RE's GRC tool consumes them; LawDocsComply receives them in the RE's compliance mode. A non-RE society deal carries `lender_type = NON_RE_SOCIETY` and is consumed by the society's certified system or shown in the lender portal only (OUT para 36 does not bind a society).

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `LenderDealProposed` (N11) | UD → RE system or RE GRC, LDC | Deal PROPOSED | deal_id, lender org_id, lender_type, RE category and layer, proposed products, channels and states, NDA ref | UD | deal_id | std |
| `LenderDealApproved` (N11) signed | UD → same | LEGAL complete: agreements executed, clause matrix complete | agreement hashes, OUT para 34 and para 74 clause-matrix status, DLG flag, recovery-agent flag, RE approver authority ref | UD record; RE approval | (deal_id, approval_version) | std |
| `LenderDealActivated` (N11) signed | UD → same | PILOT starts, GENERAL go-live, or resumption after suspension | `mode` (PILOT or GENERAL), `resumed` (boolean), deal config version, CIMS DLA acknowledgement ref (CF para 18), website disclosure ref (CF para 9(4)), certification ref | UD | (deal_id, mode, activation_seq) | Before any borrower journey for the lender |
| `LenderDealSuspended` (N11) signed | UD → same | RE suspension (OUT para 17), Udofin suspension or regulatory trigger | reason code, scope (NEW_BUSINESS, ALL), borrower-continuity rules applied | UD | (deal_id, suspension_seq) | ≤ 1 h [REC] |
| `LenderDealTerminated` (N11) signed | UD → same | Deal TERMINATED after the exit plan | exit archive_id, data-return certificate hash, purge plan ref | UD | deal_id | ≤ 1 working day |
| API `GET /v1/deals/{id}/config-versions/{version}` (N11+) | RE system → UD | RE reviews a configuration version | `deal_config_v1` without commercial terms, diff, impact analysis | UD | n/a | p95 ≤ 800 ms |
| API `POST /v1/deals/{id}/approvals` (N11+) | RE system → UD | RE approves a transition or configuration version | approver name, role, authority ref, decision, comments | RE | Idempotency-Key | ≤ 2 s |

- No borrower-facing journey, offer or communication exists for a lender before `LenderDealActivated` with `mode = PILOT`.
- Neutrality: no sponsored or paid placement in the multi-lender offer view (CF para 7(4)); commercial terms are never inside `deal_config_v1`.
- RE audit, inspection and CIMS packs P1–P10 (Udofin UP3) use `ExportRequested` and `ExportCompleted` with scope RE_PACK and the `re_audit_pack_v1` folder profile; an auditor's or supervisor's download is `ExternalAccessUsed` (6.21).

## 6.29 Operations Hub (`ops`)

Operations Hub OH3–OH6, OH8 (entitlement reconciliation), OH9, OH13, OH14 (claims gate); Finbyx Part 7L and Udofin RA4 for engineering evidence. Directory events use the domain `directory` (`in.infrabyx.directory.[EventName].v1`). Nothing here carries customer content.

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `TenantProvisioned` (N11) signed | OH → FX, UD, EQ, LDC | Provisioning request approved in OH4 (maker-checker) for a sandbox, UAT or production tenant | provisioning_request_id, org_id, product, environment (SANDBOX, UAT, PRODUCTION), deployment model (SAAS, DEDICATED, ON_PREM), legal entities, plan and entitlement ref, residency, MSA and DPA refs, OUT clause-matrix ref (PRODUCTION only), first-admin work email with `legalbasis = CONTRACT_PERFORMANCE_VENDOR` (no password; the product sends the invitation) | OH request; product creates the tenant | provisioning_request_id | Ack ≤ 1 working day; ready ≤ 1 working day after a complete request [REC] |
| API `PUT /v1/provisioning-requests/{id}` (N11+) | FX, UD, EQ, LDC → OH | Product acknowledges `TenantProvisioned` and reports progress | status (ACCEPTED, READY, FAILED with reason code), tenantid and tenant-map entry (4.1) once READY | Product | Idempotency-Key | ≤ 2 s |
| API `GET /v1/tenants/{tenantid}/provisioning-status` (N11+) | OH → FX, UD, EQ, LDC | Fallback poll when no acknowledgement arrives within 1 working day | status (PENDING, READY, FAILED), tenant-map entry (4.1) | Product | n/a | p95 ≤ 800 ms |
| `ImplementationMilestoneReached` (N11) | OH → FX, UD (tenant admin view) | Milestone accepted by the tenant (DISCOVERY, CONFIGURATION, MIGRATION, INTEGRATIONS, TRAINING, GO_LIVE) | project_id, milestone, acceptance evidence ref, migration record counts and reconciliation result (no records) | OH | (project_id, milestone) | std |
| `SupportTicketOpened` (N11) | OH → FX, UD (status on product help pages) | Ticket created from the product (API below) or another channel | ticket_id, tenantid, product, category, severity, SLA clock | OH | ticket_id | Acknowledged per support SLA |
| `SupportTicketResolved` (N11) | OH → FX, UD | Resolution confirmed or auto-closed | ticket_id, resolution code, resolved_at, satisfaction request | OH | (ticket_id, resolution_seq) | std |
| API `POST /v1/support/tickets` (N11+) | FX, UD → OH | Tenant user raises a ticket from in-product help | product-signed token (org_id, tenantid, user ref), category, severity, description, deep link, attachments after PII scan (redacted screenshots only; Aadhaar, PAN, account, card or mobile patterns redacted or rejected with a reason) | OH | Idempotency-Key | ≤ 2 s |
| API `POST /v1/crm/requests` (N11+) | FX, UD billing and plan pages → OH3 | "Contact sales" or enterprise-plan request | org_id, tenantid, requester business contact under the product's notice, product, plan or add-on of interest, message; never borrower, member or loan data | OH | Idempotency-Key | ≤ 2 s; sales response per OH3 SLA |
| `ReleasePublished` (N11) | FX, UD, EQ, LDC, OH → OH13, OH14; tenant compliance destination (release notes with regulatory impact) | Production deployment complete | version, change ids, SBOM hash, signature digest, release-notes ref, regulatory-impact flag | Product | (product, version) | ≤ 1 h |
| `ChangeApproved` (N11) | OH13 (CAB record) → FX, UD, EQ, LDC deployment gates, OH14; tenant compliance destination for tenant-impacting REGULATED changes | CAB, standard-catalogue or emergency approval | change_id, class (STANDARD, NORMAL, REGULATED, EMERGENCY; REGULATED needs a compliance reviewer and a golden-case pass), approvers, window, risk rating, retrospective-review due date (EMERGENCY) | OH13 | (change_id, approval_version) | Before deployment; a production deployment without a matching approval is refused |
| `ControlEvidenceCollected` (N11) | FX, UD, OH → OH14; tenant compliance destination where the evidence names a tenant | Evidence item collected for a common-framework control | control_id, period, collector, artefact hash, reviewer, status | Producer | (control_id, period, artefact_hash) | ≤ 1 h |
| `ProfessionalEmpanelled` (N11) | OH9 → FX (RS R11), Udolex | Verification complete; listed in the group directory | professional_id, BCI Rule 36 fields only (name, address, contacts, enrolment number and State Bar Council, enrolment date, qualifications, practice areas), courts, languages, `equator_neutral` flag | OH | (professional_id, version) | std |
| `ProfessionalSuspended` (N11) | OH9 → FX (RS R11), Udolex | Suspension, removal, disciplinary order or lapsed certificate of practice | professional_id, reason class, effective_at | OH | (professional_id, suspension_seq) | ≤ 1 h; RS blocks new allocations |
| `MatterAllocated` (N11) | FX (RS R11), Udolex → OH9; group legal tools (Infrabyx's own matters, `oh` scope) → OH9 | RE offers a matter to counsel from its own panel; counsel accepts or declines; RE withdraws | allocation_id, professional_id, reid, matter class, forum type and State, allocation basis (ROTATION, RULE, REASONED_EXCEPTION), allocated_at, status (OFFERED, ACCEPTED, DECLINED_CONFLICT, DECLINED_CAPACITY, WITHDRAWN), `update_seq`; never party names, matter or case numbers, loan identifiers or amounts | RE decision; RS record | (allocation_id, update_seq) | std; a status change is an update with a higher `update_seq` |
| API `GET /v1/directory/professionals` (N11+) | FX (RS R11), Udolex, group legal tools and websites → OH9 | Directory search | filters: category, State, district, court or forum, practice area, language; only ACTIVE with current credentials; Rule 36 fields and status in randomised order per call (seed logged); no ranking or sort-by-score parameter | OH | n/a | p95 ≤ 800 ms |
| API `GET /v1/directory/professionals/{id}` (N11+) | FX (RS R11), Udolex → OH9 | Professional detail for the RE's panel checklist | Rule 36 fields, credential summary and expiries, verification dates and evidence hashes, professional-indemnity status, declared institutional conflicts | OH | n/a | p95 ≤ 800 ms |
| API `POST /v1/conflicts/check` (N11+) | EQ (machine client only) → OH | Neutral conflict screen (4.6) | input: professional_id (or person_ref for Infrabyx staff and consultants), counterparty reid or org_id, window (ISO 8601 duration, default P3Y); output: allocation count by that counterparty in the window, `conflict` flag with category (EMPLOYMENT, COUNSEL, CONSULTANCY, DIRECTORSHIP, GROUP_COMMERCIAL_RELATIONSHIP), as_of; counts and flags only, never matter, contract-value or pipeline data; every call logged | OH | Idempotency-Key | p95 ≤ 800 ms |
| API `GET /v1/claims-gate/check` (N11+) | FX, UD, EQ, LDC, websites, OH7 → OH14 | Text or asset checked before publication | returns PASS or BLOCKED with the certification record (scheme, scope, report or certificate date) or the blocked phrase | OH | n/a | p95 ≤ 800 ms |
| `TenantRegistered` (N12) signed *(v1.2, from LD App. Y)* | LD, and any product with self-service sign-up → OH | A Company or practitioner tenant created by self-service or partner onboarding (not by `TenantProvisioned`) | tenantid, org identifiers (legal name, constitution, CIN/LLPIN, masked PAN, GSTIN), plan, partner_ref, first-admin work email (`legalbasis = CONTRACT_PERFORMANCE_VENDOR`), activated_at | Product (tenant); OH creates the commercial record | tenantid | ≤ 1 working day |
| `SystemOfRecordSwitched` (N12) signed *(v1.2, from LD App. Y)* | LD ↔ LDC | Kernel cutover completed under `legal_sor_link` (4.1) | org_id, kernel (LEGAL, GOVERNANCE, HRMS), from product, to product, effective_at, reconciliation report hash | Outgoing product | (org_id, kernel, effective_at) | Same day |
| `MarketplacePayoutSettled` (N12) signed *(v1.2, from LD App. Y)* | OH → LD | Razorpay Route transfer to a professional's linked account settled for a marketplace order | order ref, line ref, `supplier_type`, transfer id, amount, settled_at; never bank details | OH | transfer_id | ≤ 15 min |
| `MarketplaceTransferInstructed` (N12) signed *(v1.2, from LD App. Y)* | LD → OH8 | Instruction on an on-hold Route transfer: `RELEASE` on deliverable acceptance, deemed acceptance, consult window closed or dispute outcome; `REVERSE` (full or partial) on refund or dispute outcome; `EXTEND_HOLD` while a dispute is open | order ref, line ref, transfer ref, action, amount, reason code, engagement ref (`eng_` id only), milestone seq; never deliverable content, party names or bank details [LAW: RBI Master Directions on Regulation of Payment Aggregators, 15 Sep 2025 — OH8 holds and executes; LawDocs never pools third-party money] [VERIFY: paragraph refs] | LD (instruction); OH8 executes and owns the transfer | (eng_id, milestone_seq, attempt) | ≤ 15 min to OH8 acknowledgement |
| `ServiceOrderRouted` (N12) *(v1.2, from LD App. Y)* | LD → LDC (order context from OH8); LDC → LD for LawDocs-fulfilled lines bought in LDC | A buyer on the group storefront ordered a SKU whose fulfilment product is another product and payment is confirmed | OH8 order ref, line ref, SKU, fulfilment product, buyer org_id or pairwise customer ref, buyer tenant ref in the fulfilling product (if any), required-inputs checklist id, consentref (buyer's consent to pass order context); never tenant documents or answers; `dataclass = INTERNAL`; no Consumer Help order is ever routed (principle 14) | OH8 (order); fulfilling product (fulfilment) | (order_ref, line_ref) | ≤ 15 min |
| `ServiceOrderStatusChanged` (N12) *(v1.2, from LD App. Y)* | Fulfilling product → selling product | Fulfilment status change of a routed line | order ref, line ref, status (ACCEPTED, INPUTS_PENDING, IN_PROGRESS, ON_HOLD, DELIVERED, CLOSED, CANCELLED), status_at, deliverable available (bool; documents stay in the fulfilling product) | Fulfilling product | (order_ref, line_ref, seq) | ≤ 1 working day |
| `TenantSelfServeCreated` (N12) *(v1.2, from LD App. Y; reuses the LDC proposal)* | LD, LDC → OH4, OH3 | Self-serve tenant created (not via `TenantProvisioned`) | tenantid, product, origin (FREE_DRAFT, PRICING, MARKETPLACE, HEALTH_CHECK, RM_INVITE, MOBILE_APP), plan, segment, created_at; closed schema | Product | tenantid | ≤ 15 min |
| `ClientHealthSignal` (N12) *(v1.2, from LD App. Y; reuses the LDC proposal)* | LD, LDC → OH5 | Daily per Company tenant | tenantid, date, active_users, entitled_seats, product counters (LD: documents_created_30d, signatures_completed_30d, matters_tracked, tm_marks_tracked, vault_storage_gb), sla_breaches_30d, open_change_requests, retainer_hours_used_pct, last_meeting_at, renewal_risk_flag (fixed reason codes); closed schema | Product | (tenantid, date) | Daily |
| `SurveyResponseRecorded` (N12) *(v1.2, from LD App. Y)* | LD, LDC → OH5 | CSAT or NPS response submitted | tenantid or pairwise customer ref, survey type, score, sentiment class, engagement ref (id only); free text only when the respondent opts to share it | Product | response id | ≤ 1 h |
| `TimesheetAggregated` (N12) *(v1.2, from LD App. Y)* | LD, LDC → OH10, OH11 | Daily per staff member | staff id, date, client org id, tenantid, category, engagement id, hours, billable (bool); never task titles or content; closed schema | Product | (staff_id, date, tenantid, engagement_id) | Daily |
| `DeliveryMetricsMonthly` (N12) *(v1.2, from LD App. Y)* | LD, LDC → OH10, OH11 | Month close per staff member | staff id, month, tasks completed, SLA attainment %, deliverables accepted first time, rework rate, CSAT, hours vs plan; appraisal input only — no automated people decisions; closed schema | Product | (staff_id, month) | ≤ 3 working days after month end |
| `ServiceCreditIssued` (N12) signed *(v1.2, from LD App. Y; reuses the LDC proposal)* | LD, LDC → OH8 | Retainer or marketplace SLA breach confirmed for credit | credit ref, order_context (MARKETPLACE_ENGAGEMENT, CONSUMER_HELP_CASE, RETAINER), `eng_` or `grv_` id only, amount, reason code, approver ref (maker-checker) | Product | credit ref | ≤ 1 working day |
| `ContentPublished` (N12) *(v1.2, from LD App. Y)* | LD, any product's CMS → OH7 | A CMS page, post, video or clip linked to an OH7 calendar item is published | calendar item id, content kind, public URL, published_at, locale, claims-gate check id (`GET /v1/claims-gate/check`) | Product | (calendar_item_id, version) | ≤ 15 min |
| `GrievanceStatusChanged` (N12) *(v1.2, from LD App. Y)* | LD, LDC, EQ (platform grievance desks: platform, e-commerce, DPDP) → OH6 (metadata mirror for MIS) | A platform grievance changes state | grievance ref, category, channel, received_at, acknowledged_at, status, statutory clock code and due time, closed_at; never complaint text, user content or identity beyond a pairwise ref; Consumer Help grievances mirror only into the Consumer Help entity's own OH scope; loan grievances stay in 6.12 | Product | (grievance_ref, seq) | ≤ 15 min |
| `EmployeeOffboarded` (6.23) — consumer LD, LDC, EQ added *(v1.2, from LD App. Y)* | OH10 → LD, LDC, EQ staff realms | Staff leaver | staff id, effective_at | OH | (staff_id, effective_at) | Delivered ≤ 5 min; product sweep per its leaver procedure |
| API `POST /v1/client-conflicts/check` (N12+) *(v1.2, from LD App. Y)* | LD (Consumer Help conflict service only) → OH | Before Consumer Help intake | input: respondent organisation identifiers (legal name, CIN or GSTIN); output `is_group_client` flag and category (LENDER_RE, INSURER, OTHER) and as_of; never contract, value or pipeline data; every call logged | OH | n/a | p95 ≤ 800 ms |
| API `POST /v1/directory/professionals/applications` (N12+) *(v1.2, from LD App. Y)* | LD → OH9 | A professional applies through LawDocs | Rule 36 fields, credential documents by reference, consentref; OH9 verifies and empanels | OH | Idempotency-Key | ≤ 2 s |
| API `POST /v1/delivery/assignments` (N12+) *(v1.2, from LD App. Y)* | OH4 (signed machine client) → LD | OH4 assigns a delivery professional or RM to a LawDocs engagement | engagement id, staff id, role (`OPS_RM`, `OPS_PROFESSIONAL`, `OPS_DELIVERY_LEAD`), valid_from, valid_to (≤ 90 days), approver | LD | Idempotency-Key | ≤ 2 s |
| API `GET /v1/template-packs/{pack}/versions/{v}` (N12+) *(v1.2, from LD App. Y)* | FX, LDC, OH → LD | Signed template pack with reviewer of record and effective dates | pack id, version, templates (ids, hashes), reviewer of record, effective dates, JWS | LD | n/a | p95 ≤ 800 ms |

- **Directory amendments** *(v1.2, from LD App. Y)*: `MatterAllocated` producers add LD for advocates engaged by an organisation through the LawDocs marketplace (optional `org_id` when no `reid`; basis `CLIENT_CHOICE`; same prohibitions); `ProfessionalEmpanelled` and `ProfessionalSuspended` consumers add LD; `POST /v1/conflicts/check` accepts LD as client with categories `CONSUMER_HELP_ADVERSE` and `LENDER_CLIENT` (flags and counts only). `TenantProvisioned.product` adds `LAWDOCS`; LD implements `PUT /v1/provisioning-requests/{id}`, `GET /v1/tenants/{tenantid}/provisioning-status`, `GET /v1/entitlements?tenant=` and produces `UsageRecorded`, `ModuleAttached`, `ModuleDetached`, `ReleasePublished`, `ControlEvidenceCollected`, `AccessReviewCompleted` (PLATFORM) and portability events on the same terms as Finbyx and Udofin. LD is registered as caller of `POST /v1/crm/requests`, `POST /v1/crm/leads`, `POST /v1/crm/activities` (commercial-only classifier plus matter-term block list), `POST /v1/support/tickets` and the OH7 asset-library upload [OWNER: OH7 path and `crm/leads` field set; LawDocs OI-Y-10]. The OH v1.0 adapter-table entry "`ESignProvider`: LawDocs eSign (group)" is replaced by principle 15: group companies sign MSAs, DPAs and HR letters as LawDocs customers in their own LD tenants (hosted ceremony) with document and evidence references returned to OH.

- **Directory limits (BCI Rule 36; Advocates Act s.35):** the directory publishes only the Schedule fields; no ratings, badges, success rates, fees, testimonials or paid placement, and neutral ordering everywhere it is shown. The RE's panel approval, fee schedule and internal scorecard stay in the RE's tenant (Finbyx R11); the RE alone allocates.
- `TenantProvisioned` is idempotent on `provisioning_request_id`, and a product holds at most one live tenant per `(org_id, product, environment)`; the product creates the tenant, registers it in the tenant map and reports readiness by `PUT /v1/provisioning-requests/{id}`; OH uses the status API only as a fallback poll. A PRODUCTION request without the MSA, DPA and OUT clause-matrix refs is rejected by the product with `regulatory-guard`.
- Support tickets never carry borrower or member data; where diagnosis needs tenant data, support uses the product's break-glass procedure (4.6), visible to the tenant.

## 6.30 Insurance distribution (`insurance`; Udofin ↔ insurer only)

Udofin Part 7F (XP2). These events flow **only between Udofin and the insurer or IRDAI-registered partner**, under a separate consent per product purpose (default No), and never reach REs, Finbyx, LawDocsComply or the Operations Hub except as counts. No insurance module is enabled until the licence model is approved and registered (Udofin Appendix B: models A–D); Udofin earns nothing for distribution unless it holds the registration that permits it [VERIFY: Insurance Act s.40 as amended in 2025].

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `InsuranceQuoteRequested` (N11) | UD → INS | Customer requests quotes after needs capture | quote_request_id, product line, needs-record ref, identity data under a consentref naming the insurer, seller-tagging data | UD journey; insurer quotes | quote_request_id | Per insurer agreement |
| `PolicyIssued` (N11) signed | INS → UD | Insurer issues the policy | insurer, policy_no, line, premium, term, document refs and hashes, seller tag | Insurer | (insurer, policy_no) | Per insurer agreement |
| `ClaimAssistanceRequested` (N11) | UD → INS | Policyholder or nominee asks for claim help | claim_assist_id, policy_no, claim type, event date, documents, payee is the policyholder's or nominee's own account, consentref | UD request; insurer decides | claim_assist_id | Forwarded ≤ 1 working day [REC] |

- Premiums go directly to the insurer; Udofin never collects, holds or nets them. No bundling of insurance with a loan (RBC Second Amendment, 15 June 2026, effective 1 January 2027); credit-linked cover appears only as the RE's optional KFS item (model D).
- Insurance complaints are routed to the insurer's grievance channel and the Insurance Ombudsman, separately from loan grievances (6.12) [VERIFY: current IRDAI grievance portal].

## 6.31 Legal work (`legal`) *(v1.2, from LD App. Y)*

LawDocs P19 and Appendix I; LawDocsComply P26 (projection). **Routing rule.** `legal` events are **organisation-internal**: they reach only the same organisation's tenants in other products under `legal_sor_link` or `finbyx_legal_link`; never the Operations Hub, never another organisation, never Equator except as documents inside a referral pack, never Consumer Help. Gateways refuse other subscriptions at registration. All rows carry `productfamily = na` and `reid = none` unless an RE tenant's own record is concerned.

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `AgreementExecuted` (N12) signed | LD → LDC; FX (if linked to a recovery case) | Formalities gate passed | agreement id, business ref, type, parties (pseudonymous refs and roles), executed_at, document ref and sha256, stamp refs, dispute clause | LD | (agreement_id, version) | std |
| `AgreementAmended` (N12) | LD → same | Amendment executed | agreement id, amendment ref, effective date, document ref | LD | (agreement_id, version) | std |
| `AgreementTerminated` (N12) | LD → same | Termination or expiry recorded | agreement id, reason class, effective date | LD | (agreement_id, version) | std |
| `ContractObligationRegistered` (N12) | LD → LDC | Obligation created or extracted and confirmed | obligation id, agreement id, type, owner position, due rule, next due | LD | (obligation_id, version) | std |
| `ContractObligationStatusChanged` (N12) | LD → LDC | Status change (DUE, MET, BREACHED, WAIVED) | obligation id, status, evidence ref | LD | (obligation_id, seq) | std |
| `LegalMatterOpened` (N12) | LD → LDC | Matter created | matter id, business ref, type, risk rating, claim amount band | LD | matter_id | ≤ 1 working day |
| `LegalMatterUpdated` (N12) | LD → LDC | Material change (risk, amount, counsel, status) | matter id, changed fields, contingent-liability band | LD | (matter_id, seq) | ≤ 1 working day |
| `LegalMatterClosed` (N12) | LD → LDC | Closure | matter id, outcome class, amount | LD | matter_id | ≤ 1 working day |
| `CourtCaseRegistered` (N12) | LD → LDC | Case added (CNR, number, aggregator match) | case id, forum, court, case type, number, CNR, role, source, as_of, linked litigation_case ref | LD | court_case_id | ≤ 1 working day |
| `CourtCaseUpdated` (N12) | LD → LDC | Stage, status or next date change | case id, stage, next date, source, as_of | LD | (court_case_id, seq) | ≤ 1 working day |
| `CourtHearingScheduled` (N12) | LD → LDC | Next date recorded | case id, date, purpose, source | LD | (court_case_id, date) | Same day |
| `CourtOrderRecorded` (N12) signed | LD → LDC | Order added and verified by the user | case id, order type (`order` code table, #25), directions with due dates, document ref and sha256 | LD | (court_case_id, order_id) | ≤ 1 working day |
| API `GET /v1/legal-matters?updated_since=`, `GET /v1/court-cases?updated_since=`, `GET /v1/contract-obligations?updated_since=` (N12+) | LDC → LD | Reconciliation and pull | projections by scope | LD | n/a | p95 ≤ 800 ms |
| API `GET /v1/agreements/{id}` (N12+) | LDC, FX (linked) → LD | Display | projection by scope; documents by reference | LD | n/a | p95 ≤ 800 ms |

## 6.32 Signing and stamping — the eSign hosted hand-off (`esign`) *(v1.2, from LD App. Y)*

`ESignCompleted` and `EStampCompleted` (6.2, UD → FX) are unchanged and remain the loan-journey evidence events; LD never produces them. The `esign` domain is used only when an organisation uses LawDocs, **as its own customer**, to execute a document requested from another of its products under `signing_handoff_link` (principle 15). The requesting product never receives signing URLs, ESP credentials, consent payloads or ESP request XML; the ceremony runs on LawDocs hosts (`frame-ancestors 'none'`); the requester receives status and evidence by document reference. Instrument eligibility (IT Act First Schedule, Registration Act s.17) and stamping (Indian Stamp Act 1899 ss.17, 35 and State Acts) are checked by LawDocs before any ESP call [LAW].

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| API `POST /v1/signing-requests` (N12+) | Requesting product (e.g., FX, LDC, OH for Infrabyx's own contracts) → LD | Create a LawDocs-hosted signing request in the organisation's own LD tenant | document ref and sha256, signer refs and methods, order, deadline, link ref; returns signing_request_id and status (no signing URLs to the caller) | LD | Idempotency-Key | ≤ 2 s; eligibility result ≤ 5 s |
| API `GET /v1/signing-requests/{id}` (N12+) | Requester → LD | Status | status, signer statuses, evidence-pack ref when complete | LD | n/a | p95 ≤ 800 ms |
| API `POST /v1/signing-requests/{id}/withdrawal` (N12+) | Requester → LD | Withdraw before completion | reason | LD | Idempotency-Key | ≤ 2 s |
| `SigningRequestCreated` (N12) | LD → requester | Eligibility passed and invitations sent; or WET_INK_REQUIRED returned | signing_request_id, `instrument_eligibility_result`, rule version | LD | signing_request_id | std |
| `SigningRequestCompleted` (N12) signed | LD → requester | All signatures applied and validated | signing_request_id, document ref and signed sha256, ESP transaction ids, certificate summary, `signing_method` per signer, evidence-pack ref; never consent logs or ESP request XML | LD | (signing_request_id, version) | std |
| `SigningRequestDeclined` (N12) | LD → requester | A signer declined | signing_request_id, signer ref | LD | (signing_request_id, signer_ref) | std |
| `SigningRequestExpired` (N12) | LD → requester | Deadline passed | signing_request_id | LD | signing_request_id | std |
| `SigningRequestWithdrawn` (N12) | LD → requester | Withdrawn by requester or tenant | signing_request_id, actor class | LD | signing_request_id | std |
| `StampInstrumentVerified` (N12) signed | LD → requester | Stamp certificate attached and UIN verified | stamp id, State, article, duty, certificate no, `stamp_verification_method`, linked document sha256 | LD | (stamp_id, version) | std |

**Hand-off state machine** (subject = `signing_request_id`): CREATED → ELIGIBILITY_CHECKED (ELIGIBLE or WET_INK_REQUIRED, terminal) → STAMP_VERIFIED (chargeable instruments) → INVITED → PARTIALLY_SIGNED → COMPLETED; from any non-terminal state → DECLINED, EXPIRED or WITHDRAWN. A chargeable instrument without a verified `stamp_instrument` cannot reach INVITED; a stamp verification failure (UIN not found, duty short, certificate mismatch) ends the request as WITHDRAWN with `actor class = SYSTEM` and `reason = STAMP_VERIFICATION_FAILED` in `SigningRequestWithdrawn`, and the requester may create a new request after correction *(v1.2 rev. 26 Oct 2026)*. A document whose sha256 at `POST` does not match the referenced document is refused at CREATED with `schema-validation-failed` and never reaches ELIGIBILITY_CHECKED. Concurrency: a second `POST` with the same idempotency key returns the stored request; a withdrawal racing a final signature resolves in LawDocs by ESP timestamp and the loser is reported as `state-transition-invalid`. Rollback: withdrawal leaves evidence of the partial ceremony in LawDocs only; the requester marks its own document UNSIGNED.

## 6.33 IP assets and engagements (`ip`, `engagement`) *(v1.2, from LD App. Y)*

| Event or API | Producer → consumer(s) | Trigger | Key payload fields | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|
| `IpAssetRegistered` (N12) | LD → LDC (opt-in, organisation-internal) | Asset added | asset id, type, office, application number, classes, status, source | LD | ip_asset_id | std |
| `IpAssetStatusChanged` (N12) | LD → LDC | Status change | asset id, status, next deadline type and date, source, as_of | LD | (ip_asset_id, seq) | std |
| `EngagementCreated` (N12) | LD → OH | Engagement confirmed | engagement id, org_id or tenant, service SKU, `supplier_type`, SLA tier, value (money), start; never scope text, matter or party data | LD | engagement_id | std |
| `EngagementStatusChanged` (N12) | LD → OH | Status change (ACTIVE, ON_HOLD, COMPLETED, CANCELLED) | engagement id, status, effective_at | LD | (engagement_id, seq) | std |
| `RetainerActivated` (N12) | LD → OH | Retainer SLA executed | retainer id, engagement refs, term, hour bank, SLA document ref (hash only) | LD | retainer_id | std |
| `RetainerEnded` (N12) | LD → OH | Term end, termination or non-renewal | retainer id, reason class, effective_at | LD | retainer_id | std |

Engagement events are commercial-adjacent records under `INTERNAL`; OH8 continues to own orders, invoices and payments (6.27).

## 6.34 Trust and vendor assurance publication (`trust`) *(v1.2)*

IPB-08 (Vendor Assurance Room and Trust Centre); Operations Hub OH14.6; every product's Settings › Security & trust › Vendor documents and public Trust Centre. **Contract.** OH14.6 is the **system of record** for every vendor-assurance document (`vad_`, entity 57): certificates, audit reports, affidavits, DPAs, policies, accessibility statements, exit runbooks, BOMs. Products hold **read-only mirrors** created and updated only by `VendorAssuranceDocumentPublished` and `VendorAssuranceDocumentStateChanged`; a mirror stores the metadata and the `sha256`, fetches the file through the `TRUST` port (`GET /v1/trust/documents/{vad_id}/file`, signed India-hosted URL ≤ 15 min) on first tenant request, verifies the digest (`mirror-digest-mismatch` and `in.[product].trust.MirrorDigestMismatch.v1` on failure) and shows the document to the tenants named by `visibility` and `publication_targets`. Nothing in a mirror is editable; a product with no OH connection serves its last verified mirror with an "as of" stamp. Acknowledgements, pack exports and requests flow **back** to OH so that OH14.6 holds the audit trail. Documents never carry tenant data; `dataclass` is `PUBLIC` or `INTERNAL`.

| Event or API | Producer → consumer(s) | Trigger | `data` fields (type) | `dataclass` / consent | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|---|
| `VendorAssuranceDocumentPublished` (N12) (IPB) | OH (OH14.6) → every product (`publication_targets`) | A document is published or a new version supersedes one | `vad_id` (id), `title` (string), `category` (`vad_category`), `cadence` (MONTHLY, QUARTERLY, HALF_YEARLY, ANNUAL, EVENT), `valid_from`, `valid_until` (date), `version` (int), `storage_ref` (string), `sha256` (hex), `visibility` (`vad_visibility`), `publication_targets[]` (`product`), `nda_required` (bool), `summary` (string ≤ 500), `supersedes_vad_id?` | PUBLIC or INTERNAL; no consent (no personal data) | OH | (vad_id, version) | ≤ 15 min |
| `VendorAssuranceDocumentStateChanged` (N12) (IPB) | OH → every product | Superseded, expired, withdrawn, gating or publication targets changed | `vad_id`, `version`, `state` (PUBLISHED, SUPERSEDED, EXPIRED, WITHDRAWN), `visibility`, `publication_targets[]`, `reason_code`, `changed_at` | INTERNAL | OH | (vad_id, version, state) | ≤ 15 min; WITHDRAWN hides the mirror within 60 s |
| `VendorAssuranceDocumentAcknowledged` (N12) (IPB) | Every product → OH | A tenant acknowledges a document or exports an evidence pack | `vad_id`, `version`, `tenantid` (hashed), `product`, `action` (VIEWED, ACKNOWLEDGED, PACK_EXPORTED, NDA_ACCEPTED), `pack_id?`, `preset?`, `acknowledged_by_role`, `occurred_at` | INTERNAL; tenant staff action under the tenant's contract (`legalbasis = CONTRACT_PERFORMANCE_VENDOR`); never a user name | Product | (vad_id, version, tenantid, action, occurred_at) | ≤ 1 h |
| `VendorAssuranceRequestOpened` (N12) (IPB) | Every product → OH (OH6 support queue) | A tenant requests a document not published to it | `vadr_id`, `tenantid` (hashed), `product`, `requested_type` (`vad_category`), `justification_class` (AUDIT, ONBOARDING, REGULATOR, RENEWAL), `sla_due_at` | INTERNAL | Product | vadr_id | ≤ 15 min; OH answers per support SLA |
| `AuditorGrantChanged` (N12) (IPB) | Product ↔ OH | An auditor grant to the room is created, approved, revoked or expires (4.7 pattern) | `vadg_id`, `tenantid` (hashed), `product`, `grantee_org_hash`, `scope[]` (`vad_category`), `state` (CREATED, APPROVED, REVOKED, EXPIRED), `starts_at`, `ends_at` (≤ 90 days) | INTERNAL | Granting system | (vadg_id, state) | ≤ 1 h |
| `ClaimRegisterChanged` (N12) (IPB) | OH (OH14 Claims Register) → every product's CMS and Vidhi | A claim (certification, award, security statement) is added, changed, flagged or retired | `clm_id`, `claim_text_hash`, `status` (ALLOWED, BLOCKED, RETIRED), `scheme`, `scope`, `evidence_vad_id?`, `effective_at` | PUBLIC | OH | (clm_id, status, effective_at) | ≤ 15 min; CMS re-runs `GET /v1/claims-gate/check` on affected pages |
| API `GET /v1/trust/documents?updated_since=` (N12+) | Product → OH | Mirror reconciliation (daily) | metadata rows as `VendorAssuranceDocumentPublished` | INTERNAL | OH | n/a | p95 ≤ 800 ms |
| API `GET /v1/trust/documents/{vad_id}/file` (N12+) | Product → OH | File fetch for a mirror | signed URL ≤ 15 min, sha256 | per `visibility` | OH | n/a | p95 ≤ 800 ms |

Mirror state machine (per `vad_id`): ANNOUNCED → FETCHED → VERIFIED → VISIBLE; → STALE (no OH contact for 7 days; banner), → SUPERSEDED, → HIDDEN (WITHDRAWN or visibility narrowed). Failure: digest mismatch keeps the previous VERIFIED version visible and raises `mirror-digest-mismatch`; concurrency: two `Published` for the same `vad_id` resolve by `version` then `seq`; rollback: `WITHDRAWN` plus re-publish of the previous version.

## 6.35 Tenancy, brands and white-label (`tenancy`) *(v1.2)*

Operations Hub OH4 and OH8; product Brand Studios (IPB-04); DNS_CDN automation. Rules in 5.4.

| Event or API | Producer → consumer(s) | Trigger | `data` fields (type) | `dataclass` / consent | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|---|
| `WhiteLabelTenantProvisioned` (N12) (IPB) signed | OH (OH4, after maker-checker) → owning product (FX, UD), OH8 (billing), OH3 (CRM), OH6 (support), DNS_CDN automation | A `whitelabel_link` becomes active for a tenant and a published pack | `tenantid` (id), `brd_id` (id), `whitelabel_link_id`, `product`, `hosts[]` ({host, role}), `legal_entity_ref` (org_id), `operating_entity_ref`, `merchant_of_record` (PARTNER, INFRABYX), `plan_id`, `store_identity?` ({ios_bundle_id, android_package}), `email_domain`, `dla_ids[]?`, `reids[]?`, `provisioned_by` (role), `valid_from`, `valid_to` | INTERNAL; business particulars only; `legalbasis = CONTRACT_PERFORMANCE_VENDOR` for the partner admin contact if present | OH | (tenantid, brd_id, whitelabel_link_id) | ≤ 15 min; host verification and certificate issuance start at once |
| `WhiteLabelTenantExited` (N12) signed | OH → same | `whitelabel_link` ends (termination, non-renewal, regulatory instruction) | `tenantid`, `brd_id`, `whitelabel_link_id`, `reason_class`, `effective_at`, `redirect_until` (date; ≥ 90 days), `tenant_election` (CONTINUE_DEFAULT_BRAND, EXPORT), `store_identity_disposition` (TRANSFER, WITHDRAW) | INTERNAL | OH | (whitelabel_link_id, effective_at) | ≤ 15 min; writes under the brand stop at `effective_at`; data untouched |
| `BrandPackPublished` (N12) | Owning product's Brand Studio → OH (host registry, billing documents, CRM), DNS_CDN automation, sibling products serving the same `org_id` (display name only) | A pack revision is published or rolled back | `brd_id`, `product`, `revision_id`, `action` (PUBLISHED, ROLLED_BACK), `hosts[]`, `app_name`, `legal_entity_ref`, `email_domain`, `terminology_override` (map), `contrast_guard_passed` (bool), `policy_set_id`, `published_at` | PUBLIC (what a visitor sees) | Owning product | (brd_id, revision_id, action) | ≤ 5 min |
| API `GET /v1/brand-packs/{brd_id}` (N12+) | Any product or OH → owning product | Read the published shared shape (5.4) | shape `tenancy/brand_pack/1.0.0` | PUBLIC | Owning product | n/a | p95 ≤ 800 ms |
| API `PUT /v1/hosts/{host}` (N12+) | Owning product → OH host registry | Reserve or release a host group-wide before publish | host, role, brd_id, product; 409 `state-transition-invalid` if held by another pack | INTERNAL | OH | Idempotency-Key | ≤ 2 s |

## 6.36 Vidhi cross-product delegation (`vidhi`) *(v1.2)*

IPB-03 (kernel, autonomy, locked list); 4.9 (contract and state machine). Only read skills until the `vidhi.a2a.enabled` ADR.

| Event or API | Producer → consumer(s) | Trigger | `data` fields (type) | `dataclass` / consent | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|---|
| `VidhiTaskDelegated` (N12) (IPB) | Source product's Vidhi → target product (`to_product`); copy of metadata to OH13 only when `to_product = OH` | A mission needs data or action from another product; or `action = CANCEL` | `dtask_id` (id), `msn_id` (id), `from_product`, `to_product` (`product`), `task_type` (registered skill key in the target's capability floor), `action` (REQUEST, CANCEL), `tenantid_source`, `org_id`, `requested_by` (pairwise ref), `autonomy_ceiling` (L0–L4; L0–L1 until ADR), `due_at` (≤ 7 days), `inputs_ref` (URI resolvable only by the target with its scopes), `budget` ({tool_calls, cost_inr}), `attempt` (int) | Highest class referenced by `inputs_ref` (never REGULATED, SPI, HR, WELLNESS, CONSUMER_HELP); **`consentref` naming `to_product` and purpose `VIDHI_DELEGATION`, or `legalbasis`, mandatory** | Source Vidhi | (msn_id, task_type, to_product, attempt) | Ack by Accepted/Rejected ≤ 5 min |
| `VidhiTaskAccepted` (N12) | Target Vidhi → source | Manifest, consent, ceiling and locked-list checks passed; target task created | `dtask_id`, `target_task_id`, `autonomy_level` (effective, the lower), `skill_key`, `eta_at` | INTERNAL | Target Vidhi | (dtask_id, ACCEPTED) | ≤ 5 min |
| `VidhiTaskCompleted` (N12) | Target Vidhi → source | Target task completed | `dtask_id`, `target_task_id`, `outputs_ref` (URI; data blocks with provenance), `summary` (string ≤ 1,000; no personal data), `run_id`, `model_family`, `completed_at` | As inputs | Target Vidhi | (dtask_id, COMPLETED) | By `due_at` |
| `VidhiTaskRejected` (N12) | Target Vidhi → source | Any refusal, expiry or cancellation by the target | `dtask_id`, `reason` (`delegation_reason`), `detail_code` (problem code), `rejected_at` | INTERNAL | Target Vidhi | (dtask_id, reason) | ≤ 5 min |

## 6.37 Engineering and release communication (`eng`) *(v1.2)*

IPB-09 (release-notes pipeline, rollback, export maps); Operations Hub OH13. `ReleasePublished` (6.29) remains the deployment fact for CAB and evidence; the `eng` domain carries what customers and account managers read. Nothing here carries tenant data.

| Event or API | Producer → consumer(s) | Trigger | `data` fields (type) | `dataclass` / consent | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|---|
| `ReleaseNotePublished` (N12) (IPB) | Every product → OH (group changelog, account managers, status page), sibling products (What's new cards, tutorial regeneration, IPB-07) | A release note is published through the IPB-09 pipeline | `rel_id` (id), `product`, `version` (semver), `channels[]` (`release_channel`), `audiences[]` (TENANT_ADMIN, END_USER, DEVELOPER, REGULATED), `regulatory_tags[]`, `summary` (≤ 500), `url`, `published_at`, `deprecations[]` ({api_version, sunset_at})? | PUBLIC | Product | (product, version, rel_id) | ≤ 1 h |
| `RolledBack` (N12) (IPB) | Every product → OH13 (status page, support awareness) | A production rollback completes | `product`, `from_version`, `to_version`, `change_id`, `reason_class`, `started_at`, `completed_at`, `tenant_impact` (NONE, DEGRADED, DATA_SAFE) | INTERNAL | Product | (product, from_version, started_at) | ≤ 15 min |
| `ExportMapBumped` (N12) (IPB) | Every product → OH (client communications), LDC `LDC_GROUP` (GRC evidence) | The product's export map version changes (IPB-09-34) | `product`, `map_version` (e.g. `LD-EXPORT-1.1`), `previous_version`, `changeset_ref`, `customer_note_url`, `effective_release` | PUBLIC | Product | (product, map_version) | ≤ 1 working day |

## 6.38 Content and CMS syndication (`cms`, `content`) *(v1.2)*

IPB-04 (blog, resources), IPB-07 ("i" glossary registry); Operations Hub OH7. Public content only; a gated resource travels as metadata and its gate is a `LeadCaptured` (6.39) on the consuming side. The claims gate (`GET /v1/claims-gate/check`) has run before any of these events is emitted.

| Event or API | Producer → consumer(s) | Trigger | `data` fields (type) | `dataclass` / consent | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|---|
| `BlogPostPublished` (N12) (IPB) | Every product's `apps/public` → OH7 (content calendar, social scheduling), sibling products (cross-links) | A post is published, updated or unpublished | `pst_id` (id), `product`, `brand_pack_id`, `title`, `slug`, `url`, `locale`, `author_type` (STAFF, USER), `author_display?` (only with the author's published-name consent), `tags[]`, `summary` (≤ 300), `published_at`, `action` (PUBLISHED, UPDATED, UNPUBLISHED), `ai_assisted` (bool), `claims_check_id` | PUBLIC; `author_display` only under the author's consent (`consentref`) | Product | (pst_id, action, published_at) | ≤ 15 min |
| `ResourcePublished` (N12) (IPB) | Every product's `apps/public` → OH7, LDC (knowledge base), sibling products | A resource (guide, template, checklist, whitepaper) is published or withdrawn | `res_id`, `product`, `brand_pack_id`, `title`, `type` (GUIDE, TEMPLATE, CHECKLIST, WHITEPAPER, WEBINAR), `url`, `locale`, `gated` (bool), `topics[]`, `regulatory_refs[]`, `published_at`, `action` (PUBLISHED, UPDATED, WITHDRAWN), `claims_check_id` | PUBLIC | Product | (res_id, action, published_at) | ≤ 15 min |
| `GlossaryEntryPublished` (N12) (IPB) | LDC (seed registry) and any product's "i" registry → every product's `hlp.*` registry | A shared legal or regulatory term is defined, revised or retired | `term_key` (`hlp.shared.[term]`), `locale`, `title`, `definition` (≤ 1,000), `regulatory_ref` ({instrument, clause, url}), `reviewer_of_record_role`, `version`, `status` (ACTIVE, RETIRED), `superseded_by?` | PUBLIC | Publishing product (LDC by default) | (term_key, locale, version) | ≤ 1 h; CI lint (IPB-07) accepts the shared key as resolved |

## 6.39 CRM, marketing consent and messaging (`crm`, `consent`, `messaging`, `workforce`) *(v1.2)*

IPB-04 (forms, CMP, marketing tooling), IPB-02-26 (consent propagation), IPB-01 WHATSAPP port; Operations Hub OH3 (CRM), OH7 (marketing), OH8 (messaging cost), OH10 (recruitment), the group WABA. **Consent rule.** Personal data of a prospect, applicant or data principal never travels in these events: payloads carry a hash and a `fields_ref` the consumer fetches through the producer's API with its scopes; every event carries the `consentref` the person gave (CMP, form or consent-manager artefact, entity 29) and the notice version. A `MarketingConsentUpdated` with `state = WITHDRAWN` stops marketing to that principal group-wide within 60 s. Borrower, member and loan data never appear (principle 12).

| Event or API | Producer → consumer(s) | Trigger | `data` fields (type) | `dataclass` / consent | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|---|
| `LeadCaptured` (N12) (IPB) | Every product's `apps/public` and in-product "talk to sales" → OH3 | A prospect submits a form, chat, pricing enquiry, webinar or gated-resource request | `lead_id` (id), `product`, `brand_pack_id`, `source` (`lead_source`), `contact_hash` (sha256 of normalised e-mail or mobile), `fields_ref` (URI; CONFIDENTIAL, fetched via API), `utm?` ({source, medium, campaign, content, term}), `page_url`, `interest` (plan, add-on or resource id), `captured_at`, `notice_version` | INTERNAL in the event; the referenced fields are PII; **`consentref` mandatory** (purpose `LEAD_CONTACT`) | Product (capture evidence); OH3 (CRM record) | lead_id | ≤ 15 min; sales response per OH3 SLA |
| `MarketingConsentUpdated` (N12) (IPB) | Every product, OH3 → OH7 (marketing), every product's ANALYTICS and TAG_MANAGER gates, messaging adapters | A principal grants or withdraws a marketing or analytics purpose (CMP, preference centre, unsubscribe link, consent manager) | `consent_id` (id), `principal_hash` (sha256), `purpose` (`marketing_purpose`), `state` (GRANTED, WITHDRAWN), `channel` (WEB_CMP, PREFERENCE_CENTRE, EMAIL_LINK, SMS_STOP, WHATSAPP_STOP, CONSENT_MANAGER, SUPPORT), `brand_pack_id`, `notice_version`, `occurred_at`, `expires_at?` | INTERNAL; the event **is** the consent evidence (`consentref` = `consent_id`); no name or contact in clear | Capturing product | (consent_id, state, occurred_at) | ≤ 60 s to every consumer [DPDP Act s.6; IPB-02-26] |
| `WhatsAppTemplateApproved` (N12) (IPB) | OH (template registry) and product WHATSAPP adapters → every product using the WABA, OH8 (cost category) | Meta approves, rejects, pauses or disables a template on a WABA | `template_name`, `waba_id`, `brand_pack_id`, `language`, `category` (`whatsapp_template_category`), `status` (APPROVED, REJECTED, PAUSED, DISABLED), `quality_rating?`, `approved_at`, `rejection_reason?`, `variables_schema` (JSON Schema of placeholders) | INTERNAL; marketing templates may be sent only to principals with `MarketingConsentUpdated` GRANTED for `MARKETING_WHATSAPP`; collections use barred (WhatsApp Business Messaging Policy; 4.4) | OH | (waba_id, template_name, language, status) | ≤ 15 min |
| `CareerApplicationReceived` (N12) (IPB) | Every product's `apps/public` careers page → OH10 (recruitment) | A candidate applies for an Infrabyx role | `application_id`, `product` (site), `brand_pack_id`, `role_id`, `candidate_hash`, `fields_ref` (URI; CV and contact fetched via API, `HR` class in OH10 only), `source`, `applied_at`, `notice_version` | INTERNAL in the event; referenced fields `HR`; **`consentref` mandatory** (purpose `CAREER_APPLICATION`) | Product (capture); OH10 (record) | application_id | ≤ 15 min |
| API `GET /v1/leads/{lead_id}/fields`, `GET /v1/career-applications/{id}/fields` (N12+) | OH3, OH10 → producing product | Fetch the referenced fields | fields as captured; deleted after OH confirms ingestion (≤ 30 days) | PII / HR | Product | n/a | p95 ≤ 800 ms |

## 6.40 Feedback and identity preferences (`feedback`, `identity`) *(v1.2)*

IPB-04 (feedback widget), IPB-06 and IPB-07 (preferences across products), IPB-09-46 (tenant beta programme); Operations Hub OH6 (support) and product backlog. Feedback never carries tenant customer data: screenshots are redacted (Aadhaar, PAN, account, card and mobile patterns rejected, as 6.29 tickets) and free text is PII-scanned before the event is emitted.

| Event or API | Producer → consumer(s) | Trigger | `data` fields (type) | `dataclass` / consent | Owner | Idempotency key | SLA |
|---|---|---|---|---|---|---|---|
| `FeedbackSubmitted` (N12) (IPB) | Every product (widget, help article, beta programme, accessibility report) → OH (product backlog, OH6 support; SECURITY category to OH13 only) | A user submits feedback | `fbk_id` (id), `product`, `tenantid` (hashed), `module`, `surface` (WIDGET, HELP_ARTICLE, BETA, A11Y, VIDHI), `flag_key?`, `release?`, `severity` (S1–S4), `category` (`feedback_category`), `summary` (≤ 500, PII-scanned), `attachments_count`, `a11y_sla_due_at?`, `submitted_by_role`, `contact_ok` (bool) | INTERNAL; `contact_ok` is the user's consent to be contacted (`consentref`); otherwise no reply path | Product | fbk_id | ≤ 15 min; S1 and ACCESSIBILITY per OH6 SLA |
| `FeedbackStatusChanged` (N12) (IPB) | OH → originating product (widget status, What's new) | Triage, planned, shipped, declined | `fbk_id`, `status` (RECEIVED, TRIAGED, PLANNED, SHIPPED, DECLINED, DUPLICATE), `linked_rel_id?`, `public_note?` (≤ 300), `changed_at` | INTERNAL | OH | (fbk_id, status, changed_at) | ≤ 1 h |
| `UserPreferencesSynced` (N12) (IPB) | The product where a person changes preferences → every product where the same shared identity exists (group staff via the Infrabyx IdP; same-organisation customers only after the 4.4 token-exchange link exists) | Appearance, notification, language or accessibility preference changed | `principal_pairwise_ref`, `preference_set` (APPEARANCE, NOTIFICATIONS, LANGUAGE, A11Y), `preferences` (map of `a11y.*`, `ui.*`, `notif.*` keys → values; no free text), `source_product`, `version`, `changed_at` | INTERNAL; the person's own settings; opt-in toggle "apply my preferences across Infrabyx products" is the `consentref` | Source product | (principal_pairwise_ref, preference_set, version) | ≤ 60 s |
| `UserDeactivated` (N12) (IPB) | Infrabyx IdP / OH10 (staff); the organisation's own IdP via SCIM is unchanged → every product's staff realm | A group staff identity is deactivated outside the SCIM cycle (emergency) | `principal_pairwise_ref`, `reason_class` (LEAVER, SECURITY, SUSPENSION), `effective_at`, `privileged` (bool) | INTERNAL | OH10 | (principal_pairwise_ref, effective_at) | Privileged ≤ 1 h, others ≤ 4 h (4.2); sessions end ≤ 60 s after receipt |

---

# 7 — PRODUCT LIFECYCLE DATA-SHARING MATRIX

## 7.1 Common rules

Origination flows Udofin → RE; decisions, documents and servicing flow back to Udofin's read-only mirror. Collateral authority is always the RE's: Udofin orchestrates borrower steps and displays RE values, never accepts, invokes or releases. Recovery data reaches Udofin only as the RE-permitted LSP projection; Udofin relays `SettlementRequested` and captures `SettlementOfferAccepted` evidence but never approves, refers, issues notices in its own name or holds funds. Project finance, loans to entities (CORP), staff loans (STAFF) and demand loans (DCL) are not Udofin products; consumer durable (CD) follows the Personal row with DISB-E to the merchant. **Non-RE lenders** (credit co-operative societies) use the same contracts with `lender_type = NON_RE_SOCIETY` (6.24): they never co-lend with, sell loans to or buy loans from NBFCs (TDCR paras 7, 12(4), 97), never appear in the RE multi-lender offer view, take deposits only from active voting members and are never marketed for deposits on Udofin, and their members see the Registrar or co-operative forum route, never the RBI Ombudsman.

## 7.2 Matrix

| Product | Origination (UD → FX) | Decision and documents | Collateral creation | Disbursement | Servicing | Collections | Recovery and ADR | Reconciliation |
|---|---|---|---|---|---|---|---|---|
| Personal, payday | AA income ref, CF para 8 data, household (para 51), OTP e-KYC declaration | KFS validity at least 3 working days, or 1 working day if tenor under 7 days (RBC para 29(2)) | None | To borrower; cooling-off exit | Standard | If appointed: agent notice, 08:00–19:00 (RBC para 100) | LRN; s.25 PSS or s.138; conciliation, Lok Adalat; arbitration only with valid basis (8.2) | Cooling-off exits; DLG |
| MSME, business | GST, AA, Udyam refs; guarantor KYC; CGTMSE flag (blocks DLG, CF para 21(1)) | Covenants | `CollateralChargeRegistered` (CERSAI, CGTMSE) | Borrower or supplier | Covenants in FX | Standard | SARFAESI if eligible; suit after s.12A mediation (≥ ₹3 lakh); IBC s.7 (≥ ₹1 crore), PG s.95; CGTMSE claim as `CollateralInvoked` | CGTMSE fees and claims |
| LAP | Property refs | Legal, technical, valuation via `VerificationRequested`; physical mortgage | Mortgage, CERSAI | Borrower or prior lender | Standard | Standard | SARFAESI for notified NBFCs, CERSAI-registered (s.26D); auction events; arbitration for money claims only (*Booz Allen*) | CERSAI vs register; release ≤ 30 days (RBC para 35) |
| Home | Stage documents; builder or seller as beneficiary | As LAP; housing tests (CF para 4(1)(xiv)) | Mortgage, CERSAI | TRANCHE vs stage | Interest certificates | Standard | As LAP; HFCs registered under NHB Act s.29A are notified FIs under SARFAESI s.2(1)(m)(iv) (notification of 17 June 2021) without the NBFC ₹20 lakh floor (*Virendra Rathore v Tehsildar*, MP HC, 22 May 2024) [VERIFY: S.O. number] | Tranches vs stage |
| Vehicle | Dealer invoice, Vahan refs | Standard | `CollateralChargeRegistered` (VAHAN) | Dealer | Insurance reminders | Standard | Repossession only after notice period with signed possession memo (RBC para 26; *Hari Dutta Sharma v State of UP*, SC, 16 Sep 2026); Form 36 (MV Act s.51(5)); auction | Vahan NOC on closure |
| Gold | Leads and branch-appointment scheduling only (gold handled and stored only in RE branches by RE staff: RBC paras 53–54) | Branch assay | `CollateralValuationUpdated` (ASSAY), `CollateralPledgeCreated` | Borrower | Daily LTV (CF paras 43–44) | Standard | Notice; reserve ≥ 90% (85% after two failures); first auction physical in district; no lender bids (RBC paras 60–66); surplus ≤ 7 working days | Vault vs pledge book; release ≤ 7 working days, ₹5,000/day after (RBC paras 58, 69) |
| LAS, LAMF | `CollateralHoldingsShared`, OTP evidence | DP and haircuts from FX | Pledge requested → created (gate) | INITIAL, then DRAWDOWN | Daily valuation; margin calls | Standard | `CollateralInvoked` by RE only | Pledge book vs depository or RTA (7.3) |
| Microfinance | Household, income, obligations (CF paras 51–57) | 50% household cap; loan card (RBC paras 78–80) | None | Borrower | Meeting schedule | 09:00–18:00 until 31 Dec 2026 (RBC para 91(2)); visits after two missed appointments (para 90); then per RBC Third Amendment [VERIFY: MFI window] | Conciliation, Lok Adalat | Household-cap breaches; income to CICs (CF para 54) |
| Microfinance group (JLG, SHG) | One `ApplicationSubmitted` per member (`productfamily = MFI`) with household income and obligations; group captured in Udofin assisted tools and recognised only on the lender's `GroupFormed` | Per-member sanction; 50% household cap; vernacular KFS and loan card (RBC paras 78–80); joint liability voluntary | None | Cashless to each member's own account | Centre meetings at the designated place (RBC para 90) at the member-chosen frequency (CF para 59); `CentreMeetingHeld` | UPI QR per member by default; cash at meetings on Udofin-sourced loans only with the RE's legal opinion (CF paras 10(2), 10(5)); `GroupCollectionPosted` same day; 09:00–18:00 until 31 Dec 2026, then the RBC Third Amendment pack (RBI/2026-27/230) | No pressure on co-members or relatives and no public naming (RBC para 91); conciliation, Lok Adalat | Centre receipts vs postings vs cash-in-transit vs bank; MFI bureau file only (6.19) |
| Supply chain, TReDS | Anchor, invoice, factoring-unit ids | Programme limit | Receivable assignment (platform files with CERSAI) | Seller | Buyer pays on due date | Against buyer | TReDS units without recourse to the MSME; no buyer set-off (TReDS Directions 2026, RBI/DPSS/2026-27/406) | Settlement vs due date; revolving behind flag [VERIFY: August 2026 draft] |
| Education | Institution, course dates, co-borrower | Standard | Optional | TRANCHE to institution | Moratorium via `ScheduleChanged` | Co-borrower rules | s.25 PSS or s.138, suit, conciliation | Disbursals vs fees |
| Specialist (RF, MED, LEF, DR; feasibility-gated) | As Personal plus end-use evidence; RF and DR: settlement evidence (`ADROutcomeRecorded`) or payoff letter | Feasibility note first; same-RE refinance is restructuring and needs a viability assessment (RSA paras 89, 169) | None, or as refinanced facility | End-beneficiary only: provider, counsel, settled creditor or existing lenders (CF para 10(1)) | Standard | Standard | As Personal; RF and DR carry the restructuring flag | Payoffs vs creditor confirmations |
| Project finance | Not Udofin | Gates (CF paras 67–75) | Common security | LIE-certified stages (para 75) | DCCO via `ScheduleChanged`; database ≤ 15 days (paras 77–78) | Lead lender | ICA votes (RSA paras 31–33); credit events to consortium (para 107); SARFAESI needs 60% by value (s.13(9)); IBC | Shares vs common agreement |
| Co-lent (any) | KFS item 5; single point of interface (TDCR paras 105–106) | Irrevocable back-to-back (para 112) | Joint security | Escrow only (para 117); split ≤ 15 days | Receipt allocation; classification T+1; own-share CIC reporting (para 122) | Servicer RE per CLA | Each RE settles its share (RSA para 16); SARFAESI 60% by value; transfer only under Part A with mutual consent (para 125); no LSP escrow role | Escrow three-way daily |
| Co-operative society member loan (non-RE lender) | Membership verified (`GET /v1/societies/{id}/members/{ref}`) or applied for; `MemberAdmitted` gate; `ApplicationSubmitted` with `lender_type = NON_RE_SOCIETY`; web and assisted channels only [VERIFY: app-store policy] | Society credit committee under its bye-laws; sanction letter and KFS-equivalent disclosures by contract (Udofin UP4) | Share lien and sureties per bye-laws; never on the security of the society's own shares (MSCS s.66(1)) | Society account to the member's own account; share top-up before disbursal (`ShareCapitalPosted`) | Standard; deposit balances only as opt-in read-only display | Society staff or contracted agents under RE-equivalent conduct rules; 08:00–19:00, or 09:00–18:00 for collateral-free loans to households with income up to ₹3 lakh [REC] | Statutory forum under the society's Act (MSCS s.84; MH MCS Act ss.91, 101); Equator conciliation only on the society's referral with post-dispute consent and counsel's confirmation; no RB-IOS | Share capital and receipts vs society ledger; co-lending, transfer or DLG with any NBFC rejected (`regulatory-guard`) |

## 7.3 LAS and LAMF lifecycle

**Authority.** Finbyx (or the RE's certified LMS) owns the security master, haircuts, DP, LTV, margin calls, freezes, invocation and release; the depository or RTA is external truth for the encumbrance. Udofin shows indicative eligibility, orchestrates consent and OTP, displays RE values and captures cure intents. The RE (pledgee) contracts with the DPs, CDSL LAS API, NSDL e-pledge and the RTA or MF Central [VERIFY: direct or via aggregator]; Udofin runs borrower steps under the RE's credentials.

**Correction to `las.txt` (15 Oct 2026).** The proposal puts an "LAS risk / DP engine" (BE-11) in Udofin to compute eligible collateral, DP, shortfalls and the drawable amount. Not adopted: DP, LTV and margin actions are RE credit-risk decisions that cannot be outsourced to an LSP (OUT para 15; CF para 6(7)), so the engine runs in Finbyx; Udofin's BE-09 to BE-11 become a cached RE haircut table, a pledge-OTP orchestrator and a margin-call presenter, and the drawable amount comes from `GET /v1/facilities/{loan_id}/summary`. Its other controls (no shadow ledger, settlement proof before posting, idempotent money commands, three-way reconciliation) are adopted.

**States.** Pledge: `REQUESTED → PENDING_BORROWER_OTP → PENDING_DP_APPROVAL → ACCEPTED → CONFIRMED`, then `CLOSURE_REQUESTED → CLOSED` or `INVOCATION_REQUESTED → INVOKED`; failures `REJECTED`, `EXPIRED`, `FAILED`. Margin call: `OPEN → CURED`, or `OPEN → LAPSED → INVOCATION_REVIEW → INVOKED or WAIVED_BY_RE_AUTHORITY`.

| Step | Events and APIs | Rule and clock |
|---|---|---|
| 1. Holdings from CDSL LAS (eSign consent), NSDL statement, RTA or MF Central (OTP) | `ConsentRecorded`, `CollateralHoldingsShared` | Consent names RE and purpose (CF para 13) |
| 2. Indicative value = Σ units × price × (1 − haircut), capped | Haircut version in `ProductCatalogPublished`; eligibility-quote API | Labelled indicative; Group 1 only for capital-market loans above ₹5 lakh; no own shares; IPO ≤ ₹1 crore; no primary-gold-backed units (CF paras 104, 105, 106(2)(i), 35(2)) |
| 3. Application, sanction, KFS, signing | `ApplicationSubmitted`, `DecisionMade`, `KFSIssued`, `ESignCompleted` | RE decision (OUT para 15) |
| 4. Pledge or lien: borrower OTP; CDSL DP approval same day with reasons for rejection (CDSL/OPS/DP/POLICY/2026/468, 15 Jul 2026); NSDL pledgee acceptance; RTA lien for SOA units; depository pledge for demat units | `CollateralPledgeRequested`, `CollateralPledgeCreated` or `CollateralPledgeFailed` | Accepted NSDL pledge cannot be cancelled by pledgor; SEBI margin pledge (25 Feb 2020) is not an LAS rail |
| 5. Disbursement after sanction, documents, verified account, CONFIRMED pledge, sufficient DP | `LoanDisbursed` (INITIAL) | RE account to borrower (CF para 10(1)) |
| 6. Daily valuation on T-1 bhavcopy or AMFI NAV: DP = min(limit, eligible value after haircuts and caps); available = max(0, DP − utilised − reservations − dues); regulatory LTV = outstanding (principal, accrued interest and charges due) ÷ market value of pledged securities, tested separately from DP | `CollateralValuationUpdated` | Freeze drawdowns if prices > 1 business day old [REC] |
| 7. Drawdown via Udofin (FAPI 2.0) | `DrawdownRequested`, `LoanDisbursed` (DRAWDOWN) | Default term loan with DP-capped tranches; OD only behind `mod.las.revolving` pending the August 2026 draft CF amendment [VERIFY]; no automatic limit increase (CF para 8(2)) |
| 8. Margin call | `MarginCallRaised`, cure-intent API, `MarginCallCured` or `MarginCallLapsed` | Listed shares, NBFC assets ≥ ₹100 crore: 50% LTV at all times, cure in 7 working days (CF para 106(1)); others Board policy |
| 9. Invocation by RE after pre-invocation notice (ICA ss.176–177; SEBI circular 5 Feb 2026 [VERIFY]); DP invokes or RTA redeems to RE | `LegalNoticeIssued`, `CollateralInvoked`, `RecoveryReceiptPosted`, `SurplusRefunded` | Locked-in securities excluded; takeover and insider disclosures where triggered [VERIFY]; surplus to borrower |
| 10. Release on zero dues, no hold | `CollateralReleased`, `NOCIssued`, `LoanClosed` | ≤ 2 working days [REC] |
| 11. Corporate actions; quarterly pledged-share report to exchanges (CF para 106(2)(ii)); daily pledge reconciliation | `ReconciliationBreakRaised` | Quarterly; daily |

## 7.4 Daily reconciliation points

Applications sent vs acknowledged; KFS issued vs accepted in validity; disbursement UTRs (bank, Finbyx, mirror); RE collections vs allocation vs Udofin and agency receipts; collateral registers vs depository, RTA, Vahan, CERSAI, TReDS, vault; co-lending escrow three-way; DLG cover, invocations, shares and disclosure (CF para 28); LSP fees paid by the RE (CF para 10(4)); classification-sync timestamps; servicer remittances per transferee (TDCR paras 29–30, 41); legal status vs Equator and court feeds; settlements vs consent decrees (RSA para 100); from v1.1: centre-meeting receipts vs `GroupCollectionPosted` vs bank; share capital vs society ledger; deal state vs the RE's LSP register (OUT para 36); servicer collections held in trust vs remittances (SEC para 95); usage statements vs source events before invoicing; entitlements and module states as applied in each product vs those issued by OH8 (daily, `GET /v1/entitlements`); provisioning requests vs acknowledged tenants; bureau files submitted vs acknowledgements and rejections; return instances due vs filed.

---

# 8 — EQUATOR RESOLUTION (AND OTHER ODR/ADR PROVIDERS) INTEGRATION

## 8.1 Role and principles

Equator is an **independent ODR institution**, not an agent of the RE or Udofin; common Infrabyx ownership is disclosed in every case and Equator is structurally separate (company, staff, panel, database, fee ledger) [VERIFY: legal opinion on Fifth Schedule justifiable doubts]. The integration is **provider-neutral** through `OdrProvider` (8.9); no other surveyed provider publishes a lender API or webhook specification (public documentation reviewed October 2026), so file and portal fallbacks exist. **Only the RE refers:** `adr.referral:create` is never issued to an LSP, agency or borrower product; Udofin may suggest ADR and relay requests. *(v1.2, from LD App. Y)* From v1.2 LawDocs may create party-initiated referrals for non-loan disputes where its user is a party (6.9); in LawDocs, Equator is one provider behind the provider-neutral `ODR` port and is never default, pre-selected or mandatory; loan disputes remain referable only by the RE.

## 8.2 Referral rules and gates

**[LAW] Arbitration basis.** Refer only where the loan agreement names Equator or another independent institution, or the borrower gives written post-dispute consent (A&C Act s.7; electronic form, s.7(4)(b)). The RE never appoints, nominates or offers a curated list (*Perkins Eastman v HSCC* (2020) 20 SCC 760; *CORE v ECI-SPIC-SMO-MCML (JV)*, SC Constitution Bench, 8 Nov 2024). Referral to a non-agreed ODR institution with the borrower silent made the award a nullity (*L&T Finance v Jai Paras Material Store*, Cal HC, 14 May 2026); a named institution is not unilateral (*Sundaram Finance v Hanuman Prasad*, Raj HC, 2026); repeated appointment of one arbitrator breached s.12 and Fifth Schedule items 22 and 24 (*Shikha Ghosh v Axis Bank*, Del HC DB, 30 Sep 2026; next date 17 Nov 2026) [VERIFY: outcome and any RBI direction].

| Gate (RS, before `ADRReferralCreated`; logged) | Result | Source |
|---|---|---|
| Bank or notified FI, claim ≥ ₹20 lakh | Arbitration blocked; other ADR allowed | *Vidya Drolia* (SC, 14 Dec 2020) |
| Mortgage enforcement in rem | Arbitration blocked for that relief | *Booz Allen* (2011) 5 SCC 532 |
| IBC moratorium (ss.14, 96, 101) | All ADR on hold | IBC |
| Fraud or wilful defaulter | Board approval; criminal track continues | RSA paras 16(5)(ii), 97 |
| Proceeding pending | Settlement needs consent decree | RSA para 100 |
| Consumer complaint pending | Cannot compel arbitration | *Emaar MGF v Aftab Singh* (2019) 12 SCC 751 |
| Clause absent, unilateral or no institution | Post-dispute e-signed consent or s.11 petition; never auto-refer | *L&T Finance* |
| s.21 notice lacks service evidence at known addresses and email | Blocked | *Sedhram Nilkanth Muglikar v M.R. Makhare* (Bom HC, 2026) |
| Suit route ≥ ₹3 lakh, no urgent relief | s.12A mediation (3 + 2 months) first | Commercial Courts Act s.12A; *Dhanbad Fuels* (SC, 15 May 2025) |
| Retail, contactable | Conciliation or Lok Adalat first [REC] | A&C Act Part III; LSA Act |

**Process status (19 Oct 2026).** **Conciliation** is the default enforceable route: a s.73 settlement authenticated by the conciliator has arbitral-award status (s.74, s.30), enforceable under s.36; 30 days' silence rejects an invitation (s.62(4)). **Mediation Act 2023:** only ss.1, 3, 26, 31–38, 45–47, 50–54, 56–57 in force (S.O. 4384(E), 9 Oct 2023); Mediation Council established 27 Aug 2026; ss.4–25, 27–30 and 39–44 (incl. s.27 enforcement, s.30 online mediation) not in force (s.26 is in force), so a private mediated settlement is only a contract [VERIFY: e-Gazette each release]. **Lok Adalat** awards are deemed decrees, final (LSA Act s.21); Permanent Lok Adalat covers financial services only where notified, up to ₹1 crore [VERIFY: per state]; next National Lok Adalat 12 Dec 2026 [VERIFY]. **Arbitration:** pleadings ≤ 6 months (s.23(4)); award ≤ 12 months from pleadings + 6 by consent (s.29A); fast track 6 months (s.29B).

## 8.3 Case state machine

```
DRAFT(RE) → REFERRED → SCREENING → {RETURNED_FOR_INFO | SCREEN_REJECTED | ACCEPTED}
ACCEPTED → NOTICE_ISSUED → {SERVED | SERVICE_FAILED → RE_SERVICE(n) → COURT_SUBSTITUTED_SERVICE}
SERVED → TRACK{NEGOTIATION | CONCILIATION | MEDIATION | ARBITRATION | LOK_ADALAT_HANDOFF}
CONC/MED: INVITED → {CONSENTED | DECLINED | DEEMED_DECLINED(30d)} → NEUTRAL_APPOINTED → SESSIONS
          → {SETTLEMENT_PROPOSED → SETTLED | NON_SETTLEMENT}
ARB: APPOINTMENT_PENDING → DISCLOSURE_FILED → CHALLENGE_WINDOW → CONSTITUTED → PLEADINGS(6m)
     → HEARING | DOCS_ONLY → AWARD_SIGNED → AWARD_STAMPED → AWARD_SERVED → CORRECTION(30d)
     → CHALLENGE_WINDOW(3m+30d) → {FINAL | CHALLENGED}
SETTLED | FINAL → COMPLIANCE → {PAID → CLOSED | BREACH → ENFORCEMENT_REFERRED → CLOSED}
any → WITHDRAWN | TERMINATED | STAYED | MANDATE_EXPIRED → MANDATE_EXTENDED(s.29A)
```

Transitions emit `ADRCaseStatusChanged`; consents `ADRConsentRecorded`; appointments `ADRNeutralAppointed`; hearings `ADRHearingScheduled`; deliveries `NoticeServiceUpdated`; outcomes `ADROutcomeRecorded`. A `SETTLEMENT_PROPOSED` outside the RE's mandate needs `SettlementApproved` before signing.

## 8.4 Data ownership and evidence pack

- **RE (FX, RS):** loan, KYC, contacts, statement of account, claim, agreement with clause and stamp proof, recall and s.21 notices, mandate and approvals, accounting, classification, CIC reporting, execution litigation. **Equator:** docket, panel, selection log, disclosures, orders, hearing records, original instruments and certified copies, service logs, fees. **Udofin:** presentation, grievance intake, relay only. DPDP: RE is fiduciary for loan data; Equator processes referral data and is fiduciary for case records [INTERP] [VERIFY: s.17(1)(a)].
- **Referral pack** (hash and JWS each): agreement with clause and stamp certificate, KFS, sanction letter, certified statement with electronic-record certificate (Bharatiya Sakshya Adhiniyam 2023 [VERIFY: section]), recall and s.21 notices with proofs, claim, authority letter, sealed settlement band. **Outputs:** notices, orders (no mediation record), s.73 or s.19 settlement, award (eSigned, e-stamped, PDF/A-2b), certified copies, non-settlement report.

## 8.5 Onboarding, hearings, outcomes and payment

- Borrowers enter per Part 4.4; staff and counsel by SCIM. Udofin shows only status, next action, hearing launch, RE payment instructions and outcome summary.
- Video, documents-only and witness sessions; venue distinct from seat (s.20(3)) [REC: borrower-proximate seat]; links ≥ 3 days ahead; **mediation and conciliation never recorded** (A&C Act s.75; Mediation Act ss.22–23 once in force).
- Instruments are eSigned and **e-stamped at signing**; late stamping needs impounding and penalty (*URC Construction v AAI*, Del HC, 1 Sep 2026) [VERIFY: article per state for s.73 settlements].
- RS starts s.33 (30 days) and s.34(3) (3 months + 30 days) clocks from each party's receipt and maps the outcome to the RE's settlement record (RSA paras 16(5), 89, 95, 100) or award execution; CIC "Settled" only for waivers for financial inability (CIR para 12(4)); Lok Adalat awards import as `OrderRecorded`.
- Payments go only to the RE via RE-issued links (CF para 10); receipts reach Equator as `RecoveryReceiptPosted`; a provider configuration that collects borrower money fails certification.

## 8.6 Independence controls

Random allocation from the provider's panel filtered by language, region and conflicts; the RE cannot pick, rank or veto. Per-lender concentration caps with a 3-year count against Fifth Schedule item 22 [VERIFY: defensible cap]; selection log (pool, exclusions, seed, counts). Sixth Schedule disclosure before acceptance; Seventh Schedule conflicts flagged; challenge within 15 days (s.13(2)). No outcome-linked fees, no neutral paid through RE counsel, no Finbyx or Udofin user as neutral; published rules, fees and code; annual independence audit.

## 8.7 Compliance monitoring, enforcement and fees

RS emits `ADROutcomeComplianceUpdated` from its ledger; Equator assembles the enforcement pack (certified instrument, stamp and service proofs, s.34 status). On breach RS emits `SettlementBreached` and opens `LitigationCaseOpened` (S36_EXECUTION) where assets lie (*Sundaram Finance v Abdul Samad* (2018) 3 SCC 622); High Courts split on executing unilateral-appointment awards, hence the gates. The referring RE pays published fees; debiting costs to the borrower depends on contract and RBC fair-practice rules [VERIFY]; GST on arbitral tribunal services is reverse charge (Notification 13/2017-CT(Rate), Sl. 3) [VERIFY].

## 8.8 Clocks and audit evidence

`ADRCaseStatusChanged.clocks` carries: s.62(4) 30 days; s.13(2) 15 days; s.23(4) 6 months; s.29A 12 + 6 months; s.29B 6 months; s.33 30/60 days; s.34(3) 3 months + 30 days; s.11 petition 3 years after failure to appoint on a valid s.21 notice (*Arif Azim v Aptech*, 2024); s.12A 3 + 2 months; Mediation Act s.18 120 + 60 days once in force. Evidence kept ≥ 12 years after closure [REC]: notice template hash, address source, per-channel delivery proof, selection log, disclosures, consent artefacts, attendance, eSign and e-stamp ids, fee receipts; no "deemed served" without evidence.

## 8.9 Provider-neutral adapter (`OdrProvider`)

Each capability (referral, withdrawal, mandate, documents, status, delivery, consent, appointment, hearing, outcome, party launch, Lok Adalat lists and awards) is declared as API, WEBHOOK, FILE or PORTAL_MANUAL. Equator native names map: case.refer → `ADRReferralCreated`; settlement.mandate → mandate API; case.screening_result, notice.dispatched, party.joined, tribunal.constituted, hearing.held, deadline.warning, challenge.notified, case.closed → `ADRCaseStatusChanged`; notice.delivery → `NoticeServiceUpdated`; consent.recorded → `ADRConsentRecorded`; neutral.appointed → `ADRNeutralAppointed`; hearing.scheduled → `ADRHearingScheduled`; settlement.proposed → `ADRCaseStatusChanged` (SETTLEMENT_PROPOSED) answered by `SettlementApproved`; settlement.executed and award.issued, stamped or served → `ADROutcomeRecorded`; payment.received → `RecoveryReceiptPosted`. Providers without APIs use `adr_referral_v1`, `adr_status_v1`, `adr_outcome_v1` (Part 12); Lok Adalat lists use registered DLSA formats [VERIFY: per DLSA].

---

# 9 — COMPLIANCE AND GRC INTEGRATION

## 9.1 Compliance-mode switch

Per RE tenant (and for Udofin's own compliance), recorded in `re_grc_link` and changed by configuration with maker-checker (Finbyx M14; Udofin Part 2): **EMBEDDED** (Finbyx compliance module), **LDC_EXTERNAL** (LawDocsComply; products push evidence and pull obligations), **LDC_GROUP** (one instance per `group_id`, every record tagged by `reid`, group roll-ups), **THIRD_PARTY_GRC** (RE's tool via certified adapter), **EXPORT_ONLY** (evidence packs and OSCAL; Udofin default until a bridge exists). A switch never loses data: the outgoing system exports obligations, controls, open issues and the evidence index with hash-chain heads; the incoming system imports before the effective date; producers dual-publish for one compliance period. The grievance-host switch is separate.

## 9.2 Generic GRC connector contract

REST (JSON Schema 2020-12, cursor pagination) plus event push and periodic OSCAL; `Idempotency-Key` on every POST; users by SCIM with OIDC or SAML; machines by mTLS-bound client credentials. Evidence is hash-chained, stored in India in the producing product, with aggregate counts and masked sample ids, never raw personal data; GRC systems hold references and hashes.

| Resource | Key fields | Event | OSCAL |
|---|---|---|---|
| `Obligation` | obligation_ref, paragraph, text hash, applicability, dates, owner, status | `ObligationPublished` | catalog, profile |
| `Control` | obligation_refs, component, frequency, automated | — | component-definition |
| `ControlTestResult`, `Evidence` | run, period, result, population, masked sample, artefact hashes, signer | `ControlTestResultPublished`, `EvidenceSubmitted` | assessment-results |
| `Issue` | source (TEST, AUDIT, RBI, INCIDENT), severity, owner, due | `ComplianceIssueRaised` | plan-of-action-and-milestones |
| `Incident` | detected_at, notified_re_at, rbi_reported_at | `SecurityIncidentNotified` | — |
| `RegulatoryReturn`, `PolicyAttestation` | code, period, status, ack; policy, version, Board date, user | `ReturnStatusUpdated`, `PolicyAttested` | — |
| `OutsourcingArrangement`, `KRI`, `RegulatoryChange` | provider, materiality, group flag (OUT paras 45–51, 90–92), data location; metric, threshold; impacted obligations | `ObligationPublished` (changes) | — |

**Minimum control feed:** classification sync T+1 (TDCR para 124); agent notice before contact (CF para 9(6)); contact windows (RBC paras 90, 91(2), 100); same-day agent cash posting (CF para 10(5)); no LSP-controlled account (CF para 10); KFS before execution (RBC para 29); DLG cap, window and disclosure (CF paras 24, 27, 28); release timelines (RBC paras 35, 58, 69); settlement approval and cooling (RSA paras 16(5), 95); ADR basis (A&C Act ss.7, 12); consentref (CF para 13); incident notice (OUT para 61).

## 9.3 LawDocsComply native connector

Checkpoint banks → `Obligation` (each checkpoint carries the canonical `obligation_ref`); questionnaire responses and product tests → `ControlTestResult`; calendar → returns and policy reviews; litigation module → consumer of the five litigation events. LawDocsComply (Node, TypeScript, MongoDB) builds the connector in its own repository against this specification and certifies it like any other [VERIFY: public API; one-to-one mapping of questionnaire rows to OSCAL controls].

## 9.4 OSCAL and third-party GRC adapters

On request, a JWS-signed OSCAL JSON package (NIST OSCAL v1.2.x: catalog, profile, component-definition, system-security-plan, assessment-results, plan-of-action-and-milestones). Adapters are versioned mapping packs (10.3): **MetricStream** (OpenAPI REST, REST or Kafka connectors, bulk loads); **ServiceNow IRM** (Policy and Compliance staging tables; roles `sn_compliance.admin`, `sn_grc_cim.admin`; never core tables); **Archer** (REST, Content and GRC APIs); **IBM OpenPages** (GRC REST, App Connect, regulatory-content connectors); **Komrisk, Komply360, Compfie, TeamLease RegTech, Lawrbit, OnFinance** (REST where available, else CSV or OSCAL) [VERIFY: APIs per tool]; others through 9.2.

---

# 10 — THIRD-PARTY INTEGRATION FRAMEWORK

## 10.1 Connector SPI and certification

Every connector implements `@infrabyx/connector-sdk` and runs out of process with APIs and events only:

```ts
interface Connector {
  manifest(): ConnectorManifest;            // id, version, counterparty, capabilities, schemas, scopes, residency
  capabilities(): CapabilityDeclaration[];  // API, WEBHOOK, POLL, FILE or PORTAL_MANUAL per capability
  healthCheck(ctx: TenantContext): Promise<Health>;
  send(ctx: TenantContext, event: CloudEvent): Promise<DeliveryResult>;     // canonical → counterparty
  receive(ctx: TenantContext, raw: InboundMessage): Promise<CloudEvent[]>;  // counterparty → canonical
  call(ctx: TenantContext, op: OperationId, body: unknown, idemKey: string): Promise<OperationResult>;
  reconcile(ctx: TenantContext, businessDate: string): Promise<ReconciliationReport>;
}
```

`TenantContext` carries `tenantid`, `reid`, a vault handle, mapping version and environment; calls without RE context fail. Third-party connectors also need residency and sub-processor review, VAPT ≤ 12 months old, and the outsourcing clauses in the counterparty contract (OUT paras 33–34, 74).


**IPB connector manifests** *(v1.2)*. Product-side connectors installed from a product's Settings › Integrations are described by the IPB-10 §10.4.6.1 manifest (`auth`, `scopes_required`, `events_consumed`, `events_produced`, `data_class_max`, `residency`, `health`); an ecosystem connector that produces or consumes `in.infrabyx.*` events is in addition certified under this Part and lists only registered event types in `events_consumed` and `events_produced` (the IPB-10-41 lint). The two descriptions are one file: the manifest's `events_*` arrays are the SPI's event declarations.

## 10.2 Adapter catalogue

| Category | Examples | Pattern and rules |
|---|---|---|
| LOS/LMS in place of Finbyx | Apache Fineract and Fineract-based cores (`/fineract-provider/api/v1/`), vendor cores | Certified lender connector, generic REST or webhook, or SFTP; that LMS becomes system of record [VERIFY: Fineract external events in deployed version] |
| Accounting | TallyPrime (XML over HTTP port 9000 or file), SAP S/4HANA (OData, BAPI_ACC_DOCUMENT_POST, ACC_DOCUMENT IDoc), SAP Business One, Zoho Books, CSV | `AccountingSink` from the RE ledger; hashed, signed, no manual edits (CYB paras 119–120) [VERIFY: SAP per release] |
| Legal-tech, court data | eCourts CNR [VERIFY: NBFC API eligibility], aggregators, e-DRT (no API found), NCLT, e-Jagriti, LawDocs | CNR polling, cause-list match, orders; counsel updates prevail |
| E-auction | BAANKNET (mandatory for IBC liquidation auctions noticed from 1 Apr 2025), C1 India, auctiontiger, MSTC, Shriram Automall | `AuctionPlatformAdapter`: listing, EMD and bidder KYC, bid log, result [VERIFY: NBFC access and APIs] |
| Agencies, diallers | Agency portals, Credgenics, Spocto, 1600-series voice vendors | Allocations in, activity out; police verification (RBC paras 93–99); IIBF from 1 Jan 2027 [VERIFY] |
| Notice dispatch | India Post bulk API (CEPT onboarding), couriers, DLT SMS, email, print-to-post | → `NoticeServiceUpdated`; Registered Post merged into Speed Post (1 Sep 2025); WhatsApp never used for collection, recovery or legal notices (WhatsApp Business Messaging Policy bars debt collection; Finbyx 7A.0.6 guard-rail, Udofin UR3) |
| ODR providers | Equator, Presolv360, Sama, Jupitice, CADRE, Webnyay | `OdrProvider` (8.9) |
| Depository, RTA, registries, KYC, bureau, AA, eSign, payments | NSDL, CDSL, CAMS, KFintech, MF Central, CERSAI, Vahan, TReDS, CGTMSE; Finbyx and Udofin Part 9.2 | RE contracts where law requires; no LSP account in money flows [VERIFY: Vahan financier API] |
| Credit information companies | TransUnion CIBIL, CRIF High Mark, Experian, Equifax | `BureauSubmitter`: SFTP from a tenant-controlled host or the on-premises agent, keys in the tenant vault, rejection and DQI ingestion; UCRF formats as data packs (12.4); never another lender's membership (6.19) |
| Regulator portals | RBI CIMS, DAKSH and PRAVAAH; NABARD ENSURE; IFSCA; FIU-IND FINGate 2.0; CKYCR; CERSAI; income-tax reporting portal; MCA; GST; EPFO and ESIC | `PORTAL_MANUAL` only: validated upload file, guided checklist and acknowledgement capture; no credentials, OTPs, cookies, RPA or scraping; a machine channel only where the regulator documents it for that entity class (CIMS ADF is documented for banks) [VERIFY] (6.18) |
| Tax utilities | GSTN offline-tool JSON, Form 140 validation utility, TRACES downloads | Files only; an authorised user files (6.20) |
| Customer storage | S3-compatible stores, Azure Blob, Google Cloud Storage, SharePoint and OneDrive (Graph), Google Drive (non-regulated data only), SFTP, on-premises agent | `StorageTarget` (12.2) |
| Workplace suites | Microsoft 365 (Graph, Entra ID, SCIM), Google Workspace (Admin SDK, Directory API), client data centre | `WorkplaceProvider`: identities, mailboxes, licences and document libraries; no borrower or member data in Google Workspace (no India data region) |
| CRM and marketing | Operations Hub open CRM; Brevo | `CrmSink` from OH3 only; consent and DLT registration (TRAI TCCCPR 2018; 140-series for promotional calls); never RE borrower data (CF para 13) |
| Subscription billing | Razorpay orders, payment links, subscriptions, e-mandates and webhooks | Operations Hub (OH8) and Udofin's B2C billing service only; webhook signature verified and status fetched server-side; never used for loan money (CF para 10) (6.27) |
| Voice and contact centre | JioCX, Jio Business SIP trunks, other CPaaS and AI contact-centre providers | `VoiceProvider`: DLT; 1600-series for RE service and transactional calls (TRAI Direction, 19 Nov 2025), 140-series for promotional calls; recording consent; Udofin's own outbound service calls stay disabled until 1600-series eligibility is confirmed [VERIFY] |
| Market data and custody | Exchange-licensed feeds, depositories, custodians, RTAs, AMFI NAV | Licensed data only; trade capture records and never executes orders (6.25) |
| Insurers and intermediaries | Insurer APIs and IRDAI-registered partners | Udofin only, under its own registration or as an unpaid technology provider to an RE that holds one; separate consent; premium paid directly to the insurer (6.30) |

## 10.3 Data-mapping configuration

Each adapter ships a semantically versioned mapping pack (`infrabyx-contracts/mappings/[connector-id]/[version]/mapping.yaml`): canonical JSON Pointer ↔ counterparty field maps, code-table maps, approved transformations, defaults, validation rules and golden fixtures run in CI. Tenants override only `x-tenant-overridable` fields by maker-checker, creating a patch version (`1.4.0+re_01J…`); meaning-changing edits need recertification.

---

# 11 — EXTENSIBILITY AND NEW PRODUCTS

## 11.1 Module registry, entitlement and lifecycle

- **`module.yaml`** per attachable module (Recovery Suite modules, product templates, connectors, apps): `id` (`namespace.module`), `version`, `product`, `requires`, `capabilities`, `events_produced`, `events_consumed`, `apis`, `permissions`, `data_categories`, `regulatory_refs`, `retention_class`, `licence_sku`, `ui_slots`, `migrations`.
- **Entitlement** is checked server-side on every call and handler through an OpenFeature-compatible provider (SKU, tenant, entity, product family, branch, role); flag keys `mod.[id].[capability]` (e.g. `mod.recovery.adr.referral`, `mod.las.revolving`).
- **Lifecycle:** `AVAILABLE → LICENSED → INSTALLED → CONFIGURED (maker-checker) → CERTIFIED → ENABLED → READ_ONLY → DETACHED`; `ModuleAttached` on ENABLED, `ModuleDetached` on entering READ_ONLY (writes stop), both emitted by the product's entitlement service and reconciled daily by OH8 (`GET /v1/entitlements`, 6.27); the export pack is produced before DETACHED. **Detaching never deletes regulated records:** recovery, litigation and ADR files stay on legal hold until closure plus retention; KYC and transaction records follow PMLA and the KYC Directions [VERIFY: periods]. Detachment is blocked while statutory clocks are open (s.34 window, SARFAESI balance deadline, s.138 complaint deadline) unless each is transferred with acknowledgement.
- **v1.2** *(v1.2, from LD App. Y)*: `module.yaml.product` and `TenantProvisioned.product` accept `LAWDOCS`; LawDocs attachable modules (template packs, Legal Vault connectors, the Consumer Help module, marketplace listings) follow this registry; the Consumer Help module declares `data_categories: [CONSUMER_HELP]` and no `events_produced`.

## 11.2 Extension points and SDK

Extension points: event subscriptions, gateway APIs, external task workers claiming named queues (`fi.visit`, `notice.print`, `valuation.report`, `counsel.update`) through a task API with tenant-scoped tokens (Finbyx 7A.0.7), GoRules JDM rule tables per tenant and product, document template packs, Temporal workflow hooks, UI slots, mapping packs, export layouts. The SDK provides envelope validation, registry client, Standard Webhooks and RFC 9421 signing, idempotency, outbox and inbox helpers, mapping runtime, simulators and the certification runner.

## 11.3 Onboarding a new ecosystem app

Checklist: (1) legal role per RE (OUT Ch III or IV), materiality, group policy (OUT paras 45–51, 90–92), OUT paras 34 and 74 clauses; (2) DPIA, India-only, need-to-know (OUT para 24), `x-dataclass` per field, no phone-resource access in borrower components (CF para 13(1)); (3) OIDC, SCIM, product roles, MFA; (4) registered events, APIs and files with AsyncAPI, OpenAPI and Pact; (5) mTLS, RFC 9421 keys, VAPT, SBOM, SIEM feed, incident notice enabling the RE's 6-hour report (OUT para 61); (6) manifest, SKU, flags; (7) BCP and DR tests, exit plan, RE outsourcing-register entry; (8) for recovery use, agent authorisation and ID, contact-policy engine, grievance routing; (9) certification, `ConnectorCertified`, evidence to GRC; (10) from v1.1, the data-class ceiling of every subject the app consumes (Operations Hub subjects accept at most `INTERNAL` from product sources), group grants under Part 4.6 and the Equator wall wherever the app touches Equator.

**Worked example — field-investigation app:** service provider to the RE (OUT Ch III), not an LSP unless it performs digital lending functions. Consumes `VerificationRequested`, `CollectionAllocated` and `CollectionDeallocated` (where the RE appoints its agents), `LegalHoldChanged`, `ConsentWithdrawn`. Produces `VerificationCompleted`, `FieldVisitLogged`, `CollectionActivityLogged`, `PTPCaptured`, `ReceiptIssued`, `RiskSignalRaised`, `SecurityIncidentNotified`. Address token resolved only at visit time; premises photos only; geo, time and evidence hashes; scopes `collections.allocation:read`, `collections.activity:write`; contact-policy check before each visit; findings feed Finbyx R2 and the service-proof register (affixation, hand delivery); certification adds offline-sync idempotency tests.

**Worked example — Infrabyx Operations Hub (v1.1):** Infrabyx's own system (product code `OH`), not an LSP and not an outsourced service for any RE's lending because it holds no RE customer data [INTERP]; group-outsourcing controls apply where a group company serves an RE (OUT paras 45–51, 90–92). Produces `TenantProvisioned`, `ImplementationMilestoneReached`, `SupportTicketOpened`, `SupportTicketResolved`, `ChangeApproved`, `PlanChanged`, `EntitlementChanged`, `InvoiceIssued`, `SubscriptionPaymentReceived`, `SubscriptionPaymentFailed`, `SubscriptionCancelled`, `ProfessionalEmpanelled`, `ProfessionalSuspended`, `ControlEvidenceCollected`, its own `BackupCompleted`, `RestoreTested` and `ReleasePublished`, `ExternalAccess*` for `PROVIDER_ASSURANCE` grants only (4.7) and its own `workforce` events (`source` `urn:infrabyx:oh:[legalentityid]`). Consumes `UsageRecorded`, `ModuleAttached` and `ModuleDetached` (OH8 is the source of truth for issued entitlements; products report modules as applied), `ReleasePublished`, `ControlEvidenceCollected`, `ConnectorCertified`, copies of `SecurityIncidentNotified`, `AccessReviewCompleted` (PLATFORM scope), `MatterAllocated`, counts from external-access and portability events and, only with tenant opt-in, `ReturnDue`, `ReturnFiled` and `PeriodClosed` metadata. Serves the catalogue, quote, order, invoice, usage-dispute, provisioning-acknowledgement, support-ticket, CRM-request, directory, conflict-check and claims-gate APIs and calls each product's provisioning-status and entitlement APIs (6.27, 6.29). Certification adds aggregates-only schema tests, a seeded borrower identifier that must be rejected with `dataclass-not-permitted`, the Equator separation-of-duties rule, grant expiry within 60 seconds and Razorpay webhook verification. Client data migration stays inside the client's product tenant (4.6); Brevo and other CRM processors receive only consented business contacts, never RE borrower data (CF para 13).

## 11.4 Naming rules and standalone Udolex

Event names PascalCase, past tense, unique, never product-prefixed; API paths plural with action sub-resources; schema subjects `[domain]/[EventName]` and `.lsp`; connector ids `[counterparty]-[capability]-[product]`; identifiers prefix + ULID, never reused. **Udolex** changes only `source` (`urn:infrabyx:udolex:[tenantid]`); the ledger stays in the RE's LMS and `RecoveryReceiptPosted` becomes a posting request confirmed by the LMS's `PaymentReceived`.

---

# 12 — DATA EXPORT AND INTEROPERABILITY FORMATS

| Format | Use | Specification |
|---|---|---|
| CSV, XLSX, JSON, NDJSON, XML | Registers, lists, bulk and counterparty layouts | RFC 4180 UTF-8 CSV; JSON Schema 2020-12 or XSD per layout |
| PDF/A | Notices, awards, orders, statements, evidence packs | PDF/A-2b; XMP block with document_id and source hash; eSign, DSC or PAdES |
| Tally XML | Journals to TallyPrime | ENVELOPE, HEADER (Import Data), BODY, IMPORTDATA, REQUESTDESC, REQUESTDATA, TALLYMESSAGE; port 9000 or file |
| SAP | Journals to S/4HANA or ECC | ACC_DOCUMENT IDoc, BAPI_ACC_DOCUMENT_POST or OData [VERIFY: per release] |
| XBRL | Where a regulator requires it (e.g. MCA) | Filing taxonomy; RBI returns moving to CIMS templates [VERIFY: NBFC returns] |
| CloudEvents batch | Replay and file fallback | `application/cloudevents-batch+json` or NDJSON |
| DOCX | Editable renditions of narrative documents in archives (12.1) | Office Open XML (ISO/IEC 29500), always paired with a PDF/A-2b rendition |
| UCRF bureau formats | CIC submissions | Consumer v3.74, Commercial v3.10 (SFTP only) and MFI v3.3.1 as versioned format packs (12.4) |
| GSTN and income-tax utility files | GST and TDS returns | GSTN offline-tool JSON; Form 140 utility file [VERIFY: utility name] (12.4) |

**Registered layouts (minimum):** `loan_master_v1`, `schedule_v1`, `payment_v1`, `collateral_register_v1`, `pledge_position_v1`, `dlg_position_v1`, `colending_escrow_v1`, `recovery_case_v1`, `notice_register_v1`, `service_proof_v1`, `litigation_register_v1`, `settlement_register_v1`, `adr_referral_v1`, `adr_status_v1`, `adr_outcome_v1`, `asset_sale_v1`, `possessed_assets_web_v1` (monthly website list, CIR para 21), `agency_list_web_v1`, `gl_journal_v1`, `grc_evidence_index_v1`, `reconciliation_breaks_v1`; v1.1 adds the nineteen layouts in 12.4.

**Dictionaries and checksums.** Each layout's dictionary gives field, canonical JSON Pointer, type, length, mandatory flag, `x-dataclass` and code table; each file has a JWS-signed manifest with counts, control totals and SHA-256 (3.11). Detached-module and tenant-exit exports (Finbyx Part 10.6 item 24) use these layouts inside the archive standard (12.1).

## 12.1 Archive standard (shared)

One standard (`archive_standard_version` 1.0) for every archive a product hands to a customer, auditor, successor or court: Finbyx DP1–DP2 and DP5 tenant exit, Udofin RA3 RE archives, UP3 RE audit packs and UP5 deal exit, and Udofin UB1 borrower downloads. A person with Microsoft Office or LibreOffice, a PDF reader and a checksum tool must be able to find, open, verify and understand every record without the producing product; a successor system must be able to load every dataset.

**Folder tree.** Two-digit numbered top-level folders under `[Owner legal name] - [Product] Archive - [scope] - as of [YYYY-MM-DD]/`. Folder `00 Start Here/` is mandatory and identical in every profile:

```
00 Start Here/
    README.pdf, README.docx, README.txt        (README.md optional)
    export-manifest.csv, manifest.json, manifest.json.jws
    data-dictionary.xlsx, data-dictionary.csv
    relationships.csv, relationship-map.pdf
    code-tables/          one CSV per code table
    schemas/              JSON Schema 2020-12 per dataset
    verify/               open-source verifier (Apache-2.0) and instructions
```

Registered folder profiles: `finbyx_tenant_v1` (folders 01–14 of Finbyx DP1.2), `udofin_re_v1` (folders 01–17 of Udofin RA3.2), `re_audit_pack_v1` (Udofin UP3 packs P1–P10), `udofin_borrower_v1` (Udofin UB1). A tenant may rename or split folders through a versioned `folder_policy`; the canonical path of each dataset stays in the manifest, so relationships never break.

**Naming.** Plain English; Windows-safe (no `\ / : * ? " < > |`, no trailing dot or space); Unicode NFC; full path ≤ 240 characters (longer names shortened with an id suffix); dates ISO 8601; **no personal data in any folder or file name** (default `ids_only`; `id_and_masked_name` only for internal archives).

**Formats.**

| Content | Files | Rules |
|---|---|---|
| Each dataset | `[dataset].csv`, `[dataset].xlsx`, `[dataset].schema.json`; optional `[dataset].jsonl` | CSV per RFC 4180, UTF-8 with BOM, ISO 8601 dates with time zone, amounts as fixed 2-decimal strings with a `currency` column, no thousands separators, code plus label columns; XLSX with a "Read me" sheet, frozen header, dictionary text as column comments, typed cells, leading zeros preserved, split at 1,000,000 rows |
| Original documents | As stored | Bytes unchanged; SHA-256 equals the producer's document hash; signature evidence alongside |
| Narrative renditions | PDF/A-2b plus DOCX | XMP carries `document_id` and source hash |
| Tabular reports | XLSX (and PDF/A where signed) | Same typing rules as datasets |
| Regulatory and bureau files | Exactly as generated and submitted | Byte-identical to the filed file; validation report, sign-off and acknowledgement alongside |
| Audit trail | `audit-events.jsonl` per month plus an XLSX digest | Hash chain verifiable offline with daily anchors |

**Manifest** (`archive_manifest_v1`). `export-manifest.csv` has one row per file: `path`, `sha256`, `bytes`, `media_type`, `record_count`, `legal_entity`, `dataset`, `schema_version`, `as_of`, `created_at`, `source_ids`, `restricted` (Y or N), `retention_class`, `legal_hold` (Y or N), `upsi` (Y or N). `manifest.json` repeats the rows and adds `archive_id` (ULID), `archive_standard_version`, `folder_profile`, producer product and release, tenant and `reid`, scope definition, requester and approvers, `as_of` instant, `control_totals` (per legal entity: customers or members, applications, loans by status, principal outstanding, interest receivable, trial-balance totals, document count and bytes, audit-event count and last chain anchor, as relevant to the profile), `predecessor_archive_id` for incremental chains, a pack-level SHA-256 over the sorted file list and the signing key id. `manifest.json.jws` is a detached JWS (RFC 7515, 7797) with the tenant's export-signing key; the public key and fingerprint are printed in the README.

**Checksums and control totals.** SHA-256 for every file; the job reconciles control totals to the live system at the snapshot instant before signing, and any difference fails the job. The verifier checks hashes, the signature, control totals, chain links and CSV schema conformance offline.

**README** (PDF, DOCX and TXT; English, Hindi optional): purpose and scope; as-of time and time zone; requester and approvers; folder guide; how to open CSV files without losing leading zeros; how to verify checksums (`sha256sum -c`, `Get-FileHash`, `CertUtil -hashfile`) and the signature; how to join tables; glossary; restricted-folder handling; retention and legal-hold notes; contacts. A test checks that every folder the README names exists and every top-level folder is named.

**Restricted folders.** HR and payroll (Finbyx folder 10), privileged legal material (Finbyx folder 12 `Restricted`) and Udofin collections and recovery (Udofin folder 12) are separate AES-256 encrypted ZIP archives, each with its own manifest; included only for a requester holding `export.restricted.[class]` and approved by a second approver (HR head or General Counsel, plus the DPO); the password is generated per archive, delivered out of band to the named recipient and never stored with the archive. UPSI-flagged records create structured digital database entries for the recipient (Finbyx GV4). Aadhaar numbers and card data are never exported.

**Quality gates.** CI renders every Office and PDF output headless (LibreOffice) and validates PDF/A (veraPDF); a rendering failure blocks the release. Wellness add-on data, insurance data and another RE's data can never enter an RE archive (content scan).

## 12.2 Customer-controlled storage connector contract

Every storage connector implements the connector SPI (10.1) as `StorageTarget` and passes certification (14.3) before production use. Used by Finbyx DP3–DP4, Udofin RA3.4–RA3.5 (one target per deal) and tenant exit.

```ts
interface StorageTarget extends Connector {
  describe(): Promise<TargetDescription>;          // provider, region, encryption, key mode, immutability, data classes allowed
  verifyResidency(): Promise<ResidencyResult>;     // reads provider region metadata or a signed tenant attestation
  testWrite(): Promise<CanaryResult>;              // write, read back, compare SHA-256, delete canary where permitted
  put(stream: Readable, path: string, sha256: string, opts: PutOptions): Promise<PutResult>; // resumable; opts.writeOnce, opts.retainUntil
  head(path: string): Promise<ObjectInfo>;         // size and checksum
  list(prefix: string): Promise<ObjectInfo[]>;
  retentionInfo(path?: string): Promise<RetentionInfo>; // lock mode, retain-until, legal hold
  healthCheck(ctx: TenantContext): Promise<Health>;
}
```

| Provider | Authentication (no long-lived secrets where federation exists) | India residency check | Write-once option |
|---|---|---|---|
| S3-compatible: Amazon S3 | Cross-account IAM role with `ExternalId`; bucket policy limited to the product role | `GetBucketLocation` returns ap-south-1 or ap-south-2 | S3 Object Lock (compliance or governance mode) |
| S3-compatible: other (e.g. MinIO, on-premises object stores) | Access key in the tenant vault, rotated ≤ 90 days, or the on-premises agent | Signed tenant attestation of site in India | Object lock where the store supports it [VERIFY per product] |
| Azure Blob | Entra workload identity federation or user-delegation SAS valid ≤ 7 days | Storage account in Central India, South India or West India | Immutability policy (time-based retention, legal hold) |
| Google Cloud Storage | Workload identity federation | Bucket in asia-south1 or asia-south2 | Retention policy with bucket lock |
| SharePoint and OneDrive (Microsoft Graph) | Entra app with `Sites.Selected` for the granted site only | Tenant data location for the workload is India: Graph or admin-centre evidence signed by the tenant's IT head, re-attested annually [VERIFY: Graph property] | Retention label declaring records [VERIFY: label behaviour per plan] |
| Google Drive | Service account with minimal Drive scope on a shared drive (never a personal My Drive) | No India data region: **non-regulated data only** | Not offered |
| SFTP | Key-based (ed25519), host key pinned, keys rotated yearly | Signed tenant attestation of server location in India | Only if the server enforces WORM (attested) |
| On-premises agent | Outbound-only mTLS device certificate; writes to NAS, SMB share or S3-compatible store | Signed tenant attestation of site in India | As the underlying store |

- **Data-class policy per target** (13.2): a write of a class the target does not allow is refused before upload. Borrower, applicant, member, loan, KYC, bureau, grievance, recovery and HR data, books of account and regulatory returns need an India-resident target (CF para 14(4); OUT para 74(vi); Companies (Accounts) Rules r.3(5)). **"Non-regulated data"** for Google Drive means `PUBLIC` or `INTERNAL` material and `CONFIDENTIAL` documents that contain no personal data, books of account, returns or loan data (for example approved policies or product brochures); Google Drive can never be configured for any other class (`residency-blocked`, 3.9).
- **Residency** is verified at registration and re-verified weekly and before every full or exit export; a non-India or unverifiable region blocks the target.
- **Keys:** platform-managed per-tenant KMS key (default); **BYOK** through a cross-account key grant or imported key material; HYOK through an external key store only with a written risk acceptance signed by the tenant's CISO and CTO; optional client-side archive encryption to the tenant's public key (age X25519 or OpenPGP). ML and UL tenants must be offered tenant-controlled keys (OUT para 97(vii)(b)). Revoking a BYOK grant makes reads and exports fail closed with `key_unavailable`, with alerts to the tenant and Infrabyx operations.
- **Write-once:** when the tenant selects it, every `put` sets the provider lock with `retainUntil` equal to the archive's longest retention class (books 8 financial years under CA13 s.128(5); KYC 5 years after the relationship ends; litigation per the Recovery Suite rules) [REC]; a target that cannot honour the lock is not offered the option.
- **Health checks:** daily `healthCheck()` and canary write; credential-expiry warnings 30 days ahead; one missed backup raises a P2 alert, two consecutive misses a P1 alert and a tenant notice; failures are published as `ControlTestResultPublished` (6.26).
- **Events:** `StorageTargetConnected` after residency and canary checks pass; `ExportCompleted`, `BackupCompleted` and `RestoreTested` per job (6.26).
- No arbitrary disk attachment in Infrabyx's cloud, and no promise of recovery after a customer purges its own store.

## 12.3 Shared Labour Code rule pack

One **signed, versioned artefact** used by Finbyx GV6 (client HRMS and payroll) and OH10 (Infrabyx staff HRMS and payroll), so that both compute wages, deductions, leave, overtime, gratuity and statutory outputs identically.

- **Artefact and location:** `infrabyx-labour-rulepack`, published from `infrabyx-contracts/rulepacks/labour-codes/[semver]/` with JSON Schema-validated YAML documents, CEL expressions for computations, golden fixtures and a `pack.json` manifest (version, effective dates, coverage by Code, Rule and State, SHA-256 per file) signed with a detached JWS by the Infrabyx rule-pack signing key (HSM-backed). Products pin the version in `contracts.lock`, verify the signature at load and refuse an unsigned or tampered pack.
- **Contents:** wage definition under the Code on Wages s.2(y) (50% exclusion test); PF and pension wage ceilings and rates; ESI coverage and rates; overtime (consent, 2× rate, 144 hours a quarter under the OSHWC Central Rules, stricter State limits); working hours and rest (Wages (Central) Rules r.5–r.6); leave accrual, carry-forward and encashment (OSHWC s.32); gratuity eligibility and computation; final-wage timer (Code on Wages s.17(2): 2 working days); permitted deductions and the 50% cap (Code on Wages s.18); State professional tax and labour welfare fund tables; Shops and Establishments thresholds; `state_rule_status` per State and Code; register, wage-slip and return form layouts; the prohibited-monitoring list (6.23 rule 4).
- **Legal status recorded in the pack:** the four Labour Codes in force from 21 November 2025; Central Rules notified 8 May 2026 (G.S.R. 342(E)–345(E); corrigendum G.S.R. 629(E) of 15 July 2026); most State rules pending, with old State rules continuing so far as consistent [VERIFY: each State at go-live].
- **Governance:** every rule carries its citation (`LC: [Code] s.[n]` or Rule) and a `[VERIFY]` status; a rule still marked `[VERIFY]` cannot drive a statutory output until cleared. Changes are approved by Infrabyx's labour-law reviewer and payroll lead (maker-checker); semver major for structural changes, minor for new States or tables, patch for corrections. A notified State rule or Central amendment is reflected within 10 working days [REC].
- **Overrides:** tenants and Infrabyx entities may configure more generous policies through `x-tenant-overridable` fields; nothing may go below a statutory floor.
- **Conformance:** both repositories run the pack's golden fixtures in CI and must produce identical results (14.3). Income-tax salary TDS (Income-tax Act 2025 s.392) ships as a companion pack `ita25-salary-tds` under the same rules [REC].
- The pack contains no personal data; it is published to both products as data, never as code.

## 12.4 Registered layouts added in v1.1

Each layout follows Part 12 dictionaries, checksums and signed manifests; versions in the layout id are layout majors, except bureau layouts, whose ids carry the CIC format version.

| Layout | Producer → consumer | Content | Source |
|---|---|---|---|
| `return_package_v1` | FX → filer (RE user), LDC, external workspace, archive | Signed return package: template or XML, manifest (entity, return, period, run and template versions, snapshot hash, file SHA-256, validation and reconciliation hashes, approvals), validation report, reconciliation sheet, lineage extract, NIL declaration | Finbyx RR3.6 |
| `bureau_consumer_v374` | FX → CICs | UCRF Consumer v3.74 (header segment tag `TUDF` or `CONS`; PN, ID, PT, EC, PA, TL, TH, ES, TRLR; cycles DL, W1–W3, ME, DC, AH, RR) | Finbyx RR6.5 |
| `bureau_commercial_v310` | FX → CICs (SFTP only) | UCRF Commercial v3.10 pipe-delimited (HD, BS, AS, RS, CR, GS, SS, CD, TS) | Finbyx RR6.5 |
| `bureau_mfi_v331` | FX → CICs | UCRF MFI v3.3.1 (HDR, GRPCRD, CNSCRD, ADRCRD, ACTCRD, TRL); separate SHG and JLG plus individual files | Finbyx RR6.5 |
| `gst_export_v1` | FX → authorised filer, LDC | GSTR-1, GSTR-1A, GSTR-3B, GSTR-9 and GSTR-9C JSON per the GSTN offline-tool schema, with reconciliation workpapers | Finbyx AC4.4 |
| `tds_export_v1` | FX → authorised filer, LDC | Form 140 (and 144, 143) quarterly data file for the official validation utility; Form 131 certificate data | Finbyx AC5 |
| `audit_workpaper_index_v1` | FX, UD → auditors, LDC, archive | Engagement workpaper index: workpaper id, objective, population hash, seed, sample ids (masked), evidence refs and hashes, preparer, reviewer, sign-off | Finbyx AU2 |
| `risk_snapshot_v1` | FX, UD → LDC, RE GRC | Metric ids, versions, values, thresholds, RAG, grain, lineage refs, certification state, pseudonymised references only | Finbyx RK2.4; Udofin RA1 |
| `ratio_catalogue_v1` | FX → LDC, auditors, supervisors | Metric definitions and versions: formula text, AST hash, numerator and denominator sources, applicability, thresholds by type, citations, status | Finbyx RK6 |
| `member_register_v1` | Lender (FX IP2 or society system) → archive, Registrar and auditor packs, successor | Member ref, class, status, admission and exit dates, nominee flag, borrowing eligibility, share holding | Finbyx IP2.3 |
| `share_ledger_v1` | Lender → archive, auditors | Share transactions: allotment, instalment, transfer, redemption, forfeiture, lien, dividend | Finbyx IP2.4 |
| `jlg_group_v1` | Lender → UD (own groups), archive | Groups, centres, member mapping, group and member states, meeting schedule and designated place | Finbyx IP4; Udofin MG2 |
| `investment_position_v1` | FX → investor tenants (look-through profile), archive, auditors | Positions: ISIN, category, classification, quantity, cost, fair value and level, method, price source, as_of; look-through profile adds investee PAN or CIN and instrument type (RBI-AIF para 6) | Finbyx IV5, IV6 |
| `sr_register_v1` | ARC (FX IP5) → SR holders, auditors, archive | ISIN, scheme, class, face value, units, QB holder ref, transfers, NAV, rating and redemption history | Finbyx IP5.3 |
| `servicer_report_v1` | Servicer (FX IV7) → trustee, investors, CRAs | Monthly servicer report and SEC disclosures: scheduled, prepaid and overdue amounts, fees, delinquencies, deficiency ledgers, trigger status | Finbyx IV7.5 |
| `archive_manifest_v1` | FX, UD → archive recipients | `export-manifest.csv` and `manifest.json` per 12.1 | 12.1 |
| `usage_aggregate_v1` | FX, UD → OH | Tenant, legal entity, meter, `meter_kind`, period, quantity, statement hash; no record ids | Finbyx CM3; Udofin RV1 |
| `deal_config_v1` | UD → RE system | Deal configuration version: sections (products, channels, states, journeys, rule versions, storage target) without commercial terms; diff and impact analysis refs; approvals | Udofin UP2 |
| `re_audit_pack_v1` | UD → RE, its auditors, RBI through RA2 | Folder profile for packs P1–P10 with manifest, README and reconciliation workbook | Udofin UP3 |


## 12.5 LawDocs archive profiles, naming mode and layouts added in v1.2 *(v1.2, from LD App. Y)*

**Folder profiles.** Four profiles implement `LD-EXPORT-1.0` (LawDocs Appendix K) under `archive_standard_version` 1.0, each beginning with the mandatory `00 Start Here/` folder of 12.1: `ld_company_v1` (01 Company Profile; 02 Agreements and Contracts by FY, department and agreement; 03 Litigation and Disputes; 04 Trademarks and IP; 05 Board and Governance — only while LD is governance system of record; 06 Policies and Registers; 07 People and HR — restricted; 08 Notices and Correspondence; 09 Services and Engagements; 10 Billing and Invoices; 11 AI Work Products (labelled); 99 System Data), `ld_individual_v1` (profile and masked IDs, property, family and succession, employment, finance, vehicles, disputes, agreements, tax by Tax Year with the legacy `AY` alias, receipts, system data), `ld_professional_v1` (practice profile, clients and matters with engagement, client-permitted copies, work product, filings, correspondence, invoices and payouts; `masked_name` default) and `ld_consumer_help_v1` (loan and lending, insurance, credit-report, challan and vehicle complaints; naming LOCKED to `ids_only` for natural persons; produced only for the data principal's own destination; never part of an RE archive, a cross-product share or an OH dataset — principle 14). LawDocs Appendix K governs folder names on any difference.

**Reconciliation with 12.1.** LawDocs keeps `00 READ ME FIRST.pdf`, `00 Index.xlsx` and `checksums.sha256` at the root as convenience copies (same hashes as `export-manifest.csv`); root name follows the 12.1 pattern `[Owner name] - LawDocs Archive - [scope] - as of [YYYY-MM-DD]/`; year convention (Indian FY for companies, calendar year for individuals) is recorded in the profile's `folder_policy`. **New naming mode `owner_readable`** added to 12.1: allowed only when the recipient is the data owner itself (the tenant or the individual) and the archive is delivered to the owner's own destination; permits counterparty names, titles and business references in folder names; never Aadhaar, PAN, account numbers, health data or another person's identifiers. Every archive for a third party (auditor, court, successor, ecosystem product) uses `ids_only` or `id_and_masked_name`. [OWNER: acceptance by every archive-producing product; LawDocs OI-Y-07 — until then only LawDocs uses it, for its own customer exports]

| Layout | Producer → consumer | Content |
|---|---|---|
| `agreement_register_v1` | LD → archive, LDC, successor | Agreement id, business ref, type, title, parties (refs; names in `owner_readable` only), status, dates, value, governing law, dispute clause, stamp refs, signed document sha256 |
| `signing_evidence_index_v1` | LD → archive, courts, requester | Signing request id, document sha256 before and after signing, signers (refs), method, ESP transaction ids, timestamps, certificate summary, evidence-pack file refs, BSA 2023 s.63(4) certificate ref [VERIFY: citation] |
| `stamp_register_v1` | LD → archive | Stamp id, State, article, consideration, duty, channel, certificate no/UIN, first party ref, verification method and date, lock status, document sha256 |
| `legal_matter_register_v1` | LD → archive, LDC | Matter id, type, status, risk, claim amount, contingent-liability band, counsel refs, linked agreements, cases, ADR cases |
| `court_case_register_v1` | LD → archive, LDC | Case id, forum, court, number, CNR, role, stage, next date, source, as_of, hearings and orders (refs and hashes) |
| `ip_register_v1` | LD → archive | Asset id, type, office, application number, mark/title, classes, status, dates, source |
| `contract_obligation_register_v1` | LD → archive, LDC | Obligation id, agreement id, type, owner position, due rule, next due, status, evidence ref |
| `engagement_register_v1` | LD → archive, OH (commercial columns only) | Engagement id, service, supplier type, professional ref, SLA tier, status, dates, value |
| `vault_index_v1` | LD → archive | Document id, folder path (canonical and profile), origin, sha256, version, renditions (ids, labels, confidence), legal hold, retention class |
| `sharing_ledger_v1` | LD (and every product from v1.2) → archive, auditors | Entry id, time, direction, counterparty product and tenant, link, contract, purpose, consentref or legalbasis, record ids, payload sha256, data class, outcome, previous hash |
| `governance_kernel_export_v1`, `hrms_kernel_export_v1` | LD ↔ LDC (system-of-record switch) | Kernel records as defined by `@infrabyx/governance-kernel` and `@infrabyx/hrms-kernel` [VERIFY: kernel schema versions], with hash-chain heads and control totals |
| `brand_pack_export_v1` *(v1.2)* | Owning product → OH, partner (on exit) | The shared shape (5.4) for every published revision, media by reference with hashes, host history, approvals |
| `vendor_assurance_index_v1` *(v1.2)* | OH14.6 → products (reconciliation), auditors | `vad_id`, version, category, cadence, validity, sha256, visibility, publication targets, state history |

---

# 13 — SECURITY, PRIVACY AND AUDIT

## 13.1 Legal baseline

DPDP Act 2023 and Rules 2025 (notified 14 Nov 2025, phased over 12–18 months) apply alongside RBI rules, the stricter prevailing [VERIFY: commencement per provision]; each product records its fiduciary or processor role per purpose. RBI digital-lending data rules (CF paras 13–15) and outsourcing and cyber rules (OUT paras 28, 34, 61, 74, 81, 97(vii)(b); CYB paras 119–120) are implemented through Parts 2, 3 and 6; each product also meets its own CERT-In reporting duties [VERIFY: timelines]. From v1.1 the baseline adds: DPDP core duties from 13 May 2027 [VERIFY: commencement notification]; the CERT-In Directions of 28 April 2022 (6-hour reporting, 180-day logs in India) for every group company including the Operations Hub; CICRA 2005 and the CIC Rules and Regulations 2006 for bureau data; the Companies Act 2013 and Companies (Accounts) Rules r.3 for books of account and their audit trail; the four Labour Codes (in force 21 November 2025) for HR data; the Income-tax Act 2025 (in force 1 April 2026); IRDAI regulations for insurance data handled by Udofin; and BCI Rule 36 for the professional directory.

## 13.2 Data classification per field

| Class | Examples | Handling |
|---|---|---|
| `PUBLIC`, `INTERNAL` | Disclosures; configuration, aggregates | None; authenticated |
| `CONFIDENTIAL` | Settlement mandates, selection logs, commercial terms | Need-to-know, encrypted |
| `PII` | Name, contact, address, masked ids | Consent or legal basis; role masking; never logged |
| `SPI` | Clear PAN or account, KYC images, V-CIP recordings, health data | Field encryption; RE-scoped vault; RE only |
| `FINANCIAL` | Balances, payments, classification | RE and authorised projections |
| `LEGAL` | Notices, pleadings, orders, awards, privileged advice | Legal-hold aware; privileged material leaves RS only with counsel approval |
| `HR` | Employee master, payroll, attendance, leave, appraisal, disciplinary and health-related HR records (tenant GV6 or Hub OH10) | Employer system only; restricted archive folder (12.1); never sent from a tenant to the Operations Hub, never visible to loan-side roles, never used for AI training |
| `WELLNESS` | Udofin credit reports and scores, score-simulator inputs, expense and budget data | Udofin's separate store only; no cross-product schema may declare it; gateways reject any message carrying it |
| `CONSUMER_HELP` *(v1.2, from LD App. Y)* | LawDocs Consumer Help case data (loan, lending and insurance grievances, credit-report disputes, challans, vehicle matters) | LawDocs' separate store only; no cross-product schema may declare it; gateways reject any message carrying it (`dataclass-not-permitted`); never in any RE archive; counts only to OH (principle 14) |

The envelope `dataclass` is the highest field class; gateways reject messages above the consumer's scope. **Relation to the IPB handling tiers** *(v1.2 rev. 26 Oct 2026)*: the classes in this table describe fields on the wire; IPB-02 §02.4.3.1 defines five *handling* tiers (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `REGULATED`, `SECRET`) and a mapping table from every class here to exactly one tier (`PII` → CONFIDENTIAL, or REGULATED in lending and KYC contexts; `SPI`, `FINANCIAL`, `HR`, `WELLNESS`, `CONSUMER_HELP` → REGULATED; `LEGAL` → CONFIDENTIAL, REGULATED where `x-privileged`). A producer sets `dataclass` from this table; residency, encryption, logging and AI routing follow the IPB tier. `REGULATED` as a data class in this Specification (4.9, 6.36, 6.37 audiences aside) means the IPB tier, never a wire class; the change class `REGULATED` in 6.29 `ChangeApproved` is a change-management category and unrelated. Archive `restricted` flags (12.1) map to `HR` and privileged `LEGAL`; Operations Hub subjects accept at most `INTERNAL` from product sources (4.6).

**v1.2 additions** *(v1.2, from LD App. Y)*. Field annotation `x-privileged: true` on `LEGAL` fields marks privileged advice and litigation strategy; it leaves the producing product only with the holder's explicit per-record approval (RS: counsel; LD: the tenant's `ORG_CLO` or the individual). **Operations Hub ceiling exception:** OH subjects keep the `INTERNAL` ceiling from product sources, except the named `buyer_billing_identity.*` fields of `POST /v1/billing/quotes` and `POST /v1/billing/orders`, which may carry `PII` when `legalbasis = CONTRACT_PERFORMANCE_CUSTOMER` (5.3); certification tests that any other PII field to OH is rejected (14.3). *(v1.2)* The v1.2 domains add no class: `trust`, `tenancy`, `eng`, `cms`, `content` events are `PUBLIC` or `INTERNAL`; `crm`, `consent`, `workforce` (careers), `feedback` and `identity` events carry hashes and references only, with the referenced fields fetched by API under the consumer's scope; `vidhi` delegations carry the highest class they reference and never `REGULATED`, `SPI`, `HR`, `WELLNESS` or `CONSUMER_HELP`.

## 13.3 Keys, logging, retention, incidents and audit

- **Keys:** per-tenant envelope keys in India KMS; BYOK or HYOK for ML/UL tenants; signing keys HSM-backed, rotated annually with overlapping JWKS; webhook secrets every 90 days.
- **Logging:** no Aadhaar, PAN, OTP, account numbers, bureau data or images in logs, traces, analytics, push payloads or DLQ metadata.
- **Retention:** KYC and transaction records 5 years after relationship or transaction (PMLA s.12; KYC para 47); call recordings ≥ 6 months, longer if sub judice (RBC Third Amendment para 100P [VERIFY]); recovery and litigation records until proceedings close plus the 12-year execution period (Limitation Act Art. 136) [REC]; ADR records ≥ 12 years [REC]; event replay per 3.5; security logs ≥ 180 days in India [VERIFY: CERT-In]. `LegalHoldChanged` suspends deletion across all copies; DPDP erasure applies only where no retention or hold applies, and the requester is told what was kept and why.
- **Incidents:** detection → triage (≤ 30 minutes, severity 1) → `SecurityIncidentNotified` to each affected RE (≤ 2 hours) → updates by `update_seq` → RCA → lessons learned (ORM paras 99–101) → closure; the RE, never the provider, files with RBI.
- **Audit:** message hashes, retained signatures, hash-chained decision events, time-boxed read-only access for RE auditors and RBI.
- **Group access (v1.1):** cross-company access only through `group_grant` (4.6): purpose-bound, at most 90 days, approved by both entity heads and the DPO, enforced by each product at expiry and reviewed quarterly (`AccessReviewCompleted`); Infrabyx staff reach tenant data only through product break-glass, visible to the tenant.
- **External access (v1.1):** RE-authorised, read-only, named, MFA-protected, masked by default, watermarked and capped exports; sessions end within 60 seconds of expiry or revocation (4.7).
- **Storage and keys (v1.1):** India-residency verification per data class, BYOK and write-once options and fail-closed key revocation for customer storage targets (12.2); risk-feed HMAC pseudonym keys in the tenant's KMS, rotated annually by epoch (6.22).
- **Payments (v1.1):** card data never stored, processed or logged; Razorpay-hosted pages; webhook signatures verified and payment status fetched server-side; Razorpay secrets only in the Hub and Udofin's B2C billing service; billing rails never touch loan money (6.27) [VERIFY: PCI DSS v4.0.1 self-assessment type for the hosted-page integration].
- **Workplace and monitoring (v1.1):** no borrower or member data in Google Workspace (no India data region); Microsoft 365 holds such data only with India data-location evidence; staff monitoring limited to sign-in and sign-out, self-entered timesheets, device compliance and security logs, never keystroke, screenshot, webcam, off-duty location or covert monitoring (DPDP; 6.23).
- **Patch and remediation SLAs (v1.1):** platform product code and infrastructure in every group repository follow Finbyx EO1.6 from triage (critical, CISA KEV-listed or exploited 72 hours; high 7 days; medium 30 days; low 90 days), tracked in OH13; tenant and internal audit findings default to 15, 30, 90 and 180 days by rating (Finbyx AU4.3); the stricter applies.
- **Certification claims (v1.1):** PCI DSS, SOC 2 Type 1 and Type 2 and ISO certifications are programmes; no product, website or sales material claims a certification before the report or certificate is issued (OH14 claims gate).
- **LawDocs retention and incidents (v1.2)** *(v1.2, from LD App. Y)*: eSign evidence (consent version, request and response, ESP transaction ids, certificates, audit trail) ≥ 7 years after the later of signing and account closure (eSign API v3.3 log archiving; Limitation Act 1963) [REC]; stamp certificates for the life of the instrument plus limitation; court-case records until disposal plus 12 years where a decree may be executed (Limitation Act Art. 136) [REC]; sharing-ledger entries 8 years [REC]; a LawDocs incident involving DigiLocker-pulled data starts a 24-hour NeGD notice clock in addition to CERT-In (6 hours) and DPDP duties; no document content, signer consent payloads or stamp certificate images in logs, traces or DLQ metadata; LawDocs JWKS per environment.
- **White-label hosts and brand media (v1.2)** *(v1.2)*: `Host` and `X-Forwarded-Host` validated against the group host registry at the edge (host-header attacks select nothing); brand SVGs sanitised and re-serialised at upload (IPB-04-21); fonts self-hosted; pack publish requires maker-checker and, for legal and policy fields, `PLT_LEGAL_REVIEWER`; consent artefacts captured under a brand carry `brand_pack_id` and notice version so that withdrawal propagates per brand and group-wide (6.39).
- **Agents (v1.2)** *(v1.2)*: delegations across products carry consent, run under the target's ceiling and never reach the locked list (4.9); every delegation is in both Vidhi ledgers; prompt-injection guards apply to `inputs_ref` content as untrusted data (IPB-02-72, IPB-03-42); a scheduled task whose grant or consent was revoked is skipped and `in.[product].vidhi.ScheduleRunSkipped.v1` is emitted internally.
- **Marketing tooling (v1.2)** *(v1.2)*: no pixel, tag or analytics call fires before the CMP records consent for its category (`MarketingConsentUpdated` GRANTED or the local CMP receipt); withdrawal stops it within 60 s; WhatsApp marketing templates are sent only under `MARKETING_WHATSAPP` consent and never for collections (4.4).

---

# 14 — VERSIONING, CHANGE CONTROL AND CERTIFICATION

## 14.1 Versions

Specification: **major** for breaking meaning, ownership or mandatory fields; **minor** for new events, APIs, optional fields, codes or connectors; **patch** for clarifications; the change log is Part 16 from v1.1. Schemas are BACKWARD-compatible within a major; a breaking change publishes `v[major+1]` and both run ≥ 90 days. Superseded API majors return `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers. Connectors recertify when a field they use changes.

**IPB change-propagation rule** *(v1.2)*. The Infrabyx Platform Baseline Standard is versioned independently (semver, IPB `00_README.md` §6). A change to the IPB is proposed as a change request, approved by the owner and propagated to every product's decision log within ten working days — the same rule as 14.2. Where an IPB change touches a cross-product contract (an event name, envelope attribute, schema, scope, link, layout or ownership), it is **not effective until this Specification carries it**: the IPB file lists the item as a proposal (its "Proposed Ecosystem events" table or an open item), the Specification registers it under 14.2, and the product packs then cite the Specification section. A product may not emit an `in.infrabyx.*` type on the strength of an IPB proposal alone (IPB-10-41). Conversely, a change to this Specification that alters a product-internal baseline (runtime pin, port name, error-code grammar, settings-tree node) is raised as an IPB change request and recorded in Appendix C when accepted. The two documents cross-reference by version in their headers; a mismatch between the IPB version a product pack names and the one this Specification names is a CI failure in `docs/ecosystem/` and `docs/ipb/`.

## 14.2 Change process

Proposal `infrabyx-contracts/proposals/[date]-[slug].md` (motivation, regulatory basis, affected products, events, APIs, schemas, mappings, tests, rollout, rollback) → impact review by each product lead → approval by every affected owner in the pull request → registry, SDK and Pact publication → parallel run and recertification → propagation within 10 working days.

## 14.3 Certification suite

| Group | Tests |
|---|---|
| Contract | Messages validate; required attributes; projections carry no forbidden fields |
| Security | mTLS enforced; RFC 9421 verified; tampered body, wrong key, stale timestamp rejected; scope, audience and tenant isolation enforced |
| Idempotency and ordering | Duplicates harmless; key reuse with new body gives 422; concurrent retry gives 409; out-of-order resolved; replay reproduces state |
| Resilience | 4-hour outage; slow and partial failures; DLQ replay under maker-checker; per-tenant circuit breakers |
| Regulatory guards | LSP-controlled account rejected; referral without basis rejected; Udofin cannot refer, approve, issue notices or invoke; personal data without consentref rejected; contact before agent notice blocked |
| Reconciliation and privacy | Synthetic month reconciles; injected breaks caught; withdrawal stops processing; legal hold blocks erasure; no personal data in logs |
| Operations | Health, metrics, traces, monitor visibility |
| Filing boundaries (v1.1) | No regulator-portal credential, OTP, cookie or token field, secret or HTTP client for a regulator domain; the ADF adapter returns `channel-not-confirmed` without evidence; an e-mail contingency filing without RBI advice cannot be saved |
| Bureau formats (v1.1) | Golden consumer, commercial and MFI files per cycle code match fixtures and each CIC validator [VERIFY: availability]; `~` or `^` never reaches a commercial file; an MFI loan never appears in a consumer file; late transmission raises a compliance issue |
| Aggregates only (v1.1) | Every Operations Hub subject rejects a seeded loan, borrower, member or user identifier with `dataclass-not-permitted`; `UsageRecorded` and `MatterAllocated` schemas forbid record ids and party data; the `PeriodClosed.oh` projection carries no hash or amount; `TenantProvisioned` without `legalbasis` is rejected; governance and tenant workforce subjects cannot be subscribed by the Hub |
| Isolation (v1.1) | No schema declares `WELLNESS`; insurance events reach only insurers; an RE archive scan finds no wellness, insurance or other-RE data; the Equator separation-of-duties rule blocks a combined grant |
| External and group access (v1.1) | No write path with a workspace token; expiry ends sessions within 60 s; grants longer than 90 days are rejected; unmasking needs a reason; exports are watermarked and capped; a group grant without both entity approvals and the DPO is rejected |
| Risk feed (v1.1) | No raw PII in `risk` payloads; HMAC references cannot be resolved by LDC and resolve inside the producer; replay reproduces identical hashes and the `prevhash` chain; a KRI for an unknown metric is rejected |
| Archive and storage (v1.1) | The verifier passes on a full synthetic archive and fails on one changed byte or a missing file; the README names every folder; Office and PDF/A files render headless; a non-India bucket is refused for loan data; Google Drive never accepts regulated classes; a canary mismatch is detected; BYOK revocation fails closed; write-once locks are set when chosen |
| Member and group lending (v1.1) | No deposit route exists for societies; a nominal or non-voting member cannot reach a loan screen; a society product never appears in the RE offer view; co-lending, transfer or DLG between a society and an NBFC is rejected with `regulatory-guard`; a group is recognised only on `GroupFormed` |
| Billing and deals (v1.1) | An unsigned entitlement or catalogue is rejected; dunning never blocks a regulated function, read access or export; a browser redirect never marks a payment; no borrower journey exists before `LenderDealActivated` with `mode = PILOT` |
| Rule pack (v1.1) | An unsigned or tampered Labour Code pack is refused; Finbyx GV6 and OH10 produce identical golden-fixture results; a rule still marked VERIFY cannot drive a statutory output |
| Legal-tech boundaries (v1.2) *(v1.2, from LD App. Y)* | No product client can obtain ESP credentials, ASP keys, raw eSign transactions or signing URLs from LD; ceremony pages refuse framing; attempts return `regulatory-guard`; a `POST /v1/signing-requests` for a will, trust deed, ordinary power of attorney or a promissory note not in favour of a listed regulated entity returns `WET_INK_REQUIRED` and no ESP call is made; a chargeable instrument without a verified `stamp_instrument` cannot reach INVITED; `ADRReferralCreated` from LD with `dispute_origin = LOAN` is rejected with `regulatory-guard`; LD receives no hearing content, selection log, mandate or other parties' documents in any `adr` projection; any message declaring `CONSUMER_HELP` is rejected by every gateway and no subscription to a Consumer Help subject can be registered; a seeded group client returns `is_group_client = true` and nothing else; an OH or other-organisation subscription to a `legal` subject is refused at registration and at the gateway; governance events reach LD only with an active `legal_sor_link` of the same `org_id`; only `buyer_billing_identity.*` with `legalbasis = CONTRACT_PERFORMANCE_CUSTOMER` passes to OH as PII and a seeded vault, matter or document id in any OH payload is rejected with `dataclass-not-permitted`; a deposit whose bytes do not match `sha256` or whose JWS fails is rejected, `WELLNESS` is rejected and LD returns no account or folder data; all four LawDocs profiles contain `00 Start Here/`, `owner_readable` names appear only in archives addressed to the owner, an `ld_consumer_help_v1` archive addressed to anyone other than the data principal is refused; closed OH schemas reject an unknown field (`document_titles`, `complaint_text`); `ServiceOrderRouted` without a buyer `consentref` is rejected and none exists for a Consumer Help order; a `MarketplaceTransferInstructed` `RELEASE` replayed with the same idempotency key produces one release and a `RELEASE` under an open dispute is refused; a subject token older than 60 s, reused or with another audience is refused, the launch creates no role or membership, and Consumer Help is never a source or target |
| Product scope, brand and white-label (v1.2) *(v1.2)* | A Hub request outside `product_scope[]` is refused `product-scope-denied` although entity and role match; a `group_grant` without `product_scope` is rejected; expiry ends sessions within 60 s; the Equator separation-of-duties rule blocks a combined grant; a host listed in two packs is refused group-wide; an unknown `Host` or spoofed `X-Forwarded-Host` serves the default pack with `noindex` and never a tenant pack; a pack fails publish on contrast-guard failure, unsanitised SVG, unverified e-mail domain or (Udofin) missing `dla_ids`; `WhiteLabelTenantProvisioned` for a Udofin brand whose `legal_entity` lacks `is_lsp` or `is_re` is rejected with `regulatory-guard`; `terminology_override` changes no event name, scope, schema field or kernel identifier; a reseller principal cannot obtain a `group_grant` into an end-customer tenant; `WhiteLabelTenantExited` deletes nothing and keeps the redirect for ≥ 90 days; a `CatalogueChanged` with an unsigned catalogue is rejected |
| Delegation, trust and content (v1.2) *(v1.2)* | A `VidhiTaskDelegated` without `consentref` or `legalbasis` is rejected `consent-missing` before any skill runs; a locked-list `task_type` is rejected `locked-action` and the requesting skill is auto-demoted; the effective level is the lower ceiling; `kill.vidhi.a2a` yields `delegation-not-permitted`; a delegation referencing `REGULATED`, `SPI`, `HR`, `WELLNESS` or `CONSUMER_HELP` is rejected; a mirror with a digest mismatch keeps the previous verified version and raises `mirror-digest-mismatch`; a `WITHDRAWN` document disappears from every mirror within 60 s; a product cannot edit a mirrored `vad_`; `LeadCaptured`, `CareerApplicationReceived` and `FeedbackSubmitted` carrying a name, e-mail, mobile, Aadhaar, PAN or account pattern in clear are rejected by schema and scanner; `MarketingConsentUpdated` WITHDRAWN stops every consumer within 60 s and no pixel fires before GRANTED; a `WhatsAppTemplateApproved` MARKETING template cannot be sent to a principal without `MARKETING_WHATSAPP` consent; `BlogPostPublished` and `ResourcePublished` without a passing `claims_check_id` are rejected; an unregistered `in.infrabyx.*` type fails the event-catalogue lint in every product CI (IPB-10-41) |

Results emit `ConnectorCertified` and `ControlTestResultPublished`.

---

# 15 — ROLLOUT PLAN ACROSS PRODUCTS

| Phase | Implements | Exit evidence |
|---|---|---|
| Finbyx 8c | Part 3 core; 6.2–6.4; consentref | Pact with Udofin; Finbyx runs with Udofin down |
| Udofin 9 | LSP side of 8c; generic LOS/LMS connector; certification runner | Finbyx connector certified |
| Finbyx 12 — Recovery Suite core | 6.7 (`RecoveryAgentNoticeSent`); 6.8 case, strategy, notice, service, receipt and closure events (settlement events in 12b; repossession, auction and surplus in 17b); 6.10; `LegalHoldChanged`; dispatch and court-data adapters; module registry, attach and detach (11.1); recovery layouts | Attach and detach with export pack |
| Finbyx 12b — Settlement and ADR with Equator | 6.9; Part 8 gates and `OdrProvider`; settlement events | Equator certified; referral to compliance on sandbox |
| Udofin 12b — Recovery support, notices, ADR access | LSP projections; settlement relay and acceptance; agent-notice gate; Equator launch (4.4) | Guard tests pass |
| Udofin 13 — DLG | DLG domain (6.11) | Disclosure and ledger reconciliation |
| Finbyx 16 | 6.6; RE-side DLG | T+1 sync; three-way escrow |
| Finbyx 16b — Ecosystem integration hub v2 | Part 7 lifecycles incl. LAS; Parts 9, 10, 12; certification service; privacy and incident events | All connectors certified; OSCAL package |
| Udofin 16b — Ecosystem integration v2 | Part 7 incl. LAS event contracts; Equator; GRC; privacy and incident events (first built in Udofin Phases 3b and 16) | Recertified; Pact suite passes per product lifecycle |
| Finbyx 17 — Secured products | Collateral domain (6.5); LAS engine (7.3) | Pledge, valuation, margin call, release on sandbox rails |
| Finbyx 17b — Secured enforcement and shared-exposure recovery | Repossession, auction, surplus, invocation; e-auction listings through the 16b adapter; ICA votes; shared-exposure rules | Statutory-clock tests pass |
| Udofin 18, 18b | LAS, Home, LAP, Vehicle; then Gold, MSME, Microfinance, Supply-chain and TReDS, Education (Products 11–15) | Per-product fixtures pass; LAS journey end to end on the Finbyx 17 sandbox |
| LawDocsComply | 9.3 connector | Certified against both 16b phases |
| Finbyx 1 (EO1 controls from the start) | `ReleasePublished` and `ControlEvidenceCollected` emitters in CI; registry compatibility check | Branch protection and required checks evidenced |
| Finbyx 13b — Accounting, statements, tax and audit trail | 6.20; `gst_export_v1`, `tds_export_v1` | `PeriodClosed` drives the 7B clocks on sandbox; GSTN schema validation passes |
| Finbyx 14b — Returns and supervisory portal workflows | 6.18; `return_package_v1`; `ReturnStatusUpdated` mapping | Filing-boundary group passes; LDC receives the lifecycle |
| Finbyx 14c — Credit bureau submissions | 6.19; bureau layouts | Bureau-format group passes for all four CICs on test endpoints |
| Finbyx 14d — Risk, capital, ICAAP and dashboards | 6.22 incl. the LawDocsComply risk feed; `risk_snapshot_v1`, `ratio_catalogue_v1` | Risk-feed group passes against the LDC sandbox |
| Finbyx 15b — Portability and customer storage | 6.26; 12.1; 12.2 | Archive and storage group passes; one restore test per synthetic tenant |
| Finbyx 16c — Audit and assurance | 6.21; 4.7 with AU7 as master register; `audit_workpaper_index_v1` | External-access group passes; grant federated to the Udofin sandbox |
| Finbyx 16d — Governance, listed compliance, HRMS, workplace | 6.23 tenant-internal routing; 12.3 consumer | Hub subscription refused; rule-pack fixtures pass |
| Finbyx 16e — Plans, entitlements, billing | 6.27 consumer and `UsageRecorded` | Signed-entitlement and dunning tests pass against the Hub O6 sandbox |
| Finbyx 17c — Co-operatives, co-operative banks, microfinance | 6.24 producer; `member_register_v1`, `share_ledger_v1`, `jlg_group_v1` | Member and group lending group passes |
| Finbyx 17d — ARCs, IFSC entities, investments, servicing | 6.25; `investment_position_v1`, `sr_register_v1`, `servicer_report_v1` | Waterfall, SR and NAV events on sandbox |
| Finbyx 18b and Udofin 20d — Voice, AI contact centre, Jio | 10.2 voice row | DLT and 1600-series checks pass |
| Finbyx 20b — Engineering evidence and certification readiness | 6.29 engineering events to OH13 and OH14; `AccessReviewCompleted` (PLATFORM) | Evidence freshness visible in OH14 |
| Udofin 3c — Lender partnerships and deal configurator | 6.28; `deal_config_v1`, `re_audit_pack_v1` | RE consumer (Finbyx 16b sandbox or a logged manual channel) records deals in the LSP register |
| Udofin 11b — Borrower downloads and tax documents | `InterestCertificateIssued` consumer; UB1 exports stay internal | Certificates shown only as RE-signed |
| Udofin 14b — Grievance escalation chain v2 | 6.12 additions | Ombudsman window computed; reopen and rating reach the host |
| Udofin 16c — Risk, supervisory access, portability, engineering | 6.22 (LSP metrics), 6.21 (RA2), 6.26, 6.29 | Risk-feed, external-access and archive groups pass |
| Udofin 18c — Member and group lending | 6.24 consumer; society APIs; `lender_type` | Member and group lending group passes against Finbyx 17c |
| Udofin 20b — Wellness add-ons, plans and billing | 6.27 B2C rules (Udofin-internal) and `REVENUE_AGGREGATE` usage | Isolation group passes; the Hub receives aggregates only |
| Udofin 20c — Extensible products and insurance | 6.30 | Insurer connector certified only after the licence decision |
| Operations Hub O1–O2 | 4.6 group identity, grants, legal-entity scoping, Equator wall | Grant-expiry and separation-of-duties tests pass |
| Operations Hub O3–O6 | 6.29 CRM requests, provisioning and acknowledgement, milestones and tickets; 6.27 catalogue, quotes, orders, usage disputes, entitlement reconciliation, billing and Razorpay | Usage from Finbyx 16e and Udofin 20b sandboxes reconciles to invoices |
| Operations Hub O8–O9 | 6.29 directory events and APIs; 6.23 Hub-scope workforce events; 12.3 publisher | Equator conflict API returns counts only |
| Operations Hub O11–O12 | Workplace adapters (10.2); 6.29 engineering console and claims gate; 6.26 counts and own backups; 6.21 provider-assurance grants (OH14) | Change and evidence events from both products visible |
| LawDocsComply v1.1 | 6.22 risk-feed consumer; KRI and obligation pull; 6.18, 6.21 and 6.23 consumers | Certified against Finbyx 14d and Udofin 16c |
| **All products — IPB wave 0 (P00 / Phase 0)** *(v1.2)* | `docs/ipb/` and `docs/ecosystem/` committed; Node 24.22.1 pin; port catalogue; error-code prefix (3.12, Appendix C); event-catalogue lint for `in.infrabyx.*` | `pin-check`, `schema-boundary` and the catalogue lint green; Appendix C row confirmed by the product |
| **Website and CMS wave (IPB-04) — every product's `apps/public`** *(v1.2)* | 5.4 `brand_pack` shared shape and `BrandPackPublished`; 6.27 `CatalogueChanged` consumer; 6.38 `BlogPostPublished`, `ResourcePublished`, `GlossaryEntryPublished`; 6.39 `LeadCaptured`, `MarketingConsentUpdated`, `CareerApplicationReceived`; 6.40 `FeedbackSubmitted` / `FeedbackStatusChanged`; 6.15 `PolicyEffective`; claims gate before publish | Delegation, trust and content group passes; no pixel before consent; OH3 receives a lead with consent evidence from each product's sandbox |
| **Vidhi wave (IPB-03) — every product** *(v1.2)* | 4.9 contract; 6.36 `VidhiTaskDelegated`, `VidhiTaskAccepted`, `VidhiTaskCompleted`, `VidhiTaskRejected` (read skills only); `kill.vidhi.a2a`; 6.37 `ReleaseNotePublished` for What's new | Locked-action, ceiling and consent tests pass between two product sandboxes (first pair LDC ↔ LD) |
| **Trust publication wave (IPB-08) — OH14.6 then every product** *(v1.2)* | 6.34 `VendorAssuranceDocumentPublished`, `StateChanged`, `Acknowledged`, `RequestOpened`, `AuditorGrantChanged`, `ClaimRegisterChanged`; TRUST port mirror; 6.16 `ExitDrillCompleted`, `ProviderIncident` to OH | Mirror digest, withdrawal and staleness tests pass; Trust Centre renders from mirrors only |
| **White-label wave (IPB-D-10) — OH4/OH8, Udofin, Finbyx** *(v1.2)* | 5.4 contract; 6.35 `WhiteLabelTenantProvisioned`, `WhiteLabelTenantExited`; host registry API; `product_scope[]` (4.8) in OH | Product scope, brand and white-label group passes; a Udofin brand without `dla_ids` cannot publish [OWNER: resale entity and terms — IPB open item 2] |
| **LawDocs P19 — Ecosystem integration** *(v1.2, from LD App. Y)* | Registry entries for `LD`; 6.29 provisioning, billing, usage; 6.31 `legal`; 6.32 `esign`; 6.33 `ip`, `engagement`; 12.5 profiles and layouts; 4.4 token exchange; interim manual channel until each pair is certified | Legal-tech boundaries group passes; Pact with OH; LD runs with OH down |
| **LawDocsComply v1.3 (P18, P26)** *(v1.2, from LD App. Y)* | `legal_sor_link`; `SystemOfRecordSwitched`; `legal` and `ip` projections; governance read APIs; `ServiceOrderRouted` consumer and `ServiceOrderStatusChanged` producer; hosted signing hand-off replaces "LawDocs eSign (group)" | Routing and system-of-record switch tests pass against the LD sandbox |
| **Equator v3.2 (P09)** *(v1.2, from LD App. Y)* | Party-initiated referrals from LD (`adr.referral:create.party`); `.party` projections; LD delivery roles in separation-of-duties; `lawdocs_esign` route withdrawn | No-loan-referral and party-view tests pass |
| **Finbyx v1.6 (16b, 16d) and Udofin v1.3 (opt-in)** *(v1.2, from LD App. Y)* | Finbyx: template packs, `.legal` litigation projection, signing hand-off, governance read APIs; Udofin: "Save to LawDocs" deposit under `deposit_link` | Pact with LD; deposit and Consumer Help wall tests pass |
| **Operations Hub v1.1 (O3–O9, O14)** *(v1.2)* | `LAWDOCS` product value; LD scopes; `TenantRegistered`, engagement, retainer, `MarketplacePayoutSettled` / `MarketplaceTransferInstructed`, Y.7.10 contracts; `CONTRACT_PERFORMANCE_CUSTOMER` ceiling exception; OH14.6 as `trust` producer; WhatsApp template registry; `product_scope[]` | Aggregates-only group updated; ceiling-exception test; client-conflict API returns flags only |

**Sequencing:** Udofin 16b needs the Finbyx 16b sandbox; Udofin LAS needs Finbyx 17; Finbyx 12b production needs Equator certification. From v1.1: Finbyx 16e and Udofin B2B invoicing need Operations Hub O6; Finbyx R11 directory use needs O8; Finbyx 16d and O9 need Labour Code rule pack 1.0 (12.3); Udofin 18c needs Finbyx 17c or a certified society LOS; Udofin 3c needs an RE consumer for deal events (Finbyx 16b, or the RE's manual channel, logged, until then); grant federation needs Finbyx 16c and Udofin 16c; Finbyx Phase P needs 13b, 14b, 14c, 14d and 15b.

---

# 16 — CHANGE LOG

## 16.1 v1.2 change log *(v1.2)*

**Version 1.2 · 26 October 2026 · minor version** (new owner code, product, principles, entities, domains, events, APIs, optional fields, scopes, code-table values, layouts and certification groups; no published schema changes meaning, ownership or a mandatory field, so no parallel run is required: Part 14.1). Implemented by the LawDocs Build Prompt Pack v1.1, the LawDocsComply Build Prompt Pack v1.3, the Equator Build Prompt Pack v3.2, the Finbyx Master Build Prompt v1.6, the Udofin Master Build Prompt v1.3 and the Infrabyx Operations Hub Master Build Prompt v1.1, under the Infrabyx Platform Baseline Standard v1.0.

| Area | Change | Products affected |
|---|---|---|
| Title, What changed, How to use, Part 1 | Companions updated to the v1.2 set and the IPB v1.0; IPB precedence paragraph; LawDocs (`LD`) and the IPB rows in the product table | All |
| Part 2 | Principles 14 (Consumer Help wall), 15 (eSign never shared), 16 (agents delegate only by contract) | All |
| Part 3 | `lawdocs` source; `legalbasis` value `CONTRACT_PERFORMANCE_CUSTOMER`; optional envelope extensions `brandid` and `environment`; regulated-message list extended (nine LD messages plus `WhiteLabelTenantProvisioned`, `WhiteLabelTenantExited`); error codes `product-scope-denied`, `delegation-not-permitted`, `locked-action`, `brand-host-unknown`, `mirror-digest-mismatch`; new 3.12 runtime, port and error-code alignment | All |
| Part 4 | 4.1 links `legal_sor_link`, `signing_handoff_link`, `deposit_link`, `finbyx_legal_link`, `whitelabel_link` and the legal-matter system-of-record rule; 4.2 LD realms; 4.4 cross-product customer sign-in by token exchange; 4.5 scopes; 4.6 Equator wall extended to LD delivery roles; new 4.8 `product_scope[]`; new 4.9 Vidhi delegation | All |
| Part 5 | Owner `LD`; entities 46–58; amendments to #20, 23, 24, 25, 28, 29, 36, 38, 39, 40, 41, 42, 44; code tables incl. `product`; new 5.4 `brand_pack`, `terminology_override` and the white-label contract | All |
| Part 6 | Tags (N12), (N12+), (IPB); 6.9 party-initiated referrals; 6.10 `.legal` projection; 6.13 deposits; 6.15 `PolicyEffective`, `VulnerabilityRecorded`; 6.16 `ProviderIncident`, `ExitDrillCompleted`; 6.17 v1.2 superseded names; 6.23 routing amendment and governance APIs; 6.27 `CatalogueChanged`, order fields, LD/LDC/EQ usage; 6.29 fourteen LD/OH events and four APIs plus directory amendments; new domains 6.31 `legal` (12 events, 4 APIs), 6.32 `esign` (6 events, 3 APIs), 6.33 `ip`/`engagement` (6 events), 6.34 `trust` (6 events, 2 APIs), 6.35 `tenancy` (3 events, 2 APIs), 6.36 `vidhi` (4 events), 6.37 `eng` (3 events), 6.38 `cms`/`content` (3 events), 6.39 `crm`/`consent`/`messaging`/`workforce` (4 events, 2 APIs), 6.40 `feedback`/`identity` (4 events) — 71 new events and 20 API endpoints in all | All |
| Part 8 | 8.1 LawDocs as a party-initiated referrer for non-loan disputes; Equator one provider behind LawDocs' `ODR` port | Equator, LawDocs |
| Part 10 | IPB connector manifest as the product-side description | All |
| Part 11 | `LAWDOCS` product value | LawDocs, OH |
| Part 12 | 12.1 naming mode `owner_readable`; new 12.5 LawDocs profiles and thirteen layouts (eleven LD, `brand_pack_export_v1`, `vendor_assurance_index_v1`) | LawDocs, LDC, OH |
| Part 13 | Class `CONSUMER_HELP`; `x-privileged`; OH ceiling exception; retention, incident, white-label, agent and marketing controls | All |
| Part 14 | IPB change-propagation rule; certification groups "Legal-tech boundaries", "Product scope, brand and white-label", "Delegation, trust and content" | All |
| Part 15 | IPB wave 0; website and CMS, Vidhi, trust publication and white-label waves; LawDocs, LDC, Equator, Finbyx, Udofin and OH rows | All |
| Appendices | A.6–A.10 example payloads; new Appendix C cross-pack consistency table | All |

**Adversarial review of 26 October 2026 (IPB v1.0 and this Specification)** *(v1.2 rev. 26 Oct 2026)*. Fixes recorded in `Infrabyx Platform Baseline Standard v1.0/_review/IPB_v1.0_adversarial_review_log.md`; the Specification changes are:

* 3.12: capability-port list completed with `LLM`, `SPEECH`, `PAYMENTS`, `PAYOUTS`, `BILLING`, `CRM`, `GEO/MAPS`, `WORKSPACE` (all IPB-01 §01.4.4.2 ports that were missing); shared-baseline problem-code prefixes extended to every area the IPB files actually use; `IPB-LLM` retired in favour of `IPB-AI`.
* 13.2: paragraph relating the wire classes to the five IPB handling tiers, with the mapping (`PII`, `SPI`, `FINANCIAL`, `LEGAL`, `HR`, `WELLNESS`, `CONSUMER_HELP`); `REGULATED` in this Specification means the IPB tier.
* 4.9: delegation state machine gains terminal-state precedence (cross-over of `CANCEL` and `VidhiTaskCompleted`), `CONSENT_WITHDRAWN` rejection and two scenarios.
* 6.32: stamp-verification failure path (WITHDRAWN, actor `SYSTEM`, reason `STAMP_VERIFICATION_FAILED`) and sha256 mismatch refusal at CREATED.
* IPB files aligned to this Specification: proposed event names replaced by the registered canonical names (`ops.ControlEvidenceCollected`, `grc.VulnerabilityRecorded`, `privacy.ConsentRecorded` / `consent.MarketingConsentUpdated`, `feedback.FeedbackSubmitted`, `trust.VendorAssuranceDocumentPublished`, `billing.SubscriptionPaymentReceived`); environment catalogue unified (nine names, IPB-09 binding); settings-tree paths aligned to IPB-07 node names; `ORG` tier replaced by `TENANT` in IPB-08.

**Names settled in v1.2.** `VendorAssuranceDocumentPublished` (not `AssuranceDocumentPublished`, `RoomDocumentPublished` or `AccessibilityStatementPublished`); `FeedbackSubmitted` (not `ItemCreated`, `FeedbackItemCreated` or `AccessibilityIssueOpened`); `LeadCaptured` (not `LeadCreated`); `VidhiTaskDelegated` (not `DelegationRequested`); `ReleaseNotePublished` for communication and `ReleasePublished` for the deployment fact (not `release.ReleasePublished`); `UserPreferencesSynced` with `preference_set = A11Y` (not `AccessibilityPreferencesSynced`); AI usage through `UsageRecorded` (not `ai.UsageMetered`); `platform.ProviderIncident` (not `ai.ProviderIncident`); `ops.ServiceOrderRouted` and `ops.ServiceOrderStatusChanged` (not `services.*` or `compliance.*`); `CareerApplicationReceived` in `workforce` (not `hr.ApplicationReceived`); the `product` code table is `FX`, `UD`, `EQ`, `LDC`, `LD`, `OH`, `RS`.

**Approvals required.** LawDocs, LawDocsComply, Equator Resolution, Finbyx, Udofin and Operations Hub product owners (all Parts; LawDocs Appendix Y §Y.1 approval record); Recovery Suite / Udolex (consumer additions in 6.10); DPO for `CONTRACT_PERFORMANCE_CUSTOMER` and the OH ceiling exception; counsel for principle 15, the Consumer Help wall and the Udofin DLA rule in 5.4 [COUNSEL]. Until the affected owners record approval, the (A) rule in 6.1 applies to every (N12) event.

**Propagation.** Every repository adopts v1.2 within 10 working days of approval (by 9 November 2026 if approved today, adjusted for holidays) [REC]; connectors using the new domains are certified against the 14.3 groups added in v1.2 before touching real data; each product pack records the twelve IPB decisions and any `IPB-DEV-nn` in its decision log.

**Open items carried as [VERIFY] or [OWNER] from v1.2.** ESP/aggregator confirmation that LawDocs-hosted ceremonies created through a customer's own systems are within ASP terms (LawDocs OI-Y-02); `CONTRACT_PERFORMANCE_CUSTOMER` and B2C invoicing on OH8 (OI-Y-03; tax memo); Consumer Help conflict policy where the respondent is a group client (OI-Y-04); LDC P26 overlap (OI-Y-05); kernel export schema versions (OI-Y-06); `owner_readable` acceptance (OI-Y-07); BSA s.63(4) citation (OI-Y-08); token-exchange parameters (OI-Y-09); OH7 asset-library path and `crm/leads` field set (OI-Y-10); `ops` as the service-order domain (OI-Y-11); white-label resale entity and commercial terms (IPB open item 2); WhatsApp BSP and Meta business verification entity (IPB open item 4); Payment Aggregator Directions paragraph references for Route transfers; each product's confirmation of its error-code prefix and export package name (Appendix C).

## 16.2 v1.1 change log

**Version 1.1 · 24 October 2026 · minor version** (new events, APIs, optional fields, codes, layouts and connectors only; no published schema changes meaning, ownership or a mandatory field, so no parallel run is required: Part 14.1). Implemented by the Finbyx Master Build Prompt v1.5, the Udofin Master Build Prompt v1.2 and the Infrabyx Operations Hub Master Build Prompt v1.0.

| Area | Change | Products affected |
|---|---|---|
| Title, How to use, Part 1 | Companion prompts updated; Operations Hub (`OH`) and non-RE lenders added as parties | All |
| Part 2 | Principles 11 (prepare, validate, a human files), 12 (aggregates only to the Hub) and 13 (wellness data never shared) | All |
| Part 3 | `oh` source (`urn:infrabyx:oh:[legalentityid]`); `legalbasis` value `CONTRACT_PERFORMANCE_VENDOR`; non-RE lender ids in `reid`; regulated-message list extended; error codes `dataclass-not-permitted`, `residency-blocked`, `channel-not-confirmed`, `grant-expired`, `entitlement-missing` | All |
| Part 4 | 4.1 role flags `is_group_operator`, `is_non_re_lender`; new 4.6 (group identity, grants, Equator wall, Hub data limits) and 4.7 (external auditor and supervisor access); new scopes | All; Equator for the wall |
| Part 5 | Owners OH, INS, CIC; entities 30–45 | All |
| Part 6 | Tags (N11) and (N11+); parties OH, INS, CIC, TR, SOC; new domains 6.18–6.30 (79 events, 23 API endpoints, optional field `lender_type`); grievance rows `OmbudsmanReferralRecorded`, `GrievanceReopened`, `GrievanceRated` (82 new events in all); v1.1 superseded names in 6.17; 6.15 and 6.16 rows extended for the Hub (`SecurityIncidentNotified` copy to OH13; `ModuleAttached` and `ModuleDetached` from product entitlement services to OH8; `ConnectorCertified` to OH13) | Finbyx, Udofin, OH, LDC, Equator (directory conflict API) |
| Part 7 | Common rules for non-RE lenders; matrix rows for co-operative member loans and microfinance groups; new reconciliation points | Finbyx, Udofin |
| Part 10 | Adapter catalogue rows: CICs, regulator portals (manual only), tax utilities, storage, workplace, CRM, billing, voice, market data, insurers, statutory HR portals | All |
| Part 11 | Onboarding checklist item 10 and the Operations Hub worked example | OH |
| Part 12 | 12.1 archive standard, 12.2 storage connector contract, 12.3 Labour Code rule pack, 12.4 nineteen new layouts | Finbyx, Udofin, OH |
| Part 13 | Data classes `HR` and `WELLNESS`; group, external-access, storage, payment-card, workplace, monitoring and patch-SLA controls; legal baseline additions | All |
| Part 14 | Change log moved to Part 16; certification groups for the new domains | All |
| Part 15 | Rollout rows for Finbyx 13b–20b, Udofin 3c–20d, Operations Hub O1–O13, LawDocsComply risk feed | All |

**Names settled in v1.1** (earlier names map as in 6.17). Billing payments are `SubscriptionPaymentReceived` and `SubscriptionPaymentFailed` (not `PaymentReceived` and `PaymentFailed`); `LenderDealActivated.mode` values are upper-case (`PILOT`, `GENERAL`); the society field is `lender_type` with value `NON_RE_SOCIETY` (not `lendertype` or `NON_RE_COOP`); usage carries `meter_kind`; risk-feed extension attributes are `asof`, `metricversion`, `citation`, `contenthash`, `prevhash` (CloudEvents 1.0.2 forbids underscores in extension names); `PeriodClosed` carries `lock_version`; `MatterAllocated` carries `status` and `update_seq`; the Hub APIs are `GET /v1/catalogue/versions/{v}`, `GET /v1/directory/professionals` and `POST /v1/conflicts/check`; `AccessReviewCompleted` carries `review_scope`; archive datasets are named `[dataset].csv` and the start folder is `00 Start Here` in every profile.

**Approvals required.** Finbyx, Udofin and Operations Hub product owners (all Parts); Equator (4.6 wall and the directory conflict API); LawDocsComply (6.22 feed and inbound KRI and obligation pull). Until both Finbyx and Udofin approvals are recorded for a cross-product event, the (A) rule in 6.1 applies.

**Propagation.** Every repository adopts v1.1 within 10 working days of approval (by 6 November 2026 if approved today, adjusted for holidays) [REC]; connectors using the new domains are certified against the 14.3 groups added in v1.1 before touching real data.

**Open items carried as [VERIFY].** CIMS ADF availability for NBFCs and UCBs; HFC returns to NHB; CIC encryption rules for correction files; CIC membership for credit co-operative societies; Income-tax Act 2025 section and form concordance (s.22, s.123, s.129; Form 140 utility; SAC for SaaS); Microsoft 365 data-location evidence through Graph; State Labour Code rules; MFI contact window under the RBC Third Amendment; app-store policy for non-RE lenders; Insurance Act s.40 after 2025; counsel opinion on notifying REs of direct RBI requests.

---

# APPENDIX A — EXAMPLE PAYLOADS

Illustrative: identifiers, hosts and values are synthetic; `registry.infrabyx.example` stands for the registry host fixed by ADR. A.1 shows the full envelope; A.2–A.5 abbreviate the common attributes as `"…"`.

**A.1 `ApplicationSubmitted` (Udofin → Finbyx)**

```json
{"specversion": "1.0", "id": "01a152c9-ead8-7b2e-9a1d-3f6c2b8e4d10",
 "source": "urn:infrabyx:udofin:ten_01J9ZQ8K7H", "type": "in.infrabyx.origination.ApplicationSubmitted.v1",
 "subject": "app_01J9ZQB3W4X6", "time": "2026-10-19T11:42:07+05:30", "datacontenttype": "application/json",
 "dataschema": "https://registry.infrabyx.example/schemas/origination/ApplicationSubmitted/1.2.0.json",
 "tenantid": "ten_01J9ZQ8K7H", "reid": "re_01J8Y2M0PQ", "productfamily": "PL",
 "correlationid": "app_01J9ZQB3W4X6", "consentref": "cns_01J9ZQA9R2T5", "dataclass": "PII",
 "schemaver": "1.2.0", "seq": 1, "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
 "data": {"lsp_application_ref": "UDF-APP-2026-000184321", "product_code": "PL-SAL-01", "dla_id": "dla_01J5UDFANDR",
  "requested_amount": {"amount": "250000.00", "currency": "INR"}, "tenor_months": 24,
  "applicants": [{"role": "PRIMARY", "party_ref": "pty_ud_fx_01J9ZQC0MN", "pan_masked": "XXXXX1234X",
    "pan_token": "tok_pan_6f1c9e", "household": {"members": 3, "annual_income": "1020000.00"}}],
  "kyc_evidence_refs": [{"type": "DIGILOCKER_AADHAAR_XML", "evidence_id": "evd_01J9ZQ9ABC", "sha256": "9d3f…a5d7f9"}],
  "environment": "PRODUCTION"}}
```

**A.2 `CollateralPledgeCreated` for LAS (Finbyx → Udofin)**

```json
{"…": "…", "source": "urn:infrabyx:finbyx:ten_01J8Y2M0PQ", "type": "in.infrabyx.collateral.CollateralPledgeCreated.v1",
 "subject": "col_01J9ZTR5KQ2M", "productfamily": "LAS", "consentref": "cns_01J9ZT90QW", "dataclass": "FINANCIAL", "seq": 3,
 "data": {"pledge_request_id": "plr_01J9ZTQ0HH", "application_id": "app_01J9ZT8P1A2B", "collateral_type": "LISTED_SHARE_DEMAT",
  "provider": "CDSL", "pledge_ref": "PLG-2026101900045871", "pledgor_boid_token": "tok_boid_44a1c0", "status": "CONFIRMED",
  "securities": [{"isin": "INE000A01019", "units": "1200", "price": "1530.25", "price_source": "NSE_BHAVCOPY",
    "price_as_of": "2026-10-16", "haircut_pct": "50.00", "eligible_value": {"amount": "918150.00", "currency": "INR"}}],
  "haircut_table_version": "LAS-HC-2026.10.1", "regulatory_basis": "CF para 106(1)",
  "confirmed_at": "2026-10-19T15:07:58+05:30", "provider_evidence": {"provider_txn_id": "CDSL-LAS-7781202", "sha256": "e3b0…b855"},
  "disbursement_gate_satisfied": true}}
```

**A.3 `LegalNoticeIssued` (Recovery Suite → dispatch adapters)**

```json
{"…": "…", "type": "in.infrabyx.recovery.LegalNoticeIssued.v1", "subject": "rc_01J9ZW1F4K7P", "productfamily": "LAP",
 "legalbasis": "LEGAL_CLAIM", "dataclass": "LEGAL", "seq": 7,
 "data": {"notice_id": "ntc_01J9ZW8Q2R5T", "instrument": "S13_2",
  "statute_ref": "SARFAESI Act s.13(2); Security Interest (Enforcement) Rules r.3",
  "eligibility_checks": {"sarfaesi_notified": true, "cersai_ref": "CERSAI-SI-400012345678", "time_barred": false},
  "template": {"template_id": "tpl_s13_2", "version": "3.1.0"},
  "addressees": [{"party_ref": "pty_fx_01J7MORTGAGOR", "role": "BORROWER"}],
  "dues_snapshot": {"as_of": "2026-10-19", "total": {"amount": "3710810.40", "currency": "INR"}}, "cure_period_days": 60,
  "document": {"document_id": "doc_01J9ZW8Z0Y", "sha256": "4f2a…4f6a", "pdfa": "PDF/A-2b"},
  "signer": {"role": "AUTHORISED_OFFICER", "signature_type": "DSC"}, "dispatch_modes": ["SPEED_POST_POD", "COURIER", "EMAIL"]}}
```

**A.4 `ADRReferralCreated` (Recovery Suite → Equator)**

```json
{"…": "…", "type": "in.infrabyx.adr.ADRReferralCreated.v1", "subject": "adrref_01J9ZX4M8N2Q", "productfamily": "PL",
 "correlationid": "rc_01J9ZX0A1B2C", "legalbasis": "LEGAL_CLAIM", "dataclass": "LEGAL", "seq": 1,
 "data": {"provider": "EQUATOR", "process": "CONCILIATION", "basis": "CONCILIATION_INVITATION",
  "clause": {"names_institution": "EQUATOR", "clause_ref": "LA-PL-2025-v4 cl.21", "stamp_certificate": "IN-DL-2025-0091812"},
  "gate_result": {"rule_version": "ADR-GATES-2026.10", "blocked": []},
  "claim": {"as_of": "2026-10-19", "total": {"amount": "158711.55", "currency": "INR"}},
  "parties": [{"party_ref": "pty_fx_eq_01J9ZX5P", "role": "RESPONDENT", "contact_tokens": ["tok_mob_19ab", "tok_eml_77cd"]}],
  "referral_pack": [{"type": "LOAN_AGREEMENT", "document_id": "doc_01J5LA0001", "sha256": "aa11…dd66"}],
  "settlement_mandate_ref": "mdt_01J9ZX4SEAL", "udofin_presentation_permitted": true,
  "approval_ref": "apr_01J9ZX49QQ"}}
```

**A.5 `ADROutcomeRecorded` (Equator → Recovery Suite)**

```json
{"…": "…", "source": "urn:infrabyx:equator:ten_eq_01J8Y2RE", "type": "in.infrabyx.adr.ADROutcomeRecorded.v1",
 "subject": "adr_01J9ZX7C3D4E", "reid": "re_01J8Y2M0PQ", "legalbasis": "LEGAL_CLAIM", "dataclass": "LEGAL", "seq": 14,
 "data": {"outcome_seq": 1, "outcome_type": "CONCILIATION_SETTLEMENT_S73",
  "legal_effect": "Arbitral award on agreed terms (A&C Act ss.74, 30); enforceable under s.36",
  "within_re_mandate": true, "settlement_approval_ref": "stl_01J9ZY0APP",
  "terms": {"amount": {"amount": "132000.00", "currency": "INR"}, "instalments": [{"due_date": "2026-12-05", "amount": "66000.00"},
    {"due_date": "2027-01-05", "amount": "66000.00"}], "payee": "re_01J8Y2M0PQ", "restructuring_flag": false},
  "instrument": {"document_id": "doc_eq_01J9ZZ1SET", "sha256": "5a6b…5a6b", "pdfa": "PDF/A-2b",
    "signatures": ["ESIGN_PARTY", "DSC_RE", "DSC_CONCILIATOR"]},
  "e_stamp": {"certificate_no": "IN-DL-2026-11-0041771", "state": "DL", "stamped_at": "2026-11-21T16:40:02+05:30"},
  "served_at": "2026-11-21T18:05:11+05:30", "clocks": {"s33_correction_end": "2026-12-21", "s34_challenge_end": "2027-02-21", "s34_outer_limit": "2027-03-23"}}}
```


**A.6 `VidhiTaskDelegated` (LawDocsComply → LawDocs)** *(v1.2)*

```json
{"specversion": "1.0", "id": "01a3c0d2-5b8e-7f10-9c4a-2e6d8b1f3a07",
 "source": "urn:infrabyx:ldc:ten_01J9ZLDC7K", "type": "in.infrabyx.vidhi.VidhiTaskDelegated.v1",
 "subject": "dtask_01JA0V7K2M", "time": "2026-10-26T10:15:00+05:30", "datacontenttype": "application/json",
 "dataschema": "https://registry.infrabyx.example/schemas/vidhi/VidhiTaskDelegated/1.0.0.json",
 "tenantid": "ten_01J9ZLDC7K", "reid": "none", "productfamily": "na", "correlationid": "msn_01JA0V5Q9R",
 "consentref": "cns_01JA0V6C3T", "dataclass": "CONFIDENTIAL", "schemaver": "1.0.0", "seq": 1, "traceparent": "00-…-01",
 "data": {"dtask_id": "dtask_01JA0V7K2M", "msn_id": "msn_01JA0V5Q9R", "from_product": "LDC", "to_product": "LD",
  "task_type": "legal.agreement_status.read", "action": "REQUEST", "tenantid_source": "ten_01J9ZLDC7K", "org_id": "org_01J8ACME",
  "requested_by": "pps_7f3a…", "autonomy_ceiling": "L1", "due_at": "2026-10-27T10:15:00+05:30",
  "inputs_ref": "urn:infrabyx:ldc:ten_01J9ZLDC7K:vidhi-inputs:inp_01JA0V7P", "budget": {"tool_calls": 20, "cost_inr": "25.00"}, "attempt": 1}}
```

**A.7 `WhiteLabelTenantProvisioned` (Operations Hub → Udofin)** *(v1.2)*

```json
{"…": "…", "source": "urn:infrabyx:oh:ent_01J8UDOFINOPCO", "type": "in.infrabyx.tenancy.WhiteLabelTenantProvisioned.v1",
 "subject": "ten_01JA0WPBANK", "legalbasis": "CONTRACT_PERFORMANCE_VENDOR", "dataclass": "INTERNAL",
 "data": {"tenantid": "ten_01JA0WPBANK", "brd_id": "brd_01JA0WB7N", "whitelabel_link_id": "wll_01JA0W9Z", "product": "UD",
  "hosts": [{"host": "app.partnerbank.in", "role": "APP"}, {"host": "www.partnerbank.in", "role": "PUBLIC"}, {"host": "api.partnerbank.in", "role": "API"}],
  "legal_entity_ref": "org_01J9PBANKLSP", "operating_entity_ref": "ent_01J8UDOFINOPCO", "merchant_of_record": "INFRABYX", "plan_id": "pln_udf_wl_std",
  "store_identity": {"ios_bundle_id": "in.partnerbank.loans", "android_package": "in.partnerbank.loans"}, "email_domain": "partnerbank.in",
  "dla_ids": ["dla_01J9PBRE1", "dla_01J9PBRE2"], "reids": ["re_01J8Y2M0PQ", "re_01J8Y2N4RS"], "provisioned_by": "OPS_PROVISIONING_CHECKER",
  "valid_from": "2026-11-01", "valid_to": "2027-10-31"}}
```

**A.8 `VendorAssuranceDocumentPublished` (Operations Hub → every product)** *(v1.2)*

```json
{"…": "…", "source": "urn:infrabyx:oh:ent_01J8INFRABYXTECH", "type": "in.infrabyx.trust.VendorAssuranceDocumentPublished.v1",
 "subject": "vad_01JA0X2SOC2", "reid": "none", "dataclass": "INTERNAL",
 "data": {"vad_id": "vad_01JA0X2SOC2", "title": "SOC 2 Type 1 report — Infrabyx platform", "category": "AUDIT_REPORT", "cadence": "ANNUAL",
  "valid_from": "2026-10-01", "valid_until": "2027-09-30", "version": 1, "storage_ref": "trust/vad_01JA0X2SOC2/v1.pdf",
  "sha256": "9f2c…e1", "visibility": "GATED_NDA", "publication_targets": ["FX", "UD", "LD", "LDC", "EQ"], "nda_required": true,
  "summary": "Independent service auditor's report on the design of controls as at 30 September 2026.", "supersedes_vad_id": null}}
```

**A.9 `LeadCaptured` (LawDocs public site → Operations Hub CRM)** *(v1.2)*

```json
{"…": "…", "source": "urn:infrabyx:lawdocs:ten_PUBLIC", "type": "in.infrabyx.crm.LeadCaptured.v1", "subject": "lead_01JA0Y4K",
 "consentref": "cns_01JA0Y3CMP", "dataclass": "INTERNAL",
 "data": {"lead_id": "lead_01JA0Y4K", "product": "LD", "brand_pack_id": "brd_01J9LDDEFAULT", "source": "PRICING",
  "contact_hash": "sha256:4a1f…", "fields_ref": "https://api.lawdocs.in/v1/leads/lead_01JA0Y4K/fields",
  "utm": {"source": "linkedin", "medium": "social", "campaign": "clm-oct26"}, "page_url": "https://lawdocs.in/pricing",
  "interest": "pln_ld_business", "captured_at": "2026-10-26T11:02:14+05:30", "notice_version": "2026-10"}}
```

**A.10 `SigningRequestCompleted` (LawDocs → Finbyx, hosted hand-off)** *(v1.2, from LD App. Y)*

```json
{"…": "…", "source": "urn:infrabyx:lawdocs:ten_01J9ZACMELD", "type": "in.infrabyx.esign.SigningRequestCompleted.v1",
 "subject": "sgr_01JA0Z8Q", "reid": "re_01J8Y2M0PQ", "legalbasis": "CONTRACT_PERFORMANCE_RE", "dataclass": "CONFIDENTIAL",
 "data": {"signing_request_id": "sgr_01JA0Z8Q", "document_id": "doc_01JA0Z6M", "signed_sha256": "c71b…9d",
  "esp_transaction_ids": ["ESP-2026-10-26-000118"], "certificate_summary": {"issuer": "…", "serial_hash": "…", "valid_to": "2028-10-25"},
  "signers": [{"signer_ref": "pps_a91…", "signing_method": "AADHAAR_OTP_ESIGN", "signed_at": "2026-10-26T11:40:03+05:30"}],
  "evidence_pack_ref": "urn:infrabyx:lawdocs:ten_01J9ZACMELD:evidence:evp_01JA0ZA2", "link_ref": "shl_01J9ZHANDOFF"}}
```

---

# APPENDIX B — GLOSSARY

**A&C Act** Arbitration and Conciliation Act 1996 · **AA** Account Aggregator · **ADR** negotiation, conciliation, mediation, arbitration, Lok Adalat · **CERSAI** Central Registry of Securitisation Asset Reconstruction and Security Interest of India · **CF** NBFC Credit Facilities Directions 2025 (RBI/DOR/2025-26/347) · **CIR** Credit Information Reporting Directions (349) · **CYB** Cybersecurity, Technology Risk, Resilience and Assurance Directions (461) · **CLA** co-lending arrangement · **DLA** digital lending app · **DLG** default loss guarantee · **DP** drawing power (or depository participant) · **DPDP** Digital Personal Data Protection Act 2023 and Rules 2025 · **FAPI 2.0** OpenID Financial-grade API Security Profile · **ICA** inter-creditor agreement · **IRACP** Income Recognition, Asset Classification and Provisioning Directions (356) · **KFS** Key Facts Statement · **LAS, LAMF** loans against securities and mutual funds · **LSP** lending service provider · **ODR** online dispute resolution · **OSCAL** NIST Open Security Controls Assessment Language · **OUT** Managing Risks in Outsourcing Directions (363) · **RBC** Responsible Business Conduct Directions (362) · **RE** regulated entity · **RS** Recovery, Litigation and ADR Suite · **RSA** Resolution of Stressed Assets Directions (357) · **RTA** registrar and transfer agent · **SEC** Securitisation Transactions Directions (353) · **TDCR** Transfer and Distribution of Credit Risk Directions (352) · **TReDS** Trade Receivables Discounting System · **Udolex** standalone Recovery Suite · **OH** Infrabyx Operations Hub · **CIC** credit information company (in this specification; core investment companies are `CICD`) · **CICRA** Credit Information Companies (Regulation) Act 2005 · **UCRF** Uniform Credit Reporting Format · **JLG, SHG** joint liability group, self-help group · **MSCS** Multi-State Co-operative Societies Act 2002 · **SR** security receipt · **SPE** special purpose entity · **RB-IOS** RBI Ombudsman Scheme (2026 scheme from 1 July 2026) · **BYOK, HYOK** bring or hold your own key · **PCA** prompt corrective action.

---

# APPENDIX C — CROSS-PACK CONSISTENCY TABLE *(v1.2)*

One row per product pack as at 26 October 2026. A product agent cites this table when its pack names a runtime, port, error prefix, export map or MCP resource; a change to any cell is a 14.2 proposal (IPB change-propagation rule, 14.1). Capability ports are IPB-01 §01.4.4 names; "+" lists product-specific ports registered under §01.4.4.0.

| Product | Pack version | Node pin | Capability ports used (reference adapter in brackets where fixed) | Problem-code prefix | Export package (map) | MCP resource indicator | Owner code / `source` |
|---|---|---|---|---|---|---|---|
| LawDocs | Build Prompt Pack v1.1 | 24.22.1 | IDENTITY (Keycloak), AUTHZ (Cerbos), STORAGE, QUEUE, WORKFLOW (Temporal), CACHE, SEARCH (PostgreSQL FTS → OpenSearch at gate), VECTOR, SECRETS, KMS, EMAIL, SMS, WHATSAPP, PUSH, **ESIGN (LawDocs is the group's reference ASP route; hosts the ceremony)**, ESTAMP (SHCIL and State portals), KYC (DigiLocker requester), COMPANY_DATA, EMBEDDING, IMAGE_GEN, TRANSLATE, OCR, DOCGEN, PDF, CALENDAR, ANALYTICS, TAG_MANAGER, FEATURE_FLAG, OBSERVABILITY, ERROR_TRACKING, DNS_CDN, RULES; + ODR, COURT_DATA, IP_OFFICE, NOTIFY, TRUST, SUPPORT, BACKLOG, CONSENT, MEDIA, AV, PLAGIARISM, EGRESS, LAW_REGISTER | `LD-` (`LD-ECO-NNN` re-exports) | `LD-EXPORT-1.0` (profiles `ld_company_v1`, `ld_individual_v1`, `ld_professional_v1`, `ld_consumer_help_v1`) | `urn:infrabyx:ld:mcp` | `LD` / `urn:infrabyx:lawdocs:[tenantid]` |
| LawDocsComply | Build Prompt Pack v1.3 | 24.22.1 | IDENTITY, AUTHZ, STORAGE, QUEUE, WORKFLOW, CACHE, SEARCH, VECTOR, SECRETS, KMS, EMAIL, SMS, WHATSAPP, PUSH, ESIGN (hosted hand-off to LD), COMPANY_DATA (MCA/GSTN watch), EMBEDDING, TRANSLATE, OCR, DOCGEN, PDF, CALENDAR, ANALYTICS, TAG_MANAGER, FEATURE_FLAG, OBSERVABILITY, ERROR_TRACKING, DNS_CDN, RULES; + NOTIFY, TRUST, SUPPORT, BACKLOG, CONSENT (consent-manager API from 13 Nov 2026 [VERIFY]), MEDIA, AV, EGRESS, LAW_REGISTER (owner) | `LDC-` | `LDC-EXPORT-1.0` [VERIFY: name in LDC v1.3 App.] | `urn:infrabyx:ldc:mcp` | `LDC` / `urn:infrabyx:ldc:[tenantid]` |
| Equator Resolution | Build Prompt Pack v3.2 | 24.22.1 | IDENTITY, AUTHZ, STORAGE (REGULATED bucket class for recordings), QUEUE, WORKFLOW, CACHE, SEARCH, SECRETS, KMS, EMAIL, SMS, PUSH, ESIGN (own ESP route for awards; `lawdocs_esign` withdrawn), ESTAMP, VIDEO_MEET (LiveKit), SPEECH/TRANSLATE (Indic STT, diarisation), OCR, DOCGEN, PDF, CALENDAR (authoritative for hearings), ANALYTICS, TAG_MANAGER, FEATURE_FLAG, OBSERVABILITY, ERROR_TRACKING, DNS_CDN, RULES (scheme rules as data); + INTERPRETER, NOTIFY, TRUST, SUPPORT, BACKLOG, CONSENT, MEDIA, AV, EGRESS | `EQ-` | `EQ-EXPORT-1.0` [VERIFY: name in EQ v3.2 App.] | `urn:infrabyx:eq:mcp` | `EQ` / `urn:infrabyx:equator:[tenantid]` |
| Finbyx | Master Prompt + Runbook v1.6 | 24.22.1 | IDENTITY, AUTHZ, STORAGE, QUEUE, WORKFLOW, CACHE, SEARCH, VECTOR, SECRETS, KMS (incl. PKCS#11/HSM adapter), EMAIL, SMS, WHATSAPP, PUSH, VOICE, ESIGN (hosted hand-off), ESTAMP, KYC, COMPANY_DATA, EMBEDDING, OCR, DOCGEN, PDF, CALENDAR, ANALYTICS, FEATURE_FLAG, OBSERVABILITY, ERROR_TRACKING, DNS_CDN, RULES (GoRules), GEO/MAPS, PAYMENTS (mandates; Razorpay reference), PAYOUTS (manual failover by design); + BUREAU, AA_FIU, ULI_GATEWAY, DISBURSEMENT_RAIL, ODR (`OdrProvider`), NOTIFY, TRUST, SUPPORT, BACKLOG, CONSENT, MEDIA, AV, EGRESS, LAW_REGISTER | `FBX-` (`FBX-RS-NNN` for Recovery Suite) | `FBX-EXPORT-1.0` [VERIFY: name in Finbyx v1.6] | `urn:infrabyx:fbx:mcp` | `FX` / `urn:infrabyx:finbyx:[tenantid]` |
| Udofin | Master Prompt + Runbook v1.3 | 24.22.1 (Expo SDK 57 mobile) | IDENTITY, AUTHZ, STORAGE, QUEUE, WORKFLOW, CACHE, SEARCH, SECRETS, KMS, EMAIL, SMS, WHATSAPP, PUSH (Expo; FCM/APNs fallback), ESIGN (loan-journey ESP as the RE's LSP; hosted hand-off for its own documents), ESTAMP, KYC, EMBEDDING, OCR, DOCGEN, PDF, ANALYTICS (PUBLIC only), TAG_MANAGER, FEATURE_FLAG, OBSERVABILITY, ERROR_TRACKING, DNS_CDN, RULES, PAYMENTS (B2C wellness billing only; never loan money); + ODR (Equator launch, 4.4), NOTIFY, TRUST, SUPPORT, BACKLOG, CONSENT, MEDIA, AV, EGRESS. Every adapter `IN` or `IN-ZR` except PUSH and PUBLIC analytics | `UDF-` (`UDF-RS-NNN`) | `UDF-EXPORT-1.0` [VERIFY: name in Udofin v1.3] | `urn:infrabyx:udf:mcp` | `UD` / `urn:infrabyx:udofin:[tenantid]` |
| Operations Hub | Master Prompt + Runbook v1.1 | 24.22.1 | IDENTITY (group IdP; SCIM source), AUTHZ (product_scope and legal-entity policies), STORAGE, QUEUE, WORKFLOW, CACHE, SEARCH, SECRETS, KMS, EMAIL, SMS, WHATSAPP (template registry owner), PUSH, VOICE, ESIGN (hosted hand-off to LD for MSAs, DPAs, HR letters), COMPANY_DATA, DOCGEN, PDF, CALENDAR, ANALYTICS, TAG_MANAGER, FEATURE_FLAG, OBSERVABILITY, ERROR_TRACKING, DNS_CDN (host registry), RULES (Labour Code pack publisher), PAYMENTS (Razorpay; OH8 billing engine of record; Route for marketplace), WORKSPACE (M365 [VERIFY: plan held]); + TRUST (OH14.6 server side), SUPPORT (OH6 server side), BACKLOG, HR (OH10 server side), CONSENT, MEDIA, AV, EGRESS | `OH-` | `OH-EXPORT-1.0` [VERIFY: name in OH v1.1] | `urn:infrabyx:oh:mcp` | `OH` / `urn:infrabyx:oh:[legalentityid]` |
| Recovery Suite / Udolex (future standalone) | Inside Finbyx v1.6 and Udofin v1.3 | 24.22.1 | As host product; + ODR, COURT_DATA, E_AUCTION, AGENCY | `RS-` inside host; `UDX-` reserved | Host product's map | Host product's | `RS` / host `source` until standalone (`urn:infrabyx:udolex:[tenantid]` reserved) |
| Ecosystem Specification | v1.2 | — (contracts only) | — | hyphenated problem names (3.9) | `archive_standard_version` 1.0; `archive_manifest_v1` | — | `in.infrabyx.[domain].[Event].v[major]` |
| IPB | v1.0 | 24.22.1 (IPB-D-01) | Catalogue owner (§01.4.4) | `IPB-` | `[PRODUCT]-EXPORT-[version]` grammar (IPB-09 §09.4.7.1) | `urn:infrabyx:[product]:mcp` grammar (IPB-03 §03.4.12) | — |

TCP port variables (not capability ports; IPB-11): `APP_PORT=4000` (API), `MSG_SMTP_PORT=1025` (non-production mail sink), `OBS_METRICS_PORT=9464` (Prometheus scrape); web and worker processes use the shared chart's defaults. Every product's `env/.env.example` names these three identically.

Error-code prefix collision check: `LD-`, `LDC-`, `EQ-`, `FBX-`, `UDF-`, `OH-`, `RS-`, `UDX-`, `IPB-` are pairwise distinct and none is a prefix of another followed by a hyphen; Specification problem names are lower-case hyphenated and therefore disjoint. Re-exports of Specification problems use `[PRODUCT]-ECO-NNN`; re-exports of IPB codes use `[PRODUCT]-[IPB AREA]-NNN` (for example `LD-API-010` for `IPB-API-010`).

---

## SOURCES

**RBI Directions supplied by the project owner** (paragraphs checked against the texts in `md/` and `md2/`): CF 347; CIR 349; TDCR 352; SEC 353; IRACP 356; RSA 357; RBC 362; OUT 363; KYC 361; CYB 461; FRM 463; CMP 460.

**Research notes (19 Oct 2026):** `v14/research_A_recovery_law.md`, `v14/research_B_adr_odr.md`, `v14/research_C_recovery_tech.md`, `v14/research_D_integration.md` (full case citations and URLs). **Owner files:** `v14in/las.txt` (LAS proposal, 15 Oct 2026; corrected in 7.3); Finbyx Master Prompt v1.3 (Parts 2, 5, 6, 9, 10, M14, M15, M21); Udofin Master Prompt v1.0 (Parts 2, 4, 5, 6, 9, 10, U18, U21).

**Standards:** CloudEvents 1.0.2; OpenAPI 3.1.1 and 3.2.0; AsyncAPI 3.0; JSON Schema 2020-12; Standard Webhooks; draft-ietf-httpapi-idempotency-key-header-07; RFC 9421, 9530, 9457, 9562, 7515, 7797, 8705, 7523, 9126, 9449, 8693, 9700, 7643, 7644, 8594, 9745; OAuth 2.1 draft; FAPI 2.0 Security Profile (Final, Feb 2025); NIST OSCAL v1.2.x; W3C Trace Context; OpenFeature.

**Market infrastructure:** NSDL pledge services; CDSL LAS and communiqué CDSL/OPS/DP/POLICY/2026/468; TReDS Directions 2026 (RBI/DPSS/2026-27/406); India Post CEPT SOP v6.1; TallyPrime XML reference; MetricStream, IBM OpenPages, ServiceNow IRM and Archer documentation; IBBI BAANKNET circulars; WhatsApp Business Messaging Policy.

**v1.1 (24 October 2026).** **Products:** Finbyx Master Build Prompt v1.5 (Parts 7B–7L), Udofin Master Build Prompt v1.2 (Parts 7B–7H) and Infrabyx Operations Hub Master Build Prompt v1.0 (OH1–OH14). **RBI:** NBFC – Supervisory Returns Directions 2026 (RBI/DoS/2026-27/466, 31 July 2026); RBI (NBFC – Credit Information Reporting) Amendment Directions 2025 (RBI/DOR/2025-26/117, DoR.FIN.REC.No.324/20.16.056/2025-26, 4 December 2025, in force 1 July 2026) and RBI (Credit Information Companies) Amendment Directions 2025 (RBI/DOR/2025-26/119, DoR.FIN.REC.No.326/20.16.056/2025-26); MSD (PCA), GOV, CAP, ALM, CON, INV, ORM, IAF, SA, FS, MFI, SEC; Commercial Banks – Internal Audit Function Directions 2026 (RBI/DoS/2026-27/413); ARC Directions 2025; RBI Ombudsman Scheme 2026 (notified 16 January 2026, effective 1 July 2026); NBFC Internal Ombudsman Directions 2026; RBC Second Amendment (15 June 2026) and Third Amendment (RBI/2026-27/230); E-mandate Directions 2026 (RBI/DPSS/2026-27/396); Payment Aggregator Directions 2025. **Other law and standards:** CICRA 2005; Companies Act 2013 and Companies (Accounts) Rules; ICSI SS-1 and SS-2; SEBI LODR, PIT and AIF Regulations; IFSCA Finance Company and Fund Management Regulations; MSCS Act 2002 and Maharashtra Co-operative Societies Act 1960; BUDS Act 2019; Code on Wages, Industrial Relations Code, Code on Social Security, OSHWC Code and the Central Rules of 8 May 2026; Income-tax Act 2025; CGST Act 2017; DPDP Act 2023 and Rules 2025; CERT-In Directions (28 April 2022); TRAI TCCCPR 2018 and the 1600-series Direction (19 November 2025); Insurance Act 1938 and IRDAI intermediary regulations; BCI Rules Part VI Chapter II Rule 36; UCRF Consumer v3.74, Commercial v3.10 and MFI v3.3.1; MFIN Guardrails 2.0; PCI DSS v4.0.1; AICPA SOC 2 Trust Services Criteria; ISO/IEC 27001:2022 and ISO/IEC 27701:2025; Microsoft Graph `Sites.Selected`; AWS S3 Object Lock and KMS External Key Store; Azure immutable blob storage; Google Cloud Storage bucket lock; Razorpay webhook documentation; TallyPrime 7.0 integration reference; CloudEvents 1.0.2 extension-attribute naming rules.

**v1.2 (26 October 2026).** **Products and baseline:** Infrabyx Platform Baseline Standard v1.0 (IPB-01 to IPB-13, 25–26 October 2026; "Proposed Ecosystem events" tables in IPB-01 §01.6.2, IPB-02 §02.6.2, IPB-03 §03.6.2, IPB-04 §04.6.2, IPB-05 §05.6, IPB-06 §06.6.2, IPB-07 §07.6.2, IPB-08 §08.6.2, IPB-09 §09.6.2, IPB-10 §10.6.2); LawDocs Build Prompt Pack v1.1 Appendix Y (`2026-10-25-add-lawdocs-ld`), Appendices I, K, X; LawDocsComply Pack v1.3; Equator Pack v3.2; Finbyx v1.6; Udofin v1.3; Operations Hub v1.1. **Law and regulation cited in v1.2 additions:** IT Act 2000 s.3A, s.10A, First and Second Schedules (S.O. 4720(E), 26 Sep 2022); CCA eSign FAQ and eSign API v3.3; Indian Stamp Act 1899 ss.17, 35; Registration Act 1908 s.17; Bharatiya Sakshya Adhiniyam 2023 s.63(4) [VERIFY]; DPDP Act 2023 ss.5–8 and Rules 2025; Arbitration and Conciliation Act 1996 ss.7, 12 and the cases named in 6.9; Commercial Courts Act 2015 s.12A; Advocates Act 1961 ss.29, 33, 35 and BCI Rule 36; RBI (Digital Lending) Directions 2025 (LSP and RE roles, DLA listing, data and consent); RBI Master Directions on Regulation of Payment Aggregators (15 Sep 2025) [VERIFY: paragraphs]; RBI Outsourcing Directions 2025 Ch III–IV, paras 45–51, 61, 90–92; Limitation Act 1963 Art. 136; CGST Rules r.46; WhatsApp Business Messaging Policy; WCAG 2.2 SC 1.4.3 and 1.4.11.
