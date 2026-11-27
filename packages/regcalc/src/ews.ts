// `ews`: the early-warning indicator library (R1-regcalc plan §2; oracle EWS-M01). The Fraud Risk
// Management Directions (para 19) prescribe no list, weight or score, so the indicators, weights,
// critical flags and cut-offs are data, marked as management choice; only the deadline for the
// Fraud Monitoring Return (para 43, 14 days) is a regulatory floor, and a pack allowing longer is
// refused. Account flags → weighted score → alert band, with the follow-up of each alert.
import { z } from "zod";
import { basis, type Basis } from "./basis.js";
import { D, decIn, sum, type Dec, type DecimalInput } from "./decimal.js";
import { RegcalcError } from "./errors.js";

export const FRMD = "RBI (NBFCs – Fraud Risk Management) Directions, 2026";
export const EWS_FAMILIES = [
  "Transactional data",
  "Financial performance",
  "Market intelligence",
  "Conduct of the borrower",
] as const;
export type EwsFamily = (typeof EWS_FAMILIES)[number];

export const EXAMINATION_STATUSES = [
  "Not started",
  "Under examination",
  "Closed – no fraud angle",
  "Referred for investigation",
  "Classified as fraud",
] as const;
export type ExaminationStatus = (typeof EXAMINATION_STATUSES)[number];

/** The regulatory floor: the Fraud Monitoring Return within 14 days of classification (para 43). */
export const FMR_DAYS_FLOOR = 14;

const weight = z.string().regex(/^[0-9]+(\.[0-9]+)?$/);

