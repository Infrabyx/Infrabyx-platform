import re
"""Shared helpers for the ECL, Stress Testing and ICAAP master models (formula-only workbooks, no macros).
Every input cell is light yellow, unlocked and registered with a key, so that a client data file (JSON) can be written into the model by fill_model.py."""
import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, Protection
from openpyxl.utils import get_column_letter as L
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.worksheet.datavalidation import DataValidation

NAVY = '1F3864'
YEL = PatternFill('solid', fgColor='FFF9C4')
HDR = PatternFill('solid', fgColor=NAVY)
SUB = PatternFill('solid', fgColor='D9E1F2')
OUT = PatternFill('solid', fgColor='E2EFDA')
GRN = PatternFill('solid', start_color='63BE7B', end_color='63BE7B')   # both colours: Excel reads the background colour of a conditional-format fill
AMB = PatternFill('solid', start_color='FFC000', end_color='FFC000')   # both colours: Excel reads the background colour of a conditional-format fill
RED = PatternFill('solid', start_color='F8696B', end_color='F8696B')   # both colours: Excel reads the background colour of a conditional-format fill
GREY = PatternFill('solid', fgColor='F2F2F2')
thin = Side(style='thin', color='BFBFBF')
BD = Border(left=thin, right=thin, top=thin, bottom=thin)
F = {'pct': '0.00%', 'num': '#,##0.00', 'int': '#,##0', 'x': '0.00"x"', 'date': 'DD-MMM-YYYY', 'txt': '@', 'p4': '0.0000%', 'n4': '0.0000'}


def q(sheet, cell):
    return "'%s'!%s" % (sheet, cell)


def div(a, b):
    return 'IF((%s)=0,0,(%s)/(%s))' % (b, a, b)


GUARD = [None]   # optional formula that is TRUE while the workbook has no data; RAG cells then stay blank


def _g(f):
    return 'IF(%s,"",%s)' % (GUARD[0], f) if GUARD[0] else f


def rag_hi_bad(v, amber, red):
    """RED when value >= red, AMBER when >= amber (higher is worse)."""
    return _g('IF((%s)>=(%s),"RED",IF((%s)>=(%s),"AMBER","GREEN"))' % (v, red, v, amber))


def rag_lo_bad(v, amber, red):
    """RED when value < red, AMBER when < amber (lower is worse)."""
    return _g('IF((%s)<(%s),"RED",IF((%s)<(%s),"AMBER","GREEN"))' % (v, red, v, amber))


class Book:
    def __init__(self, code, name):
        self.wb = Workbook(); self.wb.remove(self.wb.active)
        self.code, self.name = code, name
        self.inputs = []   # dicts: key, sheet, cell, label, source, default

    def sheet(self, title, widths=(), tab=None, protect=True):
        ws = self.wb.create_sheet(title)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[L(i)].width = w
        if tab: ws.sheet_properties.tabColor = tab
        ws.sheet_view.showGridLines = False
        if protect:
            ws.protection.sheet = True
            ws.protection.formatColumns = False; ws.protection.formatRows = False; ws.protection.formatCells = False
        return Sheet(self, ws)

    def save(self, path, mapfile=None):
        plain_names(self)
        self.wb.save(path)
        if mapfile:
            json.dump(self.inputs, open(mapfile, 'w'), indent=0, ensure_ascii=False)


