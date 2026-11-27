# Playbook – customising the master Excel models for a company

This playbook is the method for turning the three master Excel models into a company's working models. Follow it in order. Nothing is filled or changed in a master file: always work on a copy made by the data-fill script.

## 1. What exists

| Item | Location |
|---|---|
| ECL Master Model (ECL-M01) and worked example | `NBFC Policies/Prudential Norms on Capital Adequacy/ECL Model/` |
| Stress Testing Master Model (ST-M01) and worked example | `…/Stress Testing/` |
| ICAAP Master Model (ICAAP-M01) and worked example | `…/ICAAP Model/` |
| Word templates ICAAP-A01 and ICAAP-A03 to ICAAP-A12 | `…/Annexures/` |
| Builder and fill scripts, input maps | `_Admin/Scripts/models/` (`build_*.py`, `fill_model.py`, `handover.py`, `recalc.py`, `run_examples.py`, `maps/*.json`) |
| RBI return formats and data definitions | `NBFC Policies/Supervisory Returns/RBI Formats/` |
| Reference sources (bank ICAAP outline para 238; BCBS papers) | `…/Prudential Norms on Capital Adequacy/Source/` |

Design rules of the models: no macros; no links between workbooks; inputs are light-yellow cells on the Setup sheet, the sheets whose name ends with "Input" and policy-type sheets; every input has a key listed on the `Source Map` sheet; results show GREEN / AMBER / RED; the `Method Notes` sheet of each workbook explains every formula; the `Checks` sheet must show no "CHECK".

Order of work is always **ECL → Stress Testing → ICAAP**, because each model hands figures to the next (`Handover` sheet → hand-over inputs).

## 2. Questions to ask the company before customising

Ask these in one batch. Do not start filling until the answers to sections A and B are in.

**A. Company and scope**
1. Legal name, CIN, regulatory layer (Base / Middle / Upper) and NBFC category. Any special category (gold loan, MFI, HFC, IFC, core investment company)?
2. Reporting date for this exercise, and whether figures are audited, limited-reviewed or management accounts.
3. Units to be used (₹ crore / ₹ lakh / ₹).
4. Accounting basis: Ind AS or IGAAP. If Ind AS, is there an existing ECL model and an ECL policy?
5. Which of the three models are needed, and is last year's ICAAP / stress test available?

**B. Portfolio and ECL**
6. Product list and how the company groups products for risk (up to 15 segments). Secured or unsecured for each.
7. Is loan-level data (loan tape) available, or only product-wise DPD summaries?
8. How many months of month-end DPD bucket history exist per product (25 months preferred, 13 minimum for roll rates)? If less, which proxy or external PD will be used?
9. Recovery data on defaulted loans (amount, cost, time) for the last 3 to 5 years; collateral types, valuation practice and haircuts.
10. Stage 2 trigger used (31+ DPD or 1+ DPD), qualitative SICR indicators, treatment of restructured accounts, cure periods.
11. Macro-economic variables and scenario weights approved by the company; any management overlays in force.
12. Undrawn sanctioned limits and the credit conversion factor used.

**C. Capital and RWA**
13. Capital adequacy working as filed in DNBS03 (Tier 1 and Tier 2 components, deductions, perpetual and subordinated debt terms).
14. Any risk weights different from the standard ones (consumer credit, guaranteed loans, commercial real estate, exposures to group companies)?
15. Internal capital target and management buffer approved by the Board.

**D. Stress testing**
16. Which risks are material for the company (to switch on or off)? Any risk not in the list?
17. Scenario stories and severities the Risk Management Committee wants (or acceptance of the master defaults as a starting point).
18. Sectors the company regards as stressed; districts or states exposed to flood, drought or cyclone.
19. Operating profit and credit cost budget for the next 12 months; tax rate.
20. Management actions available in a crisis (promoter support, sell-down, lines), with amounts and time needed.

**E. ICAAP**
21. Three-year business plan: growth, profit, dividend, capital raising.
22. Risk appetite statement and limits (to set the RAG thresholds).
23. Key risk indicator data for the scorecards (IT, compliance, complaints, HR, outsourcing, conduct, fraud); which indicators the company already tracks.
24. Slabs and add-on rates the Board wants to use, or acceptance of the master defaults.
25. Who reviews and who approves (Risk Management Committee, Audit Committee, Board) and the meeting dates.

