// OH personas (IPB-11 §11.4.5 product table; role names per PL1-D-15).
import type { Persona } from "./types.js";

export const OH_PERSONAS: readonly Persona[] = [
  {
    key: "test.ops_admin",
    label: "Ops admin",
    role: "OPS_ADMIN",
    tenant: "demo",
    emailLocal: "test.ops_admin",
  },
  {
    key: "test.sales",
    label: "Sales",
    role: "OPS_SALES",
    tenant: "demo",
    emailLocal: "test.sales",
    productScope: ["LDC"],
  },
  {
    key: "test.support",
    label: "Support",
    role: "OPS_SUPPORT",
    tenant: "demo",
    emailLocal: "test.support",
    productScope: ["LD"],
  },
  {
    key: "test.finance",
    label: "Finance",
    role: "OPS_FINANCE",
    tenant: "demo",
    emailLocal: "test.finance",
  },
  { key: "test.hr", label: "HR", role: "OPS_HR", tenant: "demo", emailLocal: "test.hr" },
  {
    key: "test.marketing",
    label: "Marketing",
    role: "OPS_MARKETING",
    tenant: "demo",
    emailLocal: "test.marketing",
  },
];
