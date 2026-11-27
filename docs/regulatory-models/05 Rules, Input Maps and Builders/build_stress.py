"""Stress Testing Master Model. Run: python3 build_stress.py <out.xlsx> <map.json>"""
import sys
from xl import *

B = Book('ST-M01', 'Stress Testing Master Model')
GUARD[0] = "N('In_Base'!$B$6)=0"   # no Tier 1 capital entered yet: RAG cells stay blank
YN = ['Yes', 'No']; SCN = ['Baseline', 'Adverse', 'Severe']; SC = 'BCD'
N = 15; NT = 20; NS = 10
BUCK = ['1-7 days', '8-14 days', '15-30/31 days', 'Over 1 to 2 months', 'Over 2 to 3 months', 'Over 3 to 6 months', 'Over 6 months to 1 year', 'Over 1 to 3 years', 'Over 3 to 5 years', 'Over 5 years']
BEND = [7, 14, 30, 60, 90, 180, 365, 1095, 1825, 3650]; BMID = [0.01, 0.03, 0.06, 0.125, 0.21, 0.375, 0.75, 2.0, 4.0, 7.0]
RISKS = ['Credit risk', 'Credit concentration risk', 'Interest rate risk (earnings)', 'Market risk (investments and FX)', 'Liquidity and funding cost risk', 'Operational risk', 'Cyber and IT risk',
         'Compliance and legal risk', 'Reputation risk', 'Strategic and business risk', 'Climate and ESG risk', 'Model risk', 'Group and contagion risk']

readme(B, 'Stress Testing Master Model',
       ['This workbook applies three hypothetical scenarios (Baseline, Adverse, Severe) to the company\'s capital, earnings and liquidity, risk by risk and in combination, and shows the post-stress CRAR, Tier 1 ratio, leverage and liquidity survival horizon with Red / Amber / Green results. It also runs a reverse stress test and passes a stress capital buffer to the ICAAP model.',
        'The scenarios are hypothetical. Their severities are inputs on the Scenarios sheet and must be set for each company by its Risk Management Committee.'],
       ['Setup: enter company details, regulatory minima, tax rate and thresholds; switch off any risk that does not apply.',
        'In_Base: enter the starting position – capital, RWA, earnings, loan book by segment (from the ECL model Handover sheet), top 20 borrowers, sectors, states, liquidity buckets and repricing buckets.',
        'Scenarios: read the three scenario stories, edit them for the company and review every shock size.',
        'Read the risk sheets (ST_Credit, ST_Concentration, ST_IRRBB, ST_Liquidity, ST_Other) and then ST_Combined for the overall result.',
        'ST_Reverse shows how large a loss would break the minimum CRAR. Mgmt_Actions records the actions the company would take and their effect.',
        'Clear the Checks sheet, then pass the Handover figures to the ICAAP model.'],
       [('Method Notes', 'explains every formula'), ('Setup', 'minima, thresholds, risk switches'), ('In_Base', 'starting position'), ('Scenarios', 'scenario stories and shock sizes'),
        ('ST_Credit', 'credit losses by segment'), ('ST_Concentration', 'top borrowers, sector and state shocks'), ('ST_IRRBB', 'interest rate, investment and FX shocks'),
        ('ST_Liquidity', 'stressed cash flows and survival horizon'), ('ST_Other', 'operational, cyber, compliance, reputation, strategic, climate, model and group risks'),
        ('ST_Combined', 'all risks together: post-stress capital ratios'), ('ST_Reverse', 'reverse stress test'), ('Sensitivity', 'CRAR against PD multiples'),
        ('Mgmt_Actions', 'management actions and post-action ratios'), ('Dashboard', 'RAG summary'), ('Handover', 'figures for the ICAAP model'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how this model produces its results')
m.text_block(4, [
 '# 1. Overall logic',
 'Each risk sheet turns the shock sizes on the Scenarios sheet into a rupee loss for each of the three scenarios. ST_Combined adds the losses of the risks that are switched on, sets them against the year\'s pre-provision operating profit, and recomputes capital, RWA and the ratios. Liquidity is tested separately as a survival horizon because a liquidity shortfall is not cured by capital.',
 '# 2. Credit risk (ST_Credit)',
 'For each segment: (a) higher PD on the performing book = performing exposure x PD x (PD multiplier - 1) x (LGD + LGD add-on); (b) additional slippage = performing exposure x slippage % (plus the extra slippage for segments marked as stressed sectors) x (LGD + LGD add-on); (c) lower recovery on existing Stage 3 = Stage 3 exposure x LGD add-on. Income lost on new NPAs = new NPA amount x income-loss %.',
 '# 3. Concentration (ST_Concentration)',
 'Top-N default: the N largest borrowers (ranked by exposure) default; loss = their exposure x LGD on large borrowers. Sector and state shocks: largest sector (state) exposure x slippage % x average LGD. The Herfindahl-Hirschman Index (HHI = sum of squared shares) is shown for the top-20 borrowers, sectors and states.',
 '# 4. Interest rate, investments and FX (ST_IRRBB)',
 'Earnings at risk (12 months) = for each repricing bucket up to one year: (rate-sensitive assets x asset pass-through - rate-sensitive liabilities x liability pass-through) x rate shock x (1 - bucket mid-point in years). A negative figure is a loss. Change in economic value of equity (EVE) = - sum of (assets - liabilities) x bucket mid-point x rate shock; it is reported against Tier 1 capital (15% is the Basel outlier level) but is not added to the P&L loss. Investment loss = equity and mutual fund holdings x price fall + bond holdings x modified duration x yield rise. FX loss = net open position x currency move.',
 '# 5. Liquidity (ST_Liquidity)',
 'Opening liquidity = liquid assets x (1 - haircut) + undrawn bank lines x (1 - share withdrawn). For each time bucket: stressed inflows = collections x (1 - collection shortfall) + other inflows; stressed outflows = contractual outflows + drawdown of customers\' undrawn limits (placed in the 15-30 day bucket). The cumulative position is tracked; the survival horizon is the end of the last bucket before the cumulative position turns negative. Funding cost loss = borrowings x share repricing within a year x increase in cost.',
 '# 6. Other risks (ST_Other)',
 'Each is sized as a percentage of a base that is already in In_Base: operational and cyber losses on gross income, compliance penalties on operating profit, reputation loss on net interest income, strategic loss on operating profit plus cost overrun on operating expenses, climate loss on the climate-exposed share of each segment, model risk on the ECL held, group risk on Tier 1 capital.',
 '# 7. Combination (ST_Combined)',
 'Total stress loss = simple sum of the active risks, or the square root of the sum of squares where that option is chosen on Setup (this assumes the risks are independent and gives a smaller figure; the simple sum is the conservative default). Stressed profit before tax = operating profit - budgeted credit cost - total stress loss. If positive, the after-tax profit is added to Tier 1 when "count stressed-year profit" is Yes; if negative, the full loss is deducted from Tier 1 with no tax relief. Post-stress RWA = RWA - additional provisions on loans, but only up to the fall in Tier 1 capital, so that a loss absorbed by the profit of the year cannot make the ratio look better than before the stress. Tier 2 is capped at Tier 1. CRAR = (Tier 1 + Tier 2) / RWA. Leverage = outside liabilities / owned fund after the loss.',
 '# 8. Reverse stress test (ST_Reverse)',
 'The loss L that brings CRAR exactly to the minimum solves (Capital - L) / (RWA - L) = minimum, so L = (Capital - minimum x RWA) / (1 - minimum). The sheet restates L as a multiple of operating profit, as a slippage percentage of the performing book and as a number of the largest borrowers.',
 '# 9. RAG',
 'Each result is compared with the amber and red thresholds on Setup. Red on CRAR or Tier 1 means the regulatory minimum is breached in that scenario; the company must record a management action on Mgmt_Actions.',
 '# 10. Limits of the model',
 'It is a one-year, static balance sheet test. Second-round effects, behavioural changes and multi-year paths are not modelled; the ICAAP capital plan covers the multi-year view.'])

# ------------------------------------------------------------------ Setup
s = B.sheet('Setup', (52, 18, 16, 16), tab='C00000')
s.title('Setup – minima, thresholds and risk switches', 'Fill this sheet first.')
s.sec('A3', 'A. General', 3)
gen = [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None), (5, 'Reporting date', 'setup.date', None, 'date', None), (6, 'Amounts are in', 'setup.units', '₹ crore', 'txt', ['₹ crore', '₹ lakh', '₹']),
       (7, 'Regulatory layer', 'setup.layer', 'Middle Layer', 'txt', ['Base Layer', 'Middle Layer', 'Upper Layer']), (8, 'Minimum CRAR', 'setup.mincrar', 0.15, 'pct', None), (9, 'Minimum Tier 1 ratio', 'setup.mint1', 0.10, 'pct', None),
       (10, 'Maximum leverage (outside liabilities / owned fund)', 'setup.maxlev', 7, 'num', None), (11, 'Tax rate', 'setup.tax', 0.2517, 'pct', None),
       (12, 'Combination of risks', 'setup.agg', 'Simple sum', 'txt', ['Simple sum', 'Square root of sum of squares']), (13, 'Scenario passed to ICAAP', 'setup.plan', 'Severe', 'txt', ['Adverse', 'Severe']),
       (14, 'Count stressed-year profit as capital', 'setup.profit', 'No', 'txt', YN)]
for r, lab, key, d, fmt, lst in gen:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, d, fmt, 'RBI Capital Adequacy Directions / company policy', lst)
s.head(16, ['B. RAG thresholds', 'Amber', 'Red'])
thr = [(17, 'Post-stress CRAR: amber below / red below', 'thr.crar', 0.17, 0.15, 'pct'), (18, 'Post-stress Tier 1 ratio: amber below / red below', 'thr.t1', 0.115, 0.10, 'pct'),
       (19, 'Liquidity survival horizon in days: amber below / red below', 'thr.surv', 90, 30, 'int'), (20, 'Stress loss / operating profit: amber from / red from', 'thr.loss', 0.5, 1.0, 'pct'),
       (21, 'Fall in EVE / Tier 1: amber from / red from', 'thr.eve', 0.10, 0.15, 'pct'), (22, 'Post-stress leverage: amber from / red from', 'thr.lev', 6, 7, 'num')]
for r, lab, key, a, rd, fmt in thr:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key + '.amber', lab + ' – amber', a, fmt, 'Risk appetite statement'); s.inp('C%d' % r, key + '.red', lab + ' – red', rd, fmt, 'Risk appetite statement')
s.head(25, ['C. Risks included in the stress test', 'Active'])
for j, rk in enumerate(RISKS):
    r = 26 + j; s.lbl('A%d' % r, rk); s.inp('B%d' % r, 'risk.active.%d' % (j + 1), rk + ' – active', 'Yes', 'txt', 'Risk materiality assessment', YN)
