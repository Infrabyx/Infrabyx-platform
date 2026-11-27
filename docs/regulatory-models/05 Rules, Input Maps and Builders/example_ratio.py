"""Worked example for the ratio model – fictitious Middle Layer NBFC, amounts in ₹ crore. Figures are invented."""
import json, sys
D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': '2026-03-31', 'setup.units': '₹ crore', 'setup.layer': 'Middle Layer', 'setup.pca': 'Yes', 'setup.basis': 'Ind AS'}
cur = dict(eq=100, res=310, nw=410, borr=1790, bank=1150, cp=70, sub=0, b3=310, b12=680, osl=1880, ta=2280, intang=20, fa=2190, loans=2000, sec=1510, unsec=490, inv=80, cash=150, liq=150, avgta=2105, avgloan=1845, avgborr=1650,
           inc=390, finc=384, ii=360, fee=30, ie=145, opex=105, prov=30, pat=82.3, divd=8, excp=0, of=380, nof=380, t1=380, t2=25, rwa=2154.5, std=1952.8, gnpa=47.2, npaprov=24.9, stdprov=7.9, restr=12, slip=41, wo=6, sma2=18, dpd30=98,
           s2=51.8, s3=47.2, ecl=61.0, nn1=0.0119, nn2=0.0129, hqla=0, nco=0, in1=27, out1=29, in2=30, out2=32, in3=58, out3=69, single=38, group=61, top20=357, ipo=0, cme=20, cre=45, grpx=15, gold=0, mfi=0, infra=0, land=0, dlg=4.6, dlgp=110)
prev = dict(cur); prev.update(eq=100, res=236, nw=336, borr=1510, ta=1930, loans=1690, osl=1590, inc=329, finc=324, ii=305, fee=24, ie=122, opex=92, prov=27, pat=64.3, t1=312, t2=21, rwa=1810, of=312, nof=312, gnpa=41, npaprov=21, std=1649, single=30, group=52,
                        in1=24, out1=26, in2=25, out2=27, in3=52, out3=58, fa=1850, sec=1290, unsec=400, top20=310, stdprov=6.6, avgta=1775, avgloan=1545, avgborr=1390, bank=980, b3=250, b12=560, dlg=3.1, dlgp=70, s3=41, s2=44, ecl=52)
for k, v in cur.items(): D['data.%s.cur' % k] = v
for k, v in prev.items(): D['data.%s.prev' % k] = v; D['data.%s.ly' % k] = v
D['rule.type.A01'] = 'Maximum'; D['rule.limit.A01'] = 0.03; D['rule.trigger.A01'] = 0.02; D['rule.type.E06'] = 'Maximum'; D['rule.limit.E06'] = 0.30; D['rule.trigger.E06'] = 0.22
json.dump(D, open(sys.argv[1], 'w'), indent=0, ensure_ascii=False); print(len(D), 'values')
