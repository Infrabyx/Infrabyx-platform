"""Readers for DNBS01, DNBS03, DNBS04A and DNBS04B (RBI Excel utility files), on the pattern of read_dnbs.py: items are found by their
printed labels and column headings, never by fixed cells.

Usage
  python3 read_dnbs_more.py <return.xlsx> list
        prints every line of the return: part | table | row code | label | values by column
  python3 read_dnbs_more.py <DNBS01, DNBS02 or DNBS03 file> ratio <client_ratio.json> <cur|prev|ly> [--ytd]
        writes items of the Ratio Model (keys data.<item>.<period>); --ytd takes the cumulative profit and loss column instead of the quarter
  python3 read_dnbs_more.py <DNBS04B file> alm <client_alm.json>
        writes the structural liquidity lines and the rate-sensitive totals of the ALM Model (keys liq.out.*, liq.in.*, rate.*)
  python3 read_dnbs_more.py <DNBS04B file> ratio <client_ratio.json> <cur|prev|ly>
        writes inflows and outflows of the first three buckets for the Ratio Model
  python3 read_dnbs_more.py <DNBS04A file> stdl <client_stdl.json>
        writes the totals of the short-term dynamic liquidity statement (reference figures; no model takes them yet)

How a return is read. Every sheet whose name starts with "DNBS" is a part. Inside a part the reader follows the layout the RBI utility uses in
all returns: a table title ("Table 5: ..."), a row of column codes (X010, X020 ...) under the column headings, and one row code (Y010 ...) on every
data line, with the label to its left. A line is identified by part + table + label; a column by its heading. Row and column codes are kept
only for the listing. A return downloaded from the CIMS portal has no codes; it is read from its table titles and column headings in the same way.
Status: DNBS02 is checked on filed returns in both layouts; DNBS01, DNBS03 and DNBS04 are checked on the blank RBI formats only (see test_read_dnbs.py)."""
import sys, json, re
from openpyxl import load_workbook

XC, YC = re.compile(r'^X\d{3}$'), re.compile(r'^Y\d{3,4}$')
SHEET = {'DNBS4ASHORTTERMDYNAMICLIQUIDITY': 'STDL', 'DNBS4BSTRUCTURALLIQUIDITY': 'SLS', 'DNBS4BIRS': 'IRS'}


def _txt(v):
    if not isinstance(v, str): return None
    t = ' '.join(v.split())
    if not t or '.xsd#' in t or t.startswith('#') or ':~:' in t or t == 'terseLabel': return None
    return t


def part_name(title):
    t = title.upper().replace('_', '').replace(' ', '')
    if t in SHEET: return SHEET[t]
    return re.sub(r'^DNBS0?\d{1,2}[AB]?(?=PART|ANNEX)', '', t)


def form(path_or_wb):
    wb = path_or_wb if hasattr(path_or_wb, 'sheetnames') else load_workbook(path_or_wb, read_only=True)
    names = ' '.join(wb.sheetnames).upper().replace('_', '')
    for code, mark in (('DNBS04A', 'DNBS4ASHORT'), ('DNBS04B', 'DNBS4BSTRUCT'), ('DNBS01', 'DNBS01PART'), ('DNBS02', 'DNBS02PART'), ('DNBS03', 'DNBS03PART')):
        if mark in names: return code
    return None


