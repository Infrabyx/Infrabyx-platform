"""Add one line to the NBFC Policy Register in all three places that must stay in step:
the engine's data file (data/applicability_register.json), NBFC 6 Policy Register.xlsx and NBFC 6 Policy Register.docx.
Edit LINE below, then run from the models folder: python3 add_register_line.py
The serial number is the next free number; lines are never renumbered. A conditional line also needs a rule in the TR table of build_applicability.py."""
import json, os, copy
from openpyxl import load_workbook
from openpyxl.formatting.rule import Rule
import docx

HERE = os.path.dirname(os.path.abspath(__file__))
SOW = os.path.expanduser('~/mnt/Scope of Work/02 RBI - NBFCs & HFCs/')
# group, name, what it must cover, type, BL, ML, UL, applies to, legal basis, approval, review, disclosure, copy the Word row format from serial
LINE = ('Governance & Board', 'Compliance risk assessment and compliance testing programme',
        'Compliance universe by Direction and paragraph; annual compliance risk assessment (inherent risk, control rating, residual risk); risk-based testing plan; test programme with sampling and work-papers; issue tracker with ageing; reports to senior management and to the Board or Audit Committee.',
        'Mandatory', 'No', 'Yes', 'Yes', 'Middle and Upper Layer NBFCs',
        'RBI (Non-Banking Financial Companies – Compliance Function) Directions, 2026 (31 Jul 2026, RBI/DoS/2026-27/460), paras 6, 7, 9(3), 9(4), 15(2), 15(3)',
        'Senior management; review by Board / Audit Committee', 'Annual assessment; review at the periodicity prescribed by the Board (para 6)', 'None', '2')
grp, name, cover, typ, bl, ml, ul, applies, legal, appr, review, disc, like = LINE

# 1. engine data
jf = os.path.join(HERE, 'data', 'applicability_register.json'); d = json.load(open(jf)); P = d['policies']
if any(r[2] == name for r in P): raise SystemExit('line already present')
sn = str(max(int(r[0]) for r in P) + 1)
P.append([sn, grp, name, cover, typ, bl, ml, ul, bl, applies, legal, appr, review, disc]); json.dump(d, open(jf, 'w'), ensure_ascii=False, indent=0)

# 2. Excel register
xf = SOW + 'NBFC 6 Policy Register.xlsx'; wb = load_workbook(xf); ws = wb['Policy Register']; last = ws.max_row; new = last + 1
for c in ws[last]:
    n = ws.cell(row=new, column=c.column)
    n._style = copy.copy(c._style)
    if isinstance(c.value, str) and c.value.startswith('='): n.value = c.value.replace('%d' % last, '%d' % new)
ws.row_dimensions[new].height = ws.row_dimensions[last].height
for col, v in zip('ABCDEFGH', (int(sn) if isinstance(ws['A%d' % last].value, int) else sn, grp, name, cover, typ, bl, ml, ul)): ws['%s%d' % (col, new)] = v
for col, v in zip('JKLMN', (applies, legal, appr, review, disc)): ws['%s%d' % (col, new)] = v
ws['R%d' % new] = ws['R%d' % last].value
ws.auto_filter.ref = ws.auto_filter.ref.replace('%d' % last, '%d' % new)
for dv in ws.data_validations.dataValidation:
    s = str(dv.sqref)
    if s.endswith('%d' % last):
        from openpyxl.worksheet.cell_range import MultiCellRange
        dv.sqref = MultiCellRange(s.replace('%d' % last, '%d' % new))
old = list(ws.conditional_formatting._cf_rules.items()); ws.conditional_formatting._cf_rules.clear()
for rng, rules in old:
    for r in rules: ws.conditional_formatting.add(str(rng.sqref).replace('%d' % last, '%d' % new), r)
for sh in wb.worksheets:
    for row in sh.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith('=') and '$%d' % last in c.value and c.row != new: c.value = c.value.replace('$%d' % last, '$%d' % new)
wb.save(xf)

# 3. Word register
wf = SOW + 'NBFC 6 Policy Register.docx'; D = docx.Document(wf)


def settext(cell_or_par, text):
    runs = cell_or_par.runs if hasattr(cell_or_par, 'runs') else [r for p in cell_or_par.paragraphs for r in p.runs]
    runs[0].text = text
    for r in runs[1:]: r.text = ''


for t in D.tables:
    hit = [r for r in t.rows if r.cells[0].text.strip() == like and len(r.cells) == 8]
    if hit and t.rows[0].cells[1].text.startswith('Policy'):
        tr = copy.deepcopy(hit[0]._tr); t._tbl.append(tr); row = t.rows[-1]; c = row.cells
        settext(c[0], sn); p = c[1].paragraphs; settext(p[0], name); settext(p[1], cover); settext(p[2], 'Applies to: ' + applies)
        settext(c[2], typ); settext(c[6], legal); p = c[7].paragraphs; settext(p[0], appr); settext(p[1], 'Review: ' + review); settext(p[2], 'Disclosure: ' + disc)
        break
else: raise SystemExit('Word table not found')
kind = {'Mandatory': 2, 'Mandatory if activity undertaken': 3, 'Recommended': 4}[typ]


def bump(cell):
    r = [x for p in cell.paragraphs for x in p.runs][0]; r.text = str(int(r.text) + 1)


for t in D.tables:
    if t.rows[0].cells[0].text.strip() == 'Group':
        for r in t.rows:
            if r.cells[0].text.strip() in (grp, 'Total'): bump(r.cells[1]); bump(r.cells[kind])
    if len(t.rows) == 1 and 'policies, codes' in t.rows[0].cells[0].text:
        bump(t.rows[0].cells[0])
        if typ == 'Mandatory': bump(t.rows[0].cells[2])
D.save(wf)
print('added line', sn, '-', name)
