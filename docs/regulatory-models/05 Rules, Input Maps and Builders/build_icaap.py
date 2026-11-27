"""ICAAP Master Model. Run: python3 build_icaap.py <out.xlsx> <map.json>"""
import sys
from xl import *

B = Book('ICAAP-M01', 'ICAAP Master Model')
GUARD[0] = "N('In_Capital'!$B$7)=0"   # no equity capital entered yet: RAG cells stay blank
YN = ['Yes', 'No']; N = 15; NT = 20; NS = 10
BUCK = ['1-7 days', '8-14 days', '15-30/31 days', 'Over 1 to 2 months', 'Over 2 to 3 months', 'Over 3 to 6 months', 'Over 6 months to 1 year', 'Over 1 to 3 years', 'Over 3 to 5 years', 'Over 5 years']
BMID = [0.01, 0.03, 0.06, 0.125, 0.21, 0.375, 0.75, 2.0, 4.0, 7.0]
ST = lambda c: q('Setup', c)

readme(B, 'Internal Capital Adequacy Assessment Process (ICAAP) Master Model',
       ['This workbook assesses whether the company holds enough capital for all its material risks. It computes regulatory capital and CRAR (Pillar 1), assesses each other risk and assigns internal capital to it (Pillar 2), adds the stress capital buffer from the Stress Testing model, compares the total with the capital available, and projects capital for three years.',
        'The RBI does not prescribe a Pillar 2 capital charge for NBFCs; the add-ons in this model are the company\'s own internal estimates, and every rate, slab and threshold is an input that the Board may change.'],
       ['Setup: enter company details, regulatory minima for the layer, and review the slabs and thresholds.',
        'In_Financials, In_Capital, In_RWA: enter three years of financials, the capital components and the assets with their risk weights.',
        'In_Handover: bring in the figures from the Handover sheets of the ECL and Stress Testing models.',
        'Risk_Universe: mark each risk as material or not, with the reason. Risks marked "No" are assessed but not counted.',
        'P2 sheets: complete the inputs for concentration, interest rate, liquidity, operational and market risk, and the scorecards for the risks assessed on indicators.',
        'Read Aggregation (capital required against capital available), Capital_Plan (three years) and Risk_Appetite.',
        'Clear the Checks sheet. Doc_Tables then holds the tables for the ICAAP document.'],
       [('Method Notes', 'explains every formula'), ('Setup', 'minima, slabs, thresholds'), ('In_Financials', 'three years of financials'), ('In_Capital', 'Tier 1 and Tier 2 components'),
        ('In_RWA', 'risk-weighted assets'), ('In_Handover', 'figures from the ECL and Stress Testing models'), ('Capital_Adequacy', 'CRAR, Tier 1 and leverage against the minima'),
        ('Risk_Universe', 'list of risks, materiality and capital'), ('P2_Credit', 'economic capital for credit risk'), ('P2_Concentration', 'borrower, sector and state concentration'),
        ('P2_IRRBB', 'interest rate risk in the banking book'), ('P2_Liquidity', 'liquidity indicators'), ('P2_Operational', 'operational risk estimate'), ('P2_Market', 'investment and currency risk'),
        ('P2_Scorecards', 'indicator-based assessment of the other risks'), ('Aggregation', 'total capital required against available'), ('Capital_Plan', 'three-year projection'),
        ('Risk_Appetite', 'limits and actuals'), ('Dashboard', 'RAG summary'), ('Doc_Tables', 'tables for the ICAAP document'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how this model produces its results')
m.text_block(4, [
 '# 1. Overall logic',
 'Internal capital requirement = Pillar 1 capital + Pillar 2 add-ons for the material risks + stress capital buffer. This is compared with available capital (Tier 1 + eligible Tier 2). The ratio available / required is the internal capital adequacy ratio; below 1 the company is short of capital on its own assessment.',
 '# 2. Regulatory capital (In_Capital, In_RWA, Capital_Adequacy)',
 'Owned fund = equity + compulsorily convertible preference shares + free reserves + securities premium + capital reserve - accumulated losses - deferred revenue expenditure - intangible assets. Tier 1 = owned fund - investments in and loans to group companies in excess of 10% of owned fund - other deductions + eligible perpetual debt. Tier 2 = other preference shares + 45% of revaluation reserves + general provisions (capped at the % of RWA on Setup) + hybrid debt + subordinated debt (capped at the % of Tier 1 on Setup); Tier 2 counted is capped at Tier 1. RWA = sum of book value x risk weight, plus off-balance sheet notional x credit conversion factor x risk weight. CRAR = (Tier 1 + eligible Tier 2) / RWA. Check every risk weight against the Capital Adequacy Directions before use.',
 '# 3. Pillar 1',
 'Pillar 1 capital = RWA x minimum CRAR for the layer. For NBFCs the RWA covers credit risk only; there is no regulatory capital charge for market or operational risk, which is why those risks are assessed under Pillar 2 here.',
 '# 4. Credit risk economic capital (P2_Credit)',
 'For each segment the Basel single-factor formula gives the capital ratio K = LGD x [ NORMSDIST( (NORMSINV(PD) + SQRT(R) x NORMSINV(confidence)) / SQRT(1 - R) ) - PD ], where R is the asset correlation. Unexpected loss = K x performing exposure. Add-on = the excess of total unexpected loss over the Pillar 1 capital held on the loan book, plus any shortfall of the ECL held against expected loss (PD x LGD x exposure).',
 '# 5. Concentration (P2_Concentration)',
 'HHI = sum of squared shares (borrowers as shares of gross loans; sectors and states as shares of their totals). Each HHI is placed in a slab (Setup) that gives an add-on as a percentage of Pillar 1 credit capital.',
 '# 6. Interest rate risk (P2_IRRBB)',
 'Change in economic value of equity = - sum of (rate-sensitive assets - liabilities) x bucket mid-point x shock, for a rise and a fall in rates; the loss under the worse direction is used. Earnings at risk = sum over buckets up to one year of gap x shock x (1 - mid-point). The add-on is EVE loss, earnings loss or the higher, as selected. A fall in EVE above 15% of Tier 1 is the Basel outlier level.',
 '# 7. Liquidity (P2_Liquidity)',
 'Liquidity risk is controlled mainly by limits and buffers, not capital. The sheet tests the cumulative mismatch in the first three buckets against the limits, the liquidity coverage ratio where applicable, funding concentration and the stressed survival horizon. The capital add-on is the funding cost stress loss from the Stress Testing model plus any manual amount.',
 '# 8. Operational and market risk',
 'Operational: internal estimate = alpha (15% by default) x average positive gross income of three years x scaling factor, or the stressed operational loss from the Stress Testing model if higher. Market: loss on equity and mutual funds (value x price fall) + bonds (value x duration x yield rise) + net open currency position x currency move, less the Pillar 1 capital already held on those investments.',
 '# 9. Scorecards (P2_Scorecards)',
 'Each risk has up to five key risk indicators. An indicator is GREEN (score 1), AMBER (3) or RED (5) against its thresholds. Risk score = weighted average of the indicators filled in. The score band table on Setup converts the score into an add-on as a percentage of RWA.',
 '# 10. Aggregation',
 'Pillar 2 add-ons of the risks marked material are added (or combined by square root of the sum of squares if that option is chosen; the simple sum is conservative). Stress buffer: "Excess over Pillar 2 add-ons" counts only the part of the stress fall in capital not already covered by the add-ons, which avoids double counting; "Add in full" and "Exclude" are the alternatives. Internal target = requirement + management buffer (percentage of RWA on Setup).',
 '# 11. Capital plan',
 'RWA(t) = RWA(t-1) x (1 + growth). Tier 1(t) = Tier 1(t-1) + profit after tax x (1 - dividend payout) + equity raised. Tier 2 counted is capped at Tier 1. Internal requirement is held at the same percentage of RWA as in the base year. Stressed CRAR = projected CRAR less the fall in CRAR under the planning stress scenario.',
 '# 12. RAG',
 'GREEN / AMBER / RED compare each result with the thresholds on Setup or on the sheet itself. Red on any regulatory ratio means the minimum is breached.'])

# ------------------------------------------------------------------ Setup
s = B.sheet('Setup', (56, 18, 16, 16, 16), tab='C00000')
s.title('Setup – minima, slabs and thresholds', 'Fill this sheet first.')
s.sec('A3', 'A. General', 3)
gen = [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None), (5, 'Reporting date', 'setup.date', None, 'date', None), (6, 'Amounts are in', 'setup.units', '₹ crore', 'txt', ['₹ crore', '₹ lakh', '₹']),
       (7, 'Regulatory layer', 'setup.layer', 'Middle Layer', 'txt', ['Base Layer', 'Middle Layer', 'Upper Layer']), (8, 'Minimum CRAR', 'setup.mincrar', 0.15, 'pct', None), (9, 'Minimum Tier 1 ratio', 'setup.mint1', 0.10, 'pct', None),
       (10, 'Minimum CET1 ratio (Upper Layer; enter 0 if not applicable)', 'setup.mincet1', 0, 'pct', None), (11, 'Maximum leverage (Base Layer; outside liabilities / owned fund)', 'setup.maxlev', 7, 'num', None),
       (12, 'Management buffer over the internal requirement (% of RWA)', 'setup.mbuf', 0.02, 'pct', None), (13, 'Combination of Pillar 2 add-ons', 'setup.agg', 'Simple sum', 'txt', ['Simple sum', 'Square root of sum of squares']),
       (14, 'Stress buffer treatment', 'setup.stress', 'Excess over Pillar 2 add-ons', 'txt', ['Excess over Pillar 2 add-ons', 'Add in full', 'Exclude']), (15, 'Confidence level for credit economic capital', 'setup.conf', 0.999, 'p4', None),
       (16, 'Interest rate shock for IRRBB (basis points)', 'setup.bps', 200, 'int', None), (17, 'Operational risk alpha (% of gross income)', 'setup.alpha', 0.15, 'pct', None),
       (18, 'Cap on general provisions in Tier 2 (% of RWA)', 'setup.gpcap', 0.0125, 'pct', None), (19, 'Cap on subordinated debt in Tier 2 (% of Tier 1)', 'setup.sdcap', 0.5, 'pct', None), (20, 'Tax rate', 'setup.tax', 0.2517, 'pct', None)]
for r, lab, key, d, fmt, lst in gen:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, d, fmt, 'RBI Capital Adequacy Directions / ICAAP policy', lst)
s.head(22, ['B. RAG thresholds', 'Amber', 'Red'])
for r, lab, key, a, rd, fmt in [(23, 'CRAR: amber below / red below', 'thr.crar', 0.17, 0.15, 'pct'), (24, 'Tier 1 ratio: amber below / red below', 'thr.t1', 0.115, 0.10, 'pct'),
                                (25, 'Internal capital adequacy ratio (available / required): amber below / red below', 'thr.icar', 1.15, 1.0, 'num'), (26, 'Fall in EVE / Tier 1: amber from / red from', 'thr.eve', 0.10, 0.15, 'pct'),
                                (27, 'Largest borrower / Tier 1: amber from / red from', 'thr.sbl', 0.20, 0.25, 'pct')]:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key + '.amber', lab + ' – amber', a, fmt, 'Risk appetite statement'); s.inp('C%d' % r, key + '.red', lab + ' – red', rd, fmt, 'Risk appetite statement')
