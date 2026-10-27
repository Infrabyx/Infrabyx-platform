// The kernel locked list (IPB-03-71, 03-72, 03-74; owner decision O-4; PL4 plan §8.3). These
// actions are never autonomous at any level, in any product: Vidhi may gather, draft and prepare
// them (up to L2), and only a human with the action's role confirms. The list is a frozen constant;
// it is not read from settings, plan or BYOK, so nothing can unlock it. Products only add to it.
//
// Matching is by words of the tool name (`payments.release` → payments, release; the segments are
// split on dots and underscores), so a product cannot unlock a verb by renaming a tool slightly.
import { LOCKED_ACTION_CATEGORIES, type LockedActionCategory } from "@infrabyx/contracts/vidhi";
import type { VidhiProduct } from "@infrabyx/contracts/vidhi";

export interface LockedRule {
  category: LockedActionCategory;
  /** Whole words of a tool name that make it this category. */
  words: readonly string[];
  /** Role that confirms it by default (the tool's `required_role` overrides). */
  defaultRole: string;
}

const freeze = <T extends object>(o: T): Readonly<T> => Object.freeze(o);

export const KERNEL_LOCKED_LIST: readonly Readonly<LockedRule>[] = Object.freeze([
  freeze({
    category: "payments" as const,
    words: Object.freeze([
      "pay",
      "payment",
      "payments",
      "payout",
      "payouts",
      "disburse",
      "disbursal",
      "disbursement",
      "refund",
      "refunds",
      "transfer",
      "transfers",
      "remit",
      "remittance",
      "release",
      "settle",
      "settlement",
    ]),
    defaultRole: "ORG_CHECKER",
  }),
  freeze({
    category: "credit_decision" as const,
    words: Object.freeze([
      "sanction",
      "decline",
      "underwrite",
      "credit",
      "limit",
      "restructure",
      "restructuring",
      "approve_loan",
      "reject_loan",
    ]),
    defaultRole: "ORG_CHECKER",
  }),
  freeze({
    category: "collections" as const,
    words: Object.freeze([
      "collect",
      "collection",
      "collections",
      "dunning",
      "recovery",
      "overdue",
      "repossess",
    ]),
    defaultRole: "ORG_CHECKER",
  }),
  freeze({
    category: "hr" as const,
    words: Object.freeze([
      "payroll",
      "salary",
      "wage",
      "wages",
      "hire",
      "hiring",
      "offer_letter",
      "terminate",
      "termination",
      "dismiss",
      "discipline",
      "disciplinary",
      "appraisal",
      "appraise",
    ]),
    defaultRole: "ORG_ADMIN",
  }),
  freeze({
    category: "legal_filing" as const,
    words: Object.freeze([
      "file",
      "filing",
      "efile",
      "court",
      "tribunal",
      "regulator",
      "registry",
      "submit_return",
      "return_filing",
    ]),
    defaultRole: "ORG_ADMIN",
  }),
  freeze({
    category: "signature" as const,
    words: Object.freeze(["sign", "esign", "signature", "countersign"]),
    defaultRole: "ORG_ADMIN",
  }),
  freeze({
    category: "deletion" as const,
    words: Object.freeze(["delete", "purge", "erase", "destroy", "wipe", "shred"]),
    defaultRole: "ORG_ADMIN",
  }),
  freeze({
    category: "external_sharing" as const,
    words: Object.freeze([
      "share",
      "external",
      "export",
      "publish",
      "send_external",
      "counterparty",
      "disclose",
    ]),
    defaultRole: "ORG_ADMIN",
  }),
  freeze({
    category: "pricing" as const,
    words: Object.freeze([
      "price",
      "pricing",
      "tariff",
      "discount",
      "plan_change",
      "change_plan",
      "rate_card",
    ]),
    defaultRole: "ORG_ADMIN",
  }),
  freeze({
    category: "approval" as const,
    words: Object.freeze(["approve", "approval", "authorise", "authorize", "checker", "ratify"]),
    defaultRole: "ORG_CHECKER",
  }),
  freeze({
    category: "access_grant" as const,
    words: Object.freeze([
      "grant",
      "permission",
      "permissions",
      "role",
      "roles",
      "assign_role",
      "api_key",
      "access",
      "invite_admin",
    ]),
    defaultRole: "ORG_OWNER",
  }),
]);