export const EwsPack = z
  .object({
    id: z.string().min(1).max(64),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    effectiveFrom: z.iso.date(),
    indicators: z
      .array(
        z
          .object({
            no: z.number().int().positive(),
            name: z.string().min(1).max(300),
            family: z.enum(EWS_FAMILIES),
            type: z.enum(["Quantitative", "Qualitative"]),
            weight,
            critical: z.boolean(),
            active: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    amberFrom: weight,
    redFrom: weight,
    criticalForcesRed: z.boolean(),
    examinationDays: z.number().int().positive(),
    returnDays: z.number().int().positive(),
    captureTarget: z.string().regex(/^(0|1)(\.[0-9]+)?$/),
  })
  .strict();
export type EwsPack = z.infer<typeof EwsPack>;

/** The checked pack: its schema, unique indicator numbers, red above amber, the return floor. */
export function ewsPack(raw: unknown) {
  const r = EwsPack.safeParse(raw);
  if (!r.success) throw new RegcalcError("rule_pack_invalid", r.error.issues[0]!.message, "pack");
  const p = r.data;
  if (new Set(p.indicators.map((i) => i.no)).size !== p.indicators.length)
    throw new RegcalcError("rule_pack_invalid", "indicator numbers must be unique", "pack");
  if (p.returnDays > FMR_DAYS_FLOOR)
    throw new RegcalcError("rule_pack_invalid", "returnDays is looser than para 43", "pack");
  return p;
}

export interface EwsAccount {
  accountId: string;
  borrower?: string;
  exposure: DecimalInput;
  /** The numbers of the indicators present. */
  present: readonly number[];
  alertOn?: string;
  status?: ExaminationStatus;
  examinationClosedOn?: string;
  classifiedAsFraudOn?: string;
  returnFurnishedOn?: string;
}

export type Band = "GREEN" | "AMBER" | "RED";

export interface EwsScore {
  accountId: string;
  borrower: string;
  exposure: Dec;
  indicatorsPresent: number;
  criticalPresent: number;
  families: number;
  score: Dec;
  alert: Band;
  /** The examination status; "Not started" for an alert with none; null for GREEN without one. */
  status: ExaminationStatus | null;
  daysOpen: number | null;
  examination: Band | "CHECK" | null;
  returnDueOn: string | null;
  returnStatus: Band | "CHECK" | null;
  /** On a confirmed case: whether the model had raised an alert. */
  modelAlertOnConfirmed: "Yes" | "No" | null;
  basis: Basis;
}

const day = (iso: string, field: string): number => {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : NaN;
  if (!Number.isFinite(t)) throw RegcalcError.input(field, "not a date (YYYY-MM-DD)");
  return Math.round(t / 86_400_000);
};
const isoOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** Scores each account and follows up its alert, as at `reportingOn`. */
export function ewsScores(
  accounts: readonly EwsAccount[],
  raw: unknown,
  reportingOn: string,
): EwsScore[] {
  const p = ewsPack(raw);
  const today = day(reportingOn, "reportingOn");
  const byNo = new Map(p.indicators.map((i) => [i.no, i]));
  const amber = new D(p.amberFrom);
  const red = new D(p.redFrom);
  return accounts.map((a, k) => {
    const flags = [...new Set(a.present)].map((no) => {
      const i = byNo.get(no);
      if (!i)
        throw new RegcalcError(
          "input_out_of_range",
          `no indicator ${no}`,
          `accounts[${k}].present`,
        );
      return i;
    });
    const inUse = flags.filter((i) => i.active && new D(i.weight).gt(0));
    const critical = flags.filter((i) => i.critical && i.active).length;
    const score = sum(inUse.map((i) => new D(i.weight)));
    const alert: Band =
      score.gte(red) || (p.criticalForcesRed && critical > 0)
        ? "RED"
        : score.gte(amber)
          ? "AMBER"
          : "GREEN";
    const status = a.status ?? (alert === "GREEN" ? null : "Not started");
    const daysOpen =
      status === null || !a.alertOn
        ? null
        : (a.examinationClosedOn ? day(a.examinationClosedOn, "examinationClosedOn") : today) -
          day(a.alertOn, "alertOn");
    const open = status === "Not started" || status === "Under examination";
    const examination: EwsScore["examination"] =
      status === null
        ? null
        : open
          ? daysOpen === null
            ? "CHECK"
            : daysOpen > p.examinationDays
              ? "RED"
              : "AMBER"
          : daysOpen === null || daysOpen <= p.examinationDays
            ? "GREEN"
            : "AMBER";
    const due = a.classifiedAsFraudOn
      ? day(a.classifiedAsFraudOn, "classifiedAsFraudOn") + p.returnDays
      : null;
    const returnStatus: EwsScore["returnStatus"] =
      due === null
        ? null
        : a.returnFurnishedOn
          ? day(a.returnFurnishedOn, "returnFurnishedOn") <= due
            ? "GREEN"
            : "RED"
          : today > due
            ? "RED"
            : "AMBER";
    const confirmed = status === "Referred for investigation" || status === "Classified as fraud";
    return {
      accountId: a.accountId,
      borrower: a.borrower ?? "",
      exposure: decIn(a.exposure, `accounts[${k}].exposure`, "0"),
      indicatorsPresent: inUse.length,
      criticalPresent: critical,
      families: new Set(inUse.map((i) => i.family)).size,
      score,
      alert,
      status,
      daysOpen,
      examination,
      returnDueOn: due === null ? null : isoOf(due),
      returnStatus,
      modelAlertOnConfirmed: confirmed ? (alert === "GREEN" ? "No" : "Yes") : null,
      basis: {
        ...basis(`${FRMD}, paras 15, 19 and 20`, "EWS-M01", "Scoring"),
        managementChoice: true,
      },
    };
  });
}

/** The accounts ranked as the model ranks them: criticals first, then score, then input order. */
export function ewsRanking(scores: readonly EwsScore[]): number[] {
  return scores
    .map((s, i) => ({ i, key: s.score.plus(s.criticalPresent * 1000) }))
    .sort((a, b) => b.key.comparedTo(a.key) || a.i - b.i)
    .map((x) => x.i);
}

export interface IndicatorReviewLine {
  no: number;
  name: string;
  family: EwsFamily;
  weightInUse: Dec;
  flagged: number;
  examinedAndClosed: number;
  confirmed: number;
  confirmedShare: Dec;
  remark:
    | ""
    | "Switched off"
    | "Never present: review the indicator"
    | "No confirmed case: review the weight";
}

/** How well each indicator works (paras 15 and 16). */
export function indicatorReview(
  accounts: readonly EwsAccount[],
  raw: unknown,
): IndicatorReviewLine[] {
  const p = ewsPack(raw);
  return p.indicators.map((ind) => {
    const flagged = accounts.filter((a) => a.present.includes(ind.no));
    const confirmed = flagged.filter(
      (a) => a.status === "Referred for investigation" || a.status === "Classified as fraud",
    ).length;
    const closed = flagged.filter((a) => a.status === "Closed – no fraud angle").length + confirmed;
    const w = ind.active ? new D(ind.weight) : new D(0);
    return {
      no: ind.no,
      name: ind.name,
      family: ind.family,
      weightInUse: w,
      flagged: flagged.length,
      examinedAndClosed: closed,
      confirmed,
      confirmedShare: closed === 0 ? new D(0) : new D(confirmed).div(closed),
      remark: w.isZero()
        ? "Switched off"
        : accounts.length === 0
          ? ""
          : flagged.length === 0
            ? "Never present: review the indicator"
            : closed >= 5 && confirmed === 0
              ? "No confirmed case: review the weight"
              : "",
    };
  });
}

/** The capture rate of confirmed cases against its target (the model's Dashboard C27). */
export function captureStatus(rate: Dec, target: DecimalInput): Band {
  const t = decIn(target, "captureTarget", "0", "1");
  return rate.gte(t) ? "GREEN" : rate.gte(t.minus("0.2")) ? "AMBER" : "RED";
}

export interface EwsDashboard {
  /** Accounts and exposure by alert band, with the share of exposure. */
  byAlert: Record<Band, { accounts: number; exposure: Dec; share: Dec }>;
  totals: { accounts: number; exposure: Dec };
  /** Examinations by status: accounts, exposure and those beyond the days allowed. */
  byStatus: Record<ExaminationStatus, { accounts: number; exposure: Dec; beyond: number }>;
  examinationTotals: { accounts: number; exposure: Dec; beyond: number };
  openBeyond: number;
  alertsWithoutDate: number;
  returnsLate: number;
  returnsPending: number;
  confirmed: number;
  captureRate: Dec;
  captureStatus: Band | null;
  falseAlertRate: Dec;
  indicatorsInUse: number;
  indicatorsNeverPresent: number;
  /** The ten highest-ranked accounts (indexes into the scores). */
  topTen: number[];
}

/** The Board committee's view (para 14; the model's Dashboard). */
export function ewsDashboard(
  scores: readonly EwsScore[],
  review: readonly IndicatorReviewLine[],
  raw: unknown,
): EwsDashboard {
  const p = ewsPack(raw);
  const total = sum(scores.map((s) => s.exposure));
  const band = (b: Band) => {
    const xs = scores.filter((s) => s.alert === b);
    const exposure = sum(xs.map((s) => s.exposure));
    return {
      accounts: xs.length,
      exposure,
      share: total.isZero() ? new D(0) : exposure.div(total),
    };
  };
  const beyondOf: Record<ExaminationStatus, Band> = {
    "Not started": "RED",
    "Under examination": "RED",
    "Closed – no fraud angle": "AMBER",
    "Referred for investigation": "AMBER",
    "Classified as fraud": "AMBER",
  };
  const byStatus = Object.fromEntries(
    EXAMINATION_STATUSES.map((st) => {
      const xs = scores.filter((s) => s.status === st);
      return [
        st,
        {
          accounts: xs.length,
          exposure: sum(xs.map((s) => s.exposure)),
          beyond: xs.filter((s) => s.examination === beyondOf[st]).length,
        },
      ];
    }),
  ) as EwsDashboard["byStatus"];
  const lines = Object.values(byStatus);
  const confirmed =
    byStatus["Referred for investigation"].accounts + byStatus["Classified as fraud"].accounts;
  const captureRate =
    confirmed === 0
      ? new D(0)
      : new D(scores.filter((s) => s.modelAlertOnConfirmed === "Yes").length).div(confirmed);
  const closed = byStatus["Closed – no fraud angle"].accounts + confirmed;
  return {
    byAlert: { RED: band("RED"), AMBER: band("AMBER"), GREEN: band("GREEN") },
    totals: { accounts: scores.length, exposure: total },
    byStatus,
    examinationTotals: {
      accounts: lines.reduce((a, l) => a + l.accounts, 0),
      exposure: sum(lines.map((l) => l.exposure)),
      beyond: lines.reduce((a, l) => a + l.beyond, 0),
    },
    openBeyond: byStatus["Not started"].beyond + byStatus["Under examination"].beyond,
    alertsWithoutDate: scores.filter((s) => s.examination === "CHECK").length,
    returnsLate: scores.filter((s) => s.returnStatus === "RED").length,
    returnsPending: scores.filter((s) => s.returnStatus === "AMBER").length,
    confirmed,
    captureRate,
    captureStatus: confirmed === 0 ? null : captureStatus(captureRate, p.captureTarget),
    falseAlertRate:
      closed === 0 ? new D(0) : new D(byStatus["Closed – no fraud angle"].accounts).div(closed),
    indicatorsInUse: review.filter((r) => r.weightInUse.gt(0)).length,
    indicatorsNeverPresent: review.filter((r) => r.remark === "Never present: review the indicator")
      .length,
    topTen: ewsRanking(scores).slice(0, 10),
  };
}