def lines(path):
    """All data lines of a return: dict(part, table, label, y, vals {column code: number}, heads {column code: heading}, sheet, row, cols)."""
    wb = load_workbook(path, data_only=True); out = []
    for ws in wb.worksheets:
        if not ws.title.upper().startswith('DNBS'): continue
        part = part_name(ws.title); table = ''; xcols = {}; heads = {}; prev = []; coded = False
        for row in ws.iter_rows():
            cells = [(c.column, _txt(c.value)) for c in row]; strs = [(i, t) for i, t in cells if t]
            tt = [t for i, t in strs if re.match(r'^Table\s*\d', t)]
            if tt: table = tt[0]
            xs = {}; seen = {}
            for i, t in strs:
                if XC.match(t):
                    seen[t] = seen.get(t, 0) + 1; xs[i] = t if seen[t] == 1 else '%s#%d' % (t, seen[t])     # two columns can carry the same code (amount for the quarter and cumulative amount)
            if xs:
                xcols = xs; heads = {}; coded = True
                for i, x in xs.items():
                    h = [dict(p).get(i) for p in prev[-4:]]; heads[x] = ' / '.join(t for t in h if t and not XC.match(t) and not YC.match(t))
                prev.append(strs); continue
            ys = [(i, t) for i, t in strs if YC.match(t)]
            if ys and xcols:
                yi, y = ys[0]; lab = [t for i, t in strs if i < yi and not YC.match(t) and not XC.match(t)]
                if lab:
                    vals = {}
                    for i, x in xcols.items():
                        v = row[i - 1].value
                        if isinstance(v, (int, float)) and not isinstance(v, bool): vals[x] = v
                    out.append(dict(part=part, table=table, label=lab[-1], y=y, vals=vals, heads=heads, sheet=ws.title, row=row[0].row, cols={x: i for i, x in xcols.items()}))
            prev.append(strs)
        if not coded: out += _plain(ws, part)
    return out


def _plain(ws, part):
    """A part without row and column codes (the return as downloaded from the CIMS portal): table title, one row of column headings, then one line per row
    with the label in the first filled column and the figures to its right."""
    out = []; table = ''; header = None
    for row in ws.iter_rows():
        strs = [(c.column, _txt(c.value)) for c in row]; strs = [(i, t) for i, t in strs if t]
        if not strs: continue
        tt = [t for i, t in strs if re.match(r'^Table\s*\d', t)]
        if tt: table = tt[0]; header = None; continue
        if not table: continue
        if header is None:
            header = dict(strs); continue
        li, lab = strs[0]; cols = {'C%d' % i: i for i in sorted(header) if i > li}
        for c in row:
            if c.column > li and 'C%d' % c.column not in cols and isinstance(c.value, (int, float)) and not isinstance(c.value, bool): cols['C%d' % c.column] = c.column
        vals = {k: row[i - 1].value for k, i in cols.items() if i <= len(row) and isinstance(row[i - 1].value, (int, float)) and not isinstance(row[i - 1].value, bool)}
        out.append(dict(part=part, table=table, label=lab, y='', vals=vals, heads={'C%d' % i: t for i, t in header.items()}, sheet=ws.title, row=row[0].row, cols=cols))
    return out


def _rx(label):
    """The portal download prints '3 Reserves' where the utility prints '3. Reserves': the dot after an item number is optional."""
    return label.replace('\\. ', '\\.?\\s*')


def _order(line): return sorted(line['cols'], key=line['cols'].get)


def meta(path):
    wb = load_workbook(path, data_only=True); m = {'form': form(wb)}
    if 'StartUp' in wb.sheetnames:
        for row in wb['StartUp'].iter_rows(values_only=True):
            v = [x for x in row if x is not None]
            for i, x in enumerate(v[:-1]):
                if x in ('InstitutionName', 'End Date', 'Default Scale', 'Form Name', 'Reportingcurrency') and x not in m: m[x] = v[i + 1]
    else:                                                   # portal download: the particulars are printed at the top of every part
        MON = dict(JAN='01', FEB='02', MAR='03', APR='04', MAY='05', JUN='06', JUL='07', AUG='08', SEP='09', OCT='10', NOV='11', DEC='12')
        for ws in wb.worksheets:
            if not ws.title.upper().startswith('DNBS'): continue
            for row in ws.iter_rows(min_row=1, max_row=10, values_only=True):
                for x in row:
                    if not isinstance(x, str): continue
                    k, _, v = x.partition(':'); k = k.strip().lower(); v = v.strip()
                    if k == 'nbfc name': m['InstitutionName'] = v
                    elif k == 'amount in': m['Default Scale'] = v.title()
                    elif k == 'reporting period end date' and re.match(r'^\d{2}-[A-Za-z]{3}-\d{4}$', v): m['End Date'] = '%s/%s/%s' % (v[:2], MON.get(v[3:6].upper(), '00'), v[7:])
            break
    return m


