"""Key Facts Statement and APR Calculator (with cooling-off and penal charges). Run: python3 build_pricing.py <out.xlsx> <map.json>"""
import sys
from xl import *

NS = 120; S0 = 7
B = Book('KFS-M01', 'Key Facts Statement and APR Calculator')
YN = ['Yes', 'No']
RBC = 'RBI (NBFCs – Responsible Business Conduct) Directions, 2025'; CFD = 'RBI (NBFCs – Credit Facilities) Directions, 2025'

readme(B, 'Key Facts Statement and APR Calculator',
       ['This workbook works out, for one loan, the equated instalment, the repayment schedule and the Annual Percentage Rate (the annual cost of credit including interest and all other charges), and lays the figures out for the Key Facts Statement. It also works out the amount payable when a borrower exits a digital loan in the cooling-off period, and the penal charge on an overdue amount.',
        'It is a calculator for product design, for checking the figures produced by the loan system, and for training staff. The same rules are listed on the Rules sheet for use in a loan management system.'],
       ['Loan Input: enter the loan terms and every charge recovered from the borrower.', 'Read APR and Schedule. Compare with the loan system.', 'Key Facts Statement: fill the yellow text cells and compare with the statement given to the borrower.',
        'Cooling Off and Penal Charges: enter the case and read the amount.', 'Clear the Checks sheet.'],
       [('Method Notes', 'explains every calculation'), ('Loan Input', 'loan terms and charges'), ('APR', 'instalment, cost of credit and APR'), ('Schedule', 'repayment schedule'), ('Key Facts Statement', 'figures laid out for the statement'),
        ('Cooling Off', 'exit from a digital loan'), ('Penal Charges', 'charge on an overdue amount'), ('Rules', 'rules for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Loan Input', (62, 20, 30, 54), tab='BF9000')
s.title('Loan Input – terms of the loan and charges', 'Yellow cells are inputs. Amounts in rupees.')
R = [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None, ''), (5, 'Product', 'loan.product', None, 'txt', None, 'Product note'), (6, 'Loan amount sanctioned and disbursed (₹)', 'loan.amount', None, 'num', None, 'Sanction letter'),
     (7, 'Rate of interest (per cent per annum, reducing balance)', 'loan.rate', None, 'pct', None, 'Sanction letter; interest rate policy'), (8, 'Type of rate', 'loan.ratetype', 'Fixed', 'txt', ['Fixed', 'Floating', 'Hybrid'], ''),
     (9, 'Frequency of instalments', 'loan.freq', 'Monthly', 'txt', ['Monthly', 'Fortnightly', 'Weekly', 'Quarterly'], ''), (10, 'Number of instalments (up to %d)' % NS, 'loan.n', None, 'int', None, 'Sanction letter'),
     (11, 'Date of disbursement', 'loan.date', None, 'date', None, ''), (12, 'Digital loan', 'loan.digital', 'No', 'txt', YN, CFD + ', Chapter III'),
     (13, 'Cooling-off period under the credit policy (days)', 'loan.cool', 3, 'int', None, CFD + ', para 11: fixed by the company; not less than one day')]
for r, lab, key, d, fmt, lst, src in R:
    s.lbl('A%d' % r, lab); s.lbl('D%d' % r, src); s.inp('B%d' % r, key, lab, d, fmt, src or 'Company', lst)
s.head(15, ['One-time charge recovered at or before disbursement', 'Amount (₹)', 'Payable to', 'Note'])
CH = [('Processing fee', 'fee.proc', 'Company'), ('Other one-time charges of the Company', 'fee.other', 'Company'), ('Goods and services tax on the Company\'s charges', 'fee.gst', 'Government, through the Company'),
      ('Insurance charges', 'fee.ins', 'Third party, through the Company'), ('Legal and valuation charges', 'fee.legal', 'Third party, through the Company'), ('Other charges recovered for third parties', 'fee.third', 'Third party, through the Company')]
for i, (lab, key, to) in enumerate(CH):
    r = 16 + i; s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, None, 'num', 'Schedule of charges; Key Facts Statement'); s.lbl('C%d' % r, to)
    s.lbl('D%d' % r, 'Included in the APR' if i else 'Included in the APR; may be retained on exit in the cooling-off period if disclosed')
