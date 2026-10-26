// FBX personas (IPB-11 §11.4.5 product table; role names per PL1-D-15).
import type { Persona } from "./types.js";

export const FBX_PERSONAS: readonly Persona[] = [
  {
    key: "test.credit_officer",
    label: "Credit officer",
    role: "ORG_MAKER",
    tenant: "demo",
    emailLocal: "test.credit_officer",
  },
  {
    key: "test.credit_approver",
    label: "Credit approver",
    role: "ORG_CHECKER",
    tenant: "demo",
    emailLocal: "test.credit_approver",
  },
  {
    key: "test.ops",
    label: "Operations",
    role: "ORG_MEMBER",
    tenant: "demo",
    emailLocal: "test.ops",
  },
  {
    key: "test.collections",
    label: "Collections",
    role: "ORG_MEMBER",
    tenant: "demo",
    emailLocal: "test.collections",
  },
  {
    key: "test.borrower",
    label: "Borrower (portal)",
    role: "FBX_BORROWER",
    tenant: "demo",
    emailLocal: "test.borrower",
  },
  {
    key: "test.co_lender",
    label: "Co-lender (partner read)",
    role: "FBX_PARTNER_RO",
    tenant: "demo",
    emailLocal: "test.co_lender",
  },
];
