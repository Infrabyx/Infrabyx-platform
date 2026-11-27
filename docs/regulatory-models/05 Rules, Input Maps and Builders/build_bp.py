"""Business Plan Projection Model (BP-M01): five-year projection of balance sheet, profit and capital under a base and a downside scenario,
with a hand-over of the capital plan inputs to the ICAAP model.  Run: python3 build_bp.py <out.xlsx> <map.json>
Paragraph numbers read against the Source text on 25-11-2026: Prudential Norms on Capital Adequacy Directions, 2025 paras 6, 17 and 54."""
import sys
from xl import *

NY = 5; YC = [L(3 + k) for k in range(NY)]          # C..G = Y1..Y5; B = base year
B = Book('BP-M01', 'Business Plan Projection Model')
CA = 'RBI (NBFCs – Prudential Norms on Capital Adequacy) Directions, 2025'; YN = ['Yes', 'No']

readme(B, 'Business Plan Projection Model',
       ['This workbook projects the balance sheet, the profit and the regulatory capital of the company for five years from a small set of assumptions, under a base scenario and a downside scenario. It shows in which year, if any, the capital ratios fall below the minimum or the management buffer, and how much capital would be needed.',
        'It supports the internal assessment of capital required by paragraph 54 of the ' + CA + ' and gives the ICAAP model (ICAAP-M01) the five capital plan inputs for each of the first three years. Use the same unit of amount as the ICAAP model.'],
       ['Setup: enter the base date and confirm the minimum ratios, the buffer, the tax rate and the scenario to be handed over.', 'Base Year Input: enter the balance sheet, the capital and the profit of the last audited year.',
        'Assumptions Input: enter the assumptions for each of the five years and the changes that make the downside scenario.', 'Read Projection Base, Projection Downside and the Dashboard.', 'Clear the Checks sheet, then copy the Handover sheet into the ICAAP model with the fill script or by hand.'],
       [('Method Notes', 'explains every line of the projection'), ('Setup', 'date, minimum ratios and buffer'), ('Base Year Input', 'last audited position'), ('Assumptions Input', 'assumptions for five years and the downside'), ('Projection Base', 'base scenario'),
        ('Projection Downside', 'downside scenario'), ('Dashboard', 'the two scenarios side by side'), ('Handover', 'inputs for the ICAAP model'), ('Rules', 'rules for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Setup', (74, 18, 64), tab='C00000')
s.title('Setup – date, minimum ratios and buffer', 'Yellow cells are inputs.')
ROW = {}
for r, lab, key, d, fmt, lst, src in [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None, ''), (5, 'Base date (end of the last audited year)', 'setup.date', None, 'date', None, 'Audited financial statements'),
                                      (6, 'Amounts are in', 'setup.units', '₹ crore', 'txt', None, 'Use the unit of the ICAAP model'), (7, 'Minimum CRAR', 'setup.mincrar', 0.15, 'pct', None, CA + ', para 6'),
                                      (8, 'Minimum Tier 1 ratio', 'setup.mint1', 0.10, 'pct', None, CA + ', para 6 (12% for an NBFC primarily lending against gold jewellery)'),
                                      (9, 'Leverage limit applies (Base Layer NBFC)', 'setup.levon', 'No', 'txt', YN, CA + ', para 17'), (10, 'Maximum leverage (times)', 'setup.maxlev', 7, 'num', None, CA + ', para 17'),
                                      (11, 'Management buffer over the minimum ratios (% of RWA)', 'setup.mbuf', 0.02, 'pct', None, 'Board approved ICAAP policy'), (12, 'Tax rate', 'setup.tax', 0.2517, 'pct', None, 'Income-tax rate applicable to the company'),
                                      (13, 'Scenario handed over to the ICAAP model', 'setup.scen', 'Base', 'txt', ['Base', 'Downside'], 'Management choice')]:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, d, fmt, src or 'Company', lst); s.lbl('C%d' % r, src); ROW[key] = r
S = lambda k: q('Setup', '$B$%d' % ROW[k])

