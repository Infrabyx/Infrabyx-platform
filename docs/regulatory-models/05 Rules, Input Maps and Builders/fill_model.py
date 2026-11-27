"""Write client data into a master model.
Usage: python3 fill_model.py <master.xlsx> <input_map.json> <client_data.json> <output.xlsx>
client_data.json is a flat dictionary {key: value}. Keys are listed on the 'Source Map' sheet of each model (last column).
Special key "tape": list of rows [loan id, segment, outstanding, DPD, undrawn, restructured Y/N, SICR Y/N] for the ECL loan tape.
Dates are written as ISO text 'YYYY-MM-DD' and converted. Unknown keys are reported, never silently dropped."""
import sys, json, datetime
from openpyxl import load_workbook


def fill(master, mapfile, data, out):
    wb = load_workbook(master)
    mp = {x['key']: x for x in json.load(open(mapfile))}
    unknown, done = [], 0
    for k, v in data.items():
        k = k.replace('_', '.')
        if k in mp and ':' in mp[k]['cell'] and isinstance(v, list):      # a table block (loan tape, loan table, borrower table)
            from openpyxl.utils.cell import range_boundaries
            c0, r0, c1, r1 = range_boundaries(mp[k]['cell']); ws = wb[mp[k]['sheet']]
            if len(v) > r1 - r0 + 1: raise SystemExit('%s: %d rows given, the sheet holds %d' % (k, len(v), r1 - r0 + 1))
            for i, row in enumerate(v):
                for j, val in enumerate(row):
                    if isinstance(val, str) and len(val) == 10 and val[4] == '-' and val[7] == '-':
                        try: val = datetime.date.fromisoformat(val)
                        except ValueError: pass
                    ws.cell(row=r0 + i, column=c0 + j, value=val)
            done += 1; continue
        if k not in mp:
            unknown.append(k); continue
        x = mp[k]
        if isinstance(v, str) and len(v) == 10 and v[4] == '-' and v[7] == '-' and k.endswith(('date', '.date')) and 'hist.' not in k:
            v = datetime.date.fromisoformat(v)
        wb[x['sheet']][x['cell']].value = v; done += 1
    wb.calculation.fullCalcOnLoad = True
    wb.save(out)
    return done, unknown


if __name__ == '__main__':
    d, u = fill(sys.argv[1], sys.argv[2], json.load(open(sys.argv[3])), sys.argv[4])
    print('inputs written:', d, '| unknown keys:', u)
