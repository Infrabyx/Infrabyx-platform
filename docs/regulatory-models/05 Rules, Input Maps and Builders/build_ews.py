"""Fraud Early Warning Scoring Model (EWS-M01): indicator library, account-level flags, weighted score and alert, examination tracker and ageing,
review of the effectiveness of each indicator.  Run: python3 build_ews.py <out.xlsx> <map.json>
Paragraph numbers read against the Source text on 25-11-2026: Fraud Risk Management Directions, 2026 (MD 463) paras 3, 14 to 23, 43.
The Directions name four families of indicators (para 19) and prescribe no list, weight or score; the library and all figures are management choices."""
import sys
from xl import *

NI, N, R0 = 30, 300, 8
B = Book('EWS-M01', 'Fraud Early Warning Scoring Model')
FR = 'RBI (NBFCs – Fraud Risk Management) Directions, 2026'; YN = ['Yes', 'No']
FAM = ['Transactional data', 'Financial performance', 'Market intelligence', 'Conduct of the borrower']
ST = ['Not started', 'Under examination', 'Closed – no fraud angle', 'Referred for investigation', 'Classified as fraud']
T, FP, M, C = FAM; QN, QL = 'Quantitative', 'Qualitative'
LIB = [('Repayment instrument or mandate returned unpaid in three or more of the last six months', T, QN, 5, 'No'), ('Loan funds moved to accounts unrelated to the stated purpose of the loan', T, QN, 10, 'No'),
       ('Large cash deposits or withdrawals out of line with the borrower\'s business', T, QN, 5, 'No'), ('Repayments received from third parties with no stated relationship to the borrower', T, QN, 5, 'No'),
       ('Funds moving in a circle among connected accounts', T, QN, 10, 'No'), ('Default on the first instalment or within the first three instalments', T, QN, 10, 'No'),
       ('Early closure of the loan soon after disbursement from a source that is not explained', T, QN, 3, 'No'), ('Same asset, invoice or security financed more than once', T, QN, 15, 'Yes'),
       ('Sharp rise in account turnover just before a request for a higher limit', T, QN, 3, 'No'),
       ('Financial statements or stock statements submitted late or not at all', FP, QN, 3, 'No'), ('Figures given to the company differ materially from those filed with the tax authority or the registrar', FP, QN, 10, 'No'),
       ('Sharp rise in debtors, stock or balances with related parties without matching sales', FP, QN, 5, 'No'), ('Frequent change of statutory auditor, or a qualified audit report', FP, QL, 5, 'No'),
       ('Stock or book debts in the statement not found at inspection', FP, QN, 10, 'No'), ('End-use certificate not given, or diversion of funds reported by the auditor', FP, QL, 10, 'No'),
       ('Large fall in sales or margins that the borrower cannot explain', FP, QN, 3, 'No'),
       ('Adverse report on the borrower from another lender or a credit information company', M, QL, 5, 'No'), ('Search, seizure or investigation by a law enforcement or tax agency', M, QL, 10, 'No'),
       ('Borrower or promoter reported as fraud or wilful defaulter by another lender', M, QL, 15, 'Yes'), ('Insolvency filing, attachment or significant litigation against the borrower', M, QL, 5, 'No'),
       ('Adverse news on the promoter or the group', M, QL, 3, 'No'), ('Valuer, lawyer or other third party on the file is on a caution list', M, QL, 5, 'No'),
       ('Security found charged to another lender, or the charge is not registered', M, QN, 15, 'Yes'),
       ('Document found forged or altered at verification', C, QL, 15, 'Yes'), ('Borrower or guarantor cannot be traced at the address given', C, QL, 10, 'No'),
       ('Borrower refuses or delays inspection of the unit, the security or the books', C, QL, 5, 'No'), ('Frequent change of address, contact details, bank account or key persons', C, QL, 3, 'No'),
       ('Same identity, income or address document used by unrelated applicants', C, QN, 15, 'Yes'), ('Security sold or removed without the consent of the company', C, QL, 15, 'Yes'),
       ('Unusual urgency to release security or to change the terms of the loan', C, QL, 3, 'No')]
assert len(LIB) == NI

