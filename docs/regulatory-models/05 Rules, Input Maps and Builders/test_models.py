"""Regression and variant tests for the three masters. Run after any change: python3 test_models.py"""
import json, math, copy
import fill_model, recalc
from xl import NAMES
class _W:
    def __init__(s,wb): s.wb=wb
    def __getitem__(s,n): return s.wb[NAMES.get(n,n)]
O='out/'; fails=[]
def run(master, mp, data, name):
    out=O+'_t_'+name+'.xlsx'; d,u=fill_model.fill(O+master,O+mp,data,out)
    wb,n,errs,blank=recalc.recalc(out)
    if u: fails.append((name,'unknown keys',u[:3]))
    if errs: fails.append((name,'formula errors',errs[:3]))
    return _W(wb)
def close(a,b,tol=1e-6): return abs(a-b)<=tol*max(1,abs(a),abs(b))
def chk(name,cond,msg):
    print(('PASS ' if cond else 'FAIL ')+name+' – '+msg)
    if not cond: fails.append((name,msg))
E0=json.load(open(O+'ecl_example.json'))
# ---- ECL base: independent recomputation of segment 6 (manual) and segment 4 (default history)
wb=run('ECL-M01 ECL Master Model.xlsx','ecl_map.json',E0,'ecl_base')
g=lambda sh,c: wb[sh][c].value
# segment 6 manual PD 1.2%, LGD 50%, weights .6/.1/.3, mult 1/.85/1.35, lgd mult 1/.95/1.15
book=240; sh=(0.975,0.012,0.005,0.003,0.003,0.002,0.0); b=[round(book*s,2) for s in sh]; restr=round(book*.006,2); sicr=round(book*.004,2)
s1=b[0]+b[1]-(restr+sicr); s2=b[2]+b[3]+restr+sicr; s3=sum(b[4:]); off=120*0.5
chk('ECL staging', close(g('EAD','E13'),s1) and close(g('EAD','F13'),s2) and close(g('EAD','G13'),s3) and close(g('EAD','H13'),off), 'segment 6 stage split')
pd=0.012; lg=0.5; df=1/(1+0.12)**(0.5/2); tot=0
for w,pm,lm in ((.6,1,1),(.1,.85,.95),(.3,1.35,1.15)):
    p12=min(1,pd*pm); l=min(1,lg*lm); life=min(1,max(0,1-(1-min(1,p12*3))**max(1,0.5)))
    tot+=w*((s1+off)*p12*l + s2*life*l*df + s3*min(1,min(1,lg+0.05)*lm))
chk('ECL segment 6', close(g('ECL_Calc','P13'),tot,1e-5), 'model %.5f vs independent %.5f'%(g('ECL_Calc','P13'),tot))
op=[180*0.9/(1.18**y) for y in range(5,0,-1)]; rate=[0.034,0.041,0.036,0.031,0.029]
pdh=sum(round(o*r,2) for o,r in zip(op,rate))/sum(round(o,2) for o in op)
chk('ECL default-history PD', close(g('PD','E11'),pdh,1e-6), '%.6f vs %.6f'%(g('PD','E11'),pdh))
chk('ECL total = sum stages', close(g('Overlay','M23'), g('Overlay','J23')+g('Overlay','K23')+g('Overlay','L23')), 'overlay totals')
chk('ECL movement closes', close(g('Movement','E16'), sum(g('Movement','E%d'%r) or 0 for r in range(8,16))), 'opening + movements = closing')
chk('ECL disclosures tie', close(g('Disclosures','D10'), g('Overlay','M23')) and close(g('Disclosures','B10'), 2000), 'disclosure totals')
# ---- ECL loan tape must reproduce the summary result
D=copy.deepcopy(E0); tape=[]; n=0
names={k:E0['seg.name.%d'%k] for k in range(1,7)}; mid=[0,15,45,75,120,250,500]
for k in range(1,7):
    for j in range(7):
        v=E0['port.b%d.%d'%(j,k)]
        if v:
            n+=1; tape.append(['L%05d'%n,names[k],v,mid[j],0,'N','N'])
    r=E0['port.restr.%d'%k]; s=E0['port.sicr.%d'%k]
    # carve restructured and SICR out of the current bucket row
    for row in tape:
        if row[1]==names[k] and row[3]==0: row[2]=round(row[2]-r-s,2)
    n+=1; tape.append(['L%05d'%n,names[k],r,0,0,'Y','N']); n+=1; tape.append(['L%05d'%n,names[k],s,0,0,'N','Y'])
    if E0['port.undrawn.%d'%k]: tape[-1][4]=E0['port.undrawn.%d'%k]
    for j in range(7): D['port.b%d.%d'%(j,k)]=None
    D['port.undrawn.%d'%k]=None; D['port.restr.%d'%k]=None; D['port.sicr.%d'%k]=None