s.lbl('A22', 'Total one-time charges', True); s.f('B22', 'SUM(B16:B21)', out=True)
s.lbl('A23', 'Charge added to each instalment, if any (₹ per instalment)'); s.inp('B23', 'fee.rec', 'Recurring charge per instalment', None, 'num', 'Schedule of charges'); s.lbl('D23', 'For example a periodic insurance premium collected with the instalment')
s.note('A25', 'Contingent charges (penal charges, foreclosure charges, charges for switching the rate) are disclosed in the Key Facts Statement but are not part of the APR.')
LI = lambda c: q('Loan Input', c)
P, RT, FQ, N, DT, U, REC = LI('$B$6'), LI('$B$7'), LI('$B$9'), LI('$B$10'), LI('$B$11'), LI('$B$22'), 'N(%s)' % LI('$B$23')
GUARD[0] = 'OR(N(%s)=0,N(%s)=0)' % (P, N)

a = B.sheet('APR', (64, 20, 60), tab='00B050')
a.title('APR – instalment, cost of credit and Annual Percentage Rate', 'All cells are formulas.')
AR = [(4, 'Instalments in a year', 'IF(%s="Monthly",12,IF(%s="Fortnightly",26,IF(%s="Weekly",52,4)))' % (FQ, FQ, FQ), 'int', ''),
      (5, 'Equated periodic instalment (₹)', 'IF(OR(N(%s)=0,N(%s)=0),"",IF(N(%s)=0,%s/%s,PMT(%s/B4,%s,-%s)))' % (P, N, RT, P, N, RT, N, P), 'num', 'Principal and interest; reducing balance'),
      (6, 'Total of instalments (₹)', 'IF(B5="","",B5*%s)' % N, 'num', ''), (7, 'Total interest over the term (₹)', 'IF(B5="","",B6-%s)' % P, 'num', ''), (8, 'One-time charges (₹)', U, 'num', 'From Loan Input'),
      (9, 'Recurring charges over the term (₹)', '%s*N(%s)' % (REC, N), 'num', ''), (10, 'Net amount received by the borrower (₹)', '%s-%s' % (P, U), 'num', 'Loan amount less one-time charges'),
      (11, 'Total cost to the borrower: instalments and all charges (₹)', 'IF(B5="","",B6+B8+B9)', 'num', 'Instalments + all charges; not the KFS line "total amount to be paid"'),
      (12, 'Rate per instalment period that equates the net amount received with the instalments', 'IF(OR(B5="",B10<=0),"",IFERROR(RATE(%s,-(B5+%s),B10),""))' % (N, REC), 'p4', 'Internal rate of return of the borrower\'s cash flows'),
      (13, 'Annual Percentage Rate (APR)', 'IF(B12="","",B12*B4)', 'pct', RBC + ', para 6 and para 29'), (14, 'Effective annual rate with compounding (for information)', 'IF(B12="","",(1+B12)^B4-1)', 'pct', 'Not the APR disclosed'),
      (15, 'Difference between the APR and the rate of interest (percentage points)', 'IF(B13="","",B13-%s)' % RT, 'pct', 'The effect of charges')]
for r, lab, fm, fmt, nt in AR:
    a.lbl('A%d' % r, lab); a.f('B%d' % r, fm, fmt, out=r in (5, 13)); a.lbl('C%d' % r, nt)
AP = lambda c: q('APR', c)

sc = B.sheet('Schedule', (8, 14, 16, 16, 16, 16, 16), tab='00B050')
sc.title('Schedule – repayment schedule', 'Up to %d instalments. Interest for the period = opening balance x rate of interest / instalments in a year.' % NS)
sc.head(6, ['No.', 'Due date', 'Opening principal', 'Instalment', 'Interest', 'Principal', 'Closing principal'])
for k in range(1, NS + 1):
    r = S0 + k - 1; on = 'AND(N(%s)>0,%d<=N(%s))' % (P, k, N)
    sc.f('A%d' % r, 'IF(%s,%d,"")' % (on, k), 'int')
    sc.f('B%d' % r, 'IF(OR(NOT(%s),%s=""),"",IF(%s="Monthly",EDATE(%s,%d),IF(%s="Quarterly",EDATE(%s,%d),%s+%d*IF(%s="Weekly",7,14))))' % (on, DT, FQ, DT, k, FQ, DT, 3 * k, DT, k, FQ), 'date')
    sc.f('C%d' % r, 'IF(%s,%s,"")' % (on, P if k == 1 else 'G%d' % (r - 1))); sc.f('D%d' % r, 'IF(%s,%s,"")' % (on, AP('$B$5')))
    sc.f('E%d' % r, 'IF(%s,C%d*%s/%s,"")' % (on, r, RT, AP('$B$4'))); sc.f('F%d' % r, 'IF(%s,D%d-E%d,"")' % (on, r, r)); sc.f('G%d' % r, 'IF(%s,C%d-F%d,"")' % (on, r, r))
