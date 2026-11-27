"""Independent checks of the four Tier 3 models (SEC-M01, RBIA-M01, EWS-M01, BP-M01) against their worked examples.
The rules are restated in Python in the example scripts (test, assess, score / follow, project) and compared with the workbooks recalculated in LibreOffice.
Run from the models folder after the examples are built: python3 check_tier3.py [out folder]"""
import sys, json, datetime, os
import recalc, fill_model
import example_securitisation as ES, example_rbia as ER, example_ews as EE, example_bp as EB
O = (sys.argv[1] if len(sys.argv) > 1 else 'out').rstrip('/') + '/'
EX = ' Model – Worked Example (fictitious NBFC).xlsx'
NAME = {'sec': 'SEC-M01 Securitisation Retention', 'rbia': 'RBIA-M01 Audit Risk Assessment', 'ews': 'EWS-M01 Fraud Early Warning', 'bp': 'BP-M01 Business Plan'}     # short names: Excel refuses very long file paths
fails = []


def chk(name, cond, msg=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' – ' + str(msg) if msg != '' else ''))
    if not cond: fails.append(name)


def near(a, b, tol=1e-6): return a is not None and b is not None and abs(a - b) <= tol * max(1, abs(b))
def dte(x): return x.date() if isinstance(x, datetime.datetime) else x
def blank(x): return x in ('', None)
def col(ws, c, r0, n): return [ws['%s%d' % (c, r)].value for r in range(r0, r0 + n)]


def load(k):
    m, e = O + NAME[k] + ' Master Model.xlsx', O + NAME[k] + EX
    wbm, nm, em, _ = recalc.recalc(m); wb, n, errs, _ = recalc.recalc(e)
    chk('%s master: no formula errors' % k.upper(), not em, '%d formulas %s' % (nm, em[:2] or '')); chk('%s example: no formula errors' % k.upper(), not errs, '%d formulas %s' % (n, errs[:2] or ''))
    nck = sum(1 for r in range(6, 30) if wb['Checks']['C%d' % r].value in ('OK', 'CHECK'))
    chk('%s master: Checks sheet is blank-safe' % k.upper(), all(wbm['Checks']['C%d' % r].value in ('OK', 'CHECK') for r in range(6, 6 + nck)), '%d checks' % nck)
    chk('%s example: Checks sheet clear' % k.upper(), all(wb['Checks']['C%d' % r].value == 'OK' for r in range(6, 6 + nck)), [wb['Checks']['C%d' % r].value for r in range(6, 6 + nck)])
    return wbm, wb, json.load(open(O + k + '_example.json')), m


def variant(k, master, data, tag):
    p = O + '_tmp_%s_%s.xlsx' % (k, tag); fill_model.fill(master, O + k + '_map.json', data, p); wb, n, errs, _ = recalc.recalc(p); os.remove(p)
    chk('%s variant "%s": no formula errors' % (k.upper(), tag), not errs, errs[:2] or ''); return wb


# ---------------------------------------------------------------- SEC-M01
wbm, wb, D, M = load('sec'); pt, rt, db = wb['Pool Test'], wb['Retention'], wb['Dashboard']; P = D['pool']; R = [ES.test(r) for r in P]
chk('SEC master: empty pool shows no result', blank(wbm['Dashboard']['C16'].value) and blank(wbm['Retention']['B22'].value) and wbm['Dashboard']['B5'].value == 0)
ok = all(pt['C%d' % (7 + i)].value == t['el'] and pt['D%d' % (7 + i)].value == ('Yes' if t['ok'] else 'No') for i, t in enumerate(R)); chk('SEC eligibility of every loan', ok, '%d loans, %d not eligible' % (len(P), sum(not t['ok'] for t in R)))
ok = all(dte(pt['F%d' % (7 + i)].value) == t['start'] or (t['start'] is None and blank(pt['F%d' % (7 + i)].value)) for i, t in enumerate(R)); chk('SEC start date of the holding period of every loan', ok)
ok = all((dte(pt['H%d' % (7 + i)].value) == t['end'] or (t['end'] is None and blank(pt['H%d' % (7 + i)].value))) and pt['I%d' % (7 + i)].value == t['mhp'] and (pt['J%d' % (7 + i)].value == t['short'] or (t['short'] is None and blank(pt['J%d' % (7 + i)].value))) for i, t in enumerate(R))
chk('SEC end of the holding period, status and days short of every loan', ok, '%d not complete, %d not applicable' % (sum(t['mhp'] == 'RED' for t in R), sum(t['mhp'] == 'Not applicable' for t in R)))
ok = all((near(pt['K%d' % (7 + i)].value, t['rate']) and near(pt['L%d' % (7 + i)].value, t['req'])) if t['ok'] else blank(pt['K%d' % (7 + i)].value) for i, t in enumerate(R)); chk('SEC retention rate and amount of every eligible loan', ok)
elig = sum(r[2] for r, t in zip(P, R) if t['ok']); req = sum(t['req'] for t in R if t['ok']); cnt = D['ret.flf'] + D['ret.eq'] + D['ret.other']
chk('SEC requirement and retention counted', near(rt['B5'].value, elig) and near(rt['B8'].value, req) and near(rt['B18'].value, cnt) and near(rt['B19'].value, cnt - req), 'eligible %.0f, required %.0f, counted %.0f' % (elig, req, cnt))
chk('SEC interest-only strip is not counted', D['ret.io'] > 0 and near(rt['B18'].value, cnt))
chk('SEC amount and form tests', rt['B22'].value == 'GREEN' and rt['B23'].value == 'GREEN' and all(rt['C%d' % r].value == 'GREEN' for r in range(24, 28)))
chk('SEC dashboard counts', db['B5'].value == len(P) and db['B7'].value == sum(not t['ok'] for t in R) and db['B9'].value == sum(t['ok'] and t['mhp'] == 'RED' for t in R) and db['B11'].value == max(t['short'] or 0 for t in R) and db['C16'].value == 'RED',
    'not eligible %s, holding period not complete %s, longest wait %s days, pool %s' % (db['B7'].value, db['B9'].value, db['B11'].value, db['C16'].value))