s.head(30, ['C. Scorecard: score band to capital add-on', 'Score below', 'Add-on (% of RWA)'])
for j, (bd, ad) in enumerate([(1.5, 0), (2.5, 0.001), (3.5, 0.0025), (4.5, 0.005), (5.01, 0.01)]):
    r = 31 + j; s.lbl('A%d' % r, 'Band %d' % (j + 1)); s.inp('B%d' % r, 'score.bound.%d' % (j + 1), 'Score band %d upper bound' % (j + 1), bd, 'num', 'ICAAP policy'); s.inp('C%d' % r, 'score.addon.%d' % (j + 1), 'Score band %d add-on' % (j + 1), ad, 'p4', 'ICAAP policy')
s.head(37, ['D. Concentration slabs', 'Borrower HHI below', 'Sector HHI below', 'State HHI below', 'Add-on (% of Pillar 1 credit capital)'])
for j, (a, b_, c, ad) in enumerate([(0.001, 0.12, 0.20, 0), (0.003, 0.18, 0.30, 0.02), (0.01, 0.25, 0.40, 0.04), (9, 9, 9, 0.08)]):
    r = 38 + j; s.lbl('A%d' % r, 'Slab %d' % (j + 1))
    for col, key, v, fmt in zip('BCDE', ('name', 'sector', 'state', 'addon'), (a, b_, c, ad), ('n4', 'n4', 'n4', 'pct')):
        s.inp('%s%d' % (col, r), 'slab.%s.%d' % (key, j + 1), 'Concentration slab %d %s' % (j + 1, key), v, fmt, 'ICAAP policy')
MIN = ST('$B$8')
SCORE2ADD = lambda sc: 'IF({0}<=0,0,IF({0}<{1},{2},IF({0}<{3},{4},IF({0}<{5},{6},IF({0}<{7},{8},{9})))))'.format(sc, ST('$B$31'), ST('$C$31'), ST('$B$32'), ST('$C$32'), ST('$B$33'), ST('$C$33'), ST('$B$34'), ST('$C$34'), ST('$C$35'))
SLAB = lambda h, col: 'IF({0}<{1},{2},IF({0}<{3},{4},IF({0}<{5},{6},{7})))'.format(h, ST('$%s$38' % col), ST('$E$38'), ST('$%s$39' % col), ST('$E$39'), ST('$%s$40' % col), ST('$E$40'), ST('$E$41'))

# ------------------------------------------------------------------ Financials
f = B.sheet('In_Financials', (52, 16, 16, 16), tab='BF9000')
f.title('In_Financials – three years of financials', 'From the audited financial statements. Y0 is the latest year.')
f.head(6, ['Item', 'Y-2', 'Y-1', 'Latest year (Y0)'])
fin = [('ii', 'Interest income'), ('oi', 'Other operating income (fees, commission, gains)'), ('ie', 'Interest expense (finance cost)'), ('opex', 'Operating expenses (employee, depreciation, other)'),
       ('prov', 'Impairment on financial instruments / provisions'), ('tax', 'Tax expense'), ('div', 'Dividend paid'), ('assets', 'Total assets'), ('loans', 'Gross loans'), ('borr', 'Borrowings'),
       ('nw', 'Net worth'), ('gnpa', 'Gross NPA / Stage 3'), ('nnpa', 'Net NPA')]
FR = {}
for j, (key, lab) in enumerate(fin):
    r = 7 + j; FR[key] = r; f.lbl('A%d' % r, lab)
    for c, y in zip('BCD', ('y2', 'y1', 'y0')):
        f.inp('%s%d' % (c, r), 'fin.%s.%s' % (key, y), '%s – %s' % (lab, y.upper()), None, 'num', 'Audited financial statements; DNBS01 Parts 1-3')
calc = [('nii', 'Net interest income', '{c}%d-{c}%d' % (FR['ii'], FR['ie']), 'num'), ('gi', 'Gross income (net interest income + other income)', '{c}%d+{c}%d-{c}%d' % (FR['ii'], FR['oi'], FR['ie']), 'num'),
        ('ppop', 'Pre-provision operating profit', '{c}22-{c}%d' % FR['opex'], 'num'), ('pbt', 'Profit before tax', '{c}23-{c}%d' % FR['prov'], 'num'), ('pat', 'Profit after tax', '{c}24-{c}%d' % FR['tax'], 'num'),
        ('nim', 'Net interest margin (on total assets)', div('{c}21', '{c}%d' % FR['assets']), 'pct'), ('roa', 'Return on assets', div('{c}25', '{c}%d' % FR['assets']), 'pct'), ('roe', 'Return on equity', div('{c}25', '{c}%d' % FR['nw']), 'pct'),
        ('ci', 'Cost to income', div('{c}%d' % FR['opex'], '{c}22'), 'pct'), ('gn', 'Gross NPA %', div('{c}%d' % FR['gnpa'], '{c}%d' % FR['loans']), 'pct'), ('nn', 'Net NPA %', div('{c}%d' % FR['nnpa'], '{c}%d' % FR['loans']), 'pct'),
        ('de', 'Debt to equity', div('{c}%d' % FR['borr'], '{c}%d' % FR['nw']), 'x')]
for j, (key, lab, fm, fmt) in enumerate(calc):
    r = 21 + j; FR[key] = r; f.lbl('A%d' % r, lab)
    for c in 'BCD':
        f.f('%s%d' % (c, r), fm.replace('{c}', c), fmt, out=True)
FN = lambda key, c='D': "'In_Financials'!$%s$%d" % (c, FR[key])

# ------------------------------------------------------------------ Capital
c_ = B.sheet('In_Capital', (74, 18, 50), tab='BF9000')
c_.title('In_Capital – regulatory capital components', 'From the capital adequacy working and DNBS03. Enter deductions as positive numbers.')
c_.head(6, ['A. Tier 1 capital', 'Amount', 'Note'])
cap = {7: ('eq', 'Paid-up equity capital', ''), 8: ('ccps', 'Compulsorily convertible preference shares', ''), 9: ('res', 'Free reserves (statutory reserve, general reserve, retained earnings)', 'Exclude revaluation reserves'),
       10: ('prem', 'Securities premium', ''), 11: ('capres', 'Capital reserve representing surplus on sale of assets', ''), 12: ('pdi', 'Perpetual debt instruments eligible as Tier 1', 'Within the limit in the Directions; excess goes to Tier 2'),
       14: ('loss', 'Less: accumulated losses', ''), 15: ('dre', 'Less: deferred revenue expenditure', ''), 16: ('intang', 'Less: intangible assets', ''),
       17: ('unreal', 'Less: unrealised fair value gains included in reserves (Ind AS)', 'As required for Ind AS NBFCs'), 18: ('secur', 'Less: securitisation and credit-enhancement deductions from Tier 1', ''), 19: ('othded', 'Less: other regulatory deductions', ''),
       21: ('grp', 'Investments in shares of other NBFCs and investments in / loans to subsidiaries and group companies', 'Excess over 10% of owned fund is deducted')}
for r, (key, lab, note) in cap.items():
    c_.lbl('A%d' % r, lab); c_.inp('B%d' % r, 'cap.' + key, lab, None, 'num', 'DNBS03 capital funds; capital adequacy working'); c_.lbl('C%d' % r, note)
c_.lbl('A20', 'Owned fund', True); c_.f('B20', 'SUM(B7:B11)-SUM(B14:B16)', out=True)
c_.lbl('A22', 'Excess of group exposure over 10% of owned fund'); c_.f('B22', 'MAX(0,N(B21)-0.1*B20)')
c_.lbl('A23', 'Tier 1 capital', True); c_.f('B23', 'B20-B22-N(B17)-N(B18)-N(B19)+N(B12)', out=True)
c_.head(25, ['B. Tier 2 capital', 'Amount', 'Note'])
t2 = {26: ('pref', 'Preference shares other than compulsorily convertible', ''), 27: ('reval', 'Revaluation reserves (gross; counted at 45%)', ''), 28: ('gp', 'General provisions and loss reserves (including provision on standard assets / 12-month ECL as permitted)', 'Capped as % of RWA (Setup)'),
      29: ('hybrid', 'Hybrid debt capital instruments', ''), 30: ('sub', 'Subordinated debt (after discount for residual maturity)', 'Capped as % of Tier 1 (Setup)'), 31: ('pdix', 'Perpetual debt instruments in excess of the Tier 1 limit', '')}
for r, (key, lab, note) in t2.items():
    c_.lbl('A%d' % r, lab); c_.inp('B%d' % r, 'cap.' + key, lab, None, 'num', 'DNBS03 Part 2 (Tier II capital)'); c_.lbl('C%d' % r, note)
RWAT = "'In_RWA'!$D$39"
c_.lbl('A33', 'Eligible general provisions'); c_.f('B33', 'MIN(N(B28),%s*%s)' % (ST('$B$18'), RWAT))
c_.lbl('A34', 'Eligible subordinated debt'); c_.f('B34', 'MIN(N(B30),%s*MAX(0,B23))' % ST('$B$19'))
c_.lbl('A35', 'Tier 2 capital before the cap'); c_.f('B35', 'N(B26)+0.45*N(B27)+B33+N(B29)+B34+N(B31)')
c_.lbl('A36', 'Eligible Tier 2 capital (capped at Tier 1)', True); c_.f('B36', 'MAX(0,MIN(B35,B23))', out=True)
c_.lbl('A37', 'Total capital funds', True); c_.f('B37', 'B23+B36', out=True)
c_.lbl('A38', 'Common Equity Tier 1 (Tier 1 less perpetual debt)'); c_.f('B38', 'B23-N(B12)', out=True)
c_.lbl('A40', 'Total outside liabilities'); c_.inp('B40', 'cap.osl', 'Total outside liabilities', None, 'num', 'Balance sheet (total liabilities less owned fund)')
CP = lambda c: "'In_Capital'!$B$%d" % c
T1, T2E, CAPT = CP(23), CP(36), CP(37)

