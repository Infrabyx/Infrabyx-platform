// The platform's own leg of the seed persona roles cases (LDC-69, R1-D-325), on synthetic role
// names for two products.
import { describe, it } from "vitest";
import { seedPersonaRoleContractCases } from "./seed-persona-roles.js";

describe.each([
  [
    "LDC",
    {
      "test.compliance_head": ["LDC_COMPLIANCE_HEAD"],
      "test.maker": ["LDC_SYNTHETIC_MAKER", "LDC_SYNTHETIC_REVIEW"],
    },
  ],
  ["FBX", { "test.admin": ["FBX_SYNTHETIC_ADMIN"] }],
] as const)("seed persona roles: %s", (product, roles) => {
  for (const c of seedPersonaRoleContractCases(product, roles)) it(c.name, () => c.run());
});
