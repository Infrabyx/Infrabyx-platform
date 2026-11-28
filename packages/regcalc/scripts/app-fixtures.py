"""A second, synthetic oracle for the APP-M01 applicability engine (R1-D-311, R1-D-324).

It fills a copy of the filed APP-M01 master with a synthetic profile and line answers (no real
entity), lets LibreOffice Calc recalculate the owner's formulas, and writes the recalculated copy to
src/__tests__/fixtures/ with its SHA-256 in SHA256SUMS. The oracle test reads it like the owner's
worked example: every formula cell is asserted. The sector engines APP-M02 to APP-M07 no longer have
synthetic oracles: the owner's worked examples, recalculated in Excel, replaced them (R1-D-324).

Run from the repository root (needs openpyxl and LibreOffice's `soffice` on the PATH):
    python3 -I packages/regcalc/scripts/app-fixtures.py
"""
import hashlib, os, shutil, subprocess, sys, tempfile
import openpyxl

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
MODELS = os.path.join(ROOT, 'docs', 'regulatory-models')
OUT = os.path.join(ROOT, 'packages', 'regcalc', 'src', '__tests__', 'fixtures')
M01 = '01 NBFC Models/Registration, Exemptions and Framework for Scale Based Regulation/Applicability Engine/APP-M01 Applicability Engine Master Model.xlsx'


def filed(rel):
    """The path of `rel`, after checking it against the filed SHA256SUMS."""
    path = os.path.join(MODELS, rel)
    got = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    want = [l.split('  ')[0] for l in open(os.path.join(MODELS, 'SHA256SUMS'), encoding='utf-8') if l.rstrip('\n').endswith('  ./' + rel)]
    if want != [got]:
        sys.exit('%s is not the filed copy' % rel)
    return path


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
with open(os.path.join(OUT, 'SHA256SUMS'), 'w', encoding='utf-8') as f:
    for path in made:
        f.write('%s  %s\n' % (hashlib.sha256(open(path, 'rb').read()).hexdigest(), os.path.basename(path)))
print('synthetic oracles written:', ', '.join(os.path.basename(m) for m in made))