# ------------------------------------------------------------------ RWA
w = B.sheet('In_RWA', (62, 18, 12, 18, 16), tab='BF9000')
w.title('In_RWA – risk-weighted assets', 'Item names, amounts and risk weights are inputs. The default weights are a starting point: check each one against the Capital Adequacy Directions.')
w.head(6, ['A. On-balance sheet item', 'Book value (net of provisions)', 'Risk weight', 'Risk-weighted amount', 'Type'])
onb = [('Cash and bank balances, including fixed deposits and certificates of deposit with banks', 0, 'Other'), ('Investments: approved securities (government)', 0, 'Investments'),
       ('Investments: bonds of public sector banks', 0.2, 'Investments'), ('Investments: fixed deposits / bonds of public financial institutions', 1, 'Investments'),
       ('Investments: shares, debentures, commercial paper and mutual fund units', 1, 'Investments'), ('Loans: secured retail and MSME loans', 1, 'Loans'), ('Loans: unsecured business loans', 1, 'Loans'),
       ('Loans: consumer credit (personal loans and similar)', 1.25, 'Loans'), ('Loans: commercial real estate', 1, 'Loans'), ('Loans: guaranteed by the Central Government', 0, 'Loans'),
       ('Loans: guaranteed by a State Government', 0.2, 'Loans'), ('Loans: covered by credit guarantee schemes (guaranteed portion)', 0, 'Loans'), ('Loans: other loans and advances', 1, 'Loans'),
       ('Loans: to subsidiaries and group companies (not deducted)', 1, 'Loans'), ('Fixed assets (net of depreciation)', 1, 'Other'), ('Advance tax and tax deducted at source (net of provision)', 0, 'Other'),
       ('Other assets', 1, 'Other'), ('Items deducted from capital (intangibles, excess group exposure)', 0, 'Other')]
for j, (lab, rw, typ) in enumerate(onb):
    r = 7 + j
    w.inp('A%d' % r, 'rwa.on.name.%d' % (j + 1), 'On-balance item %d' % (j + 1), lab, 'txt', 'DNBS03 Part 3 (weighted assets – on-balance sheet)')
    w.inp('B%d' % r, 'rwa.on.amt.%d' % (j + 1), '%s – amount' % lab, None, 'num', 'DNBS03 Part 3; balance sheet')
    w.inp('C%d' % r, 'rwa.on.rw.%d' % (j + 1), '%s – risk weight' % lab, rw, 'pct', 'Capital Adequacy Directions – risk weights'); w.f('D%d' % r, 'N(B%d)*C%d' % (r, r))
    w.inp('E%d' % r, 'rwa.on.type.%d' % (j + 1), '%s – type' % lab, typ, 'txt', 'Classification', ['Loans', 'Investments', 'Other'])
w.lbl('A25', 'Total on-balance sheet', True); w.f('B25', 'SUM(B7:B24)', out=True); w.f('D25', 'SUM(D7:D24)', out=True)
w.head(28, ['B. Off-balance sheet item', 'Notional amount', 'Credit conversion factor', 'Risk-weighted amount', 'Risk weight'])
ofb = [('Financial guarantees', 1, 1), ('Performance guarantees', 0.5, 1), ('Undrawn commitments – original maturity up to 1 year', 0.2, 1), ('Undrawn commitments – original maturity over 1 year', 0.5, 1),
       ('Unconditionally cancellable commitments', 0, 1), ('Credit enhancement for securitisation / co-lending not deducted', 1, 1), ('Partly paid shares and other commitments', 1, 1), ('Other off-balance sheet items', 1, 1)]
for j, (lab, ccf, rw) in enumerate(ofb):
    r = 29 + j
    w.inp('A%d' % r, 'rwa.off.name.%d' % (j + 1), 'Off-balance item %d' % (j + 1), lab, 'txt', 'DNBS03 Part 4 (off-balance sheet items)')
    w.inp('B%d' % r, 'rwa.off.amt.%d' % (j + 1), '%s – notional' % lab, None, 'num', 'DNBS03 Part 4; contingent liabilities note')
    w.inp('C%d' % r, 'rwa.off.ccf.%d' % (j + 1), '%s – CCF' % lab, ccf, 'pct', 'Capital Adequacy Directions – credit conversion factors')
    w.inp('E%d' % r, 'rwa.off.rw.%d' % (j + 1), '%s – risk weight' % lab, rw, 'pct', 'Capital Adequacy Directions'); w.f('D%d' % r, 'N(B%d)*C%d*E%d' % (r, r, r))
w.lbl('A37', 'Total off-balance sheet', True); w.f('B37', 'SUM(B29:B36)', out=True); w.f('D37', 'SUM(D29:D36)', out=True)
w.lbl('A39', 'Total risk-weighted assets', True); w.f('D39', 'D25+D37', out=True)
w.lbl('A40', 'Of which loans (including off-balance sheet)'); w.f('D40', 'SUMIF(E7:E24,"Loans",D7:D24)+D37')
w.lbl('A41', 'Of which investments'); w.f('D41', 'SUMIF(E7:E24,"Investments",D7:D24)')
w.lbl('A42', 'RWA density (RWA / total on-balance sheet assets)'); w.f('D42', div('D39', 'B25'), 'pct')
RWL, RWI = "'In_RWA'!$D$40", "'In_RWA'!$D$41"

# ------------------------------------------------------------------ Handover in
h = B.sheet('In_Handover', (6, 58, 18, 26, 14, 14, 14), tab='7030A0')
h.title('In_Handover – figures from the ECL and Stress Testing models', 'Copy from the Handover sheets of the other two models; the keys in column D match. The data-fill script does this automatically.')
h.head(5, ['#', 'Item', 'Value', 'Key'])
hk = [('ecl.gross', 'Gross loans', 'num'), ('ecl.s1', 'Stage 1 exposure', 'num'), ('ecl.s2', 'Stage 2 exposure', 'num'), ('ecl.s3', 'Stage 3 exposure', 'num'), ('ecl.offbal', 'Off-balance EAD', 'num'),
      ('ecl.ecl1', 'ECL – Stage 1', 'num'), ('ecl.ecl2', 'ECL – Stage 2', 'num'), ('ecl.ecl3', 'ECL – Stage 3', 'num'), ('ecl.total', 'ECL – total', 'num'), ('ecl.pd', 'Exposure-weighted 12-month PD', 'pct'),
      ('ecl.lgd', 'Exposure-weighted LGD', 'pct'), ('ecl.floor', 'IRACP prudential floor', 'num'), ('ecl.impres', 'Impairment Reserve required', 'num'), ('ecl.down', 'Downside-scenario ECL', 'num'),
      ('st.scenario', 'Stress: planning scenario', 'txt'), ('st.crar_pre', 'Stress: pre-stress CRAR', 'pct'), ('st.crar_base', 'Stress: post-stress CRAR – Baseline', 'pct'), ('st.crar_adv', 'Stress: post-stress CRAR – Adverse', 'pct'),
      ('st.crar_sev', 'Stress: post-stress CRAR – Severe', 'pct'), ('st.loss', 'Stress: total stress loss – planning scenario', 'num'), ('st.buffer', 'Stress: fall in capital – planning scenario (stress capital buffer)', 'num'),
      ('st.shortfall', 'Stress: capital shortfall against minimum – planning scenario', 'num'), ('st.t1', 'Stress: post-stress Tier 1 ratio – planning scenario', 'pct'), ('st.survival', 'Stress: liquidity survival horizon – Severe (days)', 'int'),
      ('st.eve', 'Stress: fall in EVE – Adverse', 'num'), ('st.nii', 'Stress: earnings loss from rate shock – Adverse', 'num'), ('st.reverse', 'Stress: reverse stress loss that breaks the minimum', 'num'),
      ('st.crar_actions', 'Stress: CRAR after management actions – Severe', 'pct')]
HK = {}
for j, (key, lab, fmt) in enumerate(hk):
    r = 6 + j; HK[key] = "'In_Handover'!$C$%d" % r; h.lbl('A%d' % r, j + 1); h.lbl('B%d' % r, lab); h.lbl('D%d' % r, key)
    h.inp('C%d' % r, key, lab, None, fmt, ('ECL' if key.startswith('ecl') else 'Stress Testing') + ' model – Handover sheet')
STR = ['Credit risk', 'Credit concentration risk', 'Interest rate risk (earnings)', 'Market risk (investments and FX)', 'Liquidity and funding cost risk', 'Operational risk', 'Cyber and IT risk',
       'Compliance and legal risk', 'Reputation risk', 'Strategic and business risk', 'Climate and ESG risk', 'Model risk', 'Group and contagion risk']
h.head(36, ['#', 'Stress loss by risk – planning scenario', 'Value', 'Key'])
for j, rk in enumerate(STR):
    r = 37 + j; HK['st.risk.%d' % (j + 1)] = "'In_Handover'!$C$%d" % r; h.lbl('A%d' % r, j + 1); h.lbl('B%d' % r, rk); h.lbl('D%d' % r, 'st.risk.%d' % (j + 1))
    h.inp('C%d' % r, 'st.risk.%d' % (j + 1), 'Stress loss – ' + rk, None, 'num', 'Stress Testing model – Handover sheet')
h.head(52, ['#', 'Segment', 'Gross loans', 'Stage 3', '12m PD', 'LGD', 'ECL'])
HS0 = 53
for i in range(N):
    r = HS0 + i; k = i + 1; h.lbl('A%d' % r, k)
    for c, key, fmt in zip('BCDEFG', ('name', 'gross', 's3', 'pd', 'lgd', 'ecl'), ('txt', 'num', 'num', 'pct', 'pct', 'num')):
        h.inp('%s%d' % (c, r), 'seg.%s.%d' % (key, k), 'Segment %d %s' % (k, key), None, fmt, 'ECL model – Handover segment table')
HSR = lambda c, r: "'In_Handover'!%s%d" % (c, r)

# ------------------------------------------------------------------ Capital adequacy
ca = B.sheet('Capital_Adequacy', (52, 18, 16, 12, 18), tab='2E75B6')
ca.title('Capital_Adequacy – regulatory capital ratios (Pillar 1)', 'No inputs.')
ca.head(6, ['Measure', 'Actual', 'Minimum / limit', 'RAG', 'Headroom (amount)'])
ca.lbl('A7', 'Tier 1 capital'); ca.f('B7', T1, out=True); ca.lbl('A8', 'Eligible Tier 2 capital'); ca.f('B8', T2E, out=True); ca.lbl('A9', 'Total capital funds', True); ca.f('B9', CAPT, out=True)
ca.lbl('A10', 'Risk-weighted assets'); ca.f('B10', RWAT, out=True)
ca.lbl('A11', 'CRAR', True); ca.f('B11', div('B9', 'B10'), 'pct', out=True); ca.f('C11', MIN, 'pct'); ca.f('D11', rag_lo_bad('B11', ST('$B$23'), ST('$C$23')), 'txt'); ca.f('E11', 'B9-C11*B10')
ca.lbl('A12', 'Tier 1 ratio', True); ca.f('B12', div('B7', 'B10'), 'pct', out=True); ca.f('C12', ST('$B$9'), 'pct'); ca.f('D12', rag_lo_bad('B12', ST('$B$24'), ST('$C$24')), 'txt'); ca.f('E12', 'B7-C12*B10')
ca.lbl('A13', 'CET1 ratio (Upper Layer)'); ca.f('B13', div(CP(38), 'B10'), 'pct', out=True); ca.f('C13', ST('$B$10'), 'pct'); ca.f('D13', 'IF(C13=0,"",IF(B13<C13,"RED","GREEN"))', 'txt'); ca.f('E13', 'IF(C13=0,0,%s-C13*B10)' % CP(38))
ca.lbl('A14', 'Leverage (outside liabilities / owned fund)'); ca.f('B14', div('N(%s)' % CP(40), CP(20)), 'x', out=True); ca.f('C14', ST('$B$11'), 'x')
ca.f('D14', 'IF(%s="Base Layer",IF(B14>C14,"RED","GREEN"),"")' % ST('$B$7'), 'txt')
ca.lbl('A15', 'Tier 2 as % of Tier 1'); ca.f('B15', div('B8', 'B7'), 'pct'); ca.f('C15', '1', 'pct')
ca.lbl('A16', 'Pillar 1 capital requirement (RWA x minimum CRAR)', True); ca.f('B16', 'B10*C11', out=True)
ca.rag('D11:D14')
CA = lambda c: "'Capital_Adequacy'!$%s" % c