b = B.sheet('Base Year Input', (70, 18, 60), tab='BF9000')
b.title('Base Year Input – last audited position', 'Balance sheet, regulatory capital and profit of the base year, in the unit named on Setup.')
BR = {}
def binp(r, lab, key, src):
    b.lbl('A%d' % r, lab); b.inp('B%d' % r, key, lab, None, 'num', src); b.lbl('C%d' % r, src); BR[key] = r
b.sec('A4', 'Balance sheet', 3)
for r, lab, key in [(5, 'Loan assets (gross)', 'bs.loans'), (6, 'Liquid assets: cash, bank balances and liquid investments', 'bs.liq'), (7, 'Other assets', 'bs.oth')]: binp(r, lab, key, 'Audited balance sheet')
b.lbl('A8', 'Total assets', bold=True); b.f('B8', 'N(B5)+N(B6)+N(B7)', 'num', out=True)
for r, lab, key in [(9, 'Borrowings (including deposits and debt securities)', 'bs.borr'), (10, 'Other liabilities and provisions', 'bs.ol'), (11, 'Net worth', 'bs.nw')]: binp(r, lab, key, 'Audited balance sheet')
b.lbl('A12', 'Total liabilities and net worth', bold=True); b.f('B12', 'N(B9)+N(B10)+N(B11)', 'num', out=True)
b.sec('A14', 'Regulatory capital', 3)
for r, lab, key in [(15, 'Tier 1 capital', 'cap.t1'), (16, 'Tier 2 capital', 'cap.t2'), (17, 'Risk-weighted assets', 'cap.rwa')]: binp(r, lab, key, 'Capital adequacy computation; ICAAP-M01')
b.lbl('A18', 'CRAR'); b.f('B18', div('N(B15)+MIN(N(B16),MAX(0,N(B15)))', 'B17'), 'pct', out=True); b.lbl('A19', 'RWA as a share of total assets'); b.f('B19', div('B17', 'B8'), 'pct', out=True)
b.sec('A21', 'Profit of the base year', 3)
for r, lab, key in [(22, 'Interest income on loan assets', 'pl.ii'), (23, 'Income on liquid assets', 'pl.li'), (24, 'Other income', 'pl.oi'), (25, 'Interest expense', 'pl.ie'), (26, 'Operating expenses', 'pl.ox'), (27, 'Credit cost (impairment and write-offs)', 'pl.cc'), (28, 'Tax expense', 'pl.tax')]:
    binp(r, lab, key, 'Audited statement of profit and loss')
b.lbl('A29', 'Profit after tax', bold=True); b.f('B29', 'N(B22)+N(B23)+N(B24)-N(B25)-N(B26)-N(B27)-N(B28)', 'num', out=True)
BY = lambda k: "'Base Year Input'!$B$%d" % BR[k]; BYC = lambda r: "'Base Year Input'!$B$%d" % r; EMPTY = '%s=""' % BY('bs.loans')

a = B.sheet('Assumptions Input', (70,  14) + (12,) * NY + (50,), tab='BF9000')
a.title('Assumptions Input – assumptions for five years and the downside scenario', 'Rates are entered as percentages of the average balance of the year.'); a.head(5, ['Assumption', ''] + ['Y%d' % (k + 1) for k in range(NY)] + ['Note'])
AS = [('g', 'Growth in loan assets', 'pct', 'Business plan'), ('y', 'Yield on average loan assets', 'pct', 'Pricing policy'), ('oi', 'Other income as a share of average loan assets', 'pct', 'Fee and other income'),
      ('ly', 'Return on average liquid assets', 'pct', 'Treasury'), ('c', 'Cost of borrowings', 'pct', 'Funding plan'), ('ox', 'Operating expenses as a share of average loan assets', 'pct', 'Budget'),
      ('cc', 'Credit cost as a share of average loan assets', 'pct', 'ECL model; write-off experience'), ('liq', 'Liquid assets as a share of loan assets at year end', 'pct', 'Liquidity policy'), ('oa', 'Growth in other assets', 'pct', 'Budget'),
      ('ol', 'Other liabilities as a share of total assets at year end', 'pct', 'Budget'), ('rw', 'RWA as a share of total assets (blank = base year share)', 'pct', 'Product mix'), ('div', 'Dividend payout (share of profit after tax)', 'pct', 'Dividend policy'),
      ('eq', 'Equity raised', 'num', 'Capital raising plan'), ('t2', 'Tier 2 capital raised', 'num', 'Capital raising plan'), ('t2r', 'Tier 2 capital repaid or discounted for residual maturity', 'num', 'Debt schedule')]
