"""Worked example for the Securitisation Retention and Holding Period Calculator – fictitious NBFC, pool of 64 loans.
The functions below restate the rules in Python, independently of the workbook, and are used by check_tier3.py.
Run: python3 example_securitisation.py <out.json>"""
import json, sys, random, datetime, calendar
D_ = datetime.date
TH = dict(mrr1=0.05, mat=24, mrr2=0.10, mrr3=0.05, order=0.05, mhp1=3, tenor=24, mhp2=6, mhp3=6, resid=365)
DT = D_(2026, 11, 30)


def edate(d, m):
    y, mo = divmod(d.month - 1 + m, 12); y += d.year; mo += 1
    return D_(y, mo, min(d.day, calendar.monthrange(y, mo)[1]))


def iso(x): return D_.fromisoformat(x) if isinstance(x, str) else x


def test(row, dt=DT, rmbs='No', th=TH):
    """Eligibility, holding period and retention rate of one loan. Row as on Pool Input."""
    (lid, bor, bv, om, rd, cls, inel, bullet, prov, acq, acqd, proj, cod, mort, disb, cer, cerd, first) = (list(row) + [None] * 18)[:18]
    prov = prov == 'Yes'; bullet = bullet == 'Yes'
    if cls != 'Standard': el = 'Not eligible: not a standard asset'
    elif inel not in (None, '', 'None'): el = 'Not eligible: ' + inel
    elif bullet and not prov: el = 'Not eligible: bullet repayment loan'
    elif not prov and rd < th['resid']: el = 'Not eligible: residual maturity below the minimum'
    else: el = 'Eligible'
    out = dict(el=el, ok=el == 'Eligible', start=None, months=None, end=None, mhp=None, short=None, rate=None, req=None)
    if prov: out['mhp'] = 'Not applicable'
    else:
        if acq == 'Yes': st, mo = iso(acqd), th['mhp3']
        else:
            mo = th['mhp1'] if om <= th['tenor'] else th['mhp2']
            if proj == 'Yes': st = iso(cod)
            elif mort == 'Yes': st = max(iso(disb), iso(cerd)) if disb and cerd else None
            elif cer == 'Yes': st = iso(cerd)
            else: st = iso(first)
        out['start'], out['months'] = st, mo
        if st is None: out['mhp'] = 'CHECK'
        else:
            out['end'] = edate(st, mo); out['mhp'] = 'GREEN' if dt >= out['end'] else 'RED'
            if out['mhp'] == 'RED': out['short'] = (out['end'] - dt).days
    if out['ok']:
        out['rate'] = th['mrr3'] if rmbs == 'Yes' else (th['mrr2'] if (bullet or om > th['mat']) else th['mrr1']); out['req'] = bv * out['rate']
    return out