# ------------------------------------------------------------------ P2 Credit
pc = B.sheet('P2_Credit', (30, 16, 12, 12, 14, 14, 16, 16, 16), tab='548235')
pc.title('P2_Credit – economic capital for credit risk', 'Segment data come from In_Handover. Asset correlation is an input (Basel range: about 3% to 24%).')
pc.head(6, ['Segment', 'Performing exposure', 'PD', 'LGD', 'Asset correlation', 'Capital ratio K', 'Unexpected loss', 'Expected loss', 'ECL held (Stage 1 and 2 share)'])
for i in range(N):
    r = 7 + i; hr = HS0 + i
    pc.f('A%d' % r, 'IF(%s="","",%s)' % (HSR('B', hr), HSR('B', hr)), 'txt'); pc.f('B%d' % r, 'MAX(0,N(%s)-N(%s))' % (HSR('C', hr), HSR('D', hr)))
    pc.f('C%d' % r, 'IF(B%d=0,0,MIN(0.9999,MAX(0.0003,N(%s))))' % (r, HSR('E', hr)), 'pct'); pc.f('D%d' % r, 'N(%s)' % HSR('F', hr), 'pct')
    pc.inp('E%d' % r, 'ec.rho.%d' % (i + 1), 'Segment %d asset correlation' % (i + 1), 0.12, 'pct', 'ICAAP policy; Basel IRB correlations')
    pc.f('F%d' % r, 'IF(C{0}=0,0,D{0}*(NORMSDIST((NORMSINV(C{0})+SQRT(E{0})*NORMSINV({1}))/SQRT(1-E{0}))-C{0}))'.format(r, ST('$B$15')), 'pct')
    pc.f('G%d' % r, 'B%d*F%d' % (r, r), out=True); pc.f('H%d' % r, 'B%d*C%d*D%d' % (r, r, r))
pc.lbl('A22', 'Total', True)
for c in 'BGH':
    pc.f('%s22' % c, 'SUM(%s7:%s21)' % (c, c), out=True)
pc.f('I22', 'N(%s)+N(%s)' % (HK['ecl.ecl1'], HK['ecl.ecl2']), out=True)
for r, lab, fm, o in [(24, 'Pillar 1 capital held on the loan book (loan RWA x minimum CRAR)', '%s*%s' % (RWL, MIN), False), (25, 'Economic capital (total unexpected loss)', 'G22', False),
                      (26, 'Excess of economic capital over Pillar 1', 'MAX(0,B25-B24)', False), (27, 'Shortfall of ECL held against expected loss', 'MAX(0,H22-I22)', False),
                      (28, 'Pillar 2 add-on for credit risk', 'B26+B27', True)]:
    pc.lbl('A%d' % r, lab, o); pc.f('B%d' % r, fm, out=o)

# ------------------------------------------------------------------ P2 Concentration
kc = B.sheet('P2_Concentration', (30, 16, 4, 30, 16, 4, 26, 16, 4, 44, 16, 12), tab='548235')
kc.title('P2_Concentration – borrower, sector and state concentration', 'Same data as the Stress Testing model (In_Base sections C, D and E).')
kc.head(6, ['Twenty largest borrowers', 'Exposure']); kc.head(6, ['Ten largest sectors', 'Exposure'], col=4); kc.head(6, ['Ten largest states', 'Exposure'], col=7); kc.head(6, ['Result', 'Value', 'RAG'], col=10)
for i in range(NT):
    r = 7 + i
    kc.inp('A%d' % r, 'top.name.%d' % (i + 1), 'Top borrower %d' % (i + 1), None, 'txt', 'DNBS01 Annex 9; DNBS03 Part 7'); kc.inp('B%d' % r, 'top.exp.%d' % (i + 1), 'Top borrower %d exposure' % (i + 1), None, 'num', 'DNBS01 Annex 9; DNBS03 Part 7')
for i in range(NS):
    r = 7 + i
    kc.inp('D%d' % r, 'sector.name.%d' % (i + 1), 'Sector %d' % (i + 1), None, 'txt', 'DNBS01 Parts 9A-9B'); kc.inp('E%d' % r, 'sector.exp.%d' % (i + 1), 'Sector %d exposure' % (i + 1), None, 'num', 'DNBS01 Parts 9A-9B')
    kc.inp('G%d' % r, 'state.name.%d' % (i + 1), 'State %d' % (i + 1), None, 'txt', 'State-wise AUM report'); kc.inp('H%d' % r, 'state.exp.%d' % (i + 1), 'State %d exposure' % (i + 1), None, 'num', 'State-wise AUM report')
GR = 'N(%s)' % HK['ecl.gross']; P1C = '%s*%s' % (RWL, MIN)
res = [('Largest borrower / Tier 1 capital', div('MAX(B7:B26,0)', T1), 'pct', rag_hi_bad('K7', ST('$B$27'), ST('$C$27'))), ('Top 20 borrowers / gross loans', div('SUM(B7:B26)', GR), 'pct', None),
       ('Borrower HHI (shares of gross loans)', div('SUMSQ(B7:B26)', '(%s)^2' % GR), 'n4', None), ('Sector HHI', div('SUMSQ(E7:E16)', 'SUM(E7:E16)^2'), 'n4', None), ('State HHI', div('SUMSQ(H7:H16)', 'SUM(H7:H16)^2'), 'n4', None),
       ('Largest sector share', div('MAX(E7:E16,0)', 'SUM(E7:E16)'), 'pct', None), ('Largest state share', div('MAX(H7:H16,0)', 'SUM(H7:H16)'), 'pct', None),
       ('Pillar 1 credit capital (base for the add-ons)', P1C, 'num', None), ('Add-on rate – borrower concentration', 'IF(SUM(B7:B26)=0,0,%s)' % SLAB('K9', 'B'), 'pct', None),
       ('Add-on rate – sector concentration', 'IF(SUM(E7:E16)=0,0,%s)' % SLAB('K10', 'C'), 'pct', None), ('Add-on rate – state concentration', 'IF(SUM(H7:H16)=0,0,%s)' % SLAB('K11', 'D'), 'pct', None),
       ('Pillar 2 add-on – borrower concentration', 'K14*K15', 'num', None), ('Pillar 2 add-on – sector concentration', 'K14*K16', 'num', None), ('Pillar 2 add-on – state concentration', 'K14*K17', 'num', None)]
for j, (lab, fm, fmt, rg) in enumerate(res):
    r = 7 + j; kc.lbl('J%d' % r, lab, j >= 11); kc.f('K%d' % r, fm, fmt, out=True)
    if rg: kc.f('L%d' % r, rg, 'txt')
kc.rag('L7:L20')

# ------------------------------------------------------------------ P2 IRRBB
ib = B.sheet('P2_IRRBB', (30, 16, 16, 16, 12, 16, 16), tab='548235')
ib.title('P2_IRRBB – interest rate risk in the banking book', 'Rate-sensitive assets and liabilities by repricing bucket (same data as the Stress Testing model).')
ib.head(6, ['Time bucket', 'Rate-sensitive assets', 'Rate-sensitive liabilities', 'Gap', 'Mid-point (years)', 'EVE change for a rise in rates', 'NII change for a rise in rates (12 months)'])
SH = '%s/10000' % ST('$B$16')
for i, bk in enumerate(BUCK):
    r = 7 + i; ib.lbl('A%d' % r, bk)
    ib.inp('B%d' % r, 'alm.rsa.%d' % (i + 1), 'RSA – ' + bk, None, 'num', 'DNBS04B interest rate sensitivity – RSA'); ib.inp('C%d' % r, 'alm.rsl.%d' % (i + 1), 'RSL – ' + bk, None, 'num', 'DNBS04B interest rate sensitivity – RSL')
    ib.f('D%d' % r, 'N(B%d)-N(C%d)' % (r, r)); ib.f('E%d' % r, str(BMID[i]), 'num'); ib.f('F%d' % r, '-D%d*E%d*%s' % (r, r, SH)); ib.f('G%d' % r, ('D%d*%s*(1-E%d)' % (r, SH, r)) if BMID[i] < 1 else '0')
ib.lbl('A17', 'Total', True)
for c in 'BCDFG':
    ib.f('%s17' % c, 'SUM(%s7:%s16)' % (c, c), out=True)
ib.lbl('A20', 'Add-on basis'); ib.inp('B20', 'irrbb.basis', 'IRRBB add-on basis', 'Higher of EVE and earnings', 'txt', 'ICAAP policy', ['Higher of EVE and earnings', 'EVE', 'Earnings'])
for r, lab, fm, fmt, o in [(21, 'Fall in EVE under the worse direction (rise or fall in rates)', 'ABS(F17)', 'num', False), (22, 'Direction that hurts economic value', 'IF(F17<0,"Rise in rates",IF(F17>0,"Fall in rates","None"))', 'txt', False),
                           (23, 'Fall in EVE / Tier 1 capital', div('B21', T1), 'pct', False), (25, 'Earnings at risk under the worse direction (12 months)', 'ABS(G17)', 'num', False),
                           (26, 'Earnings at risk / net interest income', div('B25', FN('nii')), 'pct', False),
                           (27, 'Pillar 2 add-on for IRRBB', 'IF(B20="EVE",B21,IF(B20="Earnings",B25,MAX(B21,B25)))', 'num', True)]:
    ib.lbl('A%d' % r, lab, o); ib.f('B%d' % r, fm, fmt, out=o)
ib.lbl('A24', 'EVE result (15% of Tier 1 is the outlier level)'); ib.f('B24', rag_hi_bad('B23', ST('$B$26'), ST('$C$26')), 'txt'); ib.rag('B24')