def scale(m):
    """Rupees per unit of the figures in the return."""
    sc = str(m.get('Default Scale') or '').lower()
    return 1e5 if 'lakh' in sc else 1e7 if 'crore' in sc else 1e3 if 'thousand' in sc else 1e6 if 'million' in sc else 1.0


def find(ls, part, label, table=None, nth=0):
    hit = [l for l in ls if l['part'] == part and re.search(_rx(label), l['label'], re.I) and (table is None or re.search(table, l['table'], re.I))]
    return hit[nth] if len(hit) > nth else None


def value(line, col=None):
    """Number on a line: col is a regular expression on the column heading; without it the first column of the table is taken."""
    if line is None: return None
    if col is None:
        xs = _order(line); return line['vals'].get(xs[0]) if xs else None
    for x in _order(line):
        if re.search(col, line['heads'].get(x, ''), re.I): return line['vals'].get(x)
    return None


# ------------------------------------------------------------------ DNBS01 -> Ratio Model.  item: (part, label, table, column heading)
P1, P2, P3 = 'PART1', 'PART2', 'PART3'
MAP01 = {'eq': (P1, r'^\(i\) Ordinary Shares', None, None), 'ccps': (P1, r'Compulsory Convertible Preference', None, None), 'res': (P1, r'^3\. Reserves and Surplus', None, None), 'reval': (P1, r'Revaluation Reserves', None, None),
         'borr': (P1, r'^6\. Total Borrowings', None, None), 'sub': (P1, r'Subordinated debts', None, None), 'b3': (P1, r'payable less than or equal to 3 months', None, None),
         'b12': (P1, r'more than 3 months but less than or equal', None, None), 'ta': (P1, r'^TOTAL$', None, None), 'stdprov': (P1, r'Provision for Standard Assets', None, None),
         'npaprov': (P1, r'Provisions Held for Non-Performing', None, None), 'pd': (P1, r'^9\. Public Deposits', None, None),
         'loans': (P2, r'^2\. Total \(i\+ii\)', None, None), 'sec': (P2, r'^\(i\) Secured', None, None), 'unsec': (P2, r'^\(ii\) Unsecured', None, None), 'inv': (P2, r'^5\. Total Investments', None, None),
         'cash': (P2, r'^6\. Cash and Bank Balances', None, None),
         'inc': (P3, r'^C\. Total Income', None, None), 'finc': (P3, r'^A\. Income from Financial Business', None, None), 'ii': (P3, r'^\(iv\) Interest Income', None, None), 'fee': (P3, r'^2\. Fee-Based Income', None, None),
         'ie': (P3, r'^2\. Interest Expense and other financing', None, None), 'opex': (P3, r'^12\. Operating Expenses', None, None), 'pat': (P3, r'^3\. Net Profit', None, None),
         'cme': ('PART6', r'^Total Capital Market Exposure', None, None), 'cre': ('PART6', r'^A\.1\.2 Commercial Real Estate', None, None),
         'std': ('PART9C', r'^\(i\) Standard assets', None, r'Loans and Advances'), 'gnpa': ('PART9C', r'^3\. Total NPAs', None, r'Loans and Advances'),
         'slip': ('PART9A', r'^I\. Gross Advances', None, r'^New Accretion'), 'wo': ('PART9A', r'^I\. Gross Advances', None, r'^Write-off amount'),
         'gold': ('PART9A', r'Advances to Individuals against Gold', None, r'^Total Advances'), 'mfi': ('PART9A', r'Micro finance loan', None, r'^Total Advances'),
         'restr': ('PART9E', r'^D\. Amount of Restructured Standard Loans', None, None)}
# items that are the sum of several lines: (part, label, column heading)
SUM01 = {'bank': [(P1, r'^\(iii\) Borrowings from Banks', None)], 'cp': [(P1, r'^\(vi\) Commercial paper', None)],
         'dpd30': [('PART10', r'Overdue for 30 to 60 days', r'^Loans'), ('PART10', r'Overdue more than 60 days', r'^Loans'), ('PART10', r'^B\. NON-PERFORMING', r'^Loans')]}