AR_ = {}
for j, (k, lab, fmt, src) in enumerate(AS):
    r = 6 + j; AR_[k] = r; a.lbl('A%d' % r, lab); a.lbl('%s%d' % (L(3 + NY), r), src)
    for n, col in enumerate(YC): a.inp('%s%d' % (col, r), 'as.%s.%d' % (k, n + 1), '%s Y%d' % (lab, n + 1), None, fmt, src)
a.sec('A23', 'Downside scenario – changes applied to every year', 3)
DN = [('g', 'Growth in loan assets multiplied by', 0.5, 'num'), ('y', 'Yield on loan assets changed by (percentage points)', -0.005, 'pct'), ('c', 'Cost of borrowings changed by (percentage points)', 0.01, 'pct'), ('cc', 'Credit cost multiplied by', 2.0, 'num'),
      ('ox', 'Operating expense ratio changed by (percentage points)', 0.0, 'pct'), ('eq', 'Equity raised multiplied by', 0.0, 'num')]
DR = {}
for j, (k, lab, dflt, fmt) in enumerate(DN):
    r = 24 + j; DR[k] = r; a.lbl('A%d' % r, lab); a.inp('B%d' % r, 'dn.%s' % k, 'Downside: ' + lab, dflt, fmt, 'Stress testing policy; management choice')
AI = lambda k, col: "'Assumptions Input'!%s$%d" % (col, AR_[k]); DNV = lambda k: "'Assumptions Input'!$B$%d" % DR[k]

ROWS = dict(g=7, y=8, c=9, ox=10, cc=11, eq=12, loans=15, liq=16, oth=17, ta=18, ol=19, nw=20, borr=21, de=22, ii=25, li=26, oi=27, ie=28, ni=29, opex=30, cred=31, pbt=32, tax=33, pat=34, dv=35, ret=36,
            t1=39, t2=40, t2c=41, rwa=42, rg=43, t1r=44, crar=45, lev=46, sur=47, nim=50, roa=51, roe=52, ci=53, ie2=54, ied=55, rc=58, rt=59, rl=60)


