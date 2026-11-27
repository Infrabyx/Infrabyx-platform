"""Build the three masters and the three worked examples, chaining the hand-overs."""
import subprocess, json, sys
import fill_model, handover, recalc
O = 'out/'; EX = ' – Worked Example (fictitious NBFC).xlsx'
M = {'ecl': ('ECL-M01 ECL Master Model.xlsx', 'ECL-M01 ECL Model' + EX), 'st': ('ST-M01 Stress Testing Master Model.xlsx', 'ST-M01 Stress Testing Model' + EX), 'icaap': ('ICAAP-M01 ICAAP Master Model.xlsx', 'ICAAP-M01 ICAAP Model' + EX)}
for k, b in (('ecl', 'build_ecl.py'), ('st', 'build_stress.py'), ('icaap', 'build_icaap.py')):
    subprocess.run([sys.executable, b, O + M[k][0], O + k + '_map.json'], check=True)
for k, e in (('ecl', 'example_ecl.py'), ('st', 'example_stress.py'), ('icaap', 'example_icaap.py')):
    subprocess.run([sys.executable, e, O + k + '_example.json'], check=True)
print(fill_model.fill(O + M['ecl'][0], O + 'ecl_map.json', json.load(open(O + 'ecl_example.json')), O + M['ecl'][1]))
d = handover.carry(O + M['ecl'][1], 'stress', json.load(open(O + 'st_example.json'))); json.dump(d, open(O + 'st_example.json', 'w'), ensure_ascii=False, indent=0)
print(fill_model.fill(O + M['st'][0], O + 'st_map.json', d, O + M['st'][1]))
d = json.load(open(O + 'icaap_example.json')); handover.carry(O + M['ecl'][1], 'icaap', d); handover.carry(O + M['st'][1], 'icaap', d); json.dump(d, open(O + 'icaap_example.json', 'w'), ensure_ascii=False, indent=0)
print(fill_model.fill(O + M['icaap'][0], O + 'icaap_map.json', d, O + M['icaap'][1]))
for k in M:
    for f in M[k]:
        wb, n, errs, blank = recalc.recalc(O + f); print(f, '| formulas', n, '| errors', len(errs), errs[:3])

# ---- further models (25-11-2026): each is built, filled with its worked example and recalculated
MORE = [('build_ratio.py', 'RATIO-M01 Regulatory and Financial Ratio Master Model.xlsx', 'ratio', 'example_ratio.py', 'RATIO-M01 Ratio Model' + EX, ['out/ratio_rules.json']),
        ('build_applicability.py', 'APP-M01 Applicability Engine Master Model.xlsx', 'app', 'example_app.py', 'APP-M01 Applicability Engine' + EX, ['data/applicability_register.json', 'out/app_rules.json']),
        ('build_iracp.py', 'IRAC-M01 Asset Classification and Provisioning Engine.xlsx', 'irac', 'example_iracp.py', 'IRAC-M01 Classification Engine' + EX, []),
        ('build_alm.py', 'ALM-M01 Asset Liability Management and Liquidity Model.xlsx', 'alm', 'example_alm.py', 'ALM-M01 ALM Model' + EX, []),
        ('build_exposure.py', 'EXP-M01 Exposure and Concentration Limits Monitor.xlsx', 'exp', 'example_exposure.py', 'EXP-M01 Exposure Monitor' + EX, []),
        ('build_pricing.py', 'KFS-M01 Key Facts Statement and APR Calculator.xlsx', 'kfs', 'example_pricing.py', 'KFS-M01 APR Calculator' + EX, []),
        ('build_dividend.py', 'DIV-M01 Dividend Eligibility and Early Warning Monitor.xlsx', 'div', 'example_dividend.py', 'DIV-M01 Dividend Monitor' + EX, []),
        ('build_lending.py', 'LEND-M01 Lending Limits Monitor.xlsx', 'lend', 'example_lending.py', 'LEND-M01 Lending Limits Monitor' + EX, []),
        ('build_compliance.py', 'CMP-M01 Compliance Testing Master Model.xlsx', 'cmp', 'example_compliance.py', 'CMP-M01 Compliance Testing Model' + EX, []),
        ('build_securitisation.py', 'SEC-M01 Securitisation Retention Master Model.xlsx', 'sec', 'example_securitisation.py', 'SEC-M01 Securitisation Retention Model' + EX, []),
        ('build_rbia.py', 'RBIA-M01 Audit Risk Assessment Master Model.xlsx', 'rbia', 'example_rbia.py', 'RBIA-M01 Audit Risk Assessment Model' + EX, []),
        ('build_ews.py', 'EWS-M01 Fraud Early Warning Master Model.xlsx', 'ews', 'example_ews.py', 'EWS-M01 Fraud Early Warning Model' + EX, []),
        ('build_bp.py', 'BP-M01 Business Plan Master Model.xlsx', 'bp', 'example_bp.py', 'BP-M01 Business Plan Model' + EX, [])]
for b, master, k, ex, exname, extra in MORE:
    subprocess.run([sys.executable, b, O + master, O + k + '_map.json'] + extra, check=True)
    subprocess.run([sys.executable, ex, O + k + '_example.json'], check=True)
    print(fill_model.fill(O + master, O + k + '_map.json', json.load(open(O + k + '_example.json')), O + exname))
    for f in (master, exname):
        wb, n, errs, blank = recalc.recalc(O + f); print(f, '| formulas', n, '| errors', len(errs), errs[:3])

# ---- compliance testing model: independent checks of the worked example (25-11-2026)
subprocess.run([sys.executable, 'check_compliance.py', 'out'], check=True)

# ---- Tier 3 models (SEC-M01, RBIA-M01, EWS-M01, BP-M01): independent checks of the worked examples (25-11-2026)
subprocess.run([sys.executable, 'check_tier3.py', 'out'], check=True)
