"""Asset Liability Management and Liquidity Model. Run: python3 build_alm.py <out.xlsx> <map.json>"""
import sys
from xl import *

B = Book('ALM-M01', 'Asset Liability Management and Liquidity Model')
YN = ['Yes', 'No']; AD = 'RBI (NBFCs – Asset Liability Management) Directions, 2025'
BUCK = ['1 to 7 days', '8 to 14 days', '15 to 30/31 days', 'Over 1 month to 2 months', 'Over 2 months to 3 months', 'Over 3 months to 6 months', 'Over 6 months to 1 year', 'Over 1 year to 3 years', 'Over 3 years to 5 years', 'Over 5 years']
MID = [0.01, 0.03, 0.06, 0.125, 0.21, 0.375, 0.75, 2.0, 4.0, 7.0]; CL = 'BCDEFGHIJK'
OUT = ['Equity and reserves', 'Borrowings from banks', 'Debentures and bonds', 'Commercial paper', 'Inter-corporate deposits', 'Public deposits', 'Subordinated debt', 'Interest payable', 'Statutory dues and provisions', 'Undrawn commitments to customers expected to be drawn', 'Other outflows']
INF = ['Cash and bank balances', 'Liquid investments', 'Loan collections – principal (performing)', 'Loan collections – interest (performing)', 'Non-performing loans (net of provisions)', 'Other investments', 'Committed lines of credit available', 'Fixed assets and other assets', 'Other inflows']