def projection(name, down):
    p = B.sheet(name, (62, 14) + (14,) * NY, tab='00B050'); R = ROWS
    p.title('%s – %s scenario' % (name, 'downside' if down else 'base'), 'Amounts in the unit named on Setup. ' + CA + ', paras 6, 17 and 54.'); p.head(5, ['Item', 'Base year'] + ['Y%d' % (k + 1) for k in range(NY)]); p.ws.freeze_panes = 'B6'
    lab = {'g': 'Growth in loan assets', 'y': 'Yield on average loan assets', 'c': 'Cost of borrowings', 'ox': 'Operating expense ratio', 'cc': 'Credit cost ratio', 'eq': 'Equity raised', 'loans': 'Loan assets', 'liq': 'Liquid assets', 'oth': 'Other assets',
           'ta': 'Total assets', 'ol': 'Other liabilities and provisions', 'nw': 'Net worth', 'borr': 'Borrowings (balancing figure)', 'de': 'Borrowings to net worth (times)', 'ii': 'Interest income on loan assets', 'li': 'Income on liquid assets', 'oi': 'Other income',
           'ie': 'Interest expense', 'ni': 'Net income', 'opex': 'Operating expenses', 'cred': 'Credit cost', 'pbt': 'Profit before tax', 'tax': 'Tax', 'pat': 'Profit after tax', 'dv': 'Dividend', 'ret': 'Profit retained', 't1': 'Tier 1 capital', 't2': 'Tier 2 capital',
           't2c': 'Tier 2 capital counted (not above Tier 1)', 'rwa': 'Risk-weighted assets', 'rg': 'Growth in risk-weighted assets', 't1r': 'Tier 1 ratio', 'crar': 'CRAR', 'lev': 'Leverage: outside liabilities to net worth (times)',
           'sur': 'Capital above (+) or below (-) the minimum CRAR and buffer', 'nim': 'Net interest margin on average loan assets', 'roa': 'Return on average total assets', 'roe': 'Return on average net worth', 'ci': 'Cost to income',
           'ie2': 'Interest expense on the simple average of borrowings (for comparison)', 'ied': 'Difference from the interest expense used', 'rc': 'CRAR', 'rt': 'Tier 1 ratio', 'rl': 'Leverage'}
    for k, t in lab.items(): p.lbl('A%d' % R[k], t, bold=k in ('ta', 'pat', 'crar', 'nw'))
    for r, t in ((6, 'Assumptions used in this scenario'), (14, 'Balance sheet'), (24, 'Profit'), (38, 'Capital'), (49, 'Ratios'), (57, 'Status against the minimum ratios')): p.sec('A%d' % r, t, 2 + NY)
    fm = dict(g='pct', y='pct', c='pct', ox='pct', cc='pct', rg='pct', t1r='pct', crar='pct', nim='pct', roa='pct', roe='pct', ci='pct', de='x', lev='x', rc='txt', rt='txt', rl='txt')
    def put(k, col, f, out=False): p.f('%s%d' % (col, R[k]), 'IF(%s,"",%s)' % (EMPTY, f), fm.get(k, 'num'), out=out, bold=k in ('ta', 'pat', 'crar', 'nw'))
    base = dict(loans=BY('bs.loans'), liq=BY('bs.liq'), oth=BY('bs.oth'), ol=BY('bs.ol'), nw=BY('bs.nw'), borr=BY('bs.borr'), ii=BY('pl.ii'), li=BY('pl.li'), oi=BY('pl.oi'), ie=BY('pl.ie'), opex=BY('pl.ox'), cred=BY('pl.cc'), tax=BY('pl.tax'),
                t1=BY('cap.t1'), t2=BY('cap.t2'), rwa=BY('cap.rwa'))
    for k, f in base.items(): put(k, 'B', 'N(%s)' % f)
    put('ta', 'B', 'B%d+B%d+B%d' % (R['loans'], R['liq'], R['oth'])); put('ni', 'B', 'B%d+B%d+B%d-B%d' % (R['ii'], R['li'], R['oi'], R['ie'])); put('pbt', 'B', 'B%d-B%d-B%d' % (R['ni'], R['opex'], R['cred'])); put('pat', 'B', 'B%d-B%d' % (R['pbt'], R['tax']))
    for n, col in enumerate(['B'] + YC):
        if col != 'B':
            pv = L(2 + n - 1) if n > 1 else 'B'; c = lambda k: '%s%d' % (col, R[k]); o = lambda k: '%s%d' % (pv, R[k]); A_ = lambda k: 'N(%s)' % AI(k, col)
            put('g', col, A_('g') + ('*N(%s)' % DNV('g') if down else '')); put('y', col, A_('y') + ('+N(%s)' % DNV('y') if down else '')); put('c', col, A_('c') + ('+N(%s)' % DNV('c') if down else ''))
            put('ox', col, A_('ox') + ('+N(%s)' % DNV('ox') if down else '')); put('cc', col, A_('cc') + ('*N(%s)' % DNV('cc') if down else '')); put('eq', col, A_('eq') + ('*N(%s)' % DNV('eq') if down else ''))
            put('loans', col, '%s*(1+%s)' % (o('loans'), c('g'))); put('liq', col, '%s*%s' % (A_('liq'), c('loans'))); put('oth', col, '%s*(1+%s)' % (o('oth'), A_('oa'))); put('ta', col, '%s+%s+%s' % (c('loans'), c('liq'), c('oth')), True)
            put('ol', col, '%s*%s' % (A_('ol'), c('ta'))); put('nw', col, '%s+%s+%s' % (o('nw'), c('ret'), c('eq')), True); put('borr', col, '%s-%s-%s' % (c('ta'), c('ol'), c('nw')))
            avl = '(%s+%s)/2' % (o('loans'), c('loans'))
            put('ii', col, '%s*%s' % (c('y'), avl)); put('li', col, '%s*(%s+%s)/2' % (A_('ly'), o('liq'), c('liq'))); put('oi', col, '%s*%s' % (A_('oi'), avl))
            put('ie', col, '%s*(%s+0.5*((%s-%s)-(%s-%s)-%s))' % (c('c'), o('borr'), c('ta'), o('ta'), c('ol'), o('ol'), c('eq')))
            put('ni', col, '%s+%s+%s-%s' % (c('ii'), c('li'), c('oi'), c('ie'))); put('opex', col, '%s*%s' % (c('ox'), avl)); put('cred', col, '%s*%s' % (c('cc'), avl)); put('pbt', col, '%s-%s-%s' % (c('ni'), c('opex'), c('cred')))
            put('tax', col, 'MAX(0,%s)*N(%s)' % (c('pbt'), S('setup.tax'))); put('pat', col, '%s-%s' % (c('pbt'), c('tax')), True); put('dv', col, 'MAX(0,%s)*%s' % (c('pat'), A_('div'))); put('ret', col, '%s-%s' % (c('pat'), c('dv')))
            put('t1', col, '%s+%s+%s' % (o('t1'), c('ret'), c('eq'))); put('t2', col, 'MAX(0,%s+%s-%s)' % (o('t2'), A_('t2'), A_('t2r')))
            put('rwa', col, 'IF(%s="",IF(N(%s)=0,0,N(%s)/N(%s)),%s)*%s' % (AI('rw', col), BYC(8), BY('cap.rwa'), BYC(8), AI('rw', col), c('ta'))); put('rg', col, 'IF(%s=0,0,%s/%s-1)' % (o('rwa'), c('rwa'), o('rwa')))
            put('nim', col, 'IF(%s=0,0,(%s+%s-%s)/(%s))' % (avl, c('ii'), c('li'), c('ie'), avl)); put('roa', col, 'IF(%s+%s=0,0,%s/((%s+%s)/2))' % (o('ta'), c('ta'), c('pat'), o('ta'), c('ta')))
            put('roe', col, 'IF(%s+%s<=0,0,%s/((%s+%s)/2))' % (o('nw'), c('nw'), c('pat'), o('nw'), c('nw'))); put('ci', col, 'IF(%s<=0,0,%s/%s)' % (c('ni'), c('opex'), c('ni')))
            put('ie2', col, '%s*(%s+%s)/2' % (c('c'), o('borr'), c('borr'))); put('ied', col, '%s-%s' % (c('ie'), c('ie2')))
        c = lambda k: '%s%d' % (col, R[k])
        put('de', col, 'IF(%s<=0,0,%s/%s)' % (c('nw'), c('borr'), c('nw'))); put('t2c', col, 'MIN(%s,MAX(0,%s))' % (c('t2'), c('t1'))); put('t1r', col, 'IF(%s=0,0,%s/%s)' % (c('rwa'), c('t1'), c('rwa')))
        put('crar', col, 'IF(%s=0,0,(%s+%s)/%s)' % (c('rwa'), c('t1'), c('t2c'), c('rwa')), True); put('lev', col, 'IF(%s<=0,0,(%s-%s)/%s)' % (c('nw'), c('ta'), c('nw'), c('nw')))
        put('sur', col, '%s+%s-(N(%s)+N(%s))*%s' % (c('t1'), c('t2c'), S('setup.mincrar'), S('setup.mbuf'), c('rwa')))
        put('rc', col, 'IF(%s=0,"",IF(%s<%s,"RED",IF(%s<%s+%s,"AMBER","GREEN")))' % (c('rwa'), c('crar'), S('setup.mincrar'), c('crar'), S('setup.mincrar'), S('setup.mbuf')))
        put('rt', col, 'IF(%s=0,"",IF(%s<%s,"RED",IF(%s<%s+%s,"AMBER","GREEN")))' % (c('rwa'), c('t1r'), S('setup.mint1'), c('t1r'), S('setup.mint1'), S('setup.mbuf')))
        put('rl', col, 'IF(%s<>"Yes","",IF(OR(%s<=0,%s>%s),"RED",IF(%s>0.9*%s,"AMBER","GREEN")))' % (S('setup.levon'), c('nw'), c('lev'), S('setup.maxlev'), c('lev'), S('setup.maxlev')))
    p.rag('B%d:%s%d' % (R['rc'], YC[-1], R['rl']))
    return p