SE = S0 + NS - 1
sc.lbl('C4', 'Totals', True); sc.f('D4', 'SUM(D%d:D%d)' % (S0, SE), out=True); sc.f('E4', 'SUM(E%d:E%d)' % (S0, SE), out=True); sc.f('F4', 'SUM(F%d:F%d)' % (S0, SE), out=True)

k = B.sheet('Key Facts Statement', (8, 58, 30, 44), tab='00B050')
k.title('Key Facts Statement – figures laid out for the statement', 'Compare with the format annexed to the Directions before issue. Yellow cells are text to be typed.')
k.head(4, ['Sr.', 'Parameter', 'Details', 'Note'])
KR = [('Loan proposal or account number', None, 'kfs.account'), ('Type of loan', LI('B5'), None), ('Sanctioned loan amount (₹)', P, None), ('Disbursal schedule (stages or 100 per cent upfront)', None, 'kfs.disbursal'), ('Loan term (number of instalments and frequency)', '%s&" "&%s&" instalments"' % (N, FQ), None),
      ('Equated periodic instalment (₹)', AP('B5'), None), ('Commencement of repayment after sanction', "IF(Schedule!B%d=\"\",\"\",Schedule!B%d)" % (S0, S0), None), ('Rate of interest (per cent per annum) and type', 'TEXT(%s,"0.00%%")&" – "&%s' % (RT, LI('B8')), None),
      ('For a floating rate: reference benchmark, spread and reset periodicity', None, 'kfs.floating'), ('Processing fee payable to the Company (₹)', 'N(%s)+N(%s)' % (LI('B16'), LI('B17')), None), ('Goods and services tax on the Company\'s charges (₹)', 'N(%s)' % LI('B18'), None),
      ('Insurance charges payable to a third party through the Company (₹)', 'N(%s)' % LI('B19'), None), ('Legal, valuation and other charges payable to third parties through the Company (₹)', 'N(%s)+N(%s)' % (LI('B20'), LI('B21')), None),
      ('Recurring charge with each instalment (₹)', REC, None), ('Annual Percentage Rate (APR)', AP('B13'), None), ('Total interest over the term (₹)', AP('B7'), None), ('Net disbursed amount (₹)', AP('B10'), None), ('Total amount to be paid by the borrower: loan amount and total interest (₹)', 'IF(%s="","",%s+%s)' % (AP('B7'), P, AP('B7')), None),
      ('Penal charges in case of delayed payment', None, 'kfs.penal'), ('Other penal charges', None, 'kfs.otherpenal'), ('Foreclosure charges', None, 'kfs.foreclosure'), ('Charges for switching from floating to fixed rate and back', None, 'kfs.switch'), ('Any other contingent charge', None, 'kfs.othercharge'),
      ('Clause of the loan agreement on engagement of recovery agents', None, 'kfs.recovery'), ('Clause of the loan agreement on grievance redressal', None, 'kfs.grievance'), ('Phone number and e-mail of the nodal grievance redressal officer', None, 'kfs.nodal'),
      ('Whether the loan may be transferred to other lenders or securitised', None, 'kfs.transfer'), ('Co-lending or other collaborative arrangement: names of the lenders and funding shares', None, 'kfs.colending'),
      ('Digital loan: cooling-off period (days)', 'IF(%s="Yes",%s,"Not applicable")' % (LI('B12'), LI('B13')), None), ('Digital loan: lending service provider acting as recovery agent and authorised to approach the borrower', None, 'kfs.lsp')]
for i, (lab, fm, key) in enumerate(KR):
    r = 5 + i; k.lbl('A%d' % r, i + 1); k.lbl('B%d' % r, lab)
    if key: k.inp('C%d' % r, key, lab, None, 'txt', 'Sanction letter; loan agreement; schedule of charges')
    else: k.f('C%d' % r, fm, {1: 'txt', 4: 'txt', 6: 'date', 7: 'txt', 14: 'pct', 28: 'txt'}.get(i, 'num'))
k.note('D5', 'A fee or charge not mentioned in the Key Facts Statement cannot be charged at any stage of the loan without the explicit consent of the borrower (para 29).')

