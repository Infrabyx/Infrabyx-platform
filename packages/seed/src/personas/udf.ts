// UDF personas (IPB-11 §11.4.5 product table; role names per PL1-D-15).
import type { Persona } from "./types.js";

export const UDF_PERSONAS: readonly Persona[] = [
  {
    key: "test.borrower",
    label: "Borrower",
    role: "UDF_BORROWER",
    tenant: "demo",
    emailLocal: "test.borrower",
  },
  {
    key: "test.borrower2",
    label: "Borrower 2",
    role: "UDF_BORROWER",
    tenant: "demo",
    emailLocal: "test.borrower2",
  },
  {
    key: "test.lsp_ops",
    label: "LSP operations",
    role: "ORG_MEMBER",
    tenant: "demo",
    emailLocal: "test.lsp_ops",
  },
  {
    key: "test.grievance",
    label: "Grievance (ORG_MAKER)",
    role: "ORG_MAKER",
    tenant: "demo",
    emailLocal: "test.grievance",
  },
  {
    key: "test.re_partner",
    label: "RE partner (lender read)",
    role: "UDF_LENDER_RO",
    tenant: "demo",
    emailLocal: "test.re_partner",
  },
];
