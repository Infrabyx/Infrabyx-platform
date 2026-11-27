"""Worked example for the applicability engine – fictitious Middle Layer NBFC."""
import json, sys
D = {'profile.name': 'Illustrative Finance Limited (fictitious example)', 'profile.date': '2026-03-31', 'profile.layer': 'Middle Layer', 'profile.assets': 2280, 'profile.ldebt': 'Yes', 'profile.indas': 'Yes', 'profile.br10': 'Yes', 'profile.csr': 'Yes', 'profile.div': 'Yes',
     'profile.dl': 'Yes', 'profile.dlg': 'Yes', 'profile.col': 'Yes', 'profile.ncd': 'Yes', 'profile.lt': 'Yes', 'profile.api': 'Yes', 'profile.pub': 'Yes'}
reg = json.load(open('data/applicability_register.json'))
for i, row in enumerate(reg['policies']):
    D['policy.inplace.%d' % int(row[0])] = ['Yes', 'Yes', 'Yes', 'Partly', 'Yes', 'No', 'Yes'][i % 7]
for row in reg['committees']: D['committee.inplace.%s' % row[0]] = 'Yes'
json.dump(D, open(sys.argv[1], 'w'), indent=0, ensure_ascii=False); print(len(D))