ST = lambda c: q('Setup', c)
RACT = lambda j: '(%s="Yes")' % ST('$B$%d' % (26 + j))

# ------------------------------------------------------------------ Base data
b = B.sheet('In_Base', (48, 18, 16, 14, 14, 14, 18, 16), tab='BF9000')
b.title('In_Base – starting position', 'From the latest audited or reviewed financial statements, the DNBS returns and the ECL model Handover sheet.')
b.sec('A5', 'A. Capital, earnings and balance sheet', 3)
base = [('t1', 'Tier 1 capital', 'DNBS03 capital funds; capital adequacy note'), ('t2', 'Tier 2 capital', 'DNBS03 Part 2 (Tier II)'), ('rwa', 'Risk-weighted assets', 'DNBS03 Parts 3-5'),
        ('assets', 'Total assets', 'Balance sheet; DNBS01 Part 2'), ('osl', 'Total outside liabilities', 'Balance sheet (total liabilities less owned fund)'), ('of', 'Owned fund', 'DNBS03; capital adequacy working'),
        ('ppop', 'Pre-provision operating profit – next 12 months (budget)', 'Business plan'), ('ccost', 'Budgeted credit cost – next 12 months', 'Business plan'), ('nii', 'Net interest income – annual', 'P&L; DNBS01 Part 3'),
        ('opex', 'Operating expenses – annual', 'P&L'), ('borr', 'Total borrowings', 'Balance sheet; DNBS01 Part 1'), ('reprice', 'Share of borrowings repricing or maturing within 1 year', 'ALM statement; DNBS04B'),
        ('gross', 'Gross loans', 'ECL Handover: ecl.gross'), ('s3', 'Stage 3 / gross NPA', 'ECL Handover: ecl.s3'), ('ecl', 'ECL allowance held', 'ECL Handover: ecl.total'),
        ('pd', 'Exposure-weighted 12-month PD', 'ECL Handover: ecl.pd'), ('lgd', 'Exposure-weighted LGD', 'ECL Handover: ecl.lgd'), ('hqla', 'Unencumbered liquid assets (cash, bank balances, liquid investments)', 'Balance sheet; DNBS04A'),
        ('lines', 'Undrawn committed bank lines available to the company', 'Treasury MIS'), ('undrawn', 'Undrawn sanctioned limits to customers', 'Sanction register'),
        ('eq', 'Equity and mutual fund investments (market value)', 'Investments note; DNBS01 Annex 10'), ('bond', 'Bond and debt investments (market value)', 'Investments note'), ('dur', 'Modified duration of bond investments (years)', 'Treasury MIS'),
        ('fx', 'Net open foreign currency position (unhedged)', 'Treasury MIS; DNBS01 Part 7'), ('ginc', 'Gross income – average of last 3 years', 'P&L (total income less interest expense is NOT deducted)'),
        ('grp', 'Exposure to group companies', 'DNBS01 Part 5; related party note')]
BC = {}
for j, (key, lab, src) in enumerate(base):
    r = 6 + j; BC[key] = "'In_Base'!$B$%d" % r
    b.lbl('A%d' % r, lab); b.inp('B%d' % r, 'base.' + key, lab, None, 'pct' if key in ('reprice', 'pd', 'lgd') else 'num', src)
SEG0 = 36
b.sec('A34', 'B. Loan book by segment (from the ECL model Handover segment table)', 7)
b.head(35, ['Segment', 'Gross loans', 'Stage 3', '12-month PD', 'LGD', 'Stressed sector? (Yes/No)', 'Share exposed to climate hazard'])
for i in range(N):
    r = SEG0 + i; k = i + 1
    b.inp('A%d' % r, 'seg.name.%d' % k, 'Segment %d name' % k, None, 'txt', 'ECL Handover segment table')
    for c, key, fmt in [('B', 'gross', 'num'), ('C', 's3', 'num'), ('D', 'pd', 'pct'), ('E', 'lgd', 'pct')]:
        b.inp('%s%d' % (c, r), 'seg.%s.%d' % (key, k), 'Segment %d %s' % (k, key), None, fmt, 'ECL Handover segment table')
    b.inp('F%d' % r, 'seg.stressed.%d' % k, 'Segment %d stressed sector' % k, 'No', 'txt', 'Risk view of the sector', YN)
    b.inp('G%d' % r, 'seg.climate.%d' % k, 'Segment %d climate-exposed share' % k, 0, 'pct', 'District-wise exposure mapped to flood / drought / cyclone zones')
