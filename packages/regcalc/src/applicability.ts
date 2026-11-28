// `applicability` (R1-regcalc plan §2; owner answer 6, R1-D-301; oracles APP-M01 to APP-M07): a
// profile and a rule pack give, for each policy, committee, role and return, whether it applies,
// with the line that decided it. Two engine shapes, as the owner's models:
//   - `layered` (APP-M01, NBFCs): the regulatory layer picks an answer (Yes, No or Conditional);
//     a Conditional line is settled by a rule over the profile's flags and derived thresholds,
//     in the owner's grammar ("A100 or DEP", "DEP and BR10 or A5000 and CUST");
//   - `sector` (APP-M02 to M07): the category picks the answer; a Conditional line is settled by a
//     line answer, else by its profile question (Yes, No or In part).
// The evaluator never guesses: a question the decision needs and the profile leaves unanswered
// gives `needs_answer` (the owner's workbooks read a blank as "No"; the package does not), and a
// condition no rule could express gives `check_condition`. The same profile and pack always give
// the same answer. Results carry the model's own words (`label`) so a product can show them.
import { z } from "zod";
import { basis, type Basis } from "./basis.js";
import { D, dec } from "./decimal.js";
import { RegcalcError } from "./errors.js";

export const APPLICABILITY_RESULTS = [
  "applies",
  "does_not_apply",
  "good_practice",
  "check_condition",
  "needs_answer",
] as const;
export type ApplicabilityResult = (typeof APPLICABILITY_RESULTS)[number];

const LAYER_ANSWER = z.enum(["Yes", "No", "Conditional"]);
const code = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/);
const text = (max: number) => z.string().min(1).max(max);
const version = z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/);

/** A rule over the profile: a flag, a comparison, or a combination (three-valued; see `evalRule`). */
export type Rule =
  | { yes: string }
  | { eq: [string, string] }
  | { gte: [string, string] }
  | { gt: [string, string] }
  | { answered: string }
  | { all: Rule[] }
  | { any: Rule[] }
  | { not: Rule }
  | { const: boolean };
export const Rule: z.ZodType<Rule> = z.lazy(() =>
  z.union([
    z.object({ yes: code }).strict(),
    z.object({ eq: z.tuple([code, text(200)]) }).strict(),
    z.object({ gte: z.tuple([code, z.string().regex(/^-?[0-9]+(\.[0-9]+)?$/)]) }).strict(),
    z.object({ gt: z.tuple([code, z.string().regex(/^-?[0-9]+(\.[0-9]+)?$/)]) }).strict(),
    z.object({ answered: code }).strict(),
    z.object({ all: z.array(Rule).min(1).max(32) }).strict(),
    z.object({ any: z.array(Rule).min(1).max(32) }).strict(),
    z.object({ not: Rule }).strict(),
    z.object({ const: z.boolean() }).strict(),
  ]),
);

/**
 * The owner's condition grammar (`maps/app_rules.json`, `condition_rule`): flag codes joined by
 * ` and ` within ` or `, `and` binding tighter; `TRUE` and `FALSE` are constants.
 */
export function parseCondition(s: string): Rule {
  if (s === "TRUE" || s === "FALSE") return { const: s === "TRUE" };
  const ors = s.split(" or ").map((part) => {
    const ands = part.split(" and ").map((x) => x.trim());
    for (const a of ands)
      if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(a))
        throw new RegcalcError("rule_pack_invalid", `condition "${s}" names "${a}"`, "pack");
    const flags: Rule[] = ands.map((a) => ({ yes: a }));
    return flags.length === 1 ? flags[0]! : { all: flags };
  });
  return ors.length === 1 ? ors[0]! : { any: ors };
}

const question = z
  .object({
    code,
    label: text(400),
    kind: z.enum(["text", "date", "number", "yes_no", "yes_no_in_part", "choice"]),
    options: z.array(text(200)).min(1).max(64).optional(),
  })
  .strict();

const common = {
  id: text(64),
  version,
  effectiveFrom: z.iso.date(),
  /** The owner's model the pack reproduces (`APP-M01` …). */
  model: z.string().regex(/^APP-M0[1-9]$/),
  title: text(200),
  /** What the model rests on, shown with each decision. */
  citation: text(500),
};

