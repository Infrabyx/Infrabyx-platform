// `apr`: the all-inclusive Annual Percentage Rate (RBI/DOR/2025-26/362, NBFC Responsible Business
// Conduct Directions, para 29(3); R1-regcalc plan §2; owner answer 2, R1-D-301). The rate that
// equates the net amount the borrower receives (the loan less every one-time charge recovered at or
// before disbursement) with what the borrower pays (instalments and every charge, by when it falls
// due). Two methods, each named on the result:
//   - `equal_periods` (the KFS figure, as the Annex illustration): the periodic IRR × periods a
//     year; the illustration's 17.07 per cent is this method;
//   - `actual_dates`: a day-count IRR (Act/365, annual compounding, as XIRR), for information; on
//     the illustration it gives about 18.75 per cent (the model's Method Notes).
// The solver is bisection on a bracketed root with a bounded number of steps: it never loops, and
// it refuses `no_solution` rather than return NaN.
import { basis, type Basis } from "./basis.js";
import { D, count, decIn, type Dec, type DecimalInput } from "./decimal.js";
import { RegcalcError } from "./errors.js";

const CITATION = "RBI/DOR/2025-26/362 para 29(3)(i)";
const STEPS = 400;
const EPS = new D("1e-36");
const ZERO_TOLERANCE = new D("1e-30");

/** A borrower outflow in period `period` (1 = the first instalment period). */
export interface PeriodFlow {
  period: number;
  amount: DecimalInput;
}

/** A borrower outflow on a date (`YYYY-MM-DD`). */
export interface DatedFlow {
  on: string;
  amount: DecimalInput;
}

/** Bisection for the root of a strictly decreasing `f` on (lo, hi]; bounded steps. */
function solve(f: (r: Dec) => Dec, lo: Dec, hi: Dec): Dec {
  let a = lo;
  let b = hi;
  // Widen the upper bound until it brackets the root (a rate above 1e6 per period is refused).
  for (let i = 0; f(b).gt(0); i++) {
    if (i > 60) throw new RegcalcError("no_solution", "no rate repays the net amount");
    b = b.times(2);
  }
  // Flows that repay the net amount exactly (a zero-rate loan without charges) solve at zero; the
  // tolerance absorbs the last digit of a division such as 20000 ÷ 24 × 24.
  const atZero = f(a);
  if (atZero.abs().lte(ZERO_TOLERANCE)) return a;
  if (atZero.lt(0))
    throw new RegcalcError("no_solution", "the flows repay less than the net amount");
  for (let i = 0; i < STEPS && b.minus(a).gt(EPS); i++) {
    const m = a.plus(b).div(2);
    if (f(m).gt(0)) a = m;
    else b = m;
  }
  return a.plus(b).div(2);
}

const checkedNet = (net: DecimalInput): Dec => decIn(net, "netAmount", "0.01");

function checkedFlows<T extends { amount: DecimalInput }>(flows: readonly T[]): Dec[] {
  if (!flows.length) throw new RegcalcError("no_solution", "no borrower outflows", "flows");
  const out = flows.map((f, i) => decIn(f.amount, `flows[${i}].amount`, "0"));
  if (out.every((a) => a.isZero()))
    throw new RegcalcError("no_solution", "every outflow is zero", "flows");
  return out;
}

/**
 * The periodic rate `r` solving `net = Σ amount_k / (1 + r)^period_k` (Excel's `RATE` for equal
 * flows; any period flows otherwise, e.g. a charge after the last instalment). Zero when the flows
 * just repay the net amount.
 */
export function periodicIrr(netAmount: DecimalInput, flows: readonly PeriodFlow[]): Dec {
  const net = checkedNet(netAmount);
  const amounts = checkedFlows(flows);
  const periods = flows.map((f, i) => count(f.period, `flows[${i}].period`, 100_000));
  const f = (r: Dec) =>
    amounts.reduce((acc, a, i) => acc.plus(a.div(r.plus(1).pow(periods[i]!))), new D(0)).minus(net);
  return solve(f, new D(0), new D("0.01"));
}

export interface AprResult {
  method: "equal_periods" | "actual_dates";
  /** The APR as a fraction (`0.1707…`), unrounded. */
  apr: Dec;
  /** The APR in per cent to two decimals, half-up (the KFS figure, owner answer 2): `"17.07"`. */
  aprPercent: string;
  /** Equal periods only: the periodic rate and the periods a year it is multiplied by. */
  periodicRate?: Dec;
  periodsPerYear?: number;
  basis: Basis;
}

/** The APR in per cent to two decimals, half-up. */
export const aprPercent = (apr: Dec): string => apr.times(100).toFixed(2, D.ROUND_HALF_UP);

/** The APR by equal periods: the periodic IRR × periods a year (the KFS figure). */
export function aprEqualPeriods(
  netAmount: DecimalInput,
  flows: readonly PeriodFlow[],
  periodsPerYear: number,
): AprResult {
  const ppy = count(periodsPerYear, "periodsPerYear", 366);
  const periodicRate = periodicIrr(netAmount, flows);
  const apr = periodicRate.times(ppy);
  return {
    method: "equal_periods",
    apr,
    aprPercent: aprPercent(apr),
    periodicRate,
    periodsPerYear: ppy,
    basis: basis(CITATION, "KFS-M01", "APR!B13"),
  };
}

const dayNumber = (iso: string, field: string): number => {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : NaN;
  if (!Number.isFinite(t)) throw RegcalcError.input(field, "not a date (YYYY-MM-DD)");
  return t / 86_400_000;
};

/**
 * The APR by actual dates: the annual rate `R` solving `net = Σ amount / (1 + R)^(days / 365)`,
 * days counted from disbursement (Act/365, as XIRR). For information beside the KFS figure.
 */
export function aprActualDates(
  netAmount: DecimalInput,
  disbursedOn: string,
  flows: readonly DatedFlow[],
): AprResult {
  const net = checkedNet(netAmount);
  const amounts = checkedFlows(flows);
  const start = dayNumber(disbursedOn, "disbursedOn");
  const years = flows.map((f, i) => {
    const d = dayNumber(f.on, `flows[${i}].on`) - start;
    if (d <= 0) throw RegcalcError.range(`flows[${i}].on`, "must fall after disbursement");
    return new D(d).div(365);
  });
  const f = (r: Dec) =>
    amounts.reduce((acc, a, i) => acc.plus(a.div(r.plus(1).pow(years[i]!))), new D(0)).minus(net);
  const apr = solve(f, new D(0), new D("0.5"));
  return {
    method: "actual_dates",
    apr,
    aprPercent: aprPercent(apr),
    basis: basis("RBI/DOR/2025-26/362 para 29(3); day-count IRR for information", "KFS-M01"),
  };
}

/** The effective annual rate of a periodic rate (the model's APR!B14; not the APR disclosed). */
export const effectiveAnnualRate = (periodicRate: Dec, periodsPerYear: number): Dec =>
  periodicRate.plus(1).pow(periodsPerYear).minus(1);
