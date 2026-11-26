"""Worked example for the Internal Audit Risk Assessment and Audit Plan – fictitious NBFC, 46 auditable units, plan year from 1 April 2027.
The functions below restate the rules in Python, independently of the workbook, and are used by check_tier3.py.
Run: python3 example_rbia.py <out.json>"""
import json, sys, random, datetime, math
from example_securitisation import edate
D_ = datetime.date
START = D_(2027, 4, 1)
WI = [3, 2, 1, 1, 1, 2]; WC = [3, 2, 1, 2, 2]; TIME = [(0, 1), (13, 2), (19, 3), (25, 4), (37, 5)]; LOW, MED = 2.0, 3.5
MX = {('High', 'High'): 'Extremely high', ('High', 'Medium'): 'Very high', ('High', 'Low'): 'High', ('Medium', 'High'): 'Very high', ('Medium', 'Medium'): 'High', ('Medium', 'Low'): 'Medium', ('Low', 'High'): 'High', ('Low', 'Medium'): 'Medium', ('Low', 'Low'): 'Low'}
FREQ = {'Extremely high': (6, 1.5), 'Very high': (12, 1.25), 'High': (12, 1.0), 'Medium': (18, 0.75), 'Low': (24, 0.5)}
DAYS = {'Branch or location': 6, 'Business line': 25, 'Support function': 12, 'Process': 10, 'Information system': 15, 'Outsourced activity': 8}
PRI = {('High', 'High'): 1, ('High', 'Medium'): 2, ('High', 'Low'): 3, ('Medium', 'High'): 4, ('Medium', 'Medium'): 5, ('Low', 'High'): 6}
STAFF, PER = 3, 180


def level(x): return 'Low' if x <= LOW else ('Medium' if x <= MED else 'High')


def wavg(ws, vs):
    p = [(w, v) for w, v in zip(ws, vs) if v not in (None, '')]
    return sum(w * v for w, v in p) / sum(w for w, v in p)


def assess(row, start=START):
    uid, name, typ = row[:3]; inh = row[3:9]; ctl = row[9:13]; last = row[13]; yes = row[16] if len(row) > 16 else None
    last = D_.fromisoformat(last) if last else None
    months = None if last is None else max(0, (start.year - last.year) * 12 + start.month - last.month)
    ts = 5 if months is None else [s for m, s in TIME if m <= months][-1]
    si = wavg(WI, inh); sc = wavg(WC, list(ctl) + [ts]); li, lc = level(si), level(sc); ov = MX[(li, lc)]; fq, mu = FREQ[ov]
    due = start if last is None else edate(last, fq); ye = edate(start, 12); inplan = yes == 'Yes' or due < ye
    qtr = None
    if inplan: qtr = 'Q1' if due < edate(start, 3) else 'Q2' if due < edate(start, 6) else 'Q3' if due < edate(start, 9) else 'Q4'
    def q(x): return 'Q1' if x < edate(start, 3) else 'Q2' if x < edate(start, 6) else 'Q3' if x < edate(start, 9) else 'Q4'
    days = int(math.floor(DAYS[typ] * mu + 0.5)) if inplan else None; first = max(due, start); second = edate(first, fq); n = (2 if (due < ye and second < ye) else 1) if inplan else None
    return dict(si=si, sc=sc, li=li, lc=lc, months=months, ts=ts, ov=ov, pri=PRI.get((li, lc), 7), freq=fq, due=due, inplan=inplan, qtr=qtr, days=days, overdue=last is not None and due < start,
                audits=n, q2=q(second) if n == 2 else None, ydays=days * n if inplan else None)


