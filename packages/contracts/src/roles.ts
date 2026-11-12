// Role enum: the platform floor (PL1-D-05, "brief §3"). Products extend with their own prefixes.
import { z } from "zod";

export const PLATFORM_ROLES = [
  "PLT_SUPER_ADMIN",
  "PLT_SECURITY_OFFICER",
  "PLT_RELEASE_MANAGER",
  "PLT_CONTENT_EDITOR",
  "PLT_LEGAL_REVIEWER",
  "PLT_DPO",
  "PLT_GRIEVANCE_OFFICER",
  "PLT_AUDITOR_RO",
  "PLT_ACCESSIBILITY_LEAD",
  // Tenant-consented support access (LawDocsComply PR-LDC-08 (a), PR-LDC-20; owner answer #104;
  // R1-D-76): sees a tenant only under that tenant's live consent (`SupportAccess` in
  // `@infrabyx/tenancy`), never in a platform context. Products map their own support role onto it.
  "PLT_SUPPORT",
  // Commercial changes: raises a tenant's licence (entitlement) change, which a different
  // PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER approves; never an approver (OWNER-QUESTIONS #123; R1-D-107).
  "PLT_FINANCE",
] as const;

/** The support role of tenant-consented support access (R1-D-76). */
export const SUPPORT_ROLE = "PLT_SUPPORT" as const;

