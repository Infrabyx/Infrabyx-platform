"""Exposure and Concentration Limits Monitor. Run: python3 build_exposure.py <out.xlsx> <map.json>"""
import sys
from xl import *

NB = 300; R0 = 7; RE = R0 + NB - 1; NG = 40; NSEC = 20; NSTA = 15
B = Book('EXP-M01', 'Exposure and Concentration Limits Monitor')
YN = ['Yes', 'No']; CD = 'RBI (NBFCs – Concentration Risk Management) Directions, 2025'

readme(B, 'Exposure and Concentration Limits Monitor',
       ['This workbook tests the exposure to each borrower and each borrower group against the regulatory limits on Tier 1 capital, tests sector, state and sensitive-sector exposures against the Board\'s internal limits, lists the twenty largest borrowers and measures concentration, with Red / Amber / Green results.',
        'Large borrowers are entered one per row. The granular retail book is entered in total by sector and state.'],
       ['Setup: enter the capital figures, the layer and the limits.', 'Borrower Input: one row per borrower above the reporting threshold (up to %d).' % NB, 'Portfolio Input: name the groups, sectors and states; enter the retail (granular) exposure by sector and state and the sensitive-sector exposures.',
        'Read Borrower Limits, Group Limits, Sector and State, Largest Borrowers and Dashboard. Clear the Checks sheet.'],
       [('Method Notes', 'explains every test'), ('Setup', 'capital and limits'), ('Borrower Input', 'large borrowers'), ('Portfolio Input', 'groups, sectors, states, sensitive sectors'), ('Borrower Limits', 'single-party test'), ('Group Limits', 'group test'),
        ('Sector and State', 'internal limits'), ('Largest Borrowers', 'top twenty and concentration'), ('Dashboard', 'summary'), ('Handover', 'figures for other models'), ('Rules', 'rules for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Setup', (70, 18, 16, 50), tab='C00000')
s.title('Setup – capital and limits', 'Yellow cells are inputs. Regulatory limits are defaults from the Directions; confirm for the company.')
rows = [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None, ''), (5, 'Position as on', 'setup.date', None, 'date', None, ''), (6, 'Amounts are in', 'setup.units', '₹ crore', 'txt', ['₹ crore', '₹ lakh', '₹'], ''),
        (7, 'Regulatory layer', 'setup.layer', 'Middle Layer', 'txt', ['Base Layer', 'Middle Layer', 'Upper Layer'], ''), (8, 'Infrastructure Finance Company', 'setup.ifc', 'No', 'txt', YN, ''), (9, 'Tier 1 capital (eligible capital base for the Upper Layer)', 'setup.t1', None, 'num', None, 'Latest audited balance sheet, as the Directions specify'),
        (10, 'Owned fund', 'setup.of', None, 'num', None, ''), (11, 'Net worth', 'setup.nw', None, 'num', None, ''), (12, 'Gross loans and investments (whole book)', 'setup.book', None, 'num', None, 'Balance sheet'),
        (14, 'Single party limit (% of Tier 1)', 'limit.single', None, 'pct', None, CD + ', para 13 (25 per cent) and para 14 (Infrastructure Finance Company 30 per cent); Upper Layer para 33 (20 per cent; Board may allow 25 per cent under para 34)'),
        (15, 'Single group limit (% of Tier 1)', 'limit.group', None, 'pct', None, CD + ', para 13 (40 per cent) and para 14 (Infrastructure Finance Company 50 per cent); Upper Layer: confirm the group limit in the large exposures framework'),
        (16, 'Additional room for infrastructure exposure – single party (percentage points)', 'limit.infra1', 0.05, 'pct', None, CD + ', proviso to para 13'), (17, 'Additional room for infrastructure exposure – group (percentage points)', 'limit.infrag', 0.10, 'pct', None, CD + ', proviso to para 13'),
        (18, 'Internal trigger as a share of the limit', 'limit.trigger', 0.85, 'pct', None, 'Board-approved internal limits'), (19, 'Ceiling per borrower for financing an initial public offer (₹ crore)', 'limit.ipo', 1, 'num', None, CD + ', para 11'),
        (20, 'Internal limit: twenty largest borrowers (% of the book)', 'limit.top20', 0.25, 'pct', None, 'Board-approved internal limits'), (21, 'Internal limit: unsecured exposure among large borrowers (% of Tier 1)', 'limit.unsec', 1.0, 'pct', None, 'Board-approved internal limits'),
        (22, 'Internal limit: capital market exposure (% of net worth)', 'limit.cme', 0.40, 'pct', None, 'Board-approved internal limit for sensitive sectors'), (23, 'Internal limit: commercial real estate exposure (% of the book)', 'limit.cre', 0.15, 'pct', None, 'Board-approved internal limit for sensitive sectors'),
        (24, 'Internal limit: exposure to group companies (% of owned fund)', 'limit.grp', 0.10, 'pct', None, 'Excess over 10 per cent of owned fund is deducted in computing net owned fund')]
for r, lab, key, d, fmt, lst, src in rows:
    s.lbl('A%d' % r, lab); s.lbl('D%d' % r, src); s.inp('B%d' % r, key, lab + (' (blank = default for the layer)' if key in ('limit.single', 'limit.group') else ''), d, fmt, src or 'Company', lst)
s.f('C14', 'IF(B14<>"",B14,IF(B7="Upper Layer",0.20,IF(B8="Yes",0.30,0.25)))', 'pct', out=True); s.f('C15', 'IF(B15<>"",B15,IF(B8="Yes",0.50,0.40))', 'pct', out=True)
s.lbl('A26', 'One crore in the units selected'); s.f('B26', 'IF(B6="₹ crore",1,IF(B6="₹ lakh",100,10000000))', 'num')
ST = lambda c: q('Setup', c)
T1, L1, LG, TRG, CRU = 'N(%s)' % ST('$B$9'), ST('$C$14'), ST('$C$15'), ST('$B$18'), ST('$B$26')

bi = B.sheet('Borrower Input', (28, 22, 22, 16, 15, 15, 15, 12, 14, 12), tab='BF9000')
bi.title('Borrower Input – one row per large borrower', 'Group, sector and state must match the names on Portfolio Input exactly. Leave Group blank for a borrower with no group.')
HD = ['Borrower *', 'Group', 'Sector *', 'State', 'Funded exposure *', 'Non-funded exposure', 'Investment exposure', 'Infrastructure (Yes / No)', 'Loan for an initial public offer', 'Secured (Yes / No)']
bi.head(6, HD)
for r in range(R0, RE + 1):
    for c in 'ABCDEFGHIJ':
        cell = bi.ws['%s%d' % (c, r)]; cell.fill = YEL; cell.protection = Protection(locked=False)
        if c in 'EFGI': cell.number_format = F['num']
for col in 'HJ':
    dv = DataValidation(type='list', formula1='"Yes,No"', allow_blank=True); bi.ws.add_data_validation(dv); dv.add('%s%d:%s%d' % (col, R0, col, RE))
B.inputs.append(dict(key='borrowers', sheet='Borrower Input', cell='A%d:J%d' % (R0, RE), label='Borrower table: ' + '; '.join(h.replace(' *', '') for h in HD), source='Large exposure report; DNBS01 Annex on top borrowers; DNBS03 concentration part; CRILC data', default=None))
BI = lambda c, r: "'Borrower Input'!%s%d" % (c, r)
BRG = lambda c: "'Borrower Input'!$%s$%d:$%s$%d" % (c, R0, c, RE)

pi = B.sheet('Portfolio Input', (30, 16, 4, 30, 16, 16, 4, 26, 16, 16, 4, 46, 16), tab='BF9000')
pi.title('Portfolio Input – groups, sectors, states and sensitive sectors', 'Names typed here are the names to use on Borrower Input.')
pi.head(6, ['Borrower group', 'Infrastructure group (Yes / No)']); pi.head(6, ['Sector', 'Retail (granular) exposure not on Borrower Input', 'Internal limit (% of the book)'], col=4); pi.head(6, ['State', 'Retail (granular) exposure not on Borrower Input', 'Internal limit (% of the book)'], col=8); pi.head(6, ['Sensitive sector and other exposures', 'Amount'], col=12)
for i in range(NG):
    pi.inp('A%d' % (7 + i), 'group.name.%d' % (i + 1), 'Group %d name' % (i + 1), None, 'txt', 'Group mapping of borrowers'); pi.inp('B%d' % (7 + i), 'group.infra.%d' % (i + 1), 'Group %d infrastructure' % (i + 1), None, 'txt', 'Credit files', YN)
for i in range(NSEC):
    pi.inp('D%d' % (7 + i), 'sector.name.%d' % (i + 1), 'Sector %d name' % (i + 1), None, 'txt', 'Sector classification used in DNBS returns'); pi.inp('E%d' % (7 + i), 'sector.retail.%d' % (i + 1), 'Sector %d retail exposure' % (i + 1), None, 'num', 'Sector-wise portfolio report'); pi.inp('F%d' % (7 + i), 'sector.limit.%d' % (i + 1), 'Sector %d internal limit' % (i + 1), None, 'pct', 'Board-approved sector limits')
for i in range(NSTA):
    pi.inp('H%d' % (7 + i), 'state.name.%d' % (i + 1), 'State %d name' % (i + 1), None, 'txt', 'State-wise portfolio report'); pi.inp('I%d' % (7 + i), 'state.retail.%d' % (i + 1), 'State %d retail exposure' % (i + 1), None, 'num', 'State-wise portfolio report'); pi.inp('J%d' % (7 + i), 'state.limit.%d' % (i + 1), 'State %d internal limit' % (i + 1), None, 'pct', 'Board-approved geographic limits')
SENS = [('Capital market exposure (advances and investments)', 'sens.cme'), ('Commercial real estate exposure', 'sens.cre'), ('Exposure to subsidiaries and group companies', 'sens.grp'), ('Loans against shares', 'sens.las'), ('Loans against gold', 'sens.gold'), ('Unsecured retail loans', 'sens.unsec')]
SR = {}
for j, (lab, key) in enumerate(SENS):
    SR[key] = "N('Portfolio Input'!$M$%d)" % (7 + j); pi.lbl('L%d' % (7 + j), lab); pi.inp('M%d' % (7 + j), key, lab, None, 'num', 'DNBS01 / DNBS02 exposure to sensitive sectors; MIS')

bl = B.sheet('Borrower Limits', (28, 20, 16, 12, 12, 12, 12, 16, 12, 9), tab='2E75B6')
bl.title('Borrower Limits – exposure to each borrower against the single party limit', 'No inputs.')
bl.head(6, ['Borrower', 'Group', 'Total exposure', '% of Tier 1', 'Limit', 'Trigger', 'Result', 'Room left under the limit', 'IPO loan result', 'Rank'])
for r in range(R0, RE + 1):
    has = '%s<>""' % BI('A', r)
    bl.f('A%d' % r, 'IF(%s,%s,"")' % (has, BI('A', r)), 'txt'); bl.f('B%d' % r, 'IF(%s,IF(%s="","",%s),"")' % (has, BI('B', r), BI('B', r)), 'txt')
    bl.f('C%d' % r, 'IF(%s,N(%s)+N(%s)+N(%s),"")' % (has, BI('E', r), BI('F', r), BI('G', r))); bl.f('D%d' % r, 'IF(OR(A{0}="",{1}=0),"",C{0}/{1})'.format(r, T1), 'pct')
    bl.f('E%d' % r, 'IF(A{0}="","",{1}+IF(AND({2}="Yes",{3}<>"Upper Layer"),{4},0))'.format(r, L1, BI('H', r), ST('$B$7'), ST('$B$16')), 'pct'); bl.f('F%d' % r, 'IF(A{0}="","",E{0}*{1})'.format(r, TRG), 'pct')
    bl.f('G%d' % r, 'IF(OR(A{0}="",D{0}=""),"",IF(D{0}>E{0},"RED",IF(D{0}>F{0},"AMBER","GREEN")))'.format(r), 'txt'); bl.f('H%d' % r, 'IF(OR(A{0}="",D{0}=""),"",E{0}*{1}-C{0})'.format(r, T1))
    bl.f('I%d' % r, 'IF(OR(A{0}="",N({1})=0),"",IF(N({1})/{2}>{3},"RED","GREEN"))'.format(r, BI('I', r), CRU, ST('$B$19')), 'txt')
    bl.f('J%d' % r, 'IF(A{0}="","",RANK(C{0},$C${1}:$C${2})+COUNTIF($C${1}:C{0},C{0})-1)'.format(r, R0, RE), 'int')
bl.rag('G%d:G%d' % (R0, RE)); bl.rag('I%d:I%d' % (R0, RE))
BL = lambda c: "'Borrower Limits'!$%s$%d:$%s$%d" % (c, R0, c, RE)

gl = B.sheet('Group Limits', (30, 12, 16, 12, 12, 12, 12, 16), tab='2E75B6')
gl.title('Group Limits – exposure to each borrower group against the group limit', 'No inputs. Groups are those named on Portfolio Input.')
gl.head(6, ['Group', 'Borrowers', 'Total exposure', '% of Tier 1', 'Limit', 'Trigger', 'Result', 'Room left under the limit'])
for i in range(NG):
    r = 7 + i; nm = "'Portfolio Input'!$A$%d" % r
    gl.f('A%d' % r, 'IF(%s="","",%s)' % (nm, nm), 'txt'); gl.f('B%d' % r, 'IF(A{0}="","",COUNTIF({1},A{0}))'.format(r, BRG('B')), 'int'); gl.f('C%d' % r, 'IF(A{0}="","",SUMIF({1},A{0},{2}))'.format(r, BL('B'), BL('C')))
    gl.f('D%d' % r, 'IF(OR(A{0}="",{1}=0),"",C{0}/{1})'.format(r, T1), 'pct'); gl.f('E%d' % r, "IF(A{0}=\"\",\"\",{1}+IF(AND('Portfolio Input'!$B${0}=\"Yes\",{2}<>\"Upper Layer\"),{3},0))".format(r, LG, ST('$B$7'), ST('$B$17')), 'pct')
    gl.f('F%d' % r, 'IF(A{0}="","",E{0}*{1})'.format(r, TRG), 'pct'); gl.f('G%d' % r, 'IF(OR(A{0}="",D{0}=""),"",IF(D{0}>E{0},"RED",IF(D{0}>F{0},"AMBER","GREEN")))'.format(r), 'txt'); gl.f('H%d' % r, 'IF(OR(A{0}="",D{0}=""),"",E{0}*{1}-C{0})'.format(r, T1))
gl.rag('G7:G%d' % (6 + NG))

BOOK = 'N(%s)' % ST('$B$12')
ss = B.sheet('Sector and State', (30, 15, 15, 15, 12, 12, 10, 4, 26, 15, 15, 15, 12, 12, 10), tab='2E75B6')
ss.title('Sector and State – exposure against the internal limits', 'No inputs. Exposure = large borrowers in the sector or state + retail exposure entered on Portfolio Input.')
ss.head(6, ['Sector', 'Large borrowers', 'Retail', 'Total', '% of the book', 'Internal limit', 'Result']); ss.head(6, ['State', 'Large borrowers', 'Retail', 'Total', '% of the book', 'Internal limit', 'Result'], col=9)
for i in range(max(NSEC, NSTA)):
    r = 7 + i
    for n, (a0, nmc, rc, lc, src) in enumerate([('A', 'D', 'E', 'F', 'C'), ('I', 'H', 'I', 'J', 'D')]):
        if i >= (NSEC, NSTA)[n]: continue
        cols = [chr(ord(a0) + k) for k in range(7)]; nm = "'Portfolio Input'!$%s$%d" % (nmc, r)
        ss.f('%s%d' % (cols[0], r), 'IF(%s="","",%s)' % (nm, nm), 'txt'); ss.f('%s%d' % (cols[1], r), 'IF({a}{r}="",0,SUMIF({k},{a}{r},{v}))'.format(a=cols[0], r=r, k=BRG(src), v=BL('C')))
        ss.f('%s%d' % (cols[2], r), "IF(%s%d=\"\",0,N('Portfolio Input'!$%s$%d))" % (cols[0], r, rc, r)); ss.f('%s%d' % (cols[3], r), '%s%d+%s%d' % (cols[1], r, cols[2], r)); ss.f('%s%d' % (cols[4], r), div('%s%d' % (cols[3], r), BOOK), 'pct')
        ss.f('%s%d' % (cols[5], r), "IF('Portfolio Input'!$%s$%d=\"\",\"\",'Portfolio Input'!$%s$%d)" % (lc, r, lc, r), 'pct')
        ss.f('%s%d' % (cols[6], r), 'IF(OR({a}{r}="",{l}{r}="",{b}=0),"",IF({p}{r}>{l}{r},"RED",IF({p}{r}>{l}{r}*{t},"AMBER","GREEN")))'.format(a=cols[0], r=r, l=cols[5], p=cols[4], b=BOOK, t=TRG), 'txt')
ss.rag('G7:G%d' % (6 + NSEC)); ss.rag('O7:O%d' % (6 + NSTA))
ss.head(29, ['Sensitive sector and other exposures', 'Amount', 'Base', 'Ratio', 'Internal limit', 'Result'])
for j, (lab, num, base, lim) in enumerate([('Capital market exposure to net worth', SR['sens.cme'], 'N(%s)' % ST('$B$11'), ST('$B$22')), ('Commercial real estate exposure to the book', SR['sens.cre'], BOOK, ST('$B$23')), ('Exposure to group companies to owned fund', SR['sens.grp'], 'N(%s)' % ST('$B$10'), ST('$B$24')),
                                           ('Unsecured exposure among large borrowers to Tier 1', 'SUMIF(%s,"No",%s)' % (BRG('J'), BL('C')), T1, ST('$B$21'))]):
    r = 30 + j; ss.lbl('A%d' % r, lab); ss.f('B%d' % r, num); ss.f('C%d' % r, base); ss.f('D%d' % r, div('B%d' % r, 'C%d' % r), 'pct', out=True); ss.f('E%d' % r, lim, 'pct')
    ss.f('F%d' % r, 'IF(C{0}=0,"",IF(D{0}>E{0},"RED",IF(D{0}>E{0}*{1},"AMBER","GREEN")))'.format(r, TRG), 'txt')
ss.rag('F30:F33')

lb = B.sheet('Largest Borrowers', (8, 30, 22, 16, 13, 13), tab='2E75B6')
lb.title('Largest Borrowers – the twenty largest and concentration measures', 'No inputs.')
lb.head(6, ['Rank', 'Borrower', 'Group', 'Total exposure', '% of Tier 1', '% of the book'])
for k in range(1, 21):
    r = 6 + k; mt = 'MATCH(%d,%s,0)' % (k, BL('J')); lb.lbl('A%d' % r, k)
    lb.f('B%d' % r, 'IF(ISNA(%s),"",INDEX(%s,%s))' % (mt, BL('A'), mt), 'txt'); lb.f('C%d' % r, 'IF(ISNA(%s),"",INDEX(%s,%s))' % (mt, BL('B'), mt), 'txt'); lb.f('D%d' % r, 'IF(ISNA(%s),0,INDEX(%s,%s))' % (mt, BL('C'), mt))
    lb.f('E%d' % r, div('D%d' % r, T1), 'pct'); lb.f('F%d' % r, div('D%d' % r, BOOK), 'pct')
lb.lbl('B27', 'Total of the twenty largest', True); lb.f('D27', 'SUM(D7:D26)', out=True); lb.f('E27', div('D27', T1), 'pct', out=True); lb.f('F27', div('D27', BOOK), 'pct', out=True)
lb.lbl('B29', 'Result against the internal limit on the twenty largest'); lb.f('D29', 'IF(%s=0,"",IF(F27>%s,"RED",IF(F27>%s*%s,"AMBER","GREEN")))' % (BOOK, ST('$B$20'), ST('$B$20'), TRG), 'txt'); lb.rag('D29')
lb.lbl('B30', 'Borrower concentration index (sum of squared shares of the book)'); lb.f('D30', div('SUMSQ(%s)' % BL('C'), '(%s)^2' % BOOK), 'n4')
lb.lbl('B31', 'Sector concentration index'); lb.f('D31', div("SUMSQ('Sector and State'!D7:D%d)" % (6 + NSEC), "SUM('Sector and State'!D7:D%d)^2" % (6 + NSEC)), 'n4')
lb.lbl('B32', 'State concentration index'); lb.f('D32', div("SUMSQ('Sector and State'!L7:L%d)" % (6 + NSTA), "SUM('Sector and State'!L7:L%d)^2" % (6 + NSTA)), 'n4')

db = B.sheet('Dashboard', (62, 16, 12, 44), tab='00B050')
db.title('Dashboard – exposure limits')
db.f('A3', '"Company: "&%s&"   |   As on: "&TEXT(%s,"DD-MMM-YYYY")&"   |   "&%s&"   |   Tier 1 capital "&TEXT(%s,"#,##0.00")' % (ST('B4'), ST('B5'), ST('B7'), T1), 'txt')
db.head(5, ['Indicator', 'Value', 'Result', 'Limit or note'])
cnt = lambda rng, v: 'COUNTIF(%s,"%s")' % (rng, v)
it = [('Largest single-party exposure (% of Tier 1)', q('Largest Borrowers', 'E7'), 'pct', 'IF(B6=0,"",IF(B7>0,"RED",IF(B8>0,"AMBER","GREEN")))', 'Against the limit of each borrower (see Borrower Limits)'), ('Borrowers above the single party limit (number)', cnt(BL('G'), 'RED'), 'int', 'IF(B7>0,"RED","GREEN")', CD + ', para 13 / 14 / 33'),
      ('Borrowers above the internal trigger (number)', cnt(BL('G'), 'AMBER'), 'int', 'IF(B8>0,"AMBER","GREEN")', ''), ('Largest group exposure (% of Tier 1)', "MAX('Group Limits'!D7:D%d,0)" % (6 + NG), 'pct', 'IF(B9=0,"",IF(B10>0,"RED",IF(COUNTIF(%s,"AMBER")>0,"AMBER","GREEN")))' % ("'Group Limits'!G7:G%d" % (6 + NG)), 'Against the limit of each group (see Group Limits)'),
      ('Groups above the group limit (number)', cnt("'Group Limits'!G7:G%d" % (6 + NG), 'RED'), 'int', 'IF(B10>0,"RED","GREEN")', ''), ('Loans for initial public offers above the ceiling (number)', cnt(BL('I'), 'RED'), 'int', 'IF(B11>0,"RED","GREEN")', CD + ', para 11'),
      ('Twenty largest borrowers (% of the book)', q('Largest Borrowers', 'F27'), 'pct', q('Largest Borrowers', 'D29'), 'Internal limit'), ('Sectors above the internal limit (number)', cnt("'Sector and State'!G7:G%d" % (6 + NSEC), 'RED'), 'int', 'IF(B13>0,"RED","GREEN")', ''),
      ('States above the internal limit (number)', cnt("'Sector and State'!O7:O%d" % (6 + NSTA), 'RED'), 'int', 'IF(B14>0,"RED","GREEN")', ''), ('Capital market exposure to net worth', q('Sector and State', 'D30'), 'pct', q('Sector and State', 'F30'), 'Internal limit'),
      ('Commercial real estate exposure to the book', q('Sector and State', 'D31'), 'pct', q('Sector and State', 'F31'), 'Internal limit'), ('Exposure to group companies to owned fund', q('Sector and State', 'D32'), 'pct', q('Sector and State', 'F32'), 'Excess over 10 per cent is deducted from owned fund'),
      ('Open items on the Checks sheet', 'COUNTIF(%s,"CHECK")' % q('Checks', 'C6:C12'), 'int', 'IF(B18=0,"OK","CHECK")', '')]
for j, (lab, fm, fmt, rg, note) in enumerate(it):
    r = 6 + j; db.lbl('A%d' % r, lab); db.f('B%d' % r, fm, fmt, out=True); db.lbl('D%d' % r, note)
    db.f('C%d' % r, ('IF(%s=0,"",%s)' % (T1, rg)) if rg.startswith('IF(') else 'IF(%s="","",%s)' % (rg, rg), 'txt')
db.rag('C6:C18')

ho = B.sheet('Handover', (8, 30, 16, 4, 28, 16, 4, 26, 16), tab='7030A0')
ho.title('Handover – figures for the Stress Testing, ICAAP and Ratio models', 'Twenty largest borrowers, sectors and states in the layout of those models.')
ho.head(5, ['Rank', 'Borrower', 'Exposure']); ho.head(5, ['Sector', 'Exposure'], col=5); ho.head(5, ['State', 'Exposure'], col=8)
for k in range(20):
    r = 6 + k; ho.lbl('A%d' % r, k + 1); ho.f('B%d' % r, "'Largest Borrowers'!B%d" % (7 + k), 'txt'); ho.f('C%d' % r, "'Largest Borrowers'!D%d" % (7 + k))
    if k < 10:
        ho.f('E%d' % r, "IF('Sector and State'!A%d=\"\",\"\",'Sector and State'!A%d)" % (7 + k, 7 + k), 'txt'); ho.f('F%d' % r, "'Sector and State'!D%d" % (7 + k)); ho.f('H%d' % r, "IF('Sector and State'!I%d=\"\",\"\",'Sector and State'!I%d)" % (7 + k, 7 + k), 'txt'); ho.f('I%d' % r, "'Sector and State'!L%d" % (7 + k))
ho.lbl('B28', 'Largest single-party exposure', True); ho.f('C28', "'Largest Borrowers'!D7", out=True); ho.lbl('B29', 'Largest group exposure', True); ho.f('C29', "MAX('Group Limits'!C7:C%d,0)" % (6 + NG), out=True); ho.lbl('B30', 'Twenty largest borrowers', True); ho.f('C30', "'Largest Borrowers'!D27", out=True)

ru = B.sheet('Rules', (6, 40, 84, 44), tab='7030A0', protect=False)
ru.title('Rules – exposure rules in one table', 'For use in a loan management system or compliance tool.')
ru.head(5, ['#', 'Rule', 'Logic', 'Reference'])
for j, (a, b_, c_) in enumerate([('Borrower exposure', 'funded + non-funded + investment exposure', ''), ('Single party limit', 'exposure / Tier 1 <= 25% (30% for an Infrastructure Finance Company; 20% of eligible capital base for the Upper Layer) + 5 percentage points where the additional exposure is infrastructure (not Upper Layer)', CD + ', paras 13, 14, 33, 34'),
      ('Group limit', 'sum of exposure of borrowers in the group / Tier 1 <= 40% (50% for an Infrastructure Finance Company) + 10 percentage points for infrastructure', CD + ', paras 13, 14'), ('Internal trigger', 'limit x trigger share (85% by default) gives Amber', 'Board-approved'),
      ('Initial public offer financing', 'loan per borrower <= ₹1 crore', CD + ', para 11'), ('Sector and state limits', '(large borrowers in the sector or state + retail exposure) / book <= internal limit', 'Board-approved'), ('Sensitive sectors', 'capital market exposure / net worth; commercial real estate / book; group companies / owned fund against internal limits', 'Board-approved')], 1):
    for col, v in zip('ABCD', (j, a, b_, c_)): ru.lbl('%s%d' % (col, 5 + j), v)
m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how this monitor produces its results')
m.text_block(4, ['# 1. Single party and group tests', 'Exposure of a borrower = funded + non-funded + investment exposure. It is divided by Tier 1 capital and compared with the limit for the company\'s layer and type. Where the borrower is marked as infrastructure, the additional room in the proviso is added to the limit (not for the Upper Layer). Group exposure is the sum for all borrowers carrying the same group name. Above the limit is RED; above the internal trigger (a share of the limit) is AMBER.',
 '# 2. Capital base', 'Enter Tier 1 capital as the Directions define it for the test (generally as per the last audited balance sheet, with permitted adjustments). For the Upper Layer enter the eligible capital base.',
 '# 3. Sector, state and sensitive sectors', 'Exposure to a sector or state = large borrowers tagged to it + the retail exposure entered for it. It is compared with the internal limit, expressed as a percentage of the whole book. Sensitive-sector exposures are compared with the internal limits on Setup.',
 '# 4. Largest borrowers and concentration', 'Borrowers are ranked by exposure; ties are ranked in the order entered. The concentration index is the sum of squared shares: a higher figure means more concentration.',
 '# 5. Limits of the monitor', 'Exemptions and offsets allowed by the Directions (for example exposures guaranteed by Government, or credit risk transfer) are not computed; enter exposure net of permitted exclusions and keep the working. The monitor holds %d borrowers and %d groups.' % (NB, NG)])
ck = B.sheet('Checks', (6, 76, 12, 54), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
chk = [('Tier 1 capital and the book are entered', 'AND(%s>0,%s>0)' % (T1, BOOK), 'Complete Setup'), ('At least one borrower is entered', 'COUNTA(%s)>0' % BRG('A'), 'Complete Borrower Input'),
       ('Every group named on Borrower Input is listed on Portfolio Input', "SUMPRODUCT((%s<>\"\")*(COUNTIF('Portfolio Input'!$A$7:$A$%d,%s)=0))=0" % (BRG('B'), 6 + NG, BRG('B')), 'Add the group or correct the spelling'),
       ('Every sector named on Borrower Input is listed on Portfolio Input', "SUMPRODUCT((%s<>\"\")*(COUNTIF('Portfolio Input'!$D$7:$D$%d,%s)=0))=0" % (BRG('C'), 6 + NSEC, BRG('C')), 'Add the sector or correct the spelling'),
       ('Every state named on Borrower Input is listed on Portfolio Input', "SUMPRODUCT((%s<>\"\")*(COUNTIF('Portfolio Input'!$H$7:$H$%d,%s)=0))=0" % (BRG('D'), 6 + NSTA, BRG('D')), 'Add the state or correct the spelling'),
       ('Sector totals do not exceed the book', "SUM('Sector and State'!D7:D%d)<=%s+0.5" % (6 + NSEC, BOOK), 'Check retail exposure and the book figure'), ('No negative exposure', 'AND(COUNTIF(%s,"<0")=0,COUNTIF(%s,"<0")=0)' % (BRG('E'), BRG('F')), 'Correct the data')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C12')
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Borrower Input', 'Portfolio Input', 'Borrower Limits', 'Group Limits', 'Sector and State', 'Largest Borrowers', 'Dashboard', 'Handover', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('Exposure monitor built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
