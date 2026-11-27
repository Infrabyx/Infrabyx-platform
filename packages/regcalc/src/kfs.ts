// The Key Facts Statement figures for one loan (oracle KFS-M01: sheets APR, Key Facts Statement,
// Cooling Off, Penal Charges and Checks). `kfsFigures` reproduces the model, which keeps the
// instalment unrounded; `kfsApr` is the figure a product discloses (owner answer 2, R1-D-301):
// equal periods, two decimals of a percent half-up, on the cash flows the borrower actually pays
// (the rounded instalments by the product's rule, every recurring charge), net of the one-time
// charges. The figure on the unrounded instalment is computed beside it, and the higher of the two
// is the one disclosed: the lower is never shown ([VERIFY: counsel], R1-D-306).
import { aprEqualPeriods, effectiveAnnualRate, type AprResult } from "./apr.js";
import { basis, type Basis } from "./basis.js";
import { D, count, decIn, sum, type Dec, type DecimalInput } from "./decimal.js";
import { RegcalcError } from "./errors.js";
import { DEFAULT_ROUNDING, NO_ROUNDING, type RoundingRule } from "./rounding.js";
import {
  equatedInstalment,
  loanTerms,
  reducingSchedule,
  type LoanTerms,
  type Schedule,
} from "./schedule.js";

const RBC = "RBI/DOR/2025-26/362";
const CREDIT_FACILITIES = "RBI (NBFCs – Credit Facilities) Directions, 2025";

/** A one-time charge recovered at or before disbursement (own or for a third party). */
export interface OneTimeCharge {
  kind:
    "processing_fee" | "other_own" | "gst" | "insurance" | "legal_valuation" | "other_third_party";
  amount: DecimalInput;
}

export interface KfsLoan extends LoanTerms {
  oneTimeCharges: readonly OneTimeCharge[];
  /** A charge collected with each instalment (₹ per instalment), if any. */
  recurringPerInstalment?: DecimalInput;
}

function charges(l: KfsLoan) {
  const by = (k: OneTimeCharge["kind"]) =>
    sum(
      l.oneTimeCharges
        .map((c, i) => ({ c, a: decIn(c.amount, `oneTimeCharges[${i}].amount`, "0") }))
        .filter((x) => x.c.kind === k)
        .map((x) => x.a),
    );
  const all = sum(
    l.oneTimeCharges.map((c, i) => decIn(c.amount, `oneTimeCharges[${i}].amount`, "0")),
  );
  const recurring =
    l.recurringPerInstalment === undefined
      ? new D(0)
      : decIn(l.recurringPerInstalment, "recurringPerInstalment", "0");
  return { by, all, recurring };
}

export interface KfsFigures {
  /** APR!B4 */ periodsPerYear: number;
  /** APR!B5, KFS C10 */ instalment: Dec;
  /** APR!B6 */ totalOfInstalments: Dec;
  /** APR!B7, KFS C20 */ totalInterest: Dec;
  /** APR!B8 */ oneTimeCharges: Dec;
  /** APR!B9 */ recurringCharges: Dec;
  /** APR!B10, KFS C21 */ netAmount: Dec;
  /** APR!B11: instalments + all charges (not the KFS "total amount to be paid") */ totalCost: Dec;
  /** APR!B12 */ periodicRate: Dec;
  /** APR!B13, KFS C19 */ apr: Dec;
  /** APR!B14, for information */ effectiveAnnualRate: Dec;
  /** APR!B15, percentage points as a fraction */ aprOverRate: Dec;
  /** KFS C14: processing fee and other own one-time charges */ processingFee: Dec;
  /** KFS C15 */ gst: Dec;
  /** KFS C16 */ insurance: Dec;
  /** KFS C17 */ thirdPartyOther: Dec;
  /** KFS C22: loan amount + total interest */ totalToBePaid: Dec;
  schedule: Schedule;
  basis: Basis;
}

/** The model's figures for one loan, at the unrounded instalment (as KFS-M01 keeps them). */
export function kfsFigures(l: KfsLoan): KfsFigures {
  const t = loanTerms(l);
  const c = charges(l);
  const net = t.principal.minus(c.all);
  if (net.lte(0)) throw RegcalcError.range("oneTimeCharges", "must be less than the loan amount");
  const emi = equatedInstalment(l);
  const flows = Array.from({ length: t.n }, (_, i) => ({
    period: i + 1,
    amount: emi.plus(c.recurring),
  }));
  const r = aprEqualPeriods(net, flows, t.ppy);
  const totalOfInstalments = emi.times(t.n);
  const totalInterest = totalOfInstalments.minus(t.principal);
  return {
    periodsPerYear: t.ppy,
    instalment: emi,
    totalOfInstalments,
    totalInterest,
    oneTimeCharges: c.all,
    recurringCharges: c.recurring.times(t.n),
    netAmount: net,
    totalCost: totalOfInstalments.plus(c.all).plus(c.recurring.times(t.n)),
    periodicRate: r.periodicRate!,
    apr: r.apr,
    effectiveAnnualRate: effectiveAnnualRate(r.periodicRate!, t.ppy),
    aprOverRate: r.apr.minus(t.annualRate),
    processingFee: c.by("processing_fee").plus(c.by("other_own")),
    gst: c.by("gst"),
    insurance: c.by("insurance"),
    thirdPartyOther: c.by("legal_valuation").plus(c.by("other_third_party")),
    totalToBePaid: t.principal.plus(totalInterest),
    schedule: reducingSchedule(l, NO_ROUNDING),
    basis: basis(`${RBC} paras 6 and 29`, "KFS-M01", "APR"),
  };
}

