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
