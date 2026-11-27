"""Regulatory and Financial Ratio Master Model for NBFCs. Run: python3 build_ratio.py <out.xlsx> <map.json> [rules.json]"""
import sys, json
from xl import *

B = Book('RATIO-M01', 'Regulatory and Financial Ratio Master Model')
YN = ['Yes', 'No']
CATS = ['Investment and Credit Company', 'Microfinance Institution', 'Factor', 'Infrastructure Finance Company', 'Infrastructure Debt Fund', 'Housing Finance Company', 'Core Investment Company', 'Mortgage Guarantee Company', 'Other']
CAD = 'Capital Adequacy Directions (MD 345)'; SBR = 'Registration and Scale Based Regulation Directions'; CON = 'Concentration Risk Management Directions'; ALM = 'Asset Liability Management Directions'
DIV = 'Declaration of Dividends Directions'; DEP = 'Acceptance of Public Deposits Directions'; IRA = 'Income Recognition, Asset Classification and Provisioning Directions (MD 356)'; MIS = 'Miscellaneous Supervisory Directions (MD 467) – Prompt Corrective Action'

readme(B, 'Regulatory and Financial Ratio Master Model',
       ['This workbook computes the regulatory and financial ratios of an NBFC from its balance sheet, profit and loss account and DNBS returns, compares each ratio with the regulatory limit and the company\'s own internal trigger, and shows the result in Red / Amber / Green.',
        'Only the ratios that apply to the company\'s layer and category are tested; the others show "Not applicable". The company profile on the Setup sheet decides this, and any line can be overridden on the Ratios sheet.'],
       ['Setup: enter the company name, reporting date, units, regulatory layer, category and the other profile answers.',
        'Data Input: enter each figure for the current period, the previous period and the same period last year. Column C gives the definition and column D the place in the balance sheet or DNBS return where the figure is found. The data-fill script enters what it can read from the return files; the rest is typed.',
        'Ratios: read each ratio, its limit, internal trigger, result and reference. Change a limit or trigger only after checking the direction; record why.',
        'Dashboard: read the summary, the list of breaches and near-breaches and the Prompt Corrective Action position.',
        'Clear the Checks sheet before relying on the results.'],
       [('Method Notes', 'explains how every ratio is computed'), ('Setup', 'company profile and options'), ('Data Input', 'figures with definitions and sources'), ('Ratios', 'ratio, limit, trigger, result and reference'),
        ('Dashboard', 'summary, breaches and trend'), ('Rules', 'the same rules in a table for use in software'), ('Checks', 'integrity checks'), ('Source Map', 'where each input comes from')])

# ------------------------------------------------------------------ Setup
s = B.sheet('Setup', (62, 30, 40), tab='C00000')
s.title('Setup – company profile', 'These answers decide which ratios apply. Yellow cells are inputs.')
setup = [(4, 'Company name', 'setup.company', 'Name of the NBFC', 'txt', None, ''), (5, 'Reporting date', 'setup.date', None, 'date', None, ''), (6, 'Amounts are in', 'setup.units', '₹ lakh', 'txt', ['₹ crore', '₹ lakh', '₹'], 'DNBS returns are in ₹ lakh'),
         (7, 'Regulatory layer', 'setup.layer', 'Base Layer', 'txt', ['Base Layer', 'Middle Layer', 'Upper Layer'], ''), (8, 'Category of NBFC', 'setup.cat', CATS[0], 'txt', CATS, ''),
         (9, 'Accepts public deposits', 'setup.dep', 'No', 'txt', YN, ''), (10, 'Primarily lends against gold jewellery (50 per cent or more of financial assets)', 'setup.gold', 'No', 'txt', YN, 'See ratio "Gold loans to financial assets"'),
         (11, 'Liquidity Coverage Ratio applies', 'setup.lcr', 'No', 'txt', YN, 'Check the applicability paragraph of the ALM Directions for the asset size and type'),
         (12, 'Prompt Corrective Action framework applies', 'setup.pca', 'No', 'txt', YN, 'RBI (NBFCs – Miscellaneous) Supervisory Directions, 2026, para 3, proviso on Chapter V: deposit-taking NBFCs and non-deposit taking NBFCs in the Middle and Upper Layers; not NBFCs without public funds, Primary Dealers or HFCs'),
         (13, 'Accounting basis', 'setup.basis', 'IGAAP', 'txt', ['Ind AS', 'IGAAP'], ''), (14, 'Months covered by the profit and loss figures – current period', 'setup.m0', 12, 'int', None, 'Used to annualise'),
         (15, 'Months covered – previous period', 'setup.m1', 12, 'int', None, ''), (16, 'Months covered – same period last year', 'setup.m2', 12, 'int', None, ''),
         (17, 'Early-warning margin for internal triggers set by default', 'setup.margin', 0.10, 'pct', None, 'Information only; triggers are edited on the Ratios sheet')]
for r, lab, key, d, fmt, lst, note in setup:
    s.lbl('A%d' % r, lab); s.inp('B%d' % r, key, lab, d, fmt, 'Certificate of Registration; company decision', lst); s.lbl('C%d' % r, note)
s.lbl('A19', 'One crore expressed in the units selected'); s.f('B19', 'IF(B6="₹ crore",1,IF(B6="₹ lakh",100,10000000))', 'num')
ST = lambda c: q('Setup', c)
LAY, CAT, DEPF, GOLD, LCRF, PCAF, CR = ST('$B$7'), ST('$B$8'), ST('$B$9'), ST('$B$10'), ST('$B$11'), ST('$B$12'), ST('$B$19')
NOTBL = '%s<>"Base Layer"' % LAY
isc = lambda c: '%s="%s"' % (CAT, c)