SE = SEG0 + N - 1
TOP0 = 56
b.sec('A54', 'C. Twenty largest borrowers (any order)', 3); b.head(55, ['Borrower (name or code)', 'Exposure', 'Rank'])
for i in range(NT):
    r = TOP0 + i
    b.inp('A%d' % r, 'top.name.%d' % (i + 1), 'Top borrower %d' % (i + 1), None, 'txt', 'DNBS01 Annex 9 (top 25 borrowers); DNBS03 Part 7')
    b.inp('B%d' % r, 'top.exp.%d' % (i + 1), 'Top borrower %d exposure' % (i + 1), None, 'num', 'DNBS01 Annex 9 (top 25 borrowers); DNBS03 Part 7')
    b.f('C%d' % r, 'IF(B{0}="","",RANK(B{0},$B${1}:$B${2})+COUNTIF($B${1}:B{0},B{0})-1)'.format(r, TOP0, TOP0 + NT - 1), 'int')
TE = TOP0 + NT - 1
SEC0 = 80; STA0 = 94
b.sec('A78', 'D. Ten largest sectors / industries', 2); b.head(79, ['Sector', 'Exposure'])
b.sec('A92', 'E. Ten largest states / regions', 2); b.head(93, ['State / region', 'Exposure'])
for i in range(NS):
    b.inp('A%d' % (SEC0 + i), 'sector.name.%d' % (i + 1), 'Sector %d' % (i + 1), None, 'txt', 'DNBS01 Parts 9A-9B (sectoral / industry credit)'); b.inp('B%d' % (SEC0 + i), 'sector.exp.%d' % (i + 1), 'Sector %d exposure' % (i + 1), None, 'num', 'DNBS01 Parts 9A-9B')
    b.inp('A%d' % (STA0 + i), 'state.name.%d' % (i + 1), 'State %d' % (i + 1), None, 'txt', 'Branch-wise / state-wise AUM report'); b.inp('B%d' % (STA0 + i), 'state.exp.%d' % (i + 1), 'State %d exposure' % (i + 1), None, 'num', 'Branch-wise / state-wise AUM report')
ALM0 = 108
b.sec('A106', 'F. Structural liquidity and interest rate sensitivity by time bucket', 7)
b.head(107, ['Time bucket', 'Inflows: loan collections', 'Inflows: other', 'Outflows: borrowings and interest', 'Outflows: other', 'Rate-sensitive assets', 'Rate-sensitive liabilities'])
for i, bk in enumerate(BUCK):
    r = ALM0 + i; b.lbl('A%d' % r, bk)
    for c, key, src in [('B', 'in_coll', 'DNBS04B structural liquidity – inflows'), ('C', 'in_oth', 'DNBS04B structural liquidity – inflows'), ('D', 'out_borr', 'DNBS04B structural liquidity – outflows'),
                        ('E', 'out_oth', 'DNBS04B structural liquidity – outflows'), ('F', 'rsa', 'DNBS04B interest rate sensitivity – RSA'), ('G', 'rsl', 'DNBS04B interest rate sensitivity – RSL')]:
        b.inp('%s%d' % (c, r), 'alm.%s.%d' % (key, i + 1), '%s – %s' % ({'in_coll': 'Inflows from loan collections', 'in_oth': 'Other inflows', 'out_borr': 'Outflows on borrowings and interest', 'out_oth': 'Other outflows', 'rsa': 'Rate-sensitive assets', 'rsl': 'Rate-sensitive liabilities'}[key], bk), None, 'num', src)
AE = ALM0 + len(BUCK) - 1
BR = lambda c, r: "'In_Base'!%s%d" % (c, r)
BRG = lambda c, a, z: "'In_Base'!$%s$%d:$%s$%d" % (c, a, c, z)

# ------------------------------------------------------------------ Scenarios
sc = B.sheet('Scenarios', (58, 14, 14, 14, 62), tab='BF9000')
sc.title('Scenarios – hypothetical scenario stories and shock sizes', 'All shock sizes are inputs. The defaults are illustrative starting points, not regulatory prescriptions.')
sc.sec('A4', 'A. Scenario stories (edit for the company)', 5)
stories = [('Baseline', 'The business plan is achieved. GDP growth, inflation and interest rates follow the central forecast. Collections, funding lines and asset quality stay as budgeted.'),
           ('Adverse', 'A weak monsoon and a slowdown in MSME cash flows raise delinquencies. The policy rate rises by 200 basis points, two lenders do not renew their lines, one of the largest borrowers defaults and a mid-sized fraud is detected.'),
           ('Severe', 'A large default in the NBFC sector closes wholesale funding markets for three months. Rates rise by 300 basis points, collections fall sharply after a flood in the company\'s main state, the three largest borrowers default, the stressed sector collapses and a cyber attack interrupts operations for a week.')]
for j, (nm, txt) in enumerate(stories):
    sc.lbl('A%d' % (5 + j), nm, True); sc.inp('B%d' % (5 + j), 'story.%d' % (j + 1), nm + ' scenario story', txt, 'txt', 'Risk Management Committee')
    sc.ws.merge_cells('B%d:E%d' % (5 + j, 5 + j)); sc.ws.row_dimensions[5 + j].height = 48
sc.head(9, ['B. Shock sizes', 'Baseline', 'Adverse', 'Severe', 'Where it is used'])
PAR = [('c.pdm', 'Credit: PD multiplier on the performing book', (1.0, 1.5, 2.5), 'num', 'ST_Credit'), ('c.lgda', 'Credit: LGD add-on (percentage points)', (0, 0.04, 0.08), 'pct', 'ST_Credit, ST_Concentration, ST_Other'),
       ('c.slip', 'Credit: additional slippage of performing loans to Stage 3', (0, 0.01, 0.025), 'pct', 'ST_Credit'), ('c.sslip', 'Credit: extra slippage in segments marked as stressed sectors', (0, 0.02, 0.04), 'pct', 'ST_Credit'),
       ('c.inc', 'Credit: income lost on new NPAs (% of new NPA amount)', (0, 0.08, 0.08), 'pct', 'ST_Credit'),
       ('k.n', 'Concentration: number of largest borrowers that default', (0, 1, 3), 'int', 'ST_Concentration'), ('k.lgd', 'Concentration: LGD on defaulting large borrowers', (0.45, 0.45, 0.50), 'pct', 'ST_Concentration'),
       ('k.sec', 'Concentration: slippage in the largest sector', (0, 0.03, 0.06), 'pct', 'ST_Concentration'), ('k.sta', 'Concentration: slippage in the largest state', (0, 0.02, 0.04), 'pct', 'ST_Concentration'),
       ('i.bps', 'Interest rate: parallel rise in rates (basis points)', (0, 200, 300), 'int', 'ST_IRRBB'), ('i.pa', 'Interest rate: pass-through to assets', (1.0, 0.5, 0.25), 'pct', 'ST_IRRBB'),
       ('i.pl', 'Interest rate: pass-through to liabilities', (1.0, 1.0, 1.0), 'pct', 'ST_IRRBB'), ('i.eq', 'Market: fall in equity and mutual fund prices', (0, 0.15, 0.30), 'pct', 'ST_IRRBB'),
       ('i.yld', 'Market: rise in bond yields (basis points)', (0, 100, 200), 'int', 'ST_IRRBB'), ('i.fx', 'Market: adverse currency move', (0, 0.05, 0.10), 'pct', 'ST_IRRBB'),
       ('l.coll', 'Liquidity: shortfall in loan collections', (0, 0.15, 0.35), 'pct', 'ST_Liquidity'), ('l.draw', 'Liquidity: drawdown of customers\' undrawn limits', (0.05, 0.15, 0.30), 'pct', 'ST_Liquidity'),
       ('l.lines', 'Liquidity: share of undrawn bank lines withdrawn by lenders', (0, 0.5, 1.0), 'pct', 'ST_Liquidity'), ('l.hair', 'Liquidity: haircut on liquid assets', (0, 0.05, 0.15), 'pct', 'ST_Liquidity'),
       ('l.cost', 'Liquidity: rise in cost of borrowings repricing within a year (basis points)', (0, 100, 200), 'int', 'ST_Liquidity'),
       ('o.op', 'Operational: loss events (% of gross income)', (0.005, 0.02, 0.04), 'pct', 'ST_Other'), ('o.cyb', 'Cyber and IT: incident loss (% of gross income)', (0, 0.01, 0.03), 'pct', 'ST_Other'),
       ('o.comp', 'Compliance and legal: penalties and claims (% of operating profit)', (0, 0.02, 0.04), 'pct', 'ST_Other'), ('o.rep', 'Reputation: loss of business (% of net interest income)', (0, 0.04, 0.08), 'pct', 'ST_Other'),
       ('o.str', 'Strategic: shortfall in operating profit against plan', (0, 0.08, 0.15), 'pct', 'ST_Other'), ('o.opex', 'Strategic: overrun in operating expenses', (0, 0.03, 0.07), 'pct', 'ST_Other'),
       ('o.clim', 'Climate: slippage in the climate-exposed part of the book', (0, 0.02, 0.04), 'pct', 'ST_Other'), ('o.model', 'Model: understatement of ECL (% of ECL held)', (0, 0.10, 0.15), 'pct', 'ST_Other'),
       ('o.grp', 'Group: loss on exposure to group companies', (0, 0.10, 0.20), 'pct', 'ST_Other')]
