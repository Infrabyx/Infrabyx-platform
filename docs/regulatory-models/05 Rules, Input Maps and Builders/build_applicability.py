"""Applicability Engine for NBFCs: company profile -> policies, committees and roles, and returns that apply.
Run: python3 build_applicability.py <out.xlsx> <map.json> <data/applicability_register.json> [rules.json]
The register (policies with Base / Middle / Upper Layer applicability, condition and legal basis) is the NBFC Policy Register of the Scope of Work pack."""
import sys, json
from xl import *

REG = json.load(open(sys.argv[3]))
B = Book('APP-M01', 'Applicability Engine')
YN = ['Yes', 'No']
CATS = ['Investment and Credit Company', 'Microfinance Institution', 'Factor', 'Infrastructure Finance Company', 'Infrastructure Debt Fund', 'Housing Finance Company', 'Core Investment Company', 'Account Aggregator', 'Peer to Peer Lending Platform', 'Mortgage Guarantee Company', 'Other']
AREA = {'Governance & Board': '1. Board Governance and Strategy', 'Credit & Lending Conduct': '7. Fair Practices, Digital Lending and Customer Conduct', 'Customer Protection & Grievance': '7. Fair Practices, Digital Lending and Customer Conduct',
        'Risk, Capital & Liquidity': '3. Risk, Capital and Prudential Norms', 'Asset Quality, Recovery & Resolution': '14. NPA Management and Debt Recovery', 'AML / KYC & Fraud': '6. AML / KYC and Financial Crime', 'IT, Cyber & Data': '8. Technology, Cyber and Data Protection',
        'Outsourcing & Third Parties': '8. Technology, Cyber and Data Protection', 'Accounting, Audit & Disclosure': '9. Audit, Assurance and RBI Inspection', 'HR, Ethics & Corporate Law': '15. People, Training and Workplace Compliance', 'Listed NBFCs (SEBI LODR)': '11. Listed NBFCs – SEBI Interface'}

