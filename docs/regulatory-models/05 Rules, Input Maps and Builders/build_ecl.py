"""ECL Master Model (Ind AS 109 expected credit loss with the RBI prudential floor). Run: python3 build_ecl.py <out.xlsx> <map.json>"""
import sys
from xl import *

N = 15; R0 = 8; RT = R0 + N            # segment rows 8..22, total row 23
SR = lambda r: r + 32                   # row of the same segment on Setup (40..54)
SEG = range(R0, RT)
B = Book('ECL-M01', 'ECL Master Model')
SRC_BS = 'Audited financial statements – loans note / ECL note'
SRC_MIS = 'Loan management system (LMS) / MIS'
YN = ['Yes', 'No']

readme(B, 'Expected Credit Loss (ECL) Master Model',
       ['This workbook computes the expected credit loss allowance on the loan portfolio under Ind AS 109 for up to 15 portfolio segments, compares it with the RBI prudential floor (IRACP provisioning) and works out the Impairment Reserve, and produces the figures that the Stress Testing and ICAAP models need.',
        'ECL = Exposure at Default (EAD) x Probability of Default (PD) x Loss Given Default (LGD), computed for three stages and three macro-economic scenarios, and then probability-weighted.'],
       ['Setup: enter the company, reporting date, units, and name the portfolio segments (products). Choose the PD and LGD method for each segment. Review the thresholds.',
        'In_Portfolio (or In_LoanTape): enter the outstanding loans by days-past-due bucket for each segment, the undrawn limits, restructured loans and loans moved to Stage 2 on judgement.',
        'In_History and/or In_Defaults: enter the past data for the PD method chosen for each segment (monthly bucket balances for the roll-rate method; yearly defaults for the default-history method).',
        'In_LGD: enter recovery experience and/or collateral data for the LGD method chosen.',
        'In_Macro: enter the scenario narrative and the scenario multipliers (or Vasicek factors).',
        'Read PD, LGD, EAD and ECL_Calc; record any management overlay on the Overlay sheet with reasons.',
        'IRACP_Floor: enter the NPA ageing; the sheet compares Ind AS impairment with the prudential floor and shows the Impairment Reserve needed.',
        'Movement, Sensitivity, Backtest, Disclosures and Dashboard build themselves. Clear every item on the Checks sheet.',
        'Copy the Handover sheet figures into the Stress Testing and ICAAP models (the data-fill script does this automatically).'],
       [('Method Notes', 'explains every formula and how the results are produced'), ('Setup', 'company details, segments, methods, thresholds'),
        ('In_Portfolio / In_LoanTape', 'exposure by DPD bucket (summary or loan-level)'), ('In_History', 'monthly bucket balances for roll rates'),
        ('In_Defaults', 'yearly default history'), ('In_LGD', 'recoveries and collateral'), ('In_Macro', 'scenarios'),
        ('PD / LGD / EAD', 'the three risk parameters by segment'), ('ECL_Calc', 'ECL by stage and scenario'), ('Overlay', 'management overlay and final ECL'),
        ('IRACP_Floor', 'prudential floor and Impairment Reserve'), ('Movement', 'reconciliation of the loss allowance'), ('Sensitivity', 'what-if results'),
        ('Backtest', 'predicted against actual defaults'), ('Disclosures', 'tables for the notes to accounts'), ('Dashboard', 'key ratios with RAG'),
        ('Handover', 'figures for the Stress Testing and ICAAP models'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

# ------------------------------------------------------------------ Method notes
m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how this model produces its results')
m.text_block(4, [
 '# 1. Overall logic',
 'The loan book is split into segments (Setup). For each segment the model (a) places the exposure into Stage 1, 2 or 3 (EAD sheet), (b) estimates the probability of default (PD sheet), (c) estimates the loss given default (LGD sheet), (d) multiplies them for three scenarios and weights the scenarios (ECL_Calc), (e) adds any management overlay (Overlay), and (f) compares the result with the RBI prudential floor (IRACP_Floor).',
 '# 2. Staging (EAD sheet)',
 'Stage 3 = all exposure more than 90 days past due (buckets 91-180, 181-365 and above 365). Stage 2 = 31-90 days past due (or 1-90 if "Stage 2 starts at" on Setup is set to "1+ DPD"), plus restructured standard loans and loans moved on judgement (significant increase in credit risk). In the loan tape, a restructured or judgement flag is counted only for loans that would otherwise be in Stage 1, so no loan is counted twice. Stage 1 = the rest. Formula: Stage 1 = Current (+ 1-30) - transfers; Stage 2 = (1-30) + 31-60 + 61-90 + transfers; Stage 3 = sum of the 91+ buckets.',
 'Off-balance sheet EAD = undrawn sanctioned limits x credit conversion factor (CCF) of the segment; it is treated as Stage 1.',
 '# 3. Probability of default (PD sheet) – three methods, chosen per segment on Setup',
 'Roll rate (In_History): for each pair of adjacent buckets the flow rate = sum of next-month balances in the worse bucket / sum of this-month balances in the better bucket, over the months entered. Monthly PD of a current loan = product of the four flow rates (Current to 1-30, 1-30 to 31-60, 31-60 to 61-90, 61-90 to 91+). 12-month PD = 1 - (1 - monthly PD)^12.',
 'Default history (In_Defaults): observed default rate of each year = amount defaulted within 12 months / performing exposure at the start of the year; the PD is the exposure-weighted average over the years entered.',
 'Manual: the PD typed on Setup (for example an external rating agency default rate or a proxy from a peer portfolio where the company has too little history).',
 'The selected PD is floored at the PD floor on Setup. It is a through-the-cycle PD.',
 '# 4. Forward-looking scenarios (In_Macro, PD sheet)',
 'Multiplier method: scenario PD = selected PD x scenario multiplier (base, upside, downside).',
 'Vasicek method: scenario PD = NORMSDIST( (NORMSINV(PD) - SQRT(rho) x Z) / SQRT(1 - rho) ), where rho is the asset correlation of the segment (Setup) and Z is the scenario factor (0 = normal year, negative = downturn). This is the single-factor model that underlies the Basel IRB formula.',
 'Lifetime PD for Stage 2 (per scenario) = the higher of (i) the roll-rate probability that the delinquent buckets reach default and (ii) 1 - (1 - 12-month PD x Stage 2 multiplier)^residual tenor in years, capped at 100%. Stage 3 PD is 100%.',
 '# 5. Loss given default (LGD sheet) – three methods',
 'Workout: LGD = 1 - (recoveries - recovery costs) discounted at the effective interest rate for the average time to recover / exposure at default of the defaulted cases in the sample.',
 'Collateral: LGD = 1 - collateral value x (1 - haircut) x (1 - selling cost) discounted for the time to realise / exposure covered, not below zero.',
 'Manual: LGD typed on Setup. The selected LGD is floored at the LGD floor; scenario LGD = LGD x scenario LGD multiplier; Stage 3 LGD = LGD + Stage 3 uplift.',
 '# 6. ECL (ECL_Calc)',
 'Stage 1 ECL = (Stage 1 exposure + off-balance EAD) x 12-month scenario PD x scenario LGD. Stage 2 ECL = Stage 2 exposure x lifetime scenario PD x scenario LGD x discount factor. Stage 3 ECL = Stage 3 exposure x Stage 3 scenario LGD. Discount factor = 1 / (1 + EIR)^(residual tenor / 2) when discounting is switched on. Final ECL = base x weight + upside x weight + downside x weight.',
 '# 7. Prudential floor (IRACP_Floor)',
 'Provision under the RBI norms = standard assets x standard asset rate + sub-standard x 10% + doubtful (secured portion by age 20% / 30% / 50%, unsecured portion 100%) + loss assets x 100%. Rates are inputs on Setup and must be checked against the Directions for the company\'s layer. Where Ind AS impairment is lower than this floor, the difference is appropriated from profit after tax to the Impairment Reserve, which does not count as regulatory capital.',
 '# 8. Other sheets',
 'Movement: the unexplained change between opening allowance, the movements entered and the closing allowance is shown as remeasurement. Sensitivity: PD and LGD shocks are applied proportionately to the weighted results. Backtest: actual default rate / PD predicted a year earlier; above the amber or red ratio on Setup the PD needs re-calibration. Dashboard RAG: each ratio is compared with the amber and red thresholds on Setup.',
 '# 9. Limits of the model',
 'It is a portfolio (collective) model. Large individually assessed exposures should be provided for case by case and entered through the Overlay sheet. Results are only as good as the history entered; where a segment has less than 12 months of history use the Manual method with a documented proxy.'])

# ------------------------------------------------------------------ Setup
s = B.sheet('Setup', (34, 18, 14, 14, 16, 14, 10, 10, 10, 10, 12, 12, 12), tab='C00000')
s.title('Setup – company, methods and thresholds', 'Fill this sheet first. Yellow cells are inputs.')
rows = [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None), (5, 'Reporting date', 'setup.date', None, 'date', None),
        (6, 'Amounts are in', 'setup.units', '₹ crore', 'txt', ['₹ crore', '₹ lakh', '₹']), (7, 'Accounting basis', 'setup.basis', 'Ind AS', 'txt', ['Ind AS', 'IGAAP (IRACP only)']),
        (8, 'Regulatory layer', 'setup.layer', 'Middle Layer', 'txt', ['Base Layer', 'Middle Layer', 'Upper Layer']), (9, 'Portfolio data source', 'setup.source', 'Summary', 'txt', ['Summary', 'Loan tape']),
        (10, 'Stage 2 starts at', 'setup.s2start', '31+ DPD', 'txt', ['31+ DPD', '1+ DPD']),
        (12, 'Scenario weight – base', 'setup.w_base', 0.6, 'pct', None), (13, 'Scenario weight – upside', 'setup.w_up', 0.1, 'pct', None), (14, 'Scenario weight – downside', 'setup.w_down', 0.3, 'pct', None),
        (15, 'Macro adjustment method', 'setup.macro', 'Multiplier', 'txt', ['Multiplier', 'Vasicek']), (16, 'Discount lifetime losses', 'setup.discount', 'Yes', 'txt', YN),
        (17, 'Stage 3 LGD uplift (percentage points)', 'setup.s3uplift', 0.05, 'pct', None), (18, 'Stage 2 PD multiplier (non-roll-rate methods)', 'setup.s2mult', 3, 'num', None),
        (19, 'PD floor', 'setup.pdfloor', 0.0003, 'p4', None), (20, 'LGD floor', 'setup.lgdfloor', 0.10, 'pct', None)]
s.sec('A3', 'A. General', 3)
for r, lab, key, d, fmt, lst in rows:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, d, fmt, 'Company decision / policy', lst)
s.sec('A22', 'B. RAG thresholds', 3); s.head(22, ['B. RAG thresholds', 'Amber from', 'Red from'])
for r, lab, key, a, rd in [(23, 'Gross Stage 3 %', 'thr.gs3', 0.03, 0.05), (24, 'Net Stage 3 %', 'thr.ns3', 0.015, 0.03), (25, 'Stage 2 share of exposure', 'thr.s2', 0.05, 0.10),
                           (26, 'Stage 3 coverage (lower is worse): amber below / red below', 'thr.pcr', 0.50, 0.35), (27, 'Backtest ratio (actual / predicted)', 'thr.bt', 1.2, 1.5)]:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key + '.amber', lab + ' – amber', a, 'pct' if r < 27 else 'num', 'Risk appetite statement'); s.inp('C%d' % r, key + '.red', lab + ' – red', rd, 'pct' if r < 27 else 'num', 'Risk appetite statement')