i64 = [r[0] for r in P].index('L0064'); chk('SEC month-end case: 31 August plus three months ends on 30 November and is complete on that day', dte(pt['H%d' % (7 + i64)].value) == datetime.date(2026, 11, 30) and pt['I%d' % (7 + i64)].value == 'GREEN')
V = dict(D); V['setup.basis'] = 'Higher rate on the whole pool'; w = variant('sec', M, V, 'whole pool'); mx = max(t['rate'] for t in R if t['ok'])
chk('SEC variant: higher rate on the whole pool', near(w['Retention']['B8'].value, elig * mx) and w['Retention']['B22'].value == ('GREEN' if cnt >= elig * mx else 'RED'), 'required %.0f at %.0f%%, amount test %s' % (elig * mx, mx * 100, w['Retention']['B22'].value))
V = dict(D); V['setup.rmbs'] = 'Yes'; w = variant('sec', M, V, 'rmbs'); chk('SEC variant: residential mortgage backed securities at 5% whatever the maturity', near(w['Retention']['B8'].value, elig * 0.05))
V = dict(D); V['pool'] = [list(r) for r in P]; V['pool'][0][16] = None; V['pool'][0][15] = 'Yes'; V['pool'][0][13] = 'No'; w = variant('sec', M, V, 'missing date')
chk('SEC variant: a missing registration date is reported, not assumed', w['Pool Test']['I7'].value == 'CHECK' and w['Checks']['C9'].value == 'CHECK' and w['Dashboard']['C10'].value == 'AMBER')
V = dict(D); V['ret.flf'] = 0; V['ret.flfall'] = 'No'; V['ret.eq'] = 0; V['ret.eqall'] = 'No'; V['ret.other'] = cnt; w = variant('sec', M, V, 'wrong form')
chk('SEC variant: retention held only in senior tranches fails the form test though the amount is enough', w['Retention']['B22'].value == 'GREEN' and w['Retention']['B23'].value == 'RED')

