"""Worked example for the classification engine – 60 invented loans."""
import json, sys, random
random.seed(7); L = []; prods = ['MSME Secured Loans', 'Loan Against Property', 'Unsecured Business Loans', 'Vehicle Finance']
for i in range(1, 61):
    p = prods[i % 4]; sec = 'Unsecured' if 'Unsecured' in p else 'Secured'; amt = random.choice([250000, 500000, 900000, 1500000, 4000000])
    dpd = random.choice([0] * 60 + [12, 25, 40, 55, 70, 85, 95, 130, 200, 420, 800, 1500]); bid = 'B%03d' % (i if i % 9 else i - 1)
    npad = None; 
    if dpd > 90:
        import datetime; npad = (datetime.date(2026, 3, 31) - datetime.timedelta(days=dpd - 90)).isoformat()
    L.append(['LN%04d' % i, bid, p, sec, amt, round(amt * 0.01 * (dpd // 30), 0), dpd, npad, round(amt * random.choice([0.6, 0.9, 1.3]), 0) if sec == 'Secured' else None, 'Yes' if i == 7 else None, 'Yes' if i == 33 else None, 'Yes' if i == 41 else None, 'Yes' if i in (5, 6) else None, 'Yes' if i == 6 else None])
D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': '2026-03-31', 'loans': L}
for j, p in enumerate(prods, 1): D['summary.product.%d' % j] = p
json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(L))
