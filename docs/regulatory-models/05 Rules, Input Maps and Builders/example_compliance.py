"""Worked example for the Compliance Testing Model – fictitious Middle Layer NBFC, half-year position.
Every paragraph number below was checked against the text of the Direction in its Source folder on 25-11-2026.
Run: python3 example_compliance.py <out.json>"""
import json, sys, random, datetime
random.seed(11)
D_ = datetime.date
FY, REP = D_(2026, 4, 1), D_(2026, 9, 30)
CMP = 'RBI (NBFCs – Compliance Function) Directions, 2026'; CF = 'RBI (NBFCs – Credit Facilities) Directions, 2025'; RBC = 'RBI (NBFCs – Responsible Business Conduct) Directions, 2025'
KYC = 'RBI (NBFCs – Know Your Customer) Directions, 2025'; FRM = 'RBI (NBFCs – Fraud Risk Management) Directions, 2026'; OUT = 'RBI (NBFCs – Managing Risks in Outsourcing) Directions, 2025'
CAP = 'RBI (NBFCs – Prudential Norms on Capital Adequacy) Directions, 2025'; IRAC = 'RBI (NBFCs – Income Recognition, Asset Classification and Provisioning) Directions, 2025'; GOV = 'RBI (NBFCs – Governance) Directions, 2025'
IO = 'RBI (NBFCs – Internal Ombudsman) Directions, 2026'; CIR = 'RBI (NBFCs – Credit Information Reporting) Directions, 2025'; ALM = 'RBI (NBFCs – Asset Liability Management) Directions, 2025'
CON = 'RBI (NBFCs – Concentration Risk Management) Directions, 2025'; IA = 'RBI (NBFCs – Internal Audit Function) Directions, 2026'; RET = 'RBI (NBFCs – Supervisory Returns) Directions, 2026'
G, C, FP, K, FR, O, LQ, RR, CP = ('Governance and capital', 'Credit and lending', 'Customer conduct and fair practices', 'Know your customer and anti-money laundering', 'Fraud risk', 'Outsourcing and technology',
                                  'Liquidity and asset liability management', 'Regulatory reporting and returns', 'Compliance function')