s.sec('A29', 'C. RBI provisioning rates for NPAs (check against the IRACP Directions for the layer)', 3)
for r, lab, key, d in [(30, 'Sub-standard assets', 'iracp.ss', 0.10), (31, 'Doubtful – secured portion, up to 1 year', 'iracp.d1', 0.20), (32, 'Doubtful – secured portion, 1 to 3 years', 'iracp.d2', 0.30),
                       (33, 'Doubtful – secured portion, more than 3 years', 'iracp.d3', 0.50), (34, 'Doubtful – unsecured portion', 'iracp.du', 1.0), (35, 'Loss assets', 'iracp.loss', 1.0)]:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, d, 'pct', 'RBI IRACP Directions, provisioning norms')
s.sec('A38', 'D. Portfolio segments (up to 15). Set "Active" to No for rows not used.', 13)
s.head(39, ['Segment name', 'Active', 'Secured / Unsecured', 'PD method', 'LGD method', 'EIR', 'Residual tenor (years)', 'CCF on undrawn', 'Asset correlation (rho)', 'Manual 12-month PD', 'Manual LGD', 'Standard asset provision rate'], col=2)
s.lbl('A39', '#', True)
for i in range(N):
    r = 40 + i; k = i + 1
    s.lbl('A%d' % r, k)
    s.inp('B%d' % r, 'seg.name.%d' % k, 'Segment %d name' % k, 'Segment %d' % k, 'txt', 'Product list of the company')
    s.inp('C%d' % r, 'seg.active.%d' % k, 'Segment %d active' % k, 'No', 'txt', 'Company decision', YN)
    s.inp('D%d' % r, 'seg.sec.%d' % k, 'Segment %d security' % k, 'Secured', 'txt', 'Product terms', ['Secured', 'Unsecured'])
    s.inp('E%d' % r, 'seg.pdm.%d' % k, 'Segment %d PD method' % k, 'Manual', 'txt', 'ECL policy', ['Roll rate', 'Default history', 'Manual'])
    s.inp('F%d' % r, 'seg.lgdm.%d' % k, 'Segment %d LGD method' % k, 'Manual', 'txt', 'ECL policy', ['Workout', 'Collateral', 'Manual'])
    s.inp('G%d' % r, 'seg.eir.%d' % k, 'Segment %d effective interest rate' % k, 0.18, 'pct', SRC_MIS)
    s.inp('H%d' % r, 'seg.tenor.%d' % k, 'Segment %d residual tenor' % k, 2, 'num', SRC_MIS)
    s.inp('I%d' % r, 'seg.ccf.%d' % k, 'Segment %d CCF' % k, 0.5, 'pct', 'ECL policy / Capital Adequacy Directions')
    s.inp('J%d' % r, 'seg.rho.%d' % k, 'Segment %d asset correlation' % k, 0.12, 'pct', 'Basel IRB range 3%-24%')
    s.inp('K%d' % r, 'seg.mpd.%d' % k, 'Segment %d manual PD' % k, 0.02, 'pct', 'External benchmark / proxy')
    s.inp('L%d' % r, 'seg.mlgd.%d' % k, 'Segment %d manual LGD' % k, 0.45, 'pct', 'External benchmark / proxy')
    s.inp('M%d' % r, 'seg.std.%d' % k, 'Segment %d standard asset rate' % k, 0.004, 'pct', 'RBI IRACP Directions (0.25% BL; 0.40% ML; category-wise UL)')
ST = lambda c: q('Setup', c)
ACT = lambda r: '(%s="Yes")' % ST('$C%d' % SR(r))

# ------------------------------------------------------------------ Loan tape
TROWS = 3000
t = B.sheet('In_LoanTape', (16, 26, 16, 10, 14, 14, 12), tab='BF9000')
t.title('In_LoanTape – optional loan-level data (used only when Setup > Portfolio data source = "Loan tape")', 'One row per loan, up to %d loans. Segment must match a segment name on Setup exactly.' % TROWS)
t.head(5, ['Loan ID', 'Segment name', 'Outstanding', 'Days past due', 'Undrawn limit', 'Restructured standard (Y/N)', 'SICR override (Y/N)'])
for r in range(6, 6 + TROWS):
    for c in 'ABCDEFG':
        cell = t.ws['%s%d' % (c, r)]; cell.fill = YEL; cell.protection = Protection(locked=False)
B.inputs.append(dict(key='tape', sheet='In_LoanTape', cell='A6:G%d' % (5 + TROWS), label='Loan tape block (Loan ID, segment, outstanding, DPD, undrawn, restructured Y/N, SICR Y/N)', source=SRC_MIS + ' – loan-wise outstanding and DPD report', default=None))
TR = lambda c: "'In_LoanTape'!$%s$6:$%s$%d" % (c, c, 5 + TROWS)

