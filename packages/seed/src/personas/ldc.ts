// LDC personas (IPB-11 §11.4.5 product table; role names per PL1-D-15).
import type { Persona } from "./types.js";

export const LDC_PERSONAS: readonly Persona[] = [
  {
    key: "test.compliance_head",
    label: "Compliance head",
    role: "ORG_OWNER",
    tenant: "demo",
    emailLocal: "test.compliance_head",
  },
  {
    key: "test.control_owner",
    label: "Control owner",
    role: "ORG_MAKER",
    tenant: "demo",
    emailLocal: "test.control_owner",
  },
  {
    key: "test.internal_auditor",
    label: "Internal auditor",
    role: "ORG_AUDITOR_RO",
    tenant: "demo",
    emailLocal: "test.internal_auditor",
  },
  {
    key: "test.board_member",
    label: "Board member (board pack, read-only)",
    role: "LDC_BOARD_RO",
    tenant: "demo",
    emailLocal: "test.board_member",
  },
];