Send the Data Request List (ICAAP-A09) with these questions.

## 3. Documents to collect

- Audited financial statements with notes for the last three years (PDF, and Excel if available).
- DNBS01, DNBS03 and DNBS04A / DNBS04B as at the reporting date, in the RBI Excel formats.
- Capital adequacy working; NPA statement with ageing; previous ECL note and workings.
- Loan tape or product-wise DPD summary; month-end bucket history; NPA movement for five years; recovery register.
- Top 25 borrowers, sector-wise and state-wise exposure; ALM statements; borrowing profile.
- Business plan, risk appetite statement, last ICAAP and stress test, relevant Board and committee minutes.

## 4. How the data are filled

**Step 1 – Build the client data file.** Create one JSON file per model (`<client>_ecl.json`, `<client>_st.json`, `<client>_icaap.json`). Each is a flat list of `key: value`. The keys are in the last column of the model's `Source Map` sheet and in `maps/*.json`, together with the document each value comes from.

**Step 2 – Automatic extraction.** Read the values that come from structured documents and write them into the JSON:

| Source | Feeds |
|---|---|
| Audited balance sheet and P&L (3 years) | ICAAP `fin.*`; Stress `base.nii`, `base.opex`, `base.assets`, `base.borr` |
| DNBS03 (capital funds, risk assets, off-balance sheet items) | ICAAP `cap.*`, `rwa.on.*`, `rwa.off.*`; Stress `base.t1`, `base.t2`, `base.rwa`, `base.of` |
| DNBS01 (asset classification, NPA movement, sectoral credit, top borrowers) | ECL `npa.*`, `def.*`; Stress and ICAAP `top.*`, `sector.*` |
| DNBS04B (structural liquidity, interest rate sensitivity) | Stress `alm.*`; ICAAP `alm.rsa.*`, `alm.rsl.*`, `liq.in.*`, `liq.out.*` |
| Loan tape (CSV / Excel) | ECL `tape` (list of rows) with `setup.source = "Loan tape"`, or summarised into `port.b*.*` |
| Month-end bucket reports | ECL `hist.<segment>.m<month>.b<bucket>` |

Read the RBI return files with openpyxl by sheet and label, not by fixed cell, because the formats change between versions; the data-definition files in `RBI Formats/Data Definitions` identify each element. Record in a short extraction note which cell of which file each figure came from.

**Step 3 – Manual inputs.** Everything else (methods, scenario severities, thresholds, KRIs, plan assumptions, overlays, management actions) comes from the answers in section 2 and is typed into the same JSON so that the fill is repeatable.

**Step 4 – Fill and chain.** Run from `_Admin/Scripts/models/`:

```
python3 fill_model.py "<ECL master>" maps/ecl_map.json <client>_ecl.json "<client> ECL Model.xlsx"
python3 handover.py "<client> ECL Model.xlsx" stress <client>_st.json
python3 fill_model.py "<Stress master>" maps/st_map.json <client>_st.json "<client> Stress Testing Model.xlsx"
python3 handover.py "<client> ECL Model.xlsx" icaap <client>_icaap.json
python3 handover.py "<client> Stress Testing Model.xlsx" icaap <client>_icaap.json
python3 fill_model.py "<ICAAP master>" maps/icaap_map.json <client>_icaap.json "<client> ICAAP Model.xlsx"
python3 recalc.py "<each client model>"
```

`fill_model.py` reports any key it does not recognise; that list must be empty. `recalc.py` recalculates with LibreOffice and must report zero formula errors.

**Step 5 – Checks.** Open each model: the `Checks` sheet must show OK on every line (or a written explanation for a line that cannot be cleared). Reconcile: gross loans, Stage 3 / NPA, total assets, Tier 1, RWA and CRAR must agree with the financial statements and DNBS03.

## 5. Customising the structure (when the master does not fit)

Changes are made in the builder scripts, not by editing a workbook by hand, so that the model can be rebuilt.