# ------------------------------------------------------------------ Portfolio
p = B.sheet('In_Portfolio', (5, 28, 14, 14, 14, 14, 14, 14, 14, 15, 14, 16, 16), tab='BF9000')
p.title('In_Portfolio – outstanding loans by days-past-due (DPD) bucket', 'Block A is typed (Summary source). Block B is what the model uses: Block A, or the loan tape when that source is selected.')
BK = ['Current (0 DPD)', '1-30', '31-60', '61-90', '91-180', '181-365', 'Above 365']
BND = [(0, 0), (1, 30), (31, 60), (61, 90), (91, 180), (181, 365), (366, 99999)]
hd = ['#', 'Segment'] + BK + ['Total', 'Undrawn sanctioned limits', 'Of which restructured standard (Stage 2)', 'Moved to Stage 2 on judgement (SICR)']
p.sec('A6', 'A. Summary input', 13); p.head(7, hd)
p.sec('A28', 'B. Data used by the model (formula)', 13); p.head(29, hd)
for i, r in enumerate(SEG):
    k = i + 1; u = r + 22
    p.lbl('A%d' % r, k); p.f('B%d' % r, ST('B%d' % SR(r)), 'txt')
    for j, c in enumerate('CDEFGHI'):
        p.inp('%s%d' % (c, r), 'port.b%d.%d' % (j, k), 'Segment %d – %s' % (k, BK[j]), None, 'num', SRC_MIS + ' – DPD-wise outstanding; DNBS01 Part 10 (delinquency)')
    p.f('J%d' % r, 'SUM(C%d:I%d)' % (r, r))
    p.inp('K%d' % r, 'port.undrawn.%d' % k, 'Segment %d undrawn limits' % k, None, 'num', 'Sanction register; contingent liabilities note')
    p.inp('L%d' % r, 'port.restr.%d' % k, 'Segment %d restructured standard' % k, None, 'num', 'Restructured accounts register; DNBS01 Part 9E')
    p.inp('M%d' % r, 'port.sicr.%d' % k, 'Segment %d SICR override' % k, None, 'num', 'Credit monitoring / early warning list')
    p.lbl('A%d' % u, k); p.f('B%d' % u, 'B%d' % r, 'txt')
    for j, c in enumerate('CDEFGHI'):
        lo, hi = BND[j]
        p.f('%s%d' % (c, u), '%s*IF(%s="Loan tape",SUMIFS(%s,%s,$B%d,%s,">=%d",%s,"<=%d"),%s%d)' % (ACT(r), ST('$B$9'), TR('C'), TR('B'), u, TR('D'), lo, TR('D'), hi, c, r))
    p.f('J%d' % u, 'SUM(C%d:I%d)' % (u, u))
    p.f('K%d' % u, '%s*IF(%s="Loan tape",SUMIFS(%s,%s,$B%d),K%d)' % (ACT(r), ST('$B$9'), TR('E'), TR('B'), u, r))
    p.f('L%d' % u, '%s*IF(%s="Loan tape",SUMIFS(%s,%s,$B%d,%s,"Y",%s,"<="&IF(%s="31+ DPD",30,0)),L%d)' % (ACT(r), ST('$B$9'), TR('C'), TR('B'), u, TR('F'), TR('D'), ST('$B$10'), r))
    p.f('M%d' % u, '%s*IF(%s="Loan tape",SUMIFS(%s,%s,$B%d,%s,"Y",%s,"<="&IF(%s="31+ DPD",30,0)),M%d)' % (ACT(r), ST('$B$9'), TR('C'), TR('B'), u, TR('G'), TR('D'), ST('$B$10'), r))
for base in (RT, RT + 22):
    p.lbl('B%d' % base, 'Total', True)
    for c in 'CDEFGHIJKLM':
        p.f('%s%d' % (c, base), 'SUM(%s%d:%s%d)' % (c, base - N, c, base - 1), out=True)
PU = lambda c, r: q('In_Portfolio', '%s%d' % (c, r + 22))

# ------------------------------------------------------------------ History (roll rates)
h = B.sheet('In_History', (14, 14, 14, 14, 14, 14, 13, 13, 13, 13, 13, 13, 13, 13, 13, 10), tab='BF9000')
h.title('In_History – month-end balances by DPD bucket (for the roll-rate PD method)', 'Enter up to 25 consecutive month-ends, oldest first, for each segment that uses the Roll rate method. At least 13 months are recommended.')
MON = 25; HB = lambda i: 6 + 30 * i; HAVG = lambda i: HB(i) + 27
for i in range(N):
    k = i + 1; b0 = HB(i)
    h.sec('A%d' % b0, 'Segment %d' % k, 2); h.f('C%d' % b0, ST('B%d' % (40 + i)), 'txt', bold=True)
    h.head(b0 + 1, ['Month-end', 'Current', '1-30', '31-60', '61-90', '91-120 (new defaults)', 'Flow C to 1-30', 'Flow 1-30 to 31-60', 'Flow 31-60 to 61-90', 'Flow 61-90 to 91+', 'Monthly PD (current)', '12-month PD', 'PD from 1-30', 'PD from 31-60', 'PD from 61-90', 'Months'])
    for mth in range(MON):
        r = b0 + 2 + mth
        h.inp('A%d' % r, 'hist.%d.m%d.date' % (k, mth + 1), 'Segment %d month %d date' % (k, mth + 1), None, 'txt', SRC_MIS)
        for j, c in enumerate('BCDEF'):
            h.inp('%s%d' % (c, r), 'hist.%d.m%d.b%d' % (k, mth + 1, j), 'Segment %d month %d bucket %d' % (k, mth + 1, j), None, 'num', SRC_MIS + ' – month-end DPD bucket report')
        if mth:
            for a, bq in zip('GHIJ', 'BCDE'):
                nx = chr(ord(bq) + 1)
                h.f('%s%d' % (a, r), 'IF(OR(%s%d="",%s%d=""),"",%s)' % (bq, r - 1, nx, r, div('%s%d' % (nx, r), '%s%d' % (bq, r - 1))), 'pct')
    a = HAVG(i); h.lbl('A%d' % a, 'Weighted average', True)
    for c, bq in zip('GHIJ', 'BCDE'):
        nx = chr(ord(bq) + 1)
        h.f('%s%d' % (c, a), div('SUMPRODUCT((%s%d:%s%d<>"")*(%s%d:%s%d<>"")*%s%d:%s%d)' % (bq, b0 + 2, bq, a - 2, nx, b0 + 3, nx, a - 1, nx, b0 + 3, nx, a - 1),
                                 'SUMPRODUCT((%s%d:%s%d<>"")*(%s%d:%s%d<>"")*%s%d:%s%d)' % (bq, b0 + 2, bq, a - 2, nx, b0 + 3, nx, a - 1, bq, b0 + 2, bq, a - 2)), 'pct', out=True)
    h.f('K%d' % a, 'G%d*H%d*I%d*J%d' % (a, a, a, a), 'p4', out=True); h.f('L%d' % a, 'MIN(1,1-(1-K%d)^12)' % a, 'pct', out=True)
    h.f('M%d' % a, 'H%d*I%d*J%d' % (a, a, a), 'pct', out=True); h.f('N%d' % a, 'I%d*J%d' % (a, a), 'pct', out=True); h.f('O%d' % a, 'J%d' % a, 'pct', out=True)
    h.f('P%d' % a, 'COUNT(B%d:B%d)' % (b0 + 2, a - 1), 'int')

# ------------------------------------------------------------------ Default history
d = B.sheet('In_Defaults', (5, 28) + (13,) * 18, tab='BF9000')
d.title('In_Defaults – yearly default history (for the default-history PD method)', 'For each of the last five years: performing exposure at the start of the year and the amount that became more than 90 DPD (or NPA) within that year. Leave unused years blank.')
d.head(7, ['#', 'Segment'] + ['Opening performing Y-%d' % y for y in (5, 4, 3, 2, 1)] + ['Defaulted in Y-%d' % y for y in (5, 4, 3, 2, 1)] + ['Default rate Y-%d' % y for y in (5, 4, 3, 2, 1)] + ['Weighted average PD', 'Simple average PD', 'Years of data'])
for i, r in enumerate(SEG):
    k = i + 1; d.lbl('A%d' % r, k); d.f('B%d' % r, ST('B%d' % SR(r)), 'txt')
    for j, c in enumerate('CDEFG'):
        d.inp('%s%d' % (c, r), 'def.open.%d.y%d' % (k, 5 - j), 'Segment %d opening performing exposure Y-%d' % (k, 5 - j), None, 'num', SRC_MIS + ' – opening standard assets; DNBS01 Part 9C')
    for j, c in enumerate('HIJKL'):
        d.inp('%s%d' % (c, r), 'def.amt.%d.y%d' % (k, 5 - j), 'Segment %d defaulted Y-%d' % (k, 5 - j), None, 'num', 'NPA movement – additions during the year; DNBS01 Part 9D')
    for o, dd, c in zip('CDEFG', 'HIJKL', 'MNOPQ'):
        d.f('%s%d' % (c, r), 'IF(%s%d>0,%s%d/%s%d,"")' % (o, r, dd, r, o, r), 'pct')
    d.f('R%d' % r, div('SUM(H%d:L%d)' % (r, r), 'SUM(C%d:G%d)' % (r, r)), 'pct', out=True)
    d.f('S%d' % r, 'IF(COUNT(M%d:Q%d)=0,0,AVERAGE(M%d:Q%d))' % (r, r, r, r), 'pct'); d.f('T%d' % r, 'COUNT(M%d:Q%d)' % (r, r), 'int')

