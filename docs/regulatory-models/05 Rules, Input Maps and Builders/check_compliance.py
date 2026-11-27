"""Independent checks of the Compliance Testing Model against its worked example.
The rules are re-stated in Python (example_compliance.plan / sample and the code below) and compared with the recalculated workbook.
Run from the models folder after the example is built: python3 check_compliance.py [out folder]"""
import sys, json, datetime
import recalc, fill_model
import example_compliance as E
O = (sys.argv[1] if len(sys.argv) > 1 else 'out').rstrip('/') + '/'
MASTER, EX = O + 'CMP-M01 Compliance Testing Master Model.xlsx', O + 'CMP-M01 Compliance Testing Model – Worked Example (fictitious NBFC).xlsx'
fails = []


def chk(name, cond, msg=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' – ' + msg if msg else ''))
    if not cond: fails.append(name)


D = json.load(open(O + 'cmp_example.json')); TH = E.TH
wbm, nm, em, _ = recalc.recalc(MASTER); wb, n, errs, _ = recalc.recalc(EX)
chk('Master: no formula errors', not em, '%d formulas' % nm); chk('Example: no formula errors', not errs, '%d formulas %s' % (n, errs[:2]))
chk('Master: all checks blank-safe', all(wbm['Checks']['C%d' % r].value in ('OK', 'CHECK') for r in range(6, 21)) and wbm['Board Report']['C11'].value in ('', None), 'empty workbook shows no result')
chk('Example: Checks sheet clear', all(wb['Checks']['C%d' % r].value == 'OK' for r in range(6, 21)), str([wb['Checks']['C%d' % r].value for r in range(6, 21)]))
P = E.plan(D['universe']); ids = [u[0] for u in D['universe']]; row = {u: 7 + i for i, u in enumerate(ids)}
ra, pl, tr, ia, br, md = wb['Risk Assessment'], wb['Annual Plan'], wb['Test Results'], wb['Issue Ageing'], wb['Board Report'], wb['Management Dashboard']
ok = all(abs(ra['I%d' % row[k]].value - v['residual']) < 1e-9 and ra['J%d' % row[k]].value == v['band'] and ra['F%d' % row[k]].value == v['iband'] for k, v in P.items())
chk('Risk assessment: inherent and residual score and band of every obligation', ok, '%d obligations' % len(P))
chk('Not-applicable obligation left out', ra['E%d' % row['CON-02']].value in ('', None) and pl['A%d' % row['CON-02']].value in ('', None))
ok = all(pl['G%d' % row[k]].value == v['n'] and [q for q, c in zip((1, 2, 3, 4), 'HIJK') if pl['%s%d' % (c, row[k])].value == 1] == v['quarters'] for k, v in P.items())
chk('Annual plan: tests required and quarters of every obligation', ok, 'total %s' % pl['G4'].value)
for j, b in enumerate(('Critical', 'High', 'Medium', 'Low')):
    chk('Board report: %s band counts' % b, br['B%d' % (15 + j)].value == sum(v['iband'] == b for v in P.values()) and br['C%d' % (15 + j)].value == sum(v['band'] == b for v in P.values()), 'inherent %s residual %s' % (br['B%d' % (15 + j)].value, br['C%d' % (15 + j)].value))
heat = sum(br['%s%d' % (c, r)].value for c in 'BCDE' for r in range(23, 27)); chk('Heat map adds up to the obligations assessed', heat == len(P), str(heat))
# tests
date = lambda s: datetime.date.fromisoformat(s) if s else None
REP = date(D['setup.date']); res = {}; tot = dict(RED=0, AMBER=0, GREEN=0); okS = okR = True; overdue = 0
for i, t in enumerate(D['tests']):
    r = 7 + i; b = P[t[1]]['band']; s = E.sample(t[5], b, t[3]); okS &= tr['I%d' % r].value == s
    if t[9] == 'Completed':
        rate = t[12] / t[11]; rag = 'RED' if (t[13] or 0) > 0 or rate > TH['red'] else 'AMBER' if rate > TH['amber'] else 'GREEN'; tot[rag] += 1; res[t[0]] = rag; okR &= tr['N%d' % r].value == rag
    elif t[9] != 'Deferred' and date(t[6]) < REP: overdue += 1