D['tape']=tape; D['setup.source']='Loan tape'
wt=run('ECL-M01 ECL Master Model.xlsx','ecl_map.json',D,'ecl_tape')
chk('ECL loan tape = summary', close(wt['Overlay']['M23'].value, g('Overlay','M23'),1e-4), 'tape %.4f vs summary %.4f'%(wt['Overlay']['M23'].value, g('Overlay','M23')))
# ---- ECL variants
for nm,ch in [('vasicek',{'setup.macro':'Vasicek'}),('dpd1',{'setup.s2start':'1+ DPD'}),('igaap',{'setup.basis':'IGAAP (IRACP only)'}),('nodisc',{'setup.discount':'No'}),('seg_off',{'seg.active.3':'No'})]:
    D=copy.deepcopy(E0); D.update(ch); w=run('ECL-M01 ECL Master Model.xlsx','ecl_map.json',D,'ecl_'+nm); v=w['Overlay']['M23'].value
    ok=isinstance(v,(int,float)) and v>0
    if nm=='dpd1': ok=ok and v>g('Overlay','M23') and all(w['EAD']['J%d'%r].value=='OK' for r in range(8,14))
    if nm=='nodisc': ok=ok and v>g('Overlay','M23')
    if nm=='seg_off': ok=ok and v<g('Overlay','M23') and close(w['EAD']['I10'].value,0)
    if nm=='igaap': ok=ok and close(w['IRACP_Floor']['C32'].value,w['IRACP_Floor']['C27'].value) and close(w['IRACP_Floor']['C29'].value,0)
    if nm=='vasicek': ok=ok and w['PD']['K8'].value>w['PD']['I8'].value>w['PD']['J8'].value
    chk('ECL variant '+nm, ok, 'ECL %.3f'%v)
# ---- Stress
S0=json.load(open(O+'st_example.json'))
ws=run('ST-M01 Stress Testing Master Model.xlsx','st_map.json',S0,'st_base'); s=lambda sh,c: ws[sh][c].value
# independent credit loss, severe, segment 1 (stressed)
perf=420-S0['seg.s3.1']; pdv=S0['seg.pd.1']; lgd=S0['seg.lgd.1']
npa=perf*min(1,pdv*(2.5-1)+0.025+0.04); loss=npa*min(1,lgd+0.08)+S0['seg.s3.1']*0.08
chk('Stress credit seg 1 severe', close(s('ST_Credit','F7'),loss,1e-6), '%.4f vs %.4f'%(s('ST_Credit','F7'),loss))
tot=sum(s('ST_Combined','D%d'%r) for r in range(7,20)); chk('Stress simple sum', close(s('ST_Combined','D23'),tot), 'total = sum of risks')
t1=380+min(0,150-28-tot); prov=sum(s('ST_Combined','D%d'%r) for r in (7,8,17,18)); rwa=2154.5-prov; crar=(t1+min(25,t1))/rwa
chk('Stress CRAR severe', close(s('ST_Combined','D32'),crar,1e-6), '%.5f vs %.5f'%(s('ST_Combined','D32'),crar))
L=(405-0.15*2154.5)/(1-0.15); chk('Reverse stress', close(s('ST_Reverse','B9'),L) and close((405-L)/(2154.5-L),0.15), 'loss %.3f brings CRAR to 15%%'%L)
top=sorted([S0['top.exp.%d'%i] for i in range(1,21)],reverse=True); chk('Top-3 default', close(s('ST_Concentration','D7'),sum(top[:3])), 'ranked exposure')
for nm,ch in [('sqrt',{'setup.agg':'Square root of sum of squares'}),('adverse',{'setup.plan':'Adverse'}),('profit',{'setup.profit':'Yes'}),('off',{'risk.active.%d'%i:'No' for i in range(3,14)})]:
    D=copy.deepcopy(S0); D.update(ch); w=run('ST-M01 Stress Testing Master Model.xlsx','st_map.json',D,'st_'+nm); v=w['ST_Combined']['D32'].value
    ok=isinstance(v,(int,float))
    if nm=='sqrt': ok=ok and close(w['ST_Combined']['D23'].value, math.sqrt(sum((w['ST_Combined']['D%d'%r].value)**2 for r in range(7,20))))
    if nm=='off': ok=ok and close(w['ST_Combined']['D23'].value, w['ST_Combined']['D7'].value+w['ST_Combined']['D8'].value)
    if nm=='adverse': ok=ok and w['Handover']['C6'].value=='Adverse' and close(w['Handover']['C11'].value, w['ST_Combined']['C23'].value)
    chk('Stress variant '+nm, ok, 'severe CRAR %.4f'%v)