# ------------------------------------------------------------------ P2 Liquidity
lq = B.sheet('P2_Liquidity', (58, 16, 16, 16, 12), tab='548235')
lq.title('P2_Liquidity – liquidity and funding risk', 'Assessed by limits and buffers; a capital add-on is taken only for the cost of funding stress.')
lq.head(6, ['A. Structural liquidity – first three buckets', '1-7 days', '8-14 days', '15-30/31 days'])
lq.lbl('A7', 'Inflows'); lq.lbl('A8', 'Outflows'); lq.lbl('A9', 'Cumulative mismatch'); lq.lbl('A10', 'Cumulative mismatch as % of cumulative outflows'); lq.lbl('A11', 'Limit on negative mismatch (% of cumulative outflows)'); lq.lbl('A12', 'Result')
for j, c in enumerate('BCD'):
    lq.inp('%s7' % c, 'liq.in.%d' % (j + 1), 'Inflows bucket %d' % (j + 1), None, 'num', 'DNBS04B structural liquidity'); lq.inp('%s8' % c, 'liq.out.%d' % (j + 1), 'Outflows bucket %d' % (j + 1), None, 'num', 'DNBS04B structural liquidity')
    lq.f('%s9' % c, 'SUM($B7:%s7)-SUM($B8:%s8)' % (c, c)); lq.f('%s10' % c, div('%s9' % c, 'SUM($B8:%s8)' % c), 'pct')
    lq.inp('%s11' % c, 'liq.limit.%d' % (j + 1), 'Mismatch limit bucket %d' % (j + 1), (0.10, 0.10, 0.20)[j], 'pct', 'RBI liquidity risk management framework; ALM policy')
    lq.f('%s12' % c, 'IF(SUM($B8:%s8)=0,"",IF(%s10<-%s11,"RED",IF(%s10<-0.5*%s11,"AMBER","GREEN")))' % (c, c, c, c, c), 'txt')
lq.head(15, ['B. Indicators', 'Actual', 'Amber', 'Red', 'RAG'])
li = [('lcr', 'Liquidity coverage ratio (HQLA / net cash outflows over 30 days), where applicable', 'pct', 1.10, 1.00, 'lo', 'LCR statement; DNBS04A'), ('top10', 'Share of the ten largest lenders in total borrowings', 'pct', 0.60, 0.80, 'hi', 'Borrowing register'),
      ('st', 'Share of borrowings maturing within one year', 'pct', 0.40, 0.55, 'hi', 'ALM statement'), ('cp', 'Commercial paper as % of total borrowings', 'pct', 0.10, 0.20, 'hi', 'Borrowing register'),
      ('liqta', 'Unencumbered liquid assets / total assets', 'pct', 0.05, 0.03, 'lo', 'Balance sheet; treasury MIS'), ('lines', 'Undrawn committed bank lines / next 3 months\' repayments', 'pct', 0.50, 0.25, 'lo', 'Treasury MIS')]
for j, (key, lab, fmt, a, rd, d_, src) in enumerate(li):
    r = 16 + j; lq.lbl('A%d' % r, lab); lq.inp('B%d' % r, 'liq.%s' % key, lab, None, fmt, src); lq.inp('C%d' % r, 'liq.%s.amber' % key, lab + ' – amber', a, fmt, 'Risk appetite statement'); lq.inp('D%d' % r, 'liq.%s.red' % key, lab + ' – red', rd, fmt, 'Risk appetite statement')
    lq.f('E%d' % r, 'IF(B%d="","",%s)' % (r, (rag_hi_bad if d_ == 'hi' else rag_lo_bad)('B%d' % r, 'C%d' % r, 'D%d' % r)), 'txt')
lq.lbl('A22', 'Stressed survival horizon in days (from the Stress Testing model)'); lq.f('B22', 'N(%s)' % HK['st.survival'], 'int'); lq.inp('C22', 'liq.surv.amber', 'Survival horizon – amber below', 90, 'int', 'Risk appetite statement'); lq.inp('D22', 'liq.surv.red', 'Survival horizon – red below', 30, 'int', 'Risk appetite statement')
lq.f('E22', 'IF(%s="","",%s)' % (HK['st.survival'], rag_lo_bad('B22', 'C22', 'D22')), 'txt')
lq.lbl('A25', 'Funding cost stress loss (from the Stress Testing model)'); lq.f('B25', 'N(%s)' % HK['st.risk.5'])
lq.lbl('A26', 'Additional amount set by management'); lq.inp('B26', 'liq.manual', 'Liquidity add-on set by management', None, 'num', 'ALCO decision')
lq.lbl('A27', 'Pillar 2 add-on for liquidity and funding risk', True); lq.f('B27', 'B25+N(B26)', out=True)
lq.rag('B12:D12'); lq.rag('E16:E22')

# ------------------------------------------------------------------ P2 Operational
op = B.sheet('P2_Operational', (58, 16, 16, 16), tab='548235')
op.title('P2_Operational – operational risk (internal estimate)', 'NBFCs have no regulatory capital charge for operational risk. This is the company\'s own estimate on the lines of the Basel basic indicator approach.')
op.head(6, ['Item', 'Y-2', 'Y-1', 'Latest year (Y0)'])
op.lbl('A7', 'Gross income')
for c in 'BCD':
    op.f('%s7' % c, FN('gi', c))
for r, key, lab, fmt in [(8, 'n', 'Number of operational loss events', 'int'), (9, 'gross', 'Gross operational losses (frauds, errors, penalties, system failures)', 'num'), (10, 'rec', 'Recoveries', 'num')]:
    op.lbl('A%d' % r, lab)
    for c, y in zip('BCD', ('y2', 'y1', 'y0')):
        op.inp('%s%d' % (c, r), 'op.%s.%s' % (key, y), '%s – %s' % (lab, y.upper()), None, fmt, 'Operational loss register; fraud reports (FMR)')
op.lbl('A11', 'Net operational loss')
for c in 'BCD':
    op.f('%s11' % c, 'N(%s9)-N(%s10)' % (c, c))
op.lbl('A14', 'Average positive gross income'); op.f('B14', 'IF(COUNTIF(B7:D7,">0")=0,0,SUMIF(B7:D7,">0")/COUNTIF(B7:D7,">0"))')
op.lbl('A15', 'Scaling factor on the basic indicator estimate'); op.inp('B15', 'op.scale', 'Operational risk scaling factor', 1, 'num', 'ICAAP policy')
op.lbl('A16', 'Basic indicator estimate (alpha x average gross income x scaling)'); op.f('B16', '%s*B14*B15' % ST('$B$17'))
op.lbl('A17', 'Average annual net loss (information)'); op.f('B17', 'AVERAGE(B11:D11)'); op.lbl('A18', 'Net loss / gross income (latest year)'); op.f('B18', div('D11', 'D7'), 'pct')
op.lbl('A19', 'Stressed operational loss (from the Stress Testing model)'); op.f('B19', 'N(%s)' % HK['st.risk.6'])
op.lbl('A20', 'Pillar 2 add-on for operational risk', True); op.f('B20', 'MAX(B16,B19)', out=True)

# ------------------------------------------------------------------ P2 Market
mk = B.sheet('P2_Market', (58, 16, 16, 16), tab='548235')
mk.title('P2_Market – investment and currency risk', 'Loss estimate on the investment book and the open currency position.')
mk.head(6, ['Item', 'Value', 'Shock', 'Loss'])
mk.lbl('A7', 'Equity shares and mutual fund units (market value)'); mk.inp('B7', 'mkt.eq', 'Equity and mutual fund investments', None, 'num', 'Investments note; DNBS01 Annex 10'); mk.inp('C7', 'mkt.eq.shock', 'Equity price fall', 0.20, 'pct', 'ICAAP policy'); mk.f('D7', 'N(B7)*C7')
mk.lbl('A8', 'Bonds and debt instruments (market value)'); mk.inp('B8', 'mkt.bond', 'Bond investments', None, 'num', 'Investments note'); mk.inp('C8', 'mkt.bond.bps', 'Rise in yields (basis points)', 200, 'int', 'ICAAP policy')
mk.lbl('A9', 'Modified duration of the bond portfolio (years)'); mk.inp('B9', 'mkt.dur', 'Bond modified duration', None, 'num', 'Treasury MIS'); mk.f('D8', 'N(B8)*N(B9)*C8/10000')
mk.lbl('A10', 'Net open foreign currency position (unhedged)'); mk.inp('B10', 'mkt.fx', 'Net open FX position', None, 'num', 'Treasury MIS; DNBS01 Part 7'); mk.inp('C10', 'mkt.fx.shock', 'Adverse currency move', 0.10, 'pct', 'ICAAP policy'); mk.f('D10', 'ABS(N(B10))*C10')
mk.lbl('A12', 'Total market loss estimate'); mk.f('D12', 'D7+D8+D10'); mk.lbl('A13', 'Pillar 1 capital already held on investments (investment RWA x minimum CRAR)'); mk.f('D13', '%s*%s' % (RWI, MIN))
mk.lbl('A14', 'Pillar 2 add-on for market risk', True); mk.f('D14', 'MAX(0,D12-D13)', out=True)

