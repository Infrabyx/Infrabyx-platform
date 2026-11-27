"""Recalculate a workbook with LibreOffice (headless) and report formula errors. Usage: python3 recalc.py <file.xlsx> [sheet!cell ...]"""
import sys, os, subprocess, tempfile, shutil
from openpyxl import load_workbook


def recalc(path):
    d = tempfile.mkdtemp()
    subprocess.run(['soffice', '--headless', '--calc', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', d, path], capture_output=True, timeout=300)
    out = os.path.join(d, os.path.basename(path))
    wb = load_workbook(out, data_only=True)
    errs = []; nform = 0; blank = 0
    wf = load_workbook(path)
    for ws in wf.worksheets:
        wv = wb[ws.title]
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.startswith('='):
                    nform += 1; v = wv[c.coordinate].value
                    if isinstance(v, str) and v.startswith('#') or (isinstance(v, str) and v.startswith('Err:')):
                        errs.append((ws.title, c.coordinate, v, c.value[:90]))
                    if v is None: blank += 1
    return wb, nform, errs, blank


if __name__ == '__main__':
    wb, n, errs, blank = recalc(sys.argv[1])
    print('formulas', n, 'errors', len(errs), 'empty results', blank)
    for e in errs[:25]: print('  ', e)
    for a in sys.argv[2:]:
        sh, c = a.split('!'); print(a, '=', wb[sh][c].value)