# ---- ICAAP
I0=json.load(open(O+'icaap_example.json'))
wi=run('ICAAP-M01 ICAAP Master Model.xlsx','icaap_map.json',I0,'ic_base'); i=lambda sh,c: wi[sh][c].value
chk('ICAAP capital', close(i('In_Capital','B23'),380) and close(i('In_Capital','B36'),25) and close(i('In_RWA','D39'),2154.5), 'Tier 1 380, Tier 2 25, RWA 2154.5')
p2=sum(i('Risk_Universe','G%d'%r) for r in range(7,30)); chk('ICAAP aggregation', close(i('Aggregation','B8'),p2) and close(i('Aggregation','B11'), 0.15*2154.5+p2+max(0,i('Aggregation','B9')-p2)), 'requirement = P1 + P2 + excess stress buffer')
from statistics import NormalDist
N=NormalDist(); pdv=min(.9999,max(.0003,I0['seg.pd.1'])); lg=I0['seg.lgd.1']; R=0.12
K=lg*(N.cdf((N.inv_cdf(pdv)+math.sqrt(R)*N.inv_cdf(0.999))/math.sqrt(1-R))-pdv)
chk('ICAAP Basel K seg 1', close(i('P2_Credit','F7'),K,1e-6), '%.6f vs %.6f'%(i('P2_Credit','F7'),K))
gi=[250+18-100,305+24-122,360+30-145]; chk('ICAAP op risk', close(i('P2_Operational','B16'),0.15*sum(gi)/3), 'BIA')
rsa=[40,40,110,170,160,380,520,430,110,40]; rsl=[60,60,150,220,200,400,380,240,60,20]; mid=[0.01,0.03,0.06,0.125,0.21,0.375,0.75,2,4,7]
eve=abs(-sum((a-l)*m*0.02 for a,l,m in zip(rsa,rsl,mid))); chk('ICAAP EVE', close(i('P2_IRRBB','B21'),eve), '%.4f vs %.4f'%(i('P2_IRRBB','B21'),eve))
t1=380+105*0.9+40; chk('ICAAP plan Y1', close(i('Capital_Plan','C14'),t1) and close(i('Capital_Plan','C18'),(t1+45)/(2154.5*1.22)), 'Tier 1 and CRAR year 1')
for nm,ch in [('sqrt',{'setup.agg':'Square root of sum of squares'}),('full',{'setup.stress':'Add in full'}),('excl',{'setup.stress':'Exclude'}),('ul',{'setup.layer':'Upper Layer','setup.mincet1':0.09}),('bl',{'setup.layer':'Base Layer'})]:
    D=copy.deepcopy(I0); D.update(ch); w=run('ICAAP-M01 ICAAP Master Model.xlsx','icaap_map.json',D,'ic_'+nm); v=w['Aggregation']['B11'].value
    ok=isinstance(v,(int,float))
    if nm=='full': ok=ok and close(v, 0.15*2154.5+p2+w['Aggregation']['B9'].value)
    if nm=='excl': ok=ok and close(v, 0.15*2154.5+p2)
    if nm=='sqrt': ok=ok and w['Aggregation']['B8'].value<i('Aggregation','B8')
    if nm=='ul': ok=ok and w['Capital_Adequacy']['D13'].value=='GREEN'
    if nm=='bl': ok=ok and w['Capital_Adequacy']['D14'].value in ('GREEN','RED')
    chk('ICAAP variant '+nm, ok, 'requirement %.3f'%v)