readme(B, 'Fraud Early Warning Scoring Model',
       ['This workbook holds the company\'s library of early warning indicators, records which indicators are present in each loan account, and turns them into a weighted score and an alert. Every alert is followed through an examination to its closure, and each indicator is reviewed for how well it works.',
        'It serves paragraphs 14 to 23 of the ' + FR + ', which require NBFCs in the Upper and Middle Layers to run a framework of early warning signals. The Directions prescribe no list of indicators, weights or scores: the library here is illustrative and every figure is a management choice for the Board level committee to approve.'],
       ['Setup: enter the reporting date and confirm the score at which an account turns Amber and Red and the days allowed for an examination.', 'Indicators Input: review the library, change the wording, weights and critical flags, and switch off what does not apply.',
        'Accounts Input: one row per account; put Yes under every indicator that is present, the date of the alert and the status of the examination.', 'Read Scoring, Indicator Review and the Dashboard.', 'Clear the Checks sheet.'],
       [('Method Notes', 'explains the score and the reviews'), ('Setup', 'date and cut-offs'), ('Indicators Input', 'the indicator library'), ('Accounts Input', 'flags and examination status of each account'), ('Scoring', 'score, alert and ageing'),
        ('Indicator Review', 'effectiveness of each indicator'), ('Dashboard', 'summary for the committee'), ('Rules', 'rules for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Setup', (74, 18, 64), tab='C00000')
s.title('Setup – date and cut-offs', 'Yellow cells are inputs. The cut-offs are management choices; the reporting period for a fraud is from the Directions.')
ROW = {}
for r, lab, key, d, fmt, lst, src in [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None, ''), (5, 'Reporting date', 'setup.date', None, 'date', None, 'Date of the account data'),
                                      (6, 'Score from which an account is Amber', 'th.amber', 10, 'int', None, 'Management choice'), (7, 'Score from which an account is Red', 'th.red', 25, 'int', None, 'Management choice'),
                                      (8, 'A critical indicator makes the account Red whatever the score', 'th.crit', 'Yes', 'txt', YN, 'Management choice'), (9, 'Days allowed to complete the examination of an alert', 'th.exam', 30, 'int', None, 'Management choice; para 17(2) asks for timely action'),
                                      (10, 'Days allowed to furnish the Fraud Monitoring Return after classification as fraud', 'th.fmr', 14, 'int', None, FR + ', para 43'),
                                      (11, 'Share of fraud cases the indicators should have caught (target)', 'th.capture', 0.8, 'pct', None, 'Management choice; used in the validation of the framework (para 16)')]:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, d, fmt, src or 'Company', lst); s.lbl('C%d' % r, src); ROW[key] = r
S = lambda k: q('Setup', '$B$%d' % ROW[k]); DT = S('setup.date')

li = B.sheet('Indicators Input', (6, 84, 24, 14, 10, 10, 10), tab='BF9000')
li.title('Indicators Input – the library of early warning indicators', 'Illustrative library in the four families of para 19 of the Directions. Change the wording, weight and flags to suit the business; set Active to No to switch an indicator off.')
li.head(6, ['No.', 'Indicator', 'Family', 'Type', 'Weight', 'Critical', 'Active'])
for j, (txt, fam, ty, w, cr) in enumerate(LIB):
    r = 7 + j; li.lbl('A%d' % r, j + 1)
    for col, v, fmt in (('B', txt, '@'), ('C', fam, '@'), ('D', ty, '@'), ('E', w, '0'), ('F', cr, '@'), ('G', 'Yes', '@')):
        c = li.ws['%s%d' % (col, r)]; c.value = v; c.fill = YEL; c.protection = Protection(locked=False); c.border = BD; c.font = Font(name='Calibri', size=10); c.number_format = fmt; c.alignment = Alignment(wrap_text=True, vertical='top')
for col, items in (('C', FAM), ('D', [QN, QL]), ('F', YN), ('G', YN)):
    dv = DataValidation(type='list', formula1='"%s"' % ','.join(items), allow_blank=True); li.ws.add_data_validation(dv); dv.add('%s7:%s%d' % (col, col, 6 + NI))
