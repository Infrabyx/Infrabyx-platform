"""Worked example for the pricing calculator – fictitious NBFC."""
import json, sys
D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'loan.product': 'Personal loan – salaried', 'loan.amount': 100000, 'loan.rate': 0.18, 'loan.ratetype': 'Fixed', 'loan.freq': 'Monthly', 'loan.n': 24, 'loan.date': '2026-04-05',
     'loan.digital': 'Yes', 'loan.cool': 3, 'fee.proc': 2000, 'fee.gst': 360, 'fee.ins': 1200, 'kfs.account': 'PL-000123', 'kfs.disbursal': '100 per cent upfront', 'kfs.floating': 'Not applicable',
     'kfs.penal': '24 per cent per annum on the overdue amount', 'kfs.otherpenal': 'Nil', 'kfs.foreclosure': 'Nil', 'kfs.switch': 'Not applicable', 'kfs.othercharge': 'Cheque or mandate return: ₹500 per instance',
     'kfs.recovery': 'Clause 14', 'kfs.grievance': 'Clause 18', 'kfs.nodal': 'Nodal officer – 1800 000 000; grievance@illustrative.example', 'kfs.transfer': 'Yes', 'kfs.colending': 'Not applicable', 'kfs.lsp': 'Not applicable',
     'cool.day': 2, 'cool.retain': 'Yes', 'pen.amount': 4992.41, 'pen.days': 20, 'pen.rate': 0.24}
json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(D))
