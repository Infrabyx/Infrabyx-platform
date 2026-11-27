// `dlg`, `ltv` and `microfinance`: the lending limits tested loan by loan (oracle LEND-M01: Guarantee,
// Gold, Share and Microfinance monitors, the Dashboard and the Checks). Each takes the checked
// limits pack (`lendingLimits`, default `DEFAULT_LENDING_LIMITS`) and returns figures and statuses
// with their basis.
import { basis, type Basis } from "./basis.js";
import { D, decIn, sum, type Dec, type DecimalInput } from "./decimal.js";
import { RegcalcError } from "./errors.js";
import { DEFAULT_LENDING_LIMITS, lendingLimits, overall, rag, type Rag } from "./limits.js";

// ---- default loss guarantee (paras 23, 24 and 27) -----------------------------------------------

export interface DlgPortfolio {
  portfolio: string;
  /** The amount disbursed out of the portfolio. */
  disbursed: DecimalInput;
  cashDeposited?: DecimalInput;
  fixedDepositWithLien?: DecimalInput;
  bankGuarantee?: DecimalInput;
  /** The oldest days overdue on a loan whose guarantee is not yet invoked. */
  oldestOverdueDays?: number;
}

export interface DlgResult {
  portfolio: string;
  totalCover: Dec;
  disbursed: Dec;
  /** Cover ÷ disbursed (null when nothing is disbursed). */
  coverShare: Dec | null;
  maxCover: Dec;
  capStatus: Rag | null;
  excess: Dec | null;
  invocationStatus: Rag;
  basis: Basis;
}

const opt = (x: DecimalInput | undefined, field: string) =>
  x === undefined || x === "" ? new D(0) : decIn(x, field, "0");

/** The cover against the cap and the invocation due by days overdue. */
export function dlgMonitor(p: DlgPortfolio, pack: unknown = DEFAULT_LENDING_LIMITS): DlgResult {
  const l = lendingLimits(pack);
  const cap = new D(l.pack.dlg.cap);
  const disbursed = decIn(p.disbursed, "disbursed", "0");
  const totalCover = opt(p.cashDeposited, "cashDeposited")
    .plus(opt(p.fixedDepositWithLien, "fixedDepositWithLien"))
    .plus(opt(p.bankGuarantee, "bankGuarantee"));
  const coverShare = disbursed.isZero() ? null : totalCover.div(disbursed);
  const maxCover = cap.times(disbursed);
  const days = p.oldestOverdueDays ?? 0;
  if (!Number.isSafeInteger(days) || days < 0)
    throw RegcalcError.range("oldestOverdueDays", "a whole number of days");
  return {
    portfolio: p.portfolio,
    totalCover,
    disbursed,
    coverShare,
    maxCover,
    capStatus: coverShare === null ? null : rag(coverShare, cap, l.trigger),
    excess: coverShare === null ? null : D.max(0, totalCover.minus(maxCover)),
    invocationStatus: rag(new D(days), new D(l.pack.dlg.invokeWithinDays), l.trigger),
    basis: basis(l.pack.citations.dlgCap ?? "", "LEND-M01", "Guarantee Monitor"),
  };
}

// ---- gold and silver (paras 32, 43 and 44) ------------------------------------------------------

export interface GoldLoan {
  loanId: string;
  borrowerId: string;
  purpose: "consumption" | "income_generating";
  bullet: boolean;
  sanctioned: DecimalInput;
  outstanding: DecimalInput;
  /** The total repayable at maturity (bullet loans). */
  repayableAtMaturity?: DecimalInput;
  /** The value of the gold or silver pledged (each metal priced as its own collateral). */
  collateralValue: DecimalInput;
}

export interface GoldLtvResult {
  loanId: string;
  borrowerId: string;
  /** The borrower's total consumption loans (sanctioned); null for an income-generating loan. */
  consumptionTotal: Dec | null;
  /** The slab's LTV, or the Board's internal limit (null: none set). */
  maxLtv: Dec | null;
  amountForRatio: Dec;
  ltv: Dec | null;
  status: Rag | "NO_LIMIT_SET" | null;
  aboveLimit: Dec | null;
  basis: Basis;
}