PR = {}
for j, (key, lab, vals, fmt, use) in enumerate(PAR):
    r = 10 + j; PR[key] = r; sc.lbl('A%d' % r, lab)
    for c, nm, v in zip(SC, SCN, vals):
        sc.inp('%s%d' % (c, r), 'par.%s.%s' % (key, nm.lower()), '%s – %s' % (lab, nm), v, fmt, 'Stress testing policy; approved by the Risk Management Committee')
    sc.lbl('E%d' % r, use)
SP = lambda key, c: "'Scenarios'!$%s$%d" % (c, PR[key])

# ------------------------------------------------------------------ Credit
cr = B.sheet('ST_Credit', (28, 14, 14, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13), tab='2E75B6')
cr.title('ST_Credit – credit losses by segment under the three scenarios', 'No inputs.')
cr.head(6, ['Segment', 'Performing exposure', 'Stage 3 exposure', 'Loss – Baseline', 'Loss – Adverse', 'Loss – Severe', 'New NPA – Baseline', 'New NPA – Adverse', 'New NPA – Severe'])
for i in range(N):
    r = 7 + i; br = SEG0 + i
    cr.f('A%d' % r, 'IF(%s="","",%s)' % (BR('A', br), BR('A', br)), 'txt'); cr.f('B%d' % r, 'MAX(0,%s-%s)' % (BR('B', br), BR('C', br))); cr.f('C%d' % r, 'N(%s)' % BR('C', br))
    for c, nc, col in zip('DEF', 'GHI', SC):
        slip = '(%s+IF(%s="Yes",%s,0))' % (SP('c.slip', col), BR('F', br), SP('c.sslip', col))
        lg = 'MIN(1,N(%s)+%s)' % (BR('E', br), SP('c.lgda', col))
        cr.f('%s%d' % (nc, r), 'B%d*MIN(1,N(%s)*(%s-1)+%s)' % (r, BR('D', br), SP('c.pdm', col), slip))
        cr.f('%s%d' % (c, r), '%s%d*%s+C%d*%s' % (nc, r, lg, r, SP('c.lgda', col)))
cr.lbl('A22', 'Total', True)
for c in 'BCDEFGHI':
    cr.f('%s22' % c, 'SUM(%s7:%s21)' % (c, c), out=True)
cr.lbl('A24', 'Income lost on new NPAs')
for c, nc, col in zip('DEF', 'GHI', SC):
    cr.f('%s24' % c, '%s22*%s' % (nc, SP('c.inc', col)))
cr.lbl('A25', 'Total credit stress loss', True)
for c in 'DEF':
    cr.f('%s25' % c, '%s22+%s24' % (c, c), out=True)
cr.lbl('A26', 'Stressed gross Stage 3 %')
for c, nc in zip('DEF', 'GHI'):
    cr.f('%s26' % c, div('C22+%s22' % nc, 'B22+C22'), 'pct')

# ------------------------------------------------------------------ Concentration
kc = B.sheet('ST_Concentration', (46, 16, 16, 16), tab='2E75B6')
kc.title('ST_Concentration – large borrower, sector and state shocks', 'No inputs.')
kc.head(6, ['Item', 'Baseline', 'Adverse', 'Severe'])
rows = ['Exposure of the defaulting largest borrowers', 'Loss on largest borrowers', 'Largest sector exposure', 'Loss on sector shock', 'Largest state exposure', 'Loss on state shock', 'Total concentration stress loss', 'New NPA from concentration shocks']
for j, lab in enumerate(rows):
    kc.lbl('A%d' % (7 + j), lab, j == 6)
TB, TRK = BRG('B', TOP0, TE), BRG('C', TOP0, TE)
for c, col in zip('BCD', SC):
    kc.f('%s7' % c, 'SUMIF(%s,"<="&%s,%s)' % (TRK, SP('k.n', col), TB)); kc.f('%s8' % c, '%s7*%s' % (c, SP('k.lgd', col)))
    kc.f('%s9' % c, 'MAX(%s,0)' % BRG('B', SEC0, SEC0 + NS - 1)); kc.f('%s10' % c, '%s9*%s*MIN(1,N(%s)+%s)' % (c, SP('k.sec', col), BC['lgd'], SP('c.lgda', col)))
    kc.f('%s11' % c, 'MAX(%s,0)' % BRG('B', STA0, STA0 + NS - 1)); kc.f('%s12' % c, '%s11*%s*MIN(1,N(%s)+%s)' % (c, SP('k.sta', col), BC['lgd'], SP('c.lgda', col)))
    kc.f('%s13' % c, '%s8+%s10+%s12' % (c, c, c), out=True); kc.f('%s14' % c, '%s7+%s9*%s+%s11*%s' % (c, c, SP('k.sec', col), c, SP('k.sta', col)))
kc.sec('A17', 'Concentration measures (information)', 4)
for j, (lab, fm, fmt) in enumerate([('Largest borrower / Tier 1 capital', div('MAX(%s,0)' % TB, BC['t1']), 'pct'), ('Top 20 borrowers / gross loans', div('SUM(%s)' % TB, BC['gross']), 'pct'),
                                    ('HHI – top 20 borrowers (of gross loans)', div('SUMSQ(%s)' % TB, '(%s)^2' % BC['gross']), 'n4'),
                                    ('HHI – sectors', div('SUMSQ(%s)' % BRG('B', SEC0, SEC0 + NS - 1), '(SUM(%s))^2' % BRG('B', SEC0, SEC0 + NS - 1)), 'n4'),
                                    ('HHI – states', div('SUMSQ(%s)' % BRG('B', STA0, STA0 + NS - 1), '(SUM(%s))^2' % BRG('B', STA0, STA0 + NS - 1)), 'n4'),
                                    ('Largest sector / gross loans', div('MAX(%s,0)' % BRG('B', SEC0, SEC0 + NS - 1), BC['gross']), 'pct'), ('Largest state / gross loans', div('MAX(%s,0)' % BRG('B', STA0, STA0 + NS - 1), BC['gross']), 'pct')]):
    kc.lbl('A%d' % (18 + j), lab); kc.f('B%d' % (18 + j), fm, fmt, out=True)

