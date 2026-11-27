"""Applicability engines for the sectors other than NBFCs, built from the sector Policy Registers of the Scope of Work folder.
Run: python3 build_sector_engine.py <sector key | all>     (writes the workbook, its input map and data/sector_engines.json)"""
import sys, os, json
from openpyxl import load_workbook
from xl import *

HOME = os.path.expanduser('~')
PF = os.environ.get('POLICIES_FRAMEWORK', HOME + '/mnt/Policies Framework'); SOW = os.environ.get('SCOPE_OF_WORK', HOME + '/mnt/Scope of Work')
HERE = os.path.dirname(os.path.abspath(__file__))
# key: (code, title, register file in the Scope of Work folder, folder of the engine)
SEC = {'sebi listed': ('APP-M02', 'Applicability Engine for SEBI Listed Entities', '03 SEBI - Listed Entities/SEBI Listed 6 Policy Register.xlsx', PF + '/SEBI Policies/Applicability Engine'),
       'sebi intermediaries': ('APP-M03', 'Applicability Engine for SEBI Market Intermediaries', '04 SEBI - Market Intermediaries/SEBI Intermediaries 6 Policy Register.xlsx', PF + '/SEBI Policies/Applicability Engine'),
       'ifsca': ('APP-M04', 'Applicability Engine for IFSCA Entities', '05 IFSCA - GIFT IFSC Entities/IFSCA 6 Policy Register.xlsx', PF + '/IFSCA Policies/Applicability Engine'),
       'irdai': ('APP-M05', 'Applicability Engine for Insurance Intermediaries', '06 IRDAI - Insurance Intermediaries/IRDAI 6 Policy Register.xlsx', PF + '/IRDA Policies/Applicability Engine'),
       'cooperative': ('APP-M06', 'Applicability Engine for Co-operative Societies', '07 Co-operative Societies/Cooperative 6 Policy Register.xlsx', SOW + '/07 Co-operative Societies/Applicability Engine'),
       'payments': ('APP-M07', 'Applicability Engine for Payment System Operators and Fintech Entities', '08 RBI - Payment System Operators & Fintech/Payments Fintech 6 Policy Register.xlsx', PF + '/PPI Policies/Applicability Engine')}
P0 = 7
QFILE = SOW + '/09 Tools/Scope Generator/sector profile questions.json'     # the profile questions of each sector, also asked in document 1 of the sector pack


def choose(idx, vals): return 'IF(%s="","",CHOOSE(%s,%s))' % (idx, idx, ','.join('"%s"' % str(v or 'No').replace('"', '') for v in vals))