DERIVED = {'fa': lambda d: (d.get('loans') or 0) + (d.get('inv') or 0) + (d.get('cash') or 0),      # first estimate of financial assets; confirm with the auditor's working
           'osl': lambda d: (d.get('ta') or 0) - (d.get('eq') or 0) - (d.get('ccps') or 0) - (d.get('res') or 0), 'nw': lambda d: (d.get('eq') or 0) + (d.get('ccps') or 0) + (d.get('res') or 0) - (d.get('reval') or 0)}
NOT01 = ['grpx (exposure to group companies: Part 5 is a list of companies, add the totals by hand)', 'of, nof, t1, t2, rwa (DNBS03)', 'in1 to out3 (DNBS04B)', 'averages, sma2, Ind AS stages, single and group exposure, top20']

# ------------------------------------------------------------------ DNBS03 -> Ratio Model
T1 = r'Table 2\(i\)'
MAP03 = {'of': ('PART1', r'^\(x\) Owned Fund', T1, None), 'nof': ('PART1', r'^Net owned fund', T1, None), 't1': ('PART1', r'^Net owned fund', T1, None), 't2': ('PART2', r'^\(ix\) Aggregate Tier II', None, None),
         'rwa': ('PART5', r'^\(iii\) Total risk weighted', None, None), 'anw': ('PART1', r'^\(vii\) Adjusted Net Worth', r'Core Investment', None)}
SUM03 = {'intang': [('PART1', r'^\(vi\) Deferred Revenue Expenditure', None), ('PART1', r'^\(viii\) Other Intangible Assets', None)]}
REF03 = {'crar reported in the return': ('PART5', r'^\(c\) Total', None, None), 'total capital funds': ('PART2', r'^Total Capital Funds', None, None)}

# ------------------------------------------------------------------ DNBS04B -> ALM Model.  line of the model: labels in the Statement of Structural Liquidity that are added
OUT04 = {1: [r'^1\.\s*Capital', r'^2\.\s*Reserves & Surplus', r'^3\.\s*Gifts'], 2: [r'^\(i\) Bank Borrowings'], 3: [r'^4\.\s*Bonds & Notes', r'^\(x\) Non - Convertible Debentures', r'^\(xi\) Convertible Debentures'],
         4: [r'^\(ix\) Commercial Papers'], 5: [r'^\(ii\) Inter Corporate Deposits', r'^\(iii\) Loans from Related Parties'], 6: [r'^\(i\) Term Deposits from Public'],
         7: [r'^\(xii\) Subordinate Debt', r'^\(xiii\) Perpetual Debt Instrument'], 8: [r'^\(d\) Interest payable on deposits'],
         9: [r'^8\.\s*Statutory Dues', r'^\(e\) Provisions for Standard', r'^\(f\) Provisions for Non Performing', r'^\(g\) Provisions for Investment', r'^\(h\) Other Provisions'],
         10: [r'^\(i\)\s*Loan commitments pending disbursal', r'^\(ii\)\s*Lines of credit committed to other']}
IN04 = {1: [r'^1\.\s*Cash', r'^2\.\s*Remittance in Transit', r'^3\.\s*Balances With Banks'], 2: [r'^\(i\)\s*Statutory Investments', (r'^\(a\) Current', 0)],
        4: [r'^\(iii\) Interest to be serviced through regular', r'^\(iv\) Interest to be serviced to be in Bullet'], 5: [r'^6\.\s*Gross Non-Performing Loans'],
        7: [r'^\(i\)\s*Loan committed by other institution', r'^\(ii\)\s*Lines of credit committed by other'], 8: [r'^7\.\s*Inflows From Assets On Lease', r'^8\.\s*Fixed Assets', r'^9\.\s*Other Assets']}