readme(B, 'Asset Liability Management and Liquidity Model',
       ['This workbook builds the structural liquidity statement and the interest rate sensitivity statement, tests the cumulative mismatches against the regulatory and internal limits, computes the Liquidity Coverage Ratio where it applies, and shows funding concentration and liquidity ratios with Red / Amber / Green results.',
        'The time buckets follow the RBI statements (DNBS04B). Figures are entered once and feed the Stress Testing, ICAAP and Ratio models through the Handover sheet.'],
       ['Setup: enter the company, the date and the limits.', 'Liquidity Input: enter cash outflows and inflows by time bucket. Follow the placement rules in Method Notes.', 'Rate Input: enter rate-sensitive assets and liabilities by repricing bucket.',
        'Coverage Input: enter the liquid assets and 30-day cash flows for the Liquidity Coverage Ratio (if it applies) and the funding profile.', 'Read Structural Liquidity, Rate Sensitivity, Coverage Ratio and Dashboard. Clear the Checks sheet.'],
       [('Method Notes', 'explains every formula and the bucket placement rules'), ('Setup', 'limits and options'), ('Liquidity Input', 'outflows and inflows by bucket'), ('Rate Input', 'repricing gaps'), ('Coverage Input', 'liquid assets, 30-day flows and funding profile'),
        ('Structural Liquidity', 'mismatches against limits'), ('Rate Sensitivity', 'gap, earnings and economic value effect'), ('Coverage Ratio', 'Liquidity Coverage Ratio and liquidity ratios'), ('Dashboard', 'summary'), ('Handover', 'figures for other models'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Setup', (66, 16, 16, 16, 44), tab='C00000')
s.title('Setup – limits and options', 'Yellow cells are inputs.')
for r, lab, key, d, fmt, lst in [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None), (5, 'Statement date', 'setup.date', None, 'date', None), (6, 'Amounts are in', 'setup.units', '₹ crore', 'txt', ['₹ crore', '₹ lakh', '₹']),
                                (7, 'Liquidity Coverage Ratio applies', 'setup.lcr', 'No', 'txt', YN), (8, 'Minimum Liquidity Coverage Ratio', 'setup.lcrmin', 1.0, 'pct', None), (9, 'Stress factor on outflows for the coverage ratio', 'setup.outf', 1.15, 'pct', None),
                                (10, 'Stress factor on inflows for the coverage ratio', 'setup.inf', 0.75, 'pct', None), (11, 'Cap on inflows as a share of stressed outflows', 'setup.incap', 0.75, 'pct', None), (12, 'Interest rate shock (basis points)', 'setup.bps', 200, 'int', None),
                                (13, 'Tier 1 capital (for the economic value test)', 'setup.t1', None, 'num', None), (14, 'Net interest income of the last 12 months', 'setup.nii', None, 'num', None), (15, 'Total assets', 'setup.ta', None, 'num', None)]:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, d, fmt, AD + '; ALM policy' if r >= 7 else 'Company', lst)
s.lbl('E7', AD + ', Chapter III: deposit-taking NBFCs, and non-deposit taking NBFCs with assets of ₹5,000 crore and above'); s.lbl('E8', AD + ', para 62'); s.lbl('E9', AD + ', para 76: outflows x 115 per cent'); s.lbl('E10', AD + ', para 76: inflows x 75 per cent'); s.lbl('E11', AD + ', para 76: inflows capped at 75 per cent of stressed outflows');
s.head(17, ['Limit on cumulative negative mismatch (% of cumulative outflows)', 'Regulatory', 'Internal trigger', '', 'Reference'])
LIM = [(0.10, 0.07), (0.10, 0.07), (0.20, 0.15), (None, 0.20), (None, 0.20), (None, 0.20), (None, 0.25), (None, None), (None, None), (None, None)]
for i, bk in enumerate(BUCK):
    r = 18 + i; s.lbl('A%d' % r, bk)
    s.inp('B%d' % r, 'limit.reg.%d' % (i + 1), bk + ' – regulatory limit', LIM[i][0], 'pct', AD + ', para 39'); s.inp('C%d' % r, 'limit.int.%d' % (i + 1), bk + ' – internal trigger', LIM[i][1], 'pct', 'ALM policy; Board-approved limits')
    if i < 3: s.lbl('E%d' % r, AD + ', para 39')
s.head(30, ['Other thresholds', 'Amber', 'Red'])
TH = [('Fall in economic value / Tier 1: amber from / red from', 'thr.eve', 0.10, 0.15, 'pct'), ('Earnings at risk / net interest income: amber from / red from', 'thr.ear', 0.10, 0.20, 'pct'), ('Share of the ten largest lenders: amber from / red from', 'thr.top10', 0.60, 0.80, 'pct'),
      ('Borrowings due within 12 months: amber from / red from', 'thr.st', 0.40, 0.55, 'pct'), ('Liquid assets to total assets: amber below / red below', 'thr.liq', 0.05, 0.03, 'pct'), ('Liquidity Coverage Ratio: amber below (red below the minimum)', 'thr.lcr', 1.10, 1.00, 'pct')]
for j, (lab, key, a, rd, fmt) in enumerate(TH):
    r = 31 + j; s.lbl('A%d' % r, lab); s.inp('B%d' % r, key + '.amber', lab + ' – amber', a, fmt, 'Risk appetite statement'); s.inp('C%d' % r, key + '.red', lab + ' – red', rd, fmt, 'Risk appetite statement')
ST = lambda c: q('Setup', c)
G0 = "N('Liquidity Input'!$L$%d)=0" % (6 + len(OUT))

li = B.sheet('Liquidity Input', (46,) + (13,) * 11, tab='BF9000')
li.title('Liquidity Input – cash flows by residual maturity', 'Enter each item in the bucket in which the cash is expected to move. Source: DNBS04B structural liquidity statement.')
li.head(5, ['A. Outflows'] + BUCK + ['Total'])
O0 = 6
for j, it in enumerate(OUT):
    r = O0 + j; li.lbl('A%d' % r, it)
    for i, c in enumerate(CL):
        li.inp('%s%d' % (c, r), 'liq.out.%d.%d' % (j + 1, i + 1), '%s – %s' % (it, BUCK[i]), None, 'num', 'DNBS04B structural liquidity – outflows; ALM statement')
    li.f('L%d' % r, 'SUM(B%d:K%d)' % (r, r))
OT = O0 + len(OUT); li.lbl('A%d' % OT, 'Total outflows', True)
I0 = OT + 3; li.head(I0 - 1, ['B. Inflows'] + BUCK + ['Total'])
for j, it in enumerate(INF):
    r = I0 + j; li.lbl('A%d' % r, it)
    for i, c in enumerate(CL):
        li.inp('%s%d' % (c, r), 'liq.in.%d.%d' % (j + 1, i + 1), '%s – %s' % (it, BUCK[i]), None, 'num', 'DNBS04B structural liquidity – inflows; ALM statement')
    li.f('L%d' % r, 'SUM(B%d:K%d)' % (r, r))
IT = I0 + len(INF); li.lbl('A%d' % IT, 'Total inflows', True)
for c in CL + 'L':
    li.f('%s%d' % (c, OT), 'SUM(%s%d:%s%d)' % (c, O0, c, OT - 1), out=True); li.f('%s%d' % (c, IT), 'SUM(%s%d:%s%d)' % (c, I0, c, IT - 1), out=True)
LQ = lambda c, r: "'Liquidity Input'!%s%d" % (c, r)

ri = B.sheet('Rate Input', (46,) + (13,) * 11, tab='BF9000')
ri.title('Rate Input – rate-sensitive assets and liabilities by repricing bucket', 'Place each item in the bucket in which its interest rate is next reset or it matures, whichever is earlier. Source: DNBS04B interest rate sensitivity statement.')
ri.head(5, ['Item'] + BUCK + ['Total'])
for r, lab, key in [(6, 'Rate-sensitive assets', 'rsa'), (7, 'Rate-sensitive liabilities', 'rsl')]:
    ri.lbl('A%d' % r, lab)
    for i, c in enumerate(CL):
        ri.inp('%s%d' % (c, r), 'rate.%s.%d' % (key, i + 1), '%s – %s' % (lab, BUCK[i]), None, 'num', 'DNBS04B interest rate sensitivity statement')
    ri.f('L%d' % r, 'SUM(B%d:K%d)' % (r, r))

ci = B.sheet('Coverage Input', (64, 16, 14, 16, 40), tab='BF9000')
ci.title('Coverage Input – liquid assets, 30-day cash flows and funding profile', 'Sections A and B are needed only where the Liquidity Coverage Ratio applies. Section C is for every company.')
ci.head(5, ['A. High quality liquid assets', 'Market value', 'Haircut', 'Value counted', 'Note'])
HQ = [('Cash on hand and demand deposits with scheduled commercial banks (para 68(1))', 0), ('Government securities (para 68(2))', 0), ('Marketable securities of foreign sovereigns with a zero risk weight (para 68(3))', 0), ('Securities of sovereigns, PSEs and MDBs with a 20 per cent risk weight, and bonds and CP rated AA- or above (para 69)', 0.15), ('Sovereign securities rated BBB- or above, Nifty or Sensex shares, and debt rated A+ to BBB- (para 70)', 0.50)]
for j, (lab, h) in enumerate(HQ):
    r = 6 + j; ci.lbl('A%d' % r, lab); ci.inp('B%d' % r, 'hqla.amt.%d' % (j + 1), lab, None, 'num', 'Liquidity Coverage Ratio statement; treasury MIS'); ci.inp('C%d' % r, 'hqla.cut.%d' % (j + 1), lab + ' – haircut', h, 'pct', AD + ', Chapter III (classification of assets for HQLA)'); ci.f('D%d' % r, 'N(B%d)*(1-C%d)' % (r, r))
ci.lbl('A11', 'Deposit-taking NBFC: approved securities held under section 45-IB of the RBI Act and included above (Market value) and the required holding (Haircut column) – only 80 per cent of the required holding counts (para 71)')
ci.inp('B11', 'hqla.ib.held', 'Approved securities held under section 45-IB and included in the classes above', None, 'num', AD + ', para 71'); ci.inp('C11', 'hqla.ib.req', 'Approved securities required to be held under section 45-IB', None, 'num', AD + ', para 71')
ci.f('D11', '-0.2*MIN(N(B11),N(C11))'); ci.ws['C11'].number_format = F['num']
ci.lbl('A12', 'Total high quality liquid assets', True); ci.f('D12', 'SUM(D6:D11)', out=True)
ci.lbl('E6', 'Assets must be unencumbered, valued at no more than market value and held on the first day of the stress period (paras 67 and 72). Issuers that are banks, financial institutions or NBFCs, or their affiliates, are excluded from the 15 and 50 per cent classes (paras 69 and 70).')
ci.head(13, ['B. Cash flows over the next 30 days', 'Amount'])
for r, lab, key in [(14, 'Contractual and expected cash outflows in the next 30 days', 'lcr.out'), (15, 'Contractual and expected cash inflows in the next 30 days', 'lcr.in')]:
    ci.lbl('A%d' % r, lab); ci.inp('B%d' % r, key, lab, None, 'num', 'Liquidity Coverage Ratio statement')
ci.head(18, ['C. Funding profile', 'Amount'])
FP = [('Total borrowings', 'fund.total'), ('Borrowings from the ten largest lenders', 'fund.top10'), ('Borrowings due within 12 months', 'fund.st'), ('Commercial paper outstanding', 'fund.cp'), ('Borrowings from banks', 'fund.bank'), ('Unencumbered liquid assets', 'fund.liq'), ('Undrawn committed lines available', 'fund.lines'), ('Repayments due in the next 3 months', 'fund.rep3')]
FR = {}
for j, (lab, key) in enumerate(FP):
    r = 19 + j; FR[key] = "N('Coverage Input'!$B$%d)" % r; ci.lbl('A%d' % r, lab); ci.inp('B%d' % r, key, lab, None, 'num', 'Borrowing register; treasury MIS; DNBS01 Part 1')

sl = B.sheet('Structural Liquidity', (46,) + (13,) * 10, tab='2E75B6')
sl.title('Structural Liquidity – mismatches against limits', 'No inputs. A negative mismatch means outflows exceed inflows in the bucket.')
sl.head(5, ['Item'] + BUCK)
lab = ['Outflows', 'Inflows', 'Mismatch (inflows less outflows)', 'Cumulative outflows', 'Cumulative mismatch', 'Cumulative mismatch as % of cumulative outflows', 'Regulatory limit on negative mismatch', 'Internal trigger', 'Result']
for j, x in enumerate(lab): sl.lbl('A%d' % (6 + j), x, j in (4, 5, 8))
for i, c in enumerate(CL):
    sl.f('%s6' % c, LQ(c, OT)); sl.f('%s7' % c, LQ(c, IT)); sl.f('%s8' % c, '%s7-%s6' % (c, c)); sl.f('%s9' % c, 'SUM($B6:%s6)' % c); sl.f('%s10' % c, 'SUM($B8:%s8)' % c, out=True)
    sl.f('%s11' % c, div('%s10' % c, '%s9' % c), 'pct', out=True); sl.f('%s12' % c, 'IF(%s="","",%s)' % (ST('B%d' % (18 + i)), ST('B%d' % (18 + i))), 'pct'); sl.f('%s13' % c, 'IF(%s="","",%s)' % (ST('C%d' % (18 + i)), ST('C%d' % (18 + i))), 'pct')
    sl.f('%s14' % c, 'IF({g},"",IF(IF({c}12="",FALSE,{c}11<-{c}12),"RED",IF(IF({c}13="",FALSE,{c}11<-{c}13),"AMBER",IF(AND({c}12="",{c}13=""),"No limit","GREEN"))))'.format(g=G0, c=c), 'txt')
sl.rag('B14:K14')
sl.lbl('A16', 'Funding needed to bring every regulated bucket within its limit'); sl.f('B16', 'MAX(0,' + ','.join('IF(%s12="",0,-%s10-%s12*%s9)' % (c, c, c, c) for c in CL[:3]) + ')', out=True)

rs = B.sheet('Rate Sensitivity', (46,) + (13,) * 11, tab='2E75B6')
rs.title('Rate Sensitivity – gap, earnings and economic value effect', 'No inputs. Shock size is on Setup.')
rs.head(5, ['Item'] + BUCK + ['Total'])
labs = ['Rate-sensitive assets', 'Rate-sensitive liabilities', 'Gap', 'Cumulative gap', 'Gap as % of rate-sensitive assets', 'Mid-point of the bucket (years)', 'Change in net interest income for a rise in rates (12 months)', 'Change in economic value for a rise in rates']
for j, x in enumerate(labs): rs.lbl('A%d' % (6 + j), x)
SH = '%s/10000' % ST('$B$12')
for i, c in enumerate(CL):
    rs.f('%s6' % c, "N('Rate Input'!%s6)" % c); rs.f('%s7' % c, "N('Rate Input'!%s7)" % c); rs.f('%s8' % c, '%s6-%s7' % (c, c), out=True); rs.f('%s9' % c, 'SUM($B8:%s8)' % c); rs.f('%s10' % c, div('%s8' % c, '%s6' % c), 'pct')
    rs.f('%s11' % c, str(MID[i]), 'num'); rs.f('%s12' % c, ('%s8*%s*(1-%s11)' % (c, SH, c)) if MID[i] < 1 else '0'); rs.f('%s13' % c, '-%s8*%s11*%s' % (c, c, SH))
for r in (6, 7, 8, 12, 13): rs.f('L%d' % r, 'SUM(B%d:K%d)' % (r, r), out=True)
rs.head(16, ['Result', 'Value', 'Result'])
for r, lab_, fm, fmt, th in [(17, 'Earnings at risk in the worse direction (12 months)', 'ABS(L12)', 'num', None), (18, 'Direction that reduces earnings', 'IF(L12<0,"Rise in rates",IF(L12>0,"Fall in rates","None"))', 'txt', None), (19, 'Earnings at risk / net interest income', div('B17', 'N(%s)' % ST('$B$14')), 'pct', '32'),
                              (20, 'Fall in economic value in the worse direction', 'ABS(L13)', 'num', None), (21, 'Direction that reduces economic value', 'IF(L13<0,"Rise in rates",IF(L13>0,"Fall in rates","None"))', 'txt', None), (22, 'Fall in economic value / Tier 1 capital', div('B20', 'N(%s)' % ST('$B$13')), 'pct', '31')]:
    rs.lbl('A%d' % r, lab_); rs.f('B%d' % r, fm, fmt, out=True)
    if th: rs.f('C%d' % r, 'IF(L6+L7=0,"",%s)' % rag_hi_bad('B%d' % r, ST('$B$' + th), ST('$C$' + th)), 'txt')
rs.rag('C17:C22')

cr = B.sheet('Coverage Ratio', (64, 16, 12, 44), tab='2E75B6')
cr.title('Coverage Ratio – Liquidity Coverage Ratio and liquidity ratios', 'No inputs.')
cr.head(5, ['Item', 'Value', 'Result', 'How computed'])
HQT = "'Coverage Input'!$D$12"; LO = "N('Coverage Input'!$B$14)"; LIN = "N('Coverage Input'!$B$15)"
rows = [('High quality liquid assets', HQT, 'num', None, 'After haircuts'), ('Stressed outflows', '%s*%s' % (LO, ST('$B$9')), 'num', None, 'Outflows x stress factor'), ('Stressed inflows (capped)', 'MIN(%s*%s,%s*B7)' % (LIN, ST('$B$10'), ST('$B$11')), 'num', None, 'Inflows x stress factor, not above the cap on stressed outflows'),
        ('Total net cash outflows', 'B7-B8', 'num', None, ''), ('Liquidity Coverage Ratio', div('B6', 'B9'), 'pct', 'IF(%s<>"Yes","Not applicable",IF(B9=0,"",IF(B10<%s,"RED",IF(B10<%s,"AMBER","GREEN"))))' % (ST('$B$7'), ST('$B$8'), ST('$B$36')), 'High quality liquid assets / total net cash outflows'),
        ('Share of the ten largest lenders', div(FR['fund.top10'], FR['fund.total']), 'pct', ('hi', '33'), ''), ('Borrowings due within 12 months to total borrowings', div(FR['fund.st'], FR['fund.total']), 'pct', ('hi', '34'), ''), ('Commercial paper to total borrowings', div(FR['fund.cp'], FR['fund.total']), 'pct', None, ''),
        ('Bank borrowings to total borrowings', div(FR['fund.bank'], FR['fund.total']), 'pct', None, ''), ('Liquid assets to total assets', div(FR['fund.liq'], 'N(%s)' % ST('$B$15')), 'pct', ('lo', '35'), ''), ('Liquid assets and undrawn lines to repayments due in 3 months', div('%s+%s' % (FR['fund.liq'], FR['fund.lines']), FR['fund.rep3']), 'x', None, 'Above 1 means the next 3 months are covered')]
for j, (lab_, fm, fmt, th, how) in enumerate(rows):
    r = 6 + j; cr.lbl('A%d' % r, lab_); cr.f('B%d' % r, fm, fmt, out=True); cr.lbl('D%d' % r, how)
    if isinstance(th, str): cr.f('C%d' % r, th, 'txt')
    elif th:
        fn = rag_hi_bad if th[0] == 'hi' else rag_lo_bad
        cr.f('C%d' % r, 'IF(%s=0,"",%s)' % (FR['fund.total'], fn('B%d' % r, ST('$B$' + th[1]), ST('$C$' + th[1]))), 'txt')
cr.rag('C6:C16')

db = B.sheet('Dashboard', (60, 16, 12, 40), tab='00B050')
db.title('Dashboard – liquidity and interest rate position')
db.f('A3', '"Company: "&%s&"   |   As at: "&TEXT(%s,"DD-MMM-YYYY")&"   |   Amounts in "&%s' % (ST('B4'), ST('B5'), ST('B6')), 'txt')
db.head(5, ['Indicator', 'Value', 'Result', 'Limit or note'])
SLc = lambda c, r: "'Structural Liquidity'!%s%d" % (c, r)
items = [('Cumulative mismatch – 1 to 7 days', SLc('B', 11), 'pct', SLc('B', 14), 'Not more than 10 per cent negative'), ('Cumulative mismatch – up to 14 days', SLc('C', 11), 'pct', SLc('C', 14), 'Not more than 10 per cent negative'), ('Cumulative mismatch – up to 30/31 days', SLc('D', 11), 'pct', SLc('D', 14), 'Not more than 20 per cent negative'),
         ('Cumulative mismatch – up to 1 year', SLc('H', 11), 'pct', SLc('H', 14), 'Internal trigger'), ('Buckets in Red (number)', 'COUNTIF(%s,"RED")' % q('Structural Liquidity', 'B14:K14'), 'int', 'IF(B10>0,"RED","GREEN")', ''), ('Funding needed to cure regulated buckets', q('Structural Liquidity', 'B16'), 'num', None, ''),
         ('Liquidity Coverage Ratio', q('Coverage Ratio', 'B10'), 'pct', q('Coverage Ratio', 'C10'), ''), ('Share of the ten largest lenders', q('Coverage Ratio', 'B11'), 'pct', q('Coverage Ratio', 'C11'), ''), ('Borrowings due within 12 months', q('Coverage Ratio', 'B12'), 'pct', q('Coverage Ratio', 'C12'), ''),
         ('Liquid assets to total assets', q('Coverage Ratio', 'B15'), 'pct', q('Coverage Ratio', 'C15'), ''), ('Earnings at risk / net interest income', q('Rate Sensitivity', 'B19'), 'pct', q('Rate Sensitivity', 'C19'), ''), ('Fall in economic value / Tier 1 capital', q('Rate Sensitivity', 'B22'), 'pct', q('Rate Sensitivity', 'C22'), '15 per cent is the outlier level'),
         ('Open items on the Checks sheet', 'COUNTIF(%s,"CHECK")' % q('Checks', 'C6:C12'), 'int', 'IF(B18=0,"OK","CHECK")', '')]
for j, (lab_, fm, fmt, rg, note) in enumerate(items):
    r = 6 + j; db.lbl('A%d' % r, lab_); db.f('B%d' % r, fm, fmt, out=True); db.lbl('D%d' % r, note)
    if rg: db.f('C%d' % r, rg if rg.startswith('IF(') else 'IF(%s="","",%s)' % (rg, rg), 'txt')
db.rag('C6:C18')

ho = B.sheet('Handover', (46,) + (13,) * 10, tab='7030A0')
ho.title('Handover – figures for the Stress Testing, ICAAP and Ratio models', 'In the layout of the bucket tables of those models.')
ho.head(5, ['Item'] + BUCK)
hv = [('Inflows: loan collections', '+'.join("N('Liquidity Input'!{c}%d)" % (I0 + k) for k in (2, 3))), ('Inflows: other', "%s-" % LQ('{c}', IT) + '-'.join("N('Liquidity Input'!{c}%d)" % (I0 + k) for k in (2, 3))),
      ('Outflows: borrowings and interest', '+'.join("N('Liquidity Input'!{c}%d)" % (O0 + k) for k in (1, 2, 3, 4, 5, 6, 7))), ('Outflows: other', "%s-(" % LQ('{c}', OT) + '+'.join("N('Liquidity Input'!{c}%d)" % (O0 + k) for k in (1, 2, 3, 4, 5, 6, 7)) + ')'),
      ('Rate-sensitive assets', "N('Rate Input'!{c}6)"), ('Rate-sensitive liabilities', "N('Rate Input'!{c}7)")]
for j, (lab_, fm) in enumerate(hv):
    ho.lbl('A%d' % (6 + j), lab_)
    for c in CL: ho.f('%s%d' % (c, 6 + j), fm.replace('{c}', c))
ho.head(14, ['For the Ratio model', 'Value'])
for j, (lab_, fm) in enumerate([('High quality liquid assets', HQT), ('Total net cash outflows over 30 days', q('Coverage Ratio', 'B9')), ('Cash inflows – 1 to 7 days', LQ('B', IT)), ('Cash outflows – 1 to 7 days', LQ('B', OT)), ('Cash inflows – 8 to 14 days', LQ('C', IT)), ('Cash outflows – 8 to 14 days', LQ('C', OT)), ('Cash inflows – 15 to 30/31 days', LQ('D', IT)), ('Cash outflows – 15 to 30/31 days', LQ('D', OT))]):
    ho.lbl('A%d' % (15 + j), lab_); ho.f('B%d' % (15 + j), fm, out=True)

m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how this model produces its results')
m.text_block(4, ['# 1. Structural liquidity', 'For each time bucket: mismatch = inflows - outflows. Cumulative mismatch = sum of mismatches up to the bucket. It is expressed as a percentage of cumulative outflows up to the bucket. A negative figure beyond the regulatory limit (10 per cent for 1 to 7 days, 10 per cent for 8 to 14 days, 20 per cent for 15 to 30/31 days) is RED; beyond the internal trigger it is AMBER. Other buckets are tested against the internal triggers on Setup.',
 '# 2. Placement rules', 'Place each cash flow by its residual maturity. Equity and reserves go in the last bucket. Loans go by contractual instalment dates; overdue instalments and non-performing loans are placed in later buckets on a conservative estimate of recovery (net of provisions). Liquid investments go in the bucket in which they can be sold. Committed lines of credit are an inflow only if the lender cannot withdraw them. Undrawn commitments to customers are an outflow in the bucket in which drawal is expected. Borrowings with put options go by the earliest put date.',
 '# 3. Interest rate sensitivity', 'Gap = rate-sensitive assets - rate-sensitive liabilities in each repricing bucket. Change in net interest income over 12 months for a rise in rates = sum over buckets up to one year of gap x shock x (1 - mid-point of the bucket in years). Change in economic value for a rise in rates = - sum of gap x mid-point x shock. The loss in the worse direction is compared with net interest income and Tier 1 capital.',
 '# 4. Liquidity Coverage Ratio', 'High quality liquid assets = market value x (1 - haircut) for each class. Total net cash outflows = stressed outflows (outflows of the next 30 days x the outflow factor) - stressed inflows (inflows x the inflow factor, capped at a share of stressed outflows). Ratio = liquid assets / total net cash outflows. The factors, haircuts and caps were read against Chapter III of the ALM Directions on 25-11-2026: minimum ratio 100 per cent (para 62); haircuts nil, at least 15 per cent and at least 50 per cent by class of asset (paras 68 to 70); outflows x 115 per cent and inflows x 75 per cent, with inflows capped at 75 per cent of stressed outflows (para 76). A deposit-taking NBFC counts the approved securities it must hold under section 45-IB only up to 80 per cent of the required holding (para 71); the Coverage Input sheet deducts the other 20 per cent. An asset counted in the liquid assets is not counted again as an inflow (para 77). The chapter applies to deposit-taking NBFCs and to non-deposit taking NBFCs with assets of ₹5,000 crore and above.',
 '# 5. Funding and liquidity ratios', 'Share of the ten largest lenders, borrowings due within 12 months, commercial paper and bank borrowings as shares of total borrowings; liquid assets to total assets; and liquid assets plus undrawn lines against repayments due in three months.',
 '# 6. Limits', 'The model is a point-in-time statement on contractual flows with the company\'s behavioural placement. Stressed cash flows and the survival horizon are in the Stress Testing model, which takes its base data from the Handover sheet.'])
ck = B.sheet('Checks', (6, 76, 12, 54), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
chk = [('Company name and statement date are entered', 'AND(%s<>"",%s<>"")' % (ST('$B$4'), ST('$B$5')), 'Complete Setup'), ('Total outflows equal total inflows (the statement balances, within 1 per cent)', 'ABS(%s-%s)<=0.01*MAX(1,%s)' % (LQ('L', OT), LQ('L', IT), LQ('L', OT)), 'All liabilities and all assets must be placed; check for a missing item'),
       ('Total outflows are within 5 per cent of total assets', 'OR(N(%s)=0,ABS(%s-N(%s))<=0.05*N(%s))' % (ST('$B$15'), LQ('L', OT), ST('$B$15'), ST('$B$15')), 'Reconcile the statement with the balance sheet (off-balance sheet items explain small differences)'),
       ('No negative amounts in the cash flow table', 'AND(COUNTIF(%s,"<0")=0,COUNTIF(%s,"<0")=0)' % ("'Liquidity Input'!B%d:K%d" % (O0, OT - 1), "'Liquidity Input'!B%d:K%d" % (I0, IT - 1)), 'Enter outflows and inflows as positive numbers'),
       ('Rate-sensitive assets and liabilities are entered', "AND('Rate Input'!L6>0,'Rate Input'!L7>0)", 'Complete Rate Input'), ('Borrowings due within 12 months do not exceed total borrowings', '%s<=%s+0.005' % (FR['fund.st'], FR['fund.total']), 'Correct the funding profile'),
       ('Coverage ratio inputs are entered where the ratio applies', 'OR(%s<>"Yes",AND(%s>0,%s>0))' % (ST('$B$7'), HQT, LO), 'Complete Coverage Input sections A and B')]
for j, (lab_, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab_); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C12')
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Liquidity Input', 'Rate Input', 'Coverage Input', 'Structural Liquidity', 'Rate Sensitivity', 'Coverage Ratio', 'Dashboard', 'Handover', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('ALM model built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
