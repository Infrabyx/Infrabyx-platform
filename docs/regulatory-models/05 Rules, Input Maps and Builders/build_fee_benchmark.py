"""Fee Benchmark Register for the Scope of Work catalogue (704 services, seven sectors).
Reads the Service Selector of the Quotation Builder (values only, no link) and writes a register in which market prices and LawDocs' own billing
are recorded and compared with the published fee ranges.  Run: python3 build_fee_benchmark.py <Quotation Builder.xlsx> <out.xlsx>"""
import sys
from openpyxl import load_workbook
from xl import *
from openpyxl.worksheet.formula import ArrayFormula


def af(sh, cell, formula, fmt):
    """Array formula (entered as with Ctrl+Shift+Enter), styled like a calculated cell."""
    sh.f(cell, '0', fmt); sh.ws[cell].value = ArrayFormula(cell, '=' + formula)

NI = 1500
qb = load_workbook(sys.argv[1], data_only=True)['Service Selector']
CAT = [(r[0], r[1], str(r[2]), r[3], r[5], r[6], r[7], r[8]) for r in qb.iter_rows(min_row=5, values_only=True) if r[0] and r[2]]
SECT = sorted({c[0] for c in CAT}); BASES = sorted({c[4] for c in CAT})
SRC = ['Competitor published price', 'Competitor quotation seen by a client', 'Tender or empanelment award', 'Price of a competitor that won against us', 'LawDocs invoice', 'LawDocs quotation won']
OWN = SRC[4:]; CMP = ['High', 'Medium', 'Low']; YN = ['Yes', 'No']

