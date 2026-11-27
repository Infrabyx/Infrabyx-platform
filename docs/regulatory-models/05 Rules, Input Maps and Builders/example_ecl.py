"""Worked example data for the ECL model – a fictitious NBFC (Illustrative Finance Limited). Figures are invented."""
import json, math, sys
D = {'setup.company': 'Illustrative Finance Limited (fictitious example)', 'setup.date': '2026-03-31', 'setup.units': '₹ crore', 'setup.basis': 'Ind AS', 'setup.layer': 'Middle Layer',
     'setup.source': 'Summary', 'setup.s2start': '31+ DPD', 'setup.macro': 'Multiplier'}
segs = [  # name, security, pd method, lgd method, eir, tenor, book, shares(cur,1-30,31-60,61-90,91-180,181-365,>365), undrawn, new-default share
    ('MSME Secured Loans', 'Secured', 'Roll rate', 'Collateral', 0.15, 3.0, 420, (0.930, 0.025, 0.010, 0.006, 0.012, 0.010, 0.007), 25, 0.0022),
    ('Loan Against Property', 'Secured', 'Roll rate', 'Collateral', 0.13, 6.0, 610, (0.950, 0.020, 0.008, 0.004, 0.008, 0.006, 0.004), 10, 0.0015),
    ('Unsecured Business Loans', 'Unsecured', 'Roll rate', 'Workout', 0.22, 1.5, 250, (0.900, 0.035, 0.015, 0.010, 0.018, 0.014, 0.008), 0, 0.0045),
    ('Personal Loans', 'Unsecured', 'Default history', 'Workout', 0.20, 2.0, 180, (0.920, 0.030, 0.012, 0.008, 0.014, 0.010, 0.006), 0, 0),
    ('Vehicle Finance', 'Secured', 'Default history', 'Collateral', 0.14, 3.0, 300, (0.925, 0.030, 0.012, 0.008, 0.012, 0.008, 0.005), 0, 0),
    ('Supply Chain Finance', 'Unsecured', 'Manual', 'Manual', 0.12, 0.5, 240, (0.975, 0.012, 0.005, 0.003, 0.003, 0.002, 0.000), 120, 0)]
for k, (nm, sec, pdm, lgm, eir, ten, book, sh, und, nd) in enumerate(segs, 1):
    D.update({'seg.name.%d' % k: nm, 'seg.active.%d' % k: 'Yes', 'seg.sec.%d' % k: sec, 'seg.pdm.%d' % k: pdm, 'seg.lgdm.%d' % k: lgm, 'seg.eir.%d' % k: eir, 'seg.tenor.%d' % k: ten,
              'seg.ccf.%d' % k: 0.5 if und else 0.0, 'seg.rho.%d' % k: 0.15 if sec == 'Secured' else 0.08, 'seg.mpd.%d' % k: 0.012, 'seg.mlgd.%d' % k: 0.50, 'seg.std.%d' % k: 0.004})
    for j, s in enumerate(sh):
        D['port.b%d.%d' % (j, k)] = round(book * s, 2)
    D['port.undrawn.%d' % k] = und; D['port.restr.%d' % k] = round(book * 0.006, 2); D['port.sicr.%d' % k] = round(book * 0.004, 2)
    s3 = book * sum(sh[4:])
    D.update({'npa.ss.%d' % k: round(s3 * 0.55, 2), 'npa.d1.%d' % k: round(s3 * (0.20 if sec == 'Secured' else 0.0), 2), 'npa.d2.%d' % k: round(s3 * (0.10 if sec == 'Secured' else 0.0), 2),
              'npa.d3.%d' % k: 0, 'npa.du.%d' % k: round(s3 * (0.10 if sec == 'Secured' else 0.40), 2), 'npa.loss.%d' % k: round(s3 * 0.05, 2)})
    if pdm == 'Roll rate':
        for mth in range(25):
            scale = book / (1.015 ** (24 - mth)); wob = 1 + 0.08 * math.sin(mth * 1.3 + k)
            vals = [scale * sh[0], scale * sh[1] * wob, scale * sh[2] * wob, scale * sh[3] * wob, scale * nd * wob]
            yr, mo = divmod(3 + mth, 12); D['hist.%d.m%d.date' % (k, mth + 1)] = '%s-%d' % (['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo], 2024 + yr)
            for j, v in enumerate(vals):
                D['hist.%d.m%d.b%d' % (k, mth + 1, j)] = round(v, 3)
    if pdm == 'Default history':
        rate = [0.034, 0.041, 0.036, 0.031, 0.029] if sec == 'Unsecured' else [0.022, 0.027, 0.024, 0.021, 0.019]
        for y in range(5, 0, -1):
            op = book * 0.9 / (1.18 ** y); D['def.open.%d.y%d' % (k, y)] = round(op, 2); D['def.amt.%d.y%d' % (k, y)] = round(op * rate[5 - y], 2)
    if lgm == 'Workout':
        D.update({'lgd.wead.%d' % k: 40, 'lgd.wrec.%d' % k: 14, 'lgd.wcost.%d' % k: 2, 'lgd.wyrs.%d' % k: 1.5})
    if lgm == 'Collateral':
        D.update({'lgd.cval.%d' % k: round(book * (1.6 if 'Property' in nm else 1.25), 2), 'lgd.chair.%d' % k: 0.30, 'lgd.cyrs.%d' % k: 2, 'lgd.ccost.%d' % k: 0.05, 'lgd.cexp.%d' % k: book})
    D['bt.pred.%d' % k] = [0.020, 0.016, 0.050, 0.034, 0.022, 0.012][k - 1]; D['bt.act.%d' % k] = [0.022, 0.015, 0.068, 0.036, 0.035, 0.008][k - 1]
for j, (b, u, dn) in enumerate([(6.5, 7.2, 5.6), (4.5, 4.0, 5.5), (5.25, 5.0, 6.0), (7.5, 7.0, 8.5), (8.0, 10.0, 3.0), (None, None, None)], 1):
    if b is not None:
        D.update({'macro.val.%d.base' % j: b, 'macro.val.%d.up' % j: u, 'macro.val.%d.down' % j: dn})
D['macro.var.5'] = 'MSME credit growth (%)'; D['ovl.s2.3'] = 0.75; D['ovl.why.3'] = 'Overlay for stress in two textile clusters; approved by the ECL committee (illustrative)'
D.update({'mov.open.s1': 26.0, 'mov.open.s2': 5.2, 'mov.open.s3': 27.0, 'mov.t2.s1': -0.6, 'mov.t2.s2': 0.6, 'mov.t3.s2': -1.1, 'mov.t3.s3': 1.1, 'mov.new.s1': 4.0, 'mov.derec.s1': -2.8, 'mov.derec.s2': -0.7,
          'mov.derec.s3': -2.5, 'mov.wo.s3': -6.0, 'ir.held': 0, 'bt.ecl_prev': 13.7, 'bt.loss_act': 12.9})
json.dump(D, open(sys.argv[1], 'w'), indent=0, ensure_ascii=False)
print(len(D), 'values')
