// Who may open each Studio section (PL5 plan §9.6). The console asks the AUTHZ port; this file is
// the fixture adapter and the fixture personas of the reference app, used only where fixtures run
// (`consoleEnv`). A product wires its own AUTHZ adapter (Cerbos or OpenFGA from
// `@infrabyx/connectors/authz`) with the same resource kind and action, and its own sign-in.
// Deny by default: an unknown section, an unknown role or any other action is refused.
import type {
  AuthzDecision,
  AuthzPort,
  AuthzPrincipal,
  AuthzResource,
  PortHealth,
  ResourcePlan,
} from "@infrabyx/contracts/ports";
import type { StudioSection } from "@infrabyx/ui/studio";

export const SECTION_RESOURCE = "studio_section";
export const OPEN = "open";

const CONTENT = ["PLT_CONTENT_EDITOR", "PLT_LEGAL_REVIEWER", "PLT_SUPER_ADMIN"];

/** The roles that open each section (the reference policy; the services check every action). */
export const SECTION_ROLES: Readonly<Record<StudioSection, readonly string[]>> = {
  approvals: [...CONTENT, "PLT_DPO", "PLT_ACCESSIBILITY_LEAD"],
  brand: CONTENT,
  pricing: CONTENT,
  pages: CONTENT,
  menus: CONTENT,
  footer: CONTENT,
  policies: ["PLT_LEGAL_REVIEWER", "PLT_DPO", "PLT_SUPER_ADMIN"],
  redirects: CONTENT,
  media: CONTENT,
  claims: CONTENT,
  resources: CONTENT,
  forms: CONTENT,
  consent: ["PLT_DPO", "PLT_LEGAL_REVIEWER"],
  feedback: ["PLT_SUPER_ADMIN", "PLT_ACCESSIBILITY_LEAD"],
  trust: [...CONTENT, "PLT_DPO", "PLT_ACCESSIBILITY_LEAD"],
  previews: CONTENT,
};

const allowed = (principal: AuthzPrincipal, resource: AuthzResource, action: string) =>
  resource.kind === SECTION_RESOURCE &&
  action === OPEN &&
  (SECTION_ROLES[resource.id as StudioSection] ?? []).some((r) => principal.roles.includes(r));

/** The reference app's AUTHZ adapter: section access by role, nothing else allowed. */
export class FixtureStudioAuthz implements AuthzPort {
  readonly descriptor = {
    port: "AUTHZ",
    adapter: "fixture_studio_roles",
    residency: "IN" as const,
    maxDataClass: "INTERNAL" as const,
  };
  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }
  async check(p: AuthzPrincipal, r: AuthzResource, action: string): Promise<AuthzDecision> {
    return { allowed: allowed(p, r, action), policy: "fixture_studio_roles" };
  }
  async checkBatch(
    p: AuthzPrincipal,
    items: ReadonlyArray<{ resource: AuthzResource; actions: readonly string[] }>,
  ) {
    return items.map((i) => ({
      resourceId: i.resource.id,
      decisions: Object.fromEntries(
        i.actions.map((a) => [a, { allowed: allowed(p, i.resource, a) }]),
      ) as Record<string, AuthzDecision>,
    }));
  }
  async planResources(): Promise<ResourcePlan> {
    return { kind: "always_denied" };
  }
  async loadPolicies(): Promise<void> {}
  async explain(d: AuthzDecision): Promise<string> {
    return d.allowed ? "role opens the section" : "no role opens the section";
  }
}

/** Fixture personas for the sign-in page (synthetic principals; fixture environments only). */
export const PERSONAS = {
  editor: { label: "Content editor", roles: ["PLT_CONTENT_EDITOR"] },
  checker: { label: "Second content editor (checker)", roles: ["PLT_CONTENT_EDITOR"] },
  legal: { label: "Legal reviewer", roles: ["PLT_LEGAL_REVIEWER"] },
  dpo: { label: "Data Protection Officer", roles: ["PLT_DPO"] },
  admin: { label: "Super admin", roles: ["PLT_SUPER_ADMIN"] },
  a11y: { label: "Accessibility Lead", roles: ["PLT_ACCESSIBILITY_LEAD"] },
} as const satisfies Record<string, { label: string; roles: readonly string[] }>;
export type Persona = keyof typeof PERSONAS;
export const isPersona = (v: unknown): v is Persona =>
  typeof v === "string" && Object.hasOwn(PERSONAS, v);