B.inputs.append(dict(key='ind', sheet='Indicators Input', cell='B7:G%d' % (6 + NI), label='Indicator library: indicator; family; type; weight; critical; active', source='Fraud risk management policy; Board level committee', default='Illustrative library of %d indicators' % NI))
li.lbl('A%d' % (8 + NI), ''); li.note('B%d' % (8 + NI), FR + ', paras 15 and 19: indicators are identified by the company, are both quantitative and qualitative, and are reviewed periodically for effectiveness.')
IC = lambda c, j: "'Indicators Input'!$%s$%d" % (c, 7 + j)

FC = [L(5 + j) for j in range(NI)]; F0, F1 = FC[0], FC[-1]                      # flag columns E .. AH
AD, SC, CD, FD, MD_ = L(5 + NI), L(6 + NI), L(7 + NI), L(8 + NI), L(9 + NI)      # alert date, status, closed date, fraud date, return date
a = B.sheet('Accounts Input', (14, 26, 18, 16) + (7,) * NI + (13, 22, 13, 13, 13), tab='BF9000')
a.title('Accounts Input – indicators present in each account and the examination of each alert', 'Put Yes under every indicator that is present. The number at the head of each column is the number of the indicator in the library.')
a.lbl('D4', 'Critical (1 = yes)'); a.lbl('D5', 'Weight in use'); a.lbl('D6', 'Family')
for j, col in enumerate(FC):
    a.f('%s4' % col, 'IF(AND(%s="Yes",%s="Yes"),1,0)' % (IC('F', j), IC('G', j)), 'int'); a.f('%s5' % col, 'IF(%s="Yes",N(%s),0)' % (IC('G', j), IC('E', j)), 'int'); a.f('%s6' % col, '%s&""' % IC('C', j), 'txt')
    a.ws['%s6' % col].alignment = Alignment(text_rotation=90, wrap_text=True, vertical='bottom')
a.ws.row_dimensions[6].height = 110
a.head(7, ['Account ID *', 'Borrower', 'Segment', 'Exposure *'] + [str(j + 1) for j in range(NI)] + ['Date of the alert', 'Examination status', 'Date examination closed', 'Date classified as fraud', 'Date the return was furnished'])
a.ws.freeze_panes = 'E8'
for rr in range(R0, R0 + N):
    for i in range(9 + NI):
        col = L(i + 1); c = a.ws['%s%d' % (col, rr)]; c.fill = YEL; c.protection = Protection(locked=False); c.border = BD; c.font = Font(name='Calibri', size=10)
        c.number_format = F['date'] if col in (AD, CD, FD, MD_) else ('#,##0' if col == 'D' else '@')
for rng, items in (('%s%d:%s%d' % (F0, R0, F1, R0 + N - 1), ['Yes']), ('%s%d:%s%d' % (SC, R0, SC, R0 + N - 1), ST)):
    dv = DataValidation(type='list', formula1='"%s"' % ','.join(items), allow_blank=True); a.ws.add_data_validation(dv); dv.add(rng)
B.inputs.append(dict(key='acc', sheet='Accounts Input', cell='A%d:%s%d' % (R0, MD_, R0 + N - 1), label='Accounts: account ID; borrower; segment; exposure; Yes under each of the %d indicators; date of the alert; examination status; date closed; date classified as fraud; date the return was furnished' % NI,
                     source='Loan system; transaction monitoring; credit monitoring; fraud register', default=None))
A = lambda c, r: "'Accounts Input'!%s%d" % (c, r); AR = lambda c: "'Accounts Input'!$%s$%d:$%s$%d" % (c, R0, c, R0 + N - 1)
WT = "'Accounts Input'!$%s$5:$%s$5" % (F0, F1); CR = "'Accounts Input'!$%s$4:$%s$4" % (F0, F1); FM = "'Accounts Input'!$%s$6:$%s$6" % (F0, F1)