# ------------------------------------------------------------------ Scorecards
sk = B.sheet('P2_Scorecards', (30, 58, 13, 12, 12, 18, 9, 10, 8, 4, 34, 10, 14, 16, 10), tab='548235')
sk.title('P2_Scorecards – indicator-based assessment of the other risks', 'Enter the value of each indicator; edit indicators, thresholds and weights for the company. Blank indicators are ignored.')
H, L = 'Higher is worse', 'Lower is worse'
SCR = [('Cyber and IT risk', [('Critical / high IT audit and VAPT findings open beyond due date (number)', 2, 5, H), ('Unplanned downtime of core systems in the year (hours)', 8, 24, H), ('Cyber incidents reported to RBI / CERT-In in the year (number)', 1, 3, H),
                               ('Disaster recovery drill: recovery time achieved / target', 1.0, 1.5, H), ('Employees who completed security awareness training (%)', 0.90, 0.75, L)]),
       ('Compliance and legal risk', [('Penalties imposed by regulators in the last 3 years (number)', 1, 2, H), ('Supervisory observations open beyond the committed date (number)', 2, 5, H), ('Regulatory returns filed late in the year (number)', 1, 3, H),
                                       ('Claims and litigation against the company / net worth', 0.01, 0.03, H), ('Compliance tests with adverse result (%)', 0.05, 0.15, H)]),
       ('Reputation risk', [('Customer complaints per 1,000 active loan accounts', 5, 15, H), ('Complaints escalated to the RBI Ombudsman (number)', 5, 20, H), ('Complaints resolved beyond 30 days (%)', 0.05, 0.15, H),
                             ('Adverse media reports in the year (number)', 2, 5, H), ('Credit rating notches downgraded in the last 2 years (number)', 1, 2, H)]),
       ('Strategic and business risk', [('Disbursement achieved against budget (%)', 0.90, 0.75, L), ('Profit after tax achieved against budget (%)', 0.90, 0.70, L), ('Share of the largest product in the loan book', 0.50, 0.70, H),
                                         ('Cost to income ratio', 0.55, 0.70, H), ('Return on assets', 0.015, 0.005, L)]),
       ('Climate and ESG risk', [('Loan book in districts with high flood, drought or cyclone hazard (%)', 0.20, 0.40, H), ('Loan book in carbon-intensive or environmentally sensitive sectors (%)', 0.15, 0.30, H),
                                  ('Secured loans with collateral in high-hazard zones (%)', 0.20, 0.40, H), ('Board-approved climate risk policy in place (1 = yes, 0 = no)', 0.5, 0.5, L), ('Climate scenario analysis carried out in the year (1 = yes, 0 = no)', 0.5, 0.5, L)]),
       ('Model risk', [('Models in use without independent validation in the last 12 months (number)', 1, 3, H), ('ECL backtest ratio (actual / predicted defaults)', 1.2, 1.5, H), ('Management overlay as % of model ECL', 0.10, 0.25, H),
                        ('Credit scorecard Gini / discriminatory power', 0.40, 0.30, L), ('Model changes made without committee approval (number)', 1, 2, H)]),
       ('Outsourcing and third-party risk', [('Material outsourced activities without a due-diligence review in the last 12 months (number)', 1, 3, H), ('Share of collections handled by the largest recovery agency', 0.30, 0.50, H),
                                              ('Share of sourcing from the largest DSA / lending service provider', 0.25, 0.40, H), ('Service-level breaches by material vendors in the year (number)', 3, 8, H), ('Material vendors without a tested exit / continuity plan (number)', 1, 3, H)]),
       ('Conduct and customer protection risk', [('Mis-selling or unfair-practice complaints (number)', 3, 10, H), ('Refunds of excess interest or charges ordered in the year (number)', 5, 20, H), ('Recovery-conduct complaints (number)', 2, 6, H),
                                                  ('Loans disbursed without a Key Facts Statement found in audit samples (%)', 0.01, 0.05, H), ('Grievances pending beyond the board-approved turnaround time (%)', 0.05, 0.15, H)]),
       ('Group and contagion risk', [('Exposure to group companies / Tier 1 capital', 0.10, 0.20, H), ('Borrowings guaranteed by or dependent on the parent or promoters (%)', 0.25, 0.50, H), ('Guarantees given on behalf of group companies / net worth', 0.05, 0.15, H),
                                      ('Related-party transactions not at arm\'s length found by audit (number)', 1, 2, H), ('Shared services without a written agreement (number)', 1, 3, H)]),
       ('Securitisation and co-lending residual risk', [('Securitised and assigned pool outstanding / assets under management', 0.20, 0.35, H), ('Credit enhancement provided / Tier 1 capital', 0.10, 0.20, H), ('Cumulative collection efficiency of sold pools (%)', 0.95, 0.90, L),
                                                         ('First-loss default guarantee invoked in the year / guarantee outstanding', 0.25, 0.50, H), ('Pools with rating downgrade or trigger breach (number)', 1, 2, H)]),
       ('Fraud risk', [('Frauds reported in the year (number)', 3, 10, H), ('Amount involved in frauds / gross loans', 0.001, 0.005, H), ('Frauds involving staff (number)', 1, 3, H),
                       ('Frauds detected more than 12 months after occurrence (%)', 0.25, 0.50, H), ('Accounts red-flagged and pending decision beyond 180 days (number)', 1, 5, H)]),
       ('People and key-person risk', [('Annual attrition – all employees', 0.30, 0.45, H), ('Attrition among senior and key managerial personnel in the year (number)', 1, 3, H), ('Key positions vacant for more than 3 months (number)', 1, 2, H),
                                        ('Critical roles without an identified successor (%)', 0.25, 0.50, H), ('Mandatory training completion (%)', 0.90, 0.75, L)])]
sk.head(6, ['Risk', 'Key risk indicator', 'Value', 'Amber', 'Red', 'Direction', 'Weight', 'RAG', 'Score'])
sk.head(6, ['Risk', 'Score', 'Add-on (% of RWA)', 'Pillar 2 add-on', 'RAG'], col=11)
SKR = {}
for a, (rk, kris) in enumerate(SCR):
    b0 = 7 + 5 * a; sr = 7 + a; SKR[rk] = sr
    for j, (lab, am, rd, d_) in enumerate(kris):
        r = b0 + j; key = 'kri.%d.%d' % (a + 1, j + 1); sk.lbl('A%d' % r, rk)
        sk.inp('B%d' % r, key + '.name', '%s KRI %d' % (rk, j + 1), lab, 'txt', 'Risk register / KRI dashboard'); sk.inp('C%d' % r, key + '.val', '%s – %s' % (rk, lab), None, 'num', 'Risk register / KRI dashboard; MIS')
        sk.inp('D%d' % r, key + '.amber', lab + ' – amber', am, 'num', 'Risk appetite statement'); sk.inp('E%d' % r, key + '.red', lab + ' – red', rd, 'num', 'Risk appetite statement')
        sk.inp('F%d' % r, key + '.dir', lab + ' – direction', d_, 'txt', 'ICAAP policy', [H, L]); sk.inp('G%d' % r, key + '.wt', lab + ' – weight', 1, 'num', 'ICAAP policy')
        sk.f('H%d' % r, 'IF(C{0}="","",IF(F{0}="{1}",{2},{3}))'.format(r, H, rag_hi_bad('C%d' % r, 'D%d' % r, 'E%d' % r), rag_lo_bad('C%d' % r, 'D%d' % r, 'E%d' % r)), 'txt')
        sk.f('I%d' % r, 'IF(H{0}="GREEN",1,IF(H{0}="AMBER",3,IF(H{0}="RED",5,0)))'.format(r), 'int')
    sk.lbl('K%d' % sr, rk); sk.f('L%d' % sr, div('SUMPRODUCT(G%d:G%d,I%d:I%d)' % (b0, b0 + 4, b0, b0 + 4), 'SUMIF(I%d:I%d,">0",G%d:G%d)' % (b0, b0 + 4, b0, b0 + 4)), 'num', out=True)
    sk.f('M%d' % sr, SCORE2ADD('L%d' % sr), 'p4'); sk.f('N%d' % sr, 'M%d*%s' % (sr, RWAT), out=True)
    sk.f('O%d' % sr, 'IF(L{0}=0,"",IF(L{0}>=3.5,"RED",IF(L{0}>=2.5,"AMBER","GREEN")))'.format(sr), 'txt')
sk.rag('H7:H66'); sk.rag('O7:O18')

# ------------------------------------------------------------------ Risk universe
ru = B.sheet('Risk_Universe', (5, 44, 12, 44, 46, 16, 16, 12, 16), tab='2E75B6')
ru.title('Risk_Universe – risks, materiality and capital', 'Mark each risk as material (Yes) or not (No) with the reason. Only material risks are counted in the Aggregation.')
ru.head(6, ['#', 'Risk', 'Material?', 'Reason for the materiality decision', 'How it is assessed', 'Capital assessed', 'Capital counted', 'Share of Pillar 2', 'Manual estimate (last three rows)'])
RU = [('Credit risk – excess of economic capital over Pillar 1', q('P2_Credit', 'B28'), 'Basel single-factor formula by segment (P2_Credit)'), ('Borrower concentration risk', q('P2_Concentration', 'K18'), 'HHI slab (P2_Concentration)'),
      ('Sector concentration risk', q('P2_Concentration', 'K19'), 'HHI slab (P2_Concentration)'), ('Geographic concentration risk', q('P2_Concentration', 'K20'), 'HHI slab (P2_Concentration)'),
      ('Interest rate risk in the banking book', q('P2_IRRBB', 'B27'), 'Fall in EVE / earnings at risk (P2_IRRBB)'), ('Market risk', q('P2_Market', 'D14'), 'Price, yield and currency shocks (P2_Market)'),
      ('Liquidity and funding risk', q('P2_Liquidity', 'B27'), 'Limits, buffers and funding cost stress (P2_Liquidity)'), ('Operational risk', q('P2_Operational', 'B20'), 'Basic indicator estimate / stressed loss (P2_Operational)')]
RU += [(rk, q('P2_Scorecards', 'N%d' % SKR[rk]), 'Key risk indicator scorecard (P2_Scorecards)') for rk, _ in SCR]
RU += [('Pension and employee benefit obligation risk', None, 'Actuarial sensitivity – manual estimate'), ('Settlement and counterparty risk', None, 'Manual estimate'), ('Any other risk identified by the company', None, 'Manual estimate')]
NR = len(RU); RU0 = 7; RUE = RU0 + NR - 1
for j, (rk, src, how) in enumerate(RU):
    r = RU0 + j; ru.lbl('A%d' % r, j + 1); ru.lbl('B%d' % r, rk)
    ru.inp('C%d' % r, 'ru.mat.%d' % (j + 1), rk + ' – material', 'Yes' if src else 'No', 'txt', 'Risk materiality assessment approved by the Risk Management Committee', YN)
    ru.inp('D%d' % r, 'ru.why.%d' % (j + 1), rk + ' – reason', None, 'txt', 'Risk materiality assessment'); ru.lbl('E%d' % r, how)
    if src:
        ru.f('F%d' % r, src)
    else:
        ru.inp('I%d' % r, 'ru.manual.%d' % (j + 1), rk + ' – manual capital estimate', None, 'num', 'Management estimate with working paper'); ru.f('F%d' % r, 'N(I%d)' % r)
    ru.f('G%d' % r, 'IF(C%d="Yes",F%d,0)' % (r, r), out=True); ru.f('H%d' % r, div('G%d' % r, 'G$%d' % (RUE + 1)), 'pct')
ru.lbl('B%d' % (RUE + 1), 'Total (simple sum)', True); ru.f('F%d' % (RUE + 1), 'SUM(F%d:F%d)' % (RU0, RUE), out=True); ru.f('G%d' % (RUE + 1), 'SUM(G%d:G%d)' % (RU0, RUE), out=True)
RUG = "'Risk_Universe'!$G$%d:$G$%d" % (RU0, RUE)

# ------------------------------------------------------------------ Aggregation
ag = B.sheet('Aggregation', (62, 18, 14, 12), tab='00B050')
ag.title('Aggregation – capital required against capital available', 'No inputs.')
ag.head(6, ['Item', 'Amount', '% of RWA', 'RAG'])
agr = [(7, 'Pillar 1 capital requirement (RWA x minimum CRAR)', CA('B$16'), False), (8, 'Pillar 2 add-ons for material risks', 'IF(%s="Simple sum",SUM(%s),SQRT(SUMSQ(%s)))' % (ST('$B$13'), RUG, RUG), False),
       (9, 'Stress capital buffer from the Stress Testing model (fall in capital)', 'N(%s)' % HK['st.buffer'], False),
       (10, 'Stress buffer counted', 'IF(%s="Exclude",0,IF(%s="Add in full",B9,MAX(0,B9-B8)))' % (ST('$B$14'), ST('$B$14')), False), (11, 'Internal capital requirement', 'B7+B8+B10', True),
       (12, 'Management buffer', '%s*%s' % (ST('$B$12'), RWAT), False), (13, 'Internal capital target', 'B11+B12', True), (14, 'Available capital (Tier 1 + eligible Tier 2)', CAPT, True),
       (15, 'Surplus / (deficit) over the internal requirement', 'B14-B11', True), (16, 'Surplus / (deficit) over the internal target', 'B14-B13', False)]
