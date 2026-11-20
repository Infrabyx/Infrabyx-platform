// Staff and RE-administrator notifications by role (Udofin PR-UDF-052; R1-D-222; plan
// `docs/phases/R1-udofin-staff-notify-plan.md`). A staff class (`audience: staff`) goes only to the
// people who hold a role in the context's tenant, found at send time inside the recording
// transaction under forced RLS, by in-app and email. Its variables are INTERNAL references and
// codes: an unknown name, or a value carrying an e-mail address, a phone number, a PAN, an Aadhaar
// number or VID, is refused; a subject variable must be a reference or code; and its subject and
// title templates may use only the class's `subject_variables`.
import { holdsAadhaarLike } from "@infrabyx/contracts/aadhaar";
import { IpbError } from "@infrabyx/contracts/errors";
import type { NotificationClass } from "@infrabyx/contracts/ports";

/** More holders than this is refused: `NotificationRequest.to` takes at most 1,000. */
export const MAX_STAFF_RECIPIENTS = 1000;

export const isStaffClass = (cls: Pick<NotificationClass, "audience">): boolean =>
  cls.audience === "staff";

/** The variables a staff class's subject and titles may carry; undefined for any other class. */
export const staffSubjectVariables = (
  cls: Pick<NotificationClass, "audience" | "subject_variables">,
): readonly string[] | undefined => (isStaffClass(cls) ? (cls.subject_variables ?? []) : undefined);

const EMAIL = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[A-Za-z]{2,}/;
/** An Indian mobile number (with or without +91 or 0) or any `+` number of 8 to 15 digits. */
const PHONE =
  /(?<![0-9A-Za-z])(?:(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}|\+\d(?:[\s-]?\d){7,14})(?![0-9])/;
const PAN = /(?<![A-Za-z0-9])[A-Za-z]{5}[0-9]{4}[A-Za-z](?![A-Za-z0-9])/;
/** A reference or code: no spaces, so never a name or free text. */
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_.:/#-]{0,79}$/;
const LONG_DIGITS = /\d{10,}/;

/** The kind of personal data found in a value, or null. The value itself is never reported. */
export function personalDataIn(value: string): "email" | "phone" | "pan" | "aadhaar" | null {
  if (EMAIL.test(value)) return "email";
  if (holdsAadhaarLike(value)) return "aadhaar";
  if (PHONE.test(value)) return "phone";
  if (PAN.test(value)) return "pan";
  return null;
}

export interface StaffVarFinding {
  variable: string;
  reason: "unknown_variable" | "personal_data" | "not_a_reference";
  /** For `personal_data`: what was found (never the value). */
  kind?: "email" | "phone" | "pan" | "aadhaar";
}

/** Every finding on a staff notification's variables (empty means clean). */
export function staffVarFindings(
  cls: Pick<NotificationClass, "variables" | "subject_variables">,
  vars: Readonly<Record<string, string | number | boolean>>,
): StaffVarFinding[] {
  const out: StaffVarFinding[] = [];
  const declared = new Set(cls.variables ?? []);
  const subject = new Set(cls.subject_variables ?? []);
  for (const [name, value] of Object.entries(vars)) {
    if (!declared.has(name)) {
      out.push({ variable: name, reason: "unknown_variable" });
      continue;
    }
    if (typeof value !== "string") continue;
    const kind = personalDataIn(value);
    if (kind) out.push({ variable: name, reason: "personal_data", kind });
    else if (subject.has(name) && (!REFERENCE.test(value) || LONG_DIGITS.test(value)))
      out.push({ variable: name, reason: "not_a_reference" });
  }
  return out;
}

/** Refuse a staff notification whose variables are unknown or carry personal data (IPB-NTF-007). */
export function assertStaffVars(
  cls: NotificationClass,
  vars: Readonly<Record<string, string | number | boolean>>,
): void {
  const findings = staffVarFindings(cls, vars);
  const first = findings[0];
  if (!first) return;
  throw new IpbError("IPB-NTF-007", {
    detail:
      first.reason === "unknown_variable"
        ? `${cls.id} does not offer the variable ${first.variable}`
        : first.reason === "personal_data"
          ? `the variable ${first.variable} carries personal data (${first.kind}); staff notifications carry references only`
          : `the subject variable ${first.variable} must be a reference or code`,
    meta: {
      reason: first.reason,
      class: cls.id,
      variables: findings.map((f) => f.variable).join(","),
    },
  });
}

const TITLE_PLACEHOLDER = /\{([a-z][a-zA-Z0-9_]*)\}/g;

/**
 * The in-app and push titles of staff classes (`messages`, by `title_key` and locale) may use only
 * the class's `subject_variables`; each finding names the class, key, locale and variable.
 */
export function lintStaffTitles(
  classes: readonly NotificationClass[],
  messages: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string[] {
  const out: string[] = [];
  for (const cls of classes) {
    const allowed = staffSubjectVariables(cls);
    if (!allowed) continue;
    const keys = new Set(
      [cls.templates.inapp?.title_key, cls.templates.push?.title_key].filter(
        (k): k is string => typeof k === "string",
      ),
    );
    for (const key of keys)
      for (const [locale, text] of Object.entries(messages[key] ?? {}))
        for (const m of text.matchAll(TITLE_PLACEHOLDER))
          if (!allowed.includes(m[1] as string))
            out.push(
              `${cls.id} title ${key} (${locale}) uses {${m[1]}}, which is not a subject variable`,
            );
  }
  return out;
}

interface Queryable {
  query<R>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }>;
}

/**
 * The active people in the transaction's tenant who hold any of `roles` now: tenant members whose
 * `tenancy.membership.roles` hold one, and the holders of an unrevoked tenant function for
 * `FN:<CODE>`. Service and agent identities are never returned. Both tables are under forced RLS,
 * and the tenant is also named, so another tenant's holders are never seen. At most
 * `MAX_STAFF_RECIPIENTS + 1` ids, ordered, so the caller can refuse too many.
 */
export async function staffHolders(
  tx: Queryable,
  tenantId: string,
  roles: readonly string[],
  exclude: readonly string[] = [],
): Promise<string[]> {
  const r = await tx.query<{ user_id: string }>(
    `select h.user_id from (
       select m.user_id from tenancy.membership m
        where m.tenant_id = $1 and m.roles && $2::text[]
       union
       select f.user_id from tenancy.function_assignment f
        where f.tenant_id = $1 and f.revoked_at is null and f.function = any($2::text[])
     ) h
     join tenancy.user u on u.id = h.user_id
    where u.status = 'active' and u.type = 'user' and not (h.user_id = any($3::text[]))
    order by h.user_id
    limit $4`,
    [tenantId, roles, exclude, MAX_STAFF_RECIPIENTS + 1],
  );
  return r.rows.map((x) => x.user_id);
}