TOTOUT, TOTIN, INVEST, ADV = r'^A\.\s*TOTAL OUTFLOWS', r'^B\.\s*TOTAL INFLOWS', r'^4\.\s*Investments', r'^5\.\s*Advances \(Performing\)'
BUCKETS = [r'^0 day to 7', r'^8 days to 14', r'^15 days to 30', r'one month and upto 2', r'two months and upto 3', r'3 months and upto 6', r'6 months and upto 1 year', r'1 year and upto 3', r'3 years and upto 5', r'^Over 5 years']


def _bucket_cols(line):
    """Column codes of the ten time buckets of a line, found by their headings (the 'actual outflow' columns at the far right are left out)."""
    cols = []
    for rx in BUCKETS:
        hit = [x for x in _order(line) if re.search(rx, line['heads'].get(x, ''), re.I) and 'Actual' not in line['heads'].get(x, '')]
        cols.append(hit[0] if hit else None)
    return cols


def _row(ls, part, spec):
    rx, nth = spec if isinstance(spec, tuple) else (spec, 0)
    l = find(ls, part, rx, nth=nth)
    if l is None: return None
    return [(l['vals'].get(x) or 0) if x else 0 for x in _bucket_cols(l)]


def _add(ls, part, specs, miss):
    tot = [0.0] * 10
    for sp in specs:
        r = _row(ls, part, sp)
        if r is None: miss.append(sp[0] if isinstance(sp, tuple) else sp)
        else: tot = [a + b for a, b in zip(tot, r)]
    return tot


def extract_ratio(path, ytd=False):
    """ytd=True takes the cumulative column of the profit and loss part (amount since 1 April) where the return has one; otherwise the first column."""
    ls = lines(path); f = form(path); d = {}; miss = []
    if f == 'DNBS04B':
        for nm, rx in (('out', TOTOUT), ('in', TOTIN)):
            r = _row(ls, 'SLS', rx)
            if r is None: miss.append(nm)
            else:
                for k in range(3): d['%s%d' % (nm, k + 1)] = r[k]
        return d, miss, []
    if f == 'DNBS02':
        import read_dnbs as OLD
        mp = {k: (p, rx, None, None) for k, (p, rx, i) in OLD.MAP02.items()}; mp['fee'] = ('PART3', r'^Total Fee[- ]Based Income', None, None); sm = {k: [(p, rx, None)] for k, (p, rx) in OLD.SUMS02.items()}
    else: mp, sm = (MAP01, SUM01) if f == 'DNBS01' else (MAP03, SUM03)
    for k, (part, rx, tb, col) in mp.items():
        if ytd and part == 'PART3' and col is None: col = r'Cumulative'
        v = value(find(ls, part, rx, tb), col)
        if v is None: miss.append(k)
        else: d[k] = v
    for k, parts in sm.items():
        vs = []
        for part, rx, col in parts:
            vs += [value(l, col) for l in ls if l['part'] == part and re.search(_rx(rx), l['label'], re.I)]
        vs = [v for v in vs if v is not None]
        if vs: d[k] = sum(vs)
        else: miss.append(k)
    if f in ('DNBS01', 'DNBS02'):
        for k, fn in DERIVED.items(): d[k] = round(fn(d), 4)
    ref = [(k, value(find(ls, p, rx, tb), col)) for k, (p, rx, tb, col) in REF03.items()] if f == 'DNBS03' else []
    return d, miss, ref