| Need | Where |
|---|---|
| Segment names, methods, active segments | `Setup` inputs (no code change) |
| Risk not applicable | `Setup` risk switch (Stress) or `Risk Universe` = No with reason (ICAAP) |
| Different scenario severities, slabs, thresholds, score bands | Yellow inputs on `Scenarios` / `Setup` |
| Different KRIs, thresholds or weights | Yellow inputs on `Risk Scorecards` |
| An additional risk with its own method | Add a sheet and a row in `RU` in `build_icaap.py` (and a loss line in `build_stress.py`) |
| More than 15 segments or other time buckets | Change `N` / `BUCK` in the builders and rebuild |
| Company-specific risk weights | `Risk Weighted Assets Input` inputs |

After any code change run `run_examples.py`: all three masters and worked examples must rebuild with zero formula errors.

Remove what the company does not need only by switching it off; do not delete sheets, because formulas on other sheets refer to them.

## 6. Review before delivery

1. Every yellow cell that drives a result is either filled or deliberately blank; the Model Assumptions and Parameters Register (ICAAP-A08) lists every company decision with its approval.
2. Every risk weight, minimum ratio and provisioning rate is checked against the current RBI Directions for the company's layer and category.
3. Results are sense-checked against last year and against the worked example; movements are explained.
4. The documents are filled from the models: ECL Methodology Note (A10), Stress Testing Report (A06), ICAAP Document (A01, from `Document Tables`), Capital Plan (A07), Board Note (A05).
5. File names carry the company name and reporting date, no version labels. Client files are kept in the client's folder, not in the master library.

## 7. Limits to state to the company

- The RBI prescribes no Pillar 2 capital charge for NBFCs; the add-ons are internal estimates the Board must own.
- Default severities, slabs, correlations and thresholds in the masters are starting points, not regulatory values.
- ECL is a collective model; large individually assessed exposures are handled through the Overlay sheet.
- The stress test is a one-year, static balance sheet test.

## 8. Regulatory and Financial Ratio Model (RATIO-M01) – added 25-11-2026

**Location:** `NBFC Policies/Supervisory Returns/Ratio Model/`. Builder `build_ratio.py`; reader `read_dnbs.py`; input map `maps/ratio_map.json`; rules for software `maps/ratio_rules.json` (also the "Rules" sheet).

**Questions to ask before customising**
1. Regulatory layer, category (Investment and Credit Company, Microfinance Institution, Factor, Infrastructure Finance Company, Housing Finance Company, Core Investment Company, other) and whether it accepts public deposits.
2. Is it primarily a gold-loan company (50 per cent or more of financial assets)?
3. Do the Liquidity Coverage Ratio and the Prompt Corrective Action framework apply to it?
4. Which DNBS returns does it file (DNBS01 or DNBS02; DNBS03; DNBS04A / 04B), and for which three dates are files available (current, previous period, same period last year)?
5. Units used in its returns and accounts; Ind AS or IGAAP; months covered by each profit and loss figure.
6. Internal limits and early-warning triggers in its risk appetite statement (to replace the default triggers); any ratio the Board tracks that is not in the list.
7. Any regulatory dispensation or glide path (for example net owned fund) that changes a limit.