x = B.sheet('Scoring', (14, 26, 16, 10, 10, 10, 10, 10, 22, 12, 12, 14, 14, 16, 12), tab='00B050')
x.title('Scoring – score, alert and follow-up of each account', FR + ', paras 15, 19 and 20: an alert calls for an examination of whether the account needs to be investigated from the fraud angle.'); x.ws.freeze_panes = 'C7'
x.head(6, ['Account ID', 'Borrower', 'Exposure', 'Indicators present', 'Critical indicators', 'Families', 'Score', 'Alert', 'Examination status', 'Days open', 'Examination', 'Return due', 'Return', 'Model alert on a confirmed case', 'Ranking key'])
for i in range(N):
    r = 7 + i; ar = R0 + i; on = '%s=""' % A('A', ar); fl = "'Accounts Input'!$%s%d:$%s%d" % (F0, ar, F1, ar); hit = '(%s="Yes")' % fl
    x.f('A%d' % r, 'IF(%s,"",%s&"")' % (on, A('A', ar)), 'txt'); x.f('B%d' % r, 'IF(%s,"",%s&"")' % (on, A('B', ar)), 'txt'); x.f('C%d' % r, 'IF(%s,"",N(%s))' % (on, A('D', ar)), 'int')
    x.f('D%d' % r, 'IF(%s,"",SUMPRODUCT(%s*(%s>0)))' % (on, hit, WT), 'int'); x.f('E%d' % r, 'IF(%s,"",SUMPRODUCT(%s*%s))' % (on, hit, CR), 'int')
    x.f('F%d' % r, 'IF(%s,"",%s)' % (on, '+'.join('(SUMPRODUCT(%s*(%s>0)*(%s="%s"))>0)' % (hit, WT, FM, f) for f in FAM)), 'int')
    x.f('G%d' % r, 'IF(%s,"",SUMPRODUCT(%s*%s))' % (on, hit, WT), 'int')
    x.f('H%d' % r, 'IF(%s,"",IF(OR(G%d>=%s,AND(%s="Yes",E%d>0)),"RED",IF(G%d>=%s,"AMBER","GREEN")))' % (on, r, S('th.red'), S('th.crit'), r, r, S('th.amber')), 'txt')
    st = A(SC, ar)
    x.f('I%d' % r, 'IF(%s,"",IF(%s<>"",%s,IF(H%d="GREEN","","Not started")))' % (on, st, st, r), 'txt')
    x.f('J%d' % r, 'IF(OR(%s,I%d="",%s="",%s=""),"",IF(%s<>"",%s,%s)-%s)' % (on, r, A(AD, ar), DT, A(CD, ar), A(CD, ar), DT, A(AD, ar)), 'int')
    x.f('K%d' % r, 'IF(OR(%s,I%d=""),"",IF(OR(I%d="Not started",I%d="Under examination"),IF(J%d="","CHECK",IF(J%d>%s,"RED","AMBER")),IF(J%d="","GREEN",IF(J%d>%s,"AMBER","GREEN"))))' % (on, r, r, r, r, r, S('th.exam'), r, r, S('th.exam')), 'txt')
    x.f('L%d' % r, 'IF(OR(%s,%s=""),"",%s+%s)' % (on, A(FD, ar), A(FD, ar), S('th.fmr')), 'date')
    x.f('M%d' % r, 'IF(L%d="","",IF(%s<>"",IF(%s<=L%d,"GREEN","RED"),IF(%s="","CHECK",IF(%s>L%d,"RED","AMBER"))))' % (r, A(MD_, ar), A(MD_, ar), r, DT, DT, r), 'txt')
    x.f('N%d' % r, 'IF(OR(%s,AND(I%d<>"Referred for investigation",I%d<>"Classified as fraud")),"",IF(H%d="GREEN","No","Yes"))' % (on, r, r, r), 'txt')
    x.f('O%d' % r, 'IF(%s,"",G%d+E%d*1000+(1000-ROW())/100000)' % (on, r, r), 'n4')
for col in 'HKM': x.rag('%s7:%s%d' % (col, col, 6 + N))
X = lambda c: "'Scoring'!$%s$7:$%s$%d" % (c, c, 6 + N)