S, A, NI, W = 'Strong', 'Adequate', 'Needs improvement', 'Weak or none'
# ID, Direction, para, obligation, domain, owner, control, likelihood, impact, rating, new, failure, applicable, items per quarter, method
OB = [('CMP-01', CMP, '7', 'Annual compliance risk assessment and plan; periodic review and detailed annual review placed before the Board or Audit Committee', CP, 'Compliance', 'Compliance calendar; Audit Committee agenda tracker', 2, 4, A, 'Yes', 'No', None, 1, 'Desk review'),
      ('CMP-02', CMP, '15(2)', 'Every new product kept under intensive monitoring for at least the first six months', CP, 'Compliance', 'New product register; monthly monitoring note', 3, 3, NI, 'Yes', 'No', None, 4, 'Desk review'),
      ('CMP-03', CMP, '15(4)', 'Risk Mitigation Plan and Monitorable Action Plan points complied with in time; replies to RBI sent through the Compliance function', CP, 'Compliance', 'Inspection tracker reviewed monthly by the CCO', 2, 5, A, 'Yes', 'No', None, 14, 'Re-performance'),
      ('CMP-04', CMP, '25', 'Audit Committee meets the CCO one-to-one every quarter, without senior management, where the CCO reports to the MD & CEO', G, 'Secretarial and Legal', 'Standing item in the Audit Committee calendar', 2, 3, S, 'Yes', 'No', None, 1, 'Desk review'),
      ('CMP-05', CMP, '29', 'Prior intimation to RBI of the appointment of, or any change in, the CCO', CP, 'Secretarial and Legal', 'Checklist for changes in key personnel', 1, 4, S, 'Yes', 'No', None, 1, 'Desk review'),
      ('CF-01', CF, '24', 'Default loss guarantee cover on a portfolio kept within five per cent of the amount disbursed out of it', C, 'Credit', 'Portfolio-wise cap monitored in the loan system', 3, 4, A, 'No', 'No', None, 3, 'Re-performance'),
      ('CF-02', CF, '27', 'Default loss guarantee invoked within 120 days overdue', C, 'Collections', 'Weekly overdue report to the collections head', 3, 3, NI, 'No', 'Yes', None, 180, 'Transaction sampling'),
      ('CF-03', CF, '43', 'Loan-to-value ratio of consumption loans against gold and silver kept within the slab limits', C, 'Credit', 'System block at sanction; daily exception report', 4, 4, A, 'No', 'No', None, 2400, 'Data analytics'),
      ('CF-04', CF, '55', 'Monthly repayment obligations of a microfinance household kept within the Board limit, not above 50 per cent of household income', C, 'Credit', 'Household income assessment form; credit bureau check', 3, 4, A, 'No', 'No', None, 1500, 'Transaction sampling'),
      ('CF-05', CF, '106', 'Loan-to-value ratio of 50 per cent on loans against listed shares; shortfall made good within seven working days', C, 'Risk Management', 'Daily mark-to-market and margin call log', 2, 4, A, 'No', 'No', None, 60, 'Transaction sampling'),
      ('RBC-01', RBC, '29(1)', 'Key Facts Statement given to every prospective borrower of a retail or MSME term loan, in a language the borrower understands', FP, 'Operations', 'Disbursement blocked without a signed statement', 4, 4, NI, 'No', 'Yes', None, 4800, 'Transaction sampling'),
      ('RBC-02', RBC, '29(3)', 'Annual Percentage Rate sheet and amortisation schedule in the Key Facts Statement; the rate includes all charges', FP, 'Operations', 'Rate computed by the loan system from the charge master', 3, 4, A, 'No', 'No', None, 4800, 'Re-performance'),
      ('RBC-03', RBC, '30(1)', 'Penalty for breach of loan terms levied as penal charges, not penal interest, and not capitalised', FP, 'Finance and Accounts', 'Charge master locked; quarterly ledger scan', 3, 4, A, 'No', 'No', None, 900, 'Data analytics'),
      ('RBC-04', RBC, '20', 'No undue harassment in recovery; staff trained to deal with customers', FP, 'Collections', 'Call recording review; agency code of conduct', 4, 5, NI, 'No', 'Yes', None, 3200, 'Transaction sampling'),
      ('RBC-05', RBC, '35', 'Original property documents released and charges removed within 30 days of full repayment or settlement', FP, 'Operations', 'Closure tracker with ageing', 3, 4, NI, 'No', 'No', None, 420, 'Transaction sampling'),
      ('KYC-01', KYC, '42(1)', 'Periodic updation of KYC at least every two, eight and ten years for high, medium and low risk customers', K, 'Operations', 'Monthly due list from the loan system', 4, 4, NI, 'No', 'No', None, 650, 'Transaction sampling'),
      ('KYC-02', KYC, '63(1)', 'KYC records uploaded to the Central KYC Records Registry within 10 days of the start of an account-based relationship', K, 'Operations', 'Daily upload batch and reject report', 3, 3, A, 'No', 'No', None, 4800, 'Data analytics'),
      ('KYC-03', KYC, '47', 'Records of transactions and of customer identification preserved for at least five years', K, 'Operations', 'Retention schedule in the document management system', 2, 4, S, 'No', 'No', None, 40, 'Walk-through'),
      ('KYC-04', KYC, '14', 'Designated Director nominated by the Board and notified to FIU-IND and RBI; not the Principal Officer', K, 'Secretarial and Legal', 'Board resolution; intimation file', 1, 4, S, 'No', 'No', None, 1, 'Desk review'),
      ('FRM-01', FRM, '43', 'Fraud Monitoring Return furnished within 14 days of classification of an incident or account as fraud', FR, 'Risk Management', 'Fraud register with reporting due dates', 3, 5, A, 'Yes', 'No', None, 6, 'Re-performance'),
      ('FRM-02', FRM, '15', 'Early warning indicators identified for loan accounts and other transactions and reviewed periodically', FR, 'Risk Management', 'Indicator list under development', 3, 4, W, 'Yes', 'No', None, 12, 'Walk-through'),
      ('OUT-01', OUT, '12(1)(vii)', 'Records of all material outsourcing reviewed half-yearly by the Board or the Risk Management Committee', O, 'Risk Management', 'Central register of outsourcing; committee calendar', 2, 3, A, 'No', 'No', None, 1, 'Desk review'),
      ('OUT-02', OUT, '56', 'Grievance redressal for outsourced services stays with the company and is not weakened by outsourcing', O, 'Customer Service', 'Single complaints system covering service providers', 3, 3, A, 'No', 'No', None, 110, 'Transaction sampling'),
      ('CAP-01', CAP, '6(3)', 'Capital to risk-weighted assets ratio of at least 15 per cent maintained on an ongoing basis', G, 'Finance and Accounts', 'Monthly capital computation reviewed by the CFO', 1, 5, S, 'No', 'No', None, 3, 'Re-performance'),
      ('IRAC-01', IRAC, '44', 'Loans classified as non-performing when overdue for more than 90 days', C, 'Finance and Accounts', 'System-driven classification at day end', 2, 5, A, 'No', 'No', None, 5200, 'Data analytics'),
      ('GOV-01', GOV, '9', 'Risk Management Committee constituted; evaluates overall risks including liquidity risk and reports to the Board', G, 'Secretarial and Legal', 'Committee charter and meeting calendar', 1, 4, S, 'No', 'No', None, 1, 'Desk review'),
      ('GOV-02', GOV, '17(1)', 'Audit Committee of not less than three directors', G, 'Secretarial and Legal', 'Board composition tracker', 1, 4, S, 'No', 'No', None, 1, 'Desk review'),
      ('IO-01', IO, '14(1)', 'Complaints partly resolved or wholly rejected escalated automatically to the Internal Ombudsman within 20 days of receipt', FP, 'Customer Service', 'Complaints system with auto-escalation rule', 4, 4, NI, 'Yes', 'No', None, 240, 'Transaction sampling'),
      ('IO-02', IO, '14(9)', 'Final decision communicated to the complainant within 30 days of receipt of the complaint', FP, 'Customer Service', 'Ageing report of open complaints', 3, 4, A, 'Yes', 'No', None, 240, 'Data analytics'),
      ('IO-03', IO, '13(2)', 'Internal Ombudsman reports to the Board at least every half-year, with an analysis of complaints', FP, 'Customer Service', 'Board calendar', 2, 3, A, 'Yes', 'No', None, 1, 'Desk review'),
      ('CIR-01', CIR, '35(1)', 'Compensation of ₹100 a day paid where a credit information complaint is not resolved within 30 days', RR, 'Operations', 'Dispute tracker with day count', 3, 3, A, 'No', 'No', None, 35, 'Transaction sampling'),
      ('ALM-01', ALM, '39', 'Net cumulative negative mismatches within 10, 10 and 20 per cent of cumulative outflows in the first three time buckets', LQ, 'Treasury', 'Structural liquidity statement reviewed by ALCO', 2, 5, A, 'No', 'No', None, 3, 'Re-performance'),
      ('CON-01', CON, '13', 'Exposure to a single party within 25 per cent, and to a single group within 40 per cent, of Tier 1 capital', C, 'Risk Management', 'Limit check at sanction; monthly exposure report', 2, 5, S, 'No', 'No', None, 3, 'Re-performance'),
      ('CON-02', CON, '14', 'Exposure limits of 30 and 50 per cent of Tier 1 capital for an Infrastructure Finance Company', C, 'Risk Management', None, None, None, None, 'No', 'No', 'No', 0, None),
      ('IA-01', IA, '42', 'Audit Committee or Board meets the Head of Internal Audit at least once a quarter without senior management, where the Head reports to the MD & CEO or a Whole Time Director', G, 'Internal Audit', 'Audit Committee calendar', 2, 3, A, 'Yes', 'No', None, 1, 'Desk review'),
      ('RET-01', RET, '21', 'Supervisory returns submitted with accurate and complete data within the prescribed timelines', RR, 'Finance and Accounts', 'Returns calendar; maker and checker sign-off', 3, 4, A, 'Yes', 'Yes', None, 9, 'Re-performance'),
      ('RET-02', RET, '22', 'Monthly returns filed within 15 days and quarterly returns within 21 days of the reference date', RR, 'Finance and Accounts', 'Returns calendar with filing dates', 3, 4, A, 'Yes', 'No', None, 9, 'Desk review')]
