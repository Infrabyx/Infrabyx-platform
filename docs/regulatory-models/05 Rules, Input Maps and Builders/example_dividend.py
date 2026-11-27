"""Worked example for the dividend monitor – fictitious NBFC, ₹ crore."""
import json, sys
D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.type': 'Other NBFC', 'setup.years': 3, 'div.reserve': 'Yes', 'div.reg': 'Yes', 'div.free': 'Yes', 'div.pat': 62, 'div.except': 2, 'div.overstate': 0, 'div.interim': 6, 'div.final': 18, 'div.ccps': 0,
     'board.divergence': 'No divergence reported in the last inspection', 'board.qualification': 'Unqualified report', 'board.growth': 'Capital plan in the ICAAP supports growth of 25 per cent after the dividend', 'board.date': '2026-08-14'}
for i, (lab, cap, nn, adv, cr, t1) in enumerate([('2023-24', 'Yes', 12, 600, 0.213, 0.189), ('2024-25', 'Yes', 14, 720, 0.201, 0.180), ('2025-26', 'Yes', 13, 850, 0.194, 0.175)], 1):
    D.update({'yr.label.%d' % i: lab, 'yr.cap.%d' % i: cap, 'yr.nnpa.%d' % i: nn, 'yr.adv.%d' % i: adv, 'yr.crar.%d' % i: cr, 'yr.t1.%d' % i: t1})
json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(D))