# ------------------------------------------------------------------ LGD inputs
g = B.sheet('In_LGD', (5, 28, 16, 16, 16, 16, 16, 14, 16, 14, 16), tab='BF9000')
g.title('In_LGD – recovery experience and collateral', 'Workout columns: closed or aged defaulted cases of the last 3-5 years. Collateral columns: current secured book.')
g.head(7, ['#', 'Segment', 'Workout: exposure at default of the sample', 'Workout: total recoveries', 'Workout: recovery costs', 'Workout: average years to recover',
           'Collateral: realisable value', 'Collateral: haircut', 'Collateral: years to realise', 'Collateral: selling cost', 'Collateral: exposure covered'])
for i, r in enumerate(SEG):
    k = i + 1; g.lbl('A%d' % r, k); g.f('B%d' % r, ST('B%d' % SR(r)), 'txt')
    for c, key, lab, fmt, dft, src in [('C', 'lgd.wead', 'workout EAD', 'num', None, 'NPA / write-off register'), ('D', 'lgd.wrec', 'workout recoveries', 'num', None, 'Recovery register'),
                                       ('E', 'lgd.wcost', 'workout costs', 'num', None, 'Legal and collection expenses'), ('F', 'lgd.wyrs', 'workout years', 'num', 1.5, 'Recovery register'),
                                       ('G', 'lgd.cval', 'collateral value', 'num', None, 'Valuation reports / security register'), ('H', 'lgd.chair', 'collateral haircut', 'pct', 0.25, 'ECL policy'),
                                       ('I', 'lgd.cyrs', 'collateral years to realise', 'num', 2, 'Recovery experience'), ('J', 'lgd.ccost', 'collateral selling cost', 'pct', 0.05, 'Recovery experience'),
                                       ('K', 'lgd.cexp', 'collateral exposure covered', 'num', None, SRC_MIS)]:
        g.inp('%s%d' % (c, r), '%s.%d' % (key, k), 'Segment %d %s' % (k, lab), dft, fmt, src)

# ------------------------------------------------------------------ Macro
mc = B.sheet('In_Macro', (40, 16, 16, 16, 50), tab='BF9000')
mc.title('In_Macro – forward-looking scenarios', 'The narrative table documents the scenarios. The three rows in section B drive the calculation.')
mc.sec('A6', 'A. Scenario narrative (for documentation)', 5); mc.head(7, ['Macro-economic variable (next 12 months)', 'Base', 'Upside', 'Downside', 'Source / remark'])
for j, v in enumerate(['Real GDP growth (%)', 'CPI inflation (%)', 'RBI repo rate (%)', 'Unemployment rate (%)', 'Sector indicator relevant to the portfolio', 'Other variable']):
    r = 8 + j; mc.inp('A%d' % r, 'macro.var.%d' % (j + 1), 'Macro variable %d' % (j + 1), v, 'txt', 'RBI Monetary Policy Report / MoSPI / IMF WEO')
    for c, sc in zip('BCD', ('base', 'up', 'down')):
        mc.inp('%s%d' % (c, r), 'macro.val.%d.%s' % (j + 1, sc), 'Macro variable %d %s' % (j + 1, sc), None, 'num', 'Published forecasts')
    mc.inp('E%d' % r, 'macro.src.%d' % (j + 1), 'Macro variable %d source' % (j + 1), None, 'txt')
mc.sec('A16', 'B. Scenario drivers used by the model', 5); mc.head(16, ['B. Scenario drivers used by the model', 'Base', 'Upside', 'Downside', 'How it is used'])
for r, lab, key, vals, use in [(17, 'PD multiplier (Multiplier method)', 'macro.pdm', (1.0, 0.85, 1.35), 'Scenario PD = PD x multiplier'),
                               (18, 'Systematic factor Z (Vasicek method)', 'macro.z', (0.0, 1.0, -1.5), '0 = average year; negative = downturn'),
                               (19, 'LGD multiplier', 'macro.lgdm', (1.0, 0.95, 1.15), 'Scenario LGD = LGD x multiplier')]:
    mc.lbl('A%d' % r, lab)
    for c, sc, v in zip('BCD', ('base', 'up', 'down'), vals):
        mc.inp('%s%d' % (c, r), '%s.%s' % (key, sc), '%s – %s' % (lab, sc), v, 'num', 'ECL policy; approved by the ALCO / Risk Management Committee')
    mc.lbl('E%d' % r, use)
MC = lambda c: q('In_Macro', c)
SC = [('B', 'Base'), ('C', 'Upside'), ('D', 'Downside')]; W = ['$B$12', '$B$13', '$B$14']

# ------------------------------------------------------------------ PD
pd_ = B.sheet('PD', (5, 26, 14, 12, 12, 12, 12, 10, 12, 12, 12, 12, 12, 10, 12, 12, 12), tab='2E75B6')
pd_.title('PD – probability of default by segment', 'No inputs on this sheet.')
pd_.head(7, ['#', 'Segment', 'Method', 'Roll-rate 12m PD', 'Default-history PD', 'Manual PD', 'Selected 12m PD (TTC)', 'rho', '12m PD – Base', '12m PD – Upside', '12m PD – Downside', 'Weighted 12m PD', 'Roll PD of Stage 2 buckets', 'Tenor (yrs)', 'Lifetime PD – Base', 'Lifetime PD – Upside', 'Lifetime PD – Downside'])
for i, r in enumerate(SEG):
    sr = SR(r); a = HAVG(i)
    pd_.lbl('A%d' % r, i + 1); pd_.f('B%d' % r, ST('B%d' % sr), 'txt'); pd_.f('C%d' % r, ST('E%d' % sr), 'txt')
    pd_.f('D%d' % r, q('In_History', 'L%d' % a), 'pct'); pd_.f('E%d' % r, q('In_Defaults', 'R%d' % r), 'pct'); pd_.f('F%d' % r, ST('K%d' % sr), 'pct')
    pd_.f('G%d' % r, 'IF(%s,MIN(1,MAX(%s,IF(C%d="Roll rate",D%d,IF(C%d="Default history",E%d,F%d)))),0)' % (ACT(r), ST('$B$19'), r, r, r, r, r), 'pct', out=True)
    pd_.f('H%d' % r, ST('J%d' % sr), 'pct')
    for c, (mcol, _) in zip('IJK', SC):
        pd_.f('%s%d' % (c, r), 'IF(G%d<=0,0,IF(%s="Vasicek",NORMSDIST((NORMSINV(MIN(G%d,0.9999))-SQRT(H%d)*%s)/SQRT(1-H%d)),MIN(1,G%d*%s)))' % (r, ST('$B$15'), r, r, MC('$%s$18' % mcol), r, r, MC('$%s$17' % mcol)), 'pct')
    pd_.f('L%d' % r, 'I%d*%s+J%d*%s+K%d*%s' % (r, ST(W[0]), r, ST(W[1]), r, ST(W[2])), 'pct', out=True)
    e1 = 'IF(%s="1+ DPD",%s,0)' % (ST('$B$10'), PU('D', r))
    pd_.f('M%d' % r, 'IF(C%d="Roll rate",%s,0)' % (r, div('%s*%s+%s*%s+%s*%s' % (e1, q('In_History', 'M%d' % a), PU('E', r), q('In_History', 'N%d' % a), PU('F', r), q('In_History', 'O%d' % a)),
                                                           '%s+%s+%s' % (e1, PU('E', r), PU('F', r)))), 'pct')
    pd_.f('N%d' % r, ST('H%d' % sr))
    for c, pc in zip('OPQ', 'IJK'):
        pd_.f('%s%d' % (c, r), 'IF(G%d<=0,0,MIN(1,MAX(M%d*%s%d/G%d,1-(1-MIN(1,%s%d*%s))^MAX(1,N%d))))' % (r, r, pc, r, r, pc, r, ST('$B$18'), r), 'pct')

