# Infrabyx Platform Baseline Standard (IPB) v1.0

**Prepared:** 26 October 2026 · **Owner:** Company Secretary, Infrabyx Group · **Status:** Binding for every Infrabyx product build-prompt pack · **Companions:** Infrabyx Ecosystem Integration Specification v1.2 · LawDocs Build Prompt Pack v1.1 · LawDocsComply Build Prompt Pack v1.3 · Equator Build Prompt Pack v3.2 · Finbyx Master Prompt v1.6 · Udofin Master Prompt v1.3 · Infrabyx Operations Hub Master Prompt v1.1

---

## 1. What this pack is

The IPB is the shared baseline that all six Infrabyx products inherit by reference. It was created on 25–26 October 2026 after a 34-criteria audit of the seven existing build-prompt documents found the same cross-cutting needs specified six different ways (or not at all): the public website and super-admin Studio, the AI gateway and Vidhi AI, accessibility, the settings tree and "i" help system, the vendor assurance room, legal policies, engineering governance, the API standard, environment and seed files, security and certification mapping, and the 2028–2030 technology watchlist.

Each product pack now carries one paragraph (its "IPB adoption clause") instead of repeating these specifications, and records only what it does differently. The result: one place to improve a shared capability, and every product gets it.

**Precedence on conflict:** product master prompt → **IPB** → Ecosystem Integration Specification (prevails for cross-product contracts) → product phase files → product appendices. A product may tighten an IPB rule, never loosen it. Any deviation is recorded in the product's decision log as `IPB-DEV-nn` with the reason and an owner.

## 2. Files

| File | Contents | Words (approx.) |
|---|---|---|
| `00_README.md` | This guide, adoption clause, decisions, version table | — |
| `IPB-01_Reference_Stack_and_Portability.md` | Locked stack (Node 24.22.1, Next.js 16, NestJS 11 modular monolith, PostgreSQL-only, Temporal, Redis, Keycloak, Cerbos, GoRules), monorepo layout, 42 + 13 port catalogue with ≥2 adapters each, `provider_routing`, database and object-storage portability, containers/Helm/Terraform per cloud, Supabase non-prod rules, exit as a design property | 12,800 |
| `IPB-02_Security_Baseline_and_Certification_Map.md` | Control library mapped to CERT-In, ISO 27001/27701/42001/22301, SOC 2, PCI DSS v4.0.1 SAQ A, DPDP Act + Rules, RBI outsourcing/IT directions, SEBI CSCRF, OWASP ASVS 5.0 / LLM / Agentic; identity, isolation, data protection, secrets, supply chain, uploads, logging, incident response, backup/DR, vulnerability management, AI security, "cannot be demolished" list, threat model and red-team templates | 11,200 |
| `IPB-03_AI_Gateway_and_Vidhi_AI_Kernel.md` | Provider-neutral AI gateway (Anthropic, Bedrock India, OpenAI/Azure, Gemini, Grok, Sarvam/Bhashini, self-hosted; image generation; speech), model registry, data-class routing, guardrails, evals, BYOK; the Vidhi AI kernel: skills, missions, scheduled tasks, autonomy L0–L4, locked human-approval list, MCP server/client, calendar/workspace actions, knowledge notebooks, per-product capability floor | 10,100 |
| `IPB-04_Public_Website_and_Super_Admin_Studio.md` | Headless CMS, Brand Studio (logo, favicon, colours, display name, brand packs for white-label), Pricing Studio, Blog (toggle, bulk import, user posts), Vlog, Resources library, standard pages incl. About/Team/Investors/Careers/Trust Centre, binding footer, cookie CMP, marketing tooling (tag manager, analytics, pixels, UTM, webhooks), feedback widget, Studio information architecture | 15,800 |
| `IPB-05_Legal_Policy_Templates.md` | Eighteen parameterised, review-ready policy templates (privacy, terms, payment and subscription, refund, cookie, AI use, grievance, acceptable use, retention, accessibility statement, responsible disclosure, user content, resources, marketplace, DPA, SLA, vendor assurance statement, consent texts), product inserts, payment-gateway and search-engine trust checklists | 16,100 |
| `IPB-06_Accessibility_and_Inclusive_Design.md` | WCAG 2.2 A/AA criterion table, IS 17802, GIGW 3.0, EN 301 549; hearing (captions, live captions, visual alerts, ISL), vision (screen readers, contrast, scaling, dyslexia font, TTS), motor/cognitive, low literacy; accessibility settings; CI gates and manual test plan | 11,000 |
| `IPB-07_UX_System_Settings_Tree_and_Help.md` | Design-system rules (minimal, contrast, click budgets, Cmd+K, Work Inbox), per-product visual identity, binding 20-node Settings tree, "i" glossary registry with CI lint and regulatory-reference panel, help centre, tours, tutorial pipeline, What's new | 10,800 |
| `IPB-08_Vendor_Assurance_Room_and_Trust_Centre.md` | Compliance Documents menu for the super admin with cadences (monthly to annual), tenant download room under Settings › Security & trust, evidence packs, auditor grants, public Trust Centre, data model and state machine, OH14.6 as system of record | 9,000 |
| `IPB-09_Engineering_Governance_Release_and_Data_Safety.md` | Branch model incl. Claude Code conventions, required CI checks, per-PR preview environments, environment catalogue, flags and rings, zero-downtime migrations, data-safety gates, change classes, patch SLAs, release notes pipeline, tenant beta programme, Engineering console | 8,400 |
| `IPB-10_API_Integration_and_Event_Standard.md` | `/v1` REST standard, OpenAPI 3.1 / AsyncAPI 3.0, RFC 9457, idempotency, pagination, auth and scopes, Standard Webhooks, webhook designer, connector marketplace, SDKs, MCP exposure rules, CloudEvents alignment, ten proposed Ecosystem events | 8,100 |
| `IPB-11_Environment_and_Seed_Standard.md` | `.env` philosophy and the annotated 196-variable `.env.example`, boot validation, production guard-rails, seed profiles, `SEED_CREDENTIALS.md` template (super admin rjnprajapati@gmail.com, test personas), password generation rules | 7,000 |
| `IPB-12_Future_Ready_Technology_Watchlist_2028_2030.md` | 46 watch items (identity and crypto, digital identity, payments and DPI, regulation, AI, platform, courts) with triggers, `fut.*` flags, architecture touchpoints; design-now checklist; yearly review ritual | 7,900 |
| `IPB-13_Claude_Artefacts_and_Collaborative_Content.md` | Optional uses of Claude Docs, Slides, Design, interactive tools, Mermaid, dashboards and motion in the build process and in-product | 3,900 |
| `_research/` | R_FutureTech_2028_2030, R_Jupitice_and_ODR_Websites, R_Standards_Quick_Reference (with source URLs) | 9,700 |
| **Total (IPB-01…13)** | | **≈132,000** |