# ------------------------------------------------------------------ IRRBB / market
ib = B.sheet('ST_IRRBB', (30, 15, 15, 15, 12, 15, 15, 15, 15, 15, 15), tab='2E75B6')
ib.title('ST_IRRBB – interest rate, investment and currency shocks', 'No inputs. Negative NII change = loss.')
ib.head(6, ['Time bucket', 'Rate-sensitive assets', 'Rate-sensitive liabilities', 'Gap', 'Mid-point (years)', 'NII change – Baseline', 'NII change – Adverse', 'NII change – Severe', 'EVE change – Baseline', 'EVE change – Adverse', 'EVE change – Severe'])
for i, bk in enumerate(BUCK):
    r = 7 + i; ar = ALM0 + i
    ib.lbl('A%d' % r, bk); ib.f('B%d' % r, 'N(%s)' % BR('F', ar)); ib.f('C%d' % r, 'N(%s)' % BR('G', ar)); ib.f('D%d' % r, 'B%d-C%d' % (r, r)); ib.f('E%d' % r, str(BMID[i]), 'num')
    for c, ec, col in zip('FGH', 'IJK', SC):
        ib.f('%s%d' % (c, r), ('(B{0}*{1}-C{0}*{2})*{3}/10000*(1-E{0})'.format(r, SP('i.pa', col), SP('i.pl', col), SP('i.bps', col))) if BMID[i] < 1 else '0')
        ib.f('%s%d' % (ec, r), '-D{0}*E{0}*{1}/10000'.format(r, SP('i.bps', col)))
ib.lbl('A17', 'Total', True)
for c in 'BCDFGHIJK':
    ib.f('%s17' % c, 'SUM(%s7:%s16)' % (c, c), out=True)
ib.head(20, ['Result', 'Baseline', 'Adverse', 'Severe'])
res = ['Earnings loss from the rate shock (12 months)', 'Fall in economic value of equity (EVE)', 'Fall in EVE / Tier 1 capital', 'EVE result', 'Loss on equity and mutual fund investments', 'Loss on bond investments', 'Loss on open currency position', 'Interest rate stress loss (P&L)', 'Market stress loss (P&L)']
for j, lab in enumerate(res):
    ib.lbl('A%d' % (21 + j), lab, j >= 7)
for c, nc, ec, col in zip('BCD', 'FGH', 'IJK', SC):
    ib.f('%s21' % c, 'MAX(0,-%s17)' % nc); ib.f('%s22' % c, 'MAX(0,-%s17)' % ec); ib.f('%s23' % c, div('%s22' % c, BC['t1']), 'pct')
    ib.f('%s24' % c, rag_hi_bad('%s23' % c, ST('$B$21'), ST('$C$21')), 'txt')
    ib.f('%s25' % c, 'N(%s)*%s' % (BC['eq'], SP('i.eq', col))); ib.f('%s26' % c, 'N(%s)*N(%s)*%s/10000' % (BC['bond'], BC['dur'], SP('i.yld', col))); ib.f('%s27' % c, 'ABS(N(%s))*%s' % (BC['fx'], SP('i.fx', col)))
    ib.f('%s28' % c, '%s21' % c, out=True); ib.f('%s29' % c, '%s25+%s26+%s27' % (c, c, c), out=True)
ib.rag('B24:D24')

# ------------------------------------------------------------------ Liquidity
lq = B.sheet('ST_Liquidity', (26, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13), tab='2E75B6')
lq.title('ST_Liquidity – stressed cash flows and survival horizon', 'No inputs. Cumulative position = opening liquidity + cumulative stressed inflows - cumulative stressed outflows.')
lq.head(6, ['Item', 'Baseline', 'Adverse', 'Severe'])
lq.lbl('A7', 'Opening liquidity after haircut and withdrawal of lines')
for c, col in zip('BCD', SC):
    lq.f('%s7' % c, 'N(%s)*(1-%s)+N(%s)*(1-%s)' % (BC['hqla'], SP('l.hair', col), BC['lines'], SP('l.lines', col)), out=True)
lq.head(10, ['Time bucket', 'End day', 'Inflows – Baseline', 'Outflows – Baseline', 'Cumulative – Baseline', 'Inflows – Adverse', 'Outflows – Adverse', 'Cumulative – Adverse', 'Inflows – Severe', 'Outflows – Severe', 'Cumulative – Severe', 'OK? Baseline', 'OK? Adverse', 'OK? Severe'])
for i, bk in enumerate(BUCK):
    r = 11 + i; ar = ALM0 + i
    lq.lbl('A%d' % r, bk); lq.f('B%d' % r, str(BEND[i]), 'int')
    for (ic, oc, cc, kc_), col, op in zip([('C', 'D', 'E', 'L'), ('F', 'G', 'H', 'M'), ('I', 'J', 'K', 'N')], SC, 'BCD'):
        lq.f('%s%d' % (ic, r), 'N(%s)*(1-%s)+N(%s)' % (BR('B', ar), SP('l.coll', col), BR('C', ar)))
        lq.f('%s%d' % (oc, r), 'N(%s)+N(%s)%s' % (BR('D', ar), BR('E', ar), ('+N(%s)*%s' % (BC['undrawn'], SP('l.draw', col))) if i == 2 else ''))
        lq.f('%s%d' % (cc, r), '%s+%s%d-%s%d' % (('$%s$7' % op) if i == 0 else '%s%d' % (cc, r - 1), ic, r, oc, r), out=True)
        lq.f('%s%d' % (kc_, r), 'IF(%s%d>=0,1,0)' % (cc, r), 'int')
lq.head(23, ['Result', 'Baseline', 'Adverse', 'Severe'])
for j, lab in enumerate(['Survival horizon (days)', 'Survival result', 'Lowest cumulative position', 'Funding gap to be arranged', 'Funding cost stress loss (P&L)']):
    lq.lbl('A%d' % (24 + j), lab, j in (0, 4))
for c, cc, kc_, col in zip('BCD', 'EHK', 'LMN', SC):
    # survival = end day of the last bucket before the first negative cumulative position
    lq.f('%s24' % c, 'IF(SUM(%s11:%s20)=10,%d,IF(%s11=0,0,INDEX($B$11:$B$20,MATCH(0,%s11:%s20,0)-1)))' % (kc_, kc_, BEND[-1], kc_, kc_, kc_), 'int', out=True)
    lq.f('%s25' % c, rag_lo_bad('%s24' % c, ST('$B$19'), ST('$C$19')), 'txt'); lq.f('%s26' % c, 'MIN(%s11:%s20)' % (cc, cc)); lq.f('%s27' % c, 'MAX(0,-%s26)' % c)
    lq.f('%s28' % c, 'N(%s)*N(%s)*%s/10000' % (BC['borr'], BC['reprice'], SP('l.cost', col)), out=True)
lq.rag('B25:D25')

# ------------------------------------------------------------------ Other risks
ot = B.sheet('ST_Other', (46, 16, 16, 16, 50), tab='2E75B6')
ot.title('ST_Other – operational, cyber, compliance, reputation, strategic, climate, model and group risks', 'No inputs.')
ot.head(6, ['Risk', 'Baseline', 'Adverse', 'Severe', 'Basis'])
clim = lambda col: 'SUMPRODUCT((%s-%s)*%s*(%s+%s))*%s' % (BRG('B', SEG0, SE), BRG('C', SEG0, SE), BRG('G', SEG0, SE), BRG('E', SEG0, SE), SP('c.lgda', col), SP('o.clim', col))
oth = [('Operational risk', lambda col: 'N(%s)*%s' % (BC['ginc'], SP('o.op', col)), 'Gross income x loss %'), ('Cyber and IT risk', lambda col: 'N(%s)*%s' % (BC['ginc'], SP('o.cyb', col)), 'Gross income x loss %'),
       ('Compliance and legal risk', lambda col: 'N(%s)*%s' % (BC['ppop'], SP('o.comp', col)), 'Operating profit x %'), ('Reputation risk', lambda col: 'N(%s)*%s' % (BC['nii'], SP('o.rep', col)), 'Net interest income x %'),
       ('Strategic and business risk', lambda col: 'N(%s)*%s+N(%s)*%s' % (BC['ppop'], SP('o.str', col), BC['opex'], SP('o.opex', col)), 'Operating profit shortfall + cost overrun'),
       ('Climate and ESG risk', clim, 'Climate-exposed performing loans x slippage x LGD'), ('Model risk', lambda col: 'N(%s)*%s' % (BC['ecl'], SP('o.model', col)), 'ECL held x understatement %'),
       ('Group and contagion risk', lambda col: 'N(%s)*%s' % (BC['grp'], SP('o.grp', col)), 'Group exposure x loss %')]