TH = dict(low=4, med=9, high=16, ctl={S: 0.25, A: 0.5, NI: 0.75, W: 1.0}, freq={'Critical': 4, 'High': 4, 'Medium': 2, 'Low': 1}, flag=2,
          pop=[1, 2, 5, 13, 53, 251], smp=[(1, 1, 1, 1), (1, 2, 2, 2), (2, 2, 3, 4), (5, 5, 8, 10), (10, 15, 25, 30), (22, 29, 45, 59)], amber=0.05, red=0.10)
BANDS = ['Low', 'Medium', 'High', 'Critical']


def band(x): return 'Low' if x <= TH['low'] else 'Medium' if x <= TH['med'] else 'High' if x <= TH['high'] else 'Critical'


def plan(universe, first_row=7):
    """Independent statement of the plan rules: returns {ID: dict(inherent, residual, band, flag, n, quarters)}."""
    out = {}
    for i, u in enumerate(universe):
        if u[12] == 'No' or u[7] is None or u[8] is None: continue
        row = first_row + i; inh = u[7] * u[8]; res = inh * TH['ctl'].get(u[9], 1.0); b = band(res); flag = u[10] == 'Yes' or u[11] == 'Yes'
        n = u[13] if u[13] not in (None, '') else max(TH['freq'][b], TH['flag'] if flag else 0)
        if n >= 4: qs = [1, 2, 3, 4]
        elif n == 3: qs = [k for k in (1, 2, 3, 4) if k != (4 if flag else 1)]
        elif n == 2: qs = [k for k in (1, 2, 3, 4) if (k - 1) % 2 == (0 if flag else row % 2)]
        elif n == 1: qs = [(0 if flag else row % 4) + 1]
        else: qs = []
        out[u[0]] = dict(inherent=inh, iband=band(inh), residual=res, band=b, flag=flag, n=n, quarters=qs, rating=u[9])
    return out


