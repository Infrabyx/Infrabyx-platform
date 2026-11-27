"""Read a filled DNBS return (RBI Excel utility file) and produce client data for the ratio model.
Usage: python3 read_dnbs.py <DNBS file.xlsx> <period: cur|prev|ly> <client_data.json> [--list]
The reader takes every row of every "DNBS..." sheet: the visible label and the first number on the row. It then matches labels to the
items of the ratio model with the table below. Items not found stay blank for manual entry; the script prints what it filled and what it did not.
--list prints every label and value read, which is the starting point for mapping another return (DNBS01, DNBS03, DNBS04)."""
import sys, json, re
from openpyxl import load_workbook


def rows(path):
    wb = load_workbook(path, data_only=True); out = []
    for ws in wb.worksheets:
        if not ws.title.upper().startswith('DNBS'): continue
        part = ws.title.split('_')[-1].upper()
        for row in ws.iter_rows():
            lab = None; nums = []
            for c in row:
                v = c.value
                if isinstance(v, str):
                    t = ' '.join(v.split())
                    if t and '.xsd#' not in t and not t.startswith('#') and ':~:' not in t and t != 'terseLabel' and lab is None and len(t) > 1: lab = t
                elif isinstance(v, (int, float)) and not isinstance(v, bool): nums.append(v)
            if lab and nums: out.append((part, lab, nums))
    return out


def meta(path):
    wb = load_workbook(path, data_only=True); m = {}
    if 'StartUp' in wb.sheetnames:
        for row in wb['StartUp'].iter_rows(values_only=True):
            v = [x for x in row if x is not None]
            for i, x in enumerate(v[:-1]):
                if x in ('InstitutionName', 'End Date', 'Default Scale', 'Form Name', 'Reportingcurrency') and x not in m: m[x] = v[i + 1]
    return m


# item code of the ratio model -> (return part, regular expression on the label, which number on the row)
MAP02 = {'eq': ('PART1', r'^\(i\) Ordinary Shares', 0), 'ccps': ('PART1', r'Compulsory Convertible Preference', 0), 'res': ('PART1', r'^3\. Reserves and Surplus', 0), 'reval': ('PART1', r'Revaluation Reserves', 0),
         'borr': ('PART1', r'^Total Borrowings', 0), 'sub': ('PART1', r'Subordinated Debts', 0), 'b3': ('PART1', r'payable less than or equal to 3 months', 0), 'b12': ('PART1', r'more than 3 months but less than or equal to 12', 0),
         'ta': ('PART1', r'^Total \(2\+3\+4\+5\+6\+7\+8\)', 0), 'stdprov': ('PART1', r'Provision for Standard Assets', 0), 'npaprov': ('PART1', r'Provisions Held for Non-Performing', 0),
         'loans': ('PART2', r'^1\. Loans & Advances', 0), 'sec': ('PART2', r'^\(i\) Secured', 0), 'unsec': ('PART2', r'^\(ii\) Unsecured', 0), 'inv': ('PART2', r'^4\. Total Investments', 0), 'cash': ('PART2', r'^5\. Cash and Bank Balances', 0),
         'inc': ('PART3', r'^C\. Total Income', 0), 'finc': ('PART3', r'^A\. Income from Financial Business', 0), 'ii': ('PART3', r'^\(iv\) Interest Income', 0), 'fee': ('PART3', r'^Total Fee Based Income', 0),
         'ie': ('PART3', r'^2\. Interest Expense and Other Financing', 0), 'opex': ('PART3', r'^10\. Operating Expenses', 0), 'pat': ('PART3', r'^3\. Net Profit', 0),
         'of': ('PART4', r'^\(vi\) Owned Fund', 0), 'nof': ('PART4', r'^Net owned fund', 0), 'grpx': ('PART4', r'^\(ix\) Total', 0), 'cme': ('PART6', r'^Total Capital Market Exposure', 0), 'cre': ('PART6', r'^A\.1\.2 Commercial Real Estate', 0),
         'gold': ('PART8', r'Advances to Individuals against Gold', 0), 'mfi': ('PART8', r'Micro finance loan', 0)}
SUMS02 = {'bank': ('PART1', r'^\(iii\) Borrowings from Banks'), 'cp': ('PART1', r'^\(v\) Commercial Paper'), 'intang': ('PART4', r'Other Intangible Assets|Deferred Revenue Expenditure')}
DERIVED = {'fa': lambda d: (d.get('loans') or 0) + (d.get('inv') or 0) + (d.get('cash') or 0),  # first estimate of financial assets; confirm with the auditor's working
           'osl': lambda d: (d.get('ta') or 0) - (d.get('eq') or 0) - (d.get('ccps') or 0) - (d.get('res') or 0), 'nw': lambda d: (d.get('eq') or 0) + (d.get('ccps') or 0) + (d.get('res') or 0) - (d.get('reval') or 0)}


def extract(path):
    rs = rows(path); d = {}; miss = []
    for k, (part, rx, i) in MAP02.items():
        hit = [n for p, lab, n in rs if p == part and re.search(rx, lab, re.I)]
        if hit and len(hit[0]) > i: d[k] = hit[0][i]
        else: miss.append(k)
    for k, (part, rx) in SUMS02.items():
        hit = [n[0] for p, lab, n in rs if p == part and re.search(rx, lab, re.I)]
        if hit: d[k] = sum(hit)
    for k, fn in DERIVED.items(): d[k] = round(fn(d), 4)
    return d, miss


if __name__ == '__main__':
    if '--list' in sys.argv:
        for p, lab, n in rows(sys.argv[1]): print('%s | %s | %s' % (p, lab[:90], n[:4]))
        sys.exit()
    d, miss = extract(sys.argv[1]); per = sys.argv[2]; m = meta(sys.argv[1])
    if miss:      # e.g. a return downloaded from the portal, which has no row codes: read_dnbs_more.py reads both layouts
        import subprocess, os
        print('%d items not found by this reader; the return is read by read_dnbs_more.py instead' % len(miss))
        sys.exit(subprocess.call([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'read_dnbs_more.py'), sys.argv[1], 'ratio', sys.argv[3], per]))
    try: data = json.load(open(sys.argv[3]))
    except Exception: data = {}
    for k, v in d.items(): data['data.%s.%s' % (k, per)] = v
    if per == 'cur':
        if m.get('InstitutionName'): data['setup.company'] = m['InstitutionName']
        if m.get('End Date'): dd, mm, yy = str(m['End Date']).split('/'); data['setup.date'] = '%s-%s-%s' % (yy, mm, dd)
        sc = str(m.get('Default Scale') or m.get('Reportingcurrency') or '').lower()
        data['setup.units'] = '₹ lakh' if 'lakh' in sc else ('₹ crore' if 'crore' in sc else '₹')
    json.dump(data, open(sys.argv[3], 'w'), indent=0, ensure_ascii=False)
    print('return:', m.get('Form Name'), '| items filled:', len(d), '| not found (enter by hand):', miss)