**Fill method**
```
python3 read_dnbs.py "<DNBS02 current>.xlsx"  cur  <client>_ratio.json
python3 read_dnbs.py "<DNBS02 previous>.xlsx" prev <client>_ratio.json
python3 read_dnbs.py "<DNBS02 last year>.xlsx" ly  <client>_ratio.json
python3 fill_model.py "<Ratio master>" maps/ratio_map.json <client>_ratio.json "<client> Ratio Model <date>.xlsx"
python3 recalc.py "<client> Ratio Model <date>.xlsx"
```
`read_dnbs.py` reads every part of the return by its printed label and fills 35 items from a DNBS02 (tested on filled returns); it prints the items it could not find. `read_dnbs.py <file> --list` prints every label and value in a DNBS02 return. DNBS01, DNBS03, DNBS04A and DNBS04B are read by `read_dnbs_more.py` (added 25-11-2026), which finds each line by part, table title and printed label and each column by its heading:
```
python3 read_dnbs_more.py "<return>.xlsx" list
python3 read_dnbs_more.py "<DNBS01>.xlsx" ratio <client>_ratio.json cur      # 39 items; also prev / ly
python3 read_dnbs_more.py "<DNBS03>.xlsx" ratio <client>_ratio.json cur      # owned fund, net owned fund, Tier 1, Tier 2, risk-weighted assets, intangibles
python3 read_dnbs_more.py "<DNBS04B>.xlsx" ratio <client>_ratio.json cur     # inflows and outflows of the first three buckets
python3 read_dnbs_more.py "<DNBS04B>.xlsx" alm <client>_alm.json             # ALM Model: 11 outflow and 9 inflow lines, rate-sensitive totals
python3 read_dnbs_more.py "<DNBS04A>.xlsx" stdl <client>_stdl.json           # reference figures only
```
Status: DNBS02 is tested on returns filed by a company in both layouts, the RBI utility file and the file downloaded from the portal (which has no row codes and is in rupees); the two layouts agree on all 36 items. `read_dnbs.py` now hands a return it cannot read in full to `read_dnbs_more.py`, so the three commands above work for both layouts. Add `--ytd` to the `ratio` command of `read_dnbs_more.py` to take the cumulative column of the profit and loss part. DNBS01, DNBS03 and DNBS04 are tested on the blank RBI formats only (`test_read_dnbs.py`, which fills every input cell, lets LibreOffice calculate the RBI formulas and reads the file back): run `list` on the first real file and compare by eye before relying on it. Exposure to group companies in DNBS01 (Part 5) is a list and stays a manual entry. In DNBS03 the "Net owned fund" line is taken as Tier 1. DNBS04B lines that are not mapped fall into "Other outflows" and "Other inflows", so the totals equal the return; liquid investments are taken as statutory investments plus current listed investments, which is a reading of the labels and should be confirmed with the company. Capital, asset quality, liquidity and concentration items not in the return are typed into the JSON or the yellow cells. The "financial assets" figure is a first estimate (loans + investments + cash and bank) and must be confirmed.

**Before delivery:** set the company profile; check that each limit still matches the Direction cited in its Reference (all were matched to a paragraph on 25-11-2026); set the internal triggers; clear the Checks sheet. The PCA block takes its minimums from the limit column, so a gold-loan NBFC is measured from a Tier 1 minimum of 12 per cent, and a Core Investment Company is tested on ANW / RWA, leverage and net NPA (Miscellaneous Supervisory Directions, 2026, paras 3, 16 and 17).

## 9. When a new RBI advisory is added to the Advisories folder

1. Copy the PDF into `NBFC Policies/Advisories/Source` with the name pattern `RBI Advisory No. <n> of <year> (<dd-mm-yyyy>) - <subject> - CONFIDENTIAL.pdf` (keep the confidentiality marking in the name where the advisory carries one).
2. Read it; write the applicability note (ADV-A02) and add a row to the register (ADV-A01).
3. Decide what it needs: a new control checklist, an update to an existing SOP or policy, a new annexure, To-Do items with the dates in the advisory, tracker rows.
4. Write the controls in the Company's own words. Do not copy the advisory text, indicators of compromise or any recipient watermark into a master; refer to the advisory by number, date and subject.
5. Add the documents to `_Admin/Scripts/specs/sopx_advisories.py`, build with `build_sop.py sopx_advisories`, add To-Do rows, update `tracker_data.py` and run `build_trackers.py`.
6. Add a control test sheet (ADV-A15) for each new control.

## 10. Applicability Engine, Classification Engine, ALM Model and Exposure Monitor – added 25-11-2026

All four follow the same rules as the earlier models: no macros, no links to other files, light-yellow input cells with keys, a Method Notes sheet, a Rules sheet for software, a Checks sheet, a Source Map sheet and a worked example with a fictitious company. Builders, example scripts and maps are in `_Admin/Scripts/models/`; `run_examples.py` rebuilds every model and must show zero errors.

