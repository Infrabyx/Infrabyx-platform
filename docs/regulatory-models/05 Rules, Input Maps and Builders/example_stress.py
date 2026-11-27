"""Worked example data for the Stress Testing model – same fictitious NBFC as the ECL example. Figures are invented."""
import json, sys
D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': '2026-03-31',
     'base.t1': 380, 'base.t2': 25, 'base.rwa': 2154.5, 'base.assets': 2280, 'base.osl': 1880, 'base.of': 400, 'base.ppop': 150, 'base.ccost': 28, 'base.nii': 215, 'base.opex': 105,
     'base.borr': 1790, 'base.reprice': 0.55, 'base.gross': 2000, 'base.s3': 47.2, 'base.ecl': 61.04, 'base.pd': 0.0299, 'base.lgd': 0.4113, 'base.hqla': 150, 'base.lines': 120,
     'base.undrawn': 155, 'base.eq': 20, 'base.bond': 60, 'base.dur': 2.5, 'base.fx': 0, 'base.ginc': 215, 'base.grp': 15}
segs = [('MSME Secured Loans', 420, 12.18, 0.0324, 0.3715, 'Yes', 0.15), ('Loan Against Property', 610, 10.98, 0.0218, 0.1667, 'No', 0.10), ('Unsecured Business Loans', 250, 10.0, 0.0677, 0.7774, 'Yes', 0.10),
        ('Personal Loans', 180, 5.4, 0.0365, 0.7718, 'No', 0.05), ('Vehicle Finance', 300, 7.5, 0.0242, 0.3604, 'No', 0.20), ('Supply Chain Finance', 240, 1.2, 0.0131, 0.50, 'No', 0.0)]
for k, (nm, g, s3, pd, lgd, st, cl) in enumerate(segs, 1):
    D.update({'seg.name.%d' % k: nm, 'seg.gross.%d' % k: g, 'seg.s3.%d' % k: s3, 'seg.pd.%d' % k: pd, 'seg.lgd.%d' % k: lgd, 'seg.stressed.%d' % k: st, 'seg.climate.%d' % k: cl})
top = [38, 34, 30, 27, 25, 22, 20, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9.5, 9, 8.5, 8]
for i, v in enumerate(top, 1):
    D['top.name.%d' % i] = 'Borrower %02d' % i; D['top.exp.%d' % i] = v
for i, (n, v) in enumerate([('Textiles', 310), ('Trading – wholesale and retail', 290), ('Transport operators', 300), ('Food processing', 180), ('Engineering goods', 160), ('Construction', 140),
                            ('Professional services', 130), ('Chemicals', 110), ('Education', 90), ('Others', 290)], 1):
    D['sector.name.%d' % i] = n; D['sector.exp.%d' % i] = v
for i, (n, v) in enumerate([('Gujarat', 620), ('Maharashtra', 430), ('Rajasthan', 310), ('Madhya Pradesh', 220), ('Karnataka', 160), ('Tamil Nadu', 110), ('Delhi NCR', 90), ('Others', 60)], 1):
    D['state.name.%d' % i] = n; D['state.exp.%d' % i] = v
coll = [18, 20, 45, 85, 85, 240, 420, 760, 250, 77]; ino = [2, 2, 4, 6, 6, 15, 25, 20, 10, 10]
outb = [25, 28, 60, 95, 90, 250, 400, 650, 150, 42]; outo = [4, 4, 9, 9, 9, 25, 45, 30, 10, 345]
rsa = [40, 40, 110, 170, 160, 380, 520, 430, 110, 40]; rsl = [60, 60, 150, 220, 200, 400, 380, 240, 60, 20]
for i in range(10):
    D.update({'alm.in_coll.%d' % (i + 1): coll[i], 'alm.in_oth.%d' % (i + 1): ino[i], 'alm.out_borr.%d' % (i + 1): outb[i], 'alm.out_oth.%d' % (i + 1): outo[i], 'alm.rsa.%d' % (i + 1): rsa[i], 'alm.rsl.%d' % (i + 1): rsl[i]})
D.update({'act.cap.1': 60, 'act.time.1': '3 months', 'act.owner.1': 'Board / promoters', 'act.cap.2': 8, 'act.time.2': 'Immediate', 'act.owner.2': 'Board', 'act.rwa.3': 120, 'act.time.3': '1 month', 'act.owner.3': 'Chief Risk Officer',
          'act.rwa.4': 150, 'act.liq.4': 150, 'act.time.4': '2 months', 'act.owner.4': 'Chief Financial Officer', 'act.liq.6': 100, 'act.time.6': '1 week', 'act.owner.6': 'Treasury'})
json.dump(D, open(sys.argv[1], 'w'), indent=0, ensure_ascii=False); print(len(D), 'values')