c = B.sheet('Cooling Off', (64, 20, 60), tab='00B050')
c.title('Cooling Off – exit from a digital loan in the cooling-off period', CFD + ', para 11.')
c.lbl('A4', 'Day of exit, counted from the date of disbursement'); c.inp('B4', 'cool.day', 'Day of exit in the cooling-off period', None, 'int', 'Case data')
c.lbl('A5', 'Processing fee retained on exit, as disclosed in the Key Facts Statement'); c.inp('B5', 'cool.retain', 'Processing fee retained on exit', 'No', 'txt', 'Credit policy; Key Facts Statement', YN)
CR = [(7, 'Exit within the cooling-off period', 'IF(OR(B4="",%s<>"Yes"),"",IF(B4<=%s,"Yes","No – ordinary pre-payment terms apply"))' % (LI('B12'), LI('B13')), 'txt', ''),
      (8, 'Proportionate cost of credit for the days the loan was used (₹)', 'IF(OR(B4="",%s=""),"",%s*%s*B4/365)' % (AP('B13'), P, AP('B13')), 'num', 'Loan amount x APR x days / 365'),
      (9, 'Amount payable by the borrower on exit: principal and proportionate cost (₹)', 'IF(B8="","",%s+B8)' % P, 'num', 'No penalty is charged'),
      (10, 'One-time processing fee retained by the Company (₹)', 'IF(B5="Yes",N(%s),0)' % LI('B16'), 'num', 'Only a reasonable one-time fee, and only if disclosed upfront'),
      (11, 'Other one-time charges collected at disbursement (₹)', 'N(%s)-N(%s)' % (U, LI('B16')), 'num', 'The credit policy states how these are adjusted on exit')]
for r, lab, fm, fmt, nt in CR:
    c.lbl('A%d' % r, lab); c.f('B%d' % r, fm, fmt, out=r == 9); c.lbl('C%d' % r, nt)

p = B.sheet('Penal Charges', (64, 20, 60), tab='00B050')
p.title('Penal Charges – charge on an overdue amount', RBC + ', para 30.')
PR = [(4, 'Amount overdue (₹)', 'pen.amount', None, 'num'), (5, 'Days overdue', 'pen.days', None, 'int'), (6, 'Penal charge under the Board-approved policy (per cent per annum on the amount overdue)', 'pen.rate', None, 'pct'), (7, 'Goods and services tax on the penal charge', 'pen.gst', 0.18, 'pct')]
for r, lab, key, d, fmt in PR:
    p.lbl('A%d' % r, lab); p.inp('B%d' % r, key, lab, d, fmt, 'Case data; policy on penal charges')
p.lbl('C7', 'Confirm the rate of tax with the tax adviser')
QR = [(9, 'Penal charge (₹)', 'N(B4)*N(B6)*N(B5)/365', 'Charged as a charge; not added to the rate of interest'), (10, 'Goods and services tax (₹)', 'B9*N(B7)', ''),
      (11, 'Interest on the amount overdue at the contracted rate (₹)', 'N(B4)*N(%s)*N(B5)/365' % RT, 'Permitted at the contracted rate, not at a penal rate'), (12, 'Total for the period (₹)', 'B9+B10+B11', 'No further interest is computed on the penal charge')]
for r, lab, fm, nt in QR:
    p.lbl('A%d' % r, lab); p.f('B%d' % r, fm, 'num', out=r == 9); p.lbl('C%d' % r, nt)

ru = B.sheet('Rules', (6, 40, 86, 46), tab='7030A0', protect=False)
ru.title('Rules – pricing and disclosure rules in one table', 'For use in a loan management system or compliance tool.'); ru.head(5, ['#', 'Rule', 'Logic', 'Reference'])
RL = [('Instalment', 'PMT(rate / instalments in a year, number of instalments, - loan amount); rate 0: loan amount / number of instalments', 'Loan agreement'), ('Net amount received', 'loan amount - all one-time charges recovered at or before disbursement (own and third-party)', RBC + ', para 29'),
      ('Periodic rate', 'rate r that solves: net amount received = sum of (instalment + recurring charge) / (1 + r)^k', RBC + ', para 29'), ('APR', 'periodic rate x instalments in a year', RBC + ', paras 6 and 29'),
      ('Charges in the APR', 'all charges of the credit facility, including charges recovered for third parties on actual basis (insurance, legal); contingent charges excluded', RBC + ', para 29'),
      ('Undisclosed charges', 'a charge not in the Key Facts Statement is blocked unless the borrower gives explicit consent', RBC + ', para 29'), ('Cooling-off period', 'digital loans only; period from the credit policy; minimum 1 day', CFD + ', para 11'),
      ('Exit in the cooling-off period', 'payable = principal + principal x APR x days / 365; no penalty; a reasonable one-time processing fee may be retained if disclosed in the Key Facts Statement', CFD + ', para 11'),
      ('Penal charge', 'amount overdue x penal charge rate x days / 365; booked as a charge, never as an addition to the rate of interest', RBC + ', para 30'), ('No capitalisation', 'no interest is computed on penal charges; interest on overdue amounts runs at the contracted rate', RBC + ', para 30')]
