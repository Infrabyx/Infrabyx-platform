"""Worked example data for the ICAAP model – same fictitious NBFC. Figures are invented."""
import json, sys
D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': '2026-03-31'}
fin = {'ii': (250, 305, 360), 'oi': (18, 24, 30), 'ie': (100, 122, 145), 'opex': (78, 92, 105), 'prov': (24, 27, 30), 'tax': (16.6, 22.1, 27.7), 'div': (0, 0, 8), 'assets': (1620, 1930, 2280),
       'loans': (1400, 1690, 2000), 'borr': (1270, 1510, 1790), 'nw': (270, 336, 410), 'gnpa': (36, 41, 47.2), 'nnpa': (18, 20, 22.3)}
for k, v in fin.items():
    for y, x in zip(('y2', 'y1', 'y0'), v): D['fin.%s.%s' % (k, y)] = x
D.update({'cap.eq': 100, 'cap.res': 250, 'cap.prem': 50, 'cap.intang': 20, 'cap.grp': 15, 'cap.gp': 25, 'cap.osl': 1880})
on = [150, 30, 0, 30, 20, 1300, 475, 172, 0, 0, 0, 0, 0, 0, 25, 10, 48, 20]
for i, v in enumerate(on, 1): D['rwa.on.amt.%d' % i] = v
D['rwa.off.amt.3'] = 120; D['rwa.off.amt.4'] = 35
top = [38, 34, 30, 27, 25, 22, 20, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9.5, 9, 8.5, 8]
for i, v in enumerate(top, 1): D['top.name.%d' % i] = 'Borrower %02d' % i; D['top.exp.%d' % i] = v
for i, (n, v) in enumerate([('Textiles', 310), ('Trading – wholesale and retail', 290), ('Transport operators', 300), ('Food processing', 180), ('Engineering goods', 160), ('Construction', 140),
                            ('Professional services', 130), ('Chemicals', 110), ('Education', 90), ('Others', 290)], 1): D['sector.name.%d' % i] = n; D['sector.exp.%d' % i] = v
for i, (n, v) in enumerate([('Gujarat', 620), ('Maharashtra', 430), ('Rajasthan', 310), ('Madhya Pradesh', 220), ('Karnataka', 160), ('Tamil Nadu', 110), ('Delhi NCR', 90), ('Others', 60)], 1): D['state.name.%d' % i] = n; D['state.exp.%d' % i] = v
rsa = [40, 40, 110, 170, 160, 380, 520, 430, 110, 40]; rsl = [60, 60, 150, 220, 200, 400, 380, 240, 60, 20]
for i in range(10): D['alm.rsa.%d' % (i + 1)] = rsa[i]; D['alm.rsl.%d' % (i + 1)] = rsl[i]
for i, (a, b) in enumerate([(20, 29), (22, 32), (49, 69)], 1): D['liq.in.%d' % i] = a; D['liq.out.%d' % i] = b
D.update({'liq.top10': 0.68, 'liq.st': 0.42, 'liq.cp': 0.04, 'liq.liqta': 0.066, 'liq.lines': 0.55, 'op.n.y2': 4, 'op.n.y1': 6, 'op.n.y0': 5, 'op.gross.y2': 0.6, 'op.gross.y1': 1.1, 'op.gross.y0': 0.9,
          'op.rec.y2': 0.2, 'op.rec.y1': 0.3, 'op.rec.y0': 0.2, 'mkt.eq': 20, 'mkt.bond': 60, 'mkt.dur': 2.5, 'mkt.fx': 0})
kri = {1: [1, 5, 0, 0.9, 0.93], 2: [0, 3, 1, 0.004, 0.04], 3: [4, 3, 0.06, 1, 0], 4: [0.94, 0.97, 0.305, 0.43, 0.036], 5: [0.24, 0.12, 0.18, 0, 0], 6: [1, 1.15, 0.01, 0.46, 0],
       7: [0, 0.34, 0.2, 2, 1], 8: [2, 3, 1, 0.005, 0.04], 9: [0.04, 0.1, 0, 0, 0], 11: [4, 0.0006, 1, 0.25, 0], 12: [0.33, 1, 0, 0.3, 0.92]}
for a, vals in kri.items():
    for j, v in enumerate(vals, 1): D['kri.%d.%d.val' % (a, j)] = v
D['ru.mat.18'] = 'No'; D['ru.why.18'] = 'The company has not securitised or assigned any loans and has no co-lending arrangement.'
D['ru.why.21'] = 'Defined benefit obligation is small and fully provided.'; D['ru.why.22'] = 'No trading or settlement activity.'; D['ru.why.23'] = 'No other material risk identified in the risk assessment.'
for j, (g, p, e, t) in enumerate([(0.22, 105, 40, 20), (0.20, 128, 0, 0), (0.18, 152, 0, 15)], 1):
    D.update({'plan.g.%d' % j: g, 'plan.pat.%d' % j: p, 'plan.div.%d' % j: 0.10, 'plan.eq.%d' % j: e, 'plan.t2.%d' % j: t})
json.dump(D, open(sys.argv[1], 'w'), indent=0, ensure_ascii=False); print(len(D), 'values')
