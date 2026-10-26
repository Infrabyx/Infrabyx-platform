# Jupitice.com and Comparable ODR / Legal-Tech Websites: Structure Review

**Prepared:** 25 October 2026. Structure and patterns only; no copy reproduced. Observations are based on fetched HTML of the pages listed. Several Jupitice pages render content client-side, so where a fetch returned only a loading placeholder this is noted. Items not confirmed from a primary source are marked **[VERIFY]**.

---

## 1. Jupitice.com

### 1.1 Company facts (for context)

| Fact | Detail | Source |
|---|---|---|
| Legal entity | Jupitice Justice Technologies Private Limited, Chandigarh; founded 2019 | https://inc42.com/company/jupitice/ |
| Founders (per Inc42) | Raman Aggarwal, Shrey Aggarwal, Anju Aggarwal | same |
| Funding | USD 4 million pre-Series A from Almas Global Opportunity Fund (Cayman Islands), announced 23 Dec 2021; use of funds: product development and global marketing | https://www.devdiscourse.com/article/business/1859118-jupitice-raises-4-mn-from-almas-global-opportunity-fund |
| Headcount | Inc42 shows 144–204 (inconsistent on the same page) | https://inc42.com/company/jupitice/ |
| Positioning | "Legal tech and justice tech" company; "Justice as a Service"; modular platform | https://jupitice.com |

### 1.2 Full page inventory (from sitemap.xml, 47 URLs, all flat, all lastmod 2026-10-23)

| Group | URLs |
|---|---|
| Root | `/` |
| Company | `/about-us`, `/leadership`, `/jupitice-carrer` (sic), `/media`, `/events`, `/event-recap`, `/contact-us`, `/consultation-page`, `/thank-you`, `/explore` |
| Catalogue | `/products`, `/technology`, `/services`, `/solutions`, `/jupitice-market-coverage` |
| ODR / ADR | `/online-dispute-resolution-platform`, `/odr-services`, `/adr-marketplace`, `/adr-room`, `/arbitration-bench`, `/lok-adalat-as-a-service`, `/digital-justice-services`, `/escrow-services` |
| Litigation | `/litigation-erp`, `/litigation-erp-corporates`, `/litigation-erp-government`, `/Litigation-Management-System-ERP` (duplicate casing) |
| Legal ops tools | `/compliance-management-system`, `/contract-lifecycle-management`, `/legal-notice-management-system`, `/sarfaesi-management-system`, `/smart-debt-collection-erp`, `/customer-relationship-management`, `/jupitice-digital-law-office` |
| Content | `/news-letter`, `/november-2025-jupitice-newsletter` … `/february-2026-jupitice-newsletter`, `/podcast`, `/prodcast` (sic), `/mansi-prodcast`, `/jupitice-faq` |
| Legal | `/privacy-policy`, `/cookie-policy`, `/terms-of-use` |

Source: https://jupitice.com/sitemap.xml . Not in the sitemap: any `/investors`, `/documentation`, `/api`, `/pricing`, `/security`, `/trust`, `/partners`, `/case-studies` page. A separate blog lives at `blog.jupitice.com` (linked from the newsletter page).

### 1.3 Menu structure

The fetched homepage HTML did not expose a server-rendered navigation (the only menu-like list was inside a dashboard mock-up: Overview, Matters, Hearings, Reports, Settings). The visible information architecture is therefore inferred from the sitemap and internal links: Products, Technology, Services, Solutions, About, Leadership, Media, Events, Newsletter, Podcast, Careers, Contact. Primary CTAs are "Schedule a Demo" and "Get a Callback". Source: https://jupitice.com **[VERIFY nav labels in a rendered browser]**.

### 1.4 Homepage section order

1. Hero: category claim ("world's first legal tech and justice tech company"), two CTAs.
2. Embedded product dashboard mock-up (all values rendered as 0 in the fetched HTML).
3. Logo carousel: government institutions, BFSI, insurance, enterprises (includes a High Court domain logo).
4. "Key Impact" tiles: deployment speed, cost reduction, data security, resolution time.
5. "Justice Tech, Like LEGO" modular-platform animation.
6. Security and compliance badges: ISO 9001, ISO 27001, DPDP, HIPAA.
7. Client testimonials (two BFSI logos).
8. FAQ accordion.
9. Placeholder blocks that failed to render: "Loading Products…", "Loading Advisory Board…", "Loading Investor…".

Source: https://jupitice.com . Note: the presence of "Advisory Board" and "Investor" loading blocks indicates these sections exist in the CMS but were not server-rendered; their contents are **[VERIFY]**.

