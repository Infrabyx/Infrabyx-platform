"""Test of read_dnbs_more.py on the blank RBI formats. No filled DNBS01 / DNBS03 / DNBS04 file was available, so the test fills a copy of each
blank format with a different number in every input cell, lets LibreOffice calculate the RBI formulas, and checks that the reader brings back
the right numbers. This proves the label matching and the arithmetic; it does not prove that a file filled and exported by a company through
the RBI utility has the same layout.  Run from the models folder: python3 test_read_dnbs.py"""
import os, sys, glob, re, subprocess, tempfile, shutil
from openpyxl import load_workbook
import read_dnbs_more as R, read_dnbs as OLD
FMT = os.path.expanduser('~/mnt/Policies Framework/NBFC Policies/Supervisory Returns/RBI Formats/')
TMP = tempfile.mkdtemp(); fails = []
# optional: python3 test_read_dnbs.py --real <return from the RBI utility> <same return downloaded from the portal>  compares the two layouts item by item
REAL = sys.argv[sys.argv.index('--real') + 1:sys.argv.index('--real') + 3] if '--real' in sys.argv else None


def chk(name, cond, msg=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' – ' + str(msg) if msg != '' else ''))
    if not cond: fails.append(name)


def synthetic(code):
    """Copy of the blank format with a number in every empty cell of every data line; returns (path of the calculated file, numbers put in)."""
    src = glob.glob(FMT + code + ' *.xlsx')[0]; wb = load_workbook(src); put = {}; n = 100; nlines = 0
    for ws in wb.worksheets:
        if not ws.title.upper().startswith('DNBS'): continue
        xcols = []
        for row in ws.iter_rows():
            xs = [c.column for c in row if isinstance(c.value, str) and R.XC.match(c.value.strip())]
            if xs: xcols = xs; continue
            if xcols and any(isinstance(c.value, str) and R.YC.match(c.value.strip()) for c in row):
                nlines += 1
                for i in xcols:
                    c = row[i - 1]
                    if c.value is None:
                        n += 7; c.value = n; put[(ws.title, c.row, i)] = n
    raw = os.path.join(TMP, code + '.xlsx'); wb.save(raw); out = os.path.join(TMP, 'calc'); os.makedirs(out, exist_ok=True)
    subprocess.run(['soffice', '--headless', '--calc', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', out, raw], capture_output=True, timeout=600)
    return os.path.join(out, code + '.xlsx'), put, nlines


def close(a, b): return a is not None and b is not None and abs(a - b) <= 1e-6 * max(1, abs(a), abs(b))


if REAL:
    a, ma, _ = R.extract_ratio(REAL[0]); b, mb, _ = R.extract_ratio(REAL[1]); fa_, fb_ = R.scale(R.meta(REAL[0])), R.scale(R.meta(REAL[1])); same = [k for k in a if k in b and abs(a[k] * fa_ - b[k] * fb_) <= max(0.5 * max(fa_, fb_) / 100, 1e-6 * abs(b[k] * fb_))]; diff = [k for k in a if k not in same]
    print('utility layout: %d items, not found %s | portal layout: %d items, not found %s | equal %d | differ %s' % (len(a), ma, len(b), mb, len(same), diff)); sys.exit(1 if diff or ma or mb else 0)
S = {}
for code in ('DNBS01', 'DNBS03', 'DNBS04A', 'DNBS04B', 'DNBS02'):
    S[code] = synthetic(code); path, put, nlines = S[code]; ls = R.lines(path)
    chk(code + ': return recognised and every data line read', R.form(path) == code and len(ls) == nlines, '%d lines, %d input cells filled' % (len(ls), len(put)))
    bad = [(l['sheet'], l['row'], x) for l in ls for x, i in l['cols'].items() if (l['sheet'], l['row'], i) in put and l['vals'].get(x) != put[(l['sheet'], l['row'], i)]]
    chk(code + ': every input number comes back on its own line and column', not bad, bad[:3])

# ---- DNBS01 and DNBS03: items of the ratio model
for code, mp in (('DNBS01', R.MAP01), ('DNBS03', R.MAP03)):
    path, put, _ = S[code]; ls = R.lines(path); d, miss, ref = R.extract_ratio(path)
    chk(code + ': every mapped item found', not miss, miss)
    ok = True; direct = 0
    for k, (part, rx, tb, col) in mp.items():
        l = R.find(ls, part, rx, tb); hits = [x for x in ls if x['part'] == part and re.search(rx, x['label'], re.I) and (tb is None or re.search(tb, x['table'], re.I))]
        if l is None: ok = False; continue
        x = R._order(l)[0] if col is None else [c for c in R._order(l) if re.search(col, l['heads'].get(c, ''), re.I)][0]
        key = (l['sheet'], l['row'], l['cols'][x])
        if key in put: direct += 1; ok &= d[k] == put[key]
    chk(code + ': items typed by the company equal the numbers put in', ok, '%d direct items; the others are RBI formula cells' % direct)
d, _, _ = R.extract_ratio(S['DNBS01'][0])
chk('DNBS01: arithmetic of the return holds in the items read', close(d['loans'], d['sec'] + d['unsec']) and close(d['inc'], d['finc'] + (R.value(R.find(R.lines(S['DNBS01'][0]), 'PART3', r'^B\. Income from Non-Financial')) or 0)) and d['gnpa'] is not None and d['ta'] > 0,
    'loans %.0f = secured + unsecured; total income = financial + non-financial' % d['loans'])
ls = R.lines(S['DNBS01'][0]); banks = [l for l in ls if l['part'] == 'PART1' and re.search(r'^\(iii\) Borrowings from Banks', l['label'])]
chk('DNBS01: borrowings from banks = secured + unsecured lines', len(banks) == 2 and close(d['bank'], sum(R.value(b) for b in banks)), d['bank'])
d3, _, ref = R.extract_ratio(S['DNBS03'][0])
chk('DNBS03: owned fund, Tier 1, Tier 2 and risk-weighted assets read', all(isinstance(d3.get(k), (int, float)) for k in ('of', 't1', 't2', 'rwa')) and d3['t1'] == d3['nof'], {k: round(d3[k], 2) for k in ('of', 't1', 't2', 'rwa')})
crar = dict(ref).get('crar reported in the return'); tcf = dict(ref).get('total capital funds')
chk('DNBS03: ratio in the return = total capital funds / risk-weighted assets read', close(crar, round(tcf / d3['rwa'], 4)), '%s vs %s' % (crar, round(tcf / d3['rwa'], 4)))

# ---- DNBS04B: ALM lines
path, put, _ = S['DNBS04B']; ls = R.lines(path); a, miss, c = R.extract_alm(path)
chk('DNBS04B: every label of the ALM mapping found', not miss, miss)
tout, tin = R._row(ls, 'SLS', R.TOTOUT), R._row(ls, 'SLS', R.TOTIN)
chk('DNBS04B: outflow lines add up to total outflows in every bucket', all(close(sum(a['liq.out.%d.%d' % (k, j + 1)] for k in range(1, 12)), tout[j]) for j in range(10)), round(sum(tout), 2))
chk('DNBS04B: inflow lines add up to total inflows in every bucket', all(close(sum(a['liq.in.%d.%d' % (k, j + 1)] for k in range(1, 10)), tin[j]) for j in range(10)), round(sum(tin), 2))
bank = [l for l in ls if l['part'] == 'SLS' and re.search(r'^[a-f]\) (Bank Borrowings|Other bank borrowings)', l['label'])]
chk('DNBS04B: bank borrowings line = its six sub-lines, bucket by bucket', len(bank) == 6 and all(close(a['liq.out.2.%d' % (j + 1)], sum(put[(b['sheet'], b['row'], 6 + j)] for b in bank)) for j in range(10)), a['liq.out.2.1'])
chk('DNBS04B: no balance left negative in "Other" lines', all(a['liq.out.11.%d' % j] >= -1e-6 and a['liq.in.9.%d' % j] >= -1e-6 for j in range(1, 11)), 'other outflows %.0f, other inflows %.0f' % (c['other_out'], c['other_in']))
irs_o, irs_i = R._row(ls, 'IRS', R.TOTOUT), R._row(ls, 'IRS', R.TOTIN)
chk('DNBS04B: rate-sensitive totals read from the interest rate statement', all(close(a['rate.rsl.%d' % (j + 1)], irs_o[j]) and close(a['rate.rsa.%d' % (j + 1)], irs_i[j]) for j in range(10)) and irs_o != tout, round(sum(irs_o), 2))
r4, m4, _ = R.extract_ratio(path); chk('DNBS04B: first three buckets for the ratio model', not m4 and close(r4['out1'], tout[0]) and close(r4['in3'], tin[2]), r4)

# ---- DNBS04A
s, miss = R.extract_stdl(S['DNBS04A'][0])
chk('DNBS04A: totals read and mismatch = inflows - outflows', not miss and all(close(s['stdl.mis.%d' % j], s['stdl.in.%d' % j] - s['stdl.out.%d' % j]) for j in range(1, 6)), s.get('stdl.buckets'))

# ---- DNBS02: the new reader against the reader already in use
path = S['DNBS02'][0]; old, omiss = OLD.extract(path); ls = R.lines(path); ok = True; n = 0
for k, (part, rx, i) in OLD.MAP02.items():
    l = R.find(ls, part, rx)
    if k in old and l is not None:
        n += 1; ok &= close(R.value(l), old[k])
chk('DNBS02: same figures as read_dnbs.py for the items it maps', ok and n >= 25, '%d items compared; old reader did not find %s' % (n, omiss))
# ---- end to end: what the readers write goes into the Ratio Model and the ALM Model without an unknown key or a formula error
if os.path.exists('out/RATIO-M01 Regulatory and Financial Ratio Master Model.xlsx') and os.path.exists('out/ALM-M01 Asset Liability Management and Liquidity Model.xlsx'):
    import fill_model, recalc
    data = {}
    for code in ('DNBS01', 'DNBS03', 'DNBS04B'):
        d, _, _ = R.extract_ratio(S[code][0]); data.update({'data.%s.cur' % k: v for k, v in d.items()})
    n, unk = fill_model.fill('out/RATIO-M01 Regulatory and Financial Ratio Master Model.xlsx', 'out/ratio_map.json', data, os.path.join(TMP, 'ratio.xlsx')); _, nf, errs, _ = recalc.recalc(os.path.join(TMP, 'ratio.xlsx'))
    chk('Ratio Model takes the DNBS01, DNBS03 and DNBS04B items', not unk and not errs, '%d inputs written, %d formulas, unknown keys %s' % (n, nf, unk))
    a, _, _ = R.extract_alm(S['DNBS04B'][0]); n, unk = fill_model.fill('out/ALM-M01 Asset Liability Management and Liquidity Model.xlsx', 'out/alm_map.json', a, os.path.join(TMP, 'alm.xlsx')); _, nf, errs, _ = recalc.recalc(os.path.join(TMP, 'alm.xlsx'))
    chk('ALM Model takes the DNBS04B lines', not unk and not errs, '%d inputs written, %d formulas, unknown keys %s' % (n, nf, unk))
else: print('SKIP end-to-end fill: run run_examples.py first so that the masters are in out/')
shutil.rmtree(TMP, ignore_errors=True)
print('\nFAILURES:', len(fails), fails); sys.exit(1 if fails else 0)