def build(key):
    code, title, regfile, folder = SEC[key]
    wb = load_workbook(os.path.join(SOW, regfile)); ws = wb['Policy Register']
    cats = [c.value for c in wb['Lists']['A'] if c.value]; n = len(cats)
    hdr = [ws.cell(row=5, column=c).value for c in range(1, ws.max_column + 1)]; codes = [str(x) for x in hdr[5:5 + n]]
    col = lambda nm: next(i for i, h in enumerate(hdr) if h and str(h).startswith(nm)) + 1
    pol = []
    for r in range(6, ws.max_row + 1):
        if ws.cell(row=r, column=1).value in (None, ''): continue
        pol.append(dict(no=ws.cell(row=r, column=1).value, group=ws.cell(row=r, column=2).value, policy=ws.cell(row=r, column=3).value, cover=ws.cell(row=r, column=4).value, type=ws.cell(row=r, column=5).value,
                        ans=[ws.cell(row=r, column=6 + i).value for i in range(n)], cond=ws.cell(row=r, column=col('Condition')).value, legal=ws.cell(row=r, column=col('Legal basis')).value,
                        approval=ws.cell(row=r, column=col('Approval')).value, review=ws.cell(row=r, column=col('Review frequency')).value))
    com = []
    if 'Committees and Roles' in wb.sheetnames:
        cs = wb['Committees and Roles']; h = [cs.cell(row=3, column=c).value for c in range(1, cs.max_column + 1)]
        i0 = h.index(codes[0]) + 1 if codes[0] in h else 4; ic = next((i + 1 for i, x in enumerate(h) if x and str(x).startswith('Composition')), i0 + n)
        for r in range(4, cs.max_row + 1):
            if cs.cell(row=r, column=2).value: com.append(dict(name=cs.cell(row=r, column=2).value, legal=cs.cell(row=r, column=3).value, ans=[cs.cell(row=r, column=i0 + i).value for i in range(n)], note=cs.cell(row=r, column=ic).value))

    prefix = os.path.basename(regfile).split(' 6 Policy Register')[0]
    QS = json.load(open(QFILE))[prefix]['questions'] if os.path.exists(QFILE) else []
    qof = {str(l): qq['key'] for qq in QS for l in qq['register lines']}
    B = Book(code, title); GUARD[0] = None
    readme(B, title, ['This workbook turns the category of an entity into the list of policies, codes, frameworks, committees and roles that apply to it. Choose the category and answer the profile questions on the Profile sheet; answer on the Policies sheet any condition the profile leaves open; everything else is worked out.',
                      'The lines come from the Policy Register of the sector. The same register is used in the scope of work pack, so that the engagement scope, the policy register and the compliance tool start from one list.'],
           ['Profile: enter the name, choose the category and answer the profile questions (Yes, No or In part); they are the questions of Part A of document 1 of the sector pack (Questions that settle conditional obligations).', 'Policies: for each line still marked "Confirm the condition", read the condition and answer Yes or No; an answer there takes precedence over the profile. Use "Override" only with a recorded reason. Fill "In place?" to see the gaps.',
            'Committees and Roles: read what the entity must have.', 'Dashboard: read the counts by group and the gaps. Clear the Checks sheet.'],
           [('Method Notes', 'explains how applicability is decided'), ('Profile', 'name, category and profile questions'), ('Policies', 'policies, codes and frameworks'), ('Committees and Roles', 'committees and roles'), ('Dashboard', 'summary and gaps'),
            ('Rules', 'the answers by category in one table for software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])
    p = B.sheet('Profile', (44, 70, 14, 8, 90), tab='C00000')
    p.title('Profile – the entity and its category', 'Yellow cells are inputs. The category decides what applies.')
    p.lbl('A4', 'Name of the entity'); p.inp('B4', 'profile.name', 'Name of the entity', None, 'txt', 'Entity Profile and Engagement Preferences')
    p.lbl('A5', 'Profile as on'); p.inp('B5', 'profile.date', 'Profile as on', None, 'date', 'Entity Profile')
    p.lbl('A6', 'Category'); p.inp('B6', 'profile.category', 'Category of the entity (one of the categories listed on the Profile sheet)', None, 'txt', 'Certificate of registration, licence or listing status')
    p.lbl('A7', 'Category number'); p.f('B7', 'IFERROR(MATCH(B6,E4:E%d,0),"")' % (3 + n), 'int', out=True)
    p.head(3, ['No.', 'Categories in this sector'], col=4)
    for i, c in enumerate(cats): p.lbl('D%d' % (4 + i), codes[i]); p.lbl('E%d' % (4 + i), c)
    dv = DataValidation(type='list', formula1='=$E$4:$E$%d' % (3 + n), allow_blank=True); p.ws.add_data_validation(dv); dv.add('B6')
    IDX = q('Profile', '$B$7')
    Q0 = max(10, n + 6); qcell = {}
    if QS:
        p.sec('A%d' % (Q0 - 1), 'Profile questions – they settle the "Conditional" lines of the Policies sheet')
        p.head(Q0, ['Key', 'Question', 'Answer (Yes / No / In part)', 'Lines', 'Register lines it settles'])
        for i, qq in enumerate(QS):
            r = Q0 + 1 + i; ln = ', '.join(str(x) for x in qq['register lines'])
            p.lbl('A%d' % r, qq['key']); p.lbl('B%d' % r, qq['question'])
            p.inp('C%d' % r, 'profile.answer.%s' % qq['key'], 'Profile question %s: %s' % (qq['key'], qq['question'][:110]), None, 'txt', 'Entity Profile, Part A', ['Yes', 'No', 'In part'])
            p.lbl('D%d' % r, len(qq['register lines'])); p.lbl('E%d' % r, ln); qcell[qq['key']] = q('Profile', '$C$%d' % r)
        QE = Q0 + len(QS)

    po = B.sheet('Policies', (5, 22, 42, 44, 13, 40, 42, 20, 16, 12, 11, 20, 14, 20, 11, 9), tab='00B050')
    po.title('Policies – what applies to the entity', '"Applies" = required for this entity. "Good practice" = recommended, not mandated. "Confirm the condition" = the profile answer is missing or In part; answer the condition in the yellow cell.')
    po.head(6, ['#', 'Group', 'Policy, code or framework', 'What it must cover', 'Type', 'Condition / applies to', 'Legal basis', 'Approval', 'Review frequency', 'Answer for the category', 'Condition met (Yes / No; blank = profile answer)', 'Result', 'Override', 'Final result', 'In place? (Yes / Partly / No)', 'Gap'])
    rules = []
    for j, x in enumerate(pol):
        r = P0 + j
        for c, v in zip('ABCDEFGHI', (x['no'], x['group'], x['policy'], x['cover'], x['type'], x['cond'], x['legal'], x['approval'], x['review'])): po.lbl('%s%d' % (c, r), v)
        po.f('J%d' % r, choose(IDX, x['ans']), 'txt')
        if any(str(a) == 'Conditional' for a in x['ans']): po.inp('K%d' % r, 'policy.condition.%s' % x['no'], 'Condition met for line %s: %s' % (x['no'], str(x['cond'])[:120]), None, 'txt', 'Confirmed with the entity', ['Yes', 'No'])
        else: po.lbl('K%d' % r, '')
        base = '"Good practice"' if str(x['type']) == 'Recommended' else '"Applies"'
        kq = qof.get(str(x['no'])); kc = 'IF(K%d<>"",K%d,%s)' % (r, r, qcell[kq]) if kq in qcell else 'K%d' % r     # a line-level answer takes precedence over the profile answer
        po.f('L%d' % r, 'IF(J%%d="","",IF(J%%d="No","Does not apply",IF(J%%d="Conditional",IF(%s="Yes",%%s,IF(%s="No","Does not apply","Confirm the condition")),%%s)))' % (kc, kc) % (r, r, r, base, base), 'txt')
        po.inp('M%d' % r, 'policy.override.%s' % x['no'], 'Override for line %s' % x['no'], None, 'txt', 'Recorded decision', ['Applies', 'Good practice', 'Does not apply'])
        po.f('N%d' % r, 'IF(M%d<>"",M%d,L%d)' % (r, r, r), 'txt', out=True)
        po.inp('O%d' % r, 'policy.inplace.%s' % x['no'], 'In place – line %s' % x['no'], None, 'txt', 'Policy library of the entity', ['Yes', 'Partly', 'No'])
        po.f('P%d' % r, 'IF(OR(N%d="",N%d="Does not apply"),"",IF(N%d="Confirm the condition","AMBER",IF(O%d="","",IF(O%d="Yes","GREEN",IF(AND(O%d="No",N%d="Applies"),"RED","AMBER")))))' % (r, r, r, r, r, r, r), 'txt')
        rules.append(dict(no=x['no'], group=x['group'], policy=x['policy'], type=x['type'], condition=x['cond'], question=qof.get(str(x['no'])), answers=dict(zip(codes, [str(a or 'No') for a in x['ans']]))))
    PE = P0 + len(pol) - 1; po.rag('P%d:P%d' % (P0, PE)); po.ws.freeze_panes = 'D7'
    PR = lambda c: "Policies!$%s$%d:$%s$%d" % (c, P0, c, PE)

    cm = B.sheet('Committees and Roles', (5, 46, 50, 16, 14, 16, 60), tab='00B050')
    cm.title('Committees and Roles – what the entity must have', '"Conditional" = depends on a condition in the legal basis; confirm for the entity.')
    cm.head(6, ['#', 'Committee or role', 'Legal basis', 'Answer for the category', 'In place? (Yes / No)', 'Status', 'Composition / note'])
    for j, x in enumerate(com):
        r = P0 + j; cm.lbl('A%d' % r, j + 1); cm.lbl('B%d' % r, x['name']); cm.lbl('C%d' % r, x['legal']); cm.f('D%d' % r, choose(IDX, x['ans']), 'txt')
        cm.inp('E%d' % r, 'committee.inplace.%d' % (j + 1), 'In place – %s' % str(x['name'])[:60], None, 'txt', 'Board records', ['Yes', 'No'])
        cm.f('F%d' % r, 'IF(D%d="","",IF(D%d="No","Not required",IF(E%d="Yes","GREEN",IF(E%d="No",IF(D%d="Yes","RED","AMBER"),IF(D%d="Yes","Required","Confirm")))))' % (r, r, r, r, r, r), 'txt'); cm.lbl('G%d' % r, x['note'])
    if com: cm.rag('F%d:F%d' % (P0, P0 + len(com) - 1))

    d = B.sheet('Dashboard', (44, 14, 14, 16, 14, 12, 12, 12), tab='00B050')
    d.title('Dashboard – what applies and where the gaps are'); d.head(5, ['Group', 'Lines in the register', 'Apply', 'Condition to confirm', 'Good practice', 'In place', 'Partly', 'Missing'])
    groups = list(dict.fromkeys(str(x['group']) for x in pol))
    for j, g in enumerate(groups):
        r = 6 + j; d.lbl('A%d' % r, g); d.f('B%d' % r, 'COUNTIF(%s,A%d)' % (PR('B'), r), 'int')
        for c, t in zip('CDE', ('Applies', 'Confirm the condition', 'Good practice')): d.f('%s%d' % (c, r), 'COUNTIFS(%s,A%d,%s,"%s")' % (PR('B'), r, PR('N'), t), 'int')
        for c, t in zip('FGH', ('Yes', 'Partly', 'No')): d.f('%s%d' % (c, r), 'COUNTIFS(%s,A%d,%s,"<>Does not apply",%s,"%s")' % (PR('B'), r, PR('N'), PR('O'), t), 'int')
    rt = 6 + len(groups); d.lbl('A%d' % rt, 'Total', True)
    for c in 'BCDEFGH': d.f('%s%d' % (c, rt), 'SUM(%s6:%s%d)' % (c, c, rt - 1), 'int', out=True)
    d.lbl('A%d' % (rt + 2), 'Category'); d.f('B%d' % (rt + 2), 'IF(%s="","",%s)' % (q('Profile', 'B6'), q('Profile', 'B6')), 'txt')

    ru = B.sheet('Rules', tuple([6, 24, 46, 16, 44] + [12] * n), tab='7030A0', protect=False)
    ru.title('Rules – answer for each category in one table', 'For use in a compliance tool. Yes = applies; Conditional = applies if the condition is met; No = does not apply. A line of type "Recommended" gives "Good practice".')
    ru.head(5, ['#', 'Group', 'Policy, code or framework', 'Type', 'Condition'] + codes)
    for j, x in enumerate(pol):
        for k, v in enumerate([x['no'], x['group'], x['policy'], x['type'], x['cond']] + [str(a or 'No') for a in x['ans']]): ru.lbl('%s%d' % (L(k + 1), 6 + j), v)
    m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
    m.title('Method Notes – how this engine decides what applies')
    m.text_block(4, ['# 1. Source', 'Every line is taken from the Policy Register of the sector, which gives for each category an answer of Yes, No or Conditional, with the legal basis. The engine holds %d lines, %d committees and roles and %d categories.' % (len(pol), len(com), n),
                     '# 2. Result', 'Yes gives "Applies"; for a line of type "Recommended" it gives "Good practice". No gives "Does not apply". Conditional gives "Confirm the condition" until the condition is answered: Yes then gives the same result as a Yes line, and No gives "Does not apply". An override, where used, replaces the result; record the reason.',
                     '# 3. Gaps', 'A line that applies and is not in place is red; one that is partly in place, or a good practice that is missing, is amber; one in place is green. A condition not yet answered is amber.',
                     '# 4. Profile questions', 'The %d profile questions on the Profile sheet are the same as the section Questions that settle conditional obligations in Part A of document 1 (Entity Profile and Engagement Preferences) of the sector pack. Each settles the Conditional lines listed against it: Yes gives the result of a Yes line, No gives "Does not apply", and In part (or no answer) leaves the lines as "Confirm the condition" to be answered one by one on the Policies sheet. An answer on the Policies sheet always takes precedence over the profile answer. Every Conditional line of the register is settled by exactly one question.' % len(QS),
                     '# 5. Limits', 'The engine is only as current as the register; when the register changes, the questions are re-matched by the question script of the Scope Generator folder and the engine is rebuilt. A profile answer is the entity\'s own statement of a fact (size, products, listing, thresholds); confirm it against records before relying on the result. Returns are not listed for these sectors.'])
    ck = B.sheet('Checks', (6, 76, 12, 54), tab='FF0000')
    ck.title('Checks – clear every "CHECK" before using the results'); ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
    for j, (lab, fm, fix) in enumerate([('The name is entered', '%s<>""' % q('Profile', 'B4'), 'Complete the Profile'), ('The category is one of the listed categories', '%s<>""' % IDX, 'Choose the category from the list'),
                                        ('Every condition is answered', 'COUNTIF(%s,"Confirm the condition")=0' % PR('N'), 'Answer the profile questions, or Yes or No in the yellow cells of the Policies sheet'), ('Every override is a permitted value', 'SUMPRODUCT((%s<>"")*(%s<>"Applies")*(%s<>"Good practice")*(%s<>"Does not apply"))=0' % (PR('M'), PR('M'), PR('M'), PR('M')), 'Correct the override')]):
        r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
    if QS:
        rq = q('Profile', '$C$%d:$C$%d' % (Q0 + 1, QE)); r += 1
        ck.lbl('A%d' % r, r - 5); ck.lbl('B%d' % r, 'Every profile question is answered Yes, No or In part'); ck.f('C%d' % r, 'IF(COUNTIF(%s,"Yes")+COUNTIF(%s,"No")+COUNTIF(%s,"In part")=%d,"OK","CHECK")' % (rq, rq, rq, len(QS)), 'txt'); ck.lbl('D%d' % r, 'Answer every question on the Profile sheet')
    ck.rag('C6:C%d' % r)
    source_map(B)
    B.wb._sheets = [B.wb[x] for x in ['ReadMe', 'Method Notes', 'Profile', 'Policies', 'Committees and Roles', 'Dashboard', 'Rules', 'Checks', 'Source Map']]
    B.wb.calculation.fullCalcOnLoad = True
    os.makedirs(folder, exist_ok=True); os.makedirs(HERE + '/maps', exist_ok=True); os.makedirs(HERE + '/data', exist_ok=True)
    path = os.path.join(folder, '%s %s.xlsx' % (code, title)); mapfile = HERE + '/maps/%s_map.json' % code.lower().replace('-', '')
    B.save(path, mapfile)
    json.dump(rules, open(HERE + '/maps/%s_rules.json' % code.lower().replace('-', ''), 'w'), indent=0, ensure_ascii=False)
    reg = HERE + '/data/sector_engines.json'; D = json.load(open(reg)) if os.path.exists(reg) else {}
    D[key] = dict(code=code, engine=os.path.relpath(path, HOME + '/mnt'), map=os.path.basename(mapfile), categories=cats, codes=codes, policies=len(pol), committees=len(com)); json.dump(D, open(reg, 'w'), indent=1, ensure_ascii=False)
    print(code, key, '| questions', len(QS), '| policies', len(pol), '| committees', len(com), '| categories', n, '| inputs', len(B.inputs))


for k in (list(SEC) if sys.argv[1] == 'all' else [sys.argv[1]]): build(k)