B = Book('FEE-B01', 'Fee Benchmark Register')
readme(B, 'Fee Benchmark Register',
       ['This workbook tests the indicative fee range of every service in the Scope of Work catalogue against prices seen in the market and against what LawDocs actually bills. For each service it shows how many comparable prices have been recorded, the market quartiles, a cost floor from the effort and the rate card, and a proposed lower, typical and upper fee.',
        'The catalogue (%d services in seven sectors) is copied as values from the Service Selector of the Quotation Builder; rebuild the register when the catalogue changes. The register proposes ranges; the Quotation Builder and the sector packs are changed only after review.' % len(CAT)],
       ['Setup: confirm the positioning factor, the minimum number of prices, the tolerance and the blended day rate.', 'Catalogue: enter the effort in days for the typical engagement of each service as it is estimated.',
        'Benchmark Input: record every price found or billed, one row each, with its source, comparability and basis.', 'Read Results and Sector Summary; clear the Checks sheet.', 'Change the ranges in the Quotation Builder and the sector packs (documents 3, 4 and 5) only for services marked "Change proposed", after review.'],
       [('Method Notes', 'how the proposal is worked out'), ('Setup', 'factors and rate'), ('Catalogue', 'services, current ranges and effort'), ('Benchmark Input', 'one row per price'), ('Results', 'quartiles, floor and proposed range'),
        ('Sector Summary', 'position by sector'), ('Rules', 'rules in one table'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

s = B.sheet('Setup', (74, 16, 60), tab='C00000')
s.title('Setup – factors and rate', 'Yellow cells are inputs; the starting values follow the pricing policy of fees a little below the market median.')
SR = {}
for r, lab, key, d, fmt, src in [(4, 'Positioning factor applied to the market quartiles (1.00 = at the market)', 'set.factor', 0.90, 'pct', 'Pricing policy: reasonable fees, a little below the market'),
                                 (5, 'Minimum number of comparable market prices before a change is proposed', 'set.min', 3, 'int', 'Method Notes, section 3'),
                                 (6, 'Tolerance: change of the typical fee below which the current range is kept', 'set.tol', 0.15, 'pct', 'Avoids churn in published ranges'),
                                 (7, 'Blended day rate for the cost floor (₹, excluding GST)', 'set.rate', 11000, 'int', 'Rate Card of the Quotation Builder: about 10% partner, 20% director, 30% manager, 40% associate time'),
                                 (8, 'Mark-up over cost for the floor (1.00 = cost only)', 'set.markup', 1.0, 'num', 'Pricing policy'),
                                 (9, 'Rounding of proposed fees (₹)', 'set.round', 500, 'int', 'As in the Quotation Builder'),
                                 (10, 'Prices older than this many months are left out', 'set.age', 24, 'int', 'Method Notes, section 2'),
                                 (11, 'Date of review', 'set.date', None, 'date', 'Date the register is read')]:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, d, fmt, src); s.lbl('C%d' % r, src); SR[key] = "'Setup'!$B$%d" % r
F_, MIN_, TOL, RATE, MK, RND, AGE, DT = (SR[k] for k in ('set.factor', 'set.min', 'set.tol', 'set.rate', 'set.markup', 'set.round', 'set.age', 'set.date'))

c = B.sheet('Catalogue', (30, 30, 7, 44, 18, 12, 12, 12, 12, 30), tab='BF9000')
c.title('Catalogue – services, current ranges and effort', 'Columns A to H are copied from the Quotation Builder. Enter the effort in days for the typical engagement in column I.')
c.head(5, ['Sector', 'Category', 'No.', 'Service', 'Fee basis', 'Current lower (₹)', 'Current typical (₹)', 'Current upper (₹)', 'Effort days (typical)', 'Key'])
C0 = 6; CE = C0 + len(CAT) - 1
for i, (sec, cat, no, nm, basis, lo, ty, up) in enumerate(CAT):
    r = C0 + i
    for col, v in zip('ABCDEFGH', (sec, cat, no, nm, basis, lo, ty, up)):
        x = c.ws['%s%d' % (col, r)]; x.value = v; x.border = BD; x.font = Font(name='Calibri', size=10); x.number_format = '#,##0' if col in 'FGH' else '@'
    x = c.ws['I%d' % r]; x.fill = YEL; x.protection = Protection(locked=False); x.border = BD; x.number_format = '0.0'
    c.f('J%d' % r, 'A%d&" | "&C%d' % (r, r), 'txt')
c.ws.freeze_panes = 'E6'
B.inputs.append(dict(key='effort', sheet='Catalogue', cell='I%d:I%d' % (C0, CE), label='Effort days for the typical engagement, one per service', source='Engagement leads; time records', default=None))
CR = lambda col: "'Catalogue'!$%s$%d:$%s$%d" % (col, C0, col, CE)

bi = B.sheet('Benchmark Input', (12, 30, 8, 30, 34, 12, 14, 10, 20, 30, 34, 14, 8, 8, 8, 8), tab='BF9000')
bi.title('Benchmark Input – one row per price', 'Enter the amount on the basis shown, exclusive or inclusive of GST as stated. Columns L to O are worked out.')
HEAD = ['Date of the price', 'Sector', 'Service no.', 'Source type', 'Source and reference (firm, document, link)', 'Comparability', 'Amount (₹)', 'GST included', 'Basis of the amount', 'Scope note (size, entity, inclusions)']
bi.head(5, HEAD + ['Key', 'Amount excluding GST (₹)', 'Counts as market', 'Counts as own', 'Usable', 'Basis matches'])
I0 = 6; IE = I0 + NI - 1
for r in range(I0, I0 + NI):
    for i in range(10):
        col = L(i + 1); x = bi.ws['%s%d' % (col, r)]; x.fill = YEL; x.protection = Protection(locked=False); x.border = BD; x.font = Font(name='Calibri', size=10)
        x.number_format = F['date'] if col == 'A' else ('#,##0' if col == 'G' else '@')
    on = 'B%d=""' % r
    bi.f('K%d' % r, 'IF(%s,"",B%d&" | "&C%d)' % (on, r, r), 'txt')
    bi.f('L%d' % r, 'IF(OR(%s,N(G%d)<=0),"",IF(H%d="Yes",G%d/1.18,G%d))' % (on, r, r, r, r), 'int')
    ok = 'IF(OR(L{0}="",COUNTIF(%s,K{0})<>1),FALSE,AND(I{0}=INDEX(%s,MATCH(K{0},%s,0)),F{0}<>"Low",OR(A{0}="",%s="",A{0}>=EDATE(%s,-%s))))'.format(r) % (CR('J'), CR('E'), CR('J'), DT, DT, AGE)
    bi.f('O%d' % r, 'IF(%s,"",IF(%s,1,0))' % (on, ok), 'int')
    bi.f('P%d' % r, 'IF(OR(%s,COUNTIF(%s,K%d)<>1),"",IF(I%d=INDEX(%s,MATCH(K%d,%s,0)),1,0))' % (on, CR('J'), r, r, CR('E'), r, CR('J')), 'int')
    bi.f('M%d' % r, 'IF(O%d="","",IF(AND(O%d=1,COUNTIF(%s,D%d)=0),1,0))' % (r, r, '\'Setup\'!$E$20:$E$21', r), 'int')
    bi.f('N%d' % r, 'IF(O%d="","",IF(AND(O%d=1,COUNTIF(%s,D%d)=1),1,0))' % (r, r, '\'Setup\'!$E$20:$E$21', r), 'int')
for col, items in (('B', SECT), ('D', SRC), ('F', CMP), ('H', YN), ('I', BASES)):
    dv = DataValidation(type='list', formula1="'Setup'!$%s$%d:$%s$%d" % (col_ := {'B': 'G', 'D': 'D', 'F': 'F', 'H': 'H', 'I': 'I'}[col], 30, col_, 29 + len(items)), allow_blank=True)
    bi.ws.add_data_validation(dv); dv.add('%s%d:%s%d' % (col, I0, col, IE))
bi.ws.freeze_panes = 'D6'
B.inputs.append(dict(key='bench', sheet='Benchmark Input', cell='A%d:J%d' % (I0, IE), label='Benchmark Input: ' + '; '.join(HEAD), source='Market research; client feedback; tender portals; LawDocs invoices', default=None))
# lists for validation (Setup, out of the way)
s.sec('A28', 'Lists used by the input sheet (do not change)', 9)
for col, items in (('G', SECT), ('D', SRC), ('F', CMP), ('H', YN), ('I', BASES)):
    for j, v in enumerate(items): s.ws['%s%d' % (col, 30 + j)] = v
s.lbl('D29', 'Source types'); s.lbl('E19', 'Own billing (not market):'); s.ws['E20'] = OWN[0]; s.ws['E21'] = OWN[1]
s.lbl('F29', 'Comparability'); s.lbl('G29', 'Sectors'); s.lbl('H29', 'GST included'); s.lbl('I29', 'Fee bases')
BR = lambda col: "'Benchmark Input'!$%s$%d:$%s$%d" % (col, I0, col, IE)

res = B.sheet('Results', (30, 7, 44, 16, 12, 12, 12, 8, 8, 12, 12, 12, 12, 12, 13, 13, 13, 11, 40), tab='00B050')
res.title('Results – market quartiles, cost floor and proposed range', 'Market quartiles use comparable prices (High and Medium) on the same basis as the service, within the age limit. All figures exclude GST.')
res.head(5, ['Sector', 'No.', 'Service', 'Fee basis', 'Current lower', 'Current typical', 'Current upper', 'Market prices', 'Own prices', 'Market 25th percentile', 'Market median', 'Market 75th percentile', 'Own median', 'Cost floor',
             'Proposed lower', 'Proposed typical', 'Proposed upper', 'Change in typical', 'Status'])
res.ws.freeze_panes = 'D6'
for i in range(len(CAT)):
    r = C0 + i; k = "'Catalogue'!$J$%d" % r
    for col, src in zip('ABCDEFG', 'ACDEFGH'): res.f('%s%d' % (col, r), "'Catalogue'!%s%d" % (src, r), 'num' if col in 'EFG' else 'txt')
    res.f('H%d' % r, 'COUNTIFS(%s,%s,%s,1)' % (BR('K'), k, BR('M')), 'int'); res.f('I%d' % r, 'COUNTIFS(%s,%s,%s,1)' % (BR('K'), k, BR('N')), 'int')
    sel = 'IF((%s=%s)*(%s=1),%s)' % (BR('K'), k, BR('M'), BR('L'))
    for col, p in (('J', 0.25), ('K', 0.5), ('L', 0.75)): af(res, '%s%d' % (col, r), 'IF(H%d=0,"",PERCENTILE(%s,%s))' % (r, sel, p), 'int')
    af(res, 'M%d' % r, 'IF(I%d=0,"",MEDIAN(IF((%s=%s)*(%s=1),%s)))' % (r, BR('K'), k, BR('N'), BR('L')), 'int')
    res.f('N%d' % r, "IF(N('Catalogue'!$I$%d)=0,\"\",'Catalogue'!$I$%d*%s*%s)" % (r, r, RATE, MK), 'int')
    rnd = lambda x: 'ROUND((%s)/%s,0)*%s' % (x, RND, RND)
    res.f('P%d' % r, 'IF(H%d<%s,"",%s)' % (r, MIN_, rnd('MAX(N(N%d),K%d*%s)' % (r, r, F_))), 'int')
    res.f('O%d' % r, 'IF(P%d="","",%s)' % (r, rnd('MIN(P%d,MAX(N(N%d),J%d*%s))' % (r, r, r, F_))), 'int')
    res.f('Q%d' % r, 'IF(P%d="","",%s)' % (r, rnd('MAX(P%d,L%d)' % (r, r))), 'int')
    res.f('R%d' % r, 'IF(OR(P%d="",N(F%d)=0),"",P%d/F%d-1)' % (r, r, r, r), 'pct')
    res.f('S%d' % r, 'IF(H%d<%s,"Keep current range – fewer comparable prices than the minimum",IF(ABS(R%d)<=%s,"Within tolerance – keep current range","Change proposed – review"))&IF(AND(N%d<>"",N(N%d)>N(E%d))," | cost floor above the current lower fee","")&IF(AND(M%d<>"",O%d<>"",N(M%d)<N(O%d))," | own billing below the proposed lower fee","")' % (r, MIN_, r, TOL, r, r, r, r, r, r, r), 'txt')
res.ws.conditional_formatting.add('S%d:S%d' % (C0, CE), FormulaRule(formula=['LEFT(S%d,6)="Change"' % C0], fill=PatternFill(fill_type='solid', start_color='FFC000', end_color='FFC000')))
RR = lambda col: "'Results'!$%s$%d:$%s$%d" % (col, C0, col, CE)

sm = B.sheet('Sector Summary', (42, 12, 16, 16, 16, 16), tab='00B050')
sm.title('Sector Summary – position by sector'); sm.head(4, ['Sector', 'Services', 'With enough market prices', 'Change proposed', 'Prices recorded', 'Average change in typical (where proposed)'])
for j, sec in enumerate(SECT):
    r = 5 + j; sm.lbl('A%d' % r, sec); sm.f('B%d' % r, 'COUNTIF(%s,A%d)' % (RR('A'), r), 'int'); sm.f('C%d' % r, 'COUNTIFS(%s,A%d,%s,">="&%s)' % (RR('A'), r, RR('H'), MIN_), 'int')
    sm.f('D%d' % r, 'COUNTIFS(%s,A%d,%s,"Change*")' % (RR('A'), r, RR('S')), 'int'); sm.f('E%d' % r, 'COUNTIF(%s,A%d)' % (BR('B'), r), 'int')
    sm.f('F%d' % r, 'IFERROR(AVERAGEIFS(%s,%s,A%d,%s,"Change*"),"")' % (RR('R'), RR('A'), r, RR('S')), 'pct')
rr = 5 + len(SECT); sm.lbl('A%d' % rr, 'Total', True)
for col in 'BCDE': sm.f('%s%d' % (col, rr), 'SUM(%s5:%s%d)' % (col, col, rr - 1), 'int', bold=True)

ru = B.sheet('Rules', (6, 34, 96, 40), tab='7030A0', protect=False)
ru.title('Rules – the method in one table'); ru.head(5, ['#', 'Rule', 'Logic', 'Source'])
RL = [('Comparable price', 'a price for the same service, on the same fee basis, with comparability High or Medium, not older than the age limit; Low is recorded but not counted', 'Method Notes, section 2'),
      ('Market and own prices', 'competitor prices, client-reported quotations, tender and empanelment awards and prices of competitors that won are market prices; LawDocs invoices and won quotations are own prices', 'Method Notes, section 2'),
      ('GST', 'amounts entered with GST are divided by 1.18', 'Quotation Builder: fees exclude GST'),
      ('Cost floor', 'effort days x blended day rate x mark-up', 'Rate Card'),
      ('Proposed typical', 'larger of the cost floor and the market median x positioning factor, rounded', 'Pricing policy'),
      ('Proposed lower', 'larger of the cost floor and the market 25th percentile x positioning factor, not above the typical', 'Pricing policy'),
      ('Proposed upper', 'larger of the market 75th percentile and the proposed typical (no positioning factor: complex work is priced at the market)', 'Pricing policy'),
      ('Decision', 'fewer comparable prices than the minimum: keep; change of the typical within the tolerance: keep; otherwise review and change the catalogue', 'Method Notes, section 4')]
for j, (a_, b_, c_) in enumerate(RL, 1):
    for col, v in zip('ABCD', (j, a_, b_, c_)): ru.lbl('%s%d' % (col, 5 + j), v)

mn = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
mn.title('Method Notes – how fee ranges are benchmarked')
mn.text_block(4, ['# 1. Why three sources', 'A fee range is credible when it agrees with what the market charges, with what the firm has actually billed and with what the work costs. Each source alone misleads: published prices of online compliance firms describe narrower work, tender awards are driven down by price-only evaluation, and the firm\'s own invoices repeat its past pricing. The register records all three and reads them together.',
 '# 2. Collecting prices', 'Record a price only where the scope can be compared with the service. Sources, in order of weight: quotations of other firms that a client has shown or described (High when the scope is the same); awards on tender and empanelment portals of banks, PSUs and regulators where the scope is published; prices published by online compliance firms (usually Medium, as scope is narrower); and the price at which a competitor won against LawDocs. Mark comparability High (same scope and entity size), Medium (close, with differences noted) or Low (indicative only, not counted). Enter the amount on the fee basis of the service; a monthly retainer is not compared with a yearly fee. Prices older than the age limit drop out, so the register stays current without deleting rows.',
 '# 3. Enough evidence', 'A change is proposed only when a service has at least the minimum number of comparable market prices (three by default). With fewer, the current range stays and the service is marked for more research. Services with the largest volumes or the most quotations sent are researched first.',
 '# 4. Proposing the range', 'The proposed typical fee is the market median multiplied by the positioning factor (0.90 by default, which places LawDocs a little below the market median, as the pricing policy asks), and never below the cost floor. The lower fee follows the 25th percentile in the same way. The upper fee is the 75th percentile without the factor, so complex or urgent work is priced at the market. A change of the typical fee within the tolerance (15 per cent) is not made, so that published ranges do not move with every new price.',
 '# 5. Reading own billing', 'Where the firm\'s own median is below the proposed lower fee, either the firm has been under-pricing or its work in that service is narrower than the market\'s: check the scope before raising the range. Where a cost floor is above the current lower fee, the service is not paying for itself at that end of the range.',
 '# 6. Cycle', 'Collect prices continuously; read the register every quarter with the win and loss log of quotations; change the published ranges once a year, in April, unless a service is clearly mispriced. A change is made in the Quotation Builder, in documents 3, 4 and 5 of the sector pack and in the marketplace prices together.',
 '# 7. Limits', 'The register holds %d price rows. It compares like with like only as well as the comparability marks are given; the scope note should say why a price is or is not comparable. It does not set discounts, packages or the positioning of a single quotation, which stay in the Quotation Builder.' % NI])

ck = B.sheet('Checks', (6, 84, 12, 56), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
kb = BR('K'); on = '(%s<>"")' % BR('B')
chk = [('The date of review is entered', '%s<>""' % DT, 'Complete Setup'),
       ('Every price row names a service of the catalogue', 'SUMPRODUCT(%s*(COUNTIF(%s,%s)=0))=0' % (on, CR('J'), kb), 'Correct the sector or the service number'),
       ('Every price row has an amount above zero', 'SUMPRODUCT(%s*(%s<=0))=0' % (on, BR('G')), 'Enter the amount'),
       ('Every price row has a source type, a comparability mark and a basis', 'SUMPRODUCT(%s*((%s="")+(%s="")+(%s="")))=0' % (on, BR('D'), BR('F'), BR('I')), 'Complete the row'),
       ('No price row is on a different basis from its service (such rows are left out)', 'COUNTIF(%s,0)=0' % BR('P'), 'Convert the amount to the basis of the service or mark it Low'),
       ('The positioning factor is between 0.5 and 1.2', 'AND(%s>=0.5,%s<=1.2)' % (F_, F_), 'Correct Setup')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C%d' % (5 + len(chk)))
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Catalogue', 'Benchmark Input', 'Results', 'Sector Summary', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[2])
print('Fee Benchmark Register built:', len(CAT), 'services,', NI, 'price rows')