v = B.sheet('Indicator Review', (6, 70, 24, 10, 10, 12, 12, 12, 30), tab='00B050')
v.title('Indicator Review – how well each indicator works', FR + ', para 15 (indicators reviewed periodically for effectiveness) and para 16 (validation of the framework).')
v.head(6, ['No.', 'Indicator', 'Family', 'Weight in use', 'Accounts flagged', 'Examined and closed', 'Confirmed (referred or fraud)', 'Confirmed share', 'Remark'])
for j, col in enumerate(FC):
    r = 7 + j; fc = AR(col); sc = AR(SC)
    v.f('A%d' % r, '%d' % (j + 1), 'int'); v.f('B%d' % r, '%s&""' % IC('B', j), 'txt'); v.f('C%d' % r, '%s&""' % IC('C', j), 'txt'); v.f('D%d' % r, "'Accounts Input'!%s5" % col, 'int')
    v.f('E%d' % r, 'COUNTIF(%s,"Yes")' % fc, 'int'); v.f('F%d' % r, 'COUNTIFS(%s,"Yes",%s,"%s")+G%d' % (fc, sc, ST[2], r), 'int')
    v.f('G%d' % r, 'COUNTIFS(%s,"Yes",%s,"%s")+COUNTIFS(%s,"Yes",%s,"%s")' % (fc, sc, ST[3], fc, sc, ST[4]), 'int'); v.f('H%d' % r, div('G%d' % r, 'F%d' % r), 'pct')
    v.f('I%d' % r, 'IF(D%d=0,"Switched off",IF(COUNTA(%s)=0,"",IF(E%d=0,"Never present: review the indicator",IF(AND(F%d>=5,G%d=0),"No confirmed case: review the weight",""))))' % (r, AR('A'), r, r, r), 'txt')
rt = 7 + NI
v.lbl('B%d' % rt, 'Total', bold=True)
for col in 'EFG': v.f('%s%d' % (col, rt), 'SUM(%s7:%s%d)' % (col, col, rt - 1), 'int', bold=True)

d = B.sheet('Dashboard', (58, 14, 16, 14, 14, 14), tab='00B050')
d.title('Dashboard – early warning position for the Board level committee', FR + ', para 14: the committee oversees the effectiveness of the framework.')
d.sec('A4', 'Accounts by alert', 4); d.head(5, ['Alert', 'Accounts', 'Exposure', 'Share of exposure'])
for j, (lab, cod) in enumerate((('Red', 'RED'), ('Amber', 'AMBER'), ('Green', 'GREEN'))):
    r = 6 + j; d.lbl('A%d' % r, lab); d.f('B%d' % r, 'COUNTIF(%s,"%s")' % (X('H'), cod), 'int'); d.f('C%d' % r, 'SUMIFS(%s,%s,"%s")' % (X('C'), X('H'), cod), 'int'); d.f('D%d' % r, div('C%d' % r, 'C9'), 'pct')
d.lbl('A9', 'Total', bold=True); d.f('B9', 'SUM(B6:B8)', 'int', bold=True); d.f('C9', 'SUM(C6:C8)', 'int', bold=True)
d.sec('A11', 'Examination of alerts', 4); d.head(12, ['Status', 'Accounts', 'Exposure', 'Beyond the days allowed'])
for j, stt in enumerate(ST):
    r = 13 + j; d.lbl('A%d' % r, stt); d.f('B%d' % r, 'COUNTIF(%s,"%s")' % (X('I'), stt), 'int'); d.f('C%d' % r, 'SUMIFS(%s,%s,"%s")' % (X('C'), X('I'), stt), 'int')
    d.f('D%d' % r, ('COUNTIFS(%s,"%s",%s,"RED")' if j < 2 else 'COUNTIFS(%s,"%s",%s,"AMBER")') % (X('I'), stt, X('K')), 'int')