for j, (lab, fn, basis) in enumerate(oth):
    r = 7 + j; ot.lbl('A%d' % r, lab)
    for c, col in zip('BCD', SC):
        ot.f('%s%d' % (c, r), fn(col), out=True)
    ot.lbl('E%d' % r, basis)

# ------------------------------------------------------------------ Combined
cb = B.sheet('ST_Combined', (52, 16, 16, 16, 12), tab='00B050')
cb.title('ST_Combined – all risks together', 'No inputs. Losses of risks switched off on Setup are shown as zero.')
cb.head(6, ['A. Stress loss by risk', 'Baseline', 'Adverse', 'Severe', 'Active'])
SRC = [lambda c: q('ST_Credit', '%s25' % 'DEF'['BCD'.index(c)]), lambda c: q('ST_Concentration', '%s13' % c), lambda c: q('ST_IRRBB', '%s28' % c), lambda c: q('ST_IRRBB', '%s29' % c), lambda c: q('ST_Liquidity', '%s28' % c),
       lambda c: q('ST_Other', '%s7' % c), lambda c: q('ST_Other', '%s8' % c), lambda c: q('ST_Other', '%s9' % c), lambda c: q('ST_Other', '%s10' % c), lambda c: q('ST_Other', '%s11' % c), lambda c: q('ST_Other', '%s12' % c),
       lambda c: q('ST_Other', '%s13' % c), lambda c: q('ST_Other', '%s14' % c)]
for j, rk in enumerate(RISKS):
    r = 7 + j; cb.lbl('A%d' % r, rk); cb.f('E%d' % r, ST('B%d' % (26 + j)), 'txt')
    for c in 'BCD':
        cb.f('%s%d' % (c, r), '%s*%s' % (RACT(j), SRC[j](c)))
R = {}
lab2 = [('tot', 'Total stress loss (as combined on Setup)'), ('ppop', 'Pre-provision operating profit (budget)'), ('cc', 'Budgeted credit cost'), ('pbt', 'Stressed profit / (loss) before tax'), ('cap', 'Change in Tier 1 capital'),
        ('prov', 'Additional loan provisions'), ('t1', 'Post-stress Tier 1 capital'), ('t2', 'Post-stress Tier 2 capital (capped at Tier 1)'), ('rwa', 'Post-stress RWA'), ('crar', 'Post-stress CRAR'),
        ('crag', 'CRAR result'), ('t1r', 'Post-stress Tier 1 ratio'), ('t1g', 'Tier 1 result'), ('lev', 'Post-stress leverage'), ('levg', 'Leverage result'), ('lp', 'Stress loss / operating profit'), ('lpg', 'Loss absorption result'),
        ('need', 'Capital shortfall against minimum CRAR'), ('buf', 'Fall in capital ratio (percentage points)')]
cb.head(22, ['B. Capital after stress', 'Baseline', 'Adverse', 'Severe'])
for j, (k, lab) in enumerate(lab2):
    R[k] = 23 + j; cb.lbl('A%d' % R[k], lab, k in ('crar', 't1r'))
cb.lbl('A20', 'Pre-stress CRAR', True); cb.f('B20', div('%s+MIN(N(%s),%s)' % (BC['t1'], BC['t2'], BC['t1']), BC['rwa']), 'pct', out=True)
cb.lbl('C20', 'Pre-stress Tier 1', True); cb.f('D20', div(BC['t1'], BC['rwa']), 'pct', out=True)
for c in 'BCD':
    g = lambda k: '%s%d' % (c, R[k])
    cb.f(g('tot'), 'IF(%s="Simple sum",SUM(%s7:%s19),SQRT(SUMSQ(%s7:%s19)))' % (ST('$B$12'), c, c, c, c), out=True)
    cb.f(g('ppop'), 'N(%s)' % BC['ppop']); cb.f(g('cc'), 'N(%s)' % BC['ccost']); cb.f(g('pbt'), '%s-%s-%s' % (g('ppop'), g('cc'), g('tot')))
    cb.f(g('cap'), 'IF(%s<0,%s,IF(%s="Yes",%s*(1-%s),0))' % (g('pbt'), g('pbt'), ST('$B$14'), g('pbt'), ST('$B$11')))
    cb.f(g('prov'), '%s7+%s8+%s17+%s18' % (c, c, c, c)); cb.f(g('t1'), 'N(%s)+%s' % (BC['t1'], g('cap'))); cb.f(g('t2'), 'MAX(0,MIN(N(%s),%s))' % (BC['t2'], g('t1')))
    cb.f(g('rwa'), 'MAX(0,N(%s)-MIN(%s,MAX(0,-%s)))' % (BC['rwa'], g('prov'), g('cap'))); cb.f(g('crar'), div('%s+%s' % (g('t1'), g('t2')), g('rwa')), 'pct', out=True)
    cb.f(g('crag'), rag_lo_bad(g('crar'), ST('$B$17'), ST('$C$17')), 'txt'); cb.f(g('t1r'), div(g('t1'), g('rwa')), 'pct', out=True); cb.f(g('t1g'), rag_lo_bad(g('t1r'), ST('$B$18'), ST('$C$18')), 'txt')
    cb.f(g('lev'), div('N(%s)' % BC['osl'], 'MAX(0.0001,N(%s)+%s)' % (BC['of'], g('cap'))), 'x'); cb.f(g('levg'), rag_hi_bad(g('lev'), ST('$B$22'), ST('$C$22')), 'txt')
    cb.f(g('lp'), div(g('tot'), g('ppop')), 'pct'); cb.f(g('lpg'), rag_hi_bad(g('lp'), ST('$B$20'), ST('$C$20')), 'txt')
    cb.f(g('need'), 'MAX(0,%s*%s-%s-%s)' % (ST('$B$8'), g('rwa'), g('t1'), g('t2')), out=True); cb.f(g('buf'), '$B$20-%s' % g('crar'), 'pct')
cb.rag('B23:D%d' % (23 + len(lab2)))
CB = lambda k, c: q('ST_Combined', '%s%d' % (c, R[k]))