const layeredPolicy = z
  .object({
    no: z.number().int().positive(),
    group: text(200),
    policy: text(400),
    type: text(100),
    /** The answer for the Base, Middle and Upper Layer. */
    answers: z.tuple([LAYER_ANSWER, LAYER_ANSWER, LAYER_ANSWER]),
    /** The rule of a Conditional line, in the owner's grammar; absent: check the condition. */
    condition: text(500).optional(),
    /** A flag the line needs whatever the layer answer says (a line for one category only). */
    gate: code.optional(),
    /** The result when the condition is not met (`does_not_apply`, or `good_practice`). */
    whenNotMet: z.enum(["does_not_apply", "good_practice"]),
    conditionText: z.string().max(1000),
    legalBasis: z.string().max(1000),
  })
  .strict();

export const LayeredPack = z
  .object({
    kind: z.literal("layered"),
    ...common,
    layers: z.tuple([text(40), text(40), text(40)]),
    /** The question holding the layer, the category and the total assets. */
    layerQuestion: code,
    questions: z.array(question).min(1).max(200),
    derived: z.array(z.object({ code, label: text(200), rule: Rule }).strict()).max(64),
    policies: z.array(layeredPolicy).min(1).max(500),
    committees: z
      .array(
        z
          .object({
            no: text(10),
            name: text(300),
            legalBasis: z.string().max(1000),
            answers: z.tuple([LAYER_ANSWER, LAYER_ANSWER, LAYER_ANSWER]),
            note: z.string().max(1000),
          })
          .strict(),
      )
      .max(200),
    /** A return's rule; absent: "Confirm" (the rule depends on what the profile does not ask). */
    returns: z
      .array(
        z
          .object({
            code: text(20),
            name: text(200),
            frequency: text(60),
            rule: Rule.optional(),
            who: z.string().max(400),
          })
          .strict(),
      )
      .max(200),
    /** The model's integrity checks over the profile; each is OK only when its rule is true. */
    checks: z.array(z.object({ name: text(200), rule: Rule }).strict()).max(50),
    /** The code of the entity's name, its category and its total assets (₹ crore). */
    nameQuestion: code,
    categoryQuestion: code,
    assetsQuestion: code,
  })
  .strict();
export type LayeredPack = z.infer<typeof LayeredPack>;