print('\nFAILURES:',len(fails)); [print('  ',f) for f in fails]
# ---- additional invariants (25-11-2026)
chk('Stress ratio never improves', all(ws['ST_Combined']['%s32'%c].value <= ws['ST_Combined']['B20'].value+1e-9 for c in 'BCD') and all(ws['Sensitivity']['C%d'%r].value <= ws['ST_Combined']['B20'].value+1e-9 for r in range(7,17)), 'post-stress CRAR <= pre-stress in every scenario and sensitivity row')
D=copy.deepcopy(E0); D['setup.s2start']='1+ DPD'; D['tape']=[['T1','MSME Secured Loans',100,0,0,'N','N'],['T2','MSME Secured Loans',10,20,0,'Y','N'],['T3','MSME Secured Loans',5,0,0,'Y','N']]; D['setup.source']='Loan tape'
w=run('ECL-M01 ECL Master Model.xlsx','ecl_map.json',D,'ecl_tape1')
chk('ECL tape 1+ DPD no double count', close(w['EAD']['E8'].value,100) and close(w['EAD']['F8'].value,15) and w['EAD']['J8'].value=='OK', 'Stage 1 %s, Stage 2 %s'%(w['EAD']['E8'].value,w['EAD']['F8'].value))
print('\nFAILURES:',len(fails)); [print('  ',f) for f in fails]

# ---- compliance testing model (CMP-M01): rules re-stated in Python and compared with the worked example
import subprocess, sys
_r = subprocess.run([sys.executable, 'check_compliance.py', 'out'], capture_output=True, text=True); print(_r.stdout[-1500:])
if 'FAILURES: 0' not in _r.stdout: fails.append(('CMP-M01', 'check_compliance.py reported failures'))
print('\nFAILURES:', len(fails)); [print('  ', f) for f in fails]

# ---- Tier 3 models (SEC-M01, RBIA-M01, EWS-M01, BP-M01): rules re-stated in Python and compared with the worked examples
_r = subprocess.run([sys.executable, 'check_tier3.py', 'out'], capture_output=True, text=True); print(_r.stdout[-600:])
if 'All Tier 3 checks passed' not in _r.stdout: fails.append(('Tier 3 models', 'check_tier3.py reported failures'))
print('\nFAILURES:', len(fails)); [print('  ', f) for f in fails]

# ---- KFS-M01: the illustration annexed to the RBI (NBFCs – Responsible Business Conduct) Directions, 2025, para 29(3), must give an APR of 17.07%
import json as _j, os as _o, recalc as _rc, fill_model as _fm
_D = {'loan.product': 'Personal loan', 'loan.amount': 20000, 'loan.rate': 0.15, 'loan.n': 24, 'loan.date': '2026-01-01', 'fee.proc': 240, 'fee.third': 160}
_p = 'out/_kfs_rbi_test.xlsx'; _fm.fill('out/KFS-M01 Key Facts Statement and APR Calculator.xlsx', 'out/kfs_map.json', _D, _p); _w, _n, _e, _b = _rc.recalc(_p); _o.remove(_p)
_apr = _w['APR']['B13'].value; _tot = [r for r in range(5, 40) if 'Total amount to be paid' in str(_w['Key Facts Statement']['B%d' % r].value)]
print(('PASS' if abs(_apr - 0.1707) < 0.00005 else 'FAIL') + ' KFS-M01 reproduces the RBI illustration: APR %.4f%% (Directions: 17.07%%)' % (_apr * 100))
if abs(_apr - 0.1707) >= 0.00005: fails.append(('KFS-M01', 'APR of the RBI illustration'))
if not _tot or abs(_w['Key Facts Statement']['C%d' % _tot[0]].value - 23273.59) > 0.01: fails.append(('KFS-M01', 'total amount to be paid in the KFS'))
print('\nFAILURES:', len(fails)); [print('  ', f) for f in fails]
