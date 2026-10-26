// Common personas of IPB-11 §11.4.5, with the emails of the §11.4.6 template.
import type { Persona, ServiceAccount } from "./types.js";

export const SUPER_ADMIN_EMAIL = "rjnprajapati@gmail.com";

export const COMMON_PERSONAS: readonly Persona[] = [
  {
    key: "super_admin",
    label: "Super admin",
    role: "PLT_SUPER_ADMIN",
    tenant: "platform",
    email: SUPER_ADMIN_EMAIL,
    mfaAlways: true,
  },
  {
    key: "plt_security",
    label: "Platform security officer",
    role: "PLT_SECURITY_OFFICER",
    tenant: "platform",
    emailLocal: "test.security",
  },
  {
    key: "plt_release",
    label: "Platform release manager",
    role: "PLT_RELEASE_MANAGER",
    tenant: "platform",
    emailLocal: "test.release",
  },
  {
    key: "plt_content",
    label: "Platform content editor",
    role: "PLT_CONTENT_EDITOR",
    tenant: "platform",
    emailLocal: "test.content",
  },
  {
    key: "plt_legal",
    label: "Platform legal reviewer",
    role: "PLT_LEGAL_REVIEWER",
    tenant: "platform",
    emailLocal: "test.legal",
  },
  {
    key: "plt_dpo",
    label: "Platform DPO",
    role: "PLT_DPO",
    tenant: "platform",
    emailLocal: "test.dpo",
  },
  {
    key: "plt_grievance",
    label: "Platform grievance officer",
    role: "PLT_GRIEVANCE_OFFICER",
    tenant: "platform",
    emailLocal: "test.grievance.plt",
  },
  {
    key: "plt_auditor",
    label: "Platform auditor (RO)",
    role: "PLT_AUDITOR_RO",
    tenant: "platform",
    emailLocal: "test.auditor.plt",
  },
  {
    key: "test.admin",
    label: "Tenant owner",
    role: "ORG_OWNER",
    tenant: "demo",
    emailLocal: "test.admin",
  },
  {
    key: "test.maker",
    label: "Tenant maker",
    role: "ORG_MAKER",
    tenant: "demo",
    emailLocal: "test.maker",
  },
  {
    key: "test.checker",
    label: "Tenant checker",
    role: "ORG_CHECKER",
    tenant: "demo",
    emailLocal: "test.checker",
  },
  {
    key: "test.member",
    label: "Tenant member",
    role: "ORG_MEMBER",
    tenant: "demo",
    emailLocal: "test.member",
  },
  {
    key: "test.auditor",
    label: "Tenant auditor (RO)",
    role: "ORG_AUDITOR_RO",
    tenant: "demo",
    emailLocal: "test.auditor",
  },
  {
    key: "test.sandbox",
    label: "Sandbox owner",
    role: "ORG_OWNER",
    tenant: "sandbox",
    emailLocal: "test.sandbox",
  },
];

/** Agents and services: client credentials in the vault only, never passwords (IPB-11-39). */
export const COMMON_SERVICE_ACCOUNTS: readonly ServiceAccount[] = [
  { key: "agt-vidhi", label: "Vidhi agent", role: "AGT_VIDHI", clientSuffix: "agt-vidhi" },
  {
    key: "svc-billing",
    label: "OH billing link",
    role: "SVC_BILLING",
    clientSuffix: "svc-billing",
  },
];