d.lbl('A18', 'Total', bold=True)
for col in 'BCD': d.f('%s18' % col, 'SUM(%s13:%s17)' % (col, col), 'int', bold=True)
d.sec('A20', 'Key measures', 3); d.head(21, ['Measure', 'Value', 'Status'])
KM = [('Open examinations beyond the days allowed', 'D13+D14', 'int', 'IF(B9=0,"",IF(B22>0,"RED","GREEN"))'), ('Alerts with no date of alert', 'COUNTIF(%s,"CHECK")' % X('K'), 'int', 'IF(B9=0,"",IF(B23>0,"AMBER","GREEN"))'),
      ('Fraud Monitoring Returns late or overdue', 'COUNTIF(%s,"RED")' % X('M'), 'int', 'IF(B9=0,"",IF(B24>0,"RED","GREEN"))'), ('Fraud Monitoring Returns not yet furnished, within time', 'COUNTIF(%s,"AMBER")' % X('M'), 'int', None),
      ('Confirmed cases (referred for investigation or classified as fraud)', 'B16+B17', 'int', None), ('Confirmed cases on which the model had raised an alert (capture rate)', div('COUNTIF(%s,"Yes")' % X('N'), 'B26'), 'pct', 'IF(B26=0,"",IF(B27>=%s,"GREEN",IF(B27>=%s-0.2,"AMBER","RED")))' % (S('th.capture'), S('th.capture'))),
      ('Examinations closed with no fraud angle, as a share of all closed (false alert rate)', div('B15', 'B15+B16+B17'), 'pct', None), ('Indicators in use', 'COUNTIF(\'Indicator Review\'!D7:D%d,">0")' % (6 + NI), 'int', None),
      ('Indicators never present in any account', 'COUNTIF(\'Indicator Review\'!I7:I%d,"Never present: review the indicator")' % (6 + NI), 'int', None)]
for j, (lab, fm, fmt, st) in enumerate(KM):
    r = 22 + j; d.lbl('A%d' % r, lab); d.f('B%d' % r, fm, fmt, out=True)
    if st: d.f('C%d' % r, st, 'txt')
d.rag('C22:C30')
d.sec('A32', 'Ten accounts with the highest score', 6); d.head(33, ['Account', 'Borrower', 'Exposure', 'Score', 'Alert', 'Examination status'])
d.ws.column_dimensions['H'].hidden = True
for k in range(1, 11):
    r = 33 + k; d.f('H%d' % r, 'IFERROR(MATCH(LARGE(%s,%d),%s,0),"")' % (X('O'), k, X('O')), 'int')
    for col, src, fmt in (('A', 'A', 'txt'), ('B', 'B', 'txt'), ('C', 'C', 'int'), ('D', 'G', 'int'), ('E', 'H', 'txt'), ('F', 'I', 'txt')): d.f('%s%d' % (col, r), 'IF($H%d="","",INDEX(%s,$H%d))' % (r, X(src), r), fmt)
d.rag('E34:E43')

ru = B.sheet('Rules', (6, 34, 96, 50), tab='7030A0', protect=False)
ru.title('Rules – the scoring and follow-up in one table', 'Figures are the starting values on the Setup sheet.'); ru.head(5, ['#', 'Rule', 'Logic', 'Reference'])
RL = [('Indicators', 'library of quantitative and qualitative indicators in four families: transactional data, financial performance of borrowers, market intelligence and conduct of the borrowers; reviewed periodically', FR + ', paras 15 and 19'),
      ('Score', 'sum of the weights of the active indicators present in the account', 'Management choice'), ('Alert', 'Red: score of 25 or more, or any critical indicator. Amber: score of 10 or more. Green: otherwise', 'Management choice'),
      ('Examination', 'every Amber or Red account is examined to decide whether it needs investigation from the fraud angle; status moves from Not started to Under examination to a closing status', FR + ', paras 15 and 20'),
      ('Ageing', 'days from the date of the alert to closure, or to the reporting date while open; Red when an open examination is beyond 30 days', 'Management choice (para 17(2): remedial action in a timely manner)'),
      ('Fraud Monitoring Return', 'due within 14 days of the date an account is classified as fraud', FR + ', para 43'),
      ('Capture rate', 'confirmed cases on which the model had raised an alert / all confirmed cases; target 80%', 'Management choice (para 16: validation)'),
      ('Indicator review', 'an active indicator never present, or examined five times or more with no confirmed case, is marked for review', 'Management choice (para 15)')]
for j, (a_, b_, c_) in enumerate(RL, 1):
    for col, vv in zip('ABCD', (j, a_, b_, c_)): ru.lbl('%s%d' % (col, 5 + j), vv)