# ------------------------------------------------------------------ LGD
lg = B.sheet('LGD', (5, 26, 14, 13, 13, 13, 14, 13, 13, 13, 14), tab='2E75B6')
lg.title('LGD – loss given default by segment', 'No inputs on this sheet.')
lg.head(7, ['#', 'Segment', 'Method', 'Workout LGD', 'Collateral LGD', 'Manual LGD', 'Selected LGD', 'LGD – Base', 'LGD – Upside', 'LGD – Downside', 'Stage 3 LGD (base)'])
GI = lambda c, r: q('In_LGD', '%s%d' % (c, r))
for i, r in enumerate(SEG):
    sr = SR(r); lg.lbl('A%d' % r, i + 1); lg.f('B%d' % r, ST('B%d' % sr), 'txt'); lg.f('C%d' % r, ST('F%d' % sr), 'txt')
    lg.f('D%d' % r, 'IF(%s=0,0,MAX(0,MIN(1,1-((%s-%s)/(1+%s)^%s)/%s)))' % (GI('C', r), GI('D', r), GI('E', r), ST('G%d' % sr), GI('F', r), GI('C', r)), 'pct')
    lg.f('E%d' % r, 'IF(%s=0,0,MAX(0,1-MIN(1,(%s*(1-%s)*(1-%s)/(1+%s)^%s)/%s)))' % (GI('K', r), GI('G', r), GI('H', r), GI('J', r), ST('G%d' % sr), GI('I', r), GI('K', r)), 'pct')
    lg.f('F%d' % r, ST('L%d' % sr), 'pct')
    lg.f('G%d' % r, 'IF(%s,MIN(1,MAX(%s,IF(C%d="Workout",D%d,IF(C%d="Collateral",E%d,F%d)))),0)' % (ACT(r), ST('$B$20'), r, r, r, r, r), 'pct', out=True)
    for c, (mcol, _) in zip('HIJ', SC):
        lg.f('%s%d' % (c, r), 'MIN(1,G%d*%s)' % (r, MC('$%s$19' % mcol)), 'pct')
    lg.f('K%d' % r, 'IF(G%d=0,0,MIN(1,G%d+%s))' % (r, r, ST('$B$17')), 'pct')

# ------------------------------------------------------------------ EAD / staging
e = B.sheet('EAD', (5, 26, 15, 15, 15, 15, 15, 15, 15, 12), tab='2E75B6')
e.title('EAD – staging and exposure at default', 'No inputs on this sheet.')
e.head(7, ['#', 'Segment', 'Performing before transfers', 'Transfers to Stage 2 (restructured + SICR)', 'Stage 1', 'Stage 2', 'Stage 3', 'Off-balance EAD (undrawn x CCF)', 'Total EAD', 'Check'])
for i, r in enumerate(SEG):
    e.lbl('A%d' % r, i + 1); e.f('B%d' % r, ST('B%d' % SR(r)), 'txt')
    e.f('C%d' % r, '%s+IF(%s="31+ DPD",%s,0)' % (PU('C', r), ST('$B$10'), PU('D', r)))
    e.f('D%d' % r, 'MIN(C%d,%s+%s)' % (r, PU('L', r), PU('M', r)))
    e.f('E%d' % r, 'C%d-D%d' % (r, r)); e.f('F%d' % r, 'IF(%s="1+ DPD",%s,0)+%s+%s+D%d' % (ST('$B$10'), PU('D', r), PU('E', r), PU('F', r), r))
    e.f('G%d' % r, '%s+%s+%s' % (PU('G', r), PU('H', r), PU('I', r))); e.f('H%d' % r, '%s*%s' % (PU('K', r), ST('I%d' % SR(r))))
    e.f('I%d' % r, 'E%d+F%d+G%d+H%d' % (r, r, r, r), out=True)
    e.f('J%d' % r, 'IF(ABS(E%d+F%d+G%d-%s)<0.005,"OK","CHECK")' % (r, r, r, PU('J', r)), 'txt')
e.lbl('B%d' % RT, 'Total', True)
for c in 'CDEFGHI':
    e.f('%s%d' % (c, RT), 'SUM(%s%d:%s%d)' % (c, R0, c, RT - 1), out=True)
e.rag('J%d:J%d' % (R0, RT - 1))

# ------------------------------------------------------------------ ECL calc
x = B.sheet('ECL_Calc', (5, 24, 9) + (12,) * 14, tab='2E75B6')
x.title('ECL_Calc – expected credit loss by stage and scenario', 'No inputs on this sheet. Weighted ECL = base, upside and downside results weighted by the scenario weights on Setup.')
x.head(7, ['#', 'Segment', 'Discount factor'] + ['%s – Stage %d' % (n, st) for _, n in SC for st in (1, 2, 3)] + ['Weighted – Stage 1', 'Weighted – Stage 2', 'Weighted – Stage 3', 'Total ECL', 'ECL / EAD'])
cols = ['DEF', 'GHI', 'JKL']
for i, r in enumerate(SEG):
    sr = SR(r); x.lbl('A%d' % r, i + 1); x.f('B%d' % r, ST('B%d' % sr), 'txt')
    x.f('C%d' % r, 'IF(%s="Yes",1/(1+%s)^(%s/2),1)' % (ST('$B$16'), ST('G%d' % sr), ST('H%d' % sr)), 'n4')
    for cs, p12, pl, lgc, (mcol, _) in zip(cols, 'IJK', 'OPQ', 'HIJ', SC):
        x.f('%s%d' % (cs[0], r), '(%s+%s)*%s*%s' % (q('EAD', 'E%d' % r), q('EAD', 'H%d' % r), q('PD', '%s%d' % (p12, r)), q('LGD', '%s%d' % (lgc, r))))
        x.f('%s%d' % (cs[1], r), '%s*%s*%s*C%d' % (q('EAD', 'F%d' % r), q('PD', '%s%d' % (pl, r)), q('LGD', '%s%d' % (lgc, r)), r))
        x.f('%s%d' % (cs[2], r), '%s*MIN(1,%s*%s)' % (q('EAD', 'G%d' % r), q('LGD', 'K%d' % r), MC('$%s$19' % mcol)))
    for st, c in enumerate('MNO'):
        x.f('%s%d' % (c, r), '+'.join('%s%d*%s' % (cols[k][st], r, ST(W[k])) for k in range(3)), out=True)
    x.f('P%d' % r, 'SUM(M%d:O%d)' % (r, r), out=True); x.f('Q%d' % r, div('P%d' % r, q('EAD', 'I%d' % r)), 'pct')
x.lbl('B%d' % RT, 'Total', True)
for c in 'DEFGHIJKLMNOP':
    x.f('%s%d' % (c, RT), 'SUM(%s%d:%s%d)' % (c, R0, c, RT - 1), out=True)
x.f('Q%d' % RT, div('P%d' % RT, q('EAD', 'I%d' % RT)), 'pct', out=True)