/** Each loan's LTV against its slab, the slab set by the borrower's total consumption loans. */
export function goldLtv(
  loans: readonly GoldLoan[],
  pack: unknown = DEFAULT_LENDING_LIMITS,
): GoldLtvResult[] {
  const l = lendingLimits(pack);
  const sanctioned = loans.map((x, i) => decIn(x.sanctioned, `loans[${i}].sanctioned`, "0"));
  return loans.map((x, i) => {
    const consumption = x.purpose === "consumption";
    const consumptionTotal = consumption
      ? sum(
          loans
            .map((y, j) => ({ y, s: sanctioned[j]! }))
            .filter((o) => o.y.borrowerId === x.borrowerId && o.y.purpose === "consumption")
            .map((o) => o.s),
        )
      : null;
    const maxLtv =
      consumptionTotal !== null
        ? l.slabs.find((s) => s.upTo === null || consumptionTotal.lte(s.upTo))!.maxLtv
        : l.incomeGeneratingMaxLtv;
    const outstanding = decIn(x.outstanding, `loans[${i}].outstanding`, "0");
    const amountForRatio = x.bullet
      ? D.max(opt(x.repayableAtMaturity, `loans[${i}].repayableAtMaturity`), outstanding)
      : outstanding;
    const value = decIn(x.collateralValue, `loans[${i}].collateralValue`, "0");
    const ltv = value.isZero() ? null : amountForRatio.div(value);
    return {
      loanId: x.loanId,
      borrowerId: x.borrowerId,
      consumptionTotal,
      maxLtv,
      amountForRatio,
      ltv,
      status: ltv === null ? null : maxLtv === null ? "NO_LIMIT_SET" : rag(ltv, maxLtv, l.trigger),
      aboveLimit:
        ltv === null || maxLtv === null
          ? null
          : D.max(0, amountForRatio.minus(maxLtv.times(value))),
      basis: basis(l.pack.citations.gold ?? "", "LEND-M01", "Gold Monitor"),
    };
  });
}

// ---- listed shares (para 106) ---------------------------------------------------------------------

export interface ShareLoan {
  loanId: string;
  borrower?: string;
  outstanding: DecimalInput;
  marketValue: DecimalInput;
  /** The date the shortfall arose (`YYYY-MM-DD`), if the LTV is above the limit. */
  shortfallSince?: string;
}

export interface ShareLtvResult {
  loanId: string;
  borrower: string;
  ltv: Dec | null;
  shortfall: Dec | null;
  workingDaysSinceShortfall: number | null;
  status: Rag | "NOT_APPLICABLE" | null;
  basis: Basis;
}

const dayOf = (iso: string, field: string): number => {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : NaN;
  if (!Number.isFinite(t)) throw RegcalcError.input(field, "not a date (YYYY-MM-DD)");
  return Math.round(t / 86_400_000);
};

/** Excel's `NETWORKDAYS(from, to)`: weekdays from `from` to `to`, both counted; no holidays. */
export function networkDays(from: string, to: string): number {
  const a = dayOf(from, "from");
  const b = dayOf(to, "to");
  const sign = b >= a ? 1 : -1;
  let n = 0;
  for (let d = Math.min(a, b); d <= Math.max(a, b); d++) {
    const wd = (d + 4) % 7; // 1970-01-01 was a Thursday: 0 = Sunday
    if (wd !== 0 && wd !== 6) n++;
  }
  return sign * n;
}