# ------------------------------------------------------------------ Data input
D1, D2, DB, PL, CA, AQ, LQ, EX = 'DNBS01 Part 1 / DNBS02 Part 1 (sources of funds); balance sheet', 'DNBS01 Part 2 / DNBS02 Part 2 (application of funds); balance sheet', 'Balance sheet and notes', 'DNBS01 / DNBS02 Part 3 (profit and loss); statement of profit and loss', 'DNBS03 (capital funds and risk assets); DNBS02 Part 4 and Part 9', 'DNBS01 asset classification and NPA movement parts; NPA statement', 'DNBS04A / DNBS04B; ALM statements', 'DNBS01 / DNBS02 exposure parts; DNBS03 concentration part; MIS'
ITEMS = [
 ('# Balance sheet – liabilities',),
 ('eq', 'Paid-up equity share capital', 'Ordinary share capital paid up.', D1), ('ccps', 'Compulsorily convertible preference shares', 'Preference shares that must convert into equity.', D1),
 ('res', 'Reserves and surplus (total)', 'All reserves including securities premium, statutory reserve under section 45-IC, general reserve and balance of profit; before deducting accumulated loss.', D1),
 ('reval', 'Of which revaluation reserve', 'Reserve created on revaluation of assets; not part of owned fund.', D1), ('nw', 'Net worth as per financial statements', 'Share capital plus reserves less accumulated loss and miscellaneous expenditure.', DB),
 ('borr', 'Total borrowings (secured and unsecured)', 'All borrowings including debentures, bank loans, commercial paper, inter-corporate deposits, subordinated debt and interest accrued.', D1),
 ('bank', 'Of which borrowings from banks', 'Term loans, working capital, cash credit and overdraft from banks.', D1), ('cp', 'Of which commercial paper', 'Commercial paper outstanding.', D1),
 ('sub', 'Of which subordinated debt', 'Subordinated debt outstanding.', D1), ('b3', 'Borrowings payable within 3 months', 'Residual maturity up to 3 months.', D1), ('b12', 'Borrowings payable in more than 3 and up to 12 months', 'Residual maturity over 3 and up to 12 months.', D1),
 ('pd', 'Public deposits outstanding', 'Public deposits as defined in the deposit directions.', 'DNBS01; deposit register'), ('osl', 'Total outside liabilities', 'Total liabilities as per the balance sheet excluding paid-up capital and reserves and surplus, including all hybrid debt and provisions.', D1),
 ('# Balance sheet – assets',),
 ('ta', 'Total assets', 'Balance sheet total.', D2), ('intang', 'Intangible assets', 'Goodwill, software and other intangible assets, and miscellaneous expenditure not written off.', D2),
 ('fa', 'Financial assets', 'Loans and advances, investments, cash and bank balances held as financial business assets and other financial assets (excluding fixed assets, tax assets and other non-financial assets).', D2 + '; auditor\'s working for principal business'),
 ('loans', 'Gross loans and advances', 'Loans and advances before provisions, including hire purchase and lease assets and bills discounted.', D2), ('sec', 'Of which secured loans', 'Loans secured by tangible security.', D2),
 ('unsec', 'Of which unsecured loans', 'Loans without tangible security.', D2), ('inv', 'Total investments', 'Long-term and current investments.', D2), ('cash', 'Cash and bank balances', 'Cash in hand and balances and deposits with banks.', D2),
 ('liq', 'Unencumbered liquid assets', 'Cash, bank balances free of lien and readily saleable investments that are not pledged.', 'Treasury MIS; DNBS04A'), ('avgta', 'Average total assets for the period', 'Average of opening and closing total assets (leave blank to use closing total assets).', DB),
 ('avgloan', 'Average gross loans for the period', 'Average of opening and closing gross loans (leave blank to use closing loans).', DB), ('avgborr', 'Average borrowings for the period', 'Average of opening and closing borrowings (leave blank to use closing borrowings).', DB),
 ('# Profit and loss (for the months stated on Setup)',),
 ('inc', 'Total income (gross income)', 'Total income from financial and non-financial business.', PL), ('finc', 'Income from financial assets', 'Fund-based and fee-based income from financial business.', PL),
 ('ii', 'Interest income', 'Interest on loans, deposits and investments.', PL), ('fee', 'Fee and other operating income', 'Fee-based and miscellaneous income.', PL), ('ie', 'Interest expense and other financing cost', 'Interest and financing charges on borrowings.', PL),
 ('opex', 'Operating expenses', 'Employee cost, depreciation and other administrative cost.', PL), ('prov', 'Provisions and write-offs', 'Provisions against non-performing assets, bad debts written off and diminution in investments (or impairment on financial instruments under Ind AS).', PL),
 ('pat', 'Profit after tax', 'Net profit or loss after tax.', PL), ('divd', 'Dividend proposed for the year (equity and compulsorily convertible preference shares)', 'Total dividend proposed, including interim dividend.', 'Board resolution; DNBS10'),
 ('excp', 'Exceptional or extraordinary profit included in profit after tax', 'To be reduced from net profit for the dividend payout ratio.', 'Financial statements; auditor\'s report'),
 ('# Regulatory capital',),
 ('of', 'Owned fund', 'Paid-up equity, compulsorily convertible preference shares, free reserves, securities premium and capital reserve from sale of assets, less accumulated loss, deferred revenue expenditure and other intangible assets.', CA),
 ('nof', 'Net owned fund', 'Owned fund less investments in shares of subsidiaries, group companies and other NBFCs and loans to subsidiaries and group companies in excess of 10 per cent of owned fund.', CA),
 ('t1', 'Tier 1 capital', 'As computed under the capital adequacy directions.', CA), ('t2', 'Tier 2 capital', 'As computed under the capital adequacy directions, before the cap at Tier 1.', CA), ('cet1', 'Common Equity Tier 1 capital (Upper Layer)', 'As computed under the capital adequacy directions.', CA),
 ('rwa', 'Total risk-weighted assets', 'On-balance sheet and off-balance sheet risk-weighted assets.', CA), ('anw', 'Adjusted net worth (Core Investment Company)', 'As defined in the Core Investment Companies directions.', 'DNBS12'),
 ('# Asset quality',),
 ('std', 'Standard assets', 'Loans classified as standard.', AQ), ('gnpa', 'Gross non-performing assets', 'Sub-standard, doubtful and loss assets.', AQ), ('npaprov', 'Provisions held for non-performing assets', 'Specific provisions against NPAs.', AQ),
 ('stdprov', 'Provision held for standard assets', 'General provision on standard assets.', AQ), ('restr', 'Restructured standard assets', 'Standard accounts under restructuring.', AQ), ('slip', 'Fresh slippages to NPA during the period', 'Additions to NPA during the period.', AQ),
 ('wo', 'Write-offs during the period', 'Loans written off during the period.', AQ), ('sma2', 'Special mention accounts – SMA-2', 'Overdue 61 to 90 days.', 'CRILC / DNBS08; MIS'), ('dpd30', 'Loans overdue more than 30 days (including NPAs)', 'Portfolio at risk over 30 days.', 'MIS'),
 ('s2', 'Stage 2 exposure (Ind AS)', 'Exposure with a significant increase in credit risk.', 'ECL note'), ('s3', 'Stage 3 exposure (Ind AS)', 'Credit-impaired exposure.', 'ECL note'), ('ecl', 'Total expected credit loss allowance (Ind AS)', 'Loss allowance on loans.', 'ECL note'),
 ('nn1', 'Net NPA ratio – previous year end', 'Enter as a percentage.', 'Previous financial statements'), ('nn2', 'Net NPA ratio – year end before that', 'Enter as a percentage.', 'Previous financial statements'),
 ('# Liquidity',),
 ('hqla', 'High quality liquid assets (after haircuts)', 'Stock of HQLA as defined for the Liquidity Coverage Ratio.', LQ), ('nco', 'Total net cash outflows over the next 30 days (stressed)', 'As computed for the Liquidity Coverage Ratio.', LQ),
 ('in1', 'Cash inflows – 1 to 7 days', 'Structural liquidity statement.', LQ), ('out1', 'Cash outflows – 1 to 7 days', 'Structural liquidity statement.', LQ), ('in2', 'Cash inflows – 8 to 14 days', 'Structural liquidity statement.', LQ),
 ('out2', 'Cash outflows – 8 to 14 days', 'Structural liquidity statement.', LQ), ('in3', 'Cash inflows – 15 to 30/31 days', 'Structural liquidity statement.', LQ), ('out3', 'Cash outflows – 15 to 30/31 days', 'Structural liquidity statement.', LQ),
 ('appsec', 'Unencumbered approved securities held against public deposits', 'At a value not exceeding current market price.', 'Deposit-taking NBFC: liquid assets return'),
 ('# Exposures and concentration',),
 ('single', 'Largest exposure to a single party (credit and investment)', 'Funded and non-funded exposure to the largest single borrower.', EX), ('group', 'Largest exposure to a single group of parties', 'Aggregate exposure to the largest borrower group.', EX),
 ('top20', 'Exposure to the twenty largest borrowers', 'Aggregate of the twenty largest.', EX), ('ipo', 'Largest loan to one borrower for subscribing to an initial public offer', 'Highest amount financed per borrower.', 'MIS'),
 ('cme', 'Total capital market exposure', 'Advances to and investments in the capital market.', EX), ('cre', 'Commercial real estate exposure', 'Fund and non-fund based exposure.', EX), ('grpx', 'Exposure to subsidiaries and group companies (loans and investments)', 'As used for the net owned fund deduction.', CA),
 ('gold', 'Loans against gold jewellery', 'Outstanding loans secured by gold jewellery.', EX), ('mfi', 'Microfinance loans (qualifying assets)', 'Loans meeting the definition of microfinance loan.', 'MIS; DNBS01'), ('infra', 'Infrastructure loans', 'Loans to infrastructure sub-sectors.', 'MIS'),
 ('hf', 'Housing finance assets (Housing Finance Company)', 'Assets counted as housing finance.', 'HFC returns'), ('hfi', 'Of which housing finance to individuals', 'Individual housing loans.', 'HFC returns'), ('fct', 'Factoring assets', 'Receivables acquired under factoring.', 'MIS'),
 ('fcti', 'Income from factoring business', 'For the period.', 'MIS'), ('cicg', 'Investments and loans in group companies (Core Investment Company)', 'Equity, preference shares, bonds, debentures, debt and loans in group companies.', 'DNBS11 / DNBS12'),
 ('cice', 'Of which equity investments in group companies', 'Including instruments compulsorily convertible into equity within the period allowed.', 'DNBS11 / DNBS12'), ('netassets', 'Net assets (Core Investment Company)', 'As defined in the Core Investment Companies directions.', 'DNBS11 / DNBS12'),
 ('land', 'Land and buildings not for own use', 'Investment in land or buildings other than for own use.', 'Fixed assets and investments notes'), ('dlg', 'Default loss guarantee cover outstanding on the portfolio', 'Total DLG cover provided by providers.', 'DLG register'),
 ('dlgp', 'Loan portfolio covered by default loss guarantee', 'Amount of the DLG set (disbursed).', 'DLG register')]
