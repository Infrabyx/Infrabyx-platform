// `schedule`: the equated periodic instalment and the reducing-balance repayment schedule
// (R1-regcalc plan §2; oracle KFS-M01, sheets APR and Schedule). Interest for a period is the
// opening principal × the annual rate ÷ instalments in a year. With a rounding rule, the instalment
// and each period's interest are rounded and the last instalment absorbs the difference, so the
// schedule closes at exactly zero; without one (`NO_ROUNDING`) it is the model's own unrounded
// schedule.
import { z } from "zod";
import { basis, type Basis } from "./basis.js";
import { D, count, decIn, sum, type Dec, type DecimalInput } from "./decimal.js";
import { RegcalcError } from "./errors.js";
import { DEFAULT_ROUNDING, RoundingRule, roundBy, type RoundingRule as Rule } from "./rounding.js";

export const FREQUENCIES = ["monthly", "fortnightly", "weekly", "quarterly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** Instalments in a year for each frequency (the model's APR!B4). */
export const PERIODS_PER_YEAR: Readonly<Record<Frequency, number>> = Object.freeze({
  monthly: 12,
  fortnightly: 26,
  weekly: 52,
  quarterly: 4,
});

/** The most instalments a schedule holds (the model's 120; longer loans are refused). */
export const MAX_INSTALMENTS = 1200;

export interface LoanTerms {
  /** The amount sanctioned and disbursed (₹). */
  principal: DecimalInput;
  /** The rate of interest per annum as a fraction (`"0.18"` for 18 per cent), reducing balance. */
  annualRate: DecimalInput;
  frequency: Frequency;
  /** The number of instalments. */
  instalments: number;
  /** The date of disbursement (`YYYY-MM-DD`), for the due dates; optional. */
  disbursedOn?: string;
}

const ISO_DATE = z.iso.date();

/** The checked terms. */
export function loanTerms(t: LoanTerms) {
  const principal = decIn(t.principal, "principal", "0.01");
  const annualRate = decIn(t.annualRate, "annualRate", "0", "10");
  if (!(FREQUENCIES as readonly string[]).includes(t.frequency))
    throw RegcalcError.input("frequency", `one of ${FREQUENCIES.join(", ")}`);
  const n = count(t.instalments, "instalments", MAX_INSTALMENTS);
  if (t.disbursedOn !== undefined && !ISO_DATE.safeParse(t.disbursedOn).success)
    throw RegcalcError.input("disbursedOn", "not a date (YYYY-MM-DD)");
  const ppy = PERIODS_PER_YEAR[t.frequency];
  return { principal, annualRate, n, ppy, periodRate: annualRate.div(ppy), frequency: t.frequency };
}

/**
 * The equated periodic instalment, unrounded (Excel's `PMT(rate/ppy, n, -principal)`; rate 0:
 * principal ÷ n). The model's APR!B5.
 */
export function equatedInstalment(t: LoanTerms): Dec {
  const { principal, n, periodRate } = loanTerms(t);
  if (periodRate.isZero()) return principal.div(n);
  const growth = periodRate.plus(1).pow(n);
  return principal.times(periodRate).times(growth).div(growth.minus(1));
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Excel's `EDATE(date, months)`: the same day `months` later, clamped to the month's end. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const day = Math.min(d, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `iso` plus `days` days. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The due date of instalment `k` (the model's Schedule!B column). */
export function dueDate(disbursedOn: string, frequency: Frequency, k: number): string {
  if (frequency === "monthly") return addMonths(disbursedOn, k);
  if (frequency === "quarterly") return addMonths(disbursedOn, 3 * k);
  return addDays(disbursedOn, k * (frequency === "weekly" ? 7 : 14));
}

export interface ScheduleRow {
  no: number;
  /** Present when the terms name the disbursement date. */
  dueOn?: string;
  opening: Dec;
  instalment: Dec;
  interest: Dec;
  principal: Dec;
  closing: Dec;
}

export interface Schedule {
  /** The instalment charged (rounded by the rule); the last row's may differ. */
  instalment: Dec;
  /** The unrounded equated instalment. */
  equatedInstalment: Dec;
  rows: ScheduleRow[];
  totals: { instalments: Dec; interest: Dec; principal: Dec };
  rounding: Rule;
  basis: Basis;
}

/**
 * The reducing-balance schedule. `rounding` (default half-up to the rupee) rounds the instalment
 * and each period's interest; the last instalment absorbs the difference so the closing balance is
 * exactly zero. `NO_ROUNDING` gives the model's unrounded schedule.
 */
export function reducingSchedule(t: LoanTerms, rounding: Rule = DEFAULT_ROUNDING): Schedule {
  const rule = RoundingRule.parse(rounding);
  const terms = loanTerms(t);
  const emi = equatedInstalment(t);
  const charged = roundBy(emi, rule);
  if (charged.lte(0)) throw RegcalcError.range("instalments", "the instalment rounds to zero");
  const rows: ScheduleRow[] = [];
  let opening = terms.principal;
  for (let k = 1; k <= terms.n; k++) {
    const interest = roundBy(opening.times(terms.periodRate), rule);
    const last = k === terms.n;
    let principal = charged.minus(interest);
    // The last instalment repays what is left (rounding only; unrounded, it is already exact).
    if (last && rule.to !== "none") principal = opening;
    const instalment = last && rule.to !== "none" ? principal.plus(interest) : charged;
    const closing = opening.minus(principal);
    if (!last && closing.lt(0))
      throw RegcalcError.range("instalments", "the rounded instalment repays the loan early");
    rows.push({
      no: k,
      ...(t.disbursedOn ? { dueOn: dueDate(t.disbursedOn, terms.frequency, k) } : {}),
      opening,
      instalment,
      interest,
      principal,
      closing,
    });
    opening = closing;
  }
  return {
    instalment: charged,
    equatedInstalment: emi,
    rows,
    totals: {
      instalments: sum(rows.map((r) => r.instalment)),
      interest: sum(rows.map((r) => r.interest)),
      principal: sum(rows.map((r) => r.principal)),
    },
    rounding: rule,
    basis: basis("Loan agreement; RBI/DOR/2025-26/362 para 29(3)(ii)", "KFS-M01", "Schedule"),
  };
}

/** The total interest over the term at the unrounded instalment (the model's APR!B7). */
export const totalInterest = (t: LoanTerms): Dec =>
  equatedInstalment(t).times(loanTerms(t).n).minus(loanTerms(t).principal);

/** `x` to the rupee, half-up, as the Annex illustration prints its schedule. */
export const toRupee = (x: Dec): Dec => x.toDecimalPlaces(0, D.ROUND_HALF_UP);