# Sheet names shown to the user are plain words (no underscores). Builders use the short internal names; they are replaced on save.
NAMES = {'In_Portfolio': 'Portfolio Input', 'In_LoanTape': 'Loan Tape Input', 'In_History': 'History Input', 'In_Defaults': 'Default History Input', 'In_LGD': 'Recovery Input', 'In_Macro': 'Scenario Input',
         'ECL_Calc': 'ECL Calculation', 'IRACP_Floor': 'Prudential Floor', 'In_Base': 'Base Data Input', 'ST_Credit': 'Credit Stress', 'ST_Concentration': 'Concentration Stress', 'ST_IRRBB': 'Interest Rate Stress',
         'ST_Liquidity': 'Liquidity Stress', 'ST_Other': 'Other Risks Stress', 'ST_Combined': 'Combined Result', 'ST_Reverse': 'Reverse Stress', 'Mgmt_Actions': 'Management Actions', 'In_Financials': 'Financials Input',
         'In_Capital': 'Capital Input', 'In_RWA': 'Risk Weighted Assets Input', 'In_Handover': 'Handover Input', 'Capital_Adequacy': 'Capital Adequacy', 'Risk_Universe': 'Risk Universe', 'P2_Credit': 'Credit Economic Capital',
         'P2_Concentration': 'Concentration Risk', 'P2_IRRBB': 'Interest Rate Risk', 'P2_Liquidity': 'Liquidity Risk', 'P2_Operational': 'Operational Risk', 'P2_Market': 'Market Risk', 'P2_Scorecards': 'Risk Scorecards',
         'Capital_Plan': 'Capital Plan', 'Risk_Appetite': 'Risk Appetite', 'Doc_Tables': 'Document Tables'}
_ORD = sorted(NAMES, key=len, reverse=True)
_KEY = re.compile(r'^[a-z0-9]+([._][a-z0-9]+)+$')


def plain(text):
    for k in _ORD:
        if k in text:
            text = text.replace(k, NAMES[k])
    return text.replace('Sheets starting with "In_" are input sheets', 'Sheets whose name ends with "Input" are input sheets').replace('"In_"', '"Input"')


def plain_names(book):
    for ws in book.wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, str):
                    if _KEY.match(v):
                        c.value = v.replace('_', '.')
                    elif '_' in v:
                        c.value = plain(v)
        for dv in ws.data_validations.dataValidation:
            if dv.formula1 and '_' in dv.formula1: dv.formula1 = plain(dv.formula1)
    for ws in book.wb.worksheets:
        if ws.title in NAMES: ws.title = NAMES[ws.title]
    for x in book.inputs:
        x['key'] = x['key'].replace('_', '.'); x['sheet'] = NAMES.get(x['sheet'], x['sheet'])
    left = [(ws.title, c.coordinate, c.value[:60]) for ws in book.wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str) and '_' in c.value]
    left += [(ws.title, 'title', '') for ws in book.wb.worksheets if '_' in ws.title]
    if left: print('UNDERSCORES LEFT:', len(left), left[:8])