### 1.5 Footer

No footer markup was returned on any fetched page (home, about, privacy, newsletter, ODR features). Legal links (privacy, cookie, terms) exist as pages and are referenced inside the privacy policy body; email contacts `contact@` and `support@` appear in the policy. No registered office address, CIN, grievance officer or social links were visible in fetched HTML. Source: https://jupitice.com/privacy-policy . **[VERIFY footer in rendered browser]**

### 1.6 How they present team and leadership

| Element | Observation |
|---|---|
| Page | `/leadership`, headline "Driven by vision. Led by people." |
| Tier 1 | Three featured leaders (CEO & Founder; Founder; Co-Founder & Chief Strategy Officer): portrait, title, name, short bio, "Know More" link, LinkedIn link |
| Tier 2 | "Our Team": ten people as photo + name + title cards in a carousel; no bios or links |
| Advisory board | Not on the leadership page; homepage has an unrendered "Advisory Board" block |
| About page | Narrative origin story (2018 research, 2019 incorporation, COVID pivot), vision/mission with three mission pillars, two "verticals" (technology, ADR marketplace); no named people, no timeline graphic, no awards list |

Sources: https://jupitice.com/leadership ; https://jupitice.com/about-us

### 1.7 Investors

No investors page in the sitemap. The homepage reserves an "Investor" block that did not render. Public record shows a single disclosed round (USD 4 million, Almas Global Opportunity Fund, Dec 2021). Sources: https://jupitice.com ; https://www.devdiscourse.com/article/business/1859118-jupitice-raises-4-mn-from-almas-global-opportunity-fund

### 1.8 Documentation / API

None. The `/technology` page describes a schema-driven, no-code "meta product platform" with builders, runtime engines and composable components, a comparison table (traditional vs composable vs Jupitice), and an "SAP for Justice" analogy. APIs are mentioned only as an interoperability capability; there is no developer portal, API reference, sandbox, SDK or changelog. Source: https://jupitice.com/technology

### 1.9 Resources and content

| Asset | Structure |
|---|---|
| Newsletter ("Jupitice Wire") | Archive page with monthly cards (Nov 2025–Sep 2026, Oct 2026 "coming soon"), a "Latest Updates" list of 19 news items linking to blog.jupitice.com, and a Subscribe button (form fields not visible in HTML) |
| Media | Carousel of six dated items (Aug–Sep 2026) + a long undated list under a "3000+ Media Coverage" heading; each row is logo + headline + "Read Article"; many rows reuse a generic headline; some links go to homepages; PDF clippings on a Google storage bucket; no press kit, no spokesperson contact |
| Podcast | Three URLs incl. a misspelt duplicate |
| Events | `/events` and `/event-recap` |
| FAQ | On homepage and a dedicated `/jupitice-faq` |

Sources: https://jupitice.com/news-letter ; https://jupitice.com/media ; https://jupitice.com/sitemap.xml

### 1.10 Trust and security

Badges on the homepage (ISO 9001, ISO 27001, DPDP, HIPAA) with no certificate numbers, issuing body or scope; FAQ mentions encryption, role-based access and audit trails. No dedicated security or trust page. The privacy policy is dated 4 November 2022, contains a "Privacy Shield" section (a US–EU mechanism invalidated in 2020), does not mention the DPDP Act, names no grievance officer and spells the entity name two ways. Sources: https://jupitice.com ; https://jupitice.com/privacy-policy

### 1.11 Products and careers

Products page: eleven linked cards (Litigation Management System, CLM, Bharat ODR, Legal Notice Management, Compliance Management, SARFAESI Management, Smart Debt Collection ERP, Digital Law Office, Arbitration Tribunal Platform, Shivault DPDP OS, IP Management OS — the last linking to `#`). No pricing. Source: https://jupitice.com/products . ODR platform page is a features list of eight modules (case lifecycle, hearing rooms, notices, neutral panel, documents/evidence, AI layer "Saya", finance/compliance, cause list) with no CTA, footer or documentation in the HTML. Source: https://jupitice.com/online-dispute-resolution-platform . Careers: culture section (four pillars), five open roles with department/type/location filters (Chandigarh, Gurgaon), applications by email. Source: https://jupitice.com/jupitice-carrer

### 1.12 Tone of copy

Promotional and superlative-led ("world's first", "SAP for Justice", "3000+ media coverage"), heavy on category claims and round-number statistics without method notes; FAQ sections are plainer. Repetition of paragraphs and tables across pages suggests CMS templating. Source: https://jupitice.com ; https://jupitice.com/technology