d = B.sheet('Data Input', (5, 52, 60, 46, 16, 16, 16), tab='BF9000')
d.title('Data Input – figures with definitions and sources', 'Enter the current period, the previous period and the same period last year. Leave a cell blank where the item does not apply.')
d.head(6, ['#', 'Item', 'Definition', 'Where to find it', 'Current period', 'Previous period', 'Same period last year'])
IR = {}; r = 7; n = 0
for it in ITEMS:
    if len(it) == 1:
        d.sec('A%d' % r, it[0][2:], 7); r += 1; continue
    key, lab, df, src = it; n += 1; IR[key] = r
    d.lbl('A%d' % r, n); d.lbl('B%d' % r, lab); d.lbl('C%d' % r, df); d.lbl('D%d' % r, src)
    for c, per in zip('EFG', ('cur', 'prev', 'ly')):
        d.inp('%s%d' % (c, r), 'data.%s.%s' % (key, per), '%s – %s' % (lab, {'cur': 'current period', 'prev': 'previous period', 'ly': 'same period last year'}[per]), None, 'pct' if key in ('nn1', 'nn2') else 'num', src)
    r += 1
DEND = r - 1


def X(expr, col):
    """Replace {key} by the Data Input cell of the given period column; {m} by the months cell; {key!} keeps blank-as-zero."""
    out = expr.replace('{m}', ST('$B$%d' % {'E': 14, 'F': 15, 'G': 16}[col]))
    for k, row in sorted(IR.items(), key=lambda kv: -len(kv[0])):
        out = out.replace('{%s}' % k, "N('Data Input'!%s%d)" % (col, row))
    return out