mn = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
mn.title('Method Notes – how this model produces its results')
mn.text_block(4, ['# 1. What the Directions require', 'NBFCs in the Upper and Middle Layers identify early warning indicators for loan accounts and other financial transactions, review them periodically for effectiveness, and treat the presence of one or more indicators as a trigger for deeper examination from the fraud angle. A Board level committee oversees the framework and directs its validation. The Directions say the indicators should be both quantitative and qualitative and may draw on transactional data, the financial performance of borrowers, market intelligence and the conduct of borrowers. They do not prescribe a list, a weight or a score.',
 '# 2. The indicator library', 'The library has %d indicators in the four families. It is illustrative. Each indicator has a weight; an indicator marked critical is serious enough on its own to make the account Red. The company should replace the wording with tests its systems can run, add its own indicators in place of those it does not use, and have the library approved.' % NI,
 '# 3. Score and alert', 'The score of an account is the sum of the weights of the indicators present. A score of 10 or more is Amber and 25 or more is Red; a critical indicator makes the account Red whatever the score. The sheet also shows how many families the indicators come from, since signals from more than one family support each other.',
 '# 4. Examination and ageing', 'Every Amber or Red account is examined. The user records the date of the alert and the status. The model counts the days the examination has been open and marks it Red when it is beyond the days allowed. Where an account is classified as fraud, the model works out the date by which the Fraud Monitoring Return is due and shows whether it was furnished in time.',
 '# 5. Review of the indicators and validation', 'For each indicator the model counts the accounts in which it was present, how many of those were examined and closed and how many were confirmed, that is, referred for investigation or classified as fraud. The capture rate shows how many confirmed cases the model had flagged; a confirmed case with no alert is a miss that should lead to a new indicator or a change of weight. The false alert rate shows the cost of the alerts in wasted examinations.',
 '# 6. Limits of the model', 'The model holds %d accounts and is meant for corporate, MSME and other loans examined account by account; retail portfolios need rules coded in the loan system, for which the Rules sheet is the specification. It does not cover indicators for non-credit transactions (paragraphs 21 to 23), which call for real-time monitoring in the transaction systems. A score is an aid to judgement and not a finding of fraud.' % N])

ck = B.sheet('Checks', (6, 84, 12, 56), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
aa = AR('A'); sc = AR(SC)
chk = [('The reporting date is entered', '%s<>""' % DT, 'Complete Setup'), ('The Red cut-off is above the Amber cut-off', 'N(%s)>N(%s)' % (S('th.red'), S('th.amber')), 'Correct Setup'),
       ('Every active indicator has a wording, a family and a weight above zero', 'SUMPRODUCT((\'Indicators Input\'!$G$7:$G$%d="Yes")*((\'Indicators Input\'!$B$7:$B$%d="")+(\'Indicators Input\'!$C$7:$C$%d="")+(\'Indicators Input\'!$E$7:$E$%d<=0)))=0' % ((6 + NI,) * 4), 'Complete the library'),
       ('No Account ID is used twice', 'SUMPRODUCT((%s<>"")*(COUNTIF(%s,%s)>1))=0' % (aa, aa, aa), 'Remove the duplicate'), ('Every account has an exposure', 'SUMPRODUCT((%s<>"")*(%s=""))=0' % (aa, AR('D')), 'Complete Accounts Input'),
       ('Every Amber or Red account has a date of alert', 'COUNTIF(%s,"CHECK")=0' % X('K'), 'Enter the date of the alert'),
       ('Every examination that is closed has a closing date', 'SUMPRODUCT(((%s="%s")+(%s="%s")+(%s="%s"))*(%s=""))=0' % (sc, ST[2], sc, ST[3], sc, ST[4], AR(CD)), 'Enter the date'),
       ('Every account classified as fraud has the date of classification', 'SUMPRODUCT((%s="%s")*(%s=""))=0' % (sc, ST[4], AR(FD)), 'Enter the date'),
       ('No date is after the reporting date', 'IF(%s="",TRUE,COUNTIF(%s,">"&%s)+COUNTIF(%s,">"&%s)+COUNTIF(%s,">"&%s)=0)' % (DT, AR(AD), DT, AR(CD), DT, AR(FD), DT), 'Correct the date'),
       ('No examination closed before its alert', 'COUNTIF(%s,"<0")=0' % X('J'), 'Correct the dates')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C%d' % (5 + len(chk)))
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Indicators Input', 'Accounts Input', 'Scoring', 'Indicator Review', 'Dashboard', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('Early warning model built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