for r, lab, fm, o in agr:
    ag.lbl('A%d' % r, lab, o); ag.f('B%d' % r, fm, out=o); ag.f('C%d' % r, div('B%d' % r, RWAT), 'pct')
ag.lbl('A17', 'Internal capital adequacy ratio (available / required)', True); ag.f('B17', div('B14', 'B11'), 'x', out=True); ag.f('D17', rag_lo_bad('B17', ST('$B$25'), ST('$C$25')), 'txt')
ag.lbl('A18', 'Internal requirement as CRAR equivalent'); ag.f('B18', div('B11', RWAT), 'pct', out=True)
ag.lbl('A19', 'Actual CRAR'); ag.f('B19', CA('B$11'), 'pct', out=True); ag.f('D19', CA('D$11'), 'txt')
ag.f('D16', 'IF(%s,"",IF(B16<0,"AMBER","GREEN"))' % GUARD[0], 'txt'); ag.f('D15', 'IF(%s,"",IF(B15<0,"RED","GREEN"))' % GUARD[0], 'txt')
ag.rag('D7:D20')
AG = lambda c: "'Aggregation'!$%s" % c

# ------------------------------------------------------------------ Capital plan
pl = B.sheet('Capital_Plan', (58, 16, 16, 16, 16), tab='00B050')
pl.title('Capital_Plan – three-year capital projection', 'Enter the growth, profit, dividend and capital-raising assumptions for each year.')
pl.head(6, ['Item', 'Y0 (actual)', 'Y1', 'Y2', 'Y3'])
labs = {7: 'Growth in risk-weighted assets', 8: 'Risk-weighted assets', 9: 'Profit after tax', 10: 'Dividend payout (% of profit)', 11: 'Profit retained', 12: 'Equity and other Tier 1 raised', 13: 'Tier 2 raised (net of amortisation and redemption)',
        14: 'Tier 1 capital', 15: 'Tier 2 capital before the cap', 16: 'Eligible Tier 2 capital', 17: 'Total capital funds', 18: 'CRAR', 19: 'CRAR result', 20: 'Tier 1 ratio', 21: 'Tier 1 result', 22: 'Internal requirement (% of RWA, held at the Y0 level)',
        23: 'Internal capital requirement', 24: 'Surplus / (deficit) over the internal requirement', 25: 'CRAR under the planning stress scenario', 26: 'Stressed CRAR result', 27: 'Capital to be raised to keep CRAR at minimum + management buffer'}
for r, lab in labs.items():
    pl.lbl('A%d' % r, lab, r in (14, 17, 18, 20))
pl.f('B8', RWAT); pl.f('B9', FN('pat')); pl.f('B14', T1); pl.f('B15', CP(35)); pl.f('B22', AG('B$18'), 'pct')
DROP = 'MAX(0,N(%s)-IF(%s="Adverse",N(%s),N(%s)))' % (HK['st.crar_pre'], HK['st.scenario'], HK['st.crar_adv'], HK['st.crar_sev'])
for j, c in enumerate('BCDE'):
    p_ = chr(ord(c) - 1)
    if j:
        pl.inp('%s7' % c, 'plan.g.%d' % j, 'RWA growth Y%d' % j, None, 'pct', 'Business plan'); pl.f('%s8' % c, '%s8*(1+N(%s7))' % (p_, c))
        pl.inp('%s9' % c, 'plan.pat.%d' % j, 'Profit after tax Y%d' % j, None, 'num', 'Business plan'); pl.inp('%s10' % c, 'plan.div.%d' % j, 'Dividend payout Y%d' % j, 0, 'pct', 'Dividend policy')
        pl.f('%s11' % c, 'N(%s9)*(1-N(%s10))' % (c, c)); pl.inp('%s12' % c, 'plan.eq.%d' % j, 'Equity raised Y%d' % j, None, 'num', 'Capital raising plan'); pl.inp('%s13' % c, 'plan.t2.%d' % j, 'Tier 2 raised Y%d' % j, None, 'num', 'Capital raising plan')
        pl.f('%s14' % c, '%s14+%s11+N(%s12)' % (p_, c, c)); pl.f('%s15' % c, 'MAX(0,%s15+N(%s13))' % (p_, c)); pl.f('%s22' % c, '$B$22', 'pct')
    pl.f('%s16' % c, 'MAX(0,MIN(%s15,%s14))' % (c, c)); pl.f('%s17' % c, '%s14+%s16' % (c, c), out=True); pl.f('%s18' % c, div('%s17' % c, '%s8' % c), 'pct', out=True)
    pl.f('%s19' % c, rag_lo_bad('%s18' % c, ST('$B$23'), ST('$C$23')), 'txt'); pl.f('%s20' % c, div('%s14' % c, '%s8' % c), 'pct', out=True); pl.f('%s21' % c, rag_lo_bad('%s20' % c, ST('$B$24'), ST('$C$24')), 'txt')
    pl.f('%s23' % c, '%s22*%s8' % (c, c)); pl.f('%s24' % c, '%s17-%s23' % (c, c), out=True); pl.f('%s25' % c, '%s18-%s' % (c, DROP), 'pct')
    pl.f('%s26' % c, 'IF(%s,"",IF(%s25<%s,"RED",IF(%s25<%s+%s,"AMBER","GREEN")))' % (GUARD[0], c, MIN, c, MIN, ST('$B$12')), 'txt'); pl.f('%s27' % c, 'MAX(0,(%s+%s)*%s8-%s17)' % (MIN, ST('$B$12'), c, c), out=True)
pl.rag('B19:E26')

# ------------------------------------------------------------------ Risk appetite
ra = B.sheet('Risk_Appetite', (52, 14, 14, 14, 18, 10, 40), tab='00B050')
ra.title('Risk_Appetite – limits and actuals', 'Actuals come from the model; triggers and limits are inputs.')
ra.head(6, ['Metric', 'Actual', 'Amber trigger', 'Red limit', 'Direction', 'RAG', 'Source of the actual'])
ram = [('CRAR', CA('B$11'), 0.17, 0.15, L, 'pct', 'Capital_Adequacy'), ('Tier 1 ratio', CA('B$12'), 0.115, 0.10, L, 'pct', 'Capital_Adequacy'), ('Internal capital adequacy ratio', AG('B$17'), 1.15, 1.0, L, 'x', 'Aggregation'),
       ('Leverage (outside liabilities / owned fund)', CA('B$14'), 5.5, 7, H, 'x', 'Capital_Adequacy'), ('Gross Stage 3 / gross loans', div('N(%s)' % HK['ecl.s3'], 'N(%s)' % HK['ecl.gross']), 0.03, 0.05, H, 'pct', 'In_Handover (ECL)'),
       ('Net Stage 3 %', div('N(%s)-N(%s)' % (HK['ecl.s3'], HK['ecl.ecl3']), 'N(%s)-N(%s)' % (HK['ecl.gross'], HK['ecl.ecl3'])), 0.015, 0.03, H, 'pct', 'In_Handover (ECL)'),
       ('Largest borrower / Tier 1', q('P2_Concentration', 'K7'), 0.20, 0.25, H, 'pct', 'P2_Concentration'), ('Top 20 borrowers / gross loans', q('P2_Concentration', 'K8'), 0.20, 0.30, H, 'pct', 'P2_Concentration'),
       ('Largest sector share', q('P2_Concentration', 'K12'), 0.25, 0.35, H, 'pct', 'P2_Concentration'), ('Largest state share', q('P2_Concentration', 'K13'), 0.40, 0.55, H, 'pct', 'P2_Concentration'),
       ('Fall in EVE / Tier 1', q('P2_IRRBB', 'B23'), 0.10, 0.15, H, 'pct', 'P2_IRRBB'), ('Stressed liquidity survival horizon (days)', 'N(%s)' % HK['st.survival'], 90, 30, L, 'int', 'In_Handover (Stress)'),
       ('Post-stress CRAR – Severe', 'N(%s)' % HK['st.crar_sev'], 0.15, 0.12, L, 'pct', 'In_Handover (Stress)'), ('Return on assets', FN('roa'), 0.015, 0.005, L, 'pct', 'In_Financials'),
       ('Cost to income', FN('ci'), 0.55, 0.70, H, 'pct', 'In_Financials')]
for j, (lab, fm, a, rd, d_, fmt, src) in enumerate(ram):
    r = 7 + j; ra.lbl('A%d' % r, lab); ra.f('B%d' % r, fm, fmt, out=True)
    ra.inp('C%d' % r, 'ra.amber.%d' % (j + 1), lab + ' – amber trigger', a, fmt, 'Risk appetite statement'); ra.inp('D%d' % r, 'ra.red.%d' % (j + 1), lab + ' – red limit', rd, fmt, 'Risk appetite statement')
    ra.inp('E%d' % r, 'ra.dir.%d' % (j + 1), lab + ' – direction', d_, 'txt', 'Risk appetite statement', [H, L])
    ra.f('F%d' % r, 'IF(E{0}="{1}",{2},{3})'.format(r, H, rag_hi_bad('B%d' % r, 'C%d' % r, 'D%d' % r), rag_lo_bad('B%d' % r, 'C%d' % r, 'D%d' % r)), 'txt'); ra.lbl('G%d' % r, src)
RAE = 6 + len(ram); ra.rag('F7:F%d' % RAE)

# ------------------------------------------------------------------ Dashboard
db = B.sheet('Dashboard', (58, 18, 12, 14), tab='00B050')
db.title('Dashboard – ICAAP results', 'RAG against the thresholds on Setup.')
db.f('A3', '"Company: "&%s&"   |   As at: "&TEXT(%s,"DD-MMM-YYYY")&"   |   Amounts in "&%s&"   |   "&%s' % (ST('B4'), ST('B5'), ST('B6'), ST('B7')), 'txt')
db.head(5, ['Result', 'Value', 'RAG'])
dk = [('CRAR', CA('B$11'), 'pct', CA('D$11')), ('Tier 1 ratio', CA('B$12'), 'pct', CA('D$12')), ('Total capital funds', CAPT, 'num', None), ('Risk-weighted assets', RWAT, 'num', None),
      ('Pillar 1 capital requirement', AG('B$7'), 'num', None), ('Pillar 2 add-ons', AG('B$8'), 'num', None), ('Stress buffer counted', AG('B$10'), 'num', None), ('Internal capital requirement', AG('B$11'), 'num', None),
      ('Internal capital adequacy ratio', AG('B$17'), 'x', AG('D$17')), ('Surplus / (deficit) over the internal requirement', AG('B$15'), 'num', AG('D$15')), ('Surplus / (deficit) over the internal target', AG('B$16'), 'num', AG('D$16')),
      ('Internal requirement as CRAR equivalent', AG('B$18'), 'pct', None), ('Lowest projected CRAR over three years', "MIN('Capital_Plan'!C18:E18)", 'pct', rag_lo_bad('B18', ST('$B$23'), ST('$C$23'))),
      ('Lowest stressed CRAR over three years', "MIN('Capital_Plan'!C25:E25)", 'pct', 'IF(%s,"",IF(B19<%s,"RED",IF(B19<%s+%s,"AMBER","GREEN")))' % (GUARD[0], MIN, MIN, ST('$B$12'))),
      ('Risk appetite metrics in red (number)', 'COUNTIF(%s,"RED")' % q('Risk_Appetite', 'F7:F%d' % RAE), 'int', 'IF(%s,"",IF(B20>0,"RED","GREEN"))' % GUARD[0]),
      ('Risk appetite metrics in amber (number)', 'COUNTIF(%s,"AMBER")' % q('Risk_Appetite', 'F7:F%d' % RAE), 'int', 'IF(%s,"",IF(B21>2,"AMBER","GREEN"))' % GUARD[0]),
      ('Open items on the Checks sheet', 'COUNTIF(%s,"CHECK")' % q('Checks', 'C6:C18'), 'int', 'IF(B22=0,"OK","CHECK")')]