| Model | Location under `NBFC Policies/` | Builder | Map | Main inputs |
|---|---|---|---|---|
| APP-M01 Applicability Engine | `Registration, Exemptions and Framework for Scale Based Regulation/Applicability Engine/` | `build_applicability.py` (data: `data/applicability_register.json`) | `maps/app_map.json`; rules `maps/app_rules.json` | 46 profile answers (`profile.<code>`) |
| IRAC-M01 Asset Classification and Provisioning Engine | `Income Recognition, Asset Classification and Provisioning/Classification Engine/` | `build_iracp.py` | `maps/irac_map.json` | Loan tape (`loans`, up to 1,000 rows) |
| ALM-M01 Asset Liability Management and Liquidity Model | `Asset Liability Management/ALM Model/` | `build_alm.py` | `maps/alm_map.json` | Outflows and inflows by bucket, rate-sensitive items, liquid assets, limits |
| EXP-M01 Exposure and Concentration Limits Monitor | `Concentration Risk Management/Exposure Monitor/` | `build_exposure.py` | `maps/exp_map.json` | Borrower list (`borrowers`, up to 300 rows), groups, sectors, states, Tier 1 |

**Questions to ask before customising**
1. Applicability Engine: the answers in the Entity Profile (Scope of Work, NBFC 1) – layer, category, asset size, deposits, listing, products, digital lending, default loss guarantee, co-lending, securitisation, branches, Ind AS, public-company and CSR thresholds, dividend, API-based fund transfers, group and offshore service providers. Which policies are already in place (Yes / Partly / No)?
2. Classification Engine: can the loan system export one row per loan with borrower ID, product, secured or unsecured, principal, overdue interest, days past due, date of NPA, security value and flags for restructured, fraud and loss? More than 1,000 loans: run in batches or code the Rules sheet in the loan system. Confirm the period for sub-standard assets and the provision rates the company applies above the regulatory minimum.
3. ALM Model: bucket-wise statement of structural liquidity (DNBS04 or the ALCO pack); internal mismatch limits approved by the Board; whether the Liquidity Coverage Ratio applies; the run-off factors and haircuts in the Coverage Ratio sheet are defaults to be confirmed against the Directions before use.
4. Exposure Monitor: Tier 1 capital; borrower-wise exposure with group, sector and state; whether the company is an Infrastructure Finance Company or in the Upper Layer; internal limits set by the Board; sensitive sectors the company tracks.

**Where the data come from.** Applicability: Entity Profile and Policy Register. Classification: loan tape from the loan system. ALM: DNBS04B through `read_dnbs_more.py ... alm` (section 8), ALCO statements and the balance sheet. Exposure: loan tape grouped by borrower, and the capital computation. Whatever is not in these sources is typed into the yellow cells.

**Keeping the Applicability Engine and the Scope of Work in step.** The engine reads the Policy Register through `data/applicability_register.json`. When a line is added to `NBFC 6 Policy Register.xlsx`, add it to the JSON with the same serial number, add a rule in the `TR` table of `build_applicability.py` if the line is conditional, rebuild and run the example. Serial numbers are never reused or renumbered, because the rules are keyed to them.

**Hand-overs.** Classification Engine → ECL Model (Prudential Floor layout) and Ratio Model (gross and net NPA). ALM Model → Stress Testing (liquidity) and ICAAP. Exposure Monitor → ICAAP (concentration) and Ratio Model. Hand-overs are by value, never by link.

## 11. Outsourcing workbooks – added 25-11-2026

`_Admin/Scripts/specs/xlsx_outmerge.py` builds the workbooks of the outsourcing pack; `python3 xlsx_outmerge.py OUT-A01` rebuilds one.

- **OUT-A01 Materiality and Risk Assessment** (one copy per arrangement): materiality of financial services (six factors of para 14), materiality of IT services (two tests of para 58), risk evaluation across the key risks of para 22, IT risk assessment with the documentation trail of para 66, provider concentration and the class (Tier 1, 2 or 3). Thresholds, multipliers and limits are on the Thresholds sheet; ask the company for the values its Board has fixed, otherwise keep the starting values and record that they are to be approved.
- **OUT-A06 Central Register**: register, IT inventory and dependency map, vendor classification, sub-contractors and dashboard.
- **OUT-A10**: incidents, reviews, deviations, ownership exceptions and customer grievances with the 30-day test.
- **VD-00**: vendor document tracker and audit reports on service providers.
- **IT-A46 Cloud Controls Workbook**: data lifecycle, shared responsibility, role register, segregation rules, access controls and dashboard. Only for companies using cloud services.

