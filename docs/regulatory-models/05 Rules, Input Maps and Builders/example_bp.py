"""Worked example for the Business Plan Projection Model – fictitious Middle Layer NBFC, amounts in ₹ crore, base date 31 March 2026.
project() restates the projection in Python, independently of the workbook, and is used by check_tier3.py.
Run: python3 example_bp.py <out.json>"""
import json, sys
NY = 5
BASE = {'bs.loans': 3200, 'bs.liq': 320, 'bs.oth': 180, 'bs.borr': 2900, 'bs.ol': 150, 'bs.nw': 650, 'cap.t1': 620, 'cap.t2': 60, 'cap.rwa': 3330,
        'pl.ii': 544, 'pl.li': 19, 'pl.oi': 32, 'pl.ie': 275, 'pl.ox': 160, 'pl.cc': 48, 'pl.tax': 28.2}
AS = {'g': [0.22, 0.20, 0.18, 0.16, 0.15], 'y': [0.170, 0.170, 0.168, 0.166, 0.165], 'oi': [0.010] * 5, 'ly': [0.06] * 5, 'c': [0.095, 0.094, 0.093, 0.092, 0.092], 'ox': [0.050, 0.049, 0.048, 0.047, 0.046],
      'cc': [0.015, 0.015, 0.016, 0.016, 0.016], 'liq': [0.10] * 5, 'oa': [0.05] * 5, 'ol': [0.04] * 5, 'rw': [None, None, 0.91, 0.91, 0.92], 'div': [0.10, 0.10, 0.15, 0.15, 0.15],
      'eq': [40, 0, 0, 100, 0], 't2': [20, 0, 15, 0, 25], 't2r': [0, 5, 5, 10, 10]}
DN = {'g': 0.5, 'y': -0.005, 'c': 0.01, 'cc': 2.0, 'ox': 0.0, 'eq': 0.0}
SET = {'mincrar': 0.15, 'mint1': 0.10, 'mbuf': 0.02, 'tax': 0.2517, 'maxlev': 7}


def project(down=False, B=BASE, A=AS, dn=DN, st=SET):
    ta0 = B['bs.loans'] + B['bs.liq'] + B['bs.oth']; dens = B['cap.rwa'] / ta0
    p = dict(loans=B['bs.loans'], liq=B['bs.liq'], oth=B['bs.oth'], ta=ta0, ol=B['bs.ol'], nw=B['bs.nw'], borr=B['bs.borr'], t1=B['cap.t1'], t2=B['cap.t2'], rwa=B['cap.rwa']); out = []
    for k in range(NY):
        a = {x: (A[x][k] or 0) for x in A}
        g = a['g'] * (dn['g'] if down else 1); y = a['y'] + (dn['y'] if down else 0); c = a['c'] + (dn['c'] if down else 0); ox = a['ox'] + (dn['ox'] if down else 0); cc = a['cc'] * (dn['cc'] if down else 1); eq = a['eq'] * (dn['eq'] if down else 1)
        n = {}; n['loans'] = p['loans'] * (1 + g); n['liq'] = a['liq'] * n['loans']; n['oth'] = p['oth'] * (1 + a['oa']); n['ta'] = n['loans'] + n['liq'] + n['oth']; n['ol'] = a['ol'] * n['ta']
        avl = (p['loans'] + n['loans']) / 2
        ii = y * avl; li = a['ly'] * (p['liq'] + n['liq']) / 2; oi = a['oi'] * avl; ie = c * (p['borr'] + 0.5 * ((n['ta'] - p['ta']) - (n['ol'] - p['ol']) - eq))
        pbt = ii + li + oi - ie - ox * avl - cc * avl; tax = max(0, pbt) * st['tax']; pat = pbt - tax; dv = max(0, pat) * a['div']; ret = pat - dv
        n['nw'] = p['nw'] + ret + eq; n['borr'] = n['ta'] - n['ol'] - n['nw']; n['t1'] = p['t1'] + ret + eq; n['t2'] = max(0, p['t2'] + a['t2'] - a['t2r']); t2c = min(n['t2'], max(0, n['t1']))
        n['rwa'] = (dens if A['rw'][k] is None else A['rw'][k]) * n['ta']
        n.update(pat=pat, ie=ie, eq=eq, rg=n['rwa'] / p['rwa'] - 1, t1r=n['t1'] / n['rwa'], crar=(n['t1'] + t2c) / n['rwa'], lev=(n['ta'] - n['nw']) / n['nw'], sur=n['t1'] + t2c - (st['mincrar'] + st['mbuf']) * n['rwa'],
                 ie2=c * (p['borr'] + n['borr']) / 2, div=0 if pat <= 0 else a['div'], t2net=a['t2'] - a['t2r'])
        n['rc'] = 'RED' if n['crar'] < st['mincrar'] else 'AMBER' if n['crar'] < st['mincrar'] + st['mbuf'] else 'GREEN'
        n['rt'] = 'RED' if n['t1r'] < st['mint1'] else 'AMBER' if n['t1r'] < st['mint1'] + st['mbuf'] else 'GREEN'
        out.append(n); p = n
    return out


def build():
    D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': '2026-03-31', 'setup.units': '₹ crore', 'setup.scen': 'Base'}
    D.update(BASE)
    for k, v in AS.items():
        for n, x in enumerate(v, 1):
            if x is not None: D['as.%s.%d' % (k, n)] = x
    for k, v in DN.items(): D['dn.%s' % k] = v
    return D


if __name__ == '__main__':
    D = build(); json.dump(D, open(sys.argv[1], 'w'), ensure_ascii=False); print(len(D), 'values')