def extract_alm(path):
    ls = lines(path); d = {}; miss = []
    out = {k: _add(ls, 'SLS', v, miss) for k, v in OUT04.items()}; inn = {k: _add(ls, 'SLS', v, miss) for k, v in IN04.items()}
    tout, tin, inv, adv = (_row(ls, 'SLS', rx) for rx in (TOTOUT, TOTIN, INVEST, ADV))
    for nm, v in (('total outflows', tout), ('total inflows', tin), ('investments', inv), ('advances', adv)):
        if v is None: miss.append(nm)
    z = [0.0] * 10; tout, tin, inv, adv = tout or z, tin or z, inv or z, adv or z
    inn[6] = [a - b for a, b in zip(inv, inn[2])]                                   # other investments = all investments less the liquid part
    inn[3] = [a - b for a, b in zip(adv, inn[4])]                                   # principal = performing advances less the interest lines
    out[11] = [t - sum(out[k][j] for k in range(1, 11)) for j, t in enumerate(tout)]  # other outflows: balance, so that the total equals the return
    inn[9] = [t - sum(inn[k][j] for k in range(1, 9)) for j, t in enumerate(tin)]
    for k in range(1, 12):
        for j in range(10): d['liq.out.%d.%d' % (k, j + 1)] = round(out[k][j], 4)
    for k in range(1, 10):
        for j in range(10): d['liq.in.%d.%d' % (k, j + 1)] = round(inn[k][j], 4)
    for nm, rx in (('rsl', TOTOUT), ('rsa', TOTIN)):
        r = _row(ls, 'IRS', rx)
        if r is None: miss.append('rate.' + nm)
        else:
            for j in range(10): d['rate.%s.%d' % (nm, j + 1)] = round(r[j], 4)
    chk = dict(outflows=sum(tout), inflows=sum(tin), other_out=sum(out[11]), other_in=sum(inn[9]))
    return d, miss, chk


def extract_stdl(path):
    ls = lines(path); d = {}; miss = []
    for nm, rx in (('out', r'^TOTAL OUTFLOWS'), ('in', r'^TOTAL INFLOWS'), ('mis', r'^C\. Mismatch'), ('cum', r'^D\. Cumulative mismatch')):
        l = find(ls, 'STDL', rx)
        if l is None: miss.append(nm); continue
        xs = _order(l)
        for j, x in enumerate(xs[:5]): d['stdl.%s.%d' % (nm, j + 1)] = l['vals'].get(x)
        d.setdefault('stdl.buckets', [l['heads'].get(x, '') for x in xs[:5]])
    return d, miss


def _setup(data, m, date_key='setup.date'):
    if m.get('InstitutionName'): data['setup.company'] = m['InstitutionName']
    if m.get('End Date') and '/' in str(m['End Date']):
        dd, mm, yy = str(m['End Date']).split('/'); data[date_key] = '%s-%s-%s' % (yy, mm, dd)
    sc = str(m.get('Default Scale') or '').lower(); data['setup.units'] = '₹ lakh' if 'lakh' in sc else ('₹ crore' if 'crore' in sc else '₹')


if __name__ == '__main__':
    path, mode = sys.argv[1], sys.argv[2]
    if mode == 'list':
        for l in lines(path): print('%s | %s | %s | %s | %s' % (l['part'], l['table'][:40], l['y'], l['label'][:80], {x: l['vals'][x] for x in sorted(l['vals'])[:4]}))
        sys.exit()
    m = meta(path)
    try: data = json.load(open(sys.argv[3]))
    except Exception: data = {}
    if mode == 'ratio':
        per = sys.argv[4]; d, miss, ref = extract_ratio(path, ytd='--ytd' in sys.argv)
        for k, v in d.items(): data['data.%s.%s' % (k, per)] = v
        if per == 'cur' and m['form'] in ('DNBS01', 'DNBS02'): _setup(data, m)
        print('return:', m['form'], '| items filled:', len(d), '| not found (enter by hand):', miss)
        if m['form'] == 'DNBS01': print('not in this return:', '; '.join(NOT01))
        for k, v in ref: print('for reconciliation –', k, ':', v)
    elif mode == 'alm':
        d, miss, chk = extract_alm(path); data.update(d); _setup(data, m)
        print('return:', m['form'], '| values written:', len(d), '| labels not found:', miss)
        print('total outflows %.2f, of which placed in "Other outflows" %.2f | total inflows %.2f, of which placed in "Other inflows" %.2f' % (chk['outflows'], chk['other_out'], chk['inflows'], chk['other_in']))
    elif mode == 'stdl':
        d, miss = extract_stdl(path); data.update(d)
        print('return:', m['form'], '| values written:', len(d), '| not found:', miss)
    else: raise SystemExit('mode must be list, ratio, alm or stdl')
    json.dump(data, open(sys.argv[3], 'w'), indent=0, ensure_ascii=False)