def build():
    random.seed(23); P = []
    def d(y, m, dd): return D_(y, m, dd).isoformat()
    seg = [('Vehicle loan', 36, 48, True), ('Business loan', 18, 24, False), ('Equipment loan', 48, 60, True), ('Personal loan', 18, 24, False), ('Loan against property', 84, 120, True)]
    for i in range(1, 53):
        nm, lo, hi, sec = random.choice(seg); om = random.randrange(lo, hi + 1, 6); age = random.randint(8, min(om - 13, 20)) if om > 24 else random.randint(4, 5)
        bv = random.randrange(4, 60) * 50000; start = edate(DT, -age); rd = (edate(start, om) - DT).days; mort = nm == 'Loan against property'
        row = ['L%04d' % i, '%s borrower %d' % (nm, i), bv, om, rd, 'Standard', 'None', 'No', 'No', 'No', None, 'No', None, 'Yes' if mort else 'No', (start - datetime.timedelta(days=20)).isoformat() if mort else None,
               'Yes' if sec else 'No', (start + datetime.timedelta(days=random.randint(3, 25))).isoformat() if sec else None, edate(start, 1).isoformat()]
        P.append(row)
    # designed cases
    P += [['L0053', 'Vehicle loan borrower 53', 900000, 48, 1100, 'Not standard', 'None', 'No', 'No', 'No', None, 'No', None, 'No', None, 'Yes', d(2025, 9, 12), d(2025, 10, 5)],                    # not standard
          ['L0054', 'Working capital limit 54', 2500000, 12, 400, 'Standard', 'Revolving credit facility', 'No', 'No', 'No', None, 'No', None, 'No', None, 'No', None, d(2026, 2, 5)],                 # revolving
          ['L0055', 'Trader bullet loan 55', 1200000, 18, 420, 'Standard', 'None', 'Yes', 'No', 'No', None, 'No', None, 'No', None, 'No', None, d(2027, 1, 25)],                                    # bullet, not allowed
          ['L0056', 'Crop loan 56', 300000, 12, 150, 'Standard', 'None', 'Yes', 'Yes', 'No', None, 'No', None, 'No', None, 'No', None, None],                                                       # bullet under the proviso
          ['L0057', 'Trade receivable 57', 800000, 6, 95, 'Standard', 'None', 'Yes', 'Yes', 'No', None, 'No', None, 'No', None, 'No', None, None],                                                  # bullet under the proviso
          ['L0058', 'Personal loan borrower 58', 250000, 24, 300, 'Standard', 'None', 'No', 'No', 'No', None, 'No', None, 'No', None, 'No', None, d(2025, 10, 5)],                                 # residual maturity short
          ['L0059', 'Acquired vehicle loan 59', 700000, 48, 900, 'Standard', 'None', 'No', 'No', 'Yes', d(2026, 7, 15), 'No', None, 'No', None, 'Yes', d(2025, 3, 1), d(2025, 4, 5)],               # acquired, 6 months not over
          ['L0060', 'Acquired equipment loan 60', 1500000, 60, 1300, 'Standard', 'None', 'No', 'No', 'Yes', d(2026, 3, 31), 'No', None, 'No', None, 'Yes', d(2024, 11, 1), d(2024, 12, 5)],          # acquired, complete
          ['L0061', 'Solar project loan 61', 6000000, 96, 2500, 'Standard', 'None', 'No', 'No', 'No', None, 'Yes', d(2026, 4, 20), 'No', None, 'Yes', d(2024, 8, 1), d(2026, 7, 5)],                # project loan, from COD
          ['L0062', 'Loan against property 62', 4000000, 120, 3300, 'Standard', 'None', 'No', 'No', 'No', None, 'No', None, 'Yes', d(2026, 8, 10), 'Yes', d(2026, 3, 2), d(2026, 4, 5)],            # mortgage: disbursed in full later
          ['L0063', 'Business loan borrower 63', 500000, 24, 640, 'Standard', 'None', 'No', 'No', 'No', None, 'No', None, 'No', None, 'No', None, d(2026, 9, 5)],                                  # unsecured, first repayment recent
          ['L0064', 'Vehicle loan borrower 64', 650000, 24, 640, 'Standard', 'None', 'No', 'No', 'No', None, 'No', None, 'No', None, 'Yes', d(2026, 8, 31), d(2026, 9, 5)]]                         # start on 31 August: three months end on 30 November
    res = [test(r) for r in P]; elig = sum(r[2] for r, t in zip(P, res) if t['ok']); req = sum(t['req'] for t in res if t['ok'])
    flf = round(elig * 0.04, -3); eq = round(req - flf + 250000, -3)
    D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': DT.isoformat(), 'setup.rmbs': 'No', 'setup.basis': 'Loan by loan', 'pool': P,
         'ret.flf': flf, 'ret.flfall': 'Yes', 'ret.eq': eq, 'ret.eqall': 'Yes', 'ret.other': 0, 'ret.io': round(elig * 0.015, -3), 'ret.own': 'Yes', 'ret.free': 'Yes', 'ret.form': 'Yes', 'ret.disc': 'Yes'}
    return D


if __name__ == '__main__':
    D = build(); json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(D['pool']), 'loans')