export interface KfsApr {
  /** The APR on the flows actually paid (the rounded schedule and every charge). */
  paid: AprResult;
  /** The APR on the unrounded instalment (the Annex illustration's method). */
  unrounded: AprResult;
  /** The figure disclosed: the higher of the two, so the lower is never shown. */
  disclosed: AprResult;
  schedule: Schedule;
  basis: Basis;
}

/** The APR a product discloses in the KFS (owner answer 2). `rounding` is the loan system's. */
export function kfsApr(l: KfsLoan, rounding: RoundingRule = DEFAULT_ROUNDING): KfsApr {
  const t = loanTerms(l);
  const c = charges(l);
  const net = t.principal.minus(c.all);
  if (net.lte(0)) throw RegcalcError.range("oneTimeCharges", "must be less than the loan amount");
  const schedule = reducingSchedule(l, rounding);
  const paid = aprEqualPeriods(
    net,
    schedule.rows.map((r) => ({ period: r.no, amount: r.instalment.plus(c.recurring) })),
    t.ppy,
  );
  const emi = equatedInstalment(l);
  const unrounded = aprEqualPeriods(
    net,
    schedule.rows.map((r) => ({ period: r.no, amount: emi.plus(c.recurring) })),
    t.ppy,
  );
  return {
    paid,
    unrounded,
    disclosed: paid.apr.gte(unrounded.apr) ? paid : unrounded,
    schedule,
    basis: basis(`${RBC} para 29(3)(i) and (ii)`, "KFS-M01", "APR!B13"),
  };
}

export interface CoolingOffExit {
  /** Cooling Off!B7: within the period (`yes`), outside it (`no`), or not a digital loan. */
  withinPeriod: "yes" | "no" | "not_digital";
  /** B8: loan amount × APR × days ÷ 365 */ proportionateCost: Dec;
  /** B9: principal + the proportionate cost; no penalty */ payable: Dec;
  /** B10 */ feeRetained: Dec;
  /** B11: other one-time charges collected at disbursement */ otherOneTimeCharges: Dec;
  basis: Basis;
}

/** Exit from a digital loan in the cooling-off period (Credit Facilities Directions para 11). */
export function coolingOffExit(o: {
  principal: DecimalInput;
  apr: DecimalInput;
  dayOfExit: number;
  coolingOffDays: number;
  digital: boolean;
  retainProcessingFee: boolean;
  processingFee: DecimalInput;
  oneTimeCharges: DecimalInput;
}): CoolingOffExit {
  const principal = decIn(o.principal, "principal", "0.01");
  const apr = decIn(o.apr, "apr", "0");
  const days = count(o.dayOfExit, "dayOfExit", 36_500);
  const fee = decIn(o.processingFee, "processingFee", "0");
  const all = decIn(o.oneTimeCharges, "oneTimeCharges", "0");
  const cost = principal.times(apr).times(days).div(365);
  return {
    withinPeriod: !o.digital ? "not_digital" : days <= o.coolingOffDays ? "yes" : "no",
    proportionateCost: cost,
    payable: principal.plus(cost),
    feeRetained: o.retainProcessingFee ? fee : new D(0),
    otherOneTimeCharges: all.minus(fee),
    basis: basis(`${CREDIT_FACILITIES}, para 11`, "KFS-M01", "Cooling Off"),
  };
}

export interface PenalCharge {
  /** Penal Charges!B9: overdue × penal rate × days ÷ 365, booked as a charge */ charge: Dec;
  /** B10 */ gst: Dec;
  /** B11: interest on the overdue amount at the contracted rate */ interest: Dec;
  /** B12; no interest is computed on the penal charge */ total: Dec;
  basis: Basis;
}

/** A penal charge on an overdue amount (RBC Directions para 30). */
export function penalCharge(o: {
  overdue: DecimalInput;
  daysOverdue: number;
  penalRate: DecimalInput;
  gstRate: DecimalInput;
  contractRate: DecimalInput;
}): PenalCharge {
  const overdue = decIn(o.overdue, "overdue", "0");
  const days = count(o.daysOverdue, "daysOverdue", 36_500);
  const charge = overdue
    .times(decIn(o.penalRate, "penalRate", "0", "10"))
    .times(days)
    .div(365);
  const gst = charge.times(decIn(o.gstRate, "gstRate", "0", "1"));
  const interest = overdue
    .times(decIn(o.contractRate, "contractRate", "0", "10"))
    .times(days)
    .div(365);
  return {
    charge,
    gst,
    interest,
    total: charge.plus(gst).plus(interest),
    basis: basis(`${RBC} para 30`, "KFS-M01", "Penal Charges"),
  };
}

export interface KfsCheck {
  check:
    | "terms_entered"
    | "within_120"
    | "charges_below_loan"
    | "schedule_closes"
    | "apr_not_below_rate"
    | "cooling_off_at_least_one_day";
  ok: boolean;
}

/** The model's integrity checks (sheet Checks). */
export function kfsChecks(l: KfsLoan, digital: boolean, coolingOffDays: number): KfsCheck[] {
  const f = kfsFigures(l);
  const t = loanTerms(l);
  const principalRepaid = sum(f.schedule.rows.map((r) => r.principal));
  return [
    { check: "terms_entered", ok: t.principal.gt(0) && t.annualRate.gte(0) && t.n > 0 },
    { check: "within_120", ok: t.n <= 120 },
    { check: "charges_below_loan", ok: f.oneTimeCharges.lt(t.principal) },
    { check: "schedule_closes", ok: principalRepaid.minus(t.principal).abs().lt(1) },
    { check: "apr_not_below_rate", ok: f.apr.gte(t.annualRate.minus("0.000001")) },
    { check: "cooling_off_at_least_one_day", ok: !digital || coolingOffDays >= 1 },
  ];
}