projection('Projection Base', False); projection('Projection Downside', True)
PB = lambda k, col: "'Projection Base'!%s%d" % (col, ROWS[k]); PD = lambda k, col: "'Projection Downside'!%s%d" % (col, ROWS[k])

d = B.sheet('Dashboard', (52, 14) + (14,) * NY, tab='00B050')
d.title('Dashboard – base and downside scenarios side by side', CA + ', paras 6, 17 and 54.')
r = 4
for title, P in (('Base scenario', PB), ('Downside scenario', PD)):
    d.sec('A%d' % r, title, 2 + NY); d.head(r + 1, ['Item', 'Base year'] + ['Y%d' % (k + 1) for k in range(NY)])
    for j, (k, lab, fmt) in enumerate((('loans', 'Loan assets', 'num'), ('pat', 'Profit after tax', 'num'), ('nw', 'Net worth', 'num'), ('roa', 'Return on average total assets', 'pct'), ('t1r', 'Tier 1 ratio', 'pct'), ('crar', 'CRAR', 'pct'),
                                       ('lev', 'Leverage (times)', 'x'), ('sur', 'Capital above (+) or below (-) the minimum and buffer', 'num'), ('rc', 'CRAR status', 'txt'), ('rt', 'Tier 1 status', 'txt'), ('rl', 'Leverage status', 'txt'))):
        rr = r + 2 + j; d.lbl('A%d' % rr, lab)
        for col in ['B'] + YC:
            if col == 'B' and k == 'roa': continue
            d.f('%s%d' % (col, rr), '%s&""' % P(k, col) if fmt == 'txt' else 'IF(%s="","",%s)' % (P(k, col), P(k, col)), fmt)
    d.rag('B%d:%s%d' % (r + 10, YC[-1], r + 12)); r += 15