The Word documents of the pack (OUT-A02 to A04, A08, A11 to A17, IT-A06, IT-A45, IT-A47) are defined in `specs/out_pack.py` and `specs/out_pack2.py`. Conditional documents: OUT-A15 (group entities), OUT-A16 (service providers outside India), IT-A46 (cloud), IT-A47 (outsourced security operations centre), OUT-A13 Part B (ownership exception).

## 12. Pricing calculator, dividend monitor and lending limits monitor – added 25-11-2026

| Model | Location under `NBFC Policies/` | Builder | Map | Main inputs |
|---|---|---|---|---|
| KFS-M01 Key Facts Statement and APR Calculator | `Responsible Business Conduct/Loan Pricing Calculator/` | `build_pricing.py` | `maps/kfs_map.json` | One loan: amount, rate, instalments, every charge; cooling-off and penal charge cases |
| DIV-M01 Dividend Eligibility and Early Warning Monitor | `Prudential Norms on Declaration of Dividends/Dividend Monitor/` | `build_dividend.py` | `maps/div_map.json` | Three years of capital compliance, net NPA, CRAR, Tier 1; profit and dividend |
| LEND-M01 Lending Limits Monitor | `Credit Facilities/Lending Limits Monitor/` | `build_lending.py` | `maps/lend_map.json` | Tables `guarantees` (50), `gold` (500), `shares` (200), `households` (500); amounts in rupees |

**Questions to ask before customising**
1. Pricing: products and their charges (own and third-party), instalment frequency, whether loans are digital, cooling-off period in the credit policy, penal charge rate in the Board policy. Confirm with the company that the APR in its loan system uses the same method (periodic rate x instalments in a year).
2. Dividend: type of company for the ceiling, years since registration, whether the Prompt Corrective Action framework applies, minimum CRAR and Tier 1 for its category.
3. Lending limits: which of the four products the company has; internal loan-to-value limit for income-generating gold loans; Board limit for microfinance repayment (not above 50 per cent); whether assets are ₹100 crore or more (loans against shares).

Standalone Primary Dealers are outside the dividend monitor. The lending monitor is run on the day's values; larger books run in batches.

## 13. Compliance Testing Model (CMP-M01) – added 25-11-2026

**Location:** `NBFC Policies/Compliance Function/Compliance Testing/`. Builder `build_compliance.py`; example `example_compliance.py`; independent checks `check_compliance.py` (run by `run_examples.py` and `test_models.py`); map `maps/cmp_map.json`. For NBFCs in the Middle and Upper Layer (Compliance Function Directions, paras 3, 6, 7, 9(3), 9(4), 15(2) to 15(4), 17 and 32).

**What it does.** Universe Input (300 obligations) → Risk Assessment (likelihood x impact, control rating, residual risk) → Annual Plan (tests in the year by residual band, by quarter) → Test Programme Input (200 tests) and Test Results (sample recommended, exception rate, Red / Amber / Green) → Issue Tracker Input (200 issues) and Issue Ageing → New Products (six-month monitoring) → Management Dashboard and Board Report.

**Questions to ask before customising**
1. Layer; first day of the financial year; how often the Board or Audit Committee reviews compliance risk (para 6).
2. The compliance domains and owner functions the company uses (12 of each on Setup); the domain that covers fair practices.
3. Does the company accept the scale (1 to 5), the bands (4 / 9 / 16), the share of risk left after each control rating (25 / 50 / 75 / 100 per cent) and the tests in a year (Critical 4, High 4, Medium 2, Low 1; priority obligations at least 2)? These must match its Compliance Policy.
4. Sample table: keep the default (last row 22 / 29 / 45 / 59, the zero-exception attribute samples at 90 and 95 per cent confidence for 10 and 5 per cent tolerable failure) or the company's own basis; Amber and Red exception rates (5 and 10 per cent).
5. Days allowed to close High, Medium and Low issues; who may approve an extension (para 32(4)).
6. Residual risk counts of the previous assessment, penalties and regulatory actions of the year (for the annual review, para 7).

