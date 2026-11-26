# Regulatory Models for Software

Copies of the Excel models built in the Policies Framework (25 November 2026), for use as specifications in three products:

- **LMS** – loan origination and loan management system (Finbyx)
- **DLA** – digital lending app / lending service provider platform (Udofin)
- **CT** – compliance tool (LawDocsComply)

The originals stay in the Policies Framework folder; these are copies. Every workbook uses fictitious data only.

## How to use these files in code

1. Treat each workbook as a **specification and test oracle**, not as a runtime component. Port the logic to code; do not call Excel from the product.
2. Each master model has the same sheets: **ReadMe**, **Method Notes** (method and legal basis), input sheets (light-yellow cells are inputs), calculation sheets, **Rules** (where applicable), **Checks** (integrity tests that must all read OK) and **Source Map** (where each input comes from).
3. Each model has a **Worked Example (fictitious NBFC)**. Use its inputs and outputs as unit-test fixtures: the code must reproduce every output cell.
4. Folder `05 Rules, Input Maps and Builders`:
   - `maps/<model>_map.json` – every input cell: key, sheet, cell, label, source. Use these keys as field names in the API / database.
   - `maps/*_rules.json` and `data/*.json` – machine-readable rule tables (applicability by category, ratio rules, sector engines).
   - `build_*.py` – the Python builders that generate each master (openpyxl, via `xl.py`); `example_*.py` – the worked examples; `fill_model.py` – fills a master from a JSON of inputs; `recalc.py` – recalculates with LibreOffice; `test_models.py` and `run_examples.py` – the regression tests.
   - The builders read and write paths under the original Policies Framework folder (variables at the top of each script); change them before running in a repository.
   - `MODEL_CUSTOMISATION_PLAYBOOK.md` – method and customisation notes for every model.
   - `sector profile questions.json` – the profile questions that settle conditional obligations for SEBI, IFSCA, IRDAI, co-operative and payments entities.
5. Legal citations are in each Method Notes sheet; keep them with the ported rule so the product can show the basis for every result.

## Models and where they fit

| # | Code | Model | What it does | LMS | DLA | CT |
|---|---|---|---|---|---|---|
| 1 | IRAC-M01 | Asset Classification and Provisioning Engine | DPD-based SMA / NPA classification, upgrade rules, provisioning, income derecognition | Core | – | Yes |
| 2 | ECL-M01 | ECL Model | Ind AS 109 staging, PD, LGD, EAD, ECL and management overlay | Core | – | Yes |
| 3 | KFS-M01 | Key Facts Statement and APR Calculator | KFS, repayment schedule, all-inclusive APR (IRR method), RBI illustration test | Core | Core | Yes |
| 4 | LEND-M01 | Lending Limits Monitor | Limits on loans to directors and related parties, loans against shares and gold (LTV), other lending restrictions | Core | Yes | Yes |
| 5 | EXP-M01 | Exposure and Concentration Limits Monitor | Single and group borrower exposure, sector concentration, large-exposure limits | Core | – | Yes |
| 6 | EWS-M01 | Fraud Early Warning Model | Early-warning signals and red-flag triggers, scoring and escalation | Yes | Yes | Yes |
| 7 | ALM-M01 | Asset Liability Management and Liquidity Model | Maturity buckets, structural liquidity, interest-rate sensitivity, LCR | Yes | – | Yes |
| 8 | RATIO-M01 | Regulatory and Financial Ratio Model | CRAR, leverage, NPA, liquidity and profitability ratios with thresholds | Yes | – | Yes |
| 9 | SEC-M01 | Securitisation Retention Model | Minimum holding period, minimum retention requirement, pool eligibility | Yes | – | Yes |
| 10 | ICAAP-M01 | ICAAP Model | Pillar 2 risk assessment and internal capital requirement | Data feed | – | Core |
| 11 | ST-M01 | Stress Testing Model | Credit, liquidity and interest-rate stress scenarios and capital impact | Data feed | – | Core |
| 12 | BP-M01 | Business Plan Model | Multi-year balance sheet, income and CRAR projection | Data feed | – | Yes |
| 13 | DIV-M01 | Dividend Eligibility and Early Warning Monitor | Dividend eligibility criteria and payout ceiling | – | – | Core |
| 14 | CMP-M01 | Compliance Testing Model | Compliance test plan, sampling, results and findings | – | – | Core |
| 15 | RBIA-M01 | Audit Risk Assessment Model | Risk-based internal audit scoring and audit frequency | – | – | Core |
| 16 | APP-M01 | Applicability Engine (NBFCs and HFCs) | Which policies, committees, roles and returns apply by layer and category | Config | Config | Core |
| 17 | APP-M02 to APP-M07 | Applicability Engines for SEBI listed entities, SEBI intermediaries, IFSCA entities, insurance intermediaries, co-operative societies, payment system operators and fintechs | Same as APP-M01 for each sector, with profile questions | – | APP-M07 (LSPs) | Core |
| 18 | DNBS01 to DNBS14, FMR, FUA, FMR-4, Form A | RBI return formats with harmonised data definitions | Field-level return layouts for report generation and filing | Yes (generate) | – | Yes (track) |
| 19 | IT-A04 | VA-PT Tracker | Testing schedule, findings with CVSS / EPSS severity, closure tracking | Own use | Own use | Yes |
| 20 | IT-A03 | Information Asset and End-of-Support Register | Asset inventory, criticality and end-of-support tracking | Own use | Own use | Yes |
| 21 | VD-00 to VD-13 | Vendor Document Tracker and service provider formats | Outsourcing due diligence and periodic vendor certificates | – | As vendor | Core |

Key: Core = central to that product; Yes = useful module; Data feed = the product supplies the data, the model sits in the compliance tool; Config = drives which features and rules are switched on; Own use = for the product's own security programme; As vendor = what the platform must give the lenders it serves.

## Folder map

- `01 NBFC Models/<Master Direction>/<Model folder>` – models 1 to 16, with master and worked example
- `02 Sector Applicability Engines/<Sector>` – APP-M02 to APP-M07
- `03 RBI Return Formats` – model 18
- `04 IT Security and Vendor Formats` – models 19 to 21
- `05 Rules, Input Maps and Builders` – JSON rule tables, input maps, Python builders and tests, playbook, sector profile questions