d.sec('A%d' % r, 'Summary', 3); d.head(r + 1, ['Measure', 'Base', 'Downside'])
def first_breach(P, k):
    f = '""'
    for n in reversed(range(NY)): f = 'IF(%s="RED","Y%d",%s)' % (P(k, YC[n]), n + 1, f)
    return 'IF(%s,"",IF(%s="","None",%s))' % (EMPTY, f, f)
SM = [('First year in which CRAR is below the minimum', lambda P: first_breach(P, 'rc'), 'txt'), ('First year in which the Tier 1 ratio is below the minimum', lambda P: first_breach(P, 'rt'), 'txt'),
      ('Lowest CRAR in the five years', lambda P: 'IF(%s,"",MIN(%s:%s))' % (EMPTY, P('crar', YC[0]), P('crar', YC[-1])), 'pct'),
      ('Largest capital shortfall against the minimum and buffer', lambda P: 'IF(%s,"",MAX(0,-MIN(%s:%s)))' % (EMPTY, P('sur', YC[0]), P('sur', YC[-1])), 'num'),
      ('Profit after tax, five years together', lambda P: 'IF(%s,"",SUM(%s:%s))' % (EMPTY, P('pat', YC[0]), P('pat', YC[-1])), 'num'),
      ('Equity raised, five years together', lambda P: 'IF(%s,"",SUM(%s:%s))' % (EMPTY, P('eq', YC[0]), P('eq', YC[-1])), 'num'),
      ('Loan assets at the end of Y5', lambda P: 'IF(%s,"",%s)' % (EMPTY, P('loans', YC[-1])), 'num')]
SR0 = r + 2
for j, (lab, fn, fmt) in enumerate(SM):
    rr = SR0 + j; d.lbl('A%d' % rr, lab); d.f('B%d' % rr, fn(PB), fmt, out=True); d.f('C%d' % rr, fn(PD), fmt, out=True)