# ------------------------------------------------------------------ Reverse
rv = B.sheet('ST_Reverse', (62, 18, 50), tab='00B050')
rv.title('ST_Reverse – reverse stress test: what would break the minimum CRAR?', 'No inputs.')
rv.head(6, ['Measure', 'Value', 'Meaning'])
CAP = '(N(%s)+MIN(N(%s),N(%s)))' % (BC['t1'], BC['t2'], BC['t1'])
rvr = [('Capital funds (Tier 1 + eligible Tier 2)', CAP, 'num', ''), ('Risk-weighted assets', 'N(%s)' % BC['rwa'], 'num', ''),
       ('Loss that brings CRAR to the minimum', 'MAX(0,(B7-%s*B8)/(1-%s))' % (ST('$B$8'), ST('$B$8')), 'num', 'L = (Capital - minimum x RWA) / (1 - minimum)'),
       ('Loss that brings Tier 1 to its minimum', 'MAX(0,(N(%s)-%s*B8)/(1-%s))' % (BC['t1'], ST('$B$9'), ST('$B$9')), 'num', 'Same formula with Tier 1'),
       ('Binding loss (lower of the two)', 'MIN(B9,B10)', 'num', 'The constraint that breaks first'),
       ('Binding loss after using one year of operating profit net of budgeted credit cost', 'B11+MAX(0,N(%s)-N(%s))' % (BC['ppop'], BC['ccost']), 'num', 'Loss the company can take before a breach'),
       ('As a multiple of annual operating profit', div('B12', BC['ppop']), 'x', ''),
       ('As slippage of the performing book (at severe LGD)', div('B12', '(N(%s)-N(%s))*MIN(1,N(%s)+%s)' % (BC['gross'], BC['s3'], BC['lgd'], SP('c.lgda', 'D'))), 'pct', 'Share of performing loans that would have to default'),
       ('Implied gross Stage 3 % at that point', div('N(%s)+B14*(N(%s)-N(%s))' % (BC['s3'], BC['gross'], BC['s3']), BC['gross']), 'pct', ''),
       ('As a multiple of the severe-scenario loss', div('B12', CB('tot', 'D')), 'x', 'Above 1 = severe scenario does not break the minimum'),
       ('Number of the largest borrowers whose default would cause it', 'IF(SUM(%s)=0,"n/a",IF(SUM(%s)*%s<B12,"more than 20",1+COUNTIF(%s,"<"&B12)))' % (TB, TB, SP('k.lgd', 'D'), q('ST_Reverse', '$F$7:$F$26')), 'int', 'Using the severe LGD on large borrowers')]
for j, (lab, fm, fmt, why) in enumerate(rvr):
    r = 7 + j; rv.lbl('A%d' % r, lab, j in (4, 5)); rv.f('B%d' % r, fm, fmt, out=True); rv.lbl('C%d' % r, why)
rv.ws.column_dimensions['E'].width = 8; rv.ws.column_dimensions['F'].width = 18
rv.lbl('E6', 'n', True); rv.lbl('F6', 'Cumulative loss of top n', True)
for n in range(1, NT + 1):
    rv.lbl('E%d' % (6 + n), n); rv.f('F%d' % (6 + n), 'SUMIF(%s,"<=%d",%s)*%s' % (TRK, n, TB, SP('k.lgd', 'D')))

# ------------------------------------------------------------------ Sensitivity
se = B.sheet('Sensitivity', (26, 16, 16, 16, 12), tab='00B050')
se.title('Sensitivity – CRAR against multiples of the PD (credit risk alone)', 'No inputs. Losses are first met from the year\'s operating profit; only the excess reduces capital.')
se.head(6, ['PD multiple', 'Additional credit loss', 'Post-stress CRAR', 'Post-stress Tier 1', 'Result'])
for j, mult in enumerate([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]):
    r = 7 + j; se.f('A%d' % r, str(mult), 'x')
    se.f('B%d' % r, '(N(%s)-N(%s))*MIN(1,N(%s)*(A%d-1))*N(%s)' % (BC['gross'], BC['s3'], BC['pd'], r, BC['lgd']))
    loss = 'MAX(0,B%d-MAX(0,N(%s)-N(%s)))' % (r, BC['ppop'], BC['ccost'])
    se.f('C%d' % r, div('N(%s)-%s+MIN(N(%s),N(%s)-%s)' % (BC['t1'], loss, BC['t2'], BC['t1'], loss), 'MAX(0.0001,N(%s)-MIN(B%d,%s))' % (BC['rwa'], r, loss)), 'pct', out=True)
    se.f('D%d' % r, div('N(%s)-%s' % (BC['t1'], loss), 'MAX(0.0001,N(%s)-MIN(B%d,%s))' % (BC['rwa'], r, loss)), 'pct'); se.f('E%d' % r, rag_lo_bad('C%d' % r, ST('$B$17'), ST('$C$17')), 'txt')
se.rag('E7:E16')

# ------------------------------------------------------------------ Management actions
ma = B.sheet('Mgmt_Actions', (6, 52, 16, 16, 16, 20, 24), tab='548235')
ma.title('Mgmt_Actions – management actions under the Severe scenario', 'List the actions the company would take, with their effect on capital, RWA and liquidity, the time needed and the owner.')
ma.head(6, ['#', 'Action', 'Capital raised / preserved', 'Reduction in RWA', 'Liquidity raised', 'Time needed', 'Owner'])
acts = ['Equity infusion by promoters / investors', 'Suspend dividend', 'Slow disbursements in higher-risk segments', 'Sell down or assign loan pools', 'Raise Tier 2 (subordinated debt)', 'Draw contingency funding lines', 'Cut discretionary costs', 'Other']
for j, a in enumerate(acts):
    r = 7 + j; ma.lbl('A%d' % r, j + 1); ma.inp('B%d' % r, 'act.name.%d' % (j + 1), 'Action %d' % (j + 1), a, 'txt', 'Capital contingency plan / contingency funding plan')
    for c, key in zip('CDE', ('cap', 'rwa', 'liq')):
        ma.inp('%s%d' % (c, r), 'act.%s.%d' % (key, j + 1), 'Action %d %s effect' % (j + 1, key), None, 'num', 'Capital contingency plan / contingency funding plan')
    ma.inp('F%d' % r, 'act.time.%d' % (j + 1), 'Action %d time' % (j + 1), None, 'txt'); ma.inp('G%d' % r, 'act.owner.%d' % (j + 1), 'Action %d owner' % (j + 1), None, 'txt')
ma.lbl('B15', 'Total', True)
for c in 'CDE':
    ma.f('%s15' % c, 'SUM(%s7:%s14)' % (c, c), out=True)
ma.lbl('B17', 'Severe scenario – CRAR before actions'); ma.f('C17', CB('crar', 'D'), 'pct', out=True)
ma.lbl('B18', 'Severe scenario – CRAR after actions', True); ma.f('C18', div('%s+%s+C15' % (CB('t1', 'D'), CB('t2', 'D')), 'MAX(0.0001,%s-D15)' % CB('rwa', 'D')), 'pct', out=True)
ma.f('D18', rag_lo_bad('C18', ST('$B$17'), ST('$C$17')), 'txt')
ma.lbl('B19', 'Severe scenario – funding gap after actions'); ma.f('C19', 'MAX(0,%s-E15)' % q('ST_Liquidity', 'D27'), out=True); ma.f('D19', 'IF(%s,"",IF(C19>0,"RED","GREEN"))' % GUARD[0], 'txt'); ma.rag('D18:D19')

# ------------------------------------------------------------------ Dashboard
db = B.sheet('Dashboard', (46, 16, 16, 16), tab='00B050')
db.title('Dashboard – stress test results', 'RAG against the thresholds on Setup.')
db.f('A3', '"Company: "&%s&"   |   As at: "&TEXT(%s,"DD-MMM-YYYY")&"   |   Amounts in "&%s' % (ST('B4'), ST('B5'), ST('B6')), 'txt')
db.head(5, ['Result', 'Baseline', 'Adverse', 'Severe'])
dr = [('Total stress loss', 'tot', 'num'), ('Post-stress CRAR', 'crar', 'pct'), ('CRAR result', 'crag', 'txt'), ('Post-stress Tier 1 ratio', 't1r', 'pct'), ('Tier 1 result', 't1g', 'txt'), ('Post-stress leverage', 'lev', 'x'),
      ('Leverage result', 'levg', 'txt'), ('Stress loss / operating profit', 'lp', 'pct'), ('Loss absorption result', 'lpg', 'txt'), ('Capital shortfall against minimum CRAR', 'need', 'num')]
for j, (lab, k, fmt) in enumerate(dr):
    r = 6 + j; db.lbl('A%d' % r, lab)
    for c in 'BCD':
        db.f('%s%d' % (c, r), CB(k, c), fmt, out=fmt != 'txt')
