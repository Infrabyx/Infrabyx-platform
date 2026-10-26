# DECISIONS — infrabyx-platform

Assumptions and decisions made during the build. Owner decisions are marked `[OWNER]`; deviations from the IPB are `IPB-DEV-nn`.

| Date | ID | Decision | Reason | Spec section affected |
|---|---|---|---|---|
| 2026-10-26 | IPB-D-01 | Node.js 24.22.1 pinned in every product; 26.12.1 only through a dated ADR (not before Q2 2027) | Oct 2026 security releases; mature LTS; dependency verification | IPB-01 §01.4.1 |
| 2026-10-26 | IPB-D-02 | Ports + reference stack: PostgreSQL only engine; every vendor behind a port with ≥2 adapters; container-ready; AWS Mumbai reference, DR Hyderabad; Supabase DB-only in non-prod | No single-vendor dependency; measured exit | IPB-01 |
| 2026-10-26 | IPB-D-03 | One AI employee brand, Vidhi AI, shared kernel; display-name override on white-label plans | One prompt library; group brand | IPB-03 |
| 2026-10-26 | IPB-D-04 | Seed credentials: generated 24+ char passwords per product; super admin rjnprajapati@gmail.com; production refuses seeds; first prod login forces rotation + MFA | Safe developer convenience | IPB-11 |
| 2026-10-26 | IPB-D-05 | All products are NestJS 11 modular monoliths (module = schema = bounded context) | Extractable later, simple now | IPB-01 §01.4.3 |
| 2026-10-26 | IPB-D-06 | Multi-provider AI with data-class routing; confidential/regulated only to India-resident zero-retention endpoints | Provider independence; residency | IPB-03 |
| 2026-10-26 | IPB-D-07 | Payment-gateway neutral; Razorpay reference; hosted checkout only; OH8 billing engine of record | PCI DSS SAQ A scope | IPB-01, IPB-02 |
| 2026-10-26 | IPB-D-08 | Every product ships a public website with super-admin CMS, Brand Studio, Pricing Studio, blog, vlog, resources, cookie CMP, standard footer and pages | Owner requirement | IPB-04 |
| 2026-10-26 | IPB-D-09 | Vendor Assurance Room with cadenced uploads; OH14.6 system of record, product mirrors | RBI/SEBI/IRDAI outsourcing obligations | IPB-08 |
| 2026-10-26 | IPB-D-10 | Shared brand_pack for white-label and multi-brand (Udofin/Finbyx resale) | Owner requirement | IPB-04, Spec §5.4 |
| 2026-10-26 | IPB-D-11 | Distinct visual identity per product within WCAG 2.2 AA contrast guard-rails | Owner requirement | IPB-07 |
| 2026-10-26 | IPB-D-12 | Operations Hub staff segregated by product_scope in addition to legal entity | Owner requirement | Spec §4.8 |