ANN = '12/MAX(1,{m})'
AVA = 'IF({avgta}>0,{avgta},{ta})'; AVL = 'IF({avgloan}>0,{avgloan},{loans})'; AVB = 'IF({avgborr}>0,{avgborr},{borr})'
NIPO = '{ipo}/%s' % CR
cum = lambda k: {1: ('{in1}', '{out1}'), 2: ('{in1}+{in2}', '{out1}+{out2}'), 3: ('{in1}+{in2}+{in3}', '{out1}+{out2}+{out3}')}[k]
# (id, family, name, how computed, numerator, denominator (None = amount), type, limit, applies, reference, format)
RT = [
 ('C01', 'Capital and leverage', 'Capital to risk-weighted assets ratio (CRAR)', '(Tier 1 + Tier 2 capped at Tier 1) / risk-weighted assets', '{t1}+MIN({t2},{t1})', '{rwa}', 'Minimum', 0.15, 'OR(%s,%s="Yes")' % (NOTBL, GOLD), CAD + ', para 6(1) and 6(3)', 'pct'),
 ('C02', 'Capital and leverage', 'Tier 1 capital ratio', 'Tier 1 capital / risk-weighted assets', '{t1}', '{rwa}', 'Minimum', '=IF(%s="Yes",0.12,0.10)' % GOLD, 'OR(%s,%s="Yes")' % (NOTBL, GOLD), CAD + ', para 6(1) and 6(2)', 'pct'),
 ('C03', 'Capital and leverage', 'Common Equity Tier 1 ratio', 'CET1 capital / risk-weighted assets', '{cet1}', '{rwa}', 'Minimum', 0.09, '%s="Upper Layer"' % LAY, CAD + ', para 6(4)', 'pct'),
 ('C04', 'Capital and leverage', 'Tier 2 capital to Tier 1 capital', 'Tier 2 capital / Tier 1 capital', '{t2}', '{t1}', 'Maximum', 1.0, 'OR(%s,%s="Yes")' % (NOTBL, GOLD), CAD + ', para 6(1) and 6(3)', 'pct'),
 ('C05', 'Capital and leverage', 'Leverage ratio', 'Total outside liabilities / owned fund', '{osl}', '{of}', 'Maximum', 7, '%s="Base Layer"' % LAY, CAD + ', para 17', 'x'),
 ('C06', 'Capital and leverage', 'Net owned fund (₹ crore)', 'Net owned fund expressed in ₹ crore', '{nof}/%s' % CR, None, 'Minimum', 10, 'OR(%s,%s,%s)' % (isc(CATS[0]), isc(CATS[1]), isc(CATS[2])), SBR + ', para 39 (glide path for existing companies in the same paragraph)', 'num'),
 ('C07', 'Capital and leverage', 'Outside liabilities to adjusted net worth (Core Investment Company)', 'Total outside liabilities / adjusted net worth', '{osl}', '{anw}', 'Maximum', 2.5, isc(CATS[6]), 'Core Investment Companies Directions, para 23', 'x'),
 ('C08', 'Capital and leverage', 'Adjusted net worth to risk-weighted assets (Core Investment Company)', 'Adjusted net worth / risk-weighted assets', '{anw}', '{rwa}', 'Minimum', 0.30, isc(CATS[6]), 'Core Investment Companies Directions, para 20', 'pct'),
 ('C09', 'Capital and leverage', 'Debt to equity', 'Total borrowings / net worth', '{borr}', '{nw}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'x'),
 ('P01', 'Principal business and category criteria', 'Financial assets to total assets', 'Financial assets / (total assets less intangible assets)', '{fa}', '{ta}-{intang}', 'Minimum', 0.50, 'TRUE', SBR + ', para 38 (must be more than 50 per cent)', 'pct'),
 ('P02', 'Principal business and category criteria', 'Income from financial assets to gross income', 'Income from financial assets / total income', '{finc}', '{inc}', 'Minimum', 0.50, 'TRUE', SBR + ', para 38 (must be more than 50 per cent)', 'pct'),
 ('P03', 'Principal business and category criteria', 'Qualifying assets to total assets (Microfinance Institution)', 'Microfinance loans / (total assets less intangible assets)', '{mfi}', '{ta}-{intang}', 'Minimum', 0.60, isc(CATS[1]), 'Microfinance Institution Directions, para 12', 'pct'),
 ('P04', 'Principal business and category criteria', 'Infrastructure loans to total assets (Infrastructure Finance Company)', 'Infrastructure loans / total assets', '{infra}', '{ta}', 'Minimum', 0.75, isc(CATS[3]), SBR + ', definition of NBFC-IFC', 'pct'),
 ('P05', 'Principal business and category criteria', 'Gold loans to financial assets', 'Loans against gold jewellery / financial assets', '{gold}', '{fa}', 'Information', None, 'TRUE', CAD + ', definition of NBFC primarily engaged in lending against gold jewellery (50 per cent or more)', 'pct'),
 ('P06', 'Principal business and category criteria', 'Housing finance to total assets (Housing Finance Company)', 'Housing finance assets / (total assets less intangible assets)', '{hf}', '{ta}-{intang}', 'Minimum', 0.60, isc(CATS[5]), 'Housing Finance Companies Directions, para 10(9)(i)', 'pct'),
 ('P07', 'Principal business and category criteria', 'Individual housing finance to total assets (Housing Finance Company)', 'Housing finance to individuals / (total assets less intangible assets)', '{hfi}', '{ta}-{intang}', 'Minimum', 0.50, isc(CATS[5]), 'Housing Finance Companies Directions, para 10(9)(ii)', 'pct'),
 ('P08', 'Principal business and category criteria', 'Factoring assets to total assets (Factor)', 'Factoring assets / total assets', '{fct}', '{ta}', 'Minimum', 0.50, isc(CATS[2]), 'Miscellaneous Directions, para 42', 'pct'),
 ('P09', 'Principal business and category criteria', 'Factoring income to gross income (Factor)', 'Income from factoring / total income', '{fcti}', '{inc}', 'Minimum', 0.50, isc(CATS[2]), 'Miscellaneous Directions, para 42', 'pct'),
 ('P10', 'Principal business and category criteria', 'Group investments and loans to net assets (Core Investment Company)', 'Investments and loans in group companies / net assets', '{cicg}', '{netassets}', 'Minimum', 0.90, isc(CATS[6]), 'Core Investment Companies Directions, para 3(1)', 'pct'),
 ('P11', 'Principal business and category criteria', 'Group equity investments to net assets (Core Investment Company)', 'Equity investments in group companies / net assets', '{cice}', '{netassets}', 'Minimum', 0.60, isc(CATS[6]), 'Core Investment Companies Directions, para 3(2)', 'pct'),
 ('A01', 'Asset quality and provisioning', 'Gross NPA ratio', 'Gross NPA / gross loans', '{gnpa}', '{loans}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('A02', 'Asset quality and provisioning', 'Net NPA ratio', '(Gross NPA less NPA provisions) / (gross loans less NPA provisions)', '{gnpa}-{npaprov}', '{loans}-{npaprov}', 'Maximum', 0.06, 'TRUE', DIV + ', para 8 (below 6 per cent for dividend); ' + MIS + ' (risk threshold above 6 per cent)', 'pct'),
 ('A03', 'Asset quality and provisioning', 'Provision coverage ratio', 'NPA provisions / gross NPA', '{npaprov}', '{gnpa}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('A04', 'Asset quality and provisioning', 'Provision on standard assets', 'Standard asset provision / standard assets', '{stdprov}', '{std}', 'Minimum', '=IF(%s="Base Layer",0.0025,0.004)' % LAY, '%s<>"Upper Layer"' % LAY, IRA + ', para 48 (Base Layer 0.25 per cent) and para 55 (Middle Layer 0.40 per cent); Upper Layer rates are category-wise', 'p4'),
 ('A05', 'Asset quality and provisioning', 'Slippage ratio (annualised)', 'Fresh slippages x 12 / months / standard assets', '({slip})*%s' % ANN, '{std}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('A06', 'Asset quality and provisioning', 'Credit cost (annualised)', 'Provisions and write-offs x 12 / months / average gross loans', '({prov})*%s' % ANN, AVL, 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('A07', 'Asset quality and provisioning', 'Restructured standard assets to gross loans', 'Restructured standard assets / gross loans', '{restr}', '{loans}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('A08', 'Asset quality and provisioning', 'SMA-2 to gross loans', 'SMA-2 accounts / gross loans', '{sma2}', '{loans}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('A09', 'Asset quality and provisioning', 'Portfolio overdue more than 30 days', 'Loans overdue more than 30 days / gross loans', '{dpd30}', '{loans}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('A10', 'Asset quality and provisioning', 'Stage 3 ratio (Ind AS)', 'Stage 3 exposure / gross loans', '{s3}', '{loans}', 'Information', None, '%s="Ind AS"' % ST('$B$13'), 'Ind AS 109; internal limit', 'pct'),
 ('A11', 'Asset quality and provisioning', 'Stage 2 ratio (Ind AS)', 'Stage 2 exposure / gross loans', '{s2}', '{loans}', 'Information', None, '%s="Ind AS"' % ST('$B$13'), 'Ind AS 109; internal limit', 'pct'),
 ('A12', 'Asset quality and provisioning', 'Expected credit loss to gross loans (Ind AS)', 'Loss allowance / gross loans', '{ecl}', '{loans}', 'Information', None, '%s="Ind AS"' % ST('$B$13'), 'Ind AS 109; internal limit', 'pct'),
 ('L01', 'Liquidity and funding', 'Liquidity Coverage Ratio', 'High quality liquid assets / net cash outflows over 30 days', '{hqla}', '{nco}', 'Minimum', 1.0, '%s="Yes"' % LCRF, ALM + ', para 62', 'pct'),
 ('L02', 'Liquidity and funding', 'Cumulative mismatch – 1 to 7 days', '(Cumulative inflows less cumulative outflows) / cumulative outflows', '(%s)-(%s)' % cum(1), cum(1)[1], 'Minimum', -0.10, 'TRUE', ALM + ', para 39 (negative mismatch not above 10 per cent)', 'pct'),
 ('L03', 'Liquidity and funding', 'Cumulative mismatch – up to 14 days', '(Cumulative inflows less cumulative outflows) / cumulative outflows', '(%s)-(%s)' % cum(2), cum(2)[1], 'Minimum', -0.10, 'TRUE', ALM + ', para 39 (negative mismatch not above 10 per cent)', 'pct'),
 ('L04', 'Liquidity and funding', 'Cumulative mismatch – up to 30/31 days', '(Cumulative inflows less cumulative outflows) / cumulative outflows', '(%s)-(%s)' % cum(3), cum(3)[1], 'Minimum', -0.20, 'TRUE', ALM + ', para 39 (negative mismatch not above 20 per cent)', 'pct'),
 ('L05', 'Liquidity and funding', 'Liquid assets to public deposits', 'Unencumbered approved securities / public deposits', '{appsec}', '{pd}', 'Minimum', 0.15, '%s="Yes"' % DEPF, DEP + ', para 10', 'pct'),
 ('L06', 'Liquidity and funding', 'Public deposits to net owned fund', 'Public deposits / net owned fund', '{pd}', '{nof}', 'Maximum', 1.5, '%s="Yes"' % DEPF, DEP + ', para 17', 'x'),
 ('L07', 'Liquidity and funding', 'Borrowings due within 12 months to total borrowings', '(Borrowings due within 3 months + 3 to 12 months) / total borrowings', '{b3}+{b12}', '{borr}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('L08', 'Liquidity and funding', 'Commercial paper to total borrowings', 'Commercial paper / total borrowings', '{cp}', '{borr}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('L09', 'Liquidity and funding', 'Bank borrowings to total borrowings', 'Borrowings from banks / total borrowings', '{bank}', '{borr}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('L10', 'Liquidity and funding', 'Liquid assets to total assets', 'Unencumbered liquid assets / total assets', '{liq}', '{ta}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('E01', 'Exposure and concentration', 'Largest single-party exposure to Tier 1 capital', 'Largest exposure to a single party / Tier 1 capital', '{single}', '{t1}', 'Maximum', '=IF(%s,0.30,0.25)' % isc(CATS[3]), '%s<>"Upper Layer"' % LAY, CON + ', para 13 and 14 (higher limits for infrastructure exposure in the proviso to para 13)', 'pct'),
 ('E02', 'Exposure and concentration', 'Largest group exposure to Tier 1 capital', 'Largest exposure to a group / Tier 1 capital', '{group}', '{t1}', 'Maximum', '=IF(%s,0.50,0.40)' % isc(CATS[3]), '%s<>"Upper Layer"' % LAY, CON + ', para 13 and 14', 'pct'),
 ('E03', 'Exposure and concentration', 'Largest single counterparty exposure to eligible capital base (Upper Layer)', 'Largest exposure to a single counterparty / Tier 1 capital', '{single}', '{t1}', 'Maximum', 0.20, '%s="Upper Layer"' % LAY, CON + ', para 33 and 34 (Board may allow up to 25 per cent)', 'pct'),
 ('E04', 'Exposure and concentration', 'Largest loan per borrower for an initial public offer (₹ crore)', 'Largest IPO financing to one borrower, in ₹ crore', NIPO, None, 'Maximum', 1, 'TRUE', CON + ', para 11', 'num'),
 ('E05', 'Exposure and concentration', 'Twenty largest borrowers to gross loans', 'Exposure to the twenty largest borrowers / gross loans', '{top20}', '{loans}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('E06', 'Exposure and concentration', 'Unsecured loans to gross loans', 'Unsecured loans / gross loans', '{unsec}', '{loans}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('E07', 'Exposure and concentration', 'Capital market exposure to net worth', 'Capital market exposure / net worth', '{cme}', '{nw}', 'Information', None, 'TRUE', CON + ' – Board-approved internal limit for sensitive sectors', 'pct'),
 ('E08', 'Exposure and concentration', 'Commercial real estate exposure to gross loans', 'Commercial real estate exposure / gross loans', '{cre}', '{loans}', 'Information', None, 'TRUE', CON + ' – Board-approved internal limit for sensitive sectors', 'pct'),
 ('E09', 'Exposure and concentration', 'Group exposure to owned fund', 'Loans to and investments in subsidiaries and group companies / owned fund', '{grpx}', '{of}', 'Information', None, 'TRUE', 'Excess over 10 per cent of owned fund is deducted in computing net owned fund (section 45-IA of the RBI Act, 1934)', 'pct'),
 ('E10', 'Exposure and concentration', 'Land and buildings not for own use to owned fund', 'Land and buildings not for own use / owned fund', '{land}', '{of}', 'Maximum', 0.10, '%s="Yes"' % DEPF, DEP + ', para 63(1)', 'pct'),
 ('E11', 'Exposure and concentration', 'Default loss guarantee cover to amount disbursed out of the covered portfolio', 'DLG cover outstanding / total amount disbursed out of that loan portfolio', '{dlg}', '{dlgp}', 'Maximum', 0.05, 'TRUE', 'Credit Facilities Directions (MD 347), para 24(1)', 'pct'),
 ('V01', 'Dividend', 'Dividend payout ratio', 'Dividend proposed / (profit after tax less exceptional profit)', '{divd}', '{pat}-{excp}', 'Maximum', '=IF(OR(%s,%s),0.60,0.50)' % (isc(CATS[6]), 'FALSE'), 'TRUE', DIV + ', para 9, Table 2 (no ceiling for the categories named in the Table and its Note)', 'pct'),
 ('V02', 'Dividend', 'Highest net NPA ratio in the last three years', 'Highest of the net NPA ratio now and at the two previous year ends', 'MAX({nn1},{nn2},IF(({loans}-{npaprov})=0,0,({gnpa}-{npaprov})/({loans}-{npaprov})))', None, 'Maximum', 0.06, 'TRUE', DIV + ', para 8 (below 6 per cent in each of the last three years)', 'pct'),
 ('F01', 'Earnings and efficiency', 'Net interest margin (annualised)', '(Interest income less interest expense) x 12 / months / average total assets', '({ii}-{ie})*%s' % ANN, AVA, 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('F02', 'Earnings and efficiency', 'Return on assets (annualised)', 'Profit after tax x 12 / months / average total assets', '({pat})*%s' % ANN, AVA, 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('F03', 'Earnings and efficiency', 'Return on equity (annualised)', 'Profit after tax x 12 / months / net worth', '({pat})*%s' % ANN, '{nw}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('F04', 'Earnings and efficiency', 'Cost to income', 'Operating expenses / (total income less interest expense)', '{opex}', '{inc}-{ie}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('F05', 'Earnings and efficiency', 'Yield on loans (annualised)', 'Interest income x 12 / months / average gross loans', '({ii})*%s' % ANN, AVL, 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('F06', 'Earnings and efficiency', 'Cost of borrowings (annualised)', 'Interest expense x 12 / months / average borrowings', '({ie})*%s' % ANN, AVB, 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('F07', 'Earnings and efficiency', 'Operating expenses to average assets (annualised)', 'Operating expenses x 12 / months / average total assets', '({opex})*%s' % ANN, AVA, 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct'),
 ('F08', 'Earnings and efficiency', 'Fee income to total income', 'Fee and other operating income / total income', '{fee}', '{inc}', 'Information', None, 'TRUE', 'Financial ratio; internal limit', 'pct')]

rt = B.sheet('Ratios', (7, 26, 46, 44, 13, 13, 13, 13, 12, 12, 11, 12, 13, 13, 14, 62, 6), tab='00B050')
rt.title('Ratios – result, limit, internal trigger and reference', 'Limit type, limit and trigger are inputs so that the company can set its own internal limits. "Override" forces a ratio on (Yes) or off (No).')
rt.head(6, ['Id', 'Family', 'Ratio', 'How it is computed', 'Current period', 'Previous period', 'Same period last year', 'Limit type', 'Limit', 'Internal trigger', 'Override applies', 'Applies', 'Result', 'Headroom', 'Trend', 'Reference', 'n'])
R0 = 7; RR = {}; rules = []
for j, (rid, fam, nm, how, num, den, typ, lim, appl, ref, fmt) in enumerate(RT):
    r = R0 + j; RR[rid] = r
    rt.lbl('A%d' % r, rid); rt.lbl('B%d' % r, fam); rt.lbl('C%d' % r, nm); rt.lbl('D%d' % r, how)
    for c in 'EFG':
        rt.f('%s%d' % (c, r), ('IF((%s)=0,"",(%s)/(%s))' % (X(den, c), X(num, c), X(den, c))) if den else X(num, c), fmt, out=(c == 'E'))
    rt.inp('H%d' % r, 'rule.type.%s' % rid, nm + ' – limit type', typ, 'txt', 'Direction cited in the Reference column; internal limit policy', ['Minimum', 'Maximum', 'Information'])
    if isinstance(lim, str):
        rt.f('I%d' % r, lim[1:], fmt)
    else:
        rt.inp('I%d' % r, 'rule.limit.%s' % rid, nm + ' – limit', lim, fmt, 'Direction cited in the Reference column')
    trig = None
    if isinstance(lim, (int, float)) and typ != 'Information':
        trig = round(lim * (1.1 if (typ == 'Minimum') == (lim >= 0) else 0.9), 6)
    rt.inp('J%d' % r, 'rule.trigger.%s' % rid, nm + ' – internal trigger', trig, fmt, 'Risk appetite statement; Board-approved internal limits')
    rt.inp('K%d' % r, 'rule.override.%s' % rid, nm + ' – override', None, 'txt', 'Company decision with reason recorded', YN)
    rt.f('L%d' % r, 'IF(K{0}="Yes","Yes",IF(K{0}="No","No",IF({1},"Yes","No")))'.format(r, appl), 'txt')
    rt.f('M%d' % r, ('IF(L{0}="No","Not applicable",IF(OR(E{0}="",H{0}="Information",I{0}=""),IF(AND(H{0}<>"Information",I{0}<>"",E{0}=""),"No data","Information"),'
                     'IF(H{0}="Minimum",IF(E{0}<I{0},"RED",IF(AND(J{0}<>"",E{0}<J{0}),"AMBER","GREEN")),IF(E{0}>I{0},"RED",IF(AND(J{0}<>"",E{0}>J{0}),"AMBER","GREEN")))))').format(r), 'txt')
    rt.f('N%d' % r, 'IF(OR(L{0}="No",E{0}="",I{0}="",H{0}="Information"),"",IF(H{0}="Minimum",E{0}-I{0},I{0}-E{0}))'.format(r), fmt)
    rt.f('O%d' % r, 'IF(OR(E{0}="",F{0}=""),"",IF(ABS(E{0}-F{0})<=0.01*MAX(ABS(F{0}),0.0001),"Stable",IF(H{0}="Information",IF(E{0}>F{0},"Higher","Lower"),IF((E{0}>F{0})=(H{0}="Minimum"),"Improving","Worsening"))))'.format(r), 'txt')
    rt.lbl('P%d' % r, ref)
    rt.f('Q%d' % r, 'IF(OR(M{0}="RED",M{0}="AMBER"),COUNTIF(M${1}:M{0},"RED")+COUNTIF(M${1}:M{0},"AMBER"),"")'.format(r, R0), 'int')
    rules.append(dict(id=rid, family=fam, ratio=nm, computation=how, numerator=num, denominator=den, limit_type=typ, limit=lim, applies_when=appl.replace("'Setup'!", 'Setup.'), reference=ref))
RE = R0 + len(RT) - 1
rt.rag('M%d:M%d' % (R0, RE))
# trigger for formula-limit rows: default relative to the limit
for rid, mult in (('C02', 1.1), ('A04', 1.0), ('E01', 0.9), ('E02', 0.9), ('V01', 0.9)):
    r = RR[rid]; rt.ws['J%d' % r].value = None
RG = lambda c: "'Ratios'!$%s$%d:$%s$%d" % (c, R0, c, RE)
RC = lambda rid, c='E': "'Ratios'!$%s$%d" % (c, RR[rid])

# ------------------------------------------------------------------ Dashboard
db = B.sheet('Dashboard', (10, 50, 16, 16, 14, 14, 60), tab='00B050')
db.title('Dashboard – summary of ratios', 'Red = regulatory limit breached. Amber = inside the limit but beyond the internal trigger.')
db.f('A3', '"Company: "&%s&"   |   As at: "&TEXT(%s,"DD-MMM-YYYY")&"   |   "&%s&"   |   "&%s' % (ST('B4'), ST('B5'), LAY, CAT), 'txt')
db.head(5, ['', 'Family', 'Applicable', 'Green', 'Amber', 'Red', 'No data'])
fams = []
for x in RT:
    if x[1] not in fams: fams.append(x[1])
for j, fm in enumerate(fams):
    r = 6 + j; db.lbl('B%d' % r, fm)
    db.f('C%d' % r, 'COUNTIFS(%s,B%d,%s,"Yes")' % (RG('B'), r, RG('L')), 'int')
    for c, st_ in zip('DEFG', ('GREEN', 'AMBER', 'RED', 'No data')):
        db.f('%s%d' % (c, r), 'COUNTIFS(%s,$B%d,%s,"%s")' % (RG('B'), r, RG('M'), st_), 'int')
tr = 6 + len(fams); db.lbl('B%d' % tr, 'Total', True)
for c in 'CDEFG':
    db.f('%s%d' % (c, tr), 'SUM(%s6:%s%d)' % (c, c, tr - 1), 'int', out=True)
db.lbl('B%d' % (tr + 1), 'Overall position', True)
db.f('C%d' % (tr + 1), 'IF(C{0}=0,"",IF(F{0}>0,"RED",IF(E{0}>0,"AMBER","GREEN")))'.format(tr), 'txt'); db.rag('C%d' % (tr + 1))
p0 = tr + 4
db.sec('A%d' % (p0 - 1), 'Prompt Corrective Action position (where the framework applies)', 7)
db.head(p0, ['', 'Indicator', 'Value', 'Risk threshold reached', '', '', 'Thresholds (RBI (NBFCs – Miscellaneous) Supervisory Directions, 2026, paras 16 and 17)'])
CIC = isc(CATS[6]); CMIN, TMIN, AMIN = RC('C01', 'I'), RC('C02', 'I'), RC('C08', 'I')
pca = [('=IF(%s,"Adjusted net worth to risk-weighted assets","Capital to risk-weighted assets ratio")' % CIC, 'IF(%s,%s,%s)' % (CIC, RC('C08'), RC('C01')),
        'IF({v}="","",IF(%s,IF({v}<%s-0.12,3,IF({v}<%s-0.06,2,IF({v}<%s,1,0))),IF({v}<%s-0.06,3,IF({v}<%s-0.03,2,IF({v}<%s,1,0)))))' % (CIC, AMIN, AMIN, AMIN, CMIN, CMIN, CMIN),
        '=IF(%s,"Threshold 1: up to 6 points below the minimum ANW / RWA; 2: up to 12 points below; 3: more than 12 points below","Threshold 1: up to 3 points below the minimum CRAR; 2: up to 6 points below; 3: more than 6 points below")' % CIC),
       ('=IF(%s,"Leverage ratio (outside liabilities / adjusted net worth)","Tier 1 capital ratio")' % CIC, 'IF(%s,%s,%s)' % (CIC, RC('C07'), RC('C02')),
        'IF({v}="","",IF(%s,IF({v}>=3.5,3,IF({v}>=3,2,IF({v}>=2.5,1,0))),IF({v}<%s-0.04,3,IF({v}<%s-0.02,2,IF({v}<%s,1,0)))))' % (CIC, TMIN, TMIN, TMIN),
        '=IF(%s,"Threshold 1: 2.5 times or more but below 3; 2: 3 times or more but below 3.5; 3: 3.5 times or more","Threshold 1: up to 2 points below the minimum Tier 1 ratio; 2: up to 4 points below; 3: more than 4 points below")' % CIC),
       ('Net NPA ratio (including non-performing investments)', RC('A02'), 'IF({v}="","",IF({v}>0.12,3,IF({v}>0.09,2,IF({v}>0.06,1,0))))', 'Threshold 1: above 6 up to 9 per cent; 2: above 9 up to 12 per cent; 3: above 12 per cent')]
for j, (lab, v, fm, th) in enumerate(pca):
    r = p0 + 1 + j
    if lab.startswith('='): db.f('B%d' % r, lab[1:], 'txt')
    else: db.lbl('B%d' % r, lab)
    db.f('C%d' % r, v, 'n4' if j == 1 else 'pct'); db.f('D%d' % r, 'IF(%s<>"Yes","Not applicable",%s)' % (PCAF, fm.replace('{v}', 'C%d' % r)), 'int')
    if th.startswith('='): db.f('G%d' % r, th[1:], 'txt')
    else: db.lbl('G%d' % r, th)
db.lbl('B%d' % (p0 + 4), 'Highest risk threshold reached', True)
db.f('D%d' % (p0 + 4), 'IF(%s<>"Yes","Not applicable",IF(COUNT(D%d:D%d)=0,"",MAX(D%d:D%d)))' % (PCAF, p0 + 1, p0 + 3, p0 + 1, p0 + 3), 'int', out=True)
db.f('E%d' % (p0 + 4), 'IF(ISNUMBER(D{0}),IF(D{0}>=2,"RED",IF(D{0}=1,"AMBER","GREEN")),"")'.format(p0 + 4), 'txt'); db.rag('E%d' % (p0 + 4))
b0 = p0 + 8
db.sec('A%d' % (b0 - 1), 'Breaches (Red) and near-breaches (Amber)', 7)
db.head(b0, ['#', 'Ratio', 'Current', 'Limit', 'Trigger', 'Result', 'Reference'])
for k in range(1, 21):
    r = b0 + k; db.lbl('A%d' % r, k)
    m = 'MATCH(%d,%s,0)' % (k, RG('Q'))
    for c, src in zip('BCDEFG', 'CEIJMP'):
        db.f('%s%d' % (c, r), 'IF(ISNA(%s),"",INDEX(%s,%s))' % (m, RG(src), m), 'txt' if c in 'BFG' else '0.00##')
db.rag('F%d:F%d' % (b0 + 1, b0 + 20))
db.lbl('B%d' % (b0 + 22), 'Open items on the Checks sheet', True); db.f('C%d' % (b0 + 22), 'COUNTIF(%s,"CHECK")' % q('Checks', 'C6:C16'), 'int'); db.f('D%d' % (b0 + 22), 'IF(C%d=0,"OK","CHECK")' % (b0 + 22), 'txt'); db.rag('D%d' % (b0 + 22))

# ------------------------------------------------------------------ Rules (for software)
ru = B.sheet('Rules', (7, 26, 44, 46, 40, 34, 13, 12, 46, 60), tab='7030A0', protect=False)
ru.title('Rules – the ratio rules in one table', 'For use in a compliance tool or loan management system. Item codes in braces are the codes in the last column of the Source Map (data.<code>.<period>).')
ru.head(5, ['Id', 'Family', 'Ratio', 'Computation in words', 'Numerator', 'Denominator', 'Limit type', 'Limit', 'Applies when', 'Reference'])
for j, x in enumerate(rules):
    r = 6 + j
    lim = x['limit']; lim = ('by formula: ' + lim[1:].replace("'Setup'!", 'Setup.')) if isinstance(lim, str) else lim
    for c, v in zip('ABCDEFGHIJ', (x['id'], x['family'], x['ratio'], x['computation'], x['numerator'].replace("'Setup'!", 'Setup.'), x['denominator'] or '(amount)', x['limit_type'], lim, x['applies_when'], x['reference'])):
        ru.lbl('%s%d' % (c, r), v)

# ------------------------------------------------------------------ Method notes
m = B.sheet('Method Notes', (18,) * 8, tab=NAVY, protect=False)
m.title('Method Notes – how this model produces its results')
m.text_block(4, [
 '# 1. Overall logic',
 'Every ratio on the Ratios sheet is a numerator divided by a denominator, both built from the items on the Data Input sheet. Column D of the Ratios sheet states the computation in words. The same computation is repeated for the previous period and the same period last year so that the trend can be read.',
 '# 2. Which ratios apply',
 'The "Applies" column is Yes or No according to the company profile on Setup: regulatory layer, category, whether it accepts public deposits, whether it is primarily a gold-loan company, and whether the Liquidity Coverage Ratio and the Prompt Corrective Action framework apply. The "Override applies" column forces a ratio on or off; use it where the company has a regulatory dispensation or a special category, and record the reason.',
 '# 3. Result (Red, Amber, Green)',
 'For a "Minimum" ratio: RED if the value is below the limit, AMBER if it is above the limit but below the internal trigger, otherwise GREEN. For a "Maximum" ratio: RED if above the limit, AMBER if below the limit but above the internal trigger, otherwise GREEN. "Information" ratios have no regulatory limit; the company may change the type to Minimum or Maximum and enter its own internal limit. "No data" means a limit applies but the figures are missing.',
 '# 4. Headroom and trend',
 'Headroom is the distance to the limit (value less limit for a minimum; limit less value for a maximum). Trend compares the current period with the previous period: "Improving" means the ratio moved away from the limit, "Worsening" towards it; a change within one per cent is "Stable".',
 '# 5. Annualisation and averages',
 'Profit and loss items are multiplied by 12 / months covered (Setup) before they are divided by a balance sheet figure. Where an average balance is entered on Data Input it is used; otherwise the closing balance is used.',
 '# 6. Limits and references',
 'Each regulatory limit carries the direction and paragraph it comes from in the Reference column. Every regulatory limit was matched to its paragraph in the Source text on 25-11-2026. Limits change when RBI amends a direction: update the yellow limit cell and note the amendment.',
 '# 7. Prompt Corrective Action',
 'Where the framework applies (RBI (NBFCs – Miscellaneous) Supervisory Directions, 2026, para 3), the Dashboard places three indicators against the three risk thresholds of paras 16 and 17 and shows the highest threshold reached. For an NBFC other than a Core Investment Company they are the capital ratio (thresholds 3 and 6 percentage points below the regulatory minimum), the Tier 1 ratio (2 and 4 points below) and the net NPA ratio (above 6, 9 and 12 per cent). The minimums are taken from the limit column of the Ratios sheet, so an NBFC lending mainly against gold, whose minimum Tier 1 ratio is 12 per cent, is measured from 12 per cent. For a Core Investment Company the indicators are adjusted net worth to risk-weighted assets (6 and 12 points below the minimum of 30 per cent), the leverage ratio (2.5, 3 and 3.5 times) and the net NPA ratio.',
 '# 8. Units',
 'Enter all amounts in the units selected on Setup. Limits that are amounts (net owned fund of ₹10 crore; ₹1 crore per borrower for initial public offer financing) are converted to ₹ crore using the units selected.',
 '# 9. Limits of the model',
 'The model tests the ratios it lists. Limits that depend on a loan-by-loan test (loan to value on each gold or share-backed loan, household income for each microfinance borrower) are tested in the lending system, not here.'])

# ------------------------------------------------------------------ Checks
ck = B.sheet('Checks', (6, 78, 12, 56), tab='FF0000')
ck.title('Checks – clear every "CHECK" before using the results')
ck.head(5, ['#', 'Check', 'Result', 'What to do if it fails'])
DI = lambda k, c='E': "N('Data Input'!$%s$%d)" % (c, IR[k])
chk = [('Company name and reporting date are entered', 'AND(%s<>"",%s<>"")' % (ST('$B$4'), ST('$B$5')), 'Complete Setup'), ('Total assets are entered', '%s>0' % DI('ta'), 'Complete Data Input'),
       ('Gross loans do not exceed total assets plus provisions', '%s<=%s+%s+%s+0.5' % (DI('loans'), DI('ta'), DI('npaprov'), DI('stdprov')), 'Check units and amounts'),
       ('Secured plus unsecured loans equal gross loans (within 1 per cent)', 'OR(%s+%s=0,ABS(%s+%s-%s)<=0.01*MAX(1,%s))' % (DI('sec'), DI('unsec'), DI('sec'), DI('unsec'), DI('loans'), DI('loans')), 'Reconcile the loan break-up'),
       ('Standard assets plus gross NPA equal gross loans (within 1 per cent)', 'OR(%s=0,ABS(%s+%s-%s)<=0.01*MAX(1,%s))' % (DI('std'), DI('std'), DI('gnpa'), DI('loans'), DI('loans')), 'Reconcile asset classification with the loan book'),
       ('Financial assets do not exceed total assets', '%s<=%s+0.5' % (DI('fa'), DI('ta')), 'Check the financial assets figure'), ('Income from financial assets does not exceed total income', '%s<=%s+0.005' % (DI('finc'), DI('inc')), 'Check the income figures'),
       ('Net owned fund does not exceed owned fund', '%s<=%s+0.005' % (DI('nof'), DI('of')), 'Check the capital figures'),
       ('Capital figures are entered where capital ratios apply', 'OR(%s="No",AND(%s>0,%s>0))' % (RC('C01', 'L'), DI('t1'), DI('rwa')), 'Enter Tier 1 capital and risk-weighted assets'),
       ('Months covered by the profit and loss figures are between 1 and 12', 'AND(%s>=1,%s<=12)' % (ST('$B$14'), ST('$B$14')), 'Correct Setup'),
       ('No applicable ratio shows "No data"', 'COUNTIF(%s,"No data")=0' % RG('M'), 'Enter the missing figures or mark the ratio as not applicable with the reason')]
for j, (lab, fm, fix) in enumerate(chk):
    r = 6 + j; ck.lbl('A%d' % r, j + 1); ck.lbl('B%d' % r, lab); ck.f('C%d' % r, 'IF(%s,"OK","CHECK")' % fm, 'txt'); ck.lbl('D%d' % r, fix)
ck.rag('C6:C16')

source_map(B)
B.wb._sheets = [B.wb[n] for n in ['ReadMe', 'Method Notes', 'Setup', 'Data Input', 'Ratios', 'Dashboard', 'Rules', 'Checks', 'Source Map']]
B.wb.calculation.fullCalcOnLoad = True
B.save(sys.argv[1], sys.argv[2])
if len(sys.argv) > 3:
    json.dump(rules, open(sys.argv[3], 'w'), indent=1, ensure_ascii=False)
print('Ratio model built:', len(B.wb.sheetnames), 'sheets,', len(B.inputs), 'inputs,', len(RT), 'ratios')