## 3. Adoption clause (paste into every product master prompt, "Stack" or "Standards" section)

> **Infrabyx Platform Baseline Standard (IPB) v1.0 applies.** This product adopts IPB-01 to IPB-13 (`docs/ipb/`) in full. Where this pack and the IPB differ, this pack may only be stricter; any other difference is an `IPB-DEV-nn` entry in the decision log. Runtime is Node.js 24.22.1 (IPB-D-01). All external services sit behind IPB-01 ports with at least two adapters (IPB-D-02). The AI employee is Vidhi AI on the shared kernel (IPB-D-03). The public website, super-admin Studio, blog, resources, cookie consent, footer and standard pages follow IPB-04; policies follow IPB-05; accessibility IPB-06; settings tree and "i" help IPB-07; vendor assurance room IPB-08; engineering governance IPB-09; APIs and events IPB-10; environment and seeds IPB-11 (super admin `rjnprajapati@gmail.com`; seeds never run in production); future-readiness flags IPB-12. Product-specific additions are listed in the product's "IPB adoption notes" section.

In the repository, commit the IPB pack as `docs/ipb/` and the Ecosystem Specification as `docs/ecosystem/`. Claude Code reads `docs/ipb/00_README.md` in every session before a phase file.

## 4. Decisions recorded for the IPB (25–26 October 2026)