# ---------------------------------------------------------------- RBIA-M01
wbm, wb, D, M = load('rbia'); ra, ap, db = wb['Risk Assessment'], wb['Audit Plan'], wb['Dashboard']; U = D['units']; R = [ER.assess(u) for u in U]; n = len(U)
chk('RBIA master: empty workbook shows no result', all(blank(wbm['Dashboard']['C%d' % r].value) for r in (30, 31, 32)) and wbm['Dashboard']['B17'].value == 0)
ok = all(near(ra['D%d' % (7 + i)].value, t['si']) and near(ra['H%d' % (7 + i)].value, t['sc']) and ra['E%d' % (7 + i)].value == t['li'] and ra['I%d' % (7 + i)].value == t['lc'] for i, t in enumerate(R)); chk('RBIA inherent and control scores and levels of every unit', ok, '%d units' % n)
ok = all((ra['F%d' % (7 + i)].value == t['months'] or (t['months'] is None and blank(ra['F%d' % (7 + i)].value))) and ra['G%d' % (7 + i)].value == t['ts'] for i, t in enumerate(R)); chk('RBIA months since the last audit and time score', ok)
ok = all(ra['K%d' % (7 + i)].value == t['ov'] and ra['L%d' % (7 + i)].value == t['pri'] for i, t in enumerate(R)); chk('RBIA overall risk and priority of every unit', ok, {x: sum(t['ov'] == x for t in R) for x in ER.FREQ})
ok = all(ap['E%d' % (7 + i)].value == t['freq'] and dte(ap['G%d' % (7 + i)].value) == t['due'] and ap['H%d' % (7 + i)].value == ('Yes' if t['inplan'] else 'No') and (ap['I%d' % (7 + i)].value or None) == t['qtr']
         and ((ap['J%d' % (7 + i)].value if not blank(ap['J%d' % (7 + i)].value) else None) == t['days']) and ap['K%d' % (7 + i)].value == ('Yes' if t['overdue'] else 'No')
         and ((ap['L%d' % (7 + i)].value if not blank(ap['L%d' % (7 + i)].value) else None) == t['audits']) and (ap['M%d' % (7 + i)].value or None) == t['q2'] and ((ap['N%d' % (7 + i)].value if not blank(ap['N%d' % (7 + i)].value) else None) == t['ydays']) for i, t in enumerate(R))
chk('RBIA frequency, due date, plan, quarter, auditor-days, overdue flag and second audit of every unit', ok, '%d units in the plan, %d with two audits, %d overdue' % (sum(t['inplan'] for t in R), sum(t['audits'] == 2 for t in R), sum(t['overdue'] for t in R)))
need = sum(t['ydays'] or 0 for t in R); chk('RBIA auditor-days needed and capacity', db['B27'].value == need and db['B28'].value == ER.STAFF * ER.PER and near(db['B30'].value, need / (ER.STAFF * ER.PER)), 'needed %d of %d (%.0f%%), status %s' % (need, ER.STAFF * ER.PER, 100 * need / (ER.STAFF * ER.PER), db['C30'].value))
chk('RBIA risk matrix on the dashboard', all(db['%s%d' % ('BCD'[j], 6 + i)].value == sum(t['li'] == a and t['lc'] == c for t in R) for i, a in enumerate(('High', 'Medium', 'Low')) for j, c in enumerate(('High', 'Medium', 'Low'))) and db['B17'].value == n)
chk('RBIA plan by quarter', all(db['B%d' % (20 + k)].value == sum((t['qtr'] == 'Q%d' % k) + (t['q2'] == 'Q%d' % k) for t in R) and db['C%d' % (20 + k)].value == sum(t['days'] * ((t['qtr'] == 'Q%d' % k) + (t['q2'] == 'Q%d' % k)) for t in R if t['inplan']) for k in range(1, 5)), [db['B%d' % (20 + k)].value for k in range(1, 5)])
hi = [i for i, t in enumerate(R) if t['ov'] in ('Extremely high', 'Very high')]; chk('RBIA every unit of Extremely high or Very high risk is in the plan', all(R[i]['inplan'] for i in hi) and db['B31'].value == 0, '%d such units' % len(hi))
never = [i for i, u in enumerate(U) if not u[13]]; chk('RBIA a unit never audited takes the highest time score and is due on the first day', len(never) >= 2 and all(R[i]['ts'] == 5 and dte(ap['G%d' % (7 + i)].value) == ER.START for i in never), '%d units' % len(never))
top = db['A36'].value; best = min(range(n), key=lambda i: (R[i]['pri'], -R[i]['si'] * R[i]['sc'], i)); chk('RBIA first unit in the priority list', top == U[best][1], top)
iy = [i for i, u in enumerate(U) if u[16] == 'Yes']; chk('RBIA a unit marked for audit is in the plan whatever its due date', all(ap['H%d' % (7 + i)].value == 'Yes' for i in iy), [U[i][1] for i in iy])