# ------------------------------------------------------------------ Overlay
o = B.sheet('Overlay', (5, 24, 13, 13, 13, 13, 13, 13, 40, 13, 13, 13, 14, 11), tab='2E75B6')
o.title('Overlay – management overlay and final ECL', 'Enter overlays (plus or minus) only with a written reason and the approval reference. Individually assessed large exposures are also entered here.')
o.head(7, ['#', 'Segment', 'Model ECL – Stage 1', 'Model ECL – Stage 2', 'Model ECL – Stage 3', 'Overlay – Stage 1', 'Overlay – Stage 2', 'Overlay – Stage 3', 'Reason and approval reference', 'Final – Stage 1', 'Final – Stage 2', 'Final – Stage 3', 'Final ECL', 'Coverage'])
for i, r in enumerate(SEG):
    k = i + 1; o.lbl('A%d' % r, k); o.f('B%d' % r, ST('B%d' % SR(r)), 'txt')
    for c, sc in zip('CDE', 'MNO'):
        o.f('%s%d' % (c, r), q('ECL_Calc', '%s%d' % (sc, r)))
    for c, stg in zip('FGH', (1, 2, 3)):
        o.inp('%s%d' % (c, r), 'ovl.s%d.%d' % (stg, k), 'Segment %d overlay Stage %d' % (k, stg), None, 'num', 'ECL committee / Audit Committee minutes')
    o.inp('I%d' % r, 'ovl.why.%d' % k, 'Segment %d overlay reason' % k, None, 'txt', 'ECL committee / Audit Committee minutes')
    for c, a, b_ in zip('JKL', 'CDE', 'FGH'):
        o.f('%s%d' % (c, r), 'MAX(0,%s%d+%s%d)' % (a, r, b_, r), out=True)
    o.f('M%d' % r, 'SUM(J%d:L%d)' % (r, r), out=True); o.f('N%d' % r, div('M%d' % r, q('EAD', 'I%d' % r)), 'pct')
o.lbl('B%d' % RT, 'Total', True)
for c in 'CDEFGHJKLM':
    o.f('%s%d' % (c, RT), 'SUM(%s%d:%s%d)' % (c, R0, c, RT - 1), out=True)
o.f('N%d' % RT, div('M%d' % RT, q('EAD', 'I%d' % RT)), 'pct', out=True)

# ------------------------------------------------------------------ IRACP floor
ir = B.sheet('IRACP_Floor', (5, 24) + (13,) * 14, tab='548235')
ir.title('IRACP_Floor – RBI prudential floor and Impairment Reserve', 'Enter the NPA amounts by RBI asset class for each segment. Rates come from Setup.')
ir.head(7, ['#', 'Segment', 'Gross loans', 'Sub-standard', 'Doubtful secured: up to 1 yr', 'Doubtful secured: 1-3 yrs', 'Doubtful secured: over 3 yrs', 'Doubtful: unsecured portion', 'Loss assets', 'Total NPA', 'Standard assets', 'Provision on standard assets', 'Provision on NPAs', 'Total IRACP provision', 'Ind AS ECL (final)', 'Ind AS less IRACP'])
for i, r in enumerate(SEG):
    k = i + 1; ir.lbl('A%d' % r, k); ir.f('B%d' % r, ST('B%d' % SR(r)), 'txt'); ir.f('C%d' % r, PU('J', r))
    for c, key, lab in zip('DEFGHI', ('ss', 'd1', 'd2', 'd3', 'du', 'loss'), ('sub-standard', 'doubtful secured up to 1 yr', 'doubtful secured 1-3 yrs', 'doubtful secured over 3 yrs', 'doubtful unsecured portion', 'loss assets')):
        ir.inp('%s%d' % (c, r), 'npa.%s.%d' % (key, k), 'Segment %d %s' % (k, lab), None, 'num', 'NPA statement; DNBS01 Part 9C (asset classification)')
    ir.f('J%d' % r, 'SUM(D%d:I%d)' % (r, r)); ir.f('K%d' % r, 'MAX(0,C%d-J%d)' % (r, r)); ir.f('L%d' % r, 'K%d*%s' % (r, ST('M%d' % SR(r))))
    ir.f('M%d' % r, 'D{0}*{1}+E{0}*{2}+F{0}*{3}+G{0}*{4}+H{0}*{5}+I{0}*{6}'.format(r, ST('$B$30'), ST('$B$31'), ST('$B$32'), ST('$B$33'), ST('$B$34'), ST('$B$35')))
    ir.f('N%d' % r, 'L%d+M%d' % (r, r), out=True); ir.f('O%d' % r, q('Overlay', 'M%d' % r)); ir.f('P%d' % r, 'O%d-N%d' % (r, r))
ir.lbl('B%d' % RT, 'Total', True)
for c in 'CDEFGHIJKLMNOP':
    ir.f('%s%d' % (c, RT), 'SUM(%s%d:%s%d)' % (c, R0, c, RT - 1), out=True)
ir.sec('B26', 'Impairment Reserve working (company level)', 3)
ir.lbl('B27', 'Total provision required under IRACP (prudential floor)'); ir.f('C27', 'N%d' % RT, out=True)
ir.lbl('B28', 'Total impairment allowance under Ind AS 109'); ir.f('C28', 'O%d' % RT, out=True)
ir.lbl('B29', 'Shortfall of Ind AS allowance against the floor'); ir.f('C29', 'IF(%s="Ind AS",MAX(0,C27-C28),0)' % ST('$B$7'), out=True)
ir.lbl('B30', 'Impairment Reserve already held'); ir.inp('C30', 'ir.held', 'Impairment Reserve already held', None, 'num', 'Balance sheet – other equity (Impairment Reserve)')
ir.lbl('B31', 'Further appropriation to Impairment Reserve from PAT'); ir.f('C31', 'MAX(0,C29-C30)', out=True)
ir.lbl('B32', 'Provision to be carried in the books'); ir.f('C32', 'IF(%s="Ind AS",C28,C27)' % ST('$B$7'), out=True)
ir.note('B33', 'Where the company is not on Ind AS, the IRACP provision is the book provision and ECL is for information and ICAAP use only.')

# ------------------------------------------------------------------ Movement
mv = B.sheet('Movement', (46, 15, 15, 15, 15), tab='548235')
mv.title('Movement – reconciliation of the loss allowance (Ind AS 107 para 35H)', 'Enter the opening balances and the movements you can identify; the balancing figure is shown as remeasurement.')
mv.head(7, ['Particulars', 'Stage 1', 'Stage 2', 'Stage 3', 'Total'])
ml = [('Opening loss allowance', 'open'), ('Transfers to Stage 1', 't1'), ('Transfers to Stage 2', 't2'), ('Transfers to Stage 3', 't3'), ('New financial assets originated', 'new'), ('Assets derecognised / repaid (enter negative)', 'derec'), ('Write-offs (enter negative)', 'wo')]
for j, (lab, key) in enumerate(ml):
    r = 8 + j; mv.lbl('A%d' % r, lab)
    for c, stg in zip('BCD', (1, 2, 3)):
        mv.inp('%s%d' % (c, r), 'mov.%s.s%d' % (key, stg), '%s – Stage %d' % (lab, stg), None, 'num', 'Previous year ECL note; ECL working of the year')
    mv.f('E%d' % r, 'SUM(B%d:D%d)' % (r, r))
mv.lbl('A15', 'Remeasurement (changes in PD, LGD, EAD and models) – balancing figure')
mv.lbl('A16', 'Closing loss allowance (from Overlay)', True)
for c, oc in zip('BCD', 'JKL'):
    mv.f('%s16' % c, q('Overlay', '%s%d' % (oc, RT)), out=True); mv.f('%s15' % c, '%s16-SUM(%s8:%s14)' % (c, c, c))
mv.f('E15', 'SUM(B15:D15)'); mv.f('E16', 'SUM(B16:D16)', out=True)

# ------------------------------------------------------------------ Sensitivity
sn = B.sheet('Sensitivity', (50, 16, 16, 14), tab='548235')
sn.title('Sensitivity – what-if analysis on the final ECL', 'Proportionate approximations around the weighted result; see Method Notes.')
sn.head(7, ['Change in assumption', 'ECL after change', 'Increase / (decrease)', '% change'])
T1, T2, T3, TT = [q('Overlay', '%s%d' % (c, RT)) for c in 'JKLM']
avgl = div('SUMPRODUCT(%s,%s)' % (q('LGD', 'G%d:G%d' % (R0, RT - 1)), q('EAD', 'I%d:I%d' % (R0, RT - 1))), q('EAD', 'I%d' % RT))
sens = [('Base case (final ECL)', TT), ('PD up by 10%', '%s+(%s+%s)*0.10' % (TT, T1, T2)), ('PD up by 25%', '%s+(%s+%s)*0.25' % (TT, T1, T2)), ('PD down by 10%', '%s-(%s+%s)*0.10' % (TT, T1, T2)),
        ('LGD up by 5 percentage points', '%s+%s' % (TT, div('%s*0.05' % TT, avgl))), ('LGD up by 10 percentage points', '%s+%s' % (TT, div('%s*0.10' % TT, avgl))),
        ('100% weight to the downside scenario', 'SUM(%s)' % q('ECL_Calc', 'J%d:L%d' % (RT, RT))), ('100% weight to the base scenario', 'SUM(%s)' % q('ECL_Calc', 'D%d:F%d' % (RT, RT))),
        ('100% weight to the upside scenario', 'SUM(%s)' % q('ECL_Calc', 'G%d:I%d' % (RT, RT))),
        ('5% of Stage 1 exposure migrates to Stage 2', '%s+0.05*%s*(%s-%s)' % (TT, q('EAD', 'E%d' % RT), div(T2, q('EAD', 'F%d' % RT)), div(T1, '%s+%s' % (q('EAD', 'E%d' % RT), q('EAD', 'H%d' % RT))))),
        ('10% of Stage 2 exposure migrates to Stage 3', '%s+0.10*%s*(%s-%s)' % (TT, q('EAD', 'F%d' % RT), div(T3, q('EAD', 'G%d' % RT)), div(T2, q('EAD', 'F%d' % RT))))]
