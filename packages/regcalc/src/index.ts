// @infrabyx/regcalc — pure decimal calculations for the regulated lending figures (LawDocsComply
// LDC-66 and Finbyx PR-FBX-58; ADR-0015; plan docs/phases/R1-regcalc-plan.md). No I/O, no clock
// (dates are inputs), no randomness, no settings read, no logging: the same inputs give the same
// outputs on every runtime. Every amount is a Decimal; every result carries its basis. The owner's
// worked examples in docs/regulatory-models are the oracles (every output cell reproduced).
export { D, dec, decIn, fixed, sum, type Dec, type DecimalInput } from "./decimal.js";
export { REGCALC_REASONS, RegcalcError, isRegcalcError, type RegcalcReason } from "./errors.js";
export { basis, type Basis } from "./basis.js";
export {
  DEFAULT_ROUNDING,
  NO_ROUNDING,
  ROUNDING_MODES,
  RoundingRule,
  roundBy,
  type RoundingMode,
} from "./rounding.js";
export {
  FREQUENCIES,
  MAX_INSTALMENTS,
  PERIODS_PER_YEAR,
  addDays,
  addMonths,
  dueDate,
  equatedInstalment,
  loanTerms,
  reducingSchedule,
  toRupee,
  totalInterest,
  type Frequency,
  type LoanTerms,
  type Schedule,
  type ScheduleRow,
} from "./schedule.js";
export {
  aprActualDates,
  aprEqualPeriods,
  aprPercent,
  effectiveAnnualRate,
  periodicIrr,
  type AprResult,
  type DatedFlow,
  type PeriodFlow,
} from "./apr.js";
export {
  coolingOffExit,
  kfsApr,
  kfsChecks,
  kfsFigures,
  penalCharge,
  type CoolingOffExit,
  type KfsApr,
  type KfsCheck,
  type KfsFigures,
  type KfsLoan,
  type OneTimeCharge,
  type PenalCharge,
} from "./kfs.js";
export {
  CFD,
  DEFAULT_LENDING_LIMITS,
  LENDING_LIMITS_FLOOR,
  LendingLimitsPack,
  RAG,
  lendingLimits,
  overall,
  rag,
  type Rag,
} from "./limits.js";
export {
  dlgMonitor,
  goldLtv,
  microfinance,
  networkDays,
  shareLtv,
  summarise,
  type DlgPortfolio,
  type DlgResult,
  type GoldLoan,
  type GoldLtvResult,
  type Household,
  type LimitsSummaryLine,
  type MicrofinanceResult,
  type ShareLoan,
  type ShareLtvResult,
} from "./lending.js";