def build():
    random.seed(31); U = []
    def dd(lo, hi): return edate(START, -random.randint(lo, hi)).replace(day=random.randint(1, 28)).isoformat()
    def sc(lo, hi, n): return [random.randint(lo, hi) for _ in range(n)]
    towns = ['Jaipur', 'Ajmer', 'Kota', 'Udaipur', 'Jodhpur', 'Alwar', 'Sikar', 'Bhilwara', 'Indore', 'Ujjain', 'Bhopal', 'Agra', 'Mathura', 'Meerut', 'Karnal', 'Hisar', 'Rohtak', 'Ludhiana', 'Patiala', 'Dehradun']
    for i, t in enumerate(towns, 1):
        hot = i in (3, 9, 14); U.append(['BR-%02d' % i, t + ' branch', 'Branch or location'] + (sc(3, 5, 5) if hot else sc(1, 3, 5)) + [random.randint(3, 5) if hot else random.randint(1, 3)] + (sc(3, 5, 4) if hot else sc(1, 3, 4))
                                         + [dd(1, 14), 'Increasing' if hot else random.choice(['Stable', 'Stable', 'Decreasing']), 'Increasing' if i == 9 else 'Stable', None])
    U[4][13] = None                                                    # a branch opened in the year: never audited
    U[6][8] = None; U[11][8] = None                                    # compliance risk not yet scored: left out of the average
    X = [('BL-01', 'Vehicle finance', 'Business line', [4, 2, 2, 3, 2, 3], [2, 2, 2, 2], (10, 14), 'Stable', 'Stable'), ('BL-02', 'MSME business loans', 'Business line', [4, 4, 3, 4, 4, 4], [4, 3, 3, 4], (12, 16), 'Increasing', 'Increasing'),
         ('BL-03', 'Loans against gold', 'Business line', [5, 5, 4, 4, 3, 5], [4, 4, 3, 4], (7, 10), 'Increasing', 'Stable'), ('BL-04', 'Loans against property', 'Business line', [3, 2, 2, 3, 2, 3], [2, 2, 2, 3], (14, 20), 'Stable', 'Stable'),
         ('BL-05', 'Digital personal loans through lending service providers', 'Business line', [5, 5, 3, 5, 4, 5], [5, 4, 3, 4], (10, 13), 'Increasing', 'Increasing'), ('BL-06', 'Co-lending with banks', 'Business line', [3, 4, 2, 3, 3, 3], [3, 2, 2, 3], (16, 22), 'Stable', 'Stable'),
         ('SF-01', 'Risk management function', 'Support function', [3, 2, 3, 3, 1, 3], [2, 3, 2, 3], (11, 13), 'Stable', 'Stable'), ('SF-02', 'Compliance function', 'Support function', [3, 3, 2, 3, 1, 4], [3, 3, 2, 3], (11, 13), 'Increasing', 'Stable'),
         ('SF-03', 'Treasury and asset liability management', 'Support function', [4, 2, 2, 4, 3, 3], [2, 2, 2, 2], (12, 18), 'Stable', 'Stable'), ('SF-04', 'Finance and accounts', 'Support function', [3, 1, 2, 2, 2, 2], [2, 1, 2, 2], (12, 20), 'Stable', 'Decreasing'),
         ('SF-05', 'Human resources and payroll', 'Support function', [2, 1, 2, 1, 1, 1], [1, 1, 1, 2], (20, 30), 'Stable', 'Stable'), ('SF-06', 'Secretarial and legal', 'Support function', [2, 1, 1, 2, 1, 2], [1, 1, 1, 2], (22, 34), 'Stable', 'Stable'),
         ('SF-07', 'Customer service and grievance redressal', 'Support function', [3, 2, 2, 3, 2, 4], [3, 3, 2, 3], (13, 19), 'Increasing', 'Stable'), ('SF-08', 'Administration and premises', 'Support function', [1, 1, 1, 1, 2, 1], [1, 1, 1, 1], (26, 40), 'Stable', 'Stable'),
         ('SF-09', 'Collections and recovery', 'Support function', [4, 3, 3, 4, 4, 5], [4, 4, 3, 4], (9, 12), 'Increasing', 'Increasing'),
         ('PR-01', 'Credit appraisal and sanction', 'Process', [4, 3, 2, 3, 3, 4], [3, 3, 2, 3], (12, 15), 'Stable', 'Stable'), ('PR-02', 'KYC and customer onboarding', 'Process', [4, 3, 2, 3, 2, 5], [4, 4, 2, 3], (12, 15), 'Increasing', 'Stable'),
         ('PR-03', 'Fraud risk management and early warning', 'Process', [3, 4, 2, 4, 2, 4], [3, 3, 2, 4], (None, None), 'Increasing', 'Stable'), ('PR-04', 'Regulatory returns and reporting', 'Process', [3, 3, 2, 2, 1, 4], [3, 4, 2, 3], (14, 18), 'Stable', 'Stable'),
         ('PR-05', 'Income recognition, asset classification and provisioning', 'Process', [4, 2, 2, 3, 3, 4], [2, 3, 3, 3], (12, 14), 'Stable', 'Stable'),
         ('IS-01', 'Loan origination and loan management systems', 'Information system', [5, 4, 2, 4, 2, 4], [3, 3, 2, 4], (12, 16), 'Increasing', 'Stable'), ('IS-02', 'Information security and cyber resilience', 'Information system', [4, 3, 3, 5, 2, 4], [3, 4, 2, 4], (10, 13), 'Increasing', 'Increasing'),
         ('IS-03', 'Business continuity and disaster recovery', 'Information system', [3, 2, 2, 3, 1, 3], [2, 2, 2, 3], (18, 26), 'Stable', 'Stable'),
         ('OA-01', 'Recovery agencies', 'Outsourced activity', [4, 3, 2, 4, 3, 5], [4, 4, 2, 4], (12, 15), 'Increasing', 'Increasing'), ('OA-02', 'Document storage vendor', 'Outsourced activity', [2, 1, 1, 1, 1, 2], [1, 1, 1, 2], (24, 36), 'Stable', 'Stable'),
         ('OA-03', 'Cloud service provider', 'Outsourced activity', [4, 3, 2, 4, 2, 3], [2, 2, 2, 3], (15, 20), 'Stable', 'Stable')]
    for uid, nm, ty, inh, ctl, rng, t1, t2 in X: U.append([uid, nm, ty] + inh + ctl + [dd(max(1, rng[0] - 7), max(3, rng[1] - 7)) if rng[0] else None, t1, t2, None])
    U[[u[0] for u in U].index('SF-02')][16] = 'Yes'; U[[u[0] for u in U].index('SF-01')][16] = 'Yes'       # the company's choice: risk management and compliance functions are audited every year
    D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': START.isoformat(), 'cap.staff': STAFF, 'cap.days': PER, 'units': U}
    return D


if __name__ == '__main__':
    D = build(); json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(D['units']), 'units')