# ---------------------------------------------------------------- EWS-M01
wbm, wb, D, M = load('ews'); sc, iv, db = wb['Scoring'], wb['Indicator Review'], wb['Dashboard']; A = D['acc']; R = [EE.follow(a) for a in A]; n = len(A)
chk('EWS master: empty workbook shows no result', wbm['Dashboard']['B9'].value == 0 and all(blank(wbm['Dashboard']['C%d' % r].value) for r in (22, 23, 24, 27)))
lib = [wbm['Indicators Input']['E%d' % (7 + j)].value for j in range(30)]; crit = [j + 1 for j in range(30) if wbm['Indicators Input']['F%d' % (7 + j)].value == 'Yes']; fam = [wbm['Indicators Input']['C%d' % (7 + j)].value for j in range(30)]
chk('EWS library in the workbook is the library restated in the example script', lib == EE.W and crit == EE.CRIT and [sorted(set(fam), key=fam.index).index(f) for f in fam] == EE.FAMILY, '30 indicators, %d critical, 4 families' % len(crit))
ok = all(sc['D%d' % (7 + i)].value == t['n'] and sc['E%d' % (7 + i)].value == t['crit'] and sc['F%d' % (7 + i)].value == t['fam'] and sc['G%d' % (7 + i)].value == t['score'] and sc['H%d' % (7 + i)].value == t['alert'] for i, t in enumerate(R))
chk('EWS indicators present, families, score and alert of every account', ok, {x: sum(t['alert'] == x for t in R) for x in ('RED', 'AMBER', 'GREEN')})
ok = all((sc['I%d' % (7 + i)].value or '') == t['status'] and (sc['J%d' % (7 + i)].value if not blank(sc['J%d' % (7 + i)].value) else None) == t['days'] and (sc['K%d' % (7 + i)].value or '') == t['exam'] for i, t in enumerate(R)); chk('EWS status, days open and ageing of every examination', ok)
ok = all((dte(sc['L%d' % (7 + i)].value) if not blank(sc['L%d' % (7 + i)].value) else None) == t['due'] and (sc['M%d' % (7 + i)].value or '') == t['ret'] and (sc['N%d' % (7 + i)].value or '') == t['caught'] for i, t in enumerate(R))
chk('EWS due date and status of each Fraud Monitoring Return; capture of confirmed cases', ok, [t['ret'] for t in R if t['ret']])
conf = [t for t in R if t['status'] in EE.CONF]; closed0 = sum(t['status'] == 'Closed – no fraud angle' for t in R)
chk('EWS capture rate and false alert rate', db['B26'].value == len(conf) and near(db['B27'].value, sum(t['caught'] == 'Yes' for t in conf) / len(conf)) and near(db['B28'].value, closed0 / (closed0 + len(conf))),
    'capture %.0f%% (%s), false alerts %.0f%%' % (100 * db['B27'].value, db['C27'].value, 100 * db['B28'].value))
chk('EWS dashboard: open examinations beyond the days allowed and late returns', db['B22'].value == sum(t['exam'] == 'RED' for t in R) and db['B24'].value == sum(t['ret'] == 'RED' for t in R) and db['B25'].value == sum(t['ret'] == 'AMBER' for t in R), 'overdue %s, returns late %s' % (db['B22'].value, db['B24'].value))
ok = all(iv['E%d' % (7 + j)].value == sum(a[4 + j] == 'Yes' for a in A) and iv['G%d' % (7 + j)].value == sum(a[4 + j] == 'Yes' and t['status'] in EE.CONF for a, t in zip(A, R)) for j in range(30)); chk('EWS indicator review: accounts flagged and confirmed for each indicator', ok)
miss = [r for r in range(7, 7 + n) if sc['N%d' % r].value == 'No']; chk('EWS the confirmed case with no indicator is shown as a miss', len(miss) == 1 and sc['A%d' % miss[0]].value == 'A0012')
try:
    import openpyxl; p = O + '_tmp_ews_off.xlsx'; fill_model.fill(M, O + 'ews_map.json', D, p); x = openpyxl.load_workbook(p); x['Indicators Input']['G8'].value = 'No'; x.save(p); w, _, errs, _ = recalc.recalc(p); os.remove(p)
    j7 = [a[0] for a in A].index('A0074'); chk('EWS variant: an indicator switched off drops out of the score', w['Scoring']['G%d' % (7 + j7)].value == R[j7]['score'] - 10 and w['Indicator Review']['I8'].value == 'Switched off', 'account A0074 %s to %s' % (R[j7]['score'], w['Scoring']['G%d' % (7 + j7)].value))
except Exception as e: chk('EWS variant: an indicator switched off drops out of the score', False, e)