/**
 * Product additions (IPB-03 §03.4.11), additive only. Each maps tool words to a category already
 * on the kernel list, so a product addition can never relax it.
 */
export const PRODUCT_LOCKED_ADDITIONS: Readonly<
  Partial<Record<VidhiProduct, readonly Readonly<LockedRule>[]>>
> = Object.freeze({
  LD: Object.freeze([
    freeze({
      category: "external_sharing" as const,
      words: Object.freeze(["send_document", "upload_portal"]),
      defaultRole: "ORG_ADMIN",
    }),
  ]),
  LDC: Object.freeze([
    freeze({
      category: "legal_filing" as const,
      words: Object.freeze([
        "mark_complied",
        "close_finding",
        "change_control_owner",
        "status_change",
      ]),
      defaultRole: "ORG_ADMIN",
    }),
  ]),
  EQ: Object.freeze([
    freeze({
      category: "legal_filing" as const,
      words: Object.freeze([
        "decide",
        "decision",
        "recommend_outcome",
        "award",
        "settlement_terms",
        "contact_party",
        "notice",
        "alter_timeline",
      ]),
      defaultRole: "ORG_ADMIN",
    }),
  ]),
  FBX: Object.freeze([
    freeze({
      category: "credit_decision" as const,
      words: Object.freeze(["ledger", "kyc_status", "loan_ledger"]),
      defaultRole: "ORG_CHECKER",
    }),
  ]),
  UDF: Object.freeze([
    freeze({
      category: "collections" as const,
      words: Object.freeze([
        "reminder",
        "negotiate",
        "offer",
        "pre_approval",
        "preapproval",
        "consent",
      ]),
      defaultRole: "ORG_CHECKER",
    }),
  ]),
  OH: Object.freeze([
    freeze({
      category: "hr" as const,
      words: Object.freeze(["vendor_payment", "send_customer"]),
      defaultRole: "ORG_ADMIN",
    }),
  ]),
});

/**
 * Words of a tool name: each dotted segment, its underscore parts, and every run of two or three
 * consecutive parts (so `svc.do_offer_letter` still carries `offer_letter`).
 */
export function toolWords(name: string): string[] {
  const out = new Set<string>();
  for (const seg of name.toLowerCase().split(".")) {
    out.add(seg);
    const parts = seg.split("_").filter(Boolean);
    parts.forEach((w, i) => {
      out.add(w);
      if (i + 1 < parts.length) out.add(`${w}_${parts[i + 1]}`);
      if (i + 2 < parts.length) out.add(`${w}_${parts[i + 1]}_${parts[i + 2]}`);
    });
  }
  return [...out];
}

export interface LockedMatch {
  category: LockedActionCategory;
  defaultRole: string;
}

/** The locked category a tool belongs to, kernel list first, then the product's additions. */
export function lockedCategory(
  toolName: string,
  product?: VidhiProduct,
  extra: readonly LockedRule[] = [],
): LockedMatch | null {
  const words = new Set(toolWords(toolName));
  for (const rule of [
    ...KERNEL_LOCKED_LIST,
    ...((product && PRODUCT_LOCKED_ADDITIONS[product]) || []),
    ...extra,
  ]) {
    if (!(LOCKED_ACTION_CATEGORIES as readonly string[]).includes(rule.category)) continue;
    if (rule.words.some((w) => words.has(w)))
      return { category: rule.category, defaultRole: rule.defaultRole };
  }
  return null;
}

/** Every IPB-03-71 category is covered by a kernel rule (checked by a unit test and ipb:check). */
export const coveredCategories = (): LockedActionCategory[] =>
  [...new Set(KERNEL_LOCKED_LIST.map((r) => r.category))].sort() as LockedActionCategory[];
