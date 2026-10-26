// LD personas (IPB-11 §11.4.5 product table; role names per PL1-D-15).
import type { Persona } from "./types.js";

export const LD_PERSONAS: readonly Persona[] = [
  {
    key: "test.advocate",
    label: "Advocate",
    role: "ORG_MAKER",
    tenant: "demo",
    emailLocal: "test.advocate",
  },
  {
    key: "test.client",
    label: "Client (party portal)",
    role: "LD_CLIENT",
    tenant: "demo",
    emailLocal: "test.client",
  },
  {
    key: "test.party",
    label: "Counter-party (eSign)",
    role: "LD_PARTY",
    tenant: "demo",
    emailLocal: "test.party",
  },
];
