"""Compliance Testing Model (CMP-M01): compliance universe, compliance risk assessment, annual risk-based testing plan,
test programme with sampling, test results, issue tracker with ageing, reports to senior management and the Board / Audit Committee.
Run: python3 build_compliance.py <out.xlsx> <map.json>"""
import sys
from xl import *

NU, NT, NI, NP, ND = 300, 200, 200, 30, 12; R0 = 7


def cfill(hexc):
    """Fill for a conditional format. Excel reads the background colour of such a fill, so both colours are set."""
    return PatternFill(fill_type='solid', start_color=hexc, end_color=hexc)
B = Book('CMP-M01', 'Compliance Testing Model')
YN = ['Yes', 'No']; CD = 'RBI (NBFCs – Compliance Function) Directions, 2026'
BANDS = ['Low', 'Medium', 'High', 'Critical']; RATINGS = ['Strong', 'Adequate', 'Needs improvement', 'Weak or none']
METHODS = ['Transaction sampling', 'Re-performance', 'Walk-through', 'Desk review', 'Site visit', 'Data analytics', 'Follow-up test']
SOURCES = ['Compliance test', 'Internal audit', 'RBI inspection', 'Statutory audit', 'Self-reported breach', 'Complaint analysis', 'Other regulator']
DOMAINS = ['Governance and capital', 'Credit and lending', 'Customer conduct and fair practices', 'Know your customer and anti-money laundering', 'Fraud risk', 'Outsourcing and technology',
           'Liquidity and asset liability management', 'Regulatory reporting and returns', 'Compliance function', 'Other laws and regulators']
FUNCS = ['Compliance', 'Credit', 'Operations', 'Collections', 'Finance and Accounts', 'Treasury', 'Risk Management', 'Information Technology', 'Customer Service', 'Secretarial and Legal', 'Internal Audit', 'Human Resources']

