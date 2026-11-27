"""Internal Audit Risk Assessment and Audit Plan (RBIA-M01): risk assessment of every auditable unit on the parameters of the Directions, risk matrix,
audit frequency, annual plan by quarter and auditor-days.  Run: python3 build_rbia.py <out.xlsx> <map.json>
Paragraph numbers read against the Source text on 25-11-2026: Internal Audit Function Directions, 2026 (MD 464) paras 3, 25 to 32, 34;
Compliance Function Directions, 2026 (MD 460) para 17."""
import sys
from xl import *

N = 150; R0 = 7
B = Book('RBIA-M01', 'Internal Audit Risk Assessment and Audit Plan')
IA = 'RBI (NBFCs – Internal Audit Function) Directions, 2026'; CD = 'RBI (NBFCs – Compliance Function) Directions, 2026'
TYPES = ['Branch or location', 'Business line', 'Support function', 'Process', 'Information system', 'Outsourced activity']
LV3 = ['High', 'Medium', 'Low']; LV5 = ['Extremely high', 'Very high', 'High', 'Medium', 'Low']; TR = ['Increasing', 'Stable', 'Decreasing']
INH = [('Volume of business and complexity of activities', 'para 31(8)', 3), ('Change in business lines or change in focus', 'para 31(2)', 2), ('Change in management or key personnel', 'para 31(3)', 1), ('Industry trends and other environmental factors', 'para 31(6)', 1),
       ('Performance variation from the budget', 'para 31(9)', 1), ('Compliance risk (residual score from the Compliance Testing Model)', CD + ', para 17', 2)]
CTL = [('Previous internal audit reports and compliance', 'para 31(1)', 3), ('Results of regulatory examination', 'para 31(4)', 2), ('Reports of external auditors', 'para 31(5)', 1), ('Adequacy of control against strategy and risk appetite', 'para 31(10)', 2), ('Time elapsed since the last audit (calculated)', 'para 31(7)', 2)]