### 1.13 Gaps worth noting (for your own site, not criticism to publish)

- No investors, security/trust, documentation, pricing, partners or case-study pages.
- Advisory board and investor blocks exist in CMS but do not server-render; SEO and accessibility suffer.
- Legal pages outdated relative to DPDP; no grievance officer; no footer address or CIN visible.
- Typos in URLs (`carrer`, `prodcast`) and a dead product link.

---

## 2. Comparable ODR / legal-tech sites

### 2.1 Presolv360 (India)

| Area | Structure observed |
|---|---|
| Navigation | Home; About; Solutions (Negotiation, Mediation, Arbitration); Security; Resources (Clause, ODR Course, ODR Playbook, ODR FAQs, Case Alerts, Mediation Highlights, Blog, ODR TV, Research Papers, ODR on Air, Impressions, Globally Speaking, Op-ed); Careers; AI Library (Beta); Business Enquiry; Login/Register |
| Footer | Contact block (Mumbai address, phone, email); "Important Links": FAQs, Rules, Code & Fees, Terms, Privacy, Cookie Policy, Standards, Data Protection Addendum; "not a law firm" disclaimer; LinkedIn/YouTube/X |
| Team / governance | Advisory council of three retired senior judges named on the homepage; no team page |
| Investors | None |
| Documentation | None for developers; instead a public **Rules, Code & Fees** page and an **ODR Standards** page, which function as the "documentation" of a dispute-resolution institution |
| Trust | "ISO-certified, GDPR-compliant" claim; dedicated `/security` page; headings for Recognition & Empanelment, Alliances, Media & Awards |
| Tone | Confident, slogan-driven, statistics-led; FAQ plain |

Source: https://www.presolv360.com

**Pattern:** for an ODR institution, the trust stack is *Rules + Fee schedule + Standards + Security page + judicial advisory council*, not an API reference.

### 2.2 SAMA (India)

| Area | Structure observed |
|---|---|
| Navigation | Solutions; Sama For (industries); About; Resources; Login |
| Footer | Product (ODR Login, Request a Demo, FAQs, Panel of Neutrals); Pages (About, Public Projects, Careers, Blog); Legal (Privacy, Terms, Rules & Procedures 2024); four social links; CIN and Bengaluru address; "not a law firm" disclaimer |
| Team / investors | Neither present |
| Trust | Metrics tiles (disputes filed, cases resolved, days to close), 3,000+ neutrals across 500+ districts, BFSI testimonials, logo walls for platforms/courts/government bodies, public-interest projects page |
| Documentation | Rules & Procedures (versioned by year) and a neutrals panel directory |
| Tone | Plain, warm, bilingual tagline; benefit-led |

Source: https://www.sama.live

**Pattern:** versioned *Rules & Procedures* and a public *Panel of Neutrals* are treated as compliance artefacts; CIN and registered address in footer.

### 2.3 Immediation (Australia)

| Area | Structure observed |
|---|---|
| Navigation | Our Story; Platform Features; Ebook; Alliances; Get In Touch; regional logins (AU/US); marketplace |
| Footer | Our Story, Helpdesk (external knowledge base), Get In Touch, Privacy, Terms, Alliances, FAQ; LinkedIn; Perth address and email |
| Homepage order | Hero → partner logos → case-study testimonial → feature tabs → metrics → solutions grid → **pricing tiers** → integration steps (Clio) → team teaser → FAQ → newsletter |
| Documentation | External helpdesk (Crisp) and integration guides; no API docs |
| Investors / press / careers | None |
| Trust | None beyond generic encryption language; no ISO/SOC badges |

Source: https://www.immediation.com

**Pattern:** a product-led ODR SaaS shows *public pricing*, *integration guides* and a *helpdesk*; the help centre is the documentation surface.

### 2.4 Tyler Technologies / Modria (US, listed parent)

| Area | Structure observed |
|---|---|
| Product page | Hero → feature bullets → resolution stages → court case study with testimonial → resources (intro video, brochure PDF) → "Ask a question" → parent-company cross-sell |
| Documentation | Brochure only on the product page; no public API docs |
| Investor relations | Separate IR site with: Investor Overview (summary, "why invest", latest news/presentation/events, IR contact, email alerts); News; Events & Presentations (incl. annual meeting); Stock Info; Financials (quarterly results, annual reports, proxy, SEC filings); Governance (documents, executive management, board, committee composition); Resources (information request, alerts, contacts); named IR contacts with direct phone and email |