for j, (lab, fm) in enumerate(sens):
    r = 8 + j; sn.lbl('A%d' % r, lab); sn.f('B%d' % r, fm, out=(j == 0)); sn.f('C%d' % r, 'B%d-$B$8' % r); sn.f('D%d' % r, div('C%d' % r, '$B$8'), 'pct')

# ------------------------------------------------------------------ Backtest
bt = B.sheet('Backtest', (5, 26, 16, 16, 12, 12, 40), tab='548235')
bt.title('Backtest – PD predicted a year ago against the actual default rate', 'A ratio above the thresholds on Setup means the PD under-predicted defaults and should be re-calibrated.')
bt.head(7, ['#', 'Segment', '12m PD used a year ago', 'Actual default rate in the year', 'Actual / predicted', 'Result', 'Action'])
for i, r in enumerate(SEG):
    k = i + 1; bt.lbl('A%d' % r, k); bt.f('B%d' % r, ST('B%d' % SR(r)), 'txt')
    bt.inp('C%d' % r, 'bt.pred.%d' % k, 'Segment %d PD used a year ago' % k, None, 'pct', 'Previous year ECL model'); bt.inp('D%d' % r, 'bt.act.%d' % k, 'Segment %d actual default rate' % k, None, 'pct', 'NPA movement of the year / opening standard assets')
    bt.f('E%d' % r, 'IF(OR(C%d="",C%d=0,D%d=""),"",D%d/C%d)' % (r, r, r, r, r), 'num')
    bt.f('F%d' % r, 'IF(E%d="","",%s)' % (r, rag_hi_bad('E%d' % r, ST('$B$27'), ST('$C$27'))), 'txt')
    bt.f('G%d' % r, 'IF(F%d="RED","Re-calibrate the PD; consider an overlay until done",IF(F%d="AMBER","Review the PD method and the history window",""))' % (r, r), 'txt')
bt.rag('F%d:F%d' % (R0, RT - 1))
bt.lbl('B25', 'Loss backtest (company level)', True)
bt.lbl('B26', 'Stage 1 and 2 ECL held a year ago'); bt.inp('C26', 'bt.ecl_prev', 'Stage 1 and 2 ECL held a year ago', None, 'num', 'Previous year ECL note')
bt.lbl('B27', 'Actual credit loss in the year (write-offs + new Stage 3 provisions - recoveries)'); bt.inp('C27', 'bt.loss_act', 'Actual credit loss in the year', None, 'num', 'P&L – impairment on financial instruments')
bt.lbl('B28', 'Actual / predicted'); bt.f('C28', 'IF(OR(C26="",C26=0),"",C27/C26)', 'num'); bt.f('D28', 'IF(C28="","",%s)' % rag_hi_bad('C28', ST('$B$27'), ST('$C$27')), 'txt'); bt.rag('D28')

# ------------------------------------------------------------------ Disclosures
ds = B.sheet('Disclosures', (30, 16, 16, 16, 16, 14), tab='548235')
ds.title('Disclosures – tables for the notes to accounts', 'No inputs. Units as selected on Setup.')
ds.f('A3', '"Company: "&%s&"   |   As at: "&TEXT(%s,"DD-MMM-YYYY")&"   |   Amounts in "&%s' % (ST('B4'), ST('B5'), ST('B6')), 'txt')
ds.sec('A5', 'A. Exposure and loss allowance by stage', 6); ds.head(6, ['Stage', 'Gross carrying amount', 'Off-balance EAD', 'Loss allowance', 'Net carrying amount', 'Coverage'])
for j, (lab, ec, oc) in enumerate([('Stage 1', 'E', 'J'), ('Stage 2', 'F', 'K'), ('Stage 3', 'G', 'L')]):
    r = 7 + j; ds.lbl('A%d' % r, lab); ds.f('B%d' % r, q('EAD', '%s%d' % (ec, RT))); ds.f('C%d' % r, q('EAD', 'H%d' % RT) if j == 0 else '0')
    ds.f('D%d' % r, q('Overlay', '%s%d' % (oc, RT))); ds.f('E%d' % r, 'B%d-D%d' % (r, r)); ds.f('F%d' % r, div('D%d' % r, 'B%d+C%d' % (r, r)), 'pct')
ds.lbl('A10', 'Total', True)
for c in 'BCDE':
    ds.f('%s10' % c, 'SUM(%s7:%s9)' % (c, c), out=True)
ds.f('F10', div('D10', 'B10+C10'), 'pct', out=True)
ds.sec('A13', 'B. By segment', 6); ds.head(14, ['Segment', 'Gross carrying amount', 'Of which Stage 3', 'Loss allowance', 'Gross Stage 3 %', 'Coverage'])
for i, r in enumerate(SEG):
    rr = 15 + i; ds.f('A%d' % rr, ST('B%d' % SR(r)), 'txt'); ds.f('B%d' % rr, PU('J', r)); ds.f('C%d' % rr, q('EAD', 'G%d' % r)); ds.f('D%d' % rr, q('Overlay', 'M%d' % r))
    ds.f('E%d' % rr, div('C%d' % rr, 'B%d' % rr), 'pct'); ds.f('F%d' % rr, div('D%d' % rr, 'B%d' % rr), 'pct')

# ------------------------------------------------------------------ Dashboard
db = B.sheet('Dashboard', (44, 16, 12, 44), tab='00B050')
db.title('Dashboard – key results', 'RAG compares each ratio with the thresholds on Setup.')
db.f('A3', q('Disclosures', 'A3'), 'txt')
db.head(5, ['Indicator', 'Value', 'RAG', 'What it tells you'])
GL = q('EAD', 'E%d' % RT) + '+' + q('EAD', 'F%d' % RT) + '+' + q('EAD', 'G%d' % RT)
kp = [('Gross loans', GL, 'num', None, 'Total on-balance sheet exposure'),
      ('Total EAD (including undrawn)', q('EAD', 'I%d' % RT), 'num', None, 'Exposure on which ECL is computed'),
      ('Final ECL allowance', TT, 'num', None, 'Loss allowance to be carried under Ind AS 109'),
      ('ECL / gross loans', div(TT, GL), 'pct', None, 'Overall provision cover'),
      ('Gross Stage 3 %', div(q('EAD', 'G%d' % RT), GL), 'pct', ('hi', '23'), 'Share of loans more than 90 DPD'),
      ('Net Stage 3 %', div('%s-%s' % (q('EAD', 'G%d' % RT), T3), '%s-%s' % (GL, T3)), 'pct', ('hi', '24'), 'Stage 3 net of its allowance'),
      ('Stage 2 share', div(q('EAD', 'F%d' % RT), GL), 'pct', ('hi', '25'), 'Loans with a significant increase in credit risk'),
      ('Stage 3 coverage', div(T3, q('EAD', 'G%d' % RT)), 'pct', ('lo', '26'), 'Allowance held against Stage 3 loans'),
      ('Stage 1 coverage', div(T1, '%s+%s' % (q('EAD', 'E%d' % RT), q('EAD', 'H%d' % RT))), 'pct', None, ''),
      ('Stage 2 coverage', div(T2, q('EAD', 'F%d' % RT)), 'pct', None, ''),
      ('Exposure-weighted 12-month PD', div('SUMPRODUCT(%s,%s)' % (q('PD', 'L%d:L%d' % (R0, RT - 1)), q('EAD', 'I%d:I%d' % (R0, RT - 1))), q('EAD', 'I%d' % RT)), 'pct', None, 'Average PD across segments'),
      ('Exposure-weighted LGD', avgl, 'pct', None, 'Average LGD across segments'),
      ('IRACP prudential floor', q('IRACP_Floor', 'C27'), 'num', None, 'Provision required under RBI norms'),
      ('Impairment Reserve required', q('IRACP_Floor', 'C29'), 'num', None, 'Floor less Ind AS allowance, if positive'),
      ('Downside-scenario ECL', 'SUM(%s)' % q('ECL_Calc', 'J%d:L%d' % (RT, RT)), 'num', None, 'ECL if the downside scenario alone applied')]
