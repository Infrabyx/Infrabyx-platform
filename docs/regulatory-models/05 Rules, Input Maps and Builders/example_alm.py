"""Worked example for the ALM model – fictitious NBFC, ₹ crore."""
import json, sys
D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': '2026-03-31', 'setup.t1': 380, 'setup.nii': 215, 'setup.ta': 2280}
out = {1: [0, 0, 0, 0, 0, 0, 0, 0, 0, 410], 2: [12, 14, 30, 48, 46, 130, 210, 420, 110, 130], 3: [0, 0, 10, 20, 20, 60, 110, 180, 60, 30], 4: [10, 10, 15, 20, 15, 0, 0, 0, 0, 0], 8: [3, 4, 5, 7, 9, 0, 0, 0, 0, 0], 9: [2, 2, 4, 4, 4, 10, 20, 9, 0, 0], 10: [2, 2, 5, 5, 5, 15, 25, 21, 0, 0], 11: [0, 0, 0, 0, 0, 0, 0, 0, 0, 7]}
inn = {1: [90, 0, 0, 0, 0, 0, 0, 0, 0, 0], 2: [40, 10, 10, 0, 0, 0, 0, 0, 0, 0], 3: [14, 15, 34, 66, 66, 190, 340, 640, 215, 69], 4: [4, 5, 11, 19, 19, 50, 80, 120, 35, 18], 5: [0, 0, 0, 0, 0, 0, 0, 12, 10, 0.3], 6: [0, 0, 0, 0, 0, 0, 10, 10, 0, 0], 8: [0, 0, 0, 0, 0, 0, 0, 0, 0, 65], 9: [0, 0, 0, 2, 2, 4, 6, 3, 0, 5.7]}
for j, v in out.items():
    for i, x in enumerate(v, 1): D['liq.out.%d.%d' % (j, i)] = x
for j, v in inn.items():
    for i, x in enumerate(v, 1): D['liq.in.%d.%d' % (j, i)] = x
rsa = [40, 40, 110, 170, 160, 380, 520, 430, 110, 40]; rsl = [60, 60, 150, 220, 200, 400, 380, 240, 60, 20]
for i in range(10): D['rate.rsa.%d' % (i + 1)] = rsa[i]; D['rate.rsl.%d' % (i + 1)] = rsl[i]
D.update({'fund.total': 1790, 'fund.top10': 1215, 'fund.st': 752, 'fund.cp': 70, 'fund.bank': 1150, 'fund.liq': 150, 'fund.lines': 120, 'fund.rep3': 250})
json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(D))