for j, (x, y, z) in enumerate(RL, 1):
    for col, v in zip('ABCD', (j, x, y, z)): ru.lbl('%s%d' % (col, 5 + j), v)

m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how this calculator produces its results')
m.text_block(4, ['# 1. Instalment and schedule', 'The loan is repaid in equal instalments on a reducing balance. Interest for a period is the opening principal multiplied by the annual rate and divided by the number of instalments in a year. The schedule holds up to %d instalments. Loans with a moratorium, stepped instalments or a flat rate need the loan system\'s own schedule; the APR method stays the same.' % NS,
 '# 2. Annual Percentage Rate', 'The Directions define the APR as the annual cost of credit to the borrower, which includes the interest rate and all other charges associated with the credit facility. The calculator takes the amount the borrower actually receives (loan amount less every one-time charge recovered at or before disbursement) and finds the rate per instalment period at which the instalments, with any recurring charge, repay that amount. That rate multiplied by the number of instalments in a year is the APR. This follows the illustration given with the Directions for equated instalments, which computes the APR on the net disbursed amount using the IRR approach and the reducing balance method (para 29(3)). Checked on 25-11-2026: the illustration (loan ₹20,000, 15 per cent, 24 monthly instalments, charges ₹400, net ₹19,600) gives a monthly rate of 1.4225 per cent and an APR of 17.07 per cent, the figure printed in the Directions, only when the monthly rate is multiplied by 12; compounding would give 18.47 per cent and a day-count (XIRR) method 18.75 per cent. The compounded rate is therefore shown only for information. In the Key Facts Statement the total amount to be paid by the borrower is the loan amount plus the total interest, as in the illustration; charges are shown on their own lines.',
 '# 3. Charges', 'Charges recovered for third parties on actual basis, such as insurance and legal charges, form part of the APR and are disclosed separately. Contingent charges are disclosed but not included.',
 '# 4. Cooling-off period', 'A borrower of a digital loan may exit in the cooling-off period by paying the principal and the proportionate APR, without penalty. The calculator takes the proportionate APR as loan amount x APR x days / 365. The Company may retain a reasonable one-time processing fee if this is disclosed upfront in the Key Facts Statement. Because the APR already carries the effect of the charges, the credit policy must state how charges collected at disbursement are adjusted on exit, so that the borrower pays no more than the proportionate cost and the retained fee.',
 '# 5. Penal charges', 'A penalty for breach of material terms is levied as a penal charge and not as penal interest added to the rate. There is no capitalisation of penal charges. Interest on unpaid amounts may continue at the contracted rate. The rate of the penal charge is fixed by the Board-approved policy and must be reasonable and proportionate.',
 '# 6. Limits of the calculator', 'One loan at a time. Rounding of instalments by the loan system can change the last instalment by a small amount. Tax rates are inputs. The layout of the Key Facts Statement here is a working sheet; the statement issued to the borrower follows the format annexed to the Directions.'])

ck = B.sheet('Checks', (6, 76, 12, 54), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
chk = [('Loan amount, rate and number of instalments are entered', 'AND(N(%s)>0,N(%s)>=0,N(%s)>0)' % (P, RT, N), 'Complete Loan Input'), ('Number of instalments is within %d' % NS, 'N(%s)<=%d' % (N, NS), 'Use the loan system schedule for longer loans'),
       ('One-time charges are less than the loan amount', 'N(%s)<N(%s)' % (U, P), 'Check the charges'), ('The schedule closes at zero', 'ABS(SUM(Schedule!F%d:F%d)-N(%s))<1' % (S0, SE, P), 'Check rate and number of instalments'),
       ('The APR is not below the rate of interest', 'IF(%s="",FALSE,%s>=N(%s)-0.000001)' % (AP('B13'), AP('B13'), RT), 'Check the charges'), ('Digital loan: the cooling-off period is at least one day', 'OR(%s<>"Yes",N(%s)>=1)' % (LI('B12'), LI('B13')), 'Correct the period on Loan Input')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C11')
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Loan Input', 'APR', 'Schedule', 'Key Facts Statement', 'Cooling Off', 'Penal Charges', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('Pricing calculator built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