ex = [('Liquidity survival horizon (days)', lambda c: q('ST_Liquidity', '%s24' % c), 'int'), ('Liquidity result', lambda c: q('ST_Liquidity', '%s25' % c), 'txt'), ('Funding gap to be arranged', lambda c: q('ST_Liquidity', '%s27' % c), 'num'),
      ('Fall in EVE / Tier 1', lambda c: q('ST_IRRBB', '%s23' % c), 'pct'), ('EVE result', lambda c: q('ST_IRRBB', '%s24' % c), 'txt'), ('Stressed gross Stage 3 %', lambda c: q('ST_Credit', '%s26' % 'DEF'['BCD'.index(c)]), 'pct')]
for j, (lab, fn, fmt) in enumerate(ex):
    r = 16 + j; db.lbl('A%d' % r, lab)
    for c in 'BCD':
        db.f('%s%d' % (c, r), fn(c), fmt, out=fmt != 'txt')
db.rag('B6:D21')
db.head(24, ['Stress loss by risk', 'Baseline', 'Adverse', 'Severe'])
for j, rk in enumerate(RISKS):
    r = 25 + j; db.lbl('A%d' % r, rk)
    for c in 'BCD':
        db.f('%s%d' % (c, r), q('ST_Combined', '%s%d' % (c, 7 + j)))
db.lbl('A39', 'Reverse stress: loss that breaks the minimum', True); db.f('B39', q('ST_Reverse', 'B12'), out=True)
db.lbl('A40', 'CRAR after management actions (Severe)', True); db.f('B40', q('Mgmt_Actions', 'C18'), 'pct', out=True); db.f('C40', q('Mgmt_Actions', 'D18'), 'txt'); db.rag('C40')
db.lbl('A41', 'Open items on the Checks sheet', True); db.f('B41', 'COUNTIF(%s,"CHECK")' % q('Checks', 'C6:C16'), 'int'); db.f('C41', 'IF(B41=0,"OK","CHECK")', 'txt'); db.rag('C41')

# ------------------------------------------------------------------ Handover
ho = B.sheet('Handover', (6, 58, 18, 30), tab='7030A0')
ho.title('Handover – figures for the ICAAP model', 'Planning scenario = the one selected on Setup. Copy column C into the ICAAP model hand-over inputs (the data-fill script does this by key).')
ho.head(5, ['#', 'Item', 'Value', 'Key'])
PL = lambda k: 'IF(%s="Adverse",%s,%s)' % (ST('$B$13'), CB(k, 'C'), CB(k, 'D'))
hov = [('Planning scenario', ST('$B$13'), 'st.scenario', 'txt'), ('Pre-stress CRAR', q('ST_Combined', 'B20'), 'st.crar_pre', 'pct'), ('Post-stress CRAR – Baseline', CB('crar', 'B'), 'st.crar_base', 'pct'),
       ('Post-stress CRAR – Adverse', CB('crar', 'C'), 'st.crar_adv', 'pct'), ('Post-stress CRAR – Severe', CB('crar', 'D'), 'st.crar_sev', 'pct'), ('Total stress loss – planning scenario', PL('tot'), 'st.loss', 'num'),
       ('Fall in capital – planning scenario (stress capital buffer)', 'MAX(0,-(%s))' % PL('cap'), 'st.buffer', 'num'), ('Capital shortfall against minimum – planning scenario', PL('need'), 'st.shortfall', 'num'),
       ('Post-stress Tier 1 ratio – planning scenario', PL('t1r'), 'st.t1', 'pct'), ('Liquidity survival horizon – Severe (days)', q('ST_Liquidity', 'D24'), 'st.survival', 'int'),
       ('Fall in EVE – Adverse', q('ST_IRRBB', 'C22'), 'st.eve', 'num'), ('Earnings loss from rate shock – Adverse', q('ST_IRRBB', 'C21'), 'st.nii', 'num'),
       ('Reverse stress: loss that breaks the minimum', q('ST_Reverse', 'B12'), 'st.reverse', 'num'), ('CRAR after management actions – Severe', q('Mgmt_Actions', 'C18'), 'st.crar_actions', 'pct')]
for j, (lab, fm, key, fmt) in enumerate(hov):
    r = 6 + j; ho.lbl('A%d' % r, j + 1); ho.lbl('B%d' % r, lab); ho.f('C%d' % r, fm, fmt, out=True); ho.lbl('D%d' % r, key)
ho.head(22, ['#', 'Stress loss by risk – planning scenario', 'Value', 'Key'])
for j, rk in enumerate(RISKS):
    r = 23 + j; ho.lbl('A%d' % r, j + 1); ho.lbl('B%d' % r, rk); ho.f('C%d' % r, 'IF(%s="Adverse",%s,%s)' % (ST('$B$13'), q('ST_Combined', 'C%d' % (7 + j)), q('ST_Combined', 'D%d' % (7 + j))), out=True); ho.lbl('D%d' % r, 'st.risk.%d' % (j + 1))

# ------------------------------------------------------------------ Checks
ck = B.sheet('Checks', (6, 72, 12, 50), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results')
ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
chk = [('Tier 1 capital and RWA are entered', 'AND(N(%s)>0,N(%s)>0)' % (BC['t1'], BC['rwa']), 'Complete In_Base section A'),
       ('Segment gross loans add up to gross loans (within 1%)', 'ABS(SUM(%s)-N(%s))<=0.01*MAX(1,N(%s))' % (BRG('B', SEG0, SE), BC['gross'], BC['gross']), 'Reconcile the segment table with the ECL Handover'),
       ('Stage 3 by segment adds up to total Stage 3 (within 1%)', 'ABS(SUM(%s)-N(%s))<=0.01*MAX(1,N(%s))' % (BRG('C', SEG0, SE), BC['s3'], BC['s3']), 'Reconcile with the ECL Handover'),
       ('Top-20 borrower exposures are entered', 'COUNT(%s)>0' % TB, 'Enter the largest borrowers (DNBS01 Annex 9)'),
       ('Top-20 borrowers do not exceed gross loans', 'SUM(%s)<=N(%s)+0.005' % (TB, BC['gross']), 'Check units and amounts'),
       ('Liquidity buckets are entered', 'SUM(%s)+SUM(%s)>0' % (BRG('B', ALM0, AE), BRG('D', ALM0, AE)), 'Enter the structural liquidity statement (DNBS04B)'),
       ('Repricing buckets are entered', 'SUM(%s)+SUM(%s)>0' % (BRG('F', ALM0, AE), BRG('G', ALM0, AE)), 'Enter the interest rate sensitivity statement (DNBS04B)'),
       ('Severe shocks are at least as large as Adverse for PD and slippage', 'AND(%s>=%s,%s>=%s)' % (SP('c.pdm', 'D'), SP('c.pdm', 'C'), SP('c.slip', 'D'), SP('c.slip', 'C')), 'Review the Scenarios sheet'),
       ('Operating profit budget is entered', 'N(%s)<>0' % BC['ppop'], 'Enter the budget in In_Base'),
       ('Outside liabilities and owned fund are entered', 'AND(N(%s)>0,N(%s)>0)' % (BC['osl'], BC['of']), 'Needed for leverage'),
       ('A management action is recorded where the Severe CRAR is red', 'OR(%s<>"RED",%s>0)' % (CB('crag', 'D'), q('Mgmt_Actions', 'C15')), 'Record actions on Mgmt_Actions')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C16')

source_map(B)
order = ['ReadMe', 'Method Notes', 'Setup', 'In_Base', 'Scenarios', 'ST_Credit', 'ST_Concentration', 'ST_IRRBB', 'ST_Liquidity', 'ST_Other', 'ST_Combined', 'ST_Reverse', 'Sensitivity', 'Mgmt_Actions', 'Dashboard', 'Handover', 'Checks', 'Source Map']
B.wb._sheets = [B.wb[n] for n in order]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('Stress model built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
