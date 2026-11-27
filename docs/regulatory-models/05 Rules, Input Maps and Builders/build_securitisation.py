"""Securitisation Retention and Holding Period Calculator (SEC-M01): loan-by-loan eligibility and minimum holding period, minimum retention requirement
and the form in which it is held.  Run: python3 build_securitisation.py <out.xlsx> <map.json>
Paragraph numbers read against the Source text on 25-11-2026: Securitisation Transactions Directions, 2025 (MD 353) paras 5 to 8, 10 to 14, 110, 112;
Transfer and Distribution of Credit Risk Directions, 2025 (MD 352) para 43."""
import sys
from xl import *

N = 500; R0 = 7
B = Book('SEC-M01', 'Securitisation Retention and Holding Period Calculator')
YN = ['Yes', 'No']; SD = 'RBI (NBFCs – Securitisation Transactions) Directions, 2025'; TD = 'RBI (NBFCs – Transfer and Distribution of Credit Risk) Directions, 2025'
INEL = ['None', 'Revolving credit facility', 'Restructured loan in the specified period', 'Exposure to another lending institution', 'Refinance exposure of an AIFI']

readme(B, 'Securitisation Retention and Holding Period Calculator',
       ['This workbook tests a pool of loans that the company proposes to securitise as originator. For every loan it checks that the loan is eligible, that the minimum holding period has run on the date of transfer, and which rate of minimum retention applies. For the pool it works out the minimum retention requirement and tests the amount and the form of what the company retains.',
        'It serves paragraphs 5 to 8 and 10 to 14 of the ' + SD + ' and paragraph 43 of the ' + TD + '. Amounts are in rupees or in any one unit used throughout.'],
       ['Setup: enter the date of transfer, whether the notes are residential mortgage backed securities and the basis for a mixed pool; confirm the rates and periods.', 'Pool Input: paste one row per loan from the loan system.',
        'Read Pool Test: every loan shows whether it is eligible and whether its holding period is complete.', 'Retention: enter what the company retains and answer the four questions.', 'Read the Dashboard and clear the Checks sheet.'],
       [('Method Notes', 'explains every test'), ('Setup', 'dates, rates and periods'), ('Pool Input', 'one row per loan'), ('Pool Test', 'eligibility, holding period and retention rate of each loan'), ('Retention', 'requirement and what is retained'),
        ('Dashboard', 'summary'), ('Rules', 'rules for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Setup', (78, 20, 64), tab='C00000')
s.title('Setup – dates, rates and periods', 'Yellow cells are inputs. Rates and periods are those of the Directions; change them only when the Directions change.')
ROW = {}
R = [('Company name', 'setup.company', 'Name of the NBFC', 'txt', None, ''), ('Date of transfer of the pool to the special purpose entity', 'setup.date', None, 'date', None, 'Deal documents'),
     ('Notes are residential mortgage backed securities', 'setup.rmbs', 'No', 'txt', YN, SD + ', para 11'), ('Pool with both short and long loans: basis of the retention rate', 'setup.basis', 'Loan by loan', 'txt', ['Loan by loan', 'Higher rate on the whole pool'], 'Reading of para 10; confirm with the arranger and the auditor'),
     None,
     ('Retention rate: original maturity up to the limit below', 'th.mrr1', 0.05, 'pct', None, SD + ', para 10(1)'), ('Original maturity limit for the lower rate (months)', 'th.mat', 24, 'int', None, SD + ', para 10(1)'),
     ('Retention rate: original maturity above the limit, and loans with bullet repayment', 'th.mrr2', 0.10, 'pct', None, SD + ', para 10(2)'), ('Retention rate: residential mortgage backed securities', 'th.mrr3', 0.05, 'pct', None, SD + ', para 11'),
     ('Part of the retention that follows the order first loss facility, equity tranche, other tranches', 'th.order', 0.05, 'pct', None, SD + ', para 12(1)'),
     None,
     ('Holding period: loans with tenor up to the limit below (months)', 'th.mhp1', 3, 'int', None, TD + ', para 43(1)'), ('Tenor limit for the shorter holding period (months)', 'th.tenor', 24, 'int', None, TD + ', para 43(1): up to 2 years'),
     ('Holding period: loans with longer tenor (months)', 'th.mhp2', 6, 'int', None, TD + ', para 43(2)'), ('Holding period: loans acquired from another entity, from the date taken into the books (months)', 'th.mhp3', 6, 'int', None, TD + ', para 43, third proviso'),
     ('Least residual maturity of a loan on the date of transfer (days)', 'th.resid', 365, 'int', None, SD + ', para 5(4)(vi)')]
r = 4
for x in R:
    if x:
        lab, key, d, fmt, lst, src = x; s.lbl('A%d' % r, lab); s.lbl('C%d' % r, src); s.inp('B%d' % r, key, lab, d, fmt, src or 'Company', lst); ROW[key] = r
    r += 1
S = lambda k: q('Setup', '$B$%d' % ROW[k]); DT = S('setup.date')

HEAD = ['Loan ID *', 'Borrower', 'Book value on the date of transfer *', 'Original maturity (months) *', 'Residual maturity (days) *', 'Asset classification *', 'Ineligible type', 'Principal and interest both due only at maturity',
        'Bullet loan allowed by the proviso (farm loan up to 24 months or trade receivable up to 12 months, with repayment record)', 'Acquired from another entity', 'Date taken into the books (acquired loans)', 'Project loan',
        'Date of commencement of commercial operations (project loans)', 'Commercial or residential real estate mortgage', 'Date of full disbursement (mortgages)', 'Security registered with CERSAI', 'Date of registration with CERSAI', 'Date of first repayment']
t = B.sheet('Pool Input', (14, 24, 16, 12, 12, 14, 26, 14, 22, 12, 14, 10, 16, 14, 14, 12, 14, 14), tab='BF9000')
t.title('Pool Input – one row per loan', 'Columns marked * are needed for every loan. Dates are needed only where the column applies to the loan.'); t.head(6, HEAD); t.ws.freeze_panes = 'B7'
DATES = 'KMOQR'
for rr in range(R0, R0 + N):
    for i in range(len(HEAD)):
        col = L(i + 1); c = t.ws['%s%d' % (col, rr)]; c.fill = YEL; c.protection = Protection(locked=False); c.border = BD; c.font = Font(name='Calibri', size=10)
        c.number_format = F['date'] if col in DATES else ('#,##0' if col in 'CDE' else '@')
for col, items in (('F', ['Standard', 'Not standard']), ('G', INEL), ('H', YN), ('I', YN), ('J', YN), ('L', YN), ('N', YN), ('P', YN)):
    dv = DataValidation(type='list', formula1='"%s"' % ','.join(items), allow_blank=True); t.ws.add_data_validation(dv); dv.add('%s%d:%s%d' % (col, R0, col, R0 + N - 1))
B.inputs.append(dict(key='pool', sheet='Pool Input', cell='A%d:R%d' % (R0, R0 + N - 1), label='Pool Input: ' + '; '.join(HEAD), source='Loan system export; CERSAI registration record', default=None))
P = lambda c, r: "'Pool Input'!%s%d" % (c, r); PR = lambda c: "'Pool Input'!$%s$%d:$%s$%d" % (c, R0, c, R0 + N - 1)

x = B.sheet('Pool Test', (14, 16, 30, 12, 34, 14, 10, 14, 12, 12, 10, 16), tab='00B050')
x.title('Pool Test – eligibility, holding period and retention rate of each loan', SD + ', paras 5 to 8 and 10; ' + TD + ', para 43.'); x.ws.freeze_panes = 'B7'
x.head(6, ['Loan ID', 'Book value', 'Eligibility', 'Eligible', 'Holding period counted from', 'Start date', 'Months required', 'Holding period ends', 'Holding period', 'Days short', 'Retention rate', 'Retention required'])
for i in range(N):
    r = R0 + i; on = '%s=""' % P('A', r); bul = '%s="Yes"' % P('H', r); prov = '%s="Yes"' % P('I', r)
    x.f('A%d' % r, 'IF(%s,"",%s)' % (on, P('A', r)), 'txt'); x.f('B%d' % r, 'IF(%s,"",N(%s))' % (on, P('C', r)), 'int')
    x.f('C%d' % r, 'IF(%s,"",IF(%s<>"Standard","Not eligible: not a standard asset",IF(AND(%s<>"",%s<>"None"),"Not eligible: "&%s,IF(AND(%s,NOT(%s)),"Not eligible: bullet repayment loan",IF(AND(NOT(%s),N(%s)<%s),"Not eligible: residual maturity below the minimum","Eligible")))))'
        % (on, P('F', r), P('G', r), P('G', r), P('G', r), bul, prov, prov, P('E', r), S('th.resid')), 'txt')
    x.f('D%d' % r, 'IF(%s,"",IF(C%d="Eligible","Yes","No"))' % (on, r), 'txt')
    x.f('E%d' % r, 'IF(%s,"",IF(%s,"Not applicable (bullet loan under the proviso)",IF(%s="Yes","Date taken into the books",IF(%s="Yes","Commencement of commercial operations",IF(%s="Yes","Later of full disbursement and registration",IF(%s="Yes","Registration with CERSAI","First repayment"))))))'
        % (on, prov, P('J', r), P('L', r), P('N', r), P('P', r)), 'txt')
    x.f('F%d' % r, 'IF(OR(%s,%s),"",IF(%s="Yes",IF(%s="","",%s),IF(%s="Yes",IF(%s="","",%s),IF(%s="Yes",IF(OR(%s="",%s=""),"",MAX(%s,%s)),IF(%s="Yes",IF(%s="","",%s),IF(%s="","",%s))))))'
        % (on, prov, P('J', r), P('K', r), P('K', r), P('L', r), P('M', r), P('M', r), P('N', r), P('O', r), P('Q', r), P('O', r), P('Q', r), P('P', r), P('Q', r), P('Q', r), P('R', r), P('R', r)), 'date')
    x.f('G%d' % r, 'IF(OR(%s,%s),"",IF(%s="Yes",%s,IF(N(%s)<=%s,%s,%s)))' % (on, prov, P('J', r), S('th.mhp3'), P('D', r), S('th.tenor'), S('th.mhp1'), S('th.mhp2')), 'int')
    x.f('H%d' % r, 'IF(OR(F%d="",G%d=""),"",EDATE(F%d,G%d))' % (r, r, r, r), 'date')
    x.f('I%d' % r, 'IF(%s,"",IF(%s,"Not applicable",IF(OR(H%d="",%s=""),"CHECK",IF(%s>=H%d,"GREEN","RED"))))' % (on, prov, r, DT, DT, r), 'txt')
    x.f('J%d' % r, 'IF(I%d="RED",H%d-%s,"")' % (r, r, DT), 'int')
    x.f('K%d' % r, 'IF(OR(%s,D%d<>"Yes"),"",IF(%s="Yes",%s,IF(OR(%s,N(%s)>%s),%s,%s)))' % (on, r, S('setup.rmbs'), S('th.mrr3'), bul, P('D', r), S('th.mat'), S('th.mrr2'), S('th.mrr1')), 'pct')
    x.f('L%d' % r, 'IF(K%d="","",B%d*K%d)' % (r, r, r), 'num')
x.rag('I%d:I%d' % (R0, R0 + N - 1))
X = lambda c: "'Pool Test'!$%s$%d:$%s$%d" % (c, R0, c, R0 + N - 1)

m = B.sheet('Retention', (84, 20, 14, 56), tab='00B050')
m.title('Retention – minimum retention requirement and what the company retains', SD + ', paras 10 to 14. Yellow cells are inputs.')
m.sec('A4', 'Requirement', 4)
m.lbl('A5', 'Book value of eligible loans in the pool'); m.f('B5', 'SUMIFS(%s,%s,"Yes")' % (X('B'), X('D')), 'num', out=True)
m.lbl('A6', 'Retention required, loan by loan'); m.f('B6', 'SUM(%s)' % X('L'), 'num')
m.lbl('A7', 'Highest retention rate of any eligible loan in the pool'); m.f('B7', 'IF(COUNT(%s)=0,0,MAX(%s))' % (X('K'), X('K')), 'pct')
m.lbl('A8', 'Minimum retention requirement'); m.f('B8', 'IF(%s="Higher rate on the whole pool",B5*B7,B6)' % S('setup.basis'), 'num', out=True); m.lbl('D8', 'Basis chosen on Setup')
m.lbl('A9', 'Requirement as a share of the book value'); m.f('B9', div('B8', 'B5'), 'pct')
m.sec('A11', 'Retained by the company', 4)
RI = [(12, 'First loss facility retained (do not count over-collateralisation)', 'ret.flf', 'num', None, SD + ', para 12, Explanation'), (13, 'Whole of the first loss facility is retained, or none is available', 'ret.flfall', 'txt', YN, SD + ', para 12(1)(ii)'),
      (14, 'Equity tranche retained', 'ret.eq', 'num', None, SD + ', para 12(1)(ii)'), (15, 'Whole of the equity tranche is retained, or there is none', 'ret.eqall', 'txt', YN, SD + ', para 12(1)(iii)'),
      (16, 'Other tranches sold to investors, retained pari passu', 'ret.other', 'num', None, SD + ', para 12(1)(iii) and 12(2)'), (17, 'Interest-only strip (excess interest spread) held – not counted', 'ret.io', 'num', None, SD + ', para 13')]
for r, lab, key, fmt, lst, src in RI:
    m.lbl('A%d' % r, lab); m.inp('B%d' % r, key, lab, None, fmt, 'Deal structure; information memorandum', lst); m.lbl('D%d' % r, src)
m.lbl('A18', 'Retention counted'); m.f('B18', 'N(B12)+N(B14)+N(B16)', 'num', out=True)
m.lbl('A19', 'Surplus (+) or shortfall (-)'); m.f('B19', 'B18-B8', 'num', out=True)
m.sec('A21', 'Tests', 4)
m.lbl('A22', 'Amount: retention counted is not below the requirement'); m.f('B22', 'IF(B5=0,"",IF(B18+0.005>=B8,"GREEN","RED"))', 'txt'); m.lbl('D22', SD + ', paras 10 and 11')
m.lbl('A23', 'Form: the first part of the retention is in the first loss facility and the equity tranche, unless both are retained in full'); m.lbl('D23', SD + ', para 12(1)')
m.f('B23', 'IF(B5=0,"",IF(N(B12)+N(B14)+0.005>=MIN(B8,%s*B5),"GREEN",IF(AND(B13="Yes",B15="Yes"),"GREEN","RED")))' % S('th.order'), 'txt')
QS = [(24, 'Retention is held by the company itself and not by a group entity', 'ret.own', SD + ', para 14(1)'), (25, 'Retained interest is not hedged, sold or encumbered', 'ret.free', SD + ', para 14'),
      (26, 'The form of retention will stay the same for the life of the securitisation', 'ret.form', SD + ', para 14(1)'), (27, 'Weighted average holding period and the level of retention are disclosed to investors, and the fulfilment of both requirements is public', 'ret.disc', SD + ', paras 110 and 112')]
for r, lab, key, src in QS:
    m.lbl('A%d' % r, lab); m.inp('B%d' % r, key, lab, None, 'txt', 'Deal documents', YN); m.f('C%d' % r, 'IF(B%d="","",IF(B%d="Yes","GREEN","RED"))' % (r, r), 'txt'); m.lbl('D%d' % r, src)
m.rag('B22:C27')

d = B.sheet('Dashboard', (64, 18, 14), tab='00B050')
d.title('Dashboard – the pool at a glance'); d.head(4, ['Item', 'Value', 'Status'])
DS = [('Loans in the pool', 'SUMPRODUCT(--(%s<>""))' % PR('A'), 'int', None), ('Book value of the pool', 'SUM(%s)' % X('B'), 'num', None), ('Loans not eligible', 'COUNTIF(%s,"No")' % X('D'), 'int', 'IF(B7>0,"RED","GREEN")'),
      ('Book value of loans not eligible', 'SUMIFS(%s,%s,"No")' % (X('B'), X('D')), 'num', None), ('Eligible loans whose holding period is not complete', 'COUNTIFS(%s,"RED",%s,"Yes")' % (X('I'), X('D')), 'int', 'IF(B9>0,"RED","GREEN")'),
      ('Eligible loans with a date missing', 'COUNTIFS(%s,"CHECK",%s,"Yes")' % (X('I'), X('D')), 'int', 'IF(B10>0,"AMBER","GREEN")'), ('Longest wait before every eligible loan completes its holding period (days)', 'IF(COUNT(%s)=0,0,MAX(%s))' % (X('J'), X('J')), 'int', None),
      ('Minimum retention requirement', "'Retention'!B8", 'num', None), ('Retention counted', "'Retention'!B18", 'num', "'Retention'!B22&\"\""), ('Form of retention', '"see Retention"', 'txt', "'Retention'!B23&\"\""),
      ('Conditions on the retained interest and disclosure', 'COUNTIF(\'Retention\'!C24:C27,"GREEN")&" of 4 met"', 'txt', 'IF(COUNTIF(\'Retention\'!C24:C27,"RED")>0,"RED",IF(COUNTIF(\'Retention\'!C24:C27,"GREEN")=4,"GREEN","AMBER"))'),
      ('Pool ready to securitise', '""', 'txt', 'IF(B5=0,"",IF(COUNTIF(C7:C15,"RED")>0,"RED",IF(COUNTIF(C7:C15,"AMBER")>0,"AMBER","GREEN")))')]
for j, (lab, fm, fmt, st) in enumerate(DS):
    r = 5 + j; d.lbl('A%d' % r, lab, bold=(j == len(DS) - 1)); d.f('B%d' % r, fm, fmt, out=True)
    if st: d.f('C%d' % r, st, 'txt')
d.ws['B14'].alignment = Alignment(horizontal='right'); d.ws['B15'].alignment = Alignment(horizontal='right'); d.rag('C5:C16')

ru = B.sheet('Rules', (6, 36, 96, 50), tab='7030A0', protect=False)
ru.title('Rules – the tests in one table', 'For use in a loan management system.'); ru.head(5, ['#', 'Rule', 'Logic', 'Reference'])
RL = [('Eligible asset', 'on-balance sheet loan classified Standard; not a revolving facility, a restructured loan in the specified period, an exposure to a lending institution or a refinance exposure of an AIFI', SD + ', paras 5 and 6'),
      ('Bullet loans', 'not eligible, except farm loans to individuals with tenor up to 24 months and trade receivables with tenor up to 12 months that meet the repayment record condition', SD + ', para 5(4)(v) and proviso'),
      ('Residual maturity', 'at least 365 days on the date of transfer (not applied to the bullet loans allowed by the proviso)', SD + ', para 5(4)(vi)'),
      ('Holding period – length', '3 months for tenor up to 2 years; 6 months for longer tenor; applied loan by loan; not applicable to the bullet loans allowed by the proviso', TD + ', para 43; ' + SD + ', para 8'),
      ('Holding period – start', 'date of registration of the security interest with CERSAI; date of first repayment where there is no security or it cannot be registered; date of commencement of commercial operations for project loans; for commercial or residential real estate mortgages, the later of full disbursement and registration', TD + ', para 43 and provisos; ' + SD + ', para 7'),
      ('Acquired loans', 'not before 6 months from the date the loan was taken into the books', TD + ', para 43, third proviso'),
      ('Retention rate', '5% of book value for original maturity up to 24 months; 10% above 24 months and for bullet loans; 5% for residential mortgage backed securities whatever the maturity', SD + ', paras 10 and 11'),
      ('Form of retention', 'up to 5% of book value: first loss facility; then equity tranche; then pari passu in the tranches sold. Above 5%: first loss facility, equity tranche or any other tranche in any combination. Over-collateralisation and the interest-only strip are not counted', SD + ', paras 12 and 13'),
      ('Conditions', 'held by the originator itself; not hedged, sold or encumbered; form unchanged for the life of the deal; maintained as a percentage of unamortised principal on an ongoing basis; disclosed', SD + ', paras 14, 110 and 112')]
for j, (a_, b_, c_) in enumerate(RL, 1):
    for col, v in zip('ABCD', (j, a_, b_, c_)): ru.lbl('%s%d' % (col, 5 + j), v)

mn = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
mn.title('Method Notes – how this calculator produces its results')
mn.text_block(4, ['# 1. Eligibility', 'A loan can go into the pool only if it is a standard asset and is not one of the excluded types. A loan on which both principal and interest fall due only at maturity is excluded, unless it is one of the two kinds the proviso allows and the borrower (or, for a trade receivable, the drawee of the bill) has repaid in full the last two loans or receivables within 90 days of the due date (one loan for a farm loan with maturity beyond one year); the user confirms that in column I. The calculator reads the proviso as also lifting the 365-day test for these loans, since a trade receivable of up to 12 months could not otherwise qualify; this is how the market read the amendment of December 2022 that brought in the 365-day test. Confirm the reading with the arranger for each deal. Other loans need at least 365 days of residual maturity on the date of transfer. Re-securitisation, synthetic securitisation and structures funded by rolled-over short-term paper are barred altogether and are outside this calculator.',
 '# 2. Minimum holding period', 'The holding period is tested for each loan. It is three months where the tenor of the loan is up to two years and six months where it is longer. The clock starts on the date the security interest was registered with CERSAI; where there is no security, or it cannot be registered, on the date of first repayment; for a project loan on the date of commencement of commercial operations; and for a commercial or residential real estate mortgage on the later of full disbursement and registration. A loan the company itself acquired from another entity cannot be securitised within six months of being taken into its books. The calculator shows the date on which the period ends and, where it has not ended, the days still to run.',
 '# 3. Minimum retention requirement', 'The originator keeps 5 per cent of the book value of loans with original maturity up to 24 months and 10 per cent of loans with longer maturity or bullet repayment; for residential mortgage backed securities the rate is 5 per cent whatever the maturity. Where a pool holds both short and long loans the calculator applies the rate loan by loan. The Directions set each rate for the underlying loans of that maturity, which supports the loan by loan basis, but RBI has not published a clarification on a mixed pool; the Setup sheet lets the company apply the higher rate to the whole pool instead, which is the cautious reading.',
 '# 4. Form of retention', 'Up to 5 per cent of book value, the retention must first be in the first loss facility; if there is none, or the whole of it is less than 5 per cent, the balance is in the equity tranche; and only if both together are less than 5 per cent is the balance held pari passu in the tranches sold to investors. Retention above 5 per cent may be in any of these. Over-collateralisation does not count as first loss facility, and the interest-only strip does not count at all. The form test is Green when the first loss facility and equity tranche together cover the first 5 per cent (or the whole requirement if lower), or when the company confirms that it retains both in full.',
 '# 5. Limits of the calculator', 'The calculator holds %d loans; larger pools are run in batches with the Retention sheet completed on the last batch, or the Rules are coded in the loan system. It tests the retention on the date of transfer; the retention must then be maintained as a percentage of the unamortised principal for the life of the deal (paragraph 14(2)), which is monitored outside this workbook. It does not test true sale, credit enhancement, liquidity facilities, capital treatment or the simple, transparent and comparable criteria. Dates must be real dates, not text.' % N])

ck = B.sheet('Checks', (6, 84, 12, 56), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
pa = PR('A')
chk = [('The date of transfer is entered', '%s<>""' % DT, 'Complete Setup'), ('Every loan has a book value, an original maturity, a residual maturity and an asset classification', 'SUMPRODUCT((%s<>"")*((%s="")+(%s="")+(%s="")+(%s="")))=0' % (pa, PR('C'), PR('D'), PR('E'), PR('F')), 'Complete Pool Input'),
       ('No Loan ID is used twice', 'SUMPRODUCT((%s<>"")*(COUNTIF(%s,%s)>1))=0' % (pa, pa, pa), 'Remove the duplicate'), ('Every eligible loan has the date from which its holding period runs', 'COUNTIFS(%s,"CHECK",%s,"Yes")=0' % (X('I'), X('D')), 'Enter the missing date in Pool Input'),
       ('No holding period of an eligible loan starts after the date of transfer', 'COUNTIFS(%s,"Yes",%s,">"&%s)=0' % (X('D'), X('F'), DT), 'Correct the date'),
       ('A loan marked as a bullet loan allowed by the proviso is also marked as due only at maturity', 'SUMPRODUCT((%s="Yes")*(%s<>"Yes"))=0' % (PR('I'), PR('H')), 'Correct columns H and I'),
       ('The four questions on the Retention sheet are answered', 'COUNTA(\'Retention\'!B24:B27)=4', 'Answer Yes or No'), ('The retention rates rise with maturity', 'N(%s)<=N(%s)' % (S('th.mrr1'), S('th.mrr2')), 'Correct Setup')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C%d' % (5 + len(chk)))
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Pool Input', 'Pool Test', 'Retention', 'Dashboard', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('Securitisation calculator built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