export const TENANT_ROLES = [
  "ORG_OWNER",
  "ORG_ADMIN",
  "ORG_MAKER",
  "ORG_CHECKER",
  "ORG_MEMBER",
  "ORG_AUDITOR_RO",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type TenantRole = (typeof TENANT_ROLES)[number];

/** Group-operations staff roles; specific names come from product packs (e.g. OPS_SUPPORT). */
export const OPS_ROLE_REGEX = /^OPS_[A-Z][A-Z0-9_]*$/;
/** AI agents: makers only, never checker, approver or signer (IPB-02-10). */
export const AGENT_ROLE_REGEX = /^AGT_[A-Z][A-Z0-9_]*$/;
/** Service accounts (IPB-11 §11.4.6, e.g. SVC_BILLING). */
export const SERVICE_ROLE_REGEX = /^SVC_[A-Z][A-Z0-9_]*$/;
/**
 * Cross-tenant background readers (OWNER-QUESTIONS #22, PL3-D-21). A worker that must find due
 * work across tenants reads in a platform context as one of these roles, never as `PLT_AUDITOR_RO`
 * (a role for people). Each reads only the columns its database role is granted (`dbRole`, created
 * by the owning package's migration), may not write, impersonate or approve, and every read is
 * ledgered per tenant (`ServiceReader` in `@infrabyx/tenancy`). Contexts carrying them are built
 * in-process only; a token that claims one is refused.
 */
export const SERVICE_READER_ROLES = {
  SVC_SCHEDULER: { dbRole: "svc_scheduler", tables: ["workflow.timer"] },
  SVC_NOTIFY_DISPATCH: { dbRole: "svc_notify_dispatch", tables: ["notify.delivery"] },
  /** The unauthenticated one-click unsubscribe link finds its token by hash (RFC 8058). */
  SVC_NOTIFY_UNSUBSCRIBE: {
    dbRole: "svc_notify_unsubscribe",
    tables: ["notify.unsubscribe_token"],
  },
  /** Finds approved export jobs to run and expired archives to delete (OWNER-QUESTIONS #24). */
  SVC_EXPORT_SWEEP: {
    dbRole: "svc_export_sweep",
    tables: ["export.export_job", "export.archive"],
  },
  /** Finds tenants with AI runs past the retention floor (OWNER-QUESTIONS #30). */
  SVC_AI_RUN_SWEEP: { dbRole: "svc_ai_run_sweep", tables: ["ai.run"] },
  /** Finds retired retrieval index versions past 30 days (OWNER-QUESTIONS #34). */
  SVC_AI_INDEX_SWEEP: { dbRole: "svc_ai_index_sweep", tables: ["ai.retrieval_index"] },
  /** Finds tenants with consent records or subject status rows past the retention rules (#48, #57). */
  SVC_CONSENT_SWEEP: {
    dbRole: "svc_consent_sweep",
    tables: ["consent.record", "consent.subject_status"],
  },
  /** Finds accessibility SLA timers due, hand-offs pending and items to purge (IPB-06-62; #48). */
  SVC_FEEDBACK_SLA: { dbRole: "svc_feedback_sla", tables: ["feedback.item"] },
  /** Finds document requests past their SLA and acknowledgements to purge (IPB-08-17; #48). */
  SVC_TRUST_SWEEP: {
    dbRole: "svc_trust_sweep",
    tables: ["trust.acknowledgement", "trust.request"],
  },
  /** Finds due Vidhi schedules across tenants (IPB-03-64; PL4 plan §8.6). */
  SVC_VIDHI_SCHED: { dbRole: "svc_vidhi_sched", tables: ["vidhi.schedule"] },
  /**
   * Relays module outboxes to the QUEUE (owner answer #74(e), R1-D-01). Its tables are the
   * `<schema>.outbox` tables registered with `tenancy.register_outbox()` (the database grants are
   * the registry), so the list here is empty. It is the one reader that also writes: in a tenant
   * context it may mark that tenant's outbox rows dispatched (`<schema>.outbox.dispatch`, nothing
   * else), with the batch's ledger entry in the same transaction.
   */
  SVC_OUTBOX_RELAY: { dbRole: "svc_outbox_relay", tables: [] },
  /**
   * Lists the tenants for a product's scheduled per-tenant jobs (audit-chain verification, daily
   * anchors; PR-UDF-013, R1-D-12): `id` and `status` of `tenancy.tenant`, nothing else. Each job
   * then runs in each tenant's own context under its RLS.
   */
  SVC_TENANT_SWEEP: { dbRole: "svc_tenant_sweep", tables: ["tenancy.tenant"] },
} as const satisfies Record<string, { dbRole: string; tables: readonly string[] }>;
export type ServiceReaderRole = keyof typeof SERVICE_READER_ROLES;
/** The only writes `SVC_OUTBOX_RELAY` may make: marking one module outbox's rows dispatched. */
export const OUTBOX_DISPATCH_ACTION = /^[a-z][a-z0-9_]*\.outbox\.dispatch$/;
export const isServiceReaderRole = (r: string): r is ServiceReaderRole =>
  Object.prototype.hasOwnProperty.call(SERVICE_READER_ROLES, r);

/** Product-defined roles extend the floor with their own upper-case prefix (e.g. FBX_CREDIT_HEAD). */
export const PRODUCT_ROLE_REGEX = /^[A-Z]{2,4}_[A-Z][A-Z0-9_]*$/;

/**
 * A named tenant function a person holds in their own right (Finbyx PR-FBX-20, R1-D-39): assigned
 * by the tenant under maker-checker and added to the session's roles by `TenantFunctions`.
 */
export const FUNCTION_ROLE_REGEX = /^FN:[A-Z][A-Z0-9_]{1,31}$/;
/** The platform's three regulated functions; products add their own (`FN:PRINCIPAL_OFFICER`, …). */
export const PLATFORM_FUNCTIONS = ["FN:CRO", "FN:CCO", "FN:COMPLIANCE_OFFICER"] as const;
export const isFunctionRole = (r: string): boolean => FUNCTION_ROLE_REGEX.test(r);

export type Role =
  PlatformRole | TenantRole | `OPS_${string}` | `AGT_${string}` | `SVC_${string}` | (string & {});

export const RoleSchema = z
  .string()
  .refine(
    (r) =>
      (PLATFORM_ROLES as readonly string[]).includes(r) ||
      (TENANT_ROLES as readonly string[]).includes(r) ||
      OPS_ROLE_REGEX.test(r) ||
      AGENT_ROLE_REGEX.test(r) ||
      SERVICE_ROLE_REGEX.test(r) ||
      PRODUCT_ROLE_REGEX.test(r) ||
      FUNCTION_ROLE_REGEX.test(r),
    { message: "unknown role format" },
  );

export const isPlatformRole = (r: string): r is PlatformRole =>
  (PLATFORM_ROLES as readonly string[]).includes(r);
export const isTenantRole = (r: string): r is TenantRole =>
  (TENANT_ROLES as readonly string[]).includes(r);
export const isAgentRole = (r: string): boolean => AGENT_ROLE_REGEX.test(r);
export const isServiceRole = (r: string): boolean => SERVICE_ROLE_REGEX.test(r);
export const isOpsRole = (r: string): boolean => OPS_ROLE_REGEX.test(r);

/** Principal kinds (IPB-02 §02.2, §02.4.7.1 `actor_type`). */
/**
 * `external`: a named external grantee (statutory auditor, inspector) reading one tenant under one
 * active `tenancy.external_grant` (Finbyx PR-FBX-10 item 5; R1-D-29). It only reads, as the
 * SELECT-only `app_external` role, and every read is ledgered.
 */
export const PRINCIPAL_TYPES = ["user", "service", "agent", "breakglass", "external"] as const;
export const PrincipalType = z.enum(PRINCIPAL_TYPES);
export type PrincipalType = z.infer<typeof PrincipalType>;

/** Verbs an agent may never perform regardless of grants (IPB-02-10). */
/** The Vidhi agent role (IPB-03 §03.2): a maker only, never a checker, approver or signer. */
export const VIDHI_AGENT_ROLE = "AGT_VIDHI" as const;

export const AGENT_FORBIDDEN_VERBS = ["approve", "sign", "disburse", "delete", "grant"] as const;
export type AgentForbiddenVerb = (typeof AGENT_FORBIDDEN_VERBS)[number];

/** Roles that must use MFA (IPB-02-02 floor; tenants may add). */
export const MFA_REQUIRED_ROLE_FLOOR: readonly string[] = [
  ...PLATFORM_ROLES,
  "ORG_OWNER",
  "ORG_ADMIN",
  "ORG_CHECKER",
];
export const mfaRequired = (roles: readonly string[]): boolean =>
  roles.some((r) => MFA_REQUIRED_ROLE_FLOOR.includes(r) || isOpsRole(r));

/**
 * A product's MFA floor (LawDocsComply PR-LDC-55, Finbyx PR-FBX-12 item 2; R1-D-127, R1-D-135):
 * the platform floor plus the product's own roles, and the roles for which SMS does not count as
 * a second factor. Built only by `mfaFloor`, which can add roles and never remove one.
 */
export interface MfaFloor {
  readonly roles: readonly string[];
  readonly smsExcludedRoles: readonly string[];
}

/** The platform's floor, as `mfaRequired` applies it. */
export const PLATFORM_MFA_FLOOR: MfaFloor = Object.freeze({
  roles: Object.freeze([...MFA_REQUIRED_ROLE_FLOOR]),
  smsExcludedRoles: Object.freeze([]) as readonly string[],
});

/**
 * Tighten the floor: `roles` join the platform's (which always stay), and every role in
 * `smsExcludedRoles` must be on the resulting floor (or an OPS role). Refuses (`TypeError`) a
 * name that is not a role (`RoleSchema`), so a typo fails at boot instead of silently leaving a role unguarded.
 */
export function mfaFloor(
  o: { roles?: readonly string[]; smsExcludedRoles?: readonly string[] } = {},
): MfaFloor {
  const check = (r: unknown, what: string): string => {
    if (typeof r !== "string" || !RoleSchema.safeParse(r).success)
      throw new TypeError(`mfaFloor: ${what} ${JSON.stringify(r)} is not a role name`);
    return r;
  };
  const roles = [
    ...new Set([...MFA_REQUIRED_ROLE_FLOOR, ...(o.roles ?? []).map((r) => check(r, "role"))]),
  ];
  const sms = [...new Set((o.smsExcludedRoles ?? []).map((r) => check(r, "SMS-excluded role")))];
  for (const r of sms)
    if (!roles.includes(r) && !isOpsRole(r))
      throw new TypeError(`mfaFloor: SMS-excluded role ${r} is not on the floor; add it to roles`);
  return Object.freeze({ roles: Object.freeze(roles), smsExcludedRoles: Object.freeze(sms) });
}

/** Whether `roles` need MFA under `floor`; the platform floor applies whatever `floor` holds. */
export const mfaRequiredBy = (floor: MfaFloor, roles: readonly string[]): boolean =>
  mfaRequired(roles) || roles.some((r) => floor.roles.includes(r));