chk('Sample recommended for every test', okS, '%d tests' % len(D['tests'])); chk('Result of every completed test', okR, str(tot))
chk('Dashboard: Red / Amber / Green and overdue tests', (md['B16'].value, md['B17'].value, md['B18'].value, md['B15'].value) == (tot['RED'], tot['AMBER'], tot['GREEN'], overdue), str((md['B16'].value, md['B17'].value, md['B18'].value, md['B15'].value)))
due = sum(sum(1 for q in v['quarters'] if q <= 2) for v in P.values()); done = sum(1 for t in D['tests'] if t[9] == 'Completed' and t[4] in ('Q1', 'Q2'))
chk('Progress of the plan', md['B12'].value == due and md['B13'].value == done and abs(md['B14'].value - done / due) < 1e-9, '%d of %d due' % (done, due))
prog = {k: sum(1 for t in D['tests'] if t[1] == k and t[9] != 'Deferred') for k in P}
chk('Coverage gaps shown', pl['N%d' % row['KYC-03']].value == 'RED' and pl['N%d' % row['RBC-05']].value == 'AMBER' and br['B80'].value == sum(1 for k, v in P.items() if prog[k] == 0 and v['n']) and br['B81'].value == sum(1 for k, v in P.items() if 0 < prog[k] < v['n']), 'none %s, fewer %s' % (br['B80'].value, br['B81'].value))
# issues
days = {'High': 30, 'Medium': 60, 'Low': 90}; okI = True; tab = {s: [0, 0, 0, 0, 0, 0] for s in days}
for i, x in enumerate(D['issues']):
    r = 7 + i; raised = date(x[8]); duei = date(x[10]) or date(x[9]) or raised + datetime.timedelta(days=days[x[6]])
    if x[12] == 'Open':
        od = max(0, (REP - duei).days); age = (REP - raised).days; pos = ('RED' if x[6] == 'High' or od > 30 else 'AMBER') if od > 0 else ('AMBER' if (duei - REP).days <= 7 else 'GREEN')
        tab[x[6]][0 if age <= 30 else 1 if age <= 90 else 2 if age <= 180 else 3] += 1; tab[x[6]][4] += 1; tab[x[6]][5] += od > 0
    else:
        od = max(0, (date(x[13]) - duei).days); pos = 'Closed' if x[14] == 'Yes' else 'AMBER'
    okI &= ia['I%d' % r].value == od and ia['K%d' % r].value == pos
chk('Issue ageing: days overdue and position of every issue', okI, '%d issues' % len(D['issues']))
chk('Board report: issue ageing table', all([br['%s%d' % (c, 45 + j)].value for c in 'BCDEFG'] == tab[s] for j, s in enumerate(('High', 'Medium', 'Low'))), str(tab))
top = max(P.items(), key=lambda kv: kv[1]['residual'] + (10000 - row[kv[0]]) / 1e6)[0]; chk('Highest residual risk listed first', str(br['A52'].value).startswith(top + ' '), str(br['A52'].value)[:30])
exp = 'RED' if (sum(1 for t in D['tests'] if res.get(t[0]) == 'RED' and P[t[1]]['band'] in ('Critical', 'High')) or tab['High'][5]) else None
chk('Overall status', br['C11'].value in ('RED', 'AMBER', 'GREEN') and (exp is None or br['C11'].value == exp), str(br['C11'].value))
np_ = wb['New Products']; chk('New products: reviews due and status', [np_['H%d' % r].value for r in range(7, 11)] == [4, 2, 6, 1] and [np_['J%d' % r].value for r in range(7, 11)] == ['GREEN', 'AMBER', 'GREEN', 'RED'], str([np_['J%d' % r].value for r in range(7, 11)]))
# variant: quarterly testing for Medium risk raises the plan
V = dict(D); V['th.freq.m'] = 4; out = O + 'cmp variant.xlsx'; fill_model.fill(MASTER, O + 'cmp_map.json', V, out); wv, _, ev, _ = recalc.recalc(out)
chk('Variant: Medium tested every quarter', not ev and wv['Annual Plan']['G4'].value == sum(4 if v['band'] == 'Medium' else v['n'] for v in P.values()), str(wv['Annual Plan']['G4'].value))
print('\nFAILURES:', len(fails), fails)
sys.exit(1 if fails else 0)
