"""Carry the Handover figures of one model into the client data of the next.
Usage: python3 handover.py <source model (filled).xlsx> <target: stress|icaap> <client_data.json to update>
The Business Plan Model (BP-M01) has a Handover sheet in the same layout: use target icaap to carry its fifteen capital plan values.
The source workbook is recalculated with LibreOffice first, so it need not have been opened in Excel."""
import sys, json
import recalc

ECL_TO_STRESS = {'ecl.gross': 'base.gross', 'ecl.s3': 'base.s3', 'ecl.total': 'base.ecl', 'ecl.pd': 'base.pd', 'ecl.lgd': 'base.lgd'}


def read(path):
    wb, n, errs, blank = recalc.recalc(path)
    if errs:
        raise SystemExit('Formula errors in %s: %s' % (path, errs[:5]))
    ws = wb['Handover']; out = {}; seg = []
    for r in range(6, 60):
        k, v = ws.cell(r, 4).value, ws.cell(r, 3).value
        if isinstance(k, str) and '.' in k and ' ' not in k:
            out[k] = v
    if ws['B23'].value == 'Segment':                       # ECL segment table
        for i in range(15):
            row = [ws.cell(24 + i, c).value for c in range(2, 8)]
            seg.append(row)
    return out, seg


def carry(src, target, data):
    hv, seg = read(src)
    for k, v in hv.items():
        if target == 'stress':
            if k in ECL_TO_STRESS: data[ECL_TO_STRESS[k]] = v
        else:
            data[k.replace('_', '.')] = v
    for i, (nm, gross, s3, pd, lgd, ecl) in enumerate(seg, 1):
        if not gross: continue
        data.update({'seg.name.%d' % i: nm, 'seg.gross.%d' % i: gross, 'seg.s3.%d' % i: s3, 'seg.pd.%d' % i: pd, 'seg.lgd.%d' % i: lgd})
        if target == 'icaap': data['seg.ecl.%d' % i] = ecl
    return data


if __name__ == '__main__':
    d = json.load(open(sys.argv[3])); carry(sys.argv[1], sys.argv[2], d)
    json.dump(d, open(sys.argv[3], 'w'), indent=0, ensure_ascii=False); print('hand-over written to', sys.argv[3])
