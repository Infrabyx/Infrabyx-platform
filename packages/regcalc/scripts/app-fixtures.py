"""Synthetic oracles for the applicability engines (R1-D-311).

The sector engines APP-M02 to APP-M07 are filed as unfilled masters written by openpyxl and never
recalculated: every formula cell has an empty cached value, so they hold no result to reproduce.
This script fills a copy of each filed master (and of the APP-M01 master) with a synthetic profile
and line answers (no real entity), lets LibreOffice Calc recalculate the owner's formulas, and
writes the recalculated copies to src/__tests__/fixtures/ with their SHA-256 in SHA256SUMS. The
oracle test reads them like the owner's worked example: every formula cell is asserted.

Run from the repository root (needs openpyxl and LibreOffice's `soffice` on the PATH):
    python3 -I packages/regcalc/scripts/app-fixtures.py
"""
import hashlib, os, shutil, subprocess, sys, tempfile
import openpyxl

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
MODELS = os.path.join(ROOT, 'docs', 'regulatory-models')
OUT = os.path.join(ROOT, 'packages', 'regcalc', 'src', '__tests__', 'fixtures')
SECTOR = {
    'app-m02': '02 Sector Applicability Engines/SEBI/APP-M02 Applicability Engine for SEBI Listed Entities.xlsx',
    'app-m03': '02 Sector Applicability Engines/SEBI/APP-M03 Applicability Engine for SEBI Market Intermediaries.xlsx',
    'app-m04': '02 Sector Applicability Engines/IFSCA/APP-M04 Applicability Engine for IFSCA Entities.xlsx',
    'app-m05': '02 Sector Applicability Engines/IRDAI/APP-M05 Applicability Engine for Insurance Intermediaries.xlsx',
    'app-m06': '02 Sector Applicability Engines/Co-operative Societies/APP-M06 Applicability Engine for Co-operative Societies.xlsx',
    'app-m07': '02 Sector Applicability Engines/Payments and Fintech/APP-M07 Applicability Engine for Payment System Operators and Fintech Entities.xlsx',
}
M01 = '01 NBFC Models/Registration, Exemptions and Framework for Scale Based Regulation/Applicability Engine/APP-M01 Applicability Engine Master Model.xlsx'


def filed(rel):
    """The path of `rel`, after checking it against the filed SHA256SUMS."""
    path = os.path.join(MODELS, rel)
    got = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    want = [l.split('  ')[0] for l in open(os.path.join(MODELS, 'SHA256SUMS'), encoding='utf-8') if l.rstrip('\n').endswith('  ./' + rel)]
    if want != [got]:
        sys.exit('%s is not the filed copy' % rel)
    return path


def sector(name, rel, k):
    wb = openpyxl.load_workbook(filed(rel))
    p = wb['Profile']
    cats = []
    while p['D%d' % (4 + len(cats))].value:      # the category list: codes in D, labels in E
        cats.append(p['E%d' % (4 + len(cats))].value)
    p['B4'] = 'Synthetic entity %s (test data)' % name.upper()
    p['B5'] = '2026-03-31'
    p['B6'] = cats[k % len(cats)]
    q0 = next(r for r in range(1, 60) if p['A%d' % r].value == 'Key')
    r = q0 + 1
    while p['A%d' % r].value:
        p['C%d' % r] = ['Yes', 'No', 'In part', None][(r + k) % 4]
        r += 1
    po = wb['Policies']
    r, cond = 7, 0
    while po['A%d' % r].value is not None:
        if any(c.value and 'Conditional' in str(c.value) for c in [po['J%d' % r]]):
            cond += 1
            if cond % 3 == 0:
                po['K%d' % r] = ['Yes', 'No'][cond % 2]
        if r % 17 == 0:
            po['M%d' % r] = ['Applies', 'Good practice', 'Does not apply'][r % 3]
        po['O%d' % r] = ['Yes', 'Partly', 'No', None][r % 4]
        r += 1
    cm = wb['Committees and Roles']
    r = 7
    while cm['B%d' % r].value:
        cm['E%d' % r] = ['Yes', 'No', None][r % 3]
        r += 1
    return wb


def nbfc():
    wb = openpyxl.load_workbook(filed(M01))
    p = wb['Profile']
    answers = {4: 'Synthetic NBFC Limited (test data)', 5: '2026-03-31', 6: 'Upper Layer', 7: 'Core Investment Company', 8: 6400}
    for r in range(9, 51):
        answers[r] = ['Yes', 'No', 'No'][r % 3]
    for r, v in answers.items():
        p['B%d' % r] = v
    po = wb['Policies']
    r = 7
    while po['A%d' % r].value is not None:
        if r % 23 == 0:
            po['M%d' % r] = ['Applies', 'Does not apply'][r % 2]
        po['O%d' % r] = ['Yes', 'Partly', 'No', None][r % 4]
        r += 1
    cm = wb['Committees and Roles']
    for r in range(7, 37):
        cm['E%d' % r] = ['Yes', 'No', None][r % 3]
    rs = wb['Returns']
    for r in range(7, 23):
        rs['F%d' % r] = ['Yes', 'No', None][r % 3]
    return wb


def recalc(wb, name, tmp):
    src = os.path.join(tmp, name + '-synthetic.xlsx')
    wb.save(src)
    subprocess.run(['soffice', '--headless', '--calc', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', os.path.join(tmp, 'out'), src],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
    dst = os.path.join(OUT, name + '-synthetic.xlsx')
    shutil.copyfile(os.path.join(tmp, 'out', name + '-synthetic.xlsx'), dst)
    return dst


os.makedirs(OUT, exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    made = [recalc(nbfc(), 'app-m01', tmp)]
    for k, (name, rel) in enumerate(SECTOR.items()):
        made.append(recalc(sector(name, rel, k), name, tmp))
with open(os.path.join(OUT, 'SHA256SUMS'), 'w', encoding='utf-8') as f:
    for path in made:
        f.write('%s  %s\n' % (hashlib.sha256(open(path, 'rb').read()).hexdigest(), os.path.basename(path)))
print('synthetic oracles written:', ', '.join(os.path.basename(m) for m in made))
