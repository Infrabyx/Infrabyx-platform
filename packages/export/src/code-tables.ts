// Code tables shipped in `00 Start Here/code-tables/` (Ecosystem §12.1: code plus label columns).
// A dataset column whose name has a code table gets a `<column>_label` column beside it.
export const CODE_TABLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  risk_class: {
    R0: "No approval needed",
    R1: "Confirmation by the maker",
    R2: "One checker",
    R3: "One checker, per-action human confirmation",
    R4: "Policy change: one checker and a delay",
    R5: "Destructive: two checkers and a delay",
  },
  actor_type: {
    user: "Person",
    service: "Platform service",
    agent: "AI agent (maker only)",
    breakglass: "Break-glass session",
  },
  decision: { approve: "Approved", reject: "Rejected" },
  residency: { IN: "India", "IN-ZR": "India, zone-redundant", GLOBAL: "Global (with a DPA)" },
  severity: { info: "Information", warning: "Warning", critical: "Critical" },
};

export const labelColumn = (column: string): string => `${column}_label`;