h = B.sheet('Handover', (6, 60, 18, 16, 40), tab='7030A0')
h.title('Handover – capital plan inputs for the ICAAP model', 'Scenario chosen on Setup. Values go to the Capital Plan sheet of ICAAP-M01 under the keys shown; both models must use the same unit.'); h.head(5, ['#', 'Item', 'Value', 'Key', 'Note'])
h.lbl('B4', 'Scenario handed over:'); h.f('C4', '%s&""' % S('setup.scen'), 'txt')
HO = [('g', 'rg', 'Growth in risk-weighted assets', 'pct'), ('pat', 'pat', 'Profit after tax', 'num'), ('div', None, 'Dividend payout', 'pct'), ('eq', 'eq', 'Equity raised', 'num'), ('t2', None, 'Tier 2 raised, net of repayment', 'num')]
r = 6
for n in range(3):
    col = YC[n]
    for key, k, lab, fmt in HO:
        if k: f = 'IF(%s="Downside",%s,%s)' % (S('setup.scen'), PD(k, col), PB(k, col))
        elif key == 'div': f = 'IF(IF(%s="Downside",%s,%s)<=0,0,N(%s))' % (S('setup.scen'), PD('pat', col), PB('pat', col), AI('div', col))
        else: f = 'N(%s)-N(%s)' % (AI('t2', col), AI('t2r', col))
        h.lbl('A%d' % r, r - 5); h.lbl('B%d' % r, '%s Y%d' % (lab, n + 1)); h.f('C%d' % r, 'IF(%s,"",%s)' % (EMPTY, f), fmt, out=True); h.lbl('D%d' % r, 'plan.%s.%d' % (key, n + 1))
        if key == 'div': h.lbl('E%d' % r, 'Nil in a year of loss')
        r += 1

ru = B.sheet('Rules', (6, 34, 96, 50), tab='7030A0', protect=False)
ru.title('Rules – the projection in one table'); ru.head(5, ['#', 'Rule', 'Logic', 'Reference'])
RL = [('Loan assets', 'previous year x (1 + growth)', 'Business plan'), ('Liquid and other assets', 'liquid assets = share x loan assets; other assets = previous year x (1 + growth)', 'Business plan'),
      ('Net worth', 'previous year + profit retained + equity raised', 'Accounting identity'), ('Borrowings', 'total assets - other liabilities - net worth (balancing figure)', 'Accounting identity'),
      ('Income', 'yield, other income ratio, operating expense ratio and credit cost ratio x average loan assets of the year; return x average liquid assets', 'Business plan'),
      ('Interest expense', 'cost of borrowings x (opening borrowings + half of the growth in assets funded by debt), where growth funded by debt = growth in total assets - growth in other liabilities - equity raised', 'Method Notes, section 3'),
      ('Tax and dividend', 'tax = rate x profit before tax, nil on a loss; dividend = payout x profit after tax, nil on a loss', 'Business plan'),
      ('Capital', 'Tier 1 = previous year + profit retained + equity raised; Tier 2 = previous year + raised - repaid; Tier 2 counted up to 100% of Tier 1; RWA = share x total assets', CA + ', para 6'),
      ('Minimum ratios', 'CRAR 15% and Tier 1 10% of RWA (Tier 1 12% for an NBFC primarily lending against gold jewellery); leverage of a Base Layer NBFC not above 7', CA + ', paras 6 and 17'),
      ('Status', 'Red below the minimum; Amber below the minimum plus the management buffer; Green otherwise', 'Board approved ICAAP policy'),
      ('Downside', 'growth, credit cost and equity raised are multiplied, and yield, cost of borrowings and operating expense ratio are shifted, by the figures on Assumptions Input', 'Stress testing policy')]
for j, (a_, b_, c_) in enumerate(RL, 1):
    for col, vv in zip('ABCD', (j, a_, b_, c_)): ru.lbl('%s%d' % (col, 5 + j), vv)

