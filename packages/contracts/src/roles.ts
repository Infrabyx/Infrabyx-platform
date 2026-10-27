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
] as const;

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
  /** Finds tenants with consent records past the retention rule (OWNER-QUESTIONS #48). */
  SVC_CONSENT_SWEEP: { dbRole: "svc_consent_sweep", tables: ["consent.record"] },
  /** Finds accessibility SLA timers due, hand-offs pending and items to purge (IPB-06-62; #48). */
  SVC_FEEDBACK_SLA: { dbRole: "svc_feedback_sla", tables: ["feedback.item"] },
  /** Finds document requests past their SLA and acknowledgements to purge (IPB-08-17; #48). */
  SVC_TRUST_SWEEP: {
    dbRole: "svc_trust_sweep",
    tables: ["trust.acknowledgement", "trust.request"],
  },
  /** Finds due Vidhi schedules across tenants (IPB-03-64; PL4 plan §8.6). */
  SVC_VIDHI_SCHED: { dbRole: "svc_vidhi_sched", tables: ["vidhi.schedule"] },
} as const satisfies Record<string, { dbRole: string; tables: readonly string[] }>;
export type ServiceReaderRole = keyof typeof SERVICE_READER_ROLES;
export const isServiceReaderRole = (r: string): r is ServiceReaderRole =>
  Object.prototype.hasOwnProperty.call(SERVICE_READER_ROLES, r);

/** Product-defined roles extend the floor with their own upper-case prefix (e.g. FBX_CREDIT_HEAD). */
export const PRODUCT_ROLE_REGEX = /^[A-Z]{2,4}_[A-Z][A-Z0-9_]*$/;

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
      PRODUCT_ROLE_REGEX.test(r),
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
export const PRINCIPAL_TYPES = ["user", "service", "agent", "breakglass"] as const;
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
