"""Asset Classification and Provisioning Engine (loan level). Run: python3 build_iracp.py <out.xlsx> <map.json>"""
import sys
from xl import *

NL = 1000; R0 = 7; RE = R0 + NL - 1
B = Book('IRAC-M01', 'Asset Classification and Provisioning Engine')
YN = ['Yes', 'No']; MD = 'RBI (NBFCs – Income Recognition, Asset Classification and Provisioning) Directions, 2025 (MD 356)'
CLS = ['Standard', 'Sub-standard', 'Doubtful – up to 1 year', 'Doubtful – 1 to 3 years', 'Doubtful – over 3 years', 'Loss']

readme(B, 'Asset Classification and Provisioning Engine',
       ['This workbook classifies each loan as standard, sub-standard, doubtful or loss under the RBI norms, applies the classification at borrower level, computes the provision required on each loan and summarises the result by class and by product. It also shows special mention accounts and the figures the ECL model needs for the prudential floor.',
        'The rules (days past due for NPA, months in each class, provisioning rates) are inputs on the Setup sheet with the RBI defaults; check them against the Directions for the company\'s layer before use.'],
       ['Setup: enter the company, the reporting date, the layer and review the norms and rates.', 'Loan Input: paste one row per loan (up to %d loans) from the loan management system.' % NL,
        'Classification: read the class, the provision and the reason for each loan. No input.', 'Summary and Dashboard: read the totals by class and product, the ratios and the exceptions.', 'Clear the Checks sheet. Copy the Handover figures into the ECL model (Prudential Floor sheet) and the Ratio model.'],
       [('Method Notes', 'explains every rule'), ('Setup', 'norms and rates'), ('Loan Input', 'loan-level data'), ('Classification', 'class and provision per loan'), ('Summary', 'totals by class and by product'), ('Dashboard', 'ratios with Red / Amber / Green'),
        ('Handover', 'figures for the ECL and Ratio models'), ('Rules', 'the rules in one table for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Setup', (66, 18, 16, 50), tab='C00000')
s.title('Setup – norms and rates', 'Yellow cells are inputs. Defaults follow the RBI norms; confirm them for the company\'s layer and category.')
rows = [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None, ''), (5, 'Reporting date', 'setup.date', None, 'date', None, ''), (6, 'Amounts are in', 'setup.units', '₹', 'txt', ['₹', '₹ lakh', '₹ crore'], ''),
        (7, 'Regulatory layer', 'setup.layer', 'Middle Layer', 'txt', ['Base Layer', 'Middle Layer', 'Upper Layer'], ''), (8, 'A loan is non-performing when overdue for more than (days)', 'norm.npa', 90, 'int', None, MD),
        (9, 'Months as sub-standard before a loan becomes doubtful', 'norm.ss', 12, 'int', None, MD + ' – confirm for the layer'), (10, 'Classify at borrower level (all loans of a borrower follow the worst loan)', 'norm.borrower', 'Yes', 'txt', YN, MD),
        (11, 'Upgrade to standard only when all arrears are cleared', 'norm.upgrade', 'Yes', 'txt', YN, MD), (12, 'Treat accounts declared as fraud as loss assets', 'norm.fraud', 'Yes', 'txt', YN, 'Provisioning policy of the company; fraud risk management directions'),
        (14, 'Provision on standard assets', 'rate.std', None, 'p4', None, MD + ', para 48 (Base Layer 0.25 per cent) and para 55 (Middle Layer 0.40 per cent); Upper Layer rates are category-wise – enter the weighted rate'),
        (15, 'Provision on sub-standard assets', 'rate.ss', 0.10, 'pct', None, MD), (16, 'Doubtful – secured portion – up to 1 year', 'rate.d1', 0.20, 'pct', None, MD), (17, 'Doubtful – secured portion – 1 to 3 years', 'rate.d2', 0.30, 'pct', None, MD),
        (18, 'Doubtful – secured portion – over 3 years', 'rate.d3', 0.50, 'pct', None, MD), (19, 'Doubtful – unsecured portion', 'rate.du', 1.0, 'pct', None, MD), (20, 'Loss assets', 'rate.loss', 1.0, 'pct', None, MD),
        (22, 'Gross NPA ratio: amber from', 'thr.gnpa.amber', 0.03, 'pct', None, 'Risk appetite statement'), (23, 'Gross NPA ratio: red from', 'thr.gnpa.red', 0.05, 'pct', None, 'Risk appetite statement'),
        (24, 'Net NPA ratio: amber from', 'thr.nnpa.amber', 0.03, 'pct', None, 'Risk appetite statement'), (25, 'Net NPA ratio: red from', 'thr.nnpa.red', 0.06, 'pct', None, 'Dividend and Prompt Corrective Action thresholds (6 per cent)'),
        (26, 'SMA-2 share of standard loans: amber from', 'thr.sma.amber', 0.02, 'pct', None, 'Risk appetite statement'), (27, 'SMA-2 share of standard loans: red from', 'thr.sma.red', 0.04, 'pct', None, 'Risk appetite statement')]
for r, lab, key, d, fmt, lst, src in rows:
    s.lbl('A%d' % r, lab); s.lbl('D%d' % r, src)
    if key == 'rate.std':
        s.inp('B%d' % r, key, lab + ' (leave blank to use the layer default)', None, fmt, src); s.f('C%d' % r, 'IF(B14<>"",B14,IF(B7="Base Layer",0.0025,0.004))', 'p4', out=True)
    else:
        s.inp('B%d' % r, key, lab, d, fmt, src or 'Company', lst)
ST = lambda c: q('Setup', c)
DT, NPAD, SSM, STD = ST('$B$5'), ST('$B$8'), ST('$B$9'), ST('$C$14')

li = B.sheet('Loan Input', (14, 14, 22, 12, 16, 14, 10, 13, 16, 11, 11, 13, 13, 12), tab='BF9000')
li.title('Loan Input – one row per loan', 'Paste from the loan management system. Columns marked * are needed for every loan. Dates as dates; Yes / No in the flag columns (blank = No).')
HD = ['Loan ID *', 'Borrower ID *', 'Product *', 'Secured / Unsecured *', 'Principal outstanding *', 'Interest overdue included in dues', 'Days past due *', 'Date first classified NPA', 'Realisable value of security', 'Restructured', 'Declared fraud', 'Identified as loss', 'NPA at last reporting date', 'All arrears cleared']
li.head(6, HD)
for r in range(R0, RE + 1):
    for c in 'ABCDEFGHIJKLMN':
        cell = li.ws['%s%d' % (c, r)]; cell.fill = YEL; cell.protection = Protection(locked=False)
        if c in 'EFI': cell.number_format = F['num']
        if c == 'H': cell.number_format = F['date']
for col, lst in (('D', ['Secured', 'Unsecured']), ('J', YN), ('K', YN), ('L', YN), ('M', YN), ('N', YN)):
    dv = DataValidation(type='list', formula1='"%s"' % ','.join(lst), allow_blank=True); li.ws.add_data_validation(dv); dv.add('%s%d:%s%d' % (col, R0, col, RE))
B.inputs.append(dict(key='loans', sheet='Loan Input', cell='A%d:N%d' % (R0, RE), label='Loan table: ' + '; '.join(h.replace(' *', '') for h in HD), source='Loan management system – loan-wise outstanding, days past due, security and flags as on the reporting date', default=None))
LI = lambda c, r: "'Loan Input'!%s%d" % (c, r)
LR = lambda c: "'Loan Input'!$%s$%d:$%s$%d" % (c, R0, c, RE)

cl = B.sheet('Classification', (14, 14, 20, 15, 10, 11, 11, 10, 24, 11, 15, 15, 15, 12, 40), tab='2E75B6')
cl.title('Classification – class and provision for each loan', 'No inputs. "Reason" explains how the class was reached.')
cl.head(6, ['Loan ID', 'Borrower ID', 'Product', 'Total dues', 'Own days past due', 'Borrower worst days past due', 'Non-performing', 'Months as NPA', 'Asset class', 'Special mention category', 'Secured portion', 'Unsecured portion', 'Provision required', 'Provision rate', 'Reason'])
for r in range(R0, RE + 1):
    has = '%s<>""' % LI('A', r)
    cl.f('A%d' % r, 'IF(%s,%s,"")' % (has, LI('A', r)), 'txt'); cl.f('B%d' % r, 'IF(%s,%s,"")' % (has, LI('B', r)), 'txt'); cl.f('C%d' % r, 'IF(%s,%s,"")' % (has, LI('C', r)), 'txt')
    cl.f('D%d' % r, 'IF(%s,N(%s)+N(%s),"")' % (has, LI('E', r), LI('F', r))); cl.f('E%d' % r, 'IF(%s,N(%s),"")' % (has, LI('G', r)), 'int')
    cl.f('F%d' % r, 'IF(A{0}="","",IF(AND({1}="Yes",B{0}<>""),SUMPRODUCT(MAX(({2}=B{0})*{3})),E{0}))'.format(r, ST('$B$10'), LR('B'), LR('G')), 'int')
    stuck = 'AND(%s="Yes",%s="Yes",%s<>"Yes")' % (ST('$B$11'), LI('M', r), LI('N', r))
    cl.f('G%d' % r, 'IF(A{0}="","",IF(OR(F{0}>{1},{2},{3}="Yes",AND({4}="Yes",{5}="Yes")),"Yes","No"))'.format(r, NPAD, stuck, LI('L', r), ST('$B$12'), LI('K', r)), 'txt')
    cl.f('H%d' % r, 'IF(G{0}<>"Yes","",MAX(0,({1}-IF({2}<>"",{2},{1}-MAX(0,F{0}-{3})))/30.4375))'.format(r, DT, LI('H', r), NPAD), 'num')
    cl.f('I%d' % r, ('IF(A{0}="","",IF(G{0}<>"Yes","%s",IF(OR({1}="Yes",AND({2}="Yes",{3}="Yes")),"%s",IF(H{0}<={4},"%s",IF(H{0}<={4}+12,"%s",IF(H{0}<={4}+36,"%s","%s"))))))' % (CLS[0], CLS[5], CLS[1], CLS[2], CLS[3], CLS[4])).format(r, LI('L', r), ST('$B$12'), LI('K', r), SSM), 'txt', out=True)
    cl.f('J%d' % r, 'IF(OR(A{0}="",G{0}="Yes"),"",IF(F{0}>60,"SMA-2",IF(F{0}>30,"SMA-1",IF(F{0}>0,"SMA-0",""))))'.format(r), 'txt')
    cl.f('K%d' % r, 'IF(A{0}="","",IF({1}="Secured",MIN(D{0},N({2})),0))'.format(r, LI('D', r), LI('I', r))); cl.f('L%d' % r, 'IF(A{0}="","",D{0}-K{0})'.format(r))
    cl.f('M%d' % r, ('IF(A{0}="","",IF(I{0}="%s",D{0}*{1},IF(I{0}="%s",D{0}*{2},IF(I{0}="%s",D{0}*{3},L{0}*{4}+K{0}*IF(I{0}="%s",{5},IF(I{0}="%s",{6},{7}))))))' % (CLS[0], CLS[1], CLS[5], CLS[2], CLS[3])).format(r, STD, ST('$B$15'), ST('$B$20'), ST('$B$19'), ST('$B$16'), ST('$B$17'), ST('$B$18')), 'num', out=True)
    cl.f('N%d' % r, 'IF(OR(A{0}="",D{0}=0),"",M{0}/D{0})'.format(r), 'pct')
    cl.f('O%d' % r, ('IF(A{0}="","",IF(G{0}<>"Yes",IF(J{0}<>"","Overdue but within the norm","Regular"),IF({1}="Yes","Identified as loss",IF(AND({2}="Yes",{3}="Yes"),"Declared fraud",IF(E{0}>{4},"Own dues overdue beyond the norm",IF(F{0}>{4},"Another loan of the borrower is non-performing","NPA earlier; arrears not fully cleared"))))))').format(r, LI('L', r), ST('$B$12'), LI('K', r), NPAD), 'txt')
CR = lambda c: "'Classification'!$%s$%d:$%s$%d" % (c, R0, c, RE)

sm = B.sheet('Summary', (30, 14, 16, 16, 16, 16, 16, 14), tab='00B050')
sm.title('Summary – totals by asset class and by product', 'No inputs.')
sm.head(6, ['Asset class', 'Loans (number)', 'Total dues', 'Secured portion', 'Unsecured portion', 'Provision required', 'Net of provision', 'Share of total'])
for j, c_ in enumerate(CLS):
    r = 7 + j; sm.lbl('A%d' % r, c_); sm.f('B%d' % r, 'COUNTIF(%s,A%d)' % (CR('I'), r), 'int')
    for col, src in zip('CDEF', 'DKLM'):
        sm.f('%s%d' % (col, r), 'SUMIF(%s,$A%d,%s)' % (CR('I'), r, CR(src)))
    sm.f('G%d' % r, 'C%d-F%d' % (r, r)); sm.f('H%d' % r, div('C%d' % r, 'C$13'), 'pct')
sm.lbl('A13', 'Total', True)
for col in 'BCDEFG':
    sm.f('%s13' % col, 'SUM(%s7:%s12)' % (col, col), 'int' if col == 'B' else 'num', out=True)
sm.head(16, ['Special mention accounts', 'Loans (number)', 'Total dues'])
for j, c_ in enumerate(['SMA-0', 'SMA-1', 'SMA-2']):
    r = 17 + j; sm.lbl('A%d' % r, c_); sm.f('B%d' % r, 'COUNTIF(%s,A%d)' % (CR('J'), r), 'int'); sm.f('C%d' % r, 'SUMIF(%s,A%d,%s)' % (CR('J'), r, CR('D')))
NP = 15
sm.head(23, ['Product (type the product names used in Loan Input)', 'Total dues', 'Standard', 'Sub-standard', 'Doubtful (all)', 'Loss', 'Provision required', 'Gross NPA %'])
for j in range(NP):
    r = 24 + j; sm.inp('A%d' % r, 'summary.product.%d' % (j + 1), 'Product %d name' % (j + 1), None, 'txt', 'Product list of the company')
    sm.f('B%d' % r, 'IF(A{0}="",0,SUMIF({1},A{0},{2}))'.format(r, CR('C'), CR('D')))
    sm.f('C%d' % r, 'IF(A{0}="",0,SUMIFS({2},{1},A{0},{3},"{4}"))'.format(r, CR('C'), CR('D'), CR('I'), CLS[0])); sm.f('D%d' % r, 'IF(A{0}="",0,SUMIFS({2},{1},A{0},{3},"{4}"))'.format(r, CR('C'), CR('D'), CR('I'), CLS[1]))
    sm.f('E%d' % r, 'IF(A{0}="",0,SUMIFS({2},{1},A{0},{3},"Doubtful*"))'.format(r, CR('C'), CR('D'), CR('I'))); sm.f('F%d' % r, 'IF(A{0}="",0,SUMIFS({2},{1},A{0},{3},"{4}"))'.format(r, CR('C'), CR('D'), CR('I'), CLS[5]))
    sm.f('G%d' % r, 'IF(A{0}="",0,SUMIF({1},A{0},{2}))'.format(r, CR('C'), CR('M'))); sm.f('H%d' % r, div('D{0}+E{0}+F{0}'.format(r), 'B%d' % r), 'pct')
sm.lbl('A39', 'Total of the products listed', True)
for col in 'BCDEFG':
    sm.f('%s39' % col, 'SUM(%s24:%s38)' % (col, col), out=True)

db = B.sheet('Dashboard', (52, 18, 12, 46), tab='00B050')
db.title('Dashboard – asset quality', 'Red / Amber / Green against the thresholds on Setup.')
db.f('A3', '"Company: "&%s&"   |   As at: "&TEXT(%s,"DD-MMM-YYYY")&"   |   Amounts in "&%s' % (ST('B4'), DT, ST('B6')), 'txt')
db.head(5, ['Indicator', 'Value', 'Result', 'Meaning'])
GN = "('Summary'!$C$13-'Summary'!$C$7)"; PV = "('Summary'!$F$13-'Summary'!$F$7)"; TOT = "'Summary'!$C$13"
kp = [('Total dues', TOT, 'num', None, ''), ('Gross NPA', GN, 'num', None, 'Sub-standard, doubtful and loss'), ('Gross NPA ratio', div(GN, TOT), 'pct', ('22', '23'), ''), ('Provision required on NPAs', PV, 'num', None, ''),
      ('Net NPA ratio', div('%s-%s' % (GN, PV), '%s-%s' % (TOT, PV)), 'pct', ('24', '25'), 'After the provision required'), ('Provision coverage on NPAs', div(PV, GN), 'pct', None, ''), ('Provision required on standard assets', "'Summary'!$F$7", 'num', None, ''),
      ('Total provision required', "'Summary'!$F$13", 'num', None, 'Prudential floor for the ECL model'), ('SMA-2 share of standard loans', div("'Summary'!$C$19", "'Summary'!$C$7"), 'pct', ('26', '27'), 'Loans 61 to 90 days overdue'),
      ('Loans non-performing only because of another loan of the borrower (number)', 'COUNTIF(%s,"Another loan of the borrower is non-performing")' % CR('O'), 'int', None, 'Borrower-level classification'),
      ('Loans kept as NPA because arrears are not fully cleared (number)', 'COUNTIF(%s,"NPA earlier; arrears not fully cleared")' % CR('O'), 'int', None, 'Upgrade rule'), ('Loans in the table', "'Summary'!$B$13", 'int', None, '')]
for j, (lab, fm, fmt, th, why) in enumerate(kp):
    r = 6 + j; db.lbl('A%d' % r, lab); db.f('B%d' % r, fm, fmt, out=True); db.lbl('D%d' % r, why)
    if th: db.f('C%d' % r, 'IF(%s=0,"",%s)' % (TOT, rag_hi_bad('B%d' % r, ST('$B$' + th[0]), ST('$B$' + th[1]))), 'txt')
db.rag('C6:C18'); db.lbl('A20', 'Open items on the Checks sheet', True); db.f('B20', 'COUNTIF(%s,"CHECK")' % q('Checks', 'C6:C13'), 'int'); db.f('C20', 'IF(B20=0,"OK","CHECK")', 'txt'); db.rag('C20')

ho = B.sheet('Handover', (30, 15, 15, 15, 15, 15, 15, 15), tab='7030A0')
ho.title('Handover – figures for the ECL model (Prudential Floor) and the Ratio model', 'By product, in the order of the Summary sheet. Doubtful amounts are split into secured portion by age and unsecured portion, as the ECL model needs them.')
ho.head(5, ['Product', 'Gross loans', 'Sub-standard', 'Doubtful secured: up to 1 year', 'Doubtful secured: 1 to 3 years', 'Doubtful secured: over 3 years', 'Doubtful: unsecured portion', 'Loss assets'])
for j in range(NP):
    r = 6 + j; sr = 24 + j; a = "'Summary'!$A$%d" % sr
    ho.f('A%d' % r, 'IF(%s="","",%s)' % (a, a), 'txt'); ho.f('B%d' % r, "'Summary'!B%d" % sr); ho.f('C%d' % r, "'Summary'!D%d" % sr)
    for col, c_ in zip('DEF', CLS[2:5]):
        ho.f('%s%d' % (col, r), 'IF({0}="",0,SUMIFS({1},{2},{0},{3},"{4}"))'.format(a, CR('K'), CR('C'), CR('I'), c_))
    ho.f('G%d' % r, 'IF({0}="",0,SUMIFS({1},{2},{0},{3},"Doubtful*"))'.format(a, CR('L'), CR('C'), CR('I'))); ho.f('H%d' % r, "'Summary'!F%d" % sr)
ho.head(23, ['For the Ratio model', 'Value'])
for j, (lab, fm) in enumerate([('Standard assets', "'Summary'!$C$7"), ('Gross non-performing assets', GN), ('Provisions required for non-performing assets', PV), ('Provision required for standard assets', "'Summary'!$F$7"), ('SMA-2', "'Summary'!$C$19"), ('Loans overdue more than 30 days (including NPAs)', "'Summary'!$C$18+'Summary'!$C$19+" + GN)]):
    ho.lbl('A%d' % (24 + j), lab); ho.f('B%d' % (24 + j), fm, out=True)

ru = B.sheet('Rules', (6, 40, 80, 50), tab='7030A0', protect=False)
ru.title('Rules – classification and provisioning rules in one table', 'For use in a loan management system. Parameters in capitals are the Setup values.')
ru.head(5, ['#', 'Rule', 'Logic', 'Parameter'])
for j, (a, b_, c_) in enumerate([('Total dues', 'principal outstanding + interest overdue', ''), ('Borrower worst days past due', 'maximum days past due across all loans with the same borrower ID (when BORROWER LEVEL = Yes)', 'norm.borrower'),
      ('Non-performing', 'borrower worst days past due > NPA DAYS; or NPA at last reporting date and not all arrears cleared (when UPGRADE RULE = Yes); or identified as loss; or declared fraud (when FRAUD AS LOSS = Yes)', 'norm.npa; norm.upgrade; norm.fraud'),
      ('Months as NPA', '(reporting date - date first classified NPA) / 30.4375; if the date is blank, reporting date - (borrower worst days past due - NPA DAYS)', ''),
      ('Asset class', 'not NPA: Standard; identified as loss or fraud: Loss; months as NPA <= SUB-STANDARD MONTHS: Sub-standard; <= +12: Doubtful up to 1 year; <= +36: Doubtful 1 to 3 years; else Doubtful over 3 years', 'norm.ss'),
      ('Special mention category', 'standard loans only: 1-30 days SMA-0; 31-60 SMA-1; 61-90 SMA-2', ''), ('Secured portion', 'secured loans: lower of total dues and realisable value of security; unsecured loans: nil', ''),
      ('Provision', 'Standard: dues x STANDARD RATE; Sub-standard: dues x 10%; Doubtful: unsecured portion x 100% + secured portion x 20% / 30% / 50% by age; Loss: dues x 100%', 'rate.std; rate.ss; rate.d1; rate.d2; rate.d3; rate.du; rate.loss')], 1):
    for col, v in zip('ABCD', (j, a, b_, c_)): ru.lbl('%s%d' % (col, 5 + j), v)

m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how this engine produces its results')
m.text_block(4, ['# 1. Overall logic', 'Each row of Loan Input is classified on the Classification sheet in six steps: total dues, the borrower\'s worst days past due, whether the loan is non-performing, how long it has been non-performing, its asset class, and the provision. The Summary adds the loans by class and product.',
 '# 2. Non-performing asset', 'A loan is non-performing when it is overdue for more than the number of days on Setup (90). With borrower-level classification switched on, every loan of a borrower takes the worst days past due among that borrower\'s loans, so that all facilities of a borrower are classified together. A loan that was non-performing at the last reporting date stays non-performing until all arrears of interest and principal are cleared. A loan identified as loss, or declared fraud where that option is on, is non-performing whatever its days past due.',
 '# 3. Age as NPA and asset class', 'Months as NPA are counted from the date the loan was first classified NPA; if that date is not given, it is estimated as the days past due in excess of the norm. Up to the sub-standard period (12 months) the loan is sub-standard; for the next 12 months doubtful up to 1 year; for the next 24 months doubtful 1 to 3 years; after that doubtful over 3 years. A loss asset is one identified as such by the company, its auditors or the Reserve Bank.',
 '# 4. Provision', 'Standard assets: dues x the standard asset rate. Sub-standard: 10 per cent of dues. Doubtful: 100 per cent of the unsecured portion plus 20, 30 or 50 per cent of the secured portion by age. Loss: 100 per cent. The secured portion is the lower of the dues and the realisable value of security.',
 '# 5. Special mention accounts', 'Standard loans overdue 1 to 30 days are SMA-0, 31 to 60 days SMA-1 and 61 to 90 days SMA-2.',
 '# 6. Relation to Ind AS', 'For a company on Ind AS the provision here is the prudential floor: where the Ind AS impairment allowance is lower, the difference goes to the Impairment Reserve. The Handover sheet gives the figures in the layout of the ECL model.',
 '# 7. Limits', 'The engine handles %d loans; larger books are run in batches by product, or the rules on the Rules sheet are coded in the loan system. It does not apply special rules for particular facilities (for example agricultural loans, project loans under implementation, or restructured accounts with their own upgrade conditions); mark such loans and review them by hand.' % NL])

ck = B.sheet('Checks', (6, 76, 12, 54), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
chk = [('Reporting date and company name are entered', 'AND(%s<>"",%s<>"")' % (ST('$B$4'), DT), 'Complete Setup'), ('At least one loan is entered', 'COUNTA(%s)>0' % LR('A'), 'Paste the loan data'), ('No loan ID is repeated', 'SUMPRODUCT((%s<>"")/COUNTIF(%s,%s&""))=COUNTA(%s)' % (LR('A'), LR('A'), LR('A'), LR('A')), 'Remove duplicate rows'),
       ('Every loan has a borrower ID and a product', 'AND(COUNTA(%s)=COUNTA(%s),COUNTA(%s)=COUNTA(%s))' % (LR('B'), LR('A'), LR('C'), LR('A')), 'Fill the missing cells'), ('No negative outstanding or days past due', 'AND(COUNTIF(%s,"<0")=0,COUNTIF(%s,"<0")=0)' % (LR('E'), LR('G')), 'Correct the data'),
       ('Every secured non-performing loan has a security value', 'SUMPRODUCT((%s="Secured")*(%s="Yes")*(%s=""))=0' % (LR('D'), CR('G'), LR('I')), 'Enter the realisable value of security'), ('No NPA date is after the reporting date', 'COUNTIF(%s,">"&%s)=0' % (LR('H'), DT), 'Correct the dates'),
       ('Products listed on Summary cover the whole book (within 1 per cent)', "ABS('Summary'!$B$39-'Summary'!$C$13)<=0.01*MAX(1,'Summary'!$C$13)", 'List every product name on the Summary sheet exactly as in Loan Input')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C13')
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Loan Input', 'Classification', 'Summary', 'Dashboard', 'Handover', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('IRACP engine built:', len(B.wb.sheetnames), 'sheets,', NL, 'loan rows')