readme(B, 'Compliance Testing Model',
       ['This workbook runs the yearly compliance testing cycle of an NBFC in the Middle or Upper Layer. It holds the list of obligations (the compliance universe), scores the compliance risk of each obligation, works out how many tests each obligation needs in the year, sizes the sample of every test, rates each result Red / Amber / Green, tracks the issues until they are closed and prepares the figures for the report to senior management and to the Board or its Audit Committee.',
        'It serves paragraphs 6, 7, 9(3), 9(4), 15(2), 15(3), 15(4), 17 and 32 of the ' + CD + '. The Directions do not fix a scoring scale, a sample size or a colour threshold; every such figure is on the Setup sheet and is to be approved by the company.'],
       ['Setup: enter the company, the first day of the financial year and the report date; confirm the scales, the tests per year, the sample table, the thresholds and the lists of domains and owner functions.',
        'Universe Input: list every obligation with its Direction and paragraph, its owner, the control, and the scores for likelihood, impact and control rating.',
        'Read Risk Assessment and Annual Plan; the plan shows how many tests each obligation needs and in which quarters.',
        'Test Programme Input: enter one row for every test in the plan; when a test is done, enter the sample tested and the exceptions found.',
        'Issue Tracker Input: record every exception, audit finding and inspection point that needs action, and keep its status up to date.',
        'New Products: list each product or process launched, so that its first six months are monitored.',
        'Read Test Results, Issue Ageing, Management Dashboard and Board Report. Clear the Checks sheet before a report is issued.'],
       [('Method Notes', 'explains every score, plan rule, sample and result'), ('Setup', 'scales, thresholds and lists'), ('Universe Input', 'obligations by Direction and paragraph'), ('Risk Assessment', 'inherent risk, control rating and residual risk'),
        ('Annual Plan', 'tests required in the year, by quarter, and coverage'), ('Test Programme Input', 'one row per test'), ('Test Results', 'sample, exception rate and result of each test'), ('Issue Tracker Input', 'one row per issue'),
        ('Issue Ageing', 'due date, age and status of each issue'), ('New Products', 'six-month monitoring of new products and processes'), ('Management Dashboard', 'position for senior management, by quarter and by function'),
        ('Board Report', 'figures for the Board or Audit Committee'), ('Rules', 'the rules in one table, for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

# ------------------------------------------------------------------ Setup
s = B.sheet('Setup', (74, 16, 16, 16, 16, 56, 3, 44, 30), tab='C00000')
s.title('Setup – scales, thresholds and lists', 'Yellow cells are inputs. The figures are starting values for the company to approve; none of them is fixed by the Directions.')
ROW = {}; r = 4


def one(lab, key, d, fmt='int', src='', lst=None):
    global r
    s.lbl('A%d' % r, lab); s.lbl('F%d' % r, src); s.inp('B%d' % r, key, lab, d, fmt, src or 'Company', lst); ROW[key] = r; r += 1


def S(key): return q('Setup', '$B$%d' % ROW[key])


one('Company name', 'setup.company', 'Name of the NBFC', 'txt')
one('First day of the financial year', 'setup.fystart.date', None, 'date', 'Financial year of the company')
one('Report date (position as on)', 'setup.date', None, 'date', 'Date of the report')
one('Regulatory layer', 'setup.layer', 'Middle Layer', 'txt', CD + ', para 3 (Middle and Upper Layer)', ['Middle Layer', 'Upper Layer', 'Base Layer'])
one('Review of compliance risk placed before the Board or Audit Committee', 'setup.review', 'Quarterly', 'txt', CD + ', para 6 (periodicity is prescribed by the Board or Audit Committee)', ['Quarterly', 'Half-yearly'])
s.lbl('A%d' % r, 'Quarter in progress on the report date (calculated)'); ROW['cq'] = r
s.f('B%d' % r, 'IF(OR(%s="",%s=""),4,MIN(4,INT(MOD(MONTH(%s)-MONTH(%s)+12,12)/3)+1))' % (q('Setup', '$B$5'), q('Setup', '$B$6'), q('Setup', '$B$6'), q('Setup', '$B$5')), 'int', out=True); r += 2
s.sec('A%d' % r, 'Risk bands – score = likelihood (1 to 5) x impact (1 to 5)'); r += 1
one('Low: score up to', 'th.low', 4, src='SOP – Compliance Function, Step B2'); one('Medium: score up to', 'th.med', 9, src='SOP – Compliance Function, Step B2'); one('High: score up to (a higher score is Critical)', 'th.high', 16, src='SOP – Compliance Function, Step B2'); r += 1
s.sec('A%d' % r, 'Share of the inherent risk that remains after the control'); r += 1
for i, (nm, v) in enumerate(zip(RATINGS, (0.25, 0.5, 0.75, 1.0)), 1): one('Control rated "%s"' % nm, 'th.ctl.%d' % i, v, 'pct', 'Management choice')
r += 1
s.sec('A%d' % r, 'Tests in a year, by residual risk band'); r += 1
for nm, k, v in (('Critical', 'c', 4), ('High', 'h', 4), ('Medium', 'm', 2), ('Low', 'l', 1)): one('%s residual risk' % nm, 'th.freq.' + k, v, src='Compliance Policy, clause on testing methodology')
one('Least number of tests where the regulation is new or amended, or a failure was found, in the last 12 months (the first test falls in the first quarter)', 'th.freq.flag', 2, src='Compliance Policy (such areas are tested within three months)'); r += 1
s.sec('A%d' % r, 'Sample size for one test – by the number of items in the period tested and the residual risk band'); r += 1
s.head(r, ['Items in the period tested: from'] + BANDS); ROW['smp.head'] = r; r += 1
ROW['smp.first'] = r
for i, (lo, vals) in enumerate(((1, (1, 1, 1, 1)), (2, (1, 2, 2, 2)), (5, (2, 2, 3, 4)), (13, (5, 5, 8, 10)), (53, (10, 15, 25, 30)), (251, (22, 29, 45, 59))), 1):
    s.inp('A%d' % r, 'th.pop.%d' % i, 'Sample table: items in the period from (row %d)' % i, lo, 'int', 'Management choice')
    for j, v in enumerate(vals, 1): s.inp('%s%d' % (L(j + 1), r), 'th.smp.%d.%d' % (i, j), 'Sample table: row %d, %s' % (i, BANDS[j - 1]), v, 'int', 'Management choice')
    r += 1
ROW['smp.last'] = r - 1; s.lbl('F%d' % ROW['smp.first'], 'Management choice. Last row: sample that shows, with no exception found, a failure rate of not more than 10 per cent at 90 and 95 per cent confidence (22, 29) and not more than 5 per cent at 90 and 95 per cent confidence (45, 59) – the attribute sampling basis of the AICPA Audit Guide, Audit Sampling. Smaller rows follow the usual practice for controls that run quarterly, monthly, weekly and daily. The Compliance Policy asks for at least 25 items for high-risk processes where the volume allows.'); r += 1
s.sec('A%d' % r, 'Result of a test'); r += 1
one('Amber when the exception rate is above', 'th.exc.amber', 0.05, 'pct', 'Management choice'); one('Red when the exception rate is above', 'th.exc.red', 0.10, 'pct', 'Management choice')
one('A high-severity exception makes the test Red whatever the rate', 'th.exc.high', 'Yes', 'txt', 'Management choice', YN); r += 1
s.sec('A%d' % r, 'Issues'); r += 1
for nm, k, v in (('High', 'h', 30), ('Medium', 'm', 60), ('Low', 'l', 90)): one('Days allowed to close an issue of %s severity (used where no target date is entered)' % nm, 'th.days.' + k, v, src='Management choice')
one('An open issue turns Amber when its due date is within (days)', 'th.due.amber', 7, src='Management choice'); one('An overdue issue of Medium or Low severity turns Red when overdue by more than (days)', 'th.over.red', 30, src='Management choice')
for i, v in enumerate((30, 90, 180), 1): one('Ageing of open issues: bucket %d ends at (days since raised)' % i, 'th.age.%d' % i, v, src='Management choice')
r += 1
s.sec('A%d' % r, 'Progress of the plan'); r += 1
one('Amber when tests completed are below this share of the tests due to date', 'th.plan.amber', 0.90, 'pct', 'Management choice'); one('Red when below this share', 'th.plan.red', 0.75, 'pct', 'Management choice'); r += 1
s.sec('A%d' % r, 'Annual review of compliance'); r += 1
one('Regulatory penalties and losses from compliance failures in the year (rupees)', 'rev.penalty', None, 'int', CD + ', para 7(1)'); one('Regulatory actions in the year (penalty orders, show cause notices, supervisory letters)', 'rev.actions', None, 'int', CD + ', para 7(1)')
one('Domain that covers fair practices codes and conduct', 'setup.fpc', DOMAINS[2], 'txt', CD + ', para 7(3)'); r += 1
s.sec('A%d' % r, 'Residual risk at the previous assessment (number of obligations) – to show the change in risk profile'); r += 1
for nm, k in zip(reversed(BANDS), 'chml'): one('%s' % nm, 'prev.' + k, None, src=CD + ', para 9(4)')
s.head(4, ['Compliance domains'], col=8); s.head(4, ['Owner functions'], col=9)
for i in range(ND):
    s.inp('H%d' % (5 + i), 'dom.%d' % (i + 1), 'Compliance domain %d' % (i + 1), DOMAINS[i] if i < len(DOMAINS) else None, 'txt', 'Company')
    s.inp('I%d' % (5 + i), 'fn.%d' % (i + 1), 'Owner function %d' % (i + 1), FUNCS[i] if i < len(FUNCS) else None, 'txt', 'Organisation chart')
s.ws.merge_cells('B4:E4'); s.ws.merge_cells('F%d:F%d' % (ROW['smp.first'], ROW['smp.last']))
DOMR = "'Setup'!$H$5:$H$%d" % (4 + ND); FNR = "'Setup'!$I$5:$I$%d" % (4 + ND)
dv = DataValidation(type='list', formula1=DOMR, allow_blank=True); s.ws.add_data_validation(dv); dv.add('B%d' % ROW['setup.fpc'])
REP = S('setup.date'); CQ = q('Setup', '$B$%d' % ROW['cq'])
SMP = "'Setup'!$B$%d:$E$%d" % (ROW['smp.first'], ROW['smp.last']); POP = "'Setup'!$A$%d:$A$%d" % (ROW['smp.first'], ROW['smp.last']); BH = "'Setup'!$B$%d:$E$%d" % (ROW['smp.head'], ROW['smp.head'])


def band(x): return 'IF(%s<=%s,"Low",IF(%s<=%s,"Medium",IF(%s<=%s,"High","Critical")))' % (x, S('th.low'), x, S('th.med'), x, S('th.high'))


def table(name, sub, heads, widths, n, key, source, lists=(), ranges=(), fmts=None):
    """Input table: one yellow row per record. lists: (column, items); ranges: (column, range); fmts: column -> number format."""
    t = B.sheet(name, widths, tab='BF9000'); t.title(name + ' – one row per ' + sub[0], sub[1]); t.head(6, heads); t.ws.freeze_panes = 'B7'
    k = len(heads); fmts = fmts or {}
    for rr in range(R0, R0 + n):
        for i in range(k):
            c = t.ws['%s%d' % (L(i + 1), rr)]; c.fill = YEL; c.protection = Protection(locked=False); c.border = BD
            c.number_format = F.get(fmts.get(L(i + 1), 'txt')); c.alignment = Alignment(wrap_text=True, vertical='top'); c.font = Font(name='Calibri', size=10)
    for col, items in lists:
        d = DataValidation(type='list', formula1='"%s"' % ','.join(items), allow_blank=True); t.ws.add_data_validation(d); d.add('%s%d:%s%d' % (col, R0, col, R0 + n - 1))
    for col, rg in ranges:
        d = DataValidation(type='list', formula1=rg, allow_blank=True); t.ws.add_data_validation(d); d.add('%s%d:%s%d' % (col, R0, col, R0 + n - 1))
    B.inputs.append(dict(key=key, sheet=name, cell='A%d:%s%d' % (R0, L(k), R0 + n - 1), label=name + ': ' + '; '.join(heads), source=source, default=None))
    return (lambda c, rr: "'%s'!%s%d" % (name, c, rr)), (lambda c: "'%s'!$%s$%d:$%s$%d" % (name, c, R0, c, R0 + n - 1))


def rng(name, n): return lambda c: "'%s'!$%s$%d:$%s$%d" % (name, c, R0, c, R0 + n - 1)


# ------------------------------------------------------------------ input tables
U, UR = table('Universe Input', ('obligation', 'List what the company must comply with, paragraph by paragraph. Columns marked * are needed. Scores: 1 = lowest, 5 = highest.'),
              ['Obligation ID *', 'Direction, Act or circular *', 'Paragraph or section *', 'What must be complied with *', 'Compliance domain *', 'Owner function *', 'Key control in place', 'Likelihood of non-compliance (1 to 5) *',
               'Impact of non-compliance (1 to 5) *', 'Control rating *', 'New or amended in the last 12 months', 'Failure, penalty or adverse finding in the last 12 months', 'Applicable to the company (blank = Yes)', 'Tests this year fixed by Compliance (blank = as per Setup)'],
              (14, 40, 14, 60, 30, 22, 44, 13, 13, 18, 14, 16, 14, 16), NU, 'universe', 'Applicability Engine result; Policy Register; regulatory update register; risk assessment workshop',
              lists=(('J', RATINGS), ('K', YN), ('L', YN), ('M', YN)), ranges=(('E', DOMR), ('F', FNR)), fmts={'H': 'int', 'I': 'int', 'N': 'int'})
T, TR_ = table('Test Programme Input', ('test', 'Enter each test in the plan. When the test is done, set the status to Completed and fill the last columns. The tester and the reviewer are different persons.'),
               ['Test ID *', 'Obligation ID *', 'What is tested and how', 'Method *', 'Quarter *', 'Items in the period tested *', 'Planned completion date *', 'Tester *', 'Reviewer (second officer)', 'Status *', 'Completed on', 'Sample tested',
                'Exceptions found', 'Of which high severity', 'Work-paper reference', 'Results reported to senior management on'],
               (12, 14, 54, 20, 9, 12, 13, 20, 20, 13, 13, 10, 11, 11, 16, 14), NT, 'tests', 'Annual Plan; test work-papers (CMP-A04)',
               lists=(('D', METHODS), ('E', ['Q1', 'Q2', 'Q3', 'Q4']), ('J', ['Planned', 'In progress', 'Completed', 'Deferred'])), fmts={'F': 'int', 'G': 'date', 'K': 'date', 'L': 'int', 'M': 'int', 'N': 'int', 'P': 'date'})
I_, IR = table('Issue Tracker Input', ('issue', 'Record every exception, audit finding and inspection point that needs action. A revised target date needs the name of the authority that approved it.'),
               ['Issue ID *', 'Source *', 'Obligation ID', 'Test ID', 'Issue *', 'Root cause', 'Severity *', 'Owner function *', 'Date raised *', 'Agreed target date', 'Revised target date', 'Extension approved by', 'Status *', 'Closed on',
                'Closure verified by Compliance', 'Staff accountability examined', 'Circulated to staff with preventive instructions'],
               (12, 20, 14, 12, 56, 16, 11, 22, 13, 13, 13, 22, 13, 13, 13, 14, 16), NI, 'issues', 'Test work-papers; internal audit reports; RBI inspection report and Risk Mitigation Plan; breach register',
               lists=(('B', SOURCES), ('F', ['People', 'Process', 'System', 'Third party', 'Interpretation']), ('G', ['High', 'Medium', 'Low']), ('M', ['Open', 'Closed', 'Risk accepted']), ('O', YN), ('P', ['Yes', 'No', 'Not required']), ('Q', YN)),
               ranges=(('H', FNR),), fmts={'I': 'date', 'J': 'date', 'K': 'date', 'N': 'date'})
RAR, PLR, TRR, IAR, NPR = rng('Risk Assessment', NU), rng('Annual Plan', NU), rng('Test Results', NT), rng('Issue Ageing', NI), rng('New Products', NP)
RA = lambda c, rr: "'Risk Assessment'!%s%d" % (c, rr)

# ------------------------------------------------------------------ Risk Assessment
a = B.sheet('Risk Assessment', (14, 84, 30, 22, 10, 11, 18, 10, 10, 11, 10, 11, 9, 9), tab='00B050')
a.title('Risk Assessment – inherent risk, control rating and residual risk of each obligation', CD + ', paras 7 and 15(2). Residual score = inherent score x share of risk that remains after the control.'); a.ws.freeze_panes = 'B7'
a.head(6, ['Obligation ID', 'Reference', 'Compliance domain', 'Owner function', 'Inherent score', 'Inherent band', 'Control rating', 'Share of risk remaining', 'Residual score', 'Residual band', 'Priority (new rule or recent failure)', 'Latest test result', 'Open issues', 'Ranking key'])
for i in range(NU):
    r = R0 + i; on = '%s=""' % U('A', r)
    a.f('A%d' % r, 'IF(%s,"",%s)' % (on, U('A', r)), 'txt'); a.f('B%d' % r, 'IF(%s,"",%s&", "&%s)' % (on, U('B', r), U('C', r)), 'txt'); a.f('C%d' % r, 'IF(%s,"",%s&"")' % (on, U('E', r)), 'txt'); a.f('D%d' % r, 'IF(%s,"",%s&"")' % (on, U('F', r)), 'txt')
    a.f('E%d' % r, 'IF(OR(%s,%s="No",%s="",%s=""),"",%s*%s)' % (on, U('M', r), U('H', r), U('I', r), U('H', r), U('I', r)), 'int'); a.f('F%d' % r, 'IF(E%d="","",%s)' % (r, band('E%d' % r)), 'txt')
    a.f('G%d' % r, 'IF(E%d="","",IF(%s="","Weak or none",%s))' % (r, U('J', r), U('J', r)), 'txt')
    a.f('H%d' % r, 'IF(E%d="","",IF(G%d="Strong",%s,IF(G%d="Adequate",%s,IF(G%d="Needs improvement",%s,%s))))' % (r, r, S('th.ctl.1'), r, S('th.ctl.2'), r, S('th.ctl.3'), S('th.ctl.4')), 'pct')
    a.f('I%d' % r, 'IF(E%d="","",E%d*H%d)' % (r, r, r), 'num'); a.f('J%d' % r, 'IF(I%d="","",%s)' % (r, band('I%d' % r)), 'txt')
    a.f('K%d' % r, 'IF(E%d="","",IF(OR(%s="Yes",%s="Yes"),"Yes","No"))' % (r, U('K', r), U('L', r)), 'txt')
    a.f('L%d' % r, 'IF(E%d="","",IF(COUNTIFS(%s,A%d,%s,"RED")>0,"RED",IF(COUNTIFS(%s,A%d,%s,"AMBER")>0,"AMBER",IF(COUNTIFS(%s,A%d,%s,"GREEN")>0,"GREEN","Not tested"))))' % (r, TRR('B'), r, TRR('N'), TRR('B'), r, TRR('N'), TRR('B'), r, TRR('N')), 'txt')
    a.f('M%d' % r, 'IF(E%d="","",COUNTIFS(%s,A%d,%s,"Open"))' % (r, IR('C'), r, IR('M')), 'int'); a.f('N%d' % r, 'IF(I%d="","",I%d+(10000-ROW())/1000000)' % (r, r), 'n4')
a.rag('L%d:L%d' % (R0, R0 + NU - 1))
for txt, fill in (('Critical', cfill('F8696B')), ('High', cfill('FFC000'))):
    for col in 'FJ': a.ws.conditional_formatting.add('%s%d:%s%d' % (col, R0, col, R0 + NU - 1), CellIsRule(operator='equal', formula=['"%s"' % txt], fill=fill, font=Font(bold=True)))

# ------------------------------------------------------------------ Annual Plan
p = B.sheet('Annual Plan', (14, 84, 30, 22, 11, 10, 10, 7, 7, 7, 7, 11, 11, 11), tab='00B050')
p.title('Annual Plan – tests required in the year for each obligation, by quarter', CD + ', paras 7, 9(3) and 15(3). Coverage is Green when the Test Programme holds at least the tests required.'); p.ws.freeze_panes = 'B7'
p.head(6, ['Obligation ID', 'Reference', 'Compliance domain', 'Owner function', 'Residual band', 'Priority', 'Tests required this year', 'Q1', 'Q2', 'Q3', 'Q4', 'Tests in the programme', 'Tests completed', 'Coverage'])
p.lbl('F4', 'Total', bold=True)
for col in 'GHIJKLM': p.f('%s4' % col, 'SUM(%s%d:%s%d)' % (col, R0, col, R0 + NU - 1), 'int', out=True)
for i in range(NU):
    r = R0 + i
    p.f('A%d' % r, 'IF(%s="","",%s)' % (RA('J', r), RA('A', r)), 'txt')
    for col, src in zip('BCDEF', 'BCDJK'): p.f('%s%d' % (col, r), 'IF(A%d="","",%s&"")' % (r, RA(src, r)), 'txt')
    p.f('G%d' % r, 'IF(A%d="","",IF(%s<>"",%s,MAX(IF(E%d="Critical",%s,IF(E%d="High",%s,IF(E%d="Medium",%s,%s))),IF(F%d="Yes",%s,0))))' % (r, U('N', r), U('N', r), r, S('th.freq.c'), r, S('th.freq.h'), r, S('th.freq.m'), S('th.freq.l'), r, S('th.freq.flag')), 'int')
    for k, col in enumerate('HIJK', 1):
        p.f('%s%d' % (col, r), 'IF($A%d="","",IF($G%d>=4,1,IF($G%d=3,IF(%d=IF($F%d="Yes",4,1),0,1),IF($G%d=2,IF(MOD(%d,2)=IF($F%d="Yes",0,MOD(ROW(),2)),1,0),IF($G%d=1,IF(%d=IF($F%d="Yes",0,MOD(ROW(),4)),1,0),0)))))' % (r, r, r, k, r, r, k - 1, r, r, k - 1, r), 'int')
    p.f('L%d' % r, 'IF(A%d="","",COUNTIFS(%s,A%d,%s,"<>Deferred"))' % (r, TR_('B'), r, TR_('J')), 'int'); p.f('M%d' % r, 'IF(A%d="","",COUNTIFS(%s,A%d,%s,"Completed"))' % (r, TR_('B'), r, TR_('J')), 'int')
    p.f('N%d' % r, 'IF(OR(A%d="",N(G%d)=0),"",IF(L%d>=G%d,"GREEN",IF(L%d>0,"AMBER","RED")))' % (r, r, r, r, r), 'txt')
p.rag('N%d:N%d' % (R0, R0 + NU - 1))

# ------------------------------------------------------------------ Test Results
t = B.sheet('Test Results', (12, 14, 84, 22, 30, 11, 9, 13, 13, 10, 11, 11, 11, 10, 11, 10, 6, 9), tab='00B050')
t.title('Test Results – sample, exception rate and result of each test', CD + ', para 15(3) (sufficient and representative testing). Exception rate = exceptions found / sample tested.'); t.ws.freeze_panes = 'B7'
t.head(6, ['Test ID', 'Obligation ID', 'Reference', 'Owner function', 'Compliance domain', 'Residual band', 'Quarter', 'Status', 'Sample recommended', 'Sample tested', 'Sample sufficient', 'Exceptions', 'Exception rate', 'Result', 'Timing', 'Second-officer review', 'Row', 'Figures'])
for i in range(NT):
    r = R0 + i; on = '%s=""' % T('A', r)
    t.f('Q%d' % r, 'IF(OR(%s,%s=""),"",IFERROR(MATCH(%s,%s,0),""))' % (on, T('B', r), T('B', r), UR('A')), 'int')
    t.f('A%d' % r, 'IF(%s,"",%s)' % (on, T('A', r)), 'txt'); t.f('B%d' % r, 'IF(%s,"",%s&"")' % (on, T('B', r)), 'txt')
    t.f('C%d' % r, 'IF(Q%d="","",INDEX(%s,Q%d)&", "&INDEX(%s,Q%d))' % (r, UR('B'), r, UR('C'), r), 'txt'); t.f('D%d' % r, 'IF(Q%d="","",INDEX(%s,Q%d)&"")' % (r, UR('F'), r), 'txt')
    t.f('E%d' % r, 'IF(Q%d="","",INDEX(%s,Q%d)&"")' % (r, UR('E'), r), 'txt'); t.f('F%d' % r, 'IF(Q%d="","",INDEX(%s,Q%d)&"")' % (r, RAR('J'), r), 'txt')
    t.f('G%d' % r, 'IF(%s,"",%s&"")' % (on, T('E', r)), 'txt'); t.f('H%d' % r, 'IF(%s,"",%s&"")' % (on, T('J', r)), 'txt')
    t.f('I%d' % r, 'IF(OR(F%d="",N(%s)<1),"",IF(%s="Data analytics",%s,IFERROR(MIN(%s,INDEX(%s,MATCH(%s,%s,1),MATCH(F%d,%s,0))),"")))' % (r, T('F', r), T('D', r), T('F', r), T('F', r), SMP, T('F', r), POP, r, BH), 'int')
    t.f('J%d' % r, 'IF(H%d<>"Completed","",N(%s))' % (r, T('L', r)), 'int'); t.f('K%d' % r, 'IF(OR(H%d<>"Completed",I%d=""),"",IF(J%d>=I%d,"Yes","Short"))' % (r, r, r, r), 'txt')
    t.f('L%d' % r, 'IF(H%d<>"Completed","",N(%s))' % (r, T('M', r)), 'int'); t.f('M%d' % r, 'IF(OR(H%d<>"Completed",N(J%d)=0),"",L%d/J%d)' % (r, r, r, r), 'pct')
    t.f('N%d' % r, 'IF(M%d="","",IF(AND(%s="Yes",N(%s)>0),"RED",IF(M%d>%s,"RED",IF(M%d>%s,"AMBER","GREEN"))))' % (r, S('th.exc.high'), T('N', r), r, S('th.exc.red'), r, S('th.exc.amber')), 'txt')
    t.f('O%d' % r, 'IF(%s,"",IF(H%d="Completed",IF(AND(%s<>"",%s<>"",%s>%s),"Late","On time"),IF(H%d="Deferred","Deferred",IF(AND(%s<>"",%s<>"",%s<%s),"Overdue","Not due"))))' % (on, r, T('K', r), T('G', r), T('K', r), T('G', r), r, T('G', r), REP, T('G', r), REP), 'txt')
    t.f('P%d' % r, 'IF(H%d<>"Completed","",IF(AND(%s<>"",%s<>%s),"OK","CHECK"))' % (r, T('I', r), T('I', r), T('H', r)), 'txt')
    t.f('R%d' % r, 'IF(%s,"",IF(OR(N(%s)>N(%s),N(%s)>N(%s)),"CHECK","OK"))' % (on, T('M', r), T('L', r), T('N', r), T('M', r)), 'txt')
t.rag('N%d:N%d' % (R0, R0 + NT - 1)); t.rag('P%d:P%d' % (R0, R0 + NT - 1)); t.rag('R%d:R%d' % (R0, R0 + NT - 1))
for txt, fill in (('Overdue', cfill('F8696B')), ('Late', cfill('FFC000')), ('Short', cfill('FFC000'))):
    t.ws.conditional_formatting.add('K%d:O%d' % (R0, R0 + NT - 1), CellIsRule(operator='equal', formula=['"%s"' % txt], fill=fill, font=Font(bold=True)))

# ------------------------------------------------------------------ Issue Ageing
g = B.sheet('Issue Ageing', (12, 20, 11, 22, 13, 13, 13, 10, 10, 9, 11, 13, 14, 30), tab='00B050')
g.title('Issue Ageing – due date, age and status of each issue', CD + ', paras 15(3), 15(4), 17 and 32(3) to 32(4). Age runs from the date raised to the report date, or to the closing date.'); g.ws.freeze_panes = 'B7'
g.head(6, ['Issue ID', 'Source', 'Severity', 'Owner function', 'Date raised', 'Due date', 'Status', 'Age (days)', 'Days overdue', 'Ageing bucket', 'Position', 'Extension approval', 'Staff accountability', 'Compliance domain'])
for i in range(NI):
    r = R0 + i; on = '%s=""' % I_('A', r)
    for col, src in zip('ABCD', 'ABGH'): g.f('%s%d' % (col, r), 'IF(%s,"",%s&"")' % (on, I_(src, r)), 'txt')
    g.f('E%d' % r, 'IF(OR(%s,%s=""),"",%s)' % (on, I_('I', r), I_('I', r)), 'date')
    g.f('F%d' % r, 'IF(E%d="","",IF(%s<>"",%s,IF(%s<>"",%s,E%d+IF(C%d="High",%s,IF(C%d="Medium",%s,%s)))))' % (r, I_('K', r), I_('K', r), I_('J', r), I_('J', r), r, r, S('th.days.h'), r, S('th.days.m'), S('th.days.l')), 'date')
    g.f('G%d' % r, 'IF(%s,"",%s&"")' % (on, I_('M', r)), 'txt')
    g.f('H%d' % r, 'IF(E%d="","",MAX(0,IF(AND(G%d="Closed",%s<>""),%s,%s)-E%d))' % (r, r, I_('N', r), I_('N', r), REP, r), 'int')
    g.f('I%d' % r, 'IF(F%d="","",IF(G%d="Open",MAX(0,%s-F%d),IF(AND(G%d="Closed",%s<>""),MAX(0,%s-F%d),0)))' % (r, r, REP, r, r, I_('N', r), I_('N', r), r), 'int')
    g.f('J%d' % r, 'IF(OR(E%d="",G%d<>"Open"),"",IF(H%d<=%s,1,IF(H%d<=%s,2,IF(H%d<=%s,3,4))))' % (r, r, r, S('th.age.1'), r, S('th.age.2'), r, S('th.age.3')), 'int')
    g.f('K%d' % r, 'IF(OR(%s,F%d=""),"",IF(G%d="Closed",IF(%s="Yes","Closed","AMBER"),IF(G%d="Risk accepted","Accepted",IF(G%d<>"Open","",IF(I%d>0,IF(OR(C%d="High",I%d>%s),"RED","AMBER"),IF(F%d-%s<=%s,"AMBER","GREEN"))))))' % (on, r, r, I_('O', r), r, r, r, r, r, S('th.over.red'), r, REP, S('th.due.amber')), 'txt')
    g.f('L%d' % r, 'IF(%s,"",IF(AND(%s<>"",%s=""),"CHECK","OK"))' % (on, I_('K', r), I_('L', r)), 'txt')
    g.f('M%d' % r, 'IF(%s,"",IF(C%d<>"High","Not required",IF(%s="Yes","Examined","Pending")))' % (on, r, I_('P', r)), 'txt')
    g.f('N%d' % r, 'IF(OR(%s,%s=""),"",IFERROR(INDEX(%s,MATCH(%s,%s,0))&"",""))' % (on, I_('C', r), UR('E'), I_('C', r), UR('A')), 'txt')
g.rag('K%d:L%d' % (R0, R0 + NI - 1))

# ------------------------------------------------------------------ New Products
n_ = B.sheet('New Products', (40, 13, 16, 12, 12, 40, 14, 12, 28, 10), tab='BF9000')
n_.title('New Products – intensive monitoring for the first six months', CD + ', paras 15(2), 9(7) and 31. Columns A to F are inputs; the last four columns are calculated.'); n_.ws.freeze_panes = 'B7'
n_.head(6, ['Product or process *', 'Date of launch *', 'Evaluated by the CCO or the product committee before launch', 'Monthly reviews completed', 'Compliance issues found', 'Remarks', 'Intensive monitoring ends on', 'Monthly reviews due so far', 'Stage', 'Status'])
for i in range(NP):
    r = R0 + i
    for col in 'ABCDEF':
        c = n_.ws['%s%d' % (col, r)]; c.fill = YEL; c.protection = Protection(locked=False); c.border = BD; c.number_format = F['date'] if col == 'B' else (F['int'] if col in 'DE' else '@'); c.font = Font(name='Calibri', size=10); c.alignment = Alignment(wrap_text=True, vertical='top')
    n_.f('G%d' % r, 'IF(OR(A%d="",B%d=""),"",EDATE(B%d,6))' % (r, r, r), 'date')
    n_.f('H%d' % r, 'IF(OR(G%d="",%s=""),"",MAX(0,MIN(6,(YEAR(%s)-YEAR(B%d))*12+MONTH(%s)-MONTH(B%d)-IF(DAY(%s)<DAY(B%d),1,0))))' % (r, REP, REP, r, REP, r, REP, r), 'int')
    n_.f('I%d' % r, 'IF(H%d="","",IF(%s>=G%d,"Monitoring period over","Under intensive monitoring"))' % (r, REP, r), 'txt')
    n_.f('J%d' % r, 'IF(H%d="","",IF(C%d<>"Yes","RED",IF(N(D%d)<H%d,"AMBER","GREEN")))' % (r, r, r, r), 'txt')
d_ = DataValidation(type='list', formula1='"Yes,No"', allow_blank=True); n_.ws.add_data_validation(d_); d_.add('C%d:C%d' % (R0, R0 + NP - 1))
B.inputs.append(dict(key='products', sheet='New Products', cell='A%d:F%d' % (R0, R0 + NP - 1), label='New Products: product or process; date of launch; evaluated before launch; monthly reviews completed; compliance issues found; remarks', source='New product approval records; monthly monitoring notes', default=None))
n_.rag('J%d:J%d' % (R0, R0 + NP - 1))

# ------------------------------------------------------------------ Management Dashboard
m = B.sheet('Management Dashboard', (58, 13, 13, 13, 13, 13, 13, 13, 13, 13, 12), tab='00B050')
m.title('Management Dashboard – compliance testing position for senior management', CD + ', paras 15(3) and 32(5). Issued monthly under the Compliance Policy.')
m.sec('A4', 'Position', 3)
PLT = lambda c: "'Annual Plan'!%s4" % c
done_due = '+'.join('IF(%s>=%d,COUNTIFS(%s,"Q%d",%s,"Completed"),0)' % (CQ, k, TR_('E'), k, TR_('J')) for k in range(1, 5))
req_due = '+'.join('IF(%s>=%d,%s,0)' % (CQ, k, PLT(c)) for k, c in enumerate('HIJK', 1))
POS = [('Company', S('setup.company') + '&""', 'txt'), ('Report date', 'IF(%s="","",%s)' % (REP, REP), 'date'), ('Quarter in progress', '"Q"&' + CQ, 'txt'), ('Obligations in the universe', 'SUMPRODUCT(--(%s<>""))' % UR('A'), 'int'),
       ('Obligations assessed (applicable to the company)', 'COUNT(%s)' % RAR('E'), 'int'), ('Obligations with Critical or High residual risk', 'COUNTIF(%s,"Critical")+COUNTIF(%s,"High")' % (RAR('J'), RAR('J')), 'int'),
       ('Tests required this year', PLT('G'), 'int'), ('Tests due up to the quarter in progress', req_due, 'int'), ('Tests completed out of those due', done_due, 'int'), ('Completion against the plan', div('B13', 'B12'), 'pct'),
       ('Tests overdue', 'COUNTIF(%s,"Overdue")' % TRR('O'), 'int'), ('Test results – Red', 'COUNTIF(%s,"RED")' % TRR('N'), 'int'), ('Test results – Amber', 'COUNTIF(%s,"AMBER")' % TRR('N'), 'int'), ('Test results – Green', 'COUNTIF(%s,"GREEN")' % TRR('N'), 'int'),
       ('Open issues', 'COUNTIF(%s,"Open")' % IAR('G'), 'int'), ('Open issues that are overdue', 'COUNTIFS(%s,"Open",%s,">0")' % (IAR('G'), IAR('I')), 'int'), ('Completed tests not yet reported to senior management', 'COUNTIFS(%s,"Completed",%s,"")' % (TR_('J'), TR_('P')), 'int')]
for j, (lab, fm, fmt) in enumerate(POS):
    m.lbl('A%d' % (5 + j), lab); m.f('B%d' % (5 + j), fm, fmt, out=True)
m.f('C14', 'IF(B12=0,"",%s)' % rag_lo_bad('B14', S('th.plan.amber'), S('th.plan.red')), 'txt'); m.f('C15', 'IF(B15>0,"RED","GREEN")', 'txt'); m.f('C20', 'IF(B20>0,"AMBER","GREEN")', 'txt'); m.f('C21', 'IF(B21>0,"AMBER","GREEN")', 'txt'); m.rag('C5:C21'); m.ws.merge_cells('B5:D5')
m.sec('A23', 'By quarter', 8); m.head(24, ['Quarter', 'Tests in the programme', 'Completed', 'Overdue', 'Red', 'Amber', 'Green', 'Exception rate'])
for k in range(1, 5):
    r = 24 + k; qk = '"Q%d"' % k; m.lbl('A%d' % r, 'Q%d' % k)
    m.f('B%d' % r, 'COUNTIFS(%s,%s,%s,"<>Deferred")' % (TR_('E'), qk, TR_('J')), 'int'); m.f('C%d' % r, 'COUNTIFS(%s,%s,%s,"Completed")' % (TR_('E'), qk, TR_('J')), 'int'); m.f('D%d' % r, 'COUNTIFS(%s,%s,%s,"Overdue")' % (TRR('G'), qk, TRR('O')), 'int')
    for col, c in zip('EFG', ('RED', 'AMBER', 'GREEN')): m.f('%s%d' % (col, r), 'COUNTIFS(%s,%s,%s,"%s")' % (TRR('G'), qk, TRR('N'), c), 'int')
    m.f('H%d' % r, div('SUMIFS(%s,%s,%s)' % (TRR('L'), TRR('G'), qk), 'SUMIFS(%s,%s,%s)' % (TRR('J'), TRR('G'), qk)), 'pct')
m.sec('A30', 'By owner function', 11); m.head(31, ['Owner function', 'Obligations', 'Critical or High residual', 'Tests completed', 'Red', 'Amber', 'Green', 'Exception rate', 'Open issues', 'Overdue issues', 'Status'])


def group_rows(sh, r0, src_col, ra_col, tr_col, ia_col, with_req):
    for j in range(ND):
        r = r0 + j; A = '$A%d' % r; bl = lambda fm: 'IF(%s="","",%s)' % (A, fm)
        sh.f('A%d' % r, "'Setup'!%s%d&\"\"" % (src_col, 5 + j), 'txt'); cols = iter('BCDEFGHIJKL')
        sh.f('%s%d' % (next(cols), r), bl('COUNTIF(%s,%s)' % (RAR(ra_col), A)), 'int')
        sh.f('%s%d' % (next(cols), r), bl('COUNTIFS(%s,%s,%s,"Critical")+COUNTIFS(%s,%s,%s,"High")' % (RAR(ra_col), A, RAR('J'), RAR(ra_col), A, RAR('J'))), 'int')
        if with_req: sh.f('%s%d' % (next(cols), r), bl('SUMIFS(%s,%s,%s)' % (PLR('G'), PLR('C'), A)), 'int')
        cd = next(cols); sh.f('%s%d' % (cd, r), bl('COUNTIFS(%s,%s,%s,"Completed")' % (TRR(tr_col), A, TRR('H'))), 'int'); rg = []
        for c in ('RED', 'AMBER', 'GREEN'):
            col = next(cols); rg.append(col); sh.f('%s%d' % (col, r), bl('COUNTIFS(%s,%s,%s,"%s")' % (TRR(tr_col), A, TRR('N'), c)), 'int')
        sh.f('%s%d' % (next(cols), r), bl(div('SUMIFS(%s,%s,%s)' % (TRR('L'), TRR(tr_col), A), 'SUMIFS(%s,%s,%s)' % (TRR('J'), TRR(tr_col), A))), 'pct')
        oi = next(cols); sh.f('%s%d' % (oi, r), bl('COUNTIFS(%s,%s,%s,"Open")' % (IAR(ia_col), A, IAR('G'))), 'int')
        od = 'COUNTIFS(%s,%s,%s,"Open",%s,">0")' % (IAR(ia_col), A, IAR('G'), IAR('I'))
        if not with_req:
            oc = next(cols); sh.f('%s%d' % (oc, r), bl(od), 'int')
        st = next(cols); sh.f('%s%d' % (st, r), bl('IF(%s%d>0,"RED",IF(OR(%s%d>0,%s>0),"AMBER",IF(%s%d>0,"GREEN","")))' % (rg[0], r, rg[1], r, od, cd, r)), 'txt')
    sh.rag('%s%d:%s%d' % (st, r0, st, r0 + ND - 1))


group_rows(m, 32, 'I', 'D', 'D', 'D', False)

# ------------------------------------------------------------------ Board Report
b = B.sheet('Board Report', (62, 14, 14, 14, 14, 14, 14, 14, 14, 14, 12, 6), tab='00B050')
b.title('Board Report – compliance risk and compliance testing', CD + ', paras 6, 7 and 9(4). Figures for the periodic review and the annual review placed before the Board or the Audit Committee.')
MD = lambda c: "'Management Dashboard'!%s" % c
b.sec('A4', '1. Overall position', 3)
for j, (lab, fm, fmt) in enumerate([('Company', MD('B5') + '&""', 'txt'), ('Report date', MD('B6'), 'date'), ('Quarter in progress', MD('B7'), 'txt')]):
    b.lbl('A%d' % (5 + j), lab); b.f('B%d' % (5 + j), fm, fmt)
b.ws.merge_cells('B5:D5'); b.ws.column_dimensions['L'].hidden = True
b.lbl('A8', 'Testing plan: tests completed as a share of the tests due to date'); b.f('B8', MD('B14'), 'pct', out=True); b.f('C8', MD('C14') + '&""', 'txt')
b.lbl('A9', 'Red results on obligations with Critical or High residual risk'); b.f('B9', 'COUNTIFS(%s,"RED",%s,"Critical")+COUNTIFS(%s,"RED",%s,"High")' % (TRR('N'), TRR('F'), TRR('N'), TRR('F')), 'int', out=True)
b.f('C9', 'IF(COUNTIF(%s,"Completed")=0,"",IF(B9>0,"RED",IF(COUNTIF(%s,"RED")+COUNTIF(%s,"AMBER")>0,"AMBER","GREEN")))' % (TRR('H'), TRR('N'), TRR('N')), 'txt')
b.lbl('A10', 'Open issues of High severity that are overdue'); b.f('B10', 'COUNTIFS(%s,"Open",%s,">0",%s,"High")' % (IAR('G'), IAR('I'), IAR('C')), 'int', out=True)
b.f('C10', 'IF(SUMPRODUCT(--(%s<>""))=0,"",IF(B10>0,"RED",IF(%s>0,"AMBER","GREEN")))' % (IR('A'), MD('B20')), 'txt')
b.lbl('A11', 'Overall status of compliance testing', bold=True); b.f('C11', 'IF(COUNTIF(C8:C10,"RED")>0,"RED",IF(COUNTIF(C8:C10,"AMBER")>0,"AMBER",IF(COUNTIF(C8:C10,"GREEN")>0,"GREEN","")))', 'txt', bold=True); b.rag('C8:C11')
b.sec('A13', '2. Compliance risk profile and its change', 5); b.head(14, ['Risk band', 'Inherent risk (obligations)', 'Residual risk (obligations)', 'Residual risk at the previous assessment', 'Change'])
for j, (nm, k) in enumerate(zip(reversed(BANDS), 'chml')):
    r = 15 + j; b.lbl('A%d' % r, nm); b.f('B%d' % r, 'COUNTIF(%s,"%s")' % (RAR('F'), nm), 'int'); b.f('C%d' % r, 'COUNTIF(%s,"%s")' % (RAR('J'), nm), 'int')
    b.f('D%d' % r, 'IF(%s="","",%s)' % (S('prev.' + k), S('prev.' + k)), 'int'); b.f('E%d' % r, 'IF(D%d="","",C%d-D%d)' % (r, r, r), '+0;-0;0')
b.lbl('A19', 'Total', bold=True)
for col in 'BCD': b.f('%s19' % col, 'SUM(%s15:%s18)' % (col, col), 'int', bold=True)
b.sec('A21', '3. Inherent risk against control rating (number of obligations)', 5); b.head(22, ['Inherent risk band'] + RATINGS)
for j, nm in enumerate(reversed(BANDS)):
    r = 23 + j; b.lbl('A%d' % r, nm)
    for k, rt in enumerate(RATINGS): b.f('%s%d' % (L(k + 2), r), 'COUNTIFS(%s,"%s",%s,"%s")' % (RAR('F'), nm, RAR('G'), rt), 'int')
b.sec('A28', '4. Results by compliance domain', 11); b.head(29, ['Compliance domain', 'Obligations', 'Critical or High residual', 'Tests required this year', 'Tests completed', 'Red', 'Amber', 'Green', 'Exception rate', 'Open issues', 'Status'])
group_rows(b, 30, 'H', 'C', 'E', 'N', True)
b.sec('A43', '5. Open issues by severity and age (days since the issue was raised)', 8)
for j, fm in enumerate(['"Severity"', '"Up to "&%s&" days"' % S('th.age.1'), '(%s+1)&" to "&%s&" days"' % (S('th.age.1'), S('th.age.2')), '(%s+1)&" to "&%s&" days"' % (S('th.age.2'), S('th.age.3')), '"Over "&%s&" days"' % S('th.age.3'), '"Total open"', '"Of which overdue"', '"Closed, not yet verified"']):
    b._c('%s44' % L(j + 1), '=' + fm, bold=True, fill=HDR, color='FFFFFF', align='center')
b.ws.row_dimensions[44].height = 30
for j, sv in enumerate(('High', 'Medium', 'Low')):
    r = 45 + j; b.lbl('A%d' % r, sv)
    for k in range(1, 5): b.f('%s%d' % (L(k + 1), r), 'COUNTIFS(%s,"%s",%s,%d)' % (IAR('C'), sv, IAR('J'), k), 'int')
    b.f('F%d' % r, 'COUNTIFS(%s,"%s",%s,"Open")' % (IAR('C'), sv, IAR('G')), 'int'); b.f('G%d' % r, 'COUNTIFS(%s,"%s",%s,"Open",%s,">0")' % (IAR('C'), sv, IAR('G'), IAR('I')), 'int')
    b.f('H%d' % r, 'COUNTIFS(%s,"%s",%s,"Closed",%s,"AMBER")' % (IAR('C'), sv, IAR('G'), IAR('K')), 'int')
b.lbl('A48', 'Total', bold=True)
for col in 'BCDEFGH': b.f('%s48' % col, 'SUM(%s45:%s47)' % (col, col), 'int', bold=True)
b.sec('A50', '6. Ten highest residual risks', 8); b.head(51, ['Obligation', 'Owner function', 'Residual score', 'Residual band', 'Control rating', 'Latest test result', 'Open issues', 'Rank'])
for k in range(1, 11):
    r = 51 + k; b.f('L%d' % r, 'IFERROR(MATCH(LARGE(%s,%d),%s,0),"")' % (RAR('N'), k, RAR('N')), 'int'); b.ws.row_dimensions[r].height = 30
    b.f('A%d' % r, 'IF($L%d="","",INDEX(%s,$L%d)&" – "&INDEX(%s,$L%d))' % (r, RAR('A'), r, RAR('B'), r), 'txt')
    for col, src, fmt in (('B', 'D', 'txt'), ('C', 'I', 'num'), ('D', 'J', 'txt'), ('E', 'G', 'txt'), ('F', 'L', 'txt'), ('G', 'M', 'int')):
        b.f('%s%d' % (col, r), 'IF($L%d="","",INDEX(%s,$L%d))' % (r, RAR(src), r), fmt)
    b.f('H%d' % r, 'IF($L%d="","",%d)' % (r, k), 'int')
b.rag('F52:F61')
b.sec('A63', '7. Annual review of compliance – the four matters of paragraph 7', 3)
cnt3 = lambda fm: '+'.join(fm % x for x in ('"Internal audit"', '"RBI inspection"', '"Statutory audit"'))
FPC = S('setup.fpc')
AR = [('7(1) Compliance failures recorded (self-reported breaches and Red test results)', 'COUNTIF(%s,"Self-reported breach")+COUNTIF(%s,"RED")' % (IR('B'), TRR('N')), 'int'),
      ('7(1) Regulatory penalties and losses from compliance failures (rupees)', 'N(%s)' % S('rev.penalty'), 'int'), ('7(1) Regulatory actions in the year', 'N(%s)' % S('rev.actions'), 'int'),
      ('7(1) Issues of High severity: staff accountability examined, out of total', 'COUNTIF(%s,"Examined")&" of "&COUNTIF(%s,"High")' % (IAR('M'), IAR('C')), 'txt'),
      ('7(1) Issues circulated to staff with preventive instructions', 'COUNTIF(%s,"Yes")' % IR('Q'), 'int'), ('7(2) Obligations under regulations issued or amended in the last 12 months', 'COUNTIF(%s,"Yes")' % UR('K'), 'int'),
      ('7(2) Of which tested at least once', 'COUNTIFS(%s,"Yes",%s,">0")' % (UR('K'), PLR('M')), 'int'), ('7(3) Fair practices and conduct: tests completed', 'COUNTIFS(%s,%s,%s,"Completed")' % (TRR('E'), FPC, TRR('H')), 'int'),
      ('7(3) Fair practices and conduct: results Red / Amber / Green', 'COUNTIFS(%s,%s,%s,"RED")&" / "&COUNTIFS(%s,%s,%s,"AMBER")&" / "&COUNTIFS(%s,%s,%s,"GREEN")' % (TRR('E'), FPC, TRR('N'), TRR('E'), FPC, TRR('N'), TRR('E'), FPC, TRR('N')), 'txt'),
      ('7(4) Audit and RBI inspection findings recorded', cnt3('COUNTIF(' + IR('B') + ',%s)'), 'int'), ('7(4) Of which closed', cnt3('COUNTIFS(' + IR('B') + ',%s,' + IR('M') + ',"Closed")'), 'int'),
      ('7(4) Of which open and overdue', cnt3('COUNTIFS(' + IAR('B') + ',%s,' + IAR('G') + ',"Open",' + IAR('I') + ',">0")'), 'int')]
for j, (lab, fm, fmt) in enumerate(AR):
    b.lbl('A%d' % (64 + j), lab); b.f('B%d' % (64 + j), fm, fmt, out=True); b.ws['B%d' % (64 + j)].alignment = Alignment(horizontal='right', vertical='top')
b.sec('A77', '8. New products and processes, and coverage of the plan', 3)
for j, (lab, fm) in enumerate([('New products and processes under intensive monitoring', 'COUNTIF(%s,"Under intensive monitoring")' % NPR('I')), ('New products listed: monitoring behind schedule, or launched without prior evaluation', 'COUNTIF(%s,"RED")+COUNTIF(%s,"AMBER")' % (NPR('J'), NPR('J'))),
                           ('Obligations that need a test but have none in the programme', 'COUNTIF(%s,"RED")' % PLR('N')), ('Obligations with fewer tests in the programme than required', 'COUNTIF(%s,"AMBER")' % PLR('N'))]):
    b.lbl('A%d' % (78 + j), lab); b.f('B%d' % (78 + j), fm, 'int', out=True)

# ------------------------------------------------------------------ Rules
ru = B.sheet('Rules', (6, 38, 92, 50), tab='7030A0', protect=False)
ru.title('Rules – the compliance testing rules in one table', 'For use in a compliance tool. Figures in the rules are the starting values on the Setup sheet.'); ru.head(5, ['#', 'Rule', 'Logic', 'Reference'])
RL = [('Inherent risk', 'likelihood (1 to 5) x impact (1 to 5); Low up to 4, Medium 5 to 9, High 10 to 16, Critical 17 to 25', CD + ', para 7; SOP – Compliance Function, Step B2'),
      ('Residual risk', 'inherent score x share remaining after the control: Strong 25%, Adequate 50%, Needs improvement 75%, Weak or none 100%; banded on the same scale', CD + ', paras 7 and 15(2)'),
      ('Priority', 'regulation new or amended in the last 12 months, or a failure, penalty or adverse finding in the last 12 months', 'Compliance Policy'),
      ('Tests in the year', 'Critical 4, High 4, Medium 2, Low 1; priority obligations at least 2 with the first in Q1; a figure fixed by Compliance overrides', CD + ', paras 9(3) and 15(3); Compliance Policy'),
      ('Quarter of each test', '4 or more tests: every quarter; 2 tests: Q1 and Q3, or Q2 and Q4; 1 test: one quarter, spread evenly down the list; priority obligations start in Q1', 'Management choice'),
      ('Sample size', 'by the number of items in the period tested and the residual band (table on Setup), never more than the items available; data analytics tests cover every item', CD + ', para 15(3) (sufficient and representative)'),
      ('Result of a test', 'exception rate = exceptions / sample; Green up to 5%, Amber above 5%, Red above 10%; any high-severity exception is Red', 'Management choice'),
      ('Second-officer review', 'a completed test needs a reviewer who is not the tester', 'SOP – Compliance Function, Stage C'), ('Reporting of results', 'every completed test carries the date on which its result was reported to senior management', CD + ', para 15(3)'),
      ('Due date of an issue', 'revised target date, else agreed target date, else date raised + 30 / 60 / 90 days for High / Medium / Low', CD + ', para 15(4); Management choice'),
      ('Extension', 'a revised target date needs the name of the authority that approved it', CD + ', para 32(4)'),
      ('Position of an issue', 'open and overdue: Red for High severity or when overdue by more than 30 days, otherwise Amber; open and due within 7 days: Amber; open otherwise: Green; closed but not verified by Compliance: Amber', CD + ', para 32(3)'),
      ('Staff accountability', 'examined for every issue of High severity', CD + ', para 15(3)'), ('New products', 'monthly review for six months from launch; Red when launched without prior evaluation, Amber when reviews are behind', CD + ', paras 15(2), 9(7) and 31'),
      ('Progress of the plan', 'tests completed / tests due up to the quarter in progress; Amber below 90%, Red below 75%', 'Management choice'),
      ('Overall status', 'worst of: progress of the plan; Red results on Critical or High obligations; overdue open issues of High severity', CD + ', paras 6 and 7')]
for j, (a_, b_, c_) in enumerate(RL, 1):
    for col, v in zip('ABCD', (j, a_, b_, c_)): ru.lbl('%s%d' % (col, 5 + j), v)

# ------------------------------------------------------------------ Method Notes
mn = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
mn.title('Method Notes – how this model produces its results')
mn.text_block(4, ['# 1. What the Directions require', 'The ' + CD + ' apply to NBFCs in the Middle and Upper Layer (para 3). Senior management carries out an annual compliance risk assessment and prepares a plan to manage the risks, and places a periodic review and a detailed annual review before the Board or the Audit Committee (paras 6 and 7). The Compliance function monitors and tests compliance through sufficient and representative testing and reports the results to senior management (para 15(3)). The Directions leave the method to the company; this model supplies one.',
 '# 2. Compliance universe', 'The universe is the list of obligations, one row for each paragraph of a Direction or section of a law that the company must comply with. Start from the result of the Applicability Engine and the Policy Register, and add obligations under other laws. Each row has one owner function and one compliance domain, both chosen from the lists on Setup. An obligation that does not apply to the company is marked "No" and drops out of the assessment.',
 '# 3. Inherent risk', 'Likelihood (how likely is a failure, given volumes, complexity, manual steps and past failures) and impact (penalty, supervisory action, loss, harm to customers, reputation) are each scored 1 to 5. Inherent score = likelihood x impact, from 1 to 25, banded Low, Medium, High or Critical by the limits on Setup.',
 '# 4. Control rating and residual risk', 'The control over each obligation is rated Strong, Adequate, Needs improvement or Weak or none. Each rating leaves a share of the inherent risk in place (25, 50, 75 and 100 per cent to begin with). Residual score = inherent score x that share, banded on the same scale. A blank control rating is treated as Weak or none. The rating should reflect the last test results, audit findings and breaches, not the design of the control alone.',
 '# 5. Annual plan', 'The number of tests in the year follows the residual band (Critical 4, High 4, Medium 2, Low 1 to begin with). An obligation whose regulation is new or was amended in the last 12 months, or which had a failure, penalty or adverse finding in that period, is a priority: it gets at least two tests and its first test falls in the first quarter. Compliance may fix another number for an obligation. The plan spreads the tests over the quarters so that the work is even; coverage compares the plan with the tests entered in the Test Programme.',
 '# 6. Sample size', 'For each test the model looks up the sample in the table on Setup, using the number of items in the period tested (loans sanctioned, returns filed, complaints closed and so on) and the residual band of the obligation. The sample is never larger than the number of items. A test run by data analytics covers every item. The last row of the table (more than 250 items) is statistical: with no exception in the sample, 22 and 29 items support the conclusion that not more than 10 per cent of the items fail, at 90 and 95 per cent confidence, and 45 and 59 items support not more than 5 per cent at the same confidence levels (sample = log of the risk accepted / log of 1 less the failure rate tolerated; the same figures appear in the attribute sampling tables of the AICPA Audit Guide, Audit Sampling). The rows for smaller numbers follow the usual practice for controls that run quarterly, monthly, weekly and daily, and the high-risk columns respect the floor of 25 items in the Compliance Policy. The Amber and Red limits of 5 and 10 per cent are the tolerable failure rates on which those samples rest. The Reserve Bank has not prescribed a sample size for compliance testing.',
 '# 7. Result of a test', 'Exception rate = exceptions found / sample tested. The result is Green up to the Amber limit, Amber above it and Red above the Red limit; a high-severity exception makes the test Red whatever the rate. "Sample sufficient" shows "Short" when the sample tested is smaller than the sample recommended. A completed test must name a reviewer other than the tester, and should carry the date on which its result was reported to senior management.',
 '# 8. Issues and ageing', 'Every exception that needs action, and every compliance-related audit finding and RBI inspection point, is entered in the Issue Tracker. The due date is the revised target date, else the agreed target date, else the date raised plus the days allowed for the severity. An open issue past its due date is Red when its severity is High or when it is overdue beyond the limit on Setup, otherwise Amber. A closed issue stays Amber until Compliance verifies the closure. A revised target date without the name of the approving authority shows CHECK.',
 '# 9. New products and processes', 'Each new product or process is listed with its date of launch. The model shows the end of the six-month period of intensive monitoring, the monthly reviews due so far and whether the reviews are up to date. A product launched without prior evaluation by the Chief Compliance Officer or the product committee shows Red.',
 '# 10. Reports', 'The Management Dashboard gives the position by quarter and by owner function for the monthly report to senior management. The Board Report gives the overall status, the risk profile and its change since the previous assessment, the heat map, results by domain, issue ageing, the ten highest residual risks and the figures for the four matters of paragraph 7. The overall status is the worst of three tests: progress of the plan, Red results on Critical or High obligations, and overdue issues of High severity.',
 '# 11. Limits of the model', 'The model holds %d obligations, %d tests, %d issues and %d new products in a year. It does not replace the test work-paper (CMP-A04), which records the evidence examined, or the judgement of the Chief Compliance Officer on the scores. Scores, bands, test frequencies, the sample table and thresholds are to be approved by the company before use and reviewed every year with the Compliance Policy.' % (NU, NT, NI, NP)])

# ------------------------------------------------------------------ Checks
ck = B.sheet('Checks', (6, 84, 12, 60), tab='FF0000')
ck.title('Checks – clear every "CHECK" before a report is issued'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
ua, ta, ia = UR('A'), TR_('A'), IR('A'); app = '(%s<>"")*(%s<>"No")' % (ua, UR('M'))
chk = [('The first day of the financial year and the report date are entered', 'AND(%s<>"",%s<>"")' % (S('setup.fystart.date'), REP), 'Complete Setup'),
       ('The risk bands and the sample table rise from one row to the next, and the sample table starts at 1 item', 'AND(%s<%s,%s<%s,%s=1,%s)' % (S('th.low'), S('th.med'), S('th.med'), S('th.high'), "'Setup'!$A$%d" % ROW['smp.first'], ','.join("'Setup'!$A$%d<'Setup'!$A$%d" % (x, x + 1) for x in range(ROW['smp.first'], ROW['smp.last']))), 'Correct Setup'),
       ('Every obligation has a Direction, a paragraph, a domain and an owner function', 'SUMPRODUCT((%s<>"")*((%s="")+(%s="")+(%s="")+(%s="")))=0' % (ua, UR('B'), UR('C'), UR('E'), UR('F')), 'Complete Universe Input'),
       ('Every applicable obligation has a likelihood, an impact and a control rating', 'SUMPRODUCT(%s*((%s="")+(%s="")+(%s="")))=0' % (app, UR('H'), UR('I'), UR('J')), 'Complete the scores in Universe Input'),
       ('Likelihood and impact scores are from 1 to 5', 'SUMPRODUCT((%s<>"")*((%s<1)+(%s>5)))+SUMPRODUCT((%s<>"")*((%s<1)+(%s>5)))=0' % (UR('H'), UR('H'), UR('H'), UR('I'), UR('I'), UR('I')), 'Correct the scores'),
       ('No Obligation ID is used twice', 'SUMPRODUCT((%s<>"")*(COUNTIF(%s,%s)>1))=0' % (ua, ua, ua), 'Give each obligation its own ID'),
       ('Every domain and owner function used is on the Setup lists', 'SUMPRODUCT((%s<>"")*(COUNTIF(%s,%s)=0))+SUMPRODUCT((%s<>"")*(COUNTIF(%s,%s)=0))=0' % (UR('E'), DOMR, UR('E'), UR('F'), FNR, UR('F')), 'Use the names on Setup, or add the name to the list'),
       ('Every test refers to an obligation in the universe and has a quarter and a status', 'SUMPRODUCT((%s<>"")*((%s="")+(%s="")+(%s="")))=0' % (ta, TRR('Q'), TR_('E'), TR_('J')), 'Correct the Obligation ID, quarter or status in Test Programme Input'),
       ('Every completed test has a completion date and a sample', 'SUMPRODUCT((%s="Completed")*((%s="")+(%s="")))=0' % (TR_('J'), TR_('K'), TR_('L')), 'Complete the result columns'),
       ('Exceptions are not more than the sample, and high-severity exceptions are not more than the exceptions', 'COUNTIF(%s,"CHECK")=0' % TRR('R'), 'Correct the figures'),
       ('Every completed test was reviewed by a second officer who is not the tester', 'COUNTIF(%s,"CHECK")=0' % TRR('P'), 'Enter the reviewer; the test is not closed without review'),
       ('The sample of every completed test is at least the sample recommended', 'COUNTIF(%s,"Short")=0' % TRR('K'), 'Extend the sample, or record why a smaller sample is sufficient'),
       ('Every issue has a source, a severity, an owner function, a date raised and a status', 'SUMPRODUCT((%s<>"")*((%s="")+(%s="")+(%s="")+(%s="")+(%s="")))=0' % (ia, IR('B'), IR('G'), IR('H'), IR('I'), IR('M')), 'Complete Issue Tracker Input'),
       ('Every closed issue has a closing date', 'SUMPRODUCT((%s="Closed")*(%s=""))=0' % (IR('M'), IR('N')), 'Enter the closing date'),
       ('Every revised target date carries the name of the approving authority', 'COUNTIF(%s,"CHECK")=0' % IAR('L'), 'Enter who approved the extension')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C%d' % (5 + len(chk)))
source_map(B)
B.wb._sheets = [B.wb[x] for x in ['ReadMe', 'Method Notes', 'Setup', 'Universe Input', 'Risk Assessment', 'Annual Plan', 'Test Programme Input', 'Test Results', 'Issue Tracker Input', 'Issue Ageing', 'New Products', 'Management Dashboard', 'Board Report', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('Compliance testing model built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