export const SectorPack = z
  .object({
    kind: z.literal("sector"),
    ...common,
    categories: z
      .array(z.object({ code, label: text(300) }).strict())
      .min(1)
      .max(20),
    questions: z.array(z.object({ code, label: text(600) }).strict()).max(100),
    policies: z
      .array(
        z
          .object({
            no: z.number().int().positive(),
            group: text(200),
            policy: text(400),
            type: text(100),
            /** The answer for each category, by category code. */
            answers: z.record(code, LAYER_ANSWER),
            /** The profile question that settles a Conditional line; null: a line answer only. */
            question: code.nullable(),
            condition: z.string().max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    committees: z
      .array(
        z
          .object({
            no: z.number().int().positive(),
            name: text(300),
            legalBasis: z.string().max(1000),
            answers: z.record(code, LAYER_ANSWER),
            note: z.string().max(1000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type SectorPack = z.infer<typeof SectorPack>;

export type ApplicabilityPack = LayeredPack | SectorPack;
const ApplicabilityPack = z.discriminatedUnion("kind", [LayeredPack, SectorPack]);

/** Flags a rule may name: the yes/no questions and the derived thresholds. */
function flagsOf(p: LayeredPack): Set<string> {
  return new Set([
    ...p.questions.filter((q) => q.kind === "yes_no").map((q) => q.code),
    ...p.derived.map((d) => d.code),
  ]);
}

function rulesOf(r: Rule): Rule[] {
  if ("all" in r) return [r, ...r.all.flatMap(rulesOf)];
  if ("any" in r) return [r, ...r.any.flatMap(rulesOf)];
  if ("not" in r) return [r, ...rulesOf(r.not)];
  return [r];
}

/** The checked pack: its schema, unique numbers, and every code a rule names defined. */
export function applicabilityPack(raw: unknown): ApplicabilityPack {
  const r = ApplicabilityPack.safeParse(raw);
  if (!r.success) throw new RegcalcError("rule_pack_invalid", r.error.issues[0]!.message, "pack");
  const p = r.data;
  const bad = (m: string): never => {
    throw new RegcalcError("rule_pack_invalid", m, "pack");
  };
  if (new Set(p.policies.map((x) => x.no)).size !== p.policies.length)
    bad("policy numbers must be unique");
  if (p.kind === "layered") {
    const qs = new Set(p.questions.map((q) => q.code));
    if (qs.size !== p.questions.length) bad("question codes must be unique");
    if (!qs.has(p.layerQuestion)) bad(`no question ${p.layerQuestion}`);
    const flags = flagsOf(p);
    const known = new Set([...qs, ...flags]);
    const check = (rule: Rule, where: string) => {
      for (const x of rulesOf(rule)) {
        if ("yes" in x && !flags.has(x.yes)) bad(`${where} names an unknown flag ${x.yes}`);
        if ("eq" in x && !known.has(x.eq[0])) bad(`${where} names an unknown code ${x.eq[0]}`);
        if ("gte" in x && !known.has(x.gte[0])) bad(`${where} names an unknown code ${x.gte[0]}`);
        if ("gt" in x && !known.has(x.gt[0])) bad(`${where} names an unknown code ${x.gt[0]}`);
        if ("answered" in x && !qs.has(x.answered)) bad(`${where} names an unknown question`);
      }
    };
    p.derived.forEach((d) => check(d.rule, `derived ${d.code}`));
    for (const x of p.policies) {
      if (x.condition) check(parseCondition(x.condition), `policy ${x.no}`);
      if (x.gate && !flags.has(x.gate)) bad(`policy ${x.no} gate names an unknown flag`);
    }
    p.returns.forEach((x) => x.rule && check(x.rule, `return ${x.code}`));
    p.checks.forEach((x) => check(x.rule, `check "${x.name}"`));
    for (const c of [p.nameQuestion, p.categoryQuestion, p.assetsQuestion])
      if (!qs.has(c)) bad(`no question ${c}`);
  } else {
    const cats = p.categories.map((c) => c.code);
    if (new Set(cats).size !== cats.length) bad("category codes must be unique");
    const qs = new Set(p.questions.map((q) => q.code));
    const sameCats = (a: Record<string, unknown>, where: string) => {
      const k = Object.keys(a);
      if (k.length !== cats.length || !cats.every((c) => k.includes(c)))
        bad(`${where} must answer every category`);
    };
    for (const x of p.policies) {
      sameCats(x.answers, `policy ${x.no}`);
      if (x.question !== null && !qs.has(x.question))
        bad(`policy ${x.no} names an unknown question`);
    }
    p.committees.forEach((x) => sameCats(x.answers, `committee ${x.no}`));
  }
  return p;
}

// ---- three-valued evaluation ------------------------------------------------------------------

/** A profile: each question's answer by code (`"Yes"`, `"No"`, a choice, a decimal string). */
export type Profile = Readonly<Record<string, string | undefined>>;
type Tri = boolean | undefined;

const answered = (v: string | undefined): v is string => v !== undefined && v.trim() !== "";

function evalRule(rule: Rule, get: (code: string) => Tri | string | undefined): Tri {
  if ("const" in rule) return rule.const;
  if ("answered" in rule) return get(rule.answered) !== undefined;
  if ("gt" in rule) {
    const v = get(rule.gt[0]);
    if (typeof v !== "string") return undefined;
    return dec(v, rule.gt[0]).gt(new D(rule.gt[1]));
  }
  if ("yes" in rule) {
    const v = get(rule.yes);
    return typeof v === "string" ? v === "Yes" : v;
  }
  if ("eq" in rule) {
    const v = get(rule.eq[0]);
    return typeof v === "string" ? v === rule.eq[1] : undefined;
  }
  if ("gte" in rule) {
    const v = get(rule.gte[0]);
    if (typeof v !== "string") return undefined;
    return dec(v, rule.gte[0]).gte(new D(rule.gte[1]));
  }
  if ("not" in rule) {
    const v = evalRule(rule.not, get);
    return v === undefined ? undefined : !v;
  }
  const vs = (("all" in rule ? rule.all : rule.any) as Rule[]).map((x) => evalRule(x, get));
  if ("all" in rule) return vs.includes(false) ? false : vs.includes(undefined) ? undefined : true;
  return vs.includes(true) ? true : vs.includes(undefined) ? undefined : false;
}

export type Rag = "GREEN" | "AMBER" | "RED";
export type InPlace = "Yes" | "Partly" | "No";

/** What the entity records against each line (all optional). */
export interface ApplicabilityLines {
  /** A recorded override of a policy's result, by policy number. */
  override?: Readonly<Record<number, "Applies" | "Does not apply" | "Good practice">>;
  /** Whether each policy is in place, by policy number. */
  inPlace?: Readonly<Record<number, InPlace>>;
  /** Whether each committee or role is in place, by its number. */
  committeeInPlace?: Readonly<Record<string, "Yes" | "No">>;
  /** Whether each return was filed on time last period, by return code (layered only). */
  returnOnTime?: Readonly<Record<string, "Yes" | "No">>;
  /** A line's answer to its condition, which takes precedence over the profile (sector only). */
  conditionMet?: Readonly<Record<number, "Yes" | "No">>;
}

export interface PolicyDecision {
  no: number;
  group: string;
  policy: string;
  /** The pack's answer for the layer or category; null while that is unanswered. */
  answer: "Yes" | "No" | "Conditional" | null;
  /** Whether a Conditional line's condition is met; null where it is not Conditional. */
  conditionMet: "Yes" | "No" | "Check" | "Unanswered" | null;
  result: ApplicabilityResult;
  /** The result after any override. */
  final: ApplicabilityResult;
  overridden: boolean;
  /** The gap: GREEN, AMBER or RED; "Not assessed" (layered) while in place is unanswered. */
  status: Rag | "Not assessed" | null;
  /** The model's words for `final`. */
  label: string;
  basis: Basis;
}

export interface CommitteeDecision {
  no: string;
  name: string;
  answer: "Yes" | "No" | "Conditional" | null;
  status: Rag | "Not required" | "Not assessed" | "Required" | "Confirm" | null;
}

export interface ReturnDecision {
  code: string;
  name: string;
  result: "applies" | "does_not_apply" | "confirm" | "needs_answer";
  label: string;
  status: "GREEN" | "RED" | "Not assessed" | null;
}

export interface GroupCount {
  group: string;
  lines: number;
  applies: number;
  goodPractice: number;
  /** Sector: lines whose condition is to be confirmed. */
  toConfirm: number;
  inPlace: number;
  partly: number;
  missing: number;
  /** Layered: lines that apply with no in-place answer. */
  notAssessed: number;
}

export interface ApplicabilityCheck {
  name: string;
  ok: boolean;
}

export interface ApplicabilityOutcome {
  model: string;
  /** The model's heading line (layered), or the category chosen (sector; "" while unanswered). */
  heading: string;
  pack: { id: string; version: string };
  /** Layered: the derived thresholds, Yes or No (null while an answer they need is missing). */
  derived: Record<string, "Yes" | "No" | null>;
  policies: PolicyDecision[];
  committees: CommitteeDecision[];
  returns: ReturnDecision[];
  groups: GroupCount[];
  totals: Omit<GroupCount, "group">;
  checkTheCondition: number;
  /** Layered: in place ÷ applying (0 when nothing applies), and its RAG ("" with none). */
  compliance: { ratio: string; rag: Rag | "" } | null;
  committeesRequired: number;
  committeesMissing: number;
  returnsApplying: number;
  checks: ApplicabilityCheck[];
}

const LAYERED_LABEL: Record<ApplicabilityResult, string> = {
  applies: "Applies",
  does_not_apply: "Does not apply",
  good_practice: "Good practice",
  check_condition: "Check the condition",
  needs_answer: "Needs an answer",
};
const SECTOR_LABEL: Record<ApplicabilityResult, string> = {
  applies: "Applies",
  does_not_apply: "Does not apply",
  good_practice: "Good practice",
  check_condition: "Confirm the condition",
  needs_answer: "Confirm the condition",
};
const FROM_LABEL: Record<string, ApplicabilityResult> = {
  Applies: "applies",
  "Does not apply": "does_not_apply",
  "Good practice": "good_practice",
};

function counts(
  policies: readonly PolicyDecision[],
  groups: readonly string[],
  inPlace: (no: number) => string | undefined,
  sector: boolean,
): GroupCount[] {
  return groups.map((group) => {
    const xs = policies.filter((x) => x.group === group);
    // Sector: in place is counted for every line not "Does not apply" (the model's COUNTIFS).
    const counted = (x: PolicyDecision) => (sector ? x.final !== "does_not_apply" : true);
    const ip = (v: string) =>
      sector
        ? xs.filter((x) => counted(x) && inPlace(x.no) === v).length
        : xs.filter((x) => x.status === { Yes: "GREEN", Partly: "AMBER", No: "RED" }[v]).length;
    return {
      group,
      lines: xs.length,
      applies: xs.filter((x) => x.final === "applies").length,
      goodPractice: xs.filter((x) => x.final === "good_practice").length,
      toConfirm: sector ? xs.filter((x) => x.label === "Confirm the condition").length : 0,
      inPlace: ip("Yes"),
      partly: ip("Partly"),
      missing: ip("No"),
      notAssessed: sector ? 0 : xs.filter((x) => x.status === "Not assessed").length,
    };
  });
}

function total(gs: readonly GroupCount[]): Omit<GroupCount, "group"> {
  const k = [
    "lines",
    "applies",
    "goodPractice",
    "toConfirm",
    "inPlace",
    "partly",
    "missing",
    "notAssessed",
  ] as const;
  return Object.fromEntries(k.map((x) => [x, gs.reduce((a, g) => a + g[x], 0)])) as Omit<
    GroupCount,
    "group"
  >;
}

/** A number as Excel's `TEXT(N(x),"#,##0")`: rounded half away from zero, commas every 3 digits. */
function grouped(x: string | undefined): string {
  const n = x === undefined ? new D(0) : dec(x, "assets");
  const r = n.abs().toFixed(0, D.ROUND_HALF_UP);
  return (n.isNegative() && r !== "0" ? "-" : "") + r.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const groupsOf = (ps: readonly { group: string }[]) => [...new Set(ps.map((x) => x.group))];

function layered(
  p: LayeredPack,
  profile: Profile,
  lines: ApplicabilityLines,
): ApplicabilityOutcome {
  const raw = (c: string) => (answered(profile[c]) ? profile[c]!.trim() : undefined);
  const derived: Record<string, Tri> = {};
  const get = (c: string): Tri | string | undefined => (c in derived ? derived[c] : raw(c));
  for (const d of p.derived) derived[d.code] = evalRule(d.rule, get);
  const layer = raw(p.layerQuestion);
  const li = layer === undefined ? -1 : p.layers.indexOf(layer);
  if (layer !== undefined && li < 0)
    throw RegcalcError.input(p.layerQuestion, `not one of ${p.layers.join(", ")}`);
  const cite = (x: { legalBasis: string }) => basis(x.legalBasis || p.citation, p.model);

  const policies = p.policies.map((x): PolicyDecision => {
    const rec = x.type.startsWith("Recommended");
    const met: ApplicabilityResult = rec ? "good_practice" : "applies";
    const answer = li < 0 ? null : x.answers[li]!;
    let conditionMet: PolicyDecision["conditionMet"] = null;
    let result: ApplicabilityResult;
    if (answer === null) result = "needs_answer";
    else if (answer === "No") result = "does_not_apply";
    else if (answer === "Yes") result = met;
    else if (!x.condition) {
      conditionMet = "Check";
      result = "check_condition";
    } else {
      const v = evalRule(parseCondition(x.condition), get);
      conditionMet = v === undefined ? "Unanswered" : v ? "Yes" : "No";
      result = v === undefined ? "needs_answer" : v ? met : x.whenNotMet;
    }
    if (x.gate) {
      const g = get(x.gate);
      const open = typeof g === "string" ? g === "Yes" : g;
      if (open === false) result = "does_not_apply";
      else if (open === undefined && result !== "does_not_apply") result = "needs_answer";
    }
    const o = lines.override?.[x.no];
    const final = o ? FROM_LABEL[o]! : result;
    const ip = lines.inPlace?.[x.no];
    const status =
      final !== "applies"
        ? null
        : ip === "Yes"
          ? "GREEN"
          : ip === "Partly"
            ? "AMBER"
            : ip === "No"
              ? "RED"
              : "Not assessed";
    return {
      no: x.no,
      group: x.group,
      policy: x.policy,
      answer,
      conditionMet,
      result,
      final,
      overridden: o !== undefined,
      status,
      label: LAYERED_LABEL[final],
      basis: cite(x),
    };
  });

  const committees = p.committees.map((x): CommitteeDecision => {
    const answer = li < 0 ? null : x.answers[li]!;
    const e = lines.committeeInPlace?.[x.no];
    const status =
      answer === null
        ? null
        : answer === "No"
          ? "Not required"
          : e === "Yes"
            ? "GREEN"
            : e === "No"
              ? answer === "Yes"
                ? "RED"
                : "AMBER"
              : "Not assessed";
    return { no: x.no, name: x.name, answer, status };
  });

  const returns = p.returns.map((x): ReturnDecision => {
    const v = x.rule ? evalRule(x.rule, get) : null;
    const result: ReturnDecision["result"] =
      v === null ? "confirm" : v === undefined ? "needs_answer" : v ? "applies" : "does_not_apply";
    const label = {
      applies: "Applies",
      does_not_apply: "Does not apply",
      confirm: "Confirm",
      needs_answer: "Needs an answer",
    }[result];
    const f = lines.returnOnTime?.[x.code];
    const status =
      result === "does_not_apply"
        ? null
        : f === "Yes"
          ? "GREEN"
          : f === "No"
            ? "RED"
            : "Not assessed";
    return { code: x.code, name: x.name, result, label, status };
  });

  const groups = counts(policies, groupsOf(p.policies), (n) => lines.inPlace?.[n], false);
  const totals = total(groups);
  const ratio = totals.applies === 0 ? new D(0) : new D(totals.inPlace).div(totals.applies);
  const rag: Rag | "" =
    totals.applies === 0
      ? ""
      : totals.missing > 0
        ? "RED"
        : totals.partly + totals.notAssessed > 0
          ? "AMBER"
          : "GREEN";
  const checkTheCondition = policies.filter((x) => x.final === "check_condition").length;
  const checks: ApplicabilityCheck[] = [
    ...p.checks.map((c) => ({ name: c.name, ok: evalRule(c.rule, get) === true })),
    { name: 'No policy is left at "Check the condition"', ok: checkTheCondition === 0 },
    {
      name: "Every policy that applies has been assessed",
      ok: !policies.some((x) => x.status === "Not assessed"),
    },
  ];
  const assets = raw(p.assetsQuestion);
  const heading =
    `Company: ${raw(p.nameQuestion) ?? ""}   |   ${layer ?? ""}   |   ` +
    `${raw(p.categoryQuestion) ?? ""}   |   Total assets ₹ ${grouped(assets)} crore`;
  return {
    model: p.model,
    heading,
    pack: { id: p.id, version: p.version },
    derived: Object.fromEntries(
      p.derived.map((d) => [
        d.code,
        derived[d.code] === undefined ? null : derived[d.code] ? "Yes" : "No",
      ]),
    ),
    policies,
    committees,
    returns,
    groups,
    totals,
    checkTheCondition,
    compliance: { ratio: ratio.toString(), rag },
    committeesRequired: committees.filter((x) => x.answer === "Yes").length,
    committeesMissing: committees.filter((x) => x.status === "RED").length,
    returnsApplying: returns.filter((x) => x.result === "applies").length,
    checks,
  };
}

function sector(p: SectorPack, profile: Profile, lines: ApplicabilityLines): ApplicabilityOutcome {
  const raw = (c: string) => (answered(profile[c]) ? profile[c]!.trim() : undefined);
  const category = raw("category");
  const cat = category === undefined ? undefined : p.categories.find((c) => c.label === category);
  const cite = basis(p.citation, p.model);
  const policies = p.policies.map((x): PolicyDecision => {
    const met: ApplicabilityResult = x.type === "Recommended" ? "good_practice" : "applies";
    const answer = cat ? x.answers[cat.code]! : null;
    let conditionMet: PolicyDecision["conditionMet"] = null;
    let result: ApplicabilityResult;
    if (answer === null) result = "needs_answer";
    else if (answer === "No") result = "does_not_apply";
    else if (answer === "Yes") result = met;
    else {
      const k = lines.conditionMet?.[x.no] ?? (x.question ? raw(x.question) : undefined);
      conditionMet =
        k === "Yes" ? "Yes" : k === "No" ? "No" : k === undefined ? "Unanswered" : "Check";
      result =
        k === "Yes"
          ? met
          : k === "No"
            ? "does_not_apply"
            : k === undefined
              ? "needs_answer"
              : "check_condition";
    }
    const o = answer === null ? undefined : lines.override?.[x.no];
    const final = o ? FROM_LABEL[o]! : result;
    const label = answer === null && !o ? "" : SECTOR_LABEL[final];
    const ip = lines.inPlace?.[x.no];
    const status =
      label === "" || final === "does_not_apply"
        ? null
        : label === "Confirm the condition"
          ? "AMBER"
          : ip === undefined
            ? null
            : ip === "Yes"
              ? "GREEN"
              : ip === "No" && final === "applies"
                ? "RED"
                : "AMBER";
    return {
      no: x.no,
      group: x.group,
      policy: x.policy,
      answer,
      conditionMet,
      result,
      final,
      overridden: o !== undefined,
      status,
      label,
      basis: cite,
    };
  });
  const committees = p.committees.map((x): CommitteeDecision => {
    const answer = cat ? x.answers[cat.code]! : null;
    const e = lines.committeeInPlace?.[String(x.no)];
    const status =
      answer === null
        ? null
        : answer === "No"
          ? "Not required"
          : e === "Yes"
            ? "GREEN"
            : e === "No"
              ? answer === "Yes"
                ? "RED"
                : "AMBER"
              : answer === "Yes"
                ? "Required"
                : "Confirm";
    return { no: String(x.no), name: x.name, answer, status };
  });
  const groups = counts(policies, groupsOf(p.policies), (n) => lines.inPlace?.[n], true);
  const totals = total(groups);
  const answeredQs = p.questions.filter((q) =>
    ["Yes", "No", "In part"].includes(raw(q.code) ?? ""),
  ).length;
  const checks: ApplicabilityCheck[] = [
    { name: "The name is entered", ok: raw("name") !== undefined },
    { name: "The category is one of the listed categories", ok: cat !== undefined },
    { name: "Every condition is answered", ok: totals.toConfirm === 0 },
    { name: "Every override is a permitted value", ok: true },
    ...(p.questions.length
      ? [
          {
            name: "Every profile question is answered Yes, No or In part",
            ok: answeredQs === p.questions.length,
          },
        ]
      : []),
  ];
  return {
    model: p.model,
    heading: cat ? cat.label : "",
    pack: { id: p.id, version: p.version },
    derived: {},
    policies,
    committees,
    returns: [],
    groups,
    totals,
    checkTheCondition: totals.toConfirm,
    compliance: null,
    committeesRequired: committees.filter((x) => x.answer === "Yes").length,
    committeesMissing: committees.filter((x) => x.status === "RED").length,
    returnsApplying: 0,
    checks,
  };
}

/** What applies to an entity with `profile` under `pack`, with what it recorded in `lines`. */
export function applicability(
  pack: unknown,
  profile: Profile,
  lines: ApplicabilityLines = {},
): ApplicabilityOutcome {
  const p = applicabilityPack(pack);
  for (const [k, v] of Object.entries(profile))
    if (v !== undefined && typeof v !== "string")
      throw RegcalcError.input(k, "a profile answer is a string");
  return p.kind === "layered" ? layered(p, profile, lines) : sector(p, profile, lines);
}
