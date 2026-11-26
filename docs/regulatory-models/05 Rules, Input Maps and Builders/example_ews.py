"""Worked example for the Fraud Early Warning Scoring Model – fictitious NBFC, 90 loan accounts at 30 September 2026.
The functions below restate the rules in Python, independently of the workbook, and are used by check_tier3.py.
Run: python3 example_ews.py <out.json>"""
import json, sys, random, datetime
D_ = datetime.date
DT = D_(2026, 9, 30); AMBER, RED, EXAM, FMR = 10, 25, 30, 14
W = [5, 10, 5, 5, 10, 10, 3, 15, 3, 3, 10, 5, 5, 10, 10, 3, 5, 10, 15, 5, 3, 5, 15, 15, 10, 5, 3, 15, 15, 3]
CRIT = [8, 19, 23, 24, 28, 29]                       # numbers of the critical indicators in the library
FAMILY = [0] * 9 + [1] * 7 + [2] * 7 + [3] * 7
NI = 30; OPEN = ('Not started', 'Under examination'); CONF = ('Referred for investigation', 'Classified as fraud')


def score(flags):
    """flags: list of 30 values ('Yes' or None)."""
    hit = [j for j, f in enumerate(flags) if f == 'Yes']; s = sum(W[j] for j in hit); nc = sum(1 for j in hit if j + 1 in CRIT)
    return dict(n=len(hit), crit=nc, fam=len({FAMILY[j] for j in hit}), score=s, alert='RED' if (s >= RED or nc) else 'AMBER' if s >= AMBER else 'GREEN')


def follow(row, dt=DT):
    fl = row[4:4 + NI]; ad, st, cd, fd, md = [(D_.fromisoformat(x) if isinstance(x, str) and len(x) == 10 and x[4] == '-' else x) for x in row[4 + NI:9 + NI]]
    r = score(fl); status = st or ('' if r['alert'] == 'GREEN' else 'Not started'); r['status'] = status
    days = None if (not status or ad is None) else ((cd or dt) - ad).days; r['days'] = days
    if not status: r['exam'] = ''
    elif status in OPEN: r['exam'] = 'CHECK' if days is None else ('RED' if days > EXAM else 'AMBER')
    else: r['exam'] = 'GREEN' if days is None else ('AMBER' if days > EXAM else 'GREEN')
    r['due'] = fd + datetime.timedelta(days=FMR) if fd else None
    r['ret'] = '' if not fd else (('GREEN' if md <= r['due'] else 'RED') if md else ('RED' if dt > r['due'] else 'AMBER'))
    r['caught'] = '' if status not in CONF else ('No' if r['alert'] == 'GREEN' else 'Yes')
    return r


def build():
    random.seed(47); A = []
    segs = ['MSME term loan', 'Working capital loan', 'Loan against property', 'Equipment finance', 'Supply chain finance']
    def iso(d): return d.isoformat()
    for i in range(1, 91):
        fl = [None] * NI
        k = random.choices([0, 1, 2, 3, 5], weights=[55, 20, 12, 8, 5])[0]
        for j in random.sample([x for x in range(NI) if x + 1 not in CRIT], k): fl[j] = 'Yes'
        A.append(['A%04d' % i, 'Borrower %d' % i, random.choice(segs), random.randrange(10, 400) * 100000] + fl + [None] * 5)
    def setf(i, nums):
        for n in nums: A[i - 1][4 + n - 1] = 'Yes'
    setf(7, [24, 2, 5]); setf(19, [8]); setf(33, [19, 18, 11]); setf(48, [23, 26]); setf(61, [28, 25, 6]); setf(74, [2, 5, 11, 14])      # designed serious cases
    A[11][4:4 + NI] = [None] * NI                                                                                                        # account 12: no indicator, later found to be fraud (a miss)
    res = [score(a[4:4 + NI]) for a in A]; alerts = [i for i, r in enumerate(res) if r['alert'] != 'GREEN']
    random.seed(53)
    for n, i in enumerate(alerts):
        ad = DT - datetime.timedelta(days=random.randint(3, 85)); A[i][4 + NI] = iso(ad); red = res[i]['alert'] == 'RED'
        pick = random.random()
        if pick < 0.20: st, cd = 'Not started', None
        elif pick < 0.50: st, cd = 'Under examination', None
        elif pick < 0.85 and not red: st, cd = 'Closed – no fraud angle', ad + datetime.timedelta(days=random.randint(5, 40))
        else: st, cd = 'Referred for investigation', ad + datetime.timedelta(days=random.randint(5, 28))
        if cd and cd > DT: cd = DT
        A[i][5 + NI] = st; A[i][6 + NI] = iso(cd) if cd else None
    def fraud(i, ad, cd, fd, md):
        A[i - 1][4 + NI:9 + NI] = [iso(ad) if ad else None, 'Classified as fraud', iso(cd), iso(fd), iso(md) if md else None]
    fraud(7, D_(2026, 6, 10), D_(2026, 7, 2), D_(2026, 7, 2), D_(2026, 7, 14))        # return furnished in time
    fraud(33, D_(2026, 5, 4), D_(2026, 6, 20), D_(2026, 6, 20), D_(2026, 7, 10))      # return furnished late
    fraud(61, D_(2026, 8, 20), D_(2026, 9, 22), D_(2026, 9, 22), None)                # return not yet furnished, within time
    fraud(12, None, D_(2026, 8, 28), D_(2026, 8, 28), D_(2026, 9, 8))                 # the miss: no alert had been raised
    D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': DT.isoformat(), 'acc': A}
    return D


if __name__ == '__main__':
    D = build(); json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(D['acc']), 'accounts')
