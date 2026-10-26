// EQ personas (IPB-11 §11.4.5 product table; role names per PL1-D-15).
import type { Persona } from "./types.js";

export const EQ_PERSONAS: readonly Persona[] = [
  {
    key: "test.neutral",
    label: "Neutral (mediator/arbitrator)",
    role: "EQ_NEUTRAL",
    tenant: "demo",
    emailLocal: "test.neutral",
  },
  {
    key: "test.party",
    label: "Claimant",
    role: "EQ_PARTY",
    tenant: "demo",
    emailLocal: "test.party",
  },
  {
    key: "test.party2",
    label: "Respondent",
    role: "EQ_PARTY",
    tenant: "demo",
    emailLocal: "test.party2",
  },
  {
    key: "test.case_manager",
    label: "Case manager",
    role: "ORG_MAKER",
    tenant: "demo",
    emailLocal: "test.case_manager",
  },
  {
    key: "test.institution_admin",
    label: "Institution admin",
    role: "ORG_OWNER",
    tenant: "demo",
    emailLocal: "test.institution_admin",
  },
];