for j, (lab, fm, fmt, rg) in enumerate(dk):
    r = 6 + j; db.lbl('A%d' % r, lab); db.f('B%d' % r, fm, fmt, out=True)
    if rg: db.f('C%d' % r, rg, 'txt')
db.rag('C6:C22')
db.head(25, ['Pillar 2 capital by risk', 'Capital counted', 'Material?', 'Share'])
for j in range(NR):
    r = 26 + j; rr = RU0 + j
    db.f('A%d' % r, q('Risk_Universe', 'B%d' % rr), 'txt'); db.f('B%d' % r, q('Risk_Universe', 'G%d' % rr)); db.f('C%d' % r, q('Risk_Universe', 'C%d' % rr), 'txt'); db.f('D%d' % r, q('Risk_Universe', 'H%d' % rr), 'pct')

# ------------------------------------------------------------------ Doc tables
dt = B.sheet('Doc_Tables', (56, 16, 16, 16, 16), tab='7030A0')
dt.title('Doc_Tables – tables for the ICAAP document', 'No inputs. Copy each table into the matching section of the ICAAP document.')
dt.f('A3', q('Dashboard', 'A3'), 'txt')
dt.sec('A5', 'Table 1 – Summary of financial position (ICAAP document section 3)', 4); dt.head(6, ['Item', 'Y-2', 'Y-1', 'Y0'])
t1 = [('Total assets', 'assets', 'num'), ('Gross loans', 'loans', 'num'), ('Borrowings', 'borr', 'num'), ('Net worth', 'nw', 'num'), ('Net interest income', 'nii', 'num'), ('Pre-provision operating profit', 'ppop', 'num'),
      ('Profit after tax', 'pat', 'num'), ('Return on assets', 'roa', 'pct'), ('Return on equity', 'roe', 'pct'), ('Cost to income', 'ci', 'pct'), ('Gross NPA %', 'gn', 'pct'), ('Net NPA %', 'nn', 'pct'), ('Debt to equity', 'de', 'x')]
for j, (lab, key, fmt) in enumerate(t1):
    r = 7 + j; dt.lbl('A%d' % r, lab)
    for c in 'BCD':
        dt.f('%s%d' % (c, r), FN(key, c), fmt)
dt.sec('A22', 'Table 2 – Capital position (section 3)', 3); dt.head(23, ['Item', 'Actual', 'Minimum'])
for j, (lab, fm, fmt, mn) in enumerate([('Tier 1 capital', T1, 'num', None), ('Eligible Tier 2 capital', T2E, 'num', None), ('Total capital funds', CAPT, 'num', None), ('Risk-weighted assets', RWAT, 'num', None),
                                        ('CRAR', CA('B$11'), 'pct', MIN), ('Tier 1 ratio', CA('B$12'), 'pct', ST('$B$9')), ('Leverage', CA('B$14'), 'x', None)]):
    r = 24 + j; dt.lbl('A%d' % r, lab); dt.f('B%d' % r, fm, fmt)
    if mn: dt.f('C%d' % r, mn, 'pct')
dt.sec('A33', 'Table 3 – Risks assessed and internal capital (section 4)', 4); dt.head(34, ['Risk', 'Material?', 'Capital assessed', 'Capital counted'])
for j in range(NR):
    r = 35 + j; rr = RU0 + j
    dt.f('A%d' % r, q('Risk_Universe', 'B%d' % rr), 'txt'); dt.f('B%d' % r, q('Risk_Universe', 'C%d' % rr), 'txt'); dt.f('C%d' % r, q('Risk_Universe', 'F%d' % rr)); dt.f('D%d' % r, q('Risk_Universe', 'G%d' % rr))
r0 = 35 + NR + 2
dt.sec('A%d' % r0, 'Table 4 – Stress test results (section 5)', 2); dt.head(r0 + 1, ['Item', 'Value'])
for j, (lab, key, fmt) in enumerate([('Planning scenario', 'st.scenario', 'txt'), ('Pre-stress CRAR', 'st.crar_pre', 'pct'), ('Post-stress CRAR – Baseline', 'st.crar_base', 'pct'), ('Post-stress CRAR – Adverse', 'st.crar_adv', 'pct'),
                                     ('Post-stress CRAR – Severe', 'st.crar_sev', 'pct'), ('Total stress loss – planning scenario', 'st.loss', 'num'), ('Stress capital buffer', 'st.buffer', 'num'),
                                     ('Liquidity survival horizon – Severe (days)', 'st.survival', 'int'), ('Reverse stress loss that breaks the minimum', 'st.reverse', 'num'), ('CRAR after management actions – Severe', 'st.crar_actions', 'pct')]):
    r = r0 + 2 + j; dt.lbl('A%d' % r, lab); dt.f('B%d' % r, 'IF(%s="","",%s)' % (HK[key], HK[key]), fmt)
r1 = r0 + 14
dt.sec('A%d' % r1, 'Table 5 – Aggregation: capital required against available (section 6)', 3); dt.head(r1 + 1, ['Item', 'Amount', '% of RWA'])
for j, ar in enumerate([7, 8, 10, 11, 12, 13, 14, 15, 16]):
    r = r1 + 2 + j; dt.f('A%d' % r, q('Aggregation', 'A%d' % ar), 'txt'); dt.f('B%d' % r, q('Aggregation', 'B%d' % ar)); dt.f('C%d' % r, q('Aggregation', 'C%d' % ar), 'pct')
r2 = r1 + 13
dt.sec('A%d' % r2, 'Table 6 – Capital plan (section 3 and section 5)', 5); dt.head(r2 + 1, ['Item', 'Y0', 'Y1', 'Y2', 'Y3'])
for j, pr in enumerate([8, 9, 14, 16, 17, 18, 20, 23, 24, 25, 27]):
    r = r2 + 2 + j; dt.f('A%d' % r, q('Capital_Plan', 'A%d' % pr), 'txt')
    for c in 'BCDE':
        dt.f('%s%d' % (c, r), q('Capital_Plan', '%s%d' % (c, pr)), 'pct' if pr in (18, 20, 25) else 'num')

# ------------------------------------------------------------------ Checks
ck = B.sheet('Checks', (6, 76, 12, 54), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results')
ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
chk = [('Tier 1 capital and RWA are positive', 'AND(%s>0,%s>0)' % (T1, RWAT), 'Complete In_Capital and In_RWA'),
       ('On-balance sheet items in In_RWA agree with total assets in In_Financials (within 2%)', 'ABS(%s-N(%s))<=0.02*MAX(1,N(%s))' % ("'In_RWA'!$B$25", FN('assets'), FN('assets')), 'Reconcile In_RWA with the balance sheet (provisions, deducted items)'),
       ('Net worth in In_Financials is within 10% of owned fund', 'ABS(N(%s)-%s)<=0.1*MAX(1,N(%s))' % (FN('nw'), CP(20), FN('nw')), 'Explain the difference (revaluation reserve, intangibles, losses)'),
       ('Gross loans in the ECL hand-over agree with In_Financials (within 2%)', 'ABS(N(%s)-N(%s))<=0.02*MAX(1,N(%s))' % (HK['ecl.gross'], FN('loans'), FN('loans')), 'Use the same reporting date in all three models'),
       ('ECL hand-over figures are entered', 'N(%s)>0' % HK['ecl.gross'], 'Fill In_Handover from the ECL model'), ('Stress hand-over figures are entered', 'N(%s)>0' % HK['st.crar_pre'], 'Fill In_Handover from the Stress Testing model'),
       ('Pre-stress CRAR in the Stress model agrees with this model (within 0.5 percentage point)', 'ABS(N(%s)-%s)<=0.005' % (HK['st.crar_pre'], CA('B$11')), 'Use the same capital and RWA in both models'),
       ('Every material scorecard risk has at least one indicator filled', 'SUMPRODUCT((%s="Yes")*(%s=0))=0' % (q('Risk_Universe', 'C15:C26'), q('P2_Scorecards', 'L7:L18')), 'Fill the indicators or mark the risk as not material with the reason'),
       ('A reason is recorded for every risk marked not material', 'SUMPRODUCT((%s="No")*(%s=""))=0' % (q('Risk_Universe', 'C%d:C%d' % (RU0, RUE)), q('Risk_Universe', 'D%d:D%d' % (RU0, RUE))), 'Record the reason on Risk_Universe'),
       ('Top-20 borrowers, sectors and states are entered', 'AND(COUNT(%s)>0,COUNT(%s)>0,COUNT(%s)>0)' % (q('P2_Concentration', 'B7:B26'), q('P2_Concentration', 'E7:E16'), q('P2_Concentration', 'H7:H16')), 'Complete P2_Concentration'),
       ('Repricing buckets are entered', "SUM('P2_IRRBB'!B7:C16)>0", 'Complete P2_IRRBB'),
       ('Capital plan assumptions are entered for three years', "COUNT('Capital_Plan'!C7:E7)=3", 'Enter growth, profit and capital raising'),
       ('Three years of financials are entered', 'COUNT(%s)=3' % q('In_Financials', 'B7:D7'), 'Complete In_Financials')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C18')

source_map(B)
order = ['ReadMe', 'Method Notes', 'Setup', 'In_Financials', 'In_Capital', 'In_RWA', 'In_Handover', 'Capital_Adequacy', 'Risk_Universe', 'P2_Credit', 'P2_Concentration', 'P2_IRRBB', 'P2_Liquidity', 'P2_Operational', 'P2_Market',
         'P2_Scorecards', 'Aggregation', 'Capital_Plan', 'Risk_Appetite', 'Dashboard', 'Doc_Tables', 'Checks', 'Source Map']
B.wb._sheets = [B.wb[n] for n in order]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('ICAAP model built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
