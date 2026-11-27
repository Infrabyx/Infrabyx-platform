"""Worked example for the lending limits monitor – fictitious NBFC, rupees."""
import json, sys, random
random.seed(7)
D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': '2026-09-30', 'th.goldbiz': 0.75}
D['guarantees'] = [['Personal loans – Partner A – April 2026', 'Partner A Fintech Private Limited', 400000000, 400000000, 8000000, 10000000, 2000000, 1500000, 75], ['Consumer loans – Partner B – June 2026', 'Partner B Services Private Limited', 250000000, 180000000, 5000000, 4500000, 0, 0, 118],
                   ['Small business loans – Partner C', 'Partner C Technologies Private Limited', 120000000, 90000000, 0, 2500000, 1500000, 600000, 134]]
g = []
for i in range(40):
    b = 'B%03d' % (i // 2 + 1) if i < 12 else 'B%03d' % (i + 1); purpose = 'Income generating' if i % 9 == 4 else 'Consumption'; bullet = 'Yes' if i % 7 == 3 else 'No'
    amt = random.choice([60000, 120000, 180000, 260000, 340000, 520000, 750000]); out = round(amt * random.uniform(0.7, 1.0)); val = round(out / random.choice([0.62, 0.70, 0.74, 0.78, 0.83, 0.88]))
    g.append(['GL%04d' % (i + 1), b, purpose, bullet, amt, out, round(out * 1.09) if bullet == 'Yes' else None, val])
D['gold'] = g
D['shares'] = [['LAS%03d' % (i + 1), 'Borrower S%02d' % (i + 1), o, mv, dt] for i, (o, mv, dt) in enumerate([(2500000, 6000000, None), (4000000, 7600000, '2026-09-24'), (1800000, 3300000, '2026-09-15'), (5200000, 10400000, None), (900000, 1700000, None), (3000000, 5800000, '2026-09-29')])]
h = []
for i in range(60):
    inc = random.choice([96000, 120000, 150000, 180000, 240000, 300000, 330000]); ex = random.choice([0, 800, 1500, 2600, 4200]); emi = random.choice([1200, 1850, 2400, 3100])
    h.append(['HH%04d' % (i + 1), 'Centre %02d' % (i % 6 + 1), inc, ex, emi, 'Yes'])
D['households'] = h
json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(D))