**Fill method.** The universe comes from the filled Applicability Engine (lines that apply), the Policy Register and the regulatory update register; one row per paragraph tested, with the paragraph verified against the Direction. Scores come from the risk assessment workshop (SOP – Compliance Function, Step B2). Tests are entered from the Annual Plan; results from the work-papers (CMP-A04). Tables are keyed `universe`, `tests`, `issues`, `products` for `fill_model.py`:
```
python3 fill_model.py "<CMP master>" maps/cmp_map.json <client>_cmp.json "<client> Compliance Testing Model <date>.xlsx"
python3 recalc.py "<client> Compliance Testing Model <date>.xlsx"
```

**Before delivery:** clear the Checks sheet; confirm that the frequencies and the sample table are those in the company's Compliance Policy; do not carry the fictitious obligations of the worked example into a client file without re-reading each paragraph.

**Register line.** The model answers line 164 of the NBFC Policy Register (compliance risk assessment and compliance testing programme). `add_register_line.py` adds a line to the engine data file and to both forms of NBFC 6 in one step.

## 14. Tier 3 models (SEC-M01, RBIA-M01, EWS-M01, BP-M01) – added 25-11-2026

Builders `build_securitisation.py`, `build_rbia.py`, `build_ews.py`, `build_bp.py`; examples `example_securitisation.py`, `example_rbia.py`, `example_ews.py`, `example_bp.py`; independent checks `check_tier3.py` (run by `run_examples.py` and `test_models.py`); maps `maps/sec_map.json`, `rbia_map.json`, `ews_map.json`, `bp_map.json`. Each table is filled as one keyed block (`pool`, `units`, `ind`, `acc`).

### 14.1 Securitisation Retention and Holding Period Calculator (SEC-M01)

**Location:** `NBFC Policies/Securitisation Transactions/Retention Calculator/`. Securitisation Transactions Directions, paras 5 to 8, 10 to 14, 110 and 112; Transfer and Distribution of Credit Risk Directions, para 43. Holds 500 loans.

**Questions to ask**
1. Date of transfer; are the notes residential mortgage backed securities (5 per cent whatever the maturity)?
2. Pool with both short and long loans: retention loan by loan (default) or 10 per cent on the whole pool? RBI has published no clarification; record the arranger's and the auditor's view.
3. For each loan: is the security registered with CERSAI, is it a project loan, a real estate mortgage, a loan acquired from another entity? These decide the date from which the holding period runs.
4. Bullet loans: only farm loans up to 24 months and trade receivables up to 12 months with the repayment record of the proviso to para 5; the calculator does not apply the 365-day residual maturity test to them (reading to be confirmed for each deal).
5. Structure: first loss facility, equity tranche, other tranches retained; over-collateralisation and the interest-only strip are not counted.

**Limits to state:** tests the date of transfer only (para 14(2) asks for the retention to be maintained on the unamortised principal); does not test true sale, credit enhancement, capital or the simple, transparent and comparable criteria.

### 14.2 Internal Audit Risk Assessment and Audit Plan (RBIA-M01)

**Location:** `NBFC Policies/Internal Audit Function/Audit Risk Scoring/`. Internal Audit Function Directions, paras 3, 25 to 32 and 34; Compliance Function Directions, para 17. Holds 150 auditable units.

**Questions to ask**
1. First day of the plan year; number of auditors and audit days per auditor.
2. The audit universe: every branch, business line, support function (including risk management and compliance), process, system and outsourced activity.
3. Does the Audit Committee accept the weights of the eleven parameters, the cut-offs (2.0 and 3.5), the risk matrix, the audit frequency (6, 12, 12, 18 and 24 months) and the standard auditor-days? All are on Setup.
4. Compliance risk score of each unit: take it by value from the Compliance Testing Model (CMP-M01).
5. Units to be audited every year whatever the risk.

**Notes.** The starting risk matrix is the illustrative matrix RBI gives to banks (Commercial Banks – Internal Audit Function Directions, 2026; Guidance Note on Risk-Based Internal Audit, 2002); the Directions for NBFCs print none. Para 32 does not define magnitude and frequency: the model reads them as inherent business risk and control risk, which makes the six combinations of para 32 the six cells the matrix rates High or above. No frequency shorter than six months (at most two audits of a unit in a year).

