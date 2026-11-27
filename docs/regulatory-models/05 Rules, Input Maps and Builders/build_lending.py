"""Lending Limits Monitor: default loss guarantee cap, gold and share loan-to-value, microfinance household tests.
Run: python3 build_lending.py <out.xlsx> <map.json>"""
import sys
from xl import *

ND, NGL, NSH, NMF = 50, 500, 200, 500; R0 = 7
B = Book('LEND-M01', 'Lending Limits Monitor')
YN = ['Yes', 'No']; CFD = 'RBI (NBFCs – Credit Facilities) Directions, 2025'

readme(B, 'Lending Limits Monitor',
       ['This workbook tests four product-level limits of the Credit Facilities Directions, loan by loan: the cap on default loss guarantee cover, the loan-to-value ratio of loans against gold and silver collateral, the loan-to-value ratio of loans against listed shares, and the household income and repayment tests for microfinance loans. Each test gives a Red / Amber / Green result.',
        'Use only the parts that match the company\'s products; the other input sheets stay empty. All amounts are in rupees, because the regulatory slabs are in rupees.'],
       ['Setup: confirm the limits and enter the date of the position.', 'Fill the input sheet of each product the company offers (paste from the loan system export).', 'Read the monitor sheet of each product and the Dashboard.', 'Clear the Checks sheet.'],
       [('Method Notes', 'explains every test'), ('Setup', 'limits'), ('Guarantee Input', 'default loss guarantee portfolios'), ('Guarantee Monitor', 'cap and invocation'), ('Gold Input', 'loans against gold and silver'), ('Gold Monitor', 'loan-to-value'),
        ('Share Input', 'loans against listed shares'), ('Share Monitor', 'loan-to-value and cure period'), ('Microfinance Input', 'households'), ('Microfinance Monitor', 'income and repayment tests'), ('Dashboard', 'summary'), ('Rules', 'rules for software'),
        ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Setup', (74, 20, 60), tab='C00000')
s.title('Setup – limits', 'Yellow cells are inputs. Regulatory limits are defaults from the Directions; internal limits are for the Board to set.')
R = [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None, ''), (5, 'Position as on', 'setup.date', None, 'date', None, ''), (6, 'Internal trigger as a share of a limit (amber from here)', 'th.trigger', 0.95, 'pct', None, 'Board-approved'),
     (8, 'Cap on default loss guarantee cover (share of the amount disbursed out of the portfolio)', 'th.dlg', 0.05, 'pct', None, CFD + ', para 24'), (9, 'Guarantee to be invoked within (days overdue)', 'th.dlgdays', 120, 'int', None, CFD + ', para 27'),
     (11, 'Gold and silver, consumption loans: first slab up to (₹, total per borrower)', 'th.gold1', 250000, 'int', None, CFD + ', para 43'), (12, 'Maximum loan-to-value in the first slab', 'th.goldltv1', 0.85, 'pct', None, CFD + ', para 43'),
     (13, 'Second slab up to (₹, total per borrower)', 'th.gold2', 500000, 'int', None, CFD + ', para 43'), (14, 'Maximum loan-to-value in the second slab', 'th.goldltv2', 0.80, 'pct', None, CFD + ', para 43'),
     (15, 'Maximum loan-to-value above the second slab', 'th.goldltv3', 0.75, 'pct', None, CFD + ', para 43'), (16, 'Internal loan-to-value limit for income-generating loans against gold and silver (blank = none set)', 'th.goldbiz', None, 'pct', None, 'Board-approved policy (para 32)'),
     (18, 'Asset size of ₹100 crore and above (conditions on loans against shares apply)', 'setup.las', 'Yes', 'txt', YN, CFD + ', para 106'), (19, 'Loan-to-value to be maintained on loans against listed shares', 'th.share', 0.50, 'pct', None, CFD + ', para 106'),
     (20, 'Shortfall to be made good within (working days)', 'th.sharedays', 7, 'int', None, CFD + ', para 106'),
     (22, 'Microfinance: annual household income up to (₹)', 'th.mfincome', 300000, 'int', None, CFD + ', para 51'), (23, 'Microfinance: limit on monthly repayment obligations as a share of monthly household income (Board policy; not above 50 per cent)', 'th.mfrepay', 0.50, 'pct', None, CFD + ', para 55')]
for r, lab, key, d, fmt, lst, src in R:
    s.lbl('A%d' % r, lab); s.lbl('C%d' % r, src); s.inp('B%d' % r, key, lab, d, fmt, src or 'Company', lst)
ST = lambda r: q('Setup', '$B$%d' % r)
TRG = ST(6)


def table(name, sub, heads, widths, n, key, source, yn=(), lists=(), dates=(), ints=()):
    t = B.sheet(name, widths, tab='BF9000'); t.title(name + ' – one row per ' + sub[0], sub[1]); t.head(6, heads)
    last = L(len(heads))
    for r in range(R0, R0 + n):
        for i in range(len(heads)):
            c = t.ws['%s%d' % (L(i + 1), r)]; c.fill = YEL; c.protection = Protection(locked=False); c.border = BD
            col = L(i + 1); c.number_format = F['date'] if col in dates else ('@' if col in ints or i < 2 else '#,##0')
    for col in yn:
        dv = DataValidation(type='list', formula1='"Yes,No"', allow_blank=True); t.ws.add_data_validation(dv); dv.add('%s%d:%s%d' % (col, R0, col, R0 + n - 1))
    for col, items in lists:
        dv = DataValidation(type='list', formula1='"%s"' % ','.join(items), allow_blank=True); t.ws.add_data_validation(dv); dv.add('%s%d:%s%d' % (col, R0, col, R0 + n - 1))
    B.inputs.append(dict(key=key, sheet=name, cell='A%d:%s%d' % (R0, last, R0 + n - 1), label=name + ': ' + '; '.join(heads), source=source, default=None))
    return (lambda c, r: "'%s'!%s%d" % (name, c, r)), (lambda c: "'%s'!$%s$%d:$%s$%d" % (name, c, R0, c, R0 + n - 1))


def status(v, lim): return 'IF(%s>%s+0.0000001,"RED",IF(%s>%s*%s,"AMBER","GREEN"))' % (v, lim, v, TRG, lim)


# ------------------------------------------------------------------ default loss guarantee
GI, GR = table('Guarantee Input', ('portfolio covered by a default loss guarantee', 'The portfolio covered is fixed when the arrangement starts.'),
               ['Portfolio *', 'Guarantee provider', 'Amount of the portfolio covered (sanctioned)', 'Amount disbursed out of the portfolio *', 'Cover: cash deposited', 'Cover: fixed deposit with lien', 'Cover: bank guarantee', 'Guarantee invoked to date', 'Oldest overdue on a loan not yet invoked (days)'],
               (26, 24, 18, 18, 16, 16, 16, 16, 16), ND, 'guarantees', 'Default loss guarantee agreements; register of guarantees; loan system')
g = B.sheet('Guarantee Monitor', (26, 16, 16, 12, 16, 12, 16, 12), tab='00B050')
g.title('Guarantee Monitor – cap on cover and invocation', CFD + ', paras 23, 24 and 27.')
g.head(6, ['Portfolio', 'Total cover', 'Amount disbursed', 'Cover as a share of amount disbursed', 'Highest cover allowed', 'Status – cap', 'Cover in excess', 'Status – invocation'])
for i in range(ND):
    r = R0 + i; on = '%s=""' % GI('A', r)
    g.f('A%d' % r, 'IF(%s,"",%s)' % (on, GI('A', r)), 'txt'); g.f('B%d' % r, 'IF(%s,"",N(%s)+N(%s)+N(%s))' % (on, GI('E', r), GI('F', r), GI('G', r)), 'int'); g.f('C%d' % r, 'IF(%s,"",N(%s))' % (on, GI('D', r)), 'int')
    g.f('D%d' % r, 'IF(OR(%s,N(C%d)=0),"",B%d/C%d)' % (on, r, r, r), 'pct'); g.f('E%d' % r, 'IF(%s,"",%s*C%d)' % (on, ST(8), r), 'int')
    g.f('F%d' % r, 'IF(D%d="","",%s)' % (r, status('D%d' % r, ST(8))), 'txt'); g.f('G%d' % r, 'IF(D%d="","",MAX(0,B%d-E%d))' % (r, r, r), 'int')
    g.f('H%d' % r, 'IF(%s,"",IF(N(%s)>%s,"RED",IF(N(%s)>%s*%s,"AMBER","GREEN")))' % (on, GI('I', r), ST(9), GI('I', r), TRG, ST(9)), 'txt')
g.rag('F%d:F%d' % (R0, R0 + ND - 1)); g.rag('H%d:H%d' % (R0, R0 + ND - 1))

# ------------------------------------------------------------------ gold
OI, OR_ = table('Gold Input', ('loan against gold or silver collateral', 'Total repayable at maturity is needed only for bullet repayment loans. Collateral value as per the valuation norms of the Directions.'),
                ['Loan ID *', 'Borrower ID *', 'Purpose *', 'Bullet repayment', 'Loan amount sanctioned *', 'Outstanding *', 'Total repayable at maturity (bullet loans)', 'Value of collateral *'], (18, 18, 20, 12, 16, 16, 18, 16), NGL, 'gold',
                'Loan system export; valuation record', yn=('D',), lists=(('C', ['Consumption', 'Income generating']),))
o = B.sheet('Gold Monitor', (18, 18, 18, 14, 16, 12, 12, 16), tab='00B050')
o.title('Gold Monitor – loan-to-value of loans against gold and silver', CFD + ', paras 43 and 44. The ratio is to be maintained throughout the tenor.')
o.head(6, ['Loan ID', 'Borrower ID', 'Total consumption loans of the borrower', 'Maximum loan-to-value', 'Amount for the ratio', 'Loan-to-value', 'Status', 'Amount above the limit'])
for i in range(NGL):
    r = R0 + i; on = '%s=""' % OI('A', r)
    o.f('A%d' % r, 'IF(%s,"",%s)' % (on, OI('A', r)), 'txt'); o.f('B%d' % r, 'IF(%s,"",%s)' % (on, OI('B', r)), 'txt')
    o.f('C%d' % r, 'IF(OR(%s,%s<>"Consumption"),"",SUMIFS(%s,%s,%s,%s,"Consumption"))' % (on, OI('C', r), OR_('E'), OR_('B'), OI('B', r), OR_('C')), 'int')
    o.f('D%d' % r, 'IF(%s,"",IF(%s="Consumption",IF(C%d<=%s,%s,IF(C%d<=%s,%s,%s)),IF(%s="","",%s)))' % (on, OI('C', r), r, ST(11), ST(12), r, ST(13), ST(14), ST(15), ST(16), ST(16)), 'pct')
    o.f('E%d' % r, 'IF(%s,"",IF(%s="Yes",MAX(N(%s),N(%s)),N(%s)))' % (on, OI('D', r), OI('G', r), OI('F', r), OI('F', r)), 'int'); o.f('F%d' % r, 'IF(OR(%s,N(%s)=0),"",E%d/%s)' % (on, OI('H', r), r, OI('H', r)), 'pct')
    o.f('G%d' % r, 'IF(F%d="","",IF(D%d="","No limit set",%s))' % (r, r, status('F%d' % r, 'D%d' % r)), 'txt'); o.f('H%d' % r, 'IF(OR(F%d="",D%d=""),"",MAX(0,E%d-D%d*%s))' % (r, r, r, r, OI('H', r)), 'int')
o.rag('G%d:G%d' % (R0, R0 + NGL - 1))

# ------------------------------------------------------------------ shares
HI, HR = table('Share Input', ('loan against listed shares', 'Enter the date on which the loan-to-value first went above the limit, if it is above the limit now.'),
               ['Loan ID *', 'Borrower', 'Outstanding *', 'Market value of shares pledged *', 'Date the shortfall arose'], (18, 26, 18, 20, 18), NSH, 'shares', 'Loan system export; daily mark-to-market of pledged shares', dates=('E',))
h = B.sheet('Share Monitor', (18, 26, 12, 16, 14, 14), tab='00B050')
h.title('Share Monitor – loan-to-value of loans against listed shares', CFD + ', para 106. A shortfall caused by price movement is made good within seven working days.')
h.head(6, ['Loan ID', 'Borrower', 'Loan-to-value', 'Shortfall to be made good', 'Working days since the shortfall arose', 'Status'])
for i in range(NSH):
    r = R0 + i; on = '%s=""' % HI('A', r)
    h.f('A%d' % r, 'IF(%s,"",%s)' % (on, HI('A', r)), 'txt'); h.f('B%d' % r, 'IF(%s,"",%s&"")' % (on, HI('B', r)), 'txt'); h.f('C%d' % r, 'IF(OR(%s,N(%s)=0),"",N(%s)/%s)' % (on, HI('D', r), HI('C', r), HI('D', r)), 'pct')
    h.f('D%d' % r, 'IF(C%d="","",MAX(0,N(%s)-%s*%s))' % (r, HI('C', r), ST(19), HI('D', r)), 'int')
    h.f('E%d' % r, 'IF(OR(C%d="",%s="",%s=""),"",MAX(0,NETWORKDAYS(%s,%s)-1))' % (r, HI('E', r), q('Setup', '$B$5'), HI('E', r), q('Setup', '$B$5')), 'int')
    h.f('F%d' % r, 'IF(C%d="","",IF(%s<>"Yes","Not applicable",IF(C%d<=%s+0.0000001,"GREEN",IF(E%d="","RED",IF(E%d>%s,"RED","AMBER")))))' % (r, ST(18), r, ST(19), r, r, ST(20)), 'txt')
h.rag('F%d:F%d' % (R0, R0 + NSH - 1))

# ------------------------------------------------------------------ microfinance
MI, MR = table('Microfinance Input', ('household', 'Obligations cover all outstanding loans of the household with all lenders, collateral-free and other.'),
               ['Household or borrower ID *', 'Member or centre', 'Annual household income as assessed *', 'Existing monthly repayment obligations (all lenders)', 'Monthly instalment of the proposed or existing loan of the company', 'Collateral-free'], (22, 22, 18, 20, 22, 12), NMF, 'households',
               'Household income assessment; credit information report', yn=('F',))
mf = B.sheet('Microfinance Monitor', (22, 16, 16, 16, 14, 12, 18), tab='00B050')
mf.title('Microfinance Monitor – household income and repayment tests', CFD + ', paras 51, 55 and 56.')
mf.head(6, ['Household or borrower ID', 'Qualifies as a microfinance loan', 'Monthly household income', 'Monthly repayment obligations', 'Obligations as a share of income', 'Status', 'Highest instalment the household can take'])
for i in range(NMF):
    r = R0 + i; on = '%s=""' % MI('A', r)
    mf.f('A%d' % r, 'IF(%s,"",%s)' % (on, MI('A', r)), 'txt'); mf.f('B%d' % r, 'IF(%s,"",IF(AND(N(%s)<=%s,%s<>"No"),"Yes","No"))' % (on, MI('C', r), ST(22), MI('F', r)), 'txt')
    mf.f('C%d' % r, 'IF(%s,"",N(%s)/12)' % (on, MI('C', r)), 'int'); mf.f('D%d' % r, 'IF(%s,"",N(%s)+N(%s))' % (on, MI('D', r), MI('E', r)), 'int'); mf.f('E%d' % r, 'IF(OR(%s,N(C%d)=0),"",D%d/C%d)' % (on, r, r, r), 'pct')
    mf.f('F%d' % r, 'IF(E%d="","",IF(B%d="No","Not microfinance",%s))' % (r, r, status('E%d' % r, 'MIN(%s,0.5)' % ST(23))), 'txt'); mf.f('G%d' % r, 'IF(OR(E%d="",B%d="No"),"",MAX(0,MIN(%s,0.5)*C%d-N(%s)))' % (r, r, ST(23), r, MI('D', r)), 'int')
mf.rag('F%d:F%d' % (R0, R0 + NMF - 1))

# ------------------------------------------------------------------ dashboard
d = B.sheet('Dashboard', (52, 14, 14, 14, 14, 30), tab='00B050')
d.title('Dashboard – lending limits at a glance'); d.head(5, ['Test', 'Items tested', 'Red', 'Amber', 'Green', 'Overall'])
DS = [('Default loss guarantee: cap on cover', 'Guarantee Monitor', 'F', ND), ('Default loss guarantee: invocation within the period', 'Guarantee Monitor', 'H', ND), ('Gold and silver: loan-to-value', 'Gold Monitor', 'G', NGL), ('Listed shares: loan-to-value', 'Share Monitor', 'F', NSH),
      ('Microfinance: repayment obligations', 'Microfinance Monitor', 'F', NMF)]
for j, (lab, sh, col, n) in enumerate(DS):
    r = 6 + j; rng = "'%s'!%s%d:%s%d" % (sh, col, R0, col, R0 + n - 1); d.lbl('A%d' % r, lab)
    for c, t in zip('CDE', ('RED', 'AMBER', 'GREEN')): d.f('%s%d' % (c, r), 'COUNTIF(%s,"%s")' % (rng, t), 'int')
    d.f('B%d' % r, 'C%d+D%d+E%d' % (r, r, r), 'int'); d.f('F%d' % r, 'IF(B%d=0,"",IF(C%d>0,"RED",IF(D%d>0,"AMBER","GREEN")))' % (r, r, r), 'txt')
d.rag('F6:F10')
d.lbl('A12', 'Total default loss guarantee cover in excess of the cap (₹)'); d.f('B12', "SUM('Guarantee Monitor'!G%d:G%d)" % (R0, R0 + ND - 1), 'int', out=True)
d.lbl('A13', 'Gold and silver loans: amount above the loan-to-value limit (₹)'); d.f('B13', "SUM('Gold Monitor'!H%d:H%d)" % (R0, R0 + NGL - 1), 'int', out=True)
d.lbl('A14', 'Loans against shares: shortfall to be made good (₹)'); d.f('B14', "SUM('Share Monitor'!D%d:D%d)" % (R0, R0 + NSH - 1), 'int', out=True)
d.lbl('A15', 'Households that do not qualify as microfinance'); d.f('B15', "COUNTIF('Microfinance Monitor'!B%d:B%d,\"No\")" % (R0, R0 + NMF - 1), 'int', out=True)

ru = B.sheet('Rules', (6, 40, 86, 46), tab='7030A0', protect=False)
ru.title('Rules – lending limit rules in one table', 'For use in a loan management system or compliance tool.'); ru.head(5, ['#', 'Rule', 'Logic', 'Reference'])
RL = [('Guarantee cover', '(cash deposited + fixed deposit with lien + bank guarantee) / amount disbursed out of the fixed portfolio <= 5%', CFD + ', paras 23, 24'), ('Guarantee invocation', 'invoke within 120 days overdue unless the borrower pays', CFD + ', para 27'),
      ('Gold and silver – slab', 'total consumption loans of the borrower: up to ₹2.5 lakh 85%; above ₹2.5 lakh and up to ₹5 lakh 80%; above ₹5 lakh 75%', CFD + ', para 43'),
      ('Gold and silver – ratio', 'outstanding / value of collateral; bullet repayment loans: total amount repayable at maturity / value of collateral; tested every day of the tenor', CFD + ', paras 43, 44'),
      ('Gold and silver – income-generating loans', 'internal limit under the Board-approved policy', CFD + ', para 32'), ('Listed shares', 'outstanding / market value <= 50% at all times (companies with assets of ₹100 crore and above)', CFD + ', para 106'),
      ('Listed shares – cure', 'shortfall from price movement made good within 7 working days; after that the breach is red', CFD + ', para 106'), ('Microfinance – qualification', 'collateral-free loan to a household with annual income up to ₹3,00,000', CFD + ', para 51'),
      ('Microfinance – repayment', '(existing monthly obligations on all loans + instalment) / (annual household income / 12) <= Board limit, not above 50%', CFD + ', paras 55, 56'), ('Internal trigger', 'amber when a ratio is above the trigger share (95% by default) of its limit', 'Board-approved')]
for j, (a_, b_, c_) in enumerate(RL, 1):
    for col, v in zip('ABCD', (j, a_, b_, c_)): ru.lbl('%s%d' % (col, 5 + j), v)

m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how this monitor produces its results')
m.text_block(4, ['# 1. Default loss guarantee', 'The cover on a portfolio – cash deposited with the company, fixed deposit with a lien in its favour and bank guarantee – is added up and divided by the amount disbursed out of that portfolio. The portfolio is fixed at the start and is not dynamic. Cover above 5 per cent is red. A loan overdue beyond 120 days without invocation of the guarantee is red. Guarantees under the exempted schemes named in the Directions are left out of the input.',
 '# 2. Loans against gold and silver', 'For consumption loans the limit depends on the total consumption loans of the borrower against such collateral, which the monitor adds up by Borrower ID from the sanctioned amounts. The ratio is outstanding divided by the value of the collateral; for bullet repayment loans the total amount repayable at maturity is used. For income-generating loans the Directions leave the limit to the Board-approved policy; enter it on Setup. Run the monitor on the day\'s values, since the ratio must hold throughout the tenor.',
 '# 3. Loans against listed shares', 'A company with assets of ₹100 crore and above keeps a loan-to-value of 50 per cent at all times. A shortfall caused by movement in share prices is made good within seven working days. The monitor shows amber while the cure period runs and red after it, or where no date is entered. Working days are counted Monday to Friday; exchange holidays are not known to the monitor.',
 '# 4. Microfinance', 'A microfinance loan is a collateral-free loan to a household with annual income up to ₹3,00,000. Monthly repayment obligations of the household on all its loans, including the company\'s instalment, are limited by Board policy to a share of monthly household income that cannot be above 50 per cent. Expected income from the asset or activity financed is not counted as income. The last column shows the highest instalment the household can still take.',
 '# 5. Limits of the monitor', 'The monitor holds %d guarantee portfolios, %d gold loans, %d share loans and %d households; larger books are run in batches or through the rules coded in the loan system. Valuation of collateral, purity norms and the other conditions for loans against shares are outside the monitor.' % (ND, NGL, NSH, NMF)])

ck = B.sheet('Checks', (6, 76, 12, 54), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
chk = [('The date of the position is entered', '%s<>""' % q('Setup', '$B$5'), 'Complete Setup'), ('Every guarantee portfolio has an amount disbursed', 'SUMPRODUCT((%s<>"")*(%s=""))=0' % (GR('A'), GR('D')), 'Complete Guarantee Input'),
       ('Every gold loan has a purpose, a sanctioned amount and a collateral value', 'SUMPRODUCT((%s<>"")*((%s="")+(%s="")+(%s="")))=0' % (OR_('A'), OR_('C'), OR_('E'), OR_('H')), 'Complete Gold Input'),
       ('Every bullet gold loan has the amount repayable at maturity', 'SUMPRODUCT((%s="Yes")*(%s=""))=0' % (OR_('D'), OR_('G')), 'Enter the amount repayable at maturity'), ('Every share loan has a market value', 'SUMPRODUCT((%s<>"")*(%s=""))=0' % (HR('A'), HR('D')), 'Complete Share Input'),
       ('Every household has an assessed income', 'SUMPRODUCT((%s<>"")*(%s=""))=0' % (MR('A'), MR('C')), 'Complete Microfinance Input'), ('The Board limit for microfinance repayment is not above 50 per cent', 'N(%s)<=0.5' % ST(23), 'Correct the limit on Setup')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C12')
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Guarantee Input', 'Guarantee Monitor', 'Gold Input', 'Gold Monitor', 'Share Input', 'Share Monitor', 'Microfinance Input', 'Microfinance Monitor', 'Dashboard', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('Lending limits monitor built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