class Sheet:
    def __init__(self, book, ws):
        self.b, self.ws, self.name = book, ws, ws.title

    def _c(self, cell, v, bold=False, fill=None, fmt=None, color=None, wrap=True, border=True, size=10, italic=False, align=None):
        c = self.ws[cell]; c.value = v
        c.font = Font(name='Calibri', size=size, bold=bold, color=color, italic=italic)
        c.alignment = Alignment(wrap_text=wrap, vertical='top', horizontal=align)
        if fill: c.fill = fill
        if fmt: c.number_format = F.get(fmt, fmt)
        if border: c.border = BD
        return c

    def title(self, text, sub=None):
        self._c('A1', text, bold=True, size=14, color=NAVY, border=False, wrap=False)
        if sub:
            self._c('A2', sub, italic=True, size=9, color='595959', border=False, wrap=False)
        self.ws.freeze_panes = 'A4'

    def head(self, row, labels, col=1):
        for i, t in enumerate(labels):
            self._c('%s%d' % (L(col + i), row), t, bold=True, fill=HDR, color='FFFFFF', align='center')
        self.ws.row_dimensions[row].height = 30

    def sec(self, cell, text, span=6):
        r = int(''.join(ch for ch in cell if ch.isdigit())); c0 = self.ws[cell].column
        for i in range(span):
            self._c('%s%d' % (L(c0 + i), r), text if i == 0 else None, bold=True, fill=SUB, color=NAVY, wrap=False)

    def lbl(self, cell, text, bold=False):
        self._c(cell, text, bold=bold)

    def note(self, cell, text):
        self._c(cell, text, italic=True, size=9, color='595959', border=False)

    def inp(self, cell, key, label, default=None, fmt='num', source='Manual input', lst=None):
        c = self._c(cell, default, fill=YEL, fmt=fmt)
        c.protection = Protection(locked=False)
        if lst:
            dv = DataValidation(type='list', formula1='"%s"' % ','.join(lst), allow_blank=True)
            self.ws.add_data_validation(dv); dv.add(cell)
        self.b.inputs.append(dict(key=key, sheet=self.name, cell=cell, label=label, source=source, default=default))

    def f(self, cell, formula, fmt='num', out=False, bold=False):
        self._c(cell, '=' + formula, fill=OUT if out else None, fmt=fmt, bold=bold or out)

    def rag(self, rng):
        for txt, fill in (('GREEN', GRN), ('AMBER', AMB), ('RED', RED)):
            self.ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"%s"' % txt], fill=fill, font=Font(bold=True)))
        for txt, fill in (('OK', GRN), ('CHECK', RED)):
            self.ws.conditional_formatting.add(rng, CellIsRule(operator='equal', formula=['"%s"' % txt], fill=fill, font=Font(bold=True)))

    def text_block(self, row, lines, col='A', width_cols=8):
        for t in lines:
            head = t.startswith('#')
            c = self._c('%s%d' % (col, row), t.lstrip('# '), bold=head, color=NAVY if head else None, border=False, size=11 if head else 10)
            self.ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=width_cols)
            n = len(t)
            self.ws.row_dimensions[row].height = max(15, 15 * (1 + n // 115))
            row += 1
        return row


def readme(book, title, purpose, steps, sheets_desc):
    s = book.sheet('ReadMe', (18, 18, 18, 18, 18, 18, 18, 18), tab=NAVY, protect=False)
    s.title(title, 'Master model – formula-only workbook (no macros). Works in Excel 2016 or later on Windows and Mac.')
    r = s.text_block(4, ['# Purpose'] + purpose + ['# Colour code',
        'Light yellow cells = inputs to be filled by the company (or filled automatically from the client data file). Every other cell is a formula or a label and is locked.',
        'Green / Amber / Red cells = results against the thresholds set on the Setup sheet. Light green cells = key results.',
        'Sheets starting with "In_" are input sheets. All other sheets calculate by themselves once the inputs are filled.',
        '# How to use – step by step'] + ['%d. %s' % (i + 1, x) for i, x in enumerate(steps)] + ['# Sheets in this workbook'] + ['%s – %s' % x for x in sheets_desc] + [
        '# Good to know',
        'Sheets are protected without a password only to prevent accidental overwriting of formulas (Review > Unprotect Sheet removes it).',
        'The model has no links to other files. Figures passed between the ECL, Stress Testing and ICAAP models are typed (or filled by the data-fill script) into the hand-over inputs.',
        'A risk type, segment or scenario that does not apply to the company is switched off on the Setup sheet; it then drops out of every calculation.',
        'This is a master. Risk slabs, thresholds, scenario severities, segments and weights are all inputs and must be reviewed and approved for each company before use.'])
    return s


def source_map(book):
    s = book.sheet('Source Map', (6, 20, 9, 46, 60, 28), tab='7F7F7F', protect=False)
    s.title('Source Map – where each input comes from', 'One row for every yellow input cell. "Key" is the name used by the data-fill script when it writes client data into this workbook.')
    s.head(4, ['#', 'Sheet', 'Cell', 'Input', 'Usual source (financial statements / DNBS return / internal MIS)', 'Key'])
    for i, x in enumerate(book.inputs, 1):
        for j, v in enumerate([i, x['sheet'], x['cell'], x['label'], x['source'], x['key']]):
            s._c('%s%d' % (L(j + 1), 4 + i), v, size=9)
    return s