for j, (lab, fm, fmt, rg, why) in enumerate(kp):
    r = 6 + j; db.lbl('A%d' % r, lab); db.f('B%d' % r, fm, fmt, out=True); db.lbl('D%d' % r, why)
    if rg:
        fn = rag_hi_bad if rg[0] == 'hi' else rag_lo_bad
        db.f('C%d' % r, 'IF(%s=0,"",%s)' % (GL, fn('B%d' % r, ST('$B$' + rg[1]), ST('$C$' + rg[1]))), 'txt')
db.rag('C6:C%d' % (6 + len(kp)))
DBR = {lab: 6 + j for j, (lab, *_r) in enumerate(kp)}
db.lbl('A23', 'Open items on the Checks sheet', True); db.f('B23', 'COUNTIF(%s,"CHECK")' % q('Checks', 'C6:C20'), 'int'); db.f('C23', 'IF(B23=0,"OK","CHECK")', 'txt'); db.rag('C23')

# ------------------------------------------------------------------ Handover
ho = B.sheet('Handover', (6, 46, 18, 34), tab='7030A0')
ho.title('Handover – figures for the Stress Testing and ICAAP models', 'Copy column C into the matching hand-over inputs of the other two models (the data-fill script does this by key).')
ho.head(5, ['#', 'Item', 'Value', 'Key'])
hov = [('Gross loans', GL, 'ecl.gross'), ('Stage 1 exposure', q('EAD', 'E%d' % RT), 'ecl.s1'), ('Stage 2 exposure', q('EAD', 'F%d' % RT), 'ecl.s2'), ('Stage 3 exposure', q('EAD', 'G%d' % RT), 'ecl.s3'),
       ('Off-balance EAD', q('EAD', 'H%d' % RT), 'ecl.offbal'), ('ECL – Stage 1', T1, 'ecl.ecl1'), ('ECL – Stage 2', T2, 'ecl.ecl2'), ('ECL – Stage 3', T3, 'ecl.ecl3'), ('ECL – total', TT, 'ecl.total'),
       ('Exposure-weighted 12-month PD', 'Dashboard!B%d' % DBR['Exposure-weighted 12-month PD'], 'ecl.pd'), ('Exposure-weighted LGD', 'Dashboard!B%d' % DBR['Exposure-weighted LGD'], 'ecl.lgd'),
       ('IRACP prudential floor', q('IRACP_Floor', 'C27'), 'ecl.floor'), ('Impairment Reserve required', q('IRACP_Floor', 'C29'), 'ecl.impres'), ('Downside-scenario ECL', 'Dashboard!B%d' % DBR['Downside-scenario ECL'], 'ecl.down')]
for j, (lab, fm, key) in enumerate(hov):
    r = 6 + j; ho.lbl('A%d' % r, j + 1); ho.lbl('B%d' % r, lab); ho.f('C%d' % r, fm, 'pct' if key in ('ecl.pd', 'ecl.lgd') else 'num', out=True); ho.lbl('D%d' % r, key)
ho.sec('A22', 'Segment table', 4); ho.head(23, ['#', 'Segment', 'Gross loans', 'Stage 3', '12m PD (weighted)', 'LGD', 'ECL'])
for c, w in zip('EFG', (16, 12, 16)):
    ho.ws.column_dimensions[c].width = w
for i, r in enumerate(SEG):
    rr = 24 + i; ho.lbl('A%d' % rr, i + 1); ho.f('B%d' % rr, ST('B%d' % SR(r)), 'txt'); ho.f('C%d' % rr, PU('J', r)); ho.f('D%d' % rr, q('EAD', 'G%d' % r))
    ho.f('E%d' % rr, q('PD', 'L%d' % r), 'pct'); ho.f('F%d' % rr, q('LGD', 'G%d' % r), 'pct'); ho.f('G%d' % rr, q('Overlay', 'M%d' % r))

# ------------------------------------------------------------------ Checks
ck = B.sheet('Checks', (6, 70, 12, 50), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results')
ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
chk = [('Scenario weights add up to 100%', 'ABS(%s+%s+%s-1)<0.0001' % (ST('$B$12'), ST('$B$13'), ST('$B$14')), 'Correct the weights on Setup'),
       ('At least one segment is active', 'COUNTIF(%s,"Yes")>0' % ST('C40:C54'), 'Set Active = Yes for the segments in use'),
       ('No negative balances in the portfolio', 'COUNTIF(%s,"<0")=0' % q('In_Portfolio', 'C30:M44'), 'Correct the bucket balances'),
       ('Staging total equals portfolio total for every segment', 'COUNTIF(%s,"CHECK")=0' % q('EAD', 'J%d:J%d' % (R0, RT - 1)), 'Transfers to Stage 2 exceed performing loans'),
       ('NPA entered on IRACP_Floor equals Stage 3 exposure (within 1%)', 'ABS(%s-%s)<=0.01*MAX(1,%s)' % (q('IRACP_Floor', 'J%d' % RT), q('EAD', 'G%d' % RT), q('EAD', 'G%d' % RT)), 'Reconcile NPA classification with 90+ DPD; differences arise from borrower-level classification and upgrades'),
       ('Every active Roll-rate segment has at least 13 months of history', 'SUMPRODUCT((%s="Yes")*(%s="Roll rate")*(%s<13))=0' % (ST('C40:C54'), ST('E40:E54'), 'N(+%s)' % q('In_History', 'P%d' % HAVG(0))) if False else 'TRUE', 'Enter more months or change the PD method'),
       ('Every active segment has a PD above zero', 'SUMPRODUCT((%s="Yes")*(%s<=0))=0' % (ST('C40:C54'), q('PD', 'G%d:G%d' % (R0, RT - 1))), 'Complete the inputs for the PD method chosen'),
       ('Every active segment has an LGD above zero', 'SUMPRODUCT((%s="Yes")*(%s<=0))=0' % (ST('C40:C54'), q('LGD', 'G%d:G%d' % (R0, RT - 1))), 'Complete the inputs for the LGD method chosen'),
       ('PD floor and LGD floor are set', 'AND(%s>0,%s>0)' % (ST('$B$19'), ST('$B$20')), 'Enter the floors on Setup'),
       ('Reporting date and company name are filled', 'AND(%s<>"",%s<>"")' % (ST('$B$4'), ST('$B$5')), 'Complete Setup'),
       ('Remeasurement in Movement is below 50% of closing allowance', 'ABS(%s)<=0.5*MAX(0.01,%s)' % (q('Movement', 'E15'), q('Movement', 'E16')), 'Enter the opening balance and the movements'),
       ('Final ECL is not below the model ECL by more than 10% (negative overlays)', '%s>=0.9*%s' % (TT, q('ECL_Calc', 'P%d' % RT)), 'Large negative overlays need Audit Committee approval')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
# roll-rate history check written separately (per segment references)
ck.f('C11', 'IF(' + '+'.join('(%s="Yes")*(%s="Roll rate")*(%s<13)' % (ST('C%d' % (40 + i)), ST('E%d' % (40 + i)), q('In_History', 'P%d' % HAVG(i))) for i in range(N)) + '=0,"OK","CHECK")', 'txt')
ck.rag('C6:C20')

source_map(B)
order = ['ReadMe', 'Method Notes', 'Setup', 'In_Portfolio', 'In_LoanTape', 'In_History', 'In_Defaults', 'In_LGD', 'In_Macro', 'PD', 'LGD', 'EAD', 'ECL_Calc', 'Overlay', 'IRACP_Floor', 'Movement', 'Sensitivity', 'Backtest', 'Disclosures', 'Dashboard', 'Handover', 'Checks', 'Source Map']
B.wb._sheets = [B.wb[n] for n in order]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('ECL model built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