### 14.3 Fraud Early Warning Scoring Model (EWS-M01)

**Location:** `NBFC Policies/Fraud Risk Management/Early Warning Model/`. Fraud Risk Management Directions, paras 14 to 23 and 43 (Upper and Middle Layer). Holds 30 indicators and 300 accounts.

**Questions to ask**
1. Which indicators can the company's systems test? Replace the illustrative wording with those tests; switch off the rest. RBI prescribes no list, weight or score for NBFCs.
2. Weights, critical indicators, the Amber and Red scores (10 and 25) and the days allowed for an examination (30): to be approved by the Board level committee.
3. Target capture rate for the yearly validation (para 16).
4. Source of the flags: loan system, credit monitoring, bureau, market intelligence; who records the status of each examination.

**Limits to state:** account-by-account model for corporate and MSME loans; retail books and non-credit transactions (paras 21 to 23) need rules in the transaction systems, for which the Rules sheet is the specification. A score is not a finding of fraud.

### 14.4 Business Plan Projection Model (BP-M01)

**Location:** `NBFC Policies/Prudential Norms on Capital Adequacy/Business Plan Model/`. Capital Adequacy Directions, paras 6, 17 and 54.

**Questions to ask**
1. Base date and unit (use the unit of the ICAAP model); minimum ratios (Tier 1 is 12 per cent for an NBFC primarily lending against gold jewellery); does the leverage limit of a Base Layer NBFC apply; management buffer.
2. For each of five years: growth, yield, other income, cost of borrowings, operating expense ratio, credit cost, liquid assets, dividend payout, equity and Tier 2 to be raised and repaid.
3. Will the product mix change the share of risk-weighted assets in total assets?
4. The downside scenario: the changes to growth, yield, cost of borrowings, credit cost and equity raised; which scenario goes to the ICAAP.

**Hand-over.** `python3 handover.py "<BP-M01 filled>.xlsx" icaap <client>_icaap.json` carries the fifteen capital plan values (`plan.g`, `plan.pat`, `plan.div`, `plan.eq`, `plan.t2` for three years) into the ICAAP data.

**Limits to state:** whole-company planning tool; interest expense is on opening borrowings plus half of the growth funded by debt (the Checks sheet tests it against the simple average); deductions from Tier 1 are held constant.

## 15. Open points closed on 25-11-2026

- **KFS-M01 APR.** The method (rate per instalment period on the net disbursed amount x instalments in a year) reproduces the illustration of the RBC Directions, para 29(3): ₹20,000 at 15 per cent over 24 months, charges ₹400, APR 17.07 per cent. Compounding (18.47 per cent) and day-count XIRR (18.75 per cent) do not. A test in `test_models.py` keeps it so. The KFS line "total amount to be paid by the borrower" is now loan plus interest, as in the illustration.
- **DIV-M01 and RATIO-M01.** PCA thresholds read against the Miscellaneous Supervisory Directions, 2026, paras 16 and 17; applicability against para 3 (deposit-taking NBFCs and non-deposit taking NBFCs in the Middle and Upper Layers; not NBFCs without public funds, Primary Dealers or HFCs; Government NBFCs included since 1 October 2024). The nine limits that were marked "confirm" now cite CIC Directions paras 20, 3(1) and 3(2); HFC Directions para 10(9)(i) and (ii); Miscellaneous Directions para 42; Public Deposits Directions para 63(1); Credit Facilities Directions para 24(1).
- **ALM-M01 LCR.** Factors and haircuts match Chapter III of the ALM Directions (paras 62, 68 to 70, 76); a line for the section 45-IB approved securities of deposit-taking NBFCs applies para 71 (80 per cent of the required holding).
- **Fee benchmarking.** `Scope of Work/09 Tools/Fee Benchmark Register.xlsx` (builder `build_fee_benchmark.py`); method in the Scope of Work playbook, section 8.
- **Sector profile questions.** `Scope of Work/09 Tools/Scope Generator/sector profile questions (proposed).md` and `.json`; the generator accepts `profile answers`.