Sources: https://www.tylertech.com/products/modria ; https://investors.tylertech.com

**Pattern:** the public-company IR template is the ceiling; a private company borrows the *governance*, *leadership*, *news*, *contact* and *alerts* elements and drops stock/filings.

---

## 3. What an "Investors" page typically contains for a private company

Synthesised from IR best-practice guidance and the public-company template above. Sources: https://www.lowcode.agency/blog/b2b-website-investor-relations-page-best-practices ; https://icrinc.com/wp-content/uploads/12_elements_IR_website.pdf ; https://investors.tylertech.com

| # | Section | Typical contents (private company) | Notes |
|---|---|---|---|
| 1 | Company story and vision | What the company does, origin, mission, long-term thesis | Two to three short paragraphs; no superlatives |
| 2 | Market and strategy | Market definition, regulatory tailwinds, how the company intends to win | Cite third-party figures with sources |
| 3 | Traction | Selected metrics (customers, volumes, retention), named logos with permission | State the as-of date |
| 4 | Funding and investors | Rounds (date, stage, amount, lead), investor logos | Gated data room for audited financials under NDA |
| 5 | Leadership | Named executives with verifiable bios, deeper than the About page | Link to LinkedIn |
| 6 | Governance | Board and committees, independent directors, code of conduct, policies (whistle-blower, related-party, information security, AI use) | Acknowledge gaps rather than omit |
| 7 | Milestones | Dated timeline of product, regulatory and commercial events | Keep factual |
| 8 | News and press | Press releases, media kit (logos, boilerplate), named spokesperson | Avoid undated "coverage" walls |
| 9 | Events and presentations | Investor days, conference appearances, replays | Optional for private companies |
| 10 | FAQs | Who can invest, how to request information, secondary policy | Reduces inbound noise |
| 11 | Investor contact | Named IR contact, direct email, opt-in alerts with unsubscribe | Not a generic form |
| 12 | Disclaimers | Forward-looking statements; "not an offer of securities"; India-specific: no public solicitation under Companies Act 2013 private-placement rules (s.42) and SEBI norms | Drafted by counsel; present on every IR page |

**India-specific additions for a private company page [VERIFY with counsel]:** CIN, registered office, statutory auditor name, and an explicit statement that the page is informational and does not constitute an invitation to subscribe (to avoid "offer to the public" characterisation under the Companies Act 2013).

---

## 4. What a "Documentation" section typically contains (B2B SaaS and ODR)

| Layer | ODR institution pattern (Presolv360, SAMA) | Product-led SaaS pattern (Immediation, generic B2B) |
|---|---|---|
| Governing documents | Rules and procedures (versioned by year), fee schedule, code of conduct, standards, data-protection addendum | Terms, DPA, SLA, acceptable-use |
| Operational guidance | How a case proceeds, timelines, FAQs, neutrals panel directory | Help centre / knowledge base (searchable), onboarding guides, integration guides |
| Developer | Rarely present | API reference (OpenAPI), authentication guide, webhooks (signature verification), sandbox, SDKs, changelog, status page |
| Trust | Security page, certifications with scope, empanelments | Trust centre (ISO/SOC reports on request), sub-processor list, uptime |
| Research | Playbooks, courses, research papers, podcasts | Case studies, benchmarks, release notes |

Sources: https://www.presolv360.com ; https://www.sama.live ; https://www.immediation.com

---

## 5. Recommended information architecture (derived patterns, not copy)

| Top-level | Children |
|---|---|
| Platform | Products (one page each with features, screenshots, integrations), Technology/architecture, Security & trust (certs with scope and issuer, sub-processors, data residency, uptime) |
| Solutions | By sector (BFSI, government/courts, enterprise legal), by use case |
| Resources | Documentation (help centre + developer portal), Rules & fees (for ODR), Blog, Research, Newsletter archive, Events |
| Company | About (story, vision, mission, milestones), Leadership (execs + advisory board, bios, LinkedIn), Investors (sections per §3), Careers (roles with filters, culture, benefits), Press (dated releases, media kit, spokesperson), Contact (offices, CIN, grievance officer) |
| Legal | Privacy (DPDP-aligned, grievance officer named, last-updated), Terms, Cookie, DPA, Accessibility statement |
| Footer | Address, CIN, grievance officer link, social, legal links, "not a law firm" or equivalent disclaimer, certification badges linking to the trust page |

Design rules drawn from the review: server-render every trust-bearing section (badges, advisory board, investors); date everything; version rules and policies; prefer named contacts over generic forms; keep statistics sourced and dated.