mn = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
mn.title('Method Notes – how this model produces its results')
mn.text_block(4, ['# 1. Purpose', 'An NBFC makes an internal assessment of the capital it needs for the risks in its business. That assessment looks ahead: it needs a view of how the book, the profit and the capital will move over the plan period. This model gives that view from a few assumptions the Board can read and challenge, and passes the result to the capital plan of the ICAAP model.',
 '# 2. Balance sheet', 'Loan assets grow at the rate assumed for each year. Liquid assets are held as a share of loan assets and other assets grow at their own rate. Other liabilities are a share of total assets. Net worth is last year\'s figure plus profit retained and equity raised. Borrowings are whatever is needed to fund the rest, so the balance sheet always balances.',
 '# 3. Profit', 'Interest income, other income, operating expenses and credit cost are ratios applied to the average loan assets of the year. Interest expense is the cost of borrowings applied to the opening borrowings plus half of the year\'s growth that is funded by debt. Closing borrowings depend on the profit of the year, and the profit depends on interest; using the growth funded by debt in place of closing borrowings avoids a circular formula. The Projection sheets show the interest expense on the simple average of borrowings for comparison; the difference is small and is tested on the Checks sheet. Tax is nil in a year of loss and no dividend is paid out of a loss.',
 '# 4. Capital', 'Tier 1 capital moves with profit retained and equity raised; deductions from Tier 1 are assumed to stay as they are. Tier 2 capital moves with amounts raised and repaid or discounted, and is counted only up to the amount of Tier 1. Risk-weighted assets are a share of total assets, by default the share of the base year; change the share when the product mix changes. The capital ratios are tested against the minimum and against the minimum plus the management buffer.',
 '# 5. Downside scenario', 'The downside scenario applies a set of changes to every year: slower growth, lower yield, costlier borrowings, higher credit cost and less equity raised. It is a planning scenario and does not replace the stress tests of the Stress Testing Model.',
 '# 6. Hand-over and limits', 'The Handover sheet gives, for each of the first three years, the growth in risk-weighted assets, the profit after tax, the dividend payout, the equity raised and the Tier 2 raised, under the keys of the ICAAP model. The model is a planning tool at the level of the whole company: it does not project products separately, does not model the repricing of assets and liabilities, and assumes that off-balance sheet exposures move with total assets.'])

ck = B.sheet('Checks', (6, 84, 12, 56), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
rngs = lambda P, k: '%s:%s' % (P(k, YC[0]), P(k, YC[-1]))
chk = [('The base date is entered', '%s<>""' % S('setup.date'), 'Complete Setup'), ('The base year balance sheet balances', 'ABS(%s-%s)<0.01' % (BYC(8), BYC(12)), 'Correct Base Year Input'),
       ('Tier 1 capital and risk-weighted assets of the base year are entered', 'AND(N(%s)>0,N(%s)>0)' % (BY('cap.t1'), BY('cap.rwa')), 'Complete Base Year Input'),
       ('Growth, yield and cost of borrowings are entered for all five years', 'COUNT(%s:%s)+COUNT(%s:%s)+COUNT(%s:%s)=%d' % (AI('g', YC[0]), AI('g', YC[-1]), AI('y', YC[0]), AI('y', YC[-1]), AI('c', YC[0]), AI('c', YC[-1]), 3 * NY), 'Complete Assumptions Input'),
       ('Dividend payout is between 0% and 100% in every year', 'AND(MIN(%s:%s)>=0,MAX(%s:%s)<=1)' % (AI('div', YC[0]), AI('div', YC[-1]), AI('div', YC[0]), AI('div', YC[-1])), 'Correct the payout'),
       ('Borrowings stay positive in both scenarios', 'IF(%s,TRUE,AND(MIN(%s)>=0,MIN(%s)>=0))' % (EMPTY, rngs(PB, 'borr'), rngs(PD, 'borr')), 'Lower the equity raised or raise growth; the plan shows surplus funds'),
       ('Net worth stays positive in both scenarios', 'IF(%s,TRUE,AND(MIN(%s)>0,MIN(%s)>0))' % (EMPTY, rngs(PB, 'nw'), rngs(PD, 'nw')), 'Review the assumptions'),
       ('Interest expense is within 5% of the figure on the simple average of borrowings', 'IF(%s,TRUE,SUMPRODUCT(--(ABS(%s)>0.05*ABS(%s)))+SUMPRODUCT(--(ABS(%s)>0.05*ABS(%s)))=0)' % (EMPTY, rngs(PB, 'ied'), rngs(PB, 'ie2'), rngs(PD, 'ied'), rngs(PD, 'ie2')), 'Read Method Notes, section 3'),
       ('The downside scenario is not better than the base scenario (profit of five years)', 'IF(%s,TRUE,SUM(%s)<=SUM(%s))' % (EMPTY, rngs(PD, 'pat'), rngs(PB, 'pat')), 'Review the downside changes')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C%d' % (5 + len(chk)))
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Base Year Input', 'Assumptions Input', 'Projection Base', 'Projection Downside', 'Dashboard', 'Handover', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
print('Business plan model built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs')