readme(B, 'Internal Audit Risk Assessment and Audit Plan',
       ['This workbook carries out the yearly risk assessment that the internal audit function makes of every activity and location, and turns it into a risk-based audit plan. Each auditable unit is scored for inherent business risk and for control risk on the parameters named in the Directions; the two levels meet in a risk matrix that gives the overall risk, the audit frequency, the date the next audit is due, the quarter and the auditor-days.',
        'It serves paragraphs 25 to 32 and 34 of the ' + IA + ', which apply to deposit-taking NBFCs and to non-deposit taking NBFCs with assets of ₹5,000 crore and above (para 3); other NBFCs may use it as good practice. Weights, cut-offs, frequencies and days are for the Audit Committee to approve.'],
       ['Setup: enter the plan year and confirm the weights, the cut-offs, the risk matrix, the audit frequency and the auditor-days.', 'Units Input: list every auditable unit, including the risk management and compliance functions, and score it 1 (lowest risk) to 5 (highest risk) on each parameter; enter the date of the last audit and the trend.',
        'Read Risk Assessment and Audit Plan.', 'Read the Dashboard: risk matrix, plan by quarter and auditor-days against capacity.', 'Clear the Checks sheet and place the assessment and the plan before the Audit Committee.'],
       [('Method Notes', 'explains every score and rule'), ('Setup', 'weights, cut-offs, matrix, frequency'), ('Units Input', 'one row per auditable unit'), ('Risk Assessment', 'scores, levels and overall risk'), ('Audit Plan', 'due date, quarter and days'),
        ('Dashboard', 'risk matrix and plan summary'), ('Rules', 'rules for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Setup', (70, 16, 16, 16, 16, 16, 44), tab='C00000')
s.title('Setup – weights, cut-offs, risk matrix, frequency and days', 'Yellow cells are inputs. The Directions name the parameters; the weights and figures are for the Audit Committee to approve.')
ROW = {}
for r, lab, key, d, fmt, src in [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', ''), (5, 'First day of the plan year', 'setup.date', None, 'date', 'Audit plan year'), (6, 'Internal auditors available (number)', 'cap.staff', None, 'num', 'Internal Audit'),
                                 (7, 'Audit days available per auditor in the year', 'cap.days', 180, 'int', 'After leave, training and administration'), (8, 'Scores up to this figure are Low', 'th.low', 2.0, 'num', 'Management choice (para 29: the basis of each level is spelt out)'),
                                 (9, 'Scores up to this figure are Medium (higher is High)', 'th.med', 3.5, 'num', 'Management choice (para 29)')]:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, d, fmt, src or 'Company'); s.lbl('G%d' % r, src); ROW[key] = r
S = lambda k: q('Setup', '$B$%d' % ROW[k])
s.sec('A11', 'Inherent business risk – weight of each parameter', 7)
for j, (lab, ref, w) in enumerate(INH):
    r = 12 + j; s.lbl('A%d' % r, lab); s.inp('B%d' % r, 'w.inh.%d' % (j + 1), 'Weight: ' + lab, w, 'int', 'Audit Committee'); s.lbl('G%d' % r, ref if ref.startswith('RBI') else IA + ', ' + ref)
s.sec('A19', 'Control risk – weight of each parameter', 7)
for j, (lab, ref, w) in enumerate(CTL):
    r = 20 + j; s.lbl('A%d' % r, lab); s.inp('B%d' % r, 'w.ctl.%d' % (j + 1), 'Weight: ' + lab, w, 'int', 'Audit Committee'); s.lbl('G%d' % r, IA + ', ' + ref)
WI = ["'Setup'!$B$%d" % (12 + j) for j in range(6)]; WC = ["'Setup'!$B$%d" % (20 + j) for j in range(5)]
s.sec('A26', 'Score for time elapsed since the last audit', 7); s.head(27, ['Months since the last audit: from', 'Score'])
for j, (mo, sc) in enumerate(((0, 1), (13, 2), (19, 3), (25, 4), (37, 5))):
    r = 28 + j; s.inp('A%d' % r, 'time.from.%d' % (j + 1), 'Time score: months from (row %d)' % (j + 1), mo, 'int', 'Management choice'); s.inp('B%d' % r, 'time.score.%d' % (j + 1), 'Time score (row %d)' % (j + 1), sc, 'int', 'Management choice')
s.lbl('G28', 'A unit never audited takes the highest score.')
s.sec('A34', 'Risk matrix – overall risk for each pair of levels', 7); s.head(35, ['Inherent business risk (rows) against control risk (columns)'] + LV3)
MX = {('High', 'High'): 'Extremely high', ('High', 'Medium'): 'Very high', ('High', 'Low'): 'High', ('Medium', 'High'): 'Very high', ('Medium', 'Medium'): 'High', ('Medium', 'Low'): 'Medium', ('Low', 'High'): 'High', ('Low', 'Medium'): 'Medium', ('Low', 'Low'): 'Low'}
for i, a in enumerate(LV3):
    r = 36 + i; s.lbl('A%d' % r, a)
    for j, c in enumerate(LV3): s.inp('%s%d' % (L(j + 2), r), 'mx.%d.%d' % (i + 1, j + 1), 'Matrix: inherent %s, control %s' % (a, c), MX[(a, c)], 'txt', IA + ', paras 28 and 34', LV5)
s.lbl('G36', IA + ', para 28 (risk matrix of inherent business risk and control risk); para 34 (five levels of risk). The starting values are those of the illustrative risk matrix RBI gives to banks.')
s.sec('A40', 'Audit frequency and effort by overall risk', 7); s.head(41, ['Overall risk', 'Audit every (months)', 'Effort multiplier'])
for j, (lv, mo, mu) in enumerate(zip(LV5, (6, 12, 12, 18, 24), (1.5, 1.25, 1.0, 0.75, 0.5))):
    r = 42 + j; s.lbl('A%d' % r, lv); s.inp('B%d' % r, 'freq.%d' % (j + 1), 'Audit frequency in months: ' + lv, mo, 'int', 'Audit Committee'); s.inp('C%d' % r, 'mult.%d' % (j + 1), 'Effort multiplier: ' + lv, mu, 'num', 'Audit Committee')
s.lbl('G42', 'Management choice. The Directions leave the scope for each level of risk to the NBFC (para 34).')
s.sec('A48', 'Standard auditor-days for one audit, by type of unit', 7); s.head(49, ['Type of unit', 'Auditor-days'])
for j, (ty, dd) in enumerate(zip(TYPES, (6, 25, 12, 10, 15, 8))):
    r = 50 + j; s.lbl('A%d' % r, ty); s.inp('B%d' % r, 'days.%d' % (j + 1), 'Standard auditor-days: ' + ty, dd, 'int', 'Internal Audit')
MXR = "'Setup'!$B$36:$D$38"; LVR = "'Setup'!$B$35:$D$35"; LVC = "'Setup'!$A$36:$A$38"; FQ = "'Setup'!$A$42:$C$46"; DY = "'Setup'!$A$50:$B$55"; TM = "'Setup'!$A$28:$B$32"

HEAD = ['Unit ID *', 'Auditable unit *', 'Type *'] + [x[0] + ' (1 to 5)' for x in INH] + [x[0] + ' (1 to 5)' for x in CTL[:4]] + ['Date of the last audit', 'Trend of inherent business risk', 'Trend of control risk', 'Audit this year whatever the risk (Yes)']
t = B.sheet('Units Input', (12, 34, 20) + (14,) * 10 + (13, 13, 13, 13), tab='BF9000')
t.title('Units Input – one row per auditable unit', 'Every activity and location, including the risk management and compliance functions. Score 1 = lowest risk or strongest control, 5 = highest risk or weakest control.'); t.head(6, HEAD); t.ws.freeze_panes = 'C7'; t.ws.row_dimensions[6].height = 66
for rr in range(R0, R0 + N):
    for i in range(len(HEAD)):
        col = L(i + 1); c = t.ws['%s%d' % (col, rr)]; c.fill = YEL; c.protection = Protection(locked=False); c.border = BD; c.font = Font(name='Calibri', size=10); c.number_format = F['date'] if col == 'N' else ('0' if col in 'DEFGHIJKLM' else '@')
for col, items in (('C', TYPES), ('O', TR), ('P', TR), ('Q', ['Yes', 'No'])):
    dv = DataValidation(type='list', formula1='"%s"' % ','.join(items), allow_blank=True); t.ws.add_data_validation(dv); dv.add('%s%d:%s%d' % (col, R0, col, R0 + N - 1))
B.inputs.append(dict(key='units', sheet='Units Input', cell='A%d:Q%d' % (R0, R0 + N - 1), label='Units Input: ' + '; '.join(HEAD), source='Audit universe; previous audit reports; inspection reports; CMP-M01 (compliance risk); budget review', default=None))
U = lambda c, r: "'Units Input'!%s%d" % (c, r); UR = lambda c: "'Units Input'!$%s$%d:$%s$%d" % (c, R0, c, R0 + N - 1)


def level(x): return 'IF(%s<=%s,"Low",IF(%s<=%s,"Medium","High"))' % (x, S('th.low'), x, S('th.med'))


a = B.sheet('Risk Assessment', (12, 34, 20, 11, 11, 11, 11, 9, 11, 11, 15, 9, 12, 12), tab='00B050')
a.title('Risk Assessment – inherent business risk, control risk and overall risk of each unit', IA + ', paras 25 to 32. A score is the weighted average of the parameters filled in.'); a.ws.freeze_panes = 'C7'
a.head(6, ['Unit ID', 'Auditable unit', 'Type', 'Inherent risk score', 'Inherent risk level', 'Months since the last audit', 'Time score', 'Control risk score', 'Control risk level', 'Trend (inherent / control)', 'Overall risk', 'Priority (para 32)', 'Rising risk', 'Ranking key'])
for i in range(N):
    r = R0 + i; on = '%s=""' % U('A', r)
    for col in 'ABC': a.f('%s%d' % (col, r), 'IF(%s,"",%s&"")' % (on, U(col, r)), 'txt')
    num = '+'.join('%s*N(%s)' % (w, U(c, r)) for w, c in zip(WI, 'DEFGHI')); den = '+'.join('%s*(%s<>"")' % (w, U(c, r)) for w, c in zip(WI, 'DEFGHI'))
    a.f('D%d' % r, 'IF(OR(%s,(%s)=0),"",(%s)/(%s))' % (on, den, num, den), 'num'); a.f('E%d' % r, 'IF(D%d="","",%s)' % (r, level('D%d' % r)), 'txt')
    a.f('F%d' % r, 'IF(OR(%s,%s="",%s=""),"",MAX(0,(YEAR(%s)-YEAR(%s))*12+MONTH(%s)-MONTH(%s)))' % (on, U('N', r), S('setup.date'), S('setup.date'), U('N', r), S('setup.date'), U('N', r)), 'int')
    a.f('G%d' % r, 'IF(%s,"",IF(F%d="",MAX(%s),INDEX(%s,MATCH(F%d,%s,1))))' % (on, r, "'Setup'!$B$28:$B$32", "'Setup'!$B$28:$B$32", r, "'Setup'!$A$28:$A$32"), 'int')
    num = '+'.join('%s*N(%s)' % (w, U(c, r)) for w, c in zip(WC[:4], 'JKLM')) + '+%s*G%d' % (WC[4], r); den = '+'.join('%s*(%s<>"")' % (w, U(c, r)) for w, c in zip(WC[:4], 'JKLM')) + '+%s' % WC[4]
    a.f('H%d' % r, 'IF(OR(%s,(%s)=0),"",(%s)/(%s))' % (on, den, num, den), 'num'); a.f('I%d' % r, 'IF(H%d="","",%s)' % (r, level('H%d' % r)), 'txt')
    a.f('J%d' % r, 'IF(%s,"",IF(%s="","Stable",%s)&" / "&IF(%s="","Stable",%s))' % (on, U('O', r), U('O', r), U('P', r), U('P', r)), 'txt')
    a.f('K%d' % r, 'IF(OR(E%d="",I%d=""),"",INDEX(%s,MATCH(E%d,%s,0),MATCH(I%d,%s,0)))' % (r, r, MXR, r, LVC, r, LVR), 'txt')
    a.f('L%d' % r, 'IF(K%d="","",IF(E%d="High",IF(I%d="High",1,IF(I%d="Medium",2,3)),IF(E%d="Medium",IF(I%d="High",4,IF(I%d="Medium",5,7)),IF(I%d="High",6,7))))' % (r, r, r, r, r, r, r, r), 'int')
    a.f('M%d' % r, 'IF(%s,"",IF(OR(%s="Increasing",%s="Increasing"),"Yes","No"))' % (on, U('O', r), U('P', r)), 'txt')
    a.f('N%d' % r, 'IF(K%d="","",(8-L%d)*100+D%d*H%d+(1000-ROW())/100000)' % (r, r, r, r), 'n4')
for txt, hexc in (('Extremely high', 'F8696B'), ('Very high', 'F8696B'), ('High', 'FFC000')):
    a.ws.conditional_formatting.add('K%d:K%d' % (R0, R0 + N - 1), CellIsRule(operator='equal', formula=['"%s"' % txt], fill=PatternFill(fill_type='solid', start_color=hexc, end_color=hexc), font=Font(bold=True)))
A = lambda c, r: "'Risk Assessment'!%s%d" % (c, r); AR = lambda c: "'Risk Assessment'!$%s$%d:$%s$%d" % (c, R0, c, R0 + N - 1)

p = B.sheet('Audit Plan', (12, 34, 20, 15, 11, 13, 13, 10, 9, 11, 12, 10, 10, 12), tab='00B050')
p.title('Audit Plan – next audit due, quarter and auditor-days', IA + ', paras 25, 27 and 32. A unit is in the plan when its next audit falls due by the end of the plan year, or when it is marked for audit whatever the risk.'); p.ws.freeze_panes = 'C7'
p.head(6, ['Unit ID', 'Auditable unit', 'Type', 'Overall risk', 'Audit every (months)', 'Last audit', 'Next audit due', 'In the plan', 'Quarter', 'Auditor-days for one audit', 'Overdue at the start of the year', 'Audits in the year', 'Quarter of the second audit', 'Auditor-days in the year'])
YE = 'EDATE(%s,12)' % S('setup.date')
for i in range(N):
    r = R0 + i; on = '%s=""' % A('K', r)
    for col, src in zip('ABCD', 'ABCK'): p.f('%s%d' % (col, r), 'IF(%s,"",%s&"")' % (on, A(src, r)), 'txt')
    p.f('E%d' % r, 'IF(%s,"",INDEX(%s,MATCH(D%d,%s,0),2))' % (on, FQ, r, "'Setup'!$A$42:$A$46"), 'int'); p.f('F%d' % r, 'IF(OR(%s,%s=""),"",%s)' % (on, U('N', r), U('N', r)), 'date')
    p.f('G%d' % r, 'IF(%s,"",IF(F%d="",%s,EDATE(F%d,E%d)))' % (on, r, S('setup.date'), r, r), 'date'); p.f('H%d' % r, 'IF(%s,"",IF(OR(%s="Yes",G%d<%s),"Yes","No"))' % (on, U('Q', r), r, YE), 'txt')
    p.f('I%d' % r, 'IF(H%d<>"Yes","",IF(G%d<EDATE(%s,3),"Q1",IF(G%d<EDATE(%s,6),"Q2",IF(G%d<EDATE(%s,9),"Q3","Q4"))))' % (r, r, S('setup.date'), r, S('setup.date'), r, S('setup.date')), 'txt')
    p.f('J%d' % r, 'IF(H%d<>"Yes","",ROUND(INDEX(%s,MATCH(C%d,%s,0),2)*INDEX(%s,MATCH(D%d,%s,0),3),0))' % (r, DY, r, "'Setup'!$A$50:$A$55", FQ, r, "'Setup'!$A$42:$A$46"), 'int')
    p.f('K%d' % r, 'IF(%s,"",IF(AND(F%d<>"",G%d<%s),"Yes","No"))' % (on, r, r, S('setup.date')), 'txt')
    fst = 'MAX(G%d,%s)' % (r, S('setup.date')); sd = S('setup.date')
    p.f('L%d' % r, 'IF(H%d<>"Yes","",IF(G%d>=%s,1,1+MIN(1,INT((11-((YEAR(%s)-YEAR(%s))*12+MONTH(%s)-MONTH(%s)))/E%d))))' % (r, r, YE, fst, sd, fst, sd, r), 'int')
    sec = 'EDATE(%s,E%d)' % (fst, r)
    p.f('M%d' % r, 'IF(L%d<>2,"",IF(%s<EDATE(%s,3),"Q1",IF(%s<EDATE(%s,6),"Q2",IF(%s<EDATE(%s,9),"Q3","Q4"))))' % (r, sec, sd, sec, sd, sec, sd), 'txt')
    p.f('N%d' % r, 'IF(H%d<>"Yes","",J%d*L%d)' % (r, r, r), 'int')
PL = lambda c: "'Audit Plan'!$%s$%d:$%s$%d" % (c, R0, c, R0 + N - 1)

d = B.sheet('Dashboard', (46, 14, 14, 14, 14, 14, 14), tab='00B050')
d.title('Dashboard – risk matrix and audit plan', IA + ', paras 28, 29 and 32.')
d.sec('A4', 'Risk matrix (number of units)', 5); d.head(5, ['Inherent business risk (rows) against control risk (columns)'] + LV3 + ['Total'])
for i, x in enumerate(LV3):
    r = 6 + i; d.lbl('A%d' % r, x)
    for j, c in enumerate(LV3): d.f('%s%d' % (L(j + 2), r), 'COUNTIFS(%s,"%s",%s,"%s")' % (AR('E'), x, AR('I'), c), 'int')
    d.f('E%d' % r, 'SUM(B%d:D%d)' % (r, r), 'int', bold=True)
d.sec('A10', 'Overall risk and the plan', 7); d.head(11, ['Overall risk', 'Units', 'Risk rising', 'Units in the plan', 'Auditor-days in the year', 'Overdue at the start of the year', 'Share of units in the plan'])
for j, lv in enumerate(LV5):
    r = 12 + j; d.lbl('A%d' % r, lv); d.f('B%d' % r, 'COUNTIF(%s,"%s")' % (AR('K'), lv), 'int'); d.f('C%d' % r, 'COUNTIFS(%s,"%s",%s,"Yes")' % (AR('K'), lv, AR('M')), 'int')
    d.f('D%d' % r, 'COUNTIFS(%s,"%s",%s,"Yes")' % (PL('D'), lv, PL('H')), 'int'); d.f('E%d' % r, 'SUMIFS(%s,%s,"%s")' % (PL('N'), PL('D'), lv), 'int'); d.f('F%d' % r, 'COUNTIFS(%s,"%s",%s,"Yes")' % (PL('D'), lv, PL('K')), 'int'); d.f('G%d' % r, div('D%d' % r, 'B%d' % r), 'pct')
d.lbl('A17', 'Total', bold=True)
for col in 'BCDEF': d.f('%s17' % col, 'SUM(%s12:%s16)' % (col, col), 'int', bold=True)
d.f('G17', div('D17', 'B17'), 'pct', bold=True)
d.sec('A19', 'Plan by quarter', 4); d.head(20, ['Quarter', 'Audits', 'Auditor-days', 'Share of the year'])
for k in range(1, 5):
    r = 20 + k; d.lbl('A%d' % r, 'Q%d' % k); d.f('B%d' % r, 'COUNTIF(%s,"Q%d")+COUNTIF(%s,"Q%d")' % (PL('I'), k, PL('M'), k), 'int'); d.f('C%d' % r, 'SUMIFS(%s,%s,"Q%d")+SUMIFS(%s,%s,"Q%d")' % (PL('J'), PL('I'), k, PL('J'), PL('M'), k), 'int'); d.f('D%d' % r, div('C%d' % r, 'E17'), 'pct')
d.sec('A26', 'Capacity', 3)
for r, lab, fm, fmt in [(27, 'Auditor-days needed for the plan', 'E17', 'int'), (28, 'Auditor-days available', 'N(%s)*N(%s)' % (S('cap.staff'), S('cap.days')), 'int'), (29, 'Surplus (+) or shortfall (-)', 'B28-B27', 'int'), (30, 'Plan as a share of capacity', div('B27', 'B28'), 'pct')]:
    d.lbl('A%d' % r, lab); d.f('B%d' % r, fm, fmt, out=True)
d.f('C30', 'IF(B28=0,"",IF(B30>1,"RED",IF(B30>0.9,"AMBER","GREEN")))', 'txt')
d.lbl('A31', 'Units of Extremely high or Very high risk left out of the plan'); d.f('B31', 'B12+B13-D12-D13', 'int', out=True); d.f('C31', 'IF(B17=0,"",IF(B31>0,"RED","GREEN"))', 'txt')
d.lbl('A32', 'Units overdue for audit at the start of the year'); d.f('B32', 'F17', 'int', out=True); d.f('C32', 'IF(B17=0,"",IF(B32>0,"AMBER","GREEN"))', 'txt'); d.rag('C30:C32')
d.sec('A34', 'Ten units of highest priority', 6); d.head(35, ['Auditable unit', 'Type', 'Overall risk', 'Priority (para 32)', 'Inherent score', 'Control score'])
d.ws.column_dimensions['I'].hidden = True
for k in range(1, 11):
    r = 35 + k; d.f('I%d' % r, 'IFERROR(MATCH(LARGE(%s,%d),%s,0),"")' % (AR('N'), k, AR('N')), 'int')
    for col, src, fmt in (('A', 'B', 'txt'), ('B', 'C', 'txt'), ('C', 'K', 'txt'), ('D', 'L', 'int'), ('E', 'D', 'num'), ('F', 'H', 'num')): d.f('%s%d' % (col, r), 'IF($I%d="","",INDEX(%s,$I%d))' % (r, AR(src), r), fmt)

ru = B.sheet('Rules', (6, 34, 96, 50), tab='7030A0', protect=False)
ru.title('Rules – the assessment and the plan in one table', 'Figures are the starting values on the Setup sheet.'); ru.head(5, ['#', 'Rule', 'Logic', 'Reference'])
RL = [('Coverage', 'every activity and location is assessed at least once a year, including the risk management and compliance functions', IA + ', paras 25 and 26'),
      ('Inherent business risk', 'weighted average (1 to 5) of volume and complexity, change in business, change in management, industry and environment, variation from budget and compliance risk', IA + ', paras 28 and 31; ' + CD + ', para 17'),
      ('Control risk', 'weighted average (1 to 5) of previous audit findings, regulatory examination, external auditors\' reports, adequacy of control and time since the last audit', IA + ', paras 28 and 31'),
      ('Level and trend', 'Low up to 2.0, Medium up to 3.5, High above; trend Increasing, Stable or Decreasing recorded for both risks', IA + ', para 29'),
      ('Overall risk', 'risk matrix of the two levels, giving Extremely high, Very high, High, Medium or Low', IA + ', paras 28 and 34'),
      ('Priority', '1 high and high; 2 high and medium; 3 high and low; 4 medium and high; 5 medium and medium; 6 low and high (magnitude = inherent risk, frequency = control risk)', IA + ', para 32'),
      ('Audit frequency', 'every 6, 12, 12, 18 and 24 months for the five levels; next audit due = last audit + frequency; a unit never audited is due at the start of the year', 'Management choice (para 34)'),
      ('Plan', 'a unit is in the plan when its next audit is due before the end of the plan year or it is marked for audit; quarter by due date; a unit audited every six months has a second audit in the year where the first falls in the first half', IA + ', paras 27 and 32'),
      ('Auditor-days', 'standard days for the type of unit x effort multiplier for the overall risk', 'Management choice (para 34: scope and resources by level of risk)')]
for j, (a_, b_, c_) in enumerate(RL, 1):
    for col, v in zip('ABCD', (j, a_, b_, c_)): ru.lbl('%s%d' % (col, 5 + j), v)

mn = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
mn.title('Method Notes – how this model produces its results')
mn.text_block(4, ['# 1. What the Directions require', 'The internal audit function makes its own risk assessment, at least once a year, of every activity and location, including the risk management and compliance functions, and uses it to prepare a risk-based audit plan. The assessment identifies the inherent business risk of each activity and the effectiveness of its controls (control risk), places the two in a risk matrix and spells out the basis of each level and its trend. The Directions list ten parameters the method should cover; this model uses all ten.',
 '# 2. Scores', 'Each parameter is scored 1 to 5, where 5 is the highest risk or the weakest control. Inherent business risk is the weighted average of six parameters, one of which is the compliance risk of the unit taken from the Compliance Testing Model (CMP-M01) by value. Control risk is the weighted average of four scored parameters and one calculated parameter, the time since the last audit. A parameter left blank is left out of the average. Weights are on Setup.',
 '# 3. Levels, trend and the risk matrix', 'A score up to 2.0 is Low, up to 3.5 Medium and above that High. The two levels are read against the risk matrix on Setup, which gives five levels of overall risk. The Directions for NBFCs ask for a risk matrix but do not print one; the starting values are the nine cells of the illustrative matrix in the RBI (Commercial Banks – Internal Audit Function) Directions, 2026, first given in the RBI Guidance Note on Risk-Based Internal Audit of 2002. The trend of each risk is entered by the auditor; a unit whose risk is rising is flagged so that the Audit Committee can bring its audit forward.',
 '# 4. Priority', 'The Directions ask the plan to give greater attention to six combinations of magnitude and frequency, in a stated order. The Directions do not define the two words. The model treats the inherent risk level as magnitude and the control risk level as frequency, and numbers the six combinations 1 to 6; other combinations are shown as 7. This reading fits the matrix: the six combinations named in the Directions are exactly the six cells that the matrix rates High, Very high or Extremely high.',
 '# 5. Audit plan and capacity', 'Each level of overall risk has an audit frequency. The next audit is due that many months after the last audit; a unit never audited is due at once. A unit is in the plan if its audit falls due before the end of the plan year, and is placed in the quarter of the due date (an overdue unit in the first quarter). A unit audited every six months has a second audit in the same year when the first falls in the first half; the model does not plan more than two audits of a unit in a year. Auditor-days are the standard days for the type of unit multiplied by a factor for the risk. The Dashboard compares the days needed with the days available.',
 '# 6. Limits of the model', 'The model holds %d units. Scores are judgements and must be supported by working papers; the model does not replace the scope note, the audit programme or the report of each assignment. Frequencies, multipliers and standard days are starting values.' % N])

ck = B.sheet('Checks', (6, 84, 12, 56), tab='FF0000')
ck.title('Checks – clear every "CHECK" before the plan is placed before the Audit Committee'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
ua = UR('A'); sc = '+'.join('SUMPRODUCT((%s<>"")*((%s<1)+(%s>5)))' % (UR(c), UR(c), UR(c)) for c in 'DEFGHIJKLM')
chk = [('The first day of the plan year is entered', '%s<>""' % S('setup.date'), 'Complete Setup'), ('Every unit has a name and a type', 'SUMPRODUCT((%s<>"")*((%s="")+(%s="")))=0' % (ua, UR('B'), UR('C')), 'Complete Units Input'),
       ('No Unit ID is used twice', 'SUMPRODUCT((%s<>"")*(COUNTIF(%s,%s)>1))=0' % (ua, ua, ua), 'Give each unit its own ID'), ('Every score is from 1 to 5', '(%s)=0' % sc, 'Correct the scores'),
       ('Every unit has at least one inherent risk score and one control score', 'SUMPRODUCT((%s<>"")*((%s="")+(%s="")))=0' % (ua, AR('D'), AR('H')), 'Score the unit'),
       ('Every type of unit is on the Setup list', 'SUMPRODUCT((%s<>"")*(COUNTIF(%s,%s)=0))=0' % (UR('C'), "'Setup'!$A$50:$A$55", UR('C')), 'Use a type from the list'),
       ('No date of last audit is after the start of the plan year', 'IF(%s="",TRUE,COUNTIF(%s,">"&%s)=0)' % (S('setup.date'), UR('N'), S('setup.date')), 'Correct the date'),
       ('The cut-offs rise and the time scale starts at zero', 'AND(%s<%s,\'Setup\'!$A$28=0)' % (S('th.low'), S('th.med')), 'Correct Setup'), ('The number of auditors is entered', 'N(%s)>0' % S('cap.staff'), 'Complete Setup'), ('No audit frequency is shorter than six months', "MIN('Setup'!$B$42:$B$46)>=6", 'The model plans at most two audits of a unit in a year')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C%d' % (5 + len(chk)))
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Units Input', 'Risk Assessment', 'Audit Plan', 'Dashboard', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('Internal audit risk model built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