/** Each loan's LTV, the shortfall to be made good and the cure period, at `positionOn`. */
export function shareLtv(
  loans: readonly ShareLoan[],
  positionOn: string,
  pack: unknown = DEFAULT_LENDING_LIMITS,
): ShareLtvResult[] {
  const l = lendingLimits(pack);
  const max = new D(l.pack.shares.maxLtv);
  dayOf(positionOn, "positionOn");
  return loans.map((x, i) => {
    const outstanding = decIn(x.outstanding, `loans[${i}].outstanding`, "0");
    const value = decIn(x.marketValue, `loans[${i}].marketValue`, "0");
    const ltv = value.isZero() ? null : outstanding.div(value);
    const days =
      ltv === null || !x.shortfallSince
        ? null
        : Math.max(0, networkDays(x.shortfallSince, positionOn) - 1);
    let status: ShareLtvResult["status"] = null;
    if (ltv !== null)
      status = !l.pack.shares.apply
        ? "NOT_APPLICABLE"
        : ltv.lte(max)
          ? "GREEN"
          : days === null || days > l.pack.shares.cureWorkingDays
            ? "RED"
            : "AMBER";
    return {
      loanId: x.loanId,
      borrower: x.borrower ?? "",
      ltv,
      shortfall: ltv === null ? null : D.max(0, outstanding.minus(max.times(value))),
      workingDaysSinceShortfall: days,
      status,
      basis: basis(l.pack.citations.shares ?? "", "LEND-M01", "Share Monitor"),
    };
  });
}

// ---- microfinance (paras 51, 55 and 56) -----------------------------------------------------------

export interface Household {
  householdId: string;
  annualIncome: DecimalInput;
  existingMonthlyObligations?: DecimalInput;
  monthlyInstalment?: DecimalInput;
  collateralFree: boolean;
}

export interface MicrofinanceResult {
  householdId: string;
  qualifies: boolean;
  monthlyIncome: Dec;
  monthlyObligations: Dec;
  obligationsShare: Dec | null;
  status: Rag | "NOT_MICROFINANCE" | null;
  /** The highest instalment the household can take (null when not microfinance). */
  maxInstalment: Dec | null;
  basis: Basis;
}

/** Whether a household's loan is microfinance, and its repayment obligations against the limit. */
export function microfinance(
  households: readonly Household[],
  pack: unknown = DEFAULT_LENDING_LIMITS,
): MicrofinanceResult[] {
  const l = lendingLimits(pack);
  const limit = D.min(l.pack.microfinance.obligationsMax, "0.5");
  return households.map((h, i) => {
    const income = decIn(h.annualIncome, `households[${i}].annualIncome`, "0");
    const existing = opt(
      h.existingMonthlyObligations,
      `households[${i}].existingMonthlyObligations`,
    );
    const qualifies = income.lte(l.pack.microfinance.incomeUpTo) && h.collateralFree;
    const monthlyIncome = income.div(12);
    const monthlyObligations = existing.plus(
      opt(h.monthlyInstalment, `households[${i}].monthlyInstalment`),
    );
    const share = monthlyIncome.isZero() ? null : monthlyObligations.div(monthlyIncome);
    return {
      householdId: h.householdId,
      qualifies,
      monthlyIncome,
      monthlyObligations,
      obligationsShare: share,
      status:
        share === null ? null : !qualifies ? "NOT_MICROFINANCE" : rag(share, limit, l.trigger),
      maxInstalment:
        share === null || !qualifies ? null : D.max(0, limit.times(monthlyIncome).minus(existing)),
      basis: basis(
        l.pack.citations.microfinanceObligations ?? "",
        "LEND-M01",
        "Microfinance Monitor",
      ),
    };
  });
}

// ---- dashboard ---------------------------------------------------------------------------------------

export interface LimitsSummaryLine {
  items: number;
  red: number;
  amber: number;
  green: number;
  overall: Rag | null;
}

/** Counts of each status, and the worst (the model's Dashboard rows). */
export function summarise(statuses: readonly (string | null)[]): LimitsSummaryLine {
  const rags = statuses.filter((s): s is Rag => s === "RED" || s === "AMBER" || s === "GREEN");
  const n = (s: Rag) => rags.filter((x) => x === s).length;
  return {
    items: rags.length,
    red: n("RED"),
    amber: n("AMBER"),
    green: n("GREEN"),
    overall: overall(rags),
  };
}