readme(B, 'Applicability Engine for NBFCs',
       ['This workbook turns the profile of an NBFC into the list of policies, committees, officers and returns that apply to it. Answer the questions on the Profile sheet; every line on the other sheets then shows "Applies", "Does not apply" or "Good practice", with the condition and the legal basis.',
        'The same profile questions are used in the Entity Profile of the scope of work pack, so that the engagement scope, the policy register and the compliance tool start from one set of answers.'],
       ['Profile: answer every question (yellow cells). Enter total assets in ₹ crore.',
        'Policies: read the result for each policy. Use "Override" only with a recorded reason. Fill "In place?" to see the gaps.',
        'Committees and Roles, Returns: read what the company must have and file.',
        'Dashboard: read the counts by group, the gaps and the thresholds crossed.'],
       [('Method Notes', 'explains how applicability is decided'), ('Profile', 'the questions'), ('Policies', 'policies, codes and frameworks'), ('Committees and Roles', 'committees and officers'), ('Returns', 'supervisory returns'),
        ('Dashboard', 'summary and gaps'), ('Rules', 'the rules in one table for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

# ------------------------------------------------------------------ Profile
p = B.sheet('Profile', (70, 30, 44), tab='C00000')
p.title('Profile – questions about the company', 'Yellow cells are inputs. These answers decide what applies.')
Q = [('name', 'Company name', 'Name of the NBFC', 'txt', None), ('date', 'Profile as on', None, 'date', None), ('layer', 'Regulatory layer', 'Base Layer', 'txt', ['Base Layer', 'Middle Layer', 'Upper Layer']), ('cat', 'Category of NBFC', CATS[0], 'txt', CATS),
     ('assets', 'Total assets as per the latest audited balance sheet (₹ crore)', None, 'num', None), ('DEP', 'Accepts public deposits', 'No', 'txt', YN), ('PF', 'Avails public funds (bank borrowings, debentures, commercial paper, inter-corporate deposits)', 'Yes', 'txt', YN),
     ('CUST', 'Has customer interface', 'Yes', 'txt', YN), ('PUB', 'Public company within the thresholds for an Audit Committee and Nomination and Remuneration Committee under the Companies Act, 2013', 'No', 'txt', YN),
     ('LEQ', 'Equity shares listed', 'No', 'txt', YN), ('LDEBT', 'Non-convertible securities listed', 'No', 'txt', YN), ('TOP', 'Among the top 1,000 listed entities by market capitalisation', 'No', 'txt', YN), ('INDAS', 'Prepares financial statements under Ind AS', 'No', 'txt', YN),
     ('SUBS', 'Has subsidiaries or group entities', 'No', 'txt', YN), ('BR10', 'Has ten or more branches', 'No', 'txt', YN), ('E20', 'Employs 20 or more workers', 'Yes', 'txt', YN), ('E300', 'Employs 300 or more workers', 'No', 'txt', YN),
     ('CSR', 'Meets the thresholds of section 135(1) of the Companies Act, 2013 (corporate social responsibility)', 'No', 'txt', YN), ('DIV', 'Declares or proposes to declare dividend', 'No', 'txt', YN),
     ('SECURED', 'Lends against security (movable or immovable property)', 'Yes', 'txt', YN), ('DL', 'Lends through digital lending apps or lending service providers', 'No', 'txt', YN), ('DLG', 'Has default loss guarantee arrangements', 'No', 'txt', YN),
     ('PROJ', 'Lends to projects or real estate', 'No', 'txt', YN), ('LAS', 'Lends against shares or finances initial public offers', 'No', 'txt', YN), ('GOLD', 'Lends against gold or silver', 'No', 'txt', YN), ('MF', 'Extends microfinance loans or loans to self-help groups', 'No', 'txt', YN),
     ('CALL', 'Grants demand or call loans', 'No', 'txt', YN), ('NFB', 'Offers non-fund-based facilities (guarantees, letters of credit)', 'No', 'txt', YN), ('PCE', 'Provides partial credit enhancement', 'No', 'txt', YN), ('CARD', 'Issues credit cards', 'No', 'txt', YN),
     ('FACT', 'Undertakes factoring', 'No', 'txt', YN), ('COL', 'Has co-lending arrangements', 'No', 'txt', YN), ('SECO', 'Originates securitisation transactions', 'No', 'txt', YN), ('SECI', 'Invests in securitisation notes', 'No', 'txt', YN),
     ('LT', 'Transfers or acquires loan exposures', 'No', 'txt', YN), ('SLT', 'Transfers or acquires stressed loans', 'No', 'txt', YN), ('DIST', 'Distributes insurance, mutual funds or other third-party products', 'No', 'txt', YN),
     ('FX2', 'Holds an Authorised Dealer Category II licence (forex services)', 'No', 'txt', YN), ('FCY', 'Has foreign-currency borrowings or assets', 'No', 'txt', YN), ('FEMA', 'Has foreign investment, external commercial borrowings or overseas investments', 'No', 'txt', YN),
     ('NCD', 'Raises funds by private placement of non-convertible debentures', 'No', 'txt', YN), ('IGO', 'Uses group entities as service providers', 'No', 'txt', YN), ('OFFSH', 'Outsources any activity outside India', 'No', 'txt', YN),
     ('RELIEF', 'Participates in Government debt relief schemes', 'No', 'txt', YN), ('SNFA', 'Acquires non-financial assets in settlement of dues', 'No', 'txt', YN), ('GREEN', 'Raises green deposits', 'No', 'txt', YN),
     ('API', 'Initiates fund transfers from its bank accounts through bank APIs', 'No', 'txt', YN)]
PR = {}
for j, (key, lab, d, fmt, lst) in enumerate(Q):
    r = 4 + j; PR[key] = "'Profile'!$B$%d" % r
    p.lbl('A%d' % r, lab); p.inp('B%d' % r, 'profile.' + key.lower(), lab, d, fmt, 'Entity Profile and Engagement Preferences; Certificate of Registration; audited financial statements', lst)
t0 = 4 + len(Q) + 2
p.sec('A%d' % (t0 - 1), 'Thresholds derived from the answers (no input)', 3)
F = lambda k: '(%s="Yes")' % PR[k]
AS = 'N(%s)' % PR['assets']
DER = {'A100': ('Total assets of ₹100 crore or more', '%s>=100' % AS), 'A500': ('Total assets of ₹500 crore or more', '%s>=500' % AS), 'A1000': ('Total assets of ₹1,000 crore or more', '%s>=1000' % AS), 'A5000': ('Total assets of ₹5,000 crore or more', '%s>=5000' % AS),
       'LISTED': ('Listed (equity or debt)', 'OR(%s,%s)' % (F('LEQ'), F('LDEBT'))), 'HFC': ('Housing Finance Company', '%s="%s"' % (PR['cat'], CATS[5])), 'CIC': ('Core Investment Company', '%s="%s"' % (PR['cat'], CATS[6])), 'AA': ('Account Aggregator', '%s="%s"' % (PR['cat'], CATS[7])),
       'MFI': ('Microfinance Institution or microfinance lender', 'OR(%s="%s",%s)' % (PR['cat'], CATS[1], F('MF'))), 'FAC': ('Factor or factoring business', 'OR(%s="%s",%s)' % (PR['cat'], CATS[2], F('FACT')))}
DR = {}
for j, (k, (lab, fm)) in enumerate(DER.items()):
    r = t0 + j; DR[k] = "'Profile'!$B$%d" % r; p.lbl('A%d' % r, lab); p.f('B%d' % r, 'IF(%s,"Yes","No")' % fm, 'txt', out=True)
G = lambda k: '(%s="Yes")' % (DR[k] if k in DR else PR[k])
LAYN = 'MATCH(%s,{"Base Layer","Middle Layer","Upper Layer"},0)' % PR['layer']


def cond(expr):
    """Turn 'A or B and C' written with flag names into an Excel formula."""
    if expr in ('TRUE', 'FALSE'): return expr
    ors = []
    for part in expr.split(' or '):
        ands = [G(x.strip()) for x in part.split(' and ')]
        ors.append(ands[0] if len(ands) == 1 else 'AND(%s)' % ','.join(ands))
    return ors[0] if len(ors) == 1 else 'OR(%s)' % ','.join(ors)


# condition met for lines marked "Conditional" (by serial number of the register)
TR = {5: 'PUB or LISTED', 6: 'PUB or LISTED', 13: 'SUBS', 22: 'DL', 23: 'DLG', 24: 'PROJ', 25: 'LAS', 26: 'PCE', 27: 'NFB', 28: 'SECURED', 32: 'DEP and BR10 or A5000 and CUST', 33: 'SECURED', 41: 'A100 or DEP or HFC', 42: 'A100 or DEP', 44: 'LT', 45: 'FALSE',
      46: 'NCD or CIC', 47: 'FX2', 48: 'FCY', 61: 'INDAS', 62: 'RELIEF', 63: 'SNFA', 69: 'A500 or HFC', 70: 'A500', 72: 'A500', 73: 'A500', 79: 'A500', 81: 'A500', 82: 'A500', 83: 'A500', 86: 'DL', 87: 'DL', 91: 'A500', 92: 'IGO', 93: 'DL', 94: 'OFFSH', 99: 'TRUE',
      101: 'INDAS', 103: 'DEP', 104: 'DEP', 105: 'DEP and GREEN', 106: 'MFI', 107: 'MFI', 108: 'MFI', 109: 'MFI', 110: 'GOLD', 111: 'GOLD', 112: 'CARD', 113: 'CARD', 114: 'CARD', 115: 'CARD', 116: 'CARD', 117: 'CARD', 120: 'AA', 121: 'CIC', 122: 'CALL or CIC',
      123: 'CIC', 124: 'SECO', 125: 'SECI', 126: 'LT', 127: 'SLT', 128: 'COL', 129: 'FAC', 130: 'DIST', 131: 'FX2', 132: 'HFC', 137: 'E20', 138: 'E300', 139: 'CSR', 148: 'LISTED', 149: 'LISTED', 150: 'LISTED and SUBS', 151: 'LEQ', 152: 'LEQ', 153: 'LEQ', 154: 'LEQ',
      155: 'LISTED or DIV', 156: 'LISTED', 157: 'LISTED', 158: 'LISTED', 159: 'TOP', 160: 'LDEBT', 161: 'FEMA', 163: 'API'}
GATE = {118: 'AA', 119: 'AA', 120: 'AA'}        # lines that apply only to one category whatever the layer column says

# ------------------------------------------------------------------ Policies
po = B.sheet('Policies', (5, 22, 44, 46, 13, 46, 44, 20, 18, 12, 12, 16, 11, 16, 13, 14, 30, 34), tab='00B050')
po.title('Policies – what applies to the company', '"Applies" = required for this company. "Good practice" = recommended, not mandated. Fill "In place?" to see the gaps.')
po.head(6, ['#', 'Group', 'Policy, code or framework', 'What it must cover', 'Type', 'Condition / applies to', 'Legal basis', 'Approval', 'Review frequency', 'Answer for the layer', 'Condition met', 'Result', 'Override', 'Final result', 'In place? (Yes / Partly / No)', 'Gap', 'Scope of work area', 'Remarks'])
P0 = 7; rules = []
for j, row in enumerate(REG['policies']):
    r = P0 + j; n = int(row[0]); grp, nm, cov, typ, bl, ml, ul, _fc, cnd, legal, appr, rev = row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12]
    for c, v in zip('ABCDEFGHI', (n, grp, nm, cov, typ, cnd, legal, appr, rev)):
        po.lbl('%s%d' % (c, r), v)
    po.f('J%d' % r, 'CHOOSE(%s,"%s","%s","%s")' % (LAYN, bl, ml, ul), 'txt')
    tr = TR.get(n); gate = GATE.get(n)
    po.f('K%d' % r, 'IF(J%d<>"Conditional","",IF(%s,"Yes","No"))' % (r, cond(tr) if tr else 'FALSE') if tr else 'IF(J%d<>"Conditional","","Check")' % r, 'txt')
    rec = typ.startswith('Recommended')
    base = 'IF(J{0}="No","Does not apply",IF(J{0}="Yes","{1}",IF(K{0}="Yes","{1}",IF(K{0}="Check","Check the condition","{2}"))))'.format(r, 'Good practice' if rec else 'Applies', 'Good practice' if n == 45 else 'Does not apply')
    if gate: base = 'IF(%s,%s,"Does not apply")' % (G(gate), base)
    po.f('L%d' % r, base, 'txt')
    po.inp('M%d' % r, 'policy.override.%d' % n, nm + ' – override', None, 'txt', 'Company decision with reason recorded', ['Applies', 'Does not apply'])
    po.f('N%d' % r, 'IF(M{0}<>"",M{0},L{0})'.format(r), 'txt', out=True)
    po.inp('O%d' % r, 'policy.inplace.%d' % n, nm + ' – in place', None, 'txt', 'Policy register of the company; Board minutes', ['Yes', 'Partly', 'No'])
    po.f('P%d' % r, 'IF(N{0}<>"Applies","",IF(O{0}="Yes","GREEN",IF(O{0}="Partly","AMBER",IF(O{0}="No","RED","Not assessed"))))'.format(r), 'txt')
    po.lbl('Q%d' % r, AREA.get(grp, '4. Policy Suite and Policy Governance'))
    po.inp('R%d' % r, 'policy.remarks.%d' % n, nm + ' – remarks', None, 'txt', 'Company')
    rules.append(dict(no=n, group=grp, policy=nm, type=typ, base_layer=bl, middle_layer=ml, upper_layer=ul, condition_text=cnd, condition_rule=tr or '', category_gate=gate or '', legal_basis=legal, approval=appr, review=rev))
PE = P0 + len(REG['policies']) - 1
po.rag('P%d:P%d' % (P0, PE)); po.ws.freeze_panes = 'D7'
PG = lambda c: "'Policies'!$%s$%d:$%s$%d" % (c, P0, c, PE)

# ------------------------------------------------------------------ Committees and roles
cm = B.sheet('Committees and Roles', (5, 46, 50, 13, 13, 16, 60), tab='00B050')
cm.title('Committees and Roles – what the company must have', 'Answer for the layer: Yes = required; Conditional = required where the condition in the note is met; No = not required.')
cm.head(6, ['#', 'Committee or role', 'Legal basis', 'Answer for the layer', 'In place? (Yes / No)', 'Status', 'Composition / note'])
for j, row in enumerate(REG['committees']):
    r = 7 + j
    cm.lbl('A%d' % r, row[0]); cm.lbl('B%d' % r, row[1]); cm.lbl('C%d' % r, row[2]); cm.lbl('G%d' % r, row[6])
    cm.f('D%d' % r, 'CHOOSE(%s,"%s","%s","%s")' % (LAYN, row[3], row[4], row[5]), 'txt', out=True)
    cm.inp('E%d' % r, 'committee.inplace.%s' % row[0], row[1] + ' – in place', None, 'txt', 'Board minutes; organisation chart', YN)
    cm.f('F%d' % r, 'IF(D{0}="No","Not required",IF(E{0}="Yes","GREEN",IF(E{0}="No",IF(D{0}="Yes","RED","AMBER"),"Not assessed")))'.format(r), 'txt')
CE = 6 + len(REG['committees']); cm.rag('F7:F%d' % CE)

# ------------------------------------------------------------------ Returns
RET = [('DNBS01', 'Important Financial Parameters', 'Quarterly', '%s<>"Base Layer"' % PR['layer'], 'Middle Layer and Upper Layer NBFCs'), ('DNBS02', 'Important Financial Parameters', 'Quarterly', '%s="Base Layer"' % PR['layer'], 'Base Layer NBFCs'),
       ('DNBS03', 'Important Prudential Parameters', 'Quarterly', None, 'As specified in the Supervisory Returns Directions for the layer and type'), ('DNBS04A', 'Short Term Dynamic Liquidity', 'Quarterly', None, 'NBFCs to which the liquidity risk framework applies'),
       ('DNBS04B', 'Structural Liquidity and Interest Rate Sensitivity', 'Monthly', None, 'NBFCs to which the liquidity risk framework applies'), ('DNBS08', 'CRILC Main Return', 'Monthly', None, 'NBFCs reporting large exposures to the Central Repository of Information on Large Credits'),
       ('DNBS09', 'CRILC – Return on Defaulted Borrowers', 'Weekly', None, 'NBFCs reporting to the Central Repository of Information on Large Credits'), ('DNBS10', 'Statutory Auditor Certificate Return', 'Annual', 'TRUE', 'All NBFCs'),
       ('DNBS11', 'Core Investment Companies – Important Financial Parameters', 'Quarterly', G('CIC'), 'Core Investment Companies'), ('DNBS12', 'Core Investment Companies – Important Prudential Parameters', 'Quarterly', G('CIC'), 'Core Investment Companies'),
       ('DNBS13', 'Overseas Investment Details', 'Quarterly', None, 'NBFCs with overseas investments'), ('DNBS14', 'Peer to Peer Lending Platforms – Financial and Prudential Parameters', 'Quarterly', '%s="%s"' % (PR['cat'], CATS[8]), 'NBFC-P2P'),
       ('FMR', 'Fraud Monitoring Return and Fraud Update Application', 'On occurrence', 'TRUE', 'All NBFCs to which the fraud risk management directions apply'), ('FMR-4', 'Return on Robbery, Burglaries and Theft', 'Quarterly', None, 'As specified in the fraud risk management directions'),
       ('Form A', 'Certificate on appointment of statutory auditor', 'Annual', None, 'As specified in the statutory auditor appointment directions'), ('DLA list', 'Reporting of digital lending apps on the CIMS portal', 'On deployment or cessation', G('DL'), 'NBFCs using digital lending apps')]
rs = B.sheet('Returns', (12, 52, 20, 18, 60, 14, 16), tab='00B050')
rs.title('Returns – supervisory returns and reports', 'The RBI formats are in the folder Supervisory Returns / RBI Formats. "Confirm" means the rule depends on a provision this sheet does not test; check the Supervisory Returns Directions.')
rs.head(6, ['Return', 'Name', 'Frequency', 'Result', 'Who files it', 'Filed on time last period? (Yes / No)', 'Status'])
for j, (code, nm, fq, rule, who) in enumerate(RET):
    r = 7 + j; rs.lbl('A%d' % r, code); rs.lbl('B%d' % r, nm); rs.lbl('C%d' % r, fq); rs.lbl('E%d' % r, who)
    rs.f('D%d' % r, ('IF(%s,"Applies","Does not apply")' % rule) if rule else '"Confirm"', 'txt', out=True)
    rs.inp('F%d' % r, 'return.ontime.%d' % (j + 1), code + ' – filed on time', None, 'txt', 'Return filing log', YN)
    rs.f('G%d' % r, 'IF(D{0}="Does not apply","",IF(F{0}="Yes","GREEN",IF(F{0}="No","RED","Not assessed")))'.format(r), 'txt')
rs.rag('G7:G%d' % (6 + len(RET)))

# ------------------------------------------------------------------ Dashboard
db = B.sheet('Dashboard', (44, 13, 13, 13, 13, 13, 13, 13), tab='00B050')
db.title('Dashboard – what applies and where the gaps are')
db.f('A3', '"Company: "&%s&"   |   "&%s&"   |   "&%s&"   |   Total assets ₹ "&TEXT(%s,"#,##0")&" crore"' % (PR['name'], PR['layer'], PR['cat'], AS), 'txt')
db.head(5, ['Group', 'Policies in the register', 'Apply', 'Good practice', 'In place', 'Partly', 'Missing', 'Not assessed'])
grps = []
for row in REG['policies']:
    if row[1] not in grps: grps.append(row[1])
for j, g in enumerate(grps):
    r = 6 + j; db.lbl('A%d' % r, g)
    db.f('B%d' % r, 'COUNTIF(%s,A%d)' % (PG('B'), r), 'int'); db.f('C%d' % r, 'COUNTIFS(%s,$A%d,%s,"Applies")' % (PG('B'), r, PG('N')), 'int'); db.f('D%d' % r, 'COUNTIFS(%s,$A%d,%s,"Good practice")' % (PG('B'), r, PG('N')), 'int')
    for c, st_ in zip('EFGH', ('GREEN', 'AMBER', 'RED', 'Not assessed')):
        db.f('%s%d' % (c, r), 'COUNTIFS(%s,$A%d,%s,"%s")' % (PG('B'), r, PG('P'), st_), 'int')
tr_ = 6 + len(grps); db.lbl('A%d' % tr_, 'Total', True)
for c in 'BCDEFGH':
    db.f('%s%d' % (c, tr_), 'SUM(%s6:%s%d)' % (c, c, tr_ - 1), 'int', out=True)
db.lbl('A%d' % (tr_ + 2), 'Policies needing a manual check of the condition'); db.f('B%d' % (tr_ + 2), 'COUNTIF(%s,"Check the condition")' % PG('N'), 'int')
db.lbl('A%d' % (tr_ + 3), 'Policy compliance (in place / applying)'); db.f('B%d' % (tr_ + 3), div('E%d' % tr_, 'C%d' % tr_), 'pct', out=True)
db.f('C%d' % (tr_ + 3), 'IF(C{0}=0,"",IF(G{0}>0,"RED",IF(F{0}+H{0}>0,"AMBER","GREEN")))'.format(tr_), 'txt'); db.rag('C%d' % (tr_ + 3))
db.lbl('A%d' % (tr_ + 4), 'Committees and roles required (Yes)'); db.f('B%d' % (tr_ + 4), 'COUNTIF(%s,"Yes")' % q('Committees and Roles', 'D7:D%d' % CE), 'int')
db.lbl('A%d' % (tr_ + 5), 'Committees and roles missing'); db.f('B%d' % (tr_ + 5), 'COUNTIF(%s,"RED")' % q('Committees and Roles', 'F7:F%d' % CE), 'int')
db.lbl('A%d' % (tr_ + 6), 'Returns that apply'); db.f('B%d' % (tr_ + 6), 'COUNTIF(%s,"Applies")' % q('Returns', 'D7:D%d' % (6 + len(RET))), 'int')
db.sec('A%d' % (tr_ + 8), 'Thresholds crossed', 3)
for j, (k, (lab, _)) in enumerate(DER.items()):
    r = tr_ + 9 + j; db.lbl('A%d' % r, lab); db.f('B%d' % r, DR[k], 'txt')

# ------------------------------------------------------------------ Rules, notes, checks
ru = B.sheet('Rules', (5, 24, 44, 12, 12, 12, 12, 30, 14, 60), tab='7030A0', protect=False)
ru.title('Rules – applicability rules in one table', 'For use in a compliance tool. "Condition rule" uses the codes of the Profile questions (last column of the Source Map, profile.<code>) and the derived thresholds.')
ru.head(5, ['#', 'Group', 'Policy', 'Type', 'Base Layer', 'Middle Layer', 'Upper Layer', 'Condition rule (when the layer answer is Conditional)', 'Category gate', 'Condition in words'])
for j, x in enumerate(rules):
    for c, v in zip('ABCDEFGHIJ', (x['no'], x['group'], x['policy'], x['type'], x['base_layer'], x['middle_layer'], x['upper_layer'], x['condition_rule'], x['category_gate'], x['condition_text'])):
        ru.lbl('%s%d' % (c, 6 + j), v)
m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how applicability is decided')
m.text_block(4, [
 '# 1. Source of the register',
 'The list of policies, the answer for each layer (Yes, No or Conditional), the condition and the legal basis come from the NBFC Policy Register. This workbook adds the rule that tests each condition against the Profile.',
 '# 2. How a result is reached',
 'Step 1: the answer for the company\'s layer is read (column "Answer for the layer"). "No" gives "Does not apply". "Yes" gives "Applies" (or "Good practice" where the type is Recommended).',
 'Step 2: where the answer is "Conditional", the condition is tested against the Profile answers (column "Condition met"). Met gives "Applies"; not met gives "Does not apply". Where no rule could be written for the condition the result is "Check the condition" and the reader decides.',
 'Step 3: a line that belongs to one category only (for example Account Aggregators) applies only to that category.',
 'Step 4: "Override" replaces the result; record the reason in Remarks.',
 '# 3. Thresholds',
 'Asset-size thresholds (₹100 crore, ₹500 crore, ₹1,000 crore, ₹5,000 crore) are derived from total assets on the Profile. Listing, category and microfinance or factoring business are derived in the same way.',
 '# 4. Gaps',
 'For every policy that applies, "In place?" gives GREEN (Yes), AMBER (Partly) or RED (No). The Dashboard counts them by group.',
 '# 5. Returns',
 'A return shows "Applies" or "Does not apply" where the rule depends only on the Profile; otherwise "Confirm", with the class of company that files it.',
 '# 6. Limits',
 'The engine is a first screen. A condition with detailed sub-rules (for example the stages of the statutory auditor procedure, or which Companies Act thresholds make a company "public" for committee purposes) is reduced to one question; read the condition and the legal basis before relying on the result. The register must be updated when a direction changes.'])
ck = B.sheet('Checks', (6, 76, 12, 54), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
chk = [('Company name and total assets are entered', 'AND(%s<>"",%s>0)' % (PR['name'], AS), 'Complete the Profile'), ('A deposit-taking company is not shown in the Base Layer', 'NOT(AND(%s,%s="Base Layer"))' % (F('DEP'), PR['layer']), 'Deposit-taking NBFCs are in the Middle Layer or above; correct the layer'),
       ('A Housing Finance Company is not shown in the Base Layer', 'NOT(AND(%s,%s="Base Layer"))' % (G('HFC'), PR['layer']), 'Correct the layer'), ('Top 1,000 listed entity is marked as listed', 'OR(NOT(%s),%s)' % (F('TOP'), G('LISTED')), 'Correct the listing answers'),
       ('Default loss guarantee is used only with digital lending or co-lending', 'OR(NOT(%s),%s,%s)' % (F('DLG'), F('DL'), F('COL')), 'Check the answers'), ('No policy is left at "Check the condition"', 'COUNTIF(%s,"Check the condition")=0' % PG('N'), 'Decide each one and use Override'),
       ('Every policy that applies has been assessed', 'COUNTIF(%s,"Not assessed")=0' % PG('P'), 'Fill "In place?" on the Policies sheet')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C12')
source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Profile', 'Policies', 'Committees and Roles', 'Returns', 'Dashboard', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
if len(sys.argv) > 4: json.dump(rules, open(sys.argv[4], 'w'), indent=1, ensure_ascii=False)
print('Applicability engine built:', len(REG['policies']), 'policies,', len(REG['committees']), 'committees and roles,', len(RET), 'returns,', len(B.inputs), 'inputs')