def sample(pop, b, method):
    if method == 'Data analytics': return pop
    i = max(j for j, lo in enumerate(TH['pop']) if pop >= lo); return min(pop, TH['smp'][i][BANDS.index(b)])


def build():
    U = [[o[0], o[1], 'para ' + o[2]] + list(o[3:13]) + [None] for o in OB]
    P = plan(U); iso = lambda d: d.isoformat() if d else None
    qend = {1: D_(2026, 6, 30), 2: D_(2026, 9, 30), 3: D_(2026, 12, 31), 4: D_(2027, 3, 31)}
    officers = ['Compliance Officer 1', 'Compliance Officer 2', 'Compliance Officer 3']
    tests, issues, n = [], [], 0
    for o in OB:
        if o[0] not in P: continue
        p = P[o[0]]; qs = list(p['quarters'])
        if o[0] == 'KYC-03': qs = []                     # left out of the programme: the plan shows the gap
        if o[0] == 'RBC-05': qs = qs[:-1]                # one test short
        for k in qs:
            n += 1; tid = 'T-%03d' % n; pop = o[13]; meth = o[14]; planned = qend[k] - datetime.timedelta(days=10 + n % 12)
            tester = officers[n % 3]; reviewer = 'Compliance Manager' if n % 4 else officers[(n + 1) % 3]
            row = [tid, o[0], '%s: %s' % (meth, o[3][:72].rsplit(' ', 1)[0]), meth, 'Q%d' % k, pop, iso(planned), tester, reviewer, 'Planned', None, None, None, None, None, None]
            if k <= 2:
                if n in (17, 41): row[9] = 'In progress'
                elif n == 29: row[9] = 'Deferred'
                else:
                    smp = sample(pop, p['band'], meth); rate = {S: 0.0, A: 0.02, NI: 0.09, W: 0.2}[p['rating']]
                    exc = sum(1 for _ in range(smp) if random.random() < rate) if smp <= 400 else int(round(smp * rate * random.uniform(0.6, 1.3)))
                    hi = 1 if (exc and o[0] in ('RBC-04', 'FRM-02', 'RET-01') and k == 1) else 0
                    done = planned - datetime.timedelta(days=n % 5) if n % 9 else planned + datetime.timedelta(days=4)
                    rep = qend[k] + datetime.timedelta(days=12) if k == 1 else (D_(2026, 9, 28) if n % 3 else None)
                    row[9:16] = ['Completed', iso(done), smp, exc, hi, 'WP-%s-Q%d' % (o[0], k), iso(rep)]
                    if exc:
                        sev = 'High' if hi else ('Medium' if exc / smp > TH['red'] else 'Low'); days = {'High': 30, 'Medium': 60, 'Low': 90}[sev]; tgt = done + datetime.timedelta(days=days)
                        closed = k == 1 and sev != 'High' and n % 4 != 1
                        issues.append(['I-%03d' % (len(issues) + 1), 'Compliance test', o[0], tid, '%d exception(s) in a sample of %d: %s' % (exc, smp, o[3][:70].rsplit(' ', 1)[0]), random.choice(['Process', 'People', 'System']), sev, o[5], iso(done), iso(tgt), None, None,
                                       'Closed' if closed else 'Open', iso(tgt - datetime.timedelta(days=8)) if closed else None, ('Yes' if n % 5 else 'No') if closed else None, 'Yes' if sev == 'High' and n % 2 else ('No' if sev == 'High' else 'Not required'), 'Yes' if closed else 'No'])
            tests.append(row)
    extra = [('Internal audit', 'KYC-01', 'Periodic updation overdue for a batch of medium-risk customers', 'Process', 'Medium', 'Operations', D_(2026, 5, 20), D_(2026, 7, 31), D_(2026, 10, 31), 'Audit Committee', 'Open', None, None, 'Not required', 'Yes'),
             ('Internal audit', 'CF-02', 'Guarantee invoked after 120 days in two partner portfolios', 'Third party', 'High', 'Collections', D_(2026, 6, 5), D_(2026, 7, 5), None, None, 'Closed', D_(2026, 7, 2), 'Yes', 'Yes', 'Yes'),
             ('Internal audit', 'RBC-05', 'Property documents released after 30 days in a sample of closed loans', 'Process', 'Medium', 'Operations', D_(2026, 6, 18), D_(2026, 8, 17), None, None, 'Open', None, None, 'Not required', 'No'),
             ('RBI inspection', 'RET-01', 'Differences between a quarterly return and the audited figures', 'System', 'High', 'Finance and Accounts', D_(2026, 4, 22), D_(2026, 6, 30), D_(2026, 8, 31), 'Chief Compliance Officer, with the approval of the Audit Committee', 'Open', None, None, 'Yes', 'Yes'),
             ('RBI inspection', 'FRM-02', 'Early warning framework for loan accounts not yet in operation', 'System', 'High', 'Risk Management', D_(2026, 4, 22), D_(2026, 12, 31), None, None, 'Open', None, None, 'No', 'No'),
             ('RBI inspection', 'IO-01', 'Auto-escalation of rejected complaints not enabled for one product', 'System', 'Medium', 'Customer Service', D_(2026, 4, 22), D_(2026, 7, 31), None, None, 'Closed', D_(2026, 7, 24), 'Yes', 'Not required', 'Yes'),
             ('Statutory audit', 'RBC-03', 'Penal charges shown under interest income in one product ledger', 'Process', 'Low', 'Finance and Accounts', D_(2026, 5, 28), D_(2026, 8, 26), None, None, 'Closed', D_(2026, 8, 12), 'No', 'Not required', 'No'),
             ('Self-reported breach', 'RET-02', 'One monthly return filed two days after the due date', 'People', 'Medium', 'Finance and Accounts', D_(2026, 7, 18), D_(2026, 9, 16), None, None, 'Closed', D_(2026, 8, 30), 'Yes', 'Not required', 'Yes'),
             ('Self-reported breach', 'KYC-02', 'Upload batch failed for three days; records uploaded late', 'System', 'Low', 'Operations', D_(2026, 8, 11), D_(2026, 11, 9), None, None, 'Open', None, None, 'Not required', 'Yes'),
             ('Complaint analysis', 'RBC-04', 'Repeat complaints about calls outside permitted hours by one agency', 'Third party', 'High', 'Collections', D_(2026, 8, 3), D_(2026, 9, 2), None, None, 'Open', None, None, 'Yes', 'Yes')]
    for e in extra:
        issues.append(['I-%03d' % (len(issues) + 1), e[0], e[1], None, e[2], e[3], e[4], e[5], iso(e[6]), iso(e[7]), iso(e[8]), e[9], e[10], iso(e[11]), e[12], e[13], e[14]])
    D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.fystart.date': FY.isoformat(), 'setup.date': REP.isoformat(), 'setup.layer': 'Middle Layer', 'rev.penalty': 500000, 'rev.actions': 1,
         'prev.c': 0, 'prev.h': 6, 'prev.m': 15, 'prev.l': 14, 'universe': U, 'tests': tests, 'issues': issues,
         'products': [['Top-up loan against property', '2026-05-12', 'Yes', 4, 1, 'Pricing disclosure corrected in month 2'], ['Co-lending with a partner bank', '2026-07-01', 'Yes', 1, 0, 'Second monthly review pending'],
                      ['Doorstep gold loan process', '2026-02-10', 'Yes', 6, 2, 'Monitoring completed; two issues closed'], ['Onboarding through video-based customer identification', '2026-08-20', 'No', 1, 0, 'Launched before evaluation was recorded']]}
    return D


if __name__ == '__main__':
    D = build(); json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(D['universe']), 'obligations,', len(D['tests']), 'tests,', len(D['issues']), 'issues')