# ---------------------------------------------------------------- BP-M01
wbm, wb, D, M = load('bp')
RW = dict(eq=12, loans=15, ta=18, ol=19, nw=20, borr=21, ie=28, pat=34, t1=39, t2=40, rwa=42, rg=43, t1r=44, crar=45, lev=46, sur=47, ie2=54, rc=58, rt=59)     # rows of the Projection sheets
lab = {r: wb['Projection Base']['A%d' % r].value for r in RW.values()}
chk('BP row map of this script matches the workbook', lab[34] == 'Profit after tax' and lab[45] == 'CRAR' and lab[21].startswith('Borrowings') and lab[54].startswith('Interest expense on the simple average') and lab[58] == 'CRAR')
def proj(ws, k): return [ws['%s%d' % (c, RW[k])].value for c in 'CDEFG']
chk('BP master: empty workbook shows no result', all(blank(wbm['Projection Base']['C%d' % RW[k]].value) for k in ('loans', 'pat', 'crar', 'rc')) and blank(wbm['Handover']['C6'].value))
for name, down in (('Projection Base', False), ('Projection Downside', True)):
    ws = wb[name]; T = EB.project(down)
    for k in ('loans', 'ta', 'nw', 'borr', 'ie', 'pat', 't1', 't2', 'rwa', 'rg', 't1r', 'crar', 'lev', 'sur', 'ie2'):
        chk('BP %s: %s for five years' % (name, k), all(near(a, t[k], 1e-9) for a, t in zip(proj(ws, k), T)), ', '.join('%.4f' % a if abs(a) < 5 else '%.1f' % a for a in proj(ws, k)))
    chk('BP %s: balance sheet balances every year' % name, all(near(ws['%s%d' % (c, RW['ta'])].value, ws['%s%d' % (c, RW['ol'])].value + ws['%s%d' % (c, RW['nw'])].value + ws['%s%d' % (c, RW['borr'])].value, 1e-9) for c in 'CDEFG'))
    chk('BP %s: CRAR and Tier 1 status' % name, proj(ws, 'rc') == [t['rc'] for t in T] and proj(ws, 'rt') == [t['rt'] for t in T], proj(ws, 'rc'))
    chk('BP %s: interest expense within 5%% of the figure on average borrowings' % name, all(abs(t['ie'] - t['ie2']) <= 0.05 * t['ie2'] for t in T), 'largest gap %.2f%%' % max(100 * abs(t['ie'] - t['ie2']) / t['ie2'] for t in T))
TB, TD = EB.project(False), EB.project(True); db = wb['Dashboard']
chk('BP downside is worse than base and shows where capital runs short', sum(t['pat'] for t in TD) < sum(t['pat'] for t in TB) and min(t['crar'] for t in TD) < min(t['crar'] for t in TB), 'lowest CRAR base %.2f%%, downside %.2f%%' % (100 * min(t['crar'] for t in TB), 100 * min(t['crar'] for t in TD)))
ho = wb['Handover']; H = {ho['D%d' % r].value: ho['C%d' % r].value for r in range(6, 21)}
exp = {}
for k in range(3): exp.update({'plan.g.%d' % (k + 1): TB[k]['rg'], 'plan.pat.%d' % (k + 1): TB[k]['pat'], 'plan.div.%d' % (k + 1): TB[k]['div'], 'plan.eq.%d' % (k + 1): TB[k]['eq'], 'plan.t2.%d' % (k + 1): TB[k]['t2net']})
chk('BP Handover: fifteen values under the ICAAP keys', set(H) == set(exp) and all(near(H[k], v, 1e-9) for k, v in exp.items()), 'PAT %s' % ', '.join('%.1f' % H['plan.pat.%d' % k] for k in (1, 2, 3)))
V = dict(D); V['setup.scen'] = 'Downside'; w = variant('bp', M, V, 'downside handed over'); chk('BP variant: the downside scenario is handed over when chosen', near(w['Handover']['C7'].value, TD[0]['pat'], 1e-9) and w['Handover']['C4'].value == 'Downside')
icm = O + 'ICAAP-M01 ICAAP Master Model.xlsx'
if not os.path.exists(icm):
    c = [f for f in os.listdir(O) if f.startswith('ICAAP-M01') and 'Master' in f]; icm = O + c[0] if c else None
if icm and os.path.exists(O + 'icaap_map.json'):
    p = O + '_tmp_icaap_from_bp.xlsx'; done, unknown = fill_model.fill(icm, O + 'icaap_map.json', H, p); w, n, errs, _ = recalc.recalc(p); os.remove(p); cp = w['Capital Plan']
    chk('BP to ICAAP: the fifteen values are accepted by the ICAAP model', done == 15 and not unknown and not errs and near(cp['C9'].value, TB[0]['pat'], 1e-9) and near(cp['E7'].value, TB[2]['rg'], 1e-9), 'written %d, unknown %s' % (done, unknown))
else: chk('BP to ICAAP: the fifteen values are accepted by the ICAAP model', False, 'ICAAP master not found in ' + O)

print('\n%d checks failed: %s' % (len(fails), fails) if fails else '\nAll Tier 3 checks passed')
sys.exit(1 if fails else 0)
