"""Worked example for the exposure monitor – fictitious NBFC, ₹ crore."""
import json, sys
D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': '2026-03-31', 'setup.t1': 380, 'setup.of': 380, 'setup.nw': 410, 'setup.book': 2080}
ex = [38, 34, 30, 27, 25, 22, 20, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9.5, 9, 8.5, 8, 7, 6.5, 6, 5.5, 5, 98]
secs = ['Textiles', 'Trading', 'Transport operators', 'Food processing', 'Engineering goods', 'Construction']; stas = ['Gujarat', 'Maharashtra', 'Rajasthan', 'Madhya Pradesh']; grp = {0: 'Alpha Group', 3: 'Alpha Group', 7: 'Alpha Group', 1: 'Beta Group', 5: 'Beta Group', 25: 'Gamma Infra Group'}
D['borrowers'] = [['Borrower %02d' % (i + 1), grp.get(i), secs[i % 6], stas[i % 4], round(v * 0.9, 2), round(v * 0.1, 2), 0, 'Yes' if i == 25 else 'No', 1.4 if i == 9 else None, 'No' if i % 5 == 0 else 'Yes'] for i, v in enumerate(ex)]
for j, (g, inf) in enumerate([('Alpha Group', 'No'), ('Beta Group', 'No'), ('Gamma Infra Group', 'Yes')], 1): D['group.name.%d' % j] = g; D['group.infra.%d' % j] = inf
for j, (n, v, l) in enumerate(zip(secs, [240, 250, 260, 150, 130, 110], [0.18, 0.22, 0.18, 0.12, 0.12, 0.10]), 1): D['sector.name.%d' % j] = n; D['sector.retail.%d' % j] = v; D['sector.limit.%d' % j] = l
for j, (n, v, l) in enumerate(zip(stas, [520, 380, 270, 190], [0.35, 0.30, 0.25, 0.20]), 1): D['state.name.%d' % j] = n; D['state.retail.%d' % j] = v; D['state.limit.%d' % j] = l
D.update({'sens.cme': 20, 'sens.cre': 45, 'sens.grp': 15, 'sens.unsec': 490})
json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(D))
