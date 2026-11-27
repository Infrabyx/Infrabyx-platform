"""Dividend Eligibility and Early Warning Monitor. Run: python3 build_dividend.py <out.xlsx> <map.json>"""
import sys
from xl import *

B = Book('DIV-M01', 'Dividend Eligibility and Early Warning Monitor')
YN = ['Yes', 'No']
DD = 'RBI (NBFCs – Prudential Norms on Declaration of Dividends) Directions, 2025'; PCA = 'RBI (NBFCs – Miscellaneous) Supervisory Directions, 2026, paras 16 and 17'
TYPES = ['Other NBFC', 'Core Investment Company', 'Type I NBFC', 'Base Layer with customer interface and no public funds']

readme(B, 'Dividend Eligibility and Early Warning Monitor',
       ['This workbook tests whether the company may declare a dividend for a financial year, works out the highest dividend it may pay, and compares the proposed dividend with that ceiling. It also places the capital ratios and the net NPA ratio against the risk thresholds of the Prompt Corrective Action framework, so that the Board sees an early warning.',
        'Standalone Primary Dealers follow separate rules and are not covered.'],
       ['Setup: enter the type of company and confirm the thresholds.', 'Yearly Input: enter three years of capital compliance, net NPA and ratios, and the profit and dividend figures.', 'Read Eligibility, Payout and Early Warning.',
        'Board Note: record what the Board considered and the reporting date.', 'Clear the Checks sheet.'],
       [('Method Notes', 'explains every test'), ('Setup', 'type of company and thresholds'), ('Yearly Input', 'three years of data; profit and dividend'), ('Eligibility', 'tests for declaring dividend'), ('Payout', 'ceiling and proposed dividend'),
        ('Early Warning', 'position against risk thresholds'), ('Board Note', 'matters considered and reporting'), ('Rules', 'rules for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Setup', (70, 26, 60), tab='C00000')
s.title('Setup – type of company and thresholds', 'Yellow cells are inputs. Thresholds are defaults; confirm for the company.')
R = [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None, ''), (5, 'Amounts are in', 'setup.units', '₹ crore', 'txt', ['₹ crore', '₹ lakh', '₹'], ''), (6, 'Type of company for the ceiling on dividend', 'setup.type', 'Other NBFC', 'txt', TYPES, DD + ', para 9, Table 2'),
     (7, 'Years to be tested (3; fewer only if registered for less than three financial years)', 'setup.years', 3, 'int', ['1', '2', '3'], DD + ', para 8, proviso'), (9, 'Net NPA ratio below which dividend may be declared', 'th.nnpa', 0.06, 'pct', None, DD + ', para 8'),
     (10, 'Net NPA ratio below which the reduced payout is allowed', 'th.nnpa2', 0.04, 'pct', None, DD + ', para 11'), (11, 'Payout ceiling where only the current-year conditions are met', 'th.cap', 0.10, 'pct', None, DD + ', para 11'),
     (12, 'Payout ceiling – Core Investment Company', 'th.cic', 0.60, 'pct', None, DD + ', para 9, Table 2'), (13, 'Payout ceiling – other NBFC', 'th.other', 0.50, 'pct', None, DD + ', para 9, Table 2'),
     (15, 'Prompt Corrective Action framework applies to the company', 'pca.applies', 'Yes', 'txt', YN, 'RBI (NBFCs – Miscellaneous) Supervisory Directions, 2026, para 3, proviso on Chapter V: deposit-taking NBFCs and non-deposit taking NBFCs in the Middle and Upper Layers; not NBFCs without public funds, Primary Dealers or HFCs'), (16, 'Minimum CRAR', 'pca.crar', 0.15, 'pct', None, 'Capital Adequacy Directions, para 6; for a CIC enter the minimum ANW / RWA of 30 per cent (CIC Directions, para 20)'),
     (17, 'Minimum Tier 1 ratio', 'pca.t1', 0.10, 'pct', None, 'Capital Adequacy Directions, para 6 (12 per cent for an NBFC lending mainly against gold)'), (18, 'CRAR shortfall that moves the company to risk threshold 2 (percentage points; 0.06 for a CIC)', 'pca.step', 0.03, 'pct', None, PCA),
     (19, 'Tier 1 shortfall that moves the company to risk threshold 2 (percentage points)', 'pca.step1', 0.02, 'pct', None, PCA), (20, 'Net NPA ratio: risk threshold 1 above', 'pca.n1', 0.06, 'pct', None, PCA), (21, 'Net NPA ratio: risk threshold 2 above', 'pca.n2', 0.09, 'pct', None, PCA),
     (22, 'Net NPA ratio: risk threshold 3 above', 'pca.n3', 0.12, 'pct', None, PCA), (23, 'Internal early-warning margin (percentage points from a threshold)', 'pca.margin', 0.01, 'pct', None, 'Board-approved risk appetite')]
for r, lab, key, d, fmt, lst, src in R:
    s.lbl('A%d' % r, lab); s.lbl('C%d' % r, src); s.inp('B%d' % r, key, lab, d, fmt, src or 'Company', lst)
ST = lambda c: q('Setup', c)

y = B.sheet('Yearly Input', (70, 20, 20, 20, 44), tab='BF9000')
y.title('Yearly Input – three years, profit and dividend', 'Column D is the financial year for which the dividend is proposed.')
y.head(6, ['Item', 'Second preceding year', 'Preceding year', 'Year of the proposed dividend', 'Source'])
YR = [(7, 'Financial year', 'label', 'txt', None, ''), (8, 'Applicable regulatory capital requirement met throughout (CRAR, Tier 1, Tier 2, leverage, adjusted net worth, as applicable)', 'cap', 'txt', YN, 'DNBS03; capital computation'),
      (9, 'Net NPA at year end', 'nnpa', 'num', None, 'Audited financial statements; DNBS01'), (10, 'Net advances at year end', 'adv', 'num', None, 'Audited financial statements'), (12, 'CRAR at year end', 'crar', 'pct', None, 'DNBS03'), (13, 'Tier 1 ratio at year end', 't1', 'pct', None, 'DNBS03')]
for r, lab, key, fmt, lst, src in YR:
    y.lbl('A%d' % r, lab); y.lbl('E%d' % r, src)
    for i, c in enumerate('BCD', 1): y.inp('%s%d' % (c, r), 'yr.%s.%d' % (key, i), '%s – year %d of 3' % (lab.split(' (')[0], i), None, fmt, src or 'Company', lst)
y.lbl('A11', 'Net NPA ratio (net NPA / net advances)', True)
for c in 'BCD': y.f('%s11' % c, 'IF(N(%s10)=0,"",N(%s9)/%s10)' % (c, c, c), 'pct', out=True)
y.sec('A15', 'Year of the proposed dividend', 5)
DR = [(16, 'Transfer to the reserve fund under section 45-IC of the RBI Act made (section 29C of the NHB Act for a housing finance company)', 'div.reserve', 'txt', YN, DD + ', para 8'), (17, 'Compliant with the regulations and guidelines of the Reserve Bank', 'div.reg', 'txt', YN, DD + ', para 8'),
      (18, 'The Reserve Bank has placed no explicit restriction on declaring dividend', 'div.free', 'txt', YN, DD + ', para 8'), (19, 'Net profit after tax as per the audited financial statements', 'div.pat', 'num', None, 'Audited financial statements'),
      (20, 'Exceptional or extraordinary profit or income included in net profit', 'div.except', 'num', None, DD + ', para 9'), (21, 'Overstatement of net profit indicated by an audit qualification or emphasis of matter', 'div.overstate', 'num', None, DD + ', para 9; auditor\'s report'),
      (22, 'Interim dividend on equity shares declared for the year', 'div.interim', 'num', None, 'Board minutes'), (23, 'Final dividend on equity shares proposed', 'div.final', 'num', None, 'Board note'),
      (24, 'Dividend on compulsorily convertible preference shares eligible for Tier 1', 'div.ccps', 'num', None, DD + ', para 9')]
for r, lab, key, fmt, lst, src in DR:
    y.lbl('A%d' % r, lab); y.lbl('E%d' % r, src); y.inp('B%d' % r, key, lab.split(' (')[0], None, fmt, src, lst)
YI = lambda c: q('Yearly Input', c)
K = 'N(%s)' % ST('$B$7')
GUARD[0] = '%s=""' % YI('$D$8')

e = B.sheet('Eligibility', (76, 22, 56), tab='00B050')
e.title('Eligibility – may the company declare a dividend?', DD + ', paras 8 and 11.')
e.head(4, ['Test', 'Result', 'Basis'])
allyrs = lambda cond: 'AND(OR(%s<3,%s),OR(%s<2,%s),%s)' % (K, cond('B'), K, cond('C'), cond('D'))
ER = [(5, 'Capital requirement met in each year tested', 'IF(%s,"Yes","No")' % allyrs(lambda c: YI('%s8' % c) + '="Yes"'), 'Para 8, Table 1, item 1'),
      (6, 'Net NPA ratio below the limit in each year tested', 'IF(%s,"Yes","No")' % allyrs(lambda c: 'AND(%s<>"",N(%s)<%s)' % (YI('%s11' % c), YI('%s11' % c), ST('$B$9'))), 'Para 8, Table 1, item 2'),
      (7, 'Reserve fund transfer made', 'IF(%s="Yes","Yes","No")' % YI('B16'), 'Para 8, Table 1, item 3'), (8, 'Compliant with regulations and guidelines', 'IF(%s="Yes","Yes","No")' % YI('B17'), 'Para 8, Table 1, item 3'),
      (9, 'No restriction placed by the Reserve Bank', 'IF(%s="Yes","Yes","No")' % YI('B18'), 'Para 8, Table 1, item 3'),
      (11, 'Eligible on the full tests', 'IF(AND(B5="Yes",B6="Yes",B7="Yes",B8="Yes",B9="Yes"),"Yes","No")', 'All five tests'),
      (12, 'Capital requirement met at the close of the year', 'IF(%s="Yes","Yes","No")' % YI('D8'), 'Para 11'), (13, 'Net NPA ratio at the close of the year below the lower limit', 'IF(AND(%s<>"",N(%s)<%s),"Yes","No")' % (YI('D11'), YI('D11'), ST('$B$10')), 'Para 11'),
      (14, 'Eligible with the reduced payout', 'IF(AND(B11="No",B12="Yes",B13="Yes",B7="Yes",B8="Yes",B9="Yes"),"Yes","No")', 'Capital and net NPA tests failed for the three years but met for the current year')]
for r, lab, fm, basis in ER:
    e.lbl('A%d' % r, lab); e.f('B%d' % r, 'IF(%s,"",%s)' % (GUARD[0], fm), 'txt'); e.lbl('C%d' % r, basis)
e.lbl('A16', 'Conclusion', True); e.f('B16', 'IF(%s,"",IF(B11="Yes","Eligible",IF(B14="Yes","Eligible – reduced payout","Not eligible")))' % GUARD[0], 'txt', out=True)
e.lbl('A17', 'Status', True); e.f('B17', 'IF(B16="","",IF(B16="Eligible","GREEN",IF(B16="Not eligible","RED","AMBER")))', 'txt'); e.rag('B17')
EL = lambda c: q('Eligibility', c)

p = B.sheet('Payout', (76, 22, 56), tab='00B050')
p.title('Payout – ceiling and proposed dividend', DD + ', paras 7, 9 and 11.')
NOCEIL = 'OR(%s="Type I NBFC",%s="%s")' % (ST('$B$6'), ST('$B$6'), TYPES[3])
PR = [(4, 'Net profit after tax', 'N(%s)' % YI('B19'), 'num', ''), (5, 'Less: exceptional or extraordinary profit, and overstatement indicated by the auditor', 'N(%s)+N(%s)' % (YI('B20'), YI('B21')), 'num', 'Para 9'), (6, 'Net profit for the payout ratio', 'B4-B5', 'num', ''),
      (7, 'Total dividend for the year (interim + final + eligible preference shares)', 'N(%s)+N(%s)+N(%s)' % (YI('B22'), YI('B23'), YI('B24')), 'num', 'Para 9; "dividends" include interim dividend'),
      (8, 'Dividend payout ratio', 'IF(B6<=0,"",B7/B6)', 'pct', 'Dividend payable in the year / net profit for the year'),
      (9, 'Ceiling on the payout ratio', 'IF(%s="","",IF(%s="Not eligible",0,IF(%s="Eligible – reduced payout",%s,IF(%s,"No ceiling",IF(%s="Core Investment Company",%s,%s)))))' % (EL('B16'), EL('B16'), EL('B16'), ST('$B$11'), NOCEIL, ST('$B$6'), ST('$B$12'), ST('$B$13')), 'pct', 'Para 9, Table 2; para 11'),
      (10, 'Highest dividend that may be paid', 'IF(B9="","",IF(B9="No ceiling","No ceiling",MAX(0,B9*B6)))', 'num', 'Ceiling x net profit for the payout ratio'), (11, 'Room left (+) or excess (–)', 'IF(OR(B9="",B9="No ceiling"),"",B10-B7)', 'num', ''),
      (12, 'Result', 'IF(B9="","",IF(B9="No ceiling","GREEN",IF(B7>B10+0.0000001,"RED",IF(B7>0.9*B10,"AMBER","GREEN"))))', 'txt', 'Amber: within 10 per cent of the ceiling')]
for r, lab, fm, fmt, nt in PR:
    p.lbl('A%d' % r, lab); p.f('B%d' % r, fm, fmt, out=r in (8, 10)); p.lbl('C%d' % r, nt)
p.rag('B12')

w = B.sheet('Early Warning', (60, 18, 18, 18, 24, 14), tab='00B050')
w.title('Early Warning – position against the risk thresholds', PCA + '. Thresholds are on Setup.')
w.head(4, ['Indicator', 'Second preceding year', 'Preceding year', 'Latest year', 'Position (latest year)', 'Status'])
MC, M1, SC_, S1, N1, N2, N3, MG = [ST('$B$%d' % r) for r in (16, 17, 18, 19, 20, 21, 22, 23)]
for r, lab, src, fmt in [(5, 'CRAR', 12, 'pct'), (6, 'Tier 1 ratio', 13, 'pct'), (7, 'Net NPA ratio', 11, 'pct')]:
    w.lbl('A%d' % r, lab)
    for c in 'BCD': w.f('%s%d' % (c, r), 'IF(%s="","",%s)' % (YI('%s%d' % (c, src)), YI('%s%d' % (c, src))), fmt)
w.f('E5', 'IF(D5="","",IF(D5>=%s,"No threshold breached",IF(D5>=%s-%s,"Risk threshold 1",IF(D5>=%s-2*%s,"Risk threshold 2","Risk threshold 3"))))' % (MC, MC, SC_, MC, SC_), 'txt')
w.f('E6', 'IF(D6="","",IF(D6>=%s,"No threshold breached",IF(D6>=%s-%s,"Risk threshold 1",IF(D6>=%s-2*%s,"Risk threshold 2","Risk threshold 3"))))' % (M1, M1, S1, M1, S1), 'txt')
w.f('E7', 'IF(D7="","",IF(D7<=%s,"No threshold breached",IF(D7<=%s,"Risk threshold 1",IF(D7<=%s,"Risk threshold 2","Risk threshold 3"))))' % (N1, N2, N3), 'txt')
w.f('F5', 'IF(D5="","",IF(D5<%s,"RED",IF(D5<%s+%s,"AMBER","GREEN")))' % (MC, MC, MG), 'txt'); w.f('F6', 'IF(D6="","",IF(D6<%s,"RED",IF(D6<%s+%s,"AMBER","GREEN")))' % (M1, M1, MG), 'txt')
w.f('F7', 'IF(D7="","",IF(D7>%s,"RED",IF(D7>%s-%s,"AMBER","GREEN")))' % (N1, N1, MG), 'txt'); w.rag('F5:F7')
w.lbl('A9', 'Overall position', True)
w.f('B9', 'IF(COUNT(D5:D7)=0,"",IF(%s<>"Yes","Framework not applicable – internal warning only",IF(COUNTIF(E5:E7,"Risk threshold 3")>0,"Risk threshold 3",IF(COUNTIF(E5:E7,"Risk threshold 2")>0,"Risk threshold 2",IF(COUNTIF(E5:E7,"Risk threshold 1")>0,"Risk threshold 1","No threshold breached")))))' % ST('$B$15'), 'txt', out=True)
w.lbl('A10', 'Overall status', True); w.f('B10', 'IF(COUNT(D5:D7)=0,"",IF(COUNTIF(F5:F7,"RED")>0,"RED",IF(COUNTIF(F5:F7,"AMBER")>0,"AMBER","GREEN")))', 'txt'); w.rag('B10')
w.note('A12', 'A breach of a risk threshold is reported to the Board at once. The corrective actions that follow are set by the Reserve Bank under the framework.')

bn = B.sheet('Board Note', (70, 60), tab='BF9000')
bn.title('Board Note – matters considered and reporting', DD + ', paras 6, 7 and 13.')
BN = [(4, 'Supervisory findings on divergence in classification and provisioning for NPAs – considered as follows', 'board.divergence', 'txt'), (5, 'Qualifications in the auditor\'s report – considered as follows', 'board.qualification', 'txt'), (6, 'Long-term growth plans – considered as follows', 'board.growth', 'txt'),
      (7, 'Date of declaration of the dividend', 'board.date', 'date')]
for r, lab, key, fmt in BN:
    bn.lbl('A%d' % r, lab); bn.inp('B%d' % r, key, lab, None, fmt, 'Board note and minutes')
bn.lbl('A8', 'Report of dividend declared to be filed with the Reserve Bank by (within a fortnight of declaration)', True); bn.f('B8', 'IF(B7="","",B7+14)', 'date', out=True)
bn.lbl('A9', 'Conclusion on eligibility'); bn.f('B9', EL('B16'), 'txt'); bn.lbl('A10', 'Dividend payout ratio and ceiling'); bn.f('B10', 'IF(Payout!B8="","",TEXT(Payout!B8,"0.0%")&" against "&IF(Payout!B9="No ceiling","no ceiling",TEXT(Payout!B9,"0.0%")))', 'txt')

ru = B.sheet('Rules', (6, 40, 86, 46), tab='7030A0', protect=False)
ru.title('Rules – dividend and early-warning rules in one table', 'For use in a compliance tool.'); ru.head(5, ['#', 'Rule', 'Logic', 'Reference'])
RL = [('Capital test', 'applicable regulatory capital requirement met in each of the last three financial years including the year of the dividend (since registration if younger)', DD + ', para 8'), ('Net NPA test', 'net NPA / net advances < 6% in each of the last three years including the year of the dividend', DD + ', para 8'),
      ('Other criteria', 'reserve fund transfer under section 45-IC made; compliant with regulations; no explicit restriction by the Reserve Bank', DD + ', para 8'), ('Reduced payout', 'capital or net NPA test failed for the three years, but capital met and net NPA < 4% at the close of the year: payout ratio <= 10%', DD + ', para 11'),
      ('Net profit for the ratio', 'net profit after tax - exceptional or extraordinary profit - overstatement indicated by audit qualification or emphasis of matter', DD + ', para 9'), ('Dividend', 'interim + final equity dividend + dividend on compulsorily convertible preference shares eligible for Tier 1', DD + ', para 9'),
      ('Ceiling', 'Core Investment Company 60%; other NBFC 50%; none for a Type I NBFC and for a Base Layer NBFC with customer interface not accepting public funds', DD + ', para 9, Table 2'), ('Reporting', 'report within a fortnight after declaration to the Regional Office of the Department of Supervision', DD + ', para 13'),
      ('Risk thresholds – CRAR', 'below minimum by up to 300 basis points: threshold 1; by more than 300 and up to 600: threshold 2; by more than 600: threshold 3', PCA), ('Risk thresholds – Tier 1', 'below minimum by up to 200 basis points: threshold 1; by more than 200 and up to 400: threshold 2; by more than 400: threshold 3', PCA),
      ('Risk thresholds – net NPA', 'above 6% up to 9%: threshold 1; above 9% up to 12%: threshold 2; above 12%: threshold 3', PCA)]
for j, (a_, b_, c_) in enumerate(RL, 1):
    for col, v in zip('ABCD', (j, a_, b_, c_)): ru.lbl('%s%d' % (col, 5 + j), v)

m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how this monitor produces its results')
m.text_block(4, ['# 1. Eligibility', 'The company must have met its applicable regulatory capital requirement and kept its net NPA ratio below 6 per cent in each of the last three financial years, including the year for which the dividend is proposed; it must have made the reserve fund transfer, be compliant with the regulations and be under no restriction. Where the company has existed for fewer than three financial years, set the number of years on Setup.',
 '# 2. Reduced payout', 'A company that fails the capital or net NPA test for the three years may still declare dividend with a payout ratio capped at 10 per cent, if it meets the capital requirement and has a net NPA ratio below 4 per cent at the close of the year. The monitor applies this automatically.',
 '# 3. Payout ratio and ceiling', 'Payout ratio = dividend payable for the year (including interim dividend and dividend on eligible preference shares) / net profit for the year. Exceptional or extraordinary profit and any overstatement of profit indicated by the auditor are taken out of net profit. The ceiling depends on the type of company chosen on Setup.',
 '# 4. Early warning', 'CRAR, the Tier 1 ratio and the net NPA ratio of the latest year are placed against the risk thresholds of the Prompt Corrective Action framework. The minimum ratios and the thresholds are inputs on Setup; the defaults assume a minimum CRAR of 15 per cent and a minimum Tier 1 ratio of 10 per cent. Status is amber when a ratio is within the internal margin of a threshold. The framework applies to deposit-taking NBFCs and to non-deposit taking NBFCs in the Middle and Upper Layers, other than NBFCs without public funds, Primary Dealers and HFCs (RBI (NBFCs – Miscellaneous) Supervisory Directions, 2026, para 3); where it does not apply, the sheet still serves as an internal warning. The thresholds were read against paras 16 and 17 on 25-11-2026 and are measured from the minimums on Setup, so an NBFC lending mainly against gold enters a minimum Tier 1 ratio of 12 per cent. A Core Investment Company is tested on adjusted net worth to risk-weighted assets, leverage and net NPA: enter ANW / RWA in place of CRAR with a minimum of 30 per cent and a step of 6 points, leave the Tier 1 lines blank, and read the leverage ratio from the Ratio Model (RATIO-M01).',
 '# 5. Limits of the monitor', 'Standalone Primary Dealers are not covered. The treatment of reversal of excess provisions and of unrealised profits on transfer of loans follows the Directions on transfer and distribution of credit risk and is not computed here; reduce net profit by hand where it applies. The monitor does not test the Companies Act conditions for dividend (free reserves, depreciation, set-off of losses).'])

ck = B.sheet('Checks', (6, 76, 12, 54), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
chk = [('Capital compliance is answered for every year tested', 'AND(OR(%s<3,%s<>""),OR(%s<2,%s<>""),%s<>"")' % (K, YI('B8'), K, YI('C8'), YI('D8')), 'Complete Yearly Input'), ('Net NPA and net advances are entered for every year tested', 'AND(OR(%s<3,N(%s)>0),OR(%s<2,N(%s)>0),N(%s)>0)' % (K, YI('B10'), K, YI('C10'), YI('D10')), 'Complete Yearly Input'),
       ('The three other criteria are answered', 'COUNTA(%s)=3' % YI('B16:B18'), 'Answer Yes or No'), ('Net profit is entered', 'N(%s)<>0' % YI('B19'), 'Enter net profit after tax'), ('Net NPA does not exceed net advances', 'AND(N(%s)<=N(%s),N(%s)<=N(%s),N(%s)<=N(%s))' % (YI('B9'), YI('B10'), YI('C9'), YI('C10'), YI('D9'), YI('D10')), 'Check the figures'),
       ('Ratios are entered as percentages below 100 per cent', 'AND(N(%s)<1,N(%s)<1)' % (YI('D12'), YI('D13')), 'Enter 15% as 15% (0.15)')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C11')
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Yearly Input', 'Eligibility', 'Payout', 'Early Warning', 'Board Note', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('Dividend monitor built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