| ID | Decision |
|---|---|
| IPB-D-01 | Node.js 24.22.1 pinned in every product; 26.12.1 only through a dated ADR after dependency verification (not before Q2 2027) |
| IPB-D-02 | Ports + reference stack: PostgreSQL the only database engine; every cloud/vendor capability behind a port with ≥2 adapters; container-ready; reference production AWS Mumbai with DR Hyderabad; Supabase database-only in non-production |
| IPB-D-03 | One AI employee brand, Vidhi AI, on a shared kernel with product skills and autonomy ceilings; display-name override on white-label plans |
| IPB-D-04 | Seed credentials: generated 24+ character passwords in `SEED_CREDENTIALS.md` per product; super admin rjnprajapati@gmail.com everywhere; production refuses seeds; first production login forces password change and MFA |
| IPB-D-05 | All products are NestJS modular monoliths (module = schema = bounded context) |
| IPB-D-06 | Multi-provider AI with data-class routing; confidential and regulated classes only to India-resident zero-retention endpoints |
| IPB-D-07 | Payment-gateway neutral; Razorpay reference; hosted checkout only; OH8 is the billing engine of record |
| IPB-D-08 | Every product ships a public website with super-admin CMS, Brand Studio, Pricing Studio, blog, vlog, resources, cookie CMP, standard footer and pages |
| IPB-D-09 | Vendor Assurance Room with cadenced uploads; OH14.6 system of record, product mirrors |
| IPB-D-10 | Shared `brand_pack` object for white-label and multi-brand (resale of Udofin and Finbyx) |
| IPB-D-11 | Distinct visual identity per product within WCAG 2.2 AA contrast guard-rails |
| IPB-D-12 | Operations Hub staff segregated by product scope in addition to legal entity |

## 5. Product version table after this upgrade

| Product | Previous | Current | Archive location |
|---|---|---|---|
| LawDocs | Build Prompt Pack v1.0 (25 Oct 2026) | **v1.1** (26 Oct 2026) | `LawDocs Prompt/_Archive (older versions)/` |
| LawDocsComply | Build Prompt Pack v1.2 (25 Oct 2026) | **v1.3** | `LawDocsComply Prompt/_Archive (older versions)/` |
| Equator Resolution | Build Prompt Pack v3.1 (24 Oct 2026) | **v3.2** | `Equator Prompt/_Archive (older versions)/` |
| Finbyx | Master Prompt + Runbook v1.5 (24 Oct 2026) | **v1.6** | `Finbyx/Earlier versions/` |
| Udofin | Master Prompt + Runbook v1.2 (24 Oct 2026) | **v1.3** | `Udofin/Earlier versions/` |
| Operations Hub | Master Prompt + Runbook v1.0 (24 Oct 2026) | **v1.1** | `Operations Hub/Earlier versions/` |
| Ecosystem Integration Spec | v1.1 (24 Oct 2026) | **v1.2** | `Ecosystem/Earlier versions/` |

## 6. How to use the IPB with Claude Code

1. Commit `docs/ipb/` (this pack) and `docs/ecosystem/` to the product repository in the P00 / Phase 0 session.
2. The product master prompt's adoption clause (§3) is binding; the phase runbook's first session prompt says: *"Read docs/ipb/00_README.md, then IPB-01, IPB-02, IPB-09 and IPB-11 in full before writing the Phase 0 plan."*
3. Each later phase names the IPB files it depends on in its "Binding appendices" line.
4. The IPB is versioned independently (semver). A change to the IPB is proposed as a change request, approved by the owner, and propagated to each product's decision log within ten working days (same rule as the Ecosystem Specification §14).

## 7. Open items common to all products (owner decisions)

| # | Decision | Blocks |
|---|---|---|
| 1 | Investors page: publish for which products, and which documents are gated [COUNSEL on Companies Act / SEBI private-placement wording] | IPB-04 §Investors |
| 2 | White-label resale entity and commercial terms for Udofin and Finbyx brand packs | IPB-04 Brand Studio, IPB-10 WhiteLabelTenantProvisioned |
| 3 | Payroll: in-house engine (OH10) or payroll provider adapter first | OH v1.1 O10 |
| 4 | WhatsApp BSP (Gupshup / JioCX / Meta direct) and Meta business verification entity | IPB-01 WHATSAPP port, OH O16 |
| 5 | Tag management: GTM web container vs server-side tagging vs none | IPB-04 §Marketing |
| 6 | Image-generation provider for marketing (and whether human review is mandatory before publishing synthetic images — recommended yes) | IPB-03 IMAGE_GEN |
| 7 | Intern stipend policy and certificate wording | OH O10 |
| 8 | Which provider adapters to contract first beyond the reference stack (one alternative per Tier-0 port must be live in CI) | IPB-01 §01.3.C |
| 9 | Confirm the Microsoft 365 plan actually held (carried over from every product pack) | IPB-01 WORKSPACE, OH O12 |
| 10 | Approve the eighteen policy templates for counsel review, and the entity particulars to fill them | IPB-05 |
