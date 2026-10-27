// Who is signed in (PL5 plan §9.6). The reference console signs in a fixture persona held in an
// HttpOnly cookie, and only where fixtures run; a product replaces this with its IDENTITY sign-in
// and builds the same platform `KernelContext` from the verified token.
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { StudioSection } from "@infrabyx/ui/studio";
import { OPEN, PERSONAS, SECTION_RESOURCE, isPersona, type Persona } from "./authz.ts";
import { getConsole } from "./console.ts";

export const SESSION_COOKIE = "ibx_console_persona";

export interface Session {
  persona: Persona;
  label: string;
  ctx: KernelContext;
}

/** The session from the cookie value, or null (no fixtures, no cookie, unknown persona). */
export async function sessionFrom(cookie: string | undefined): Promise<Session | null> {
  const c = await getConsole();
  if (!c.env.APP_FIXTURE_ADAPTERS || !isPersona(cookie)) return null;
  const p = PERSONAS[cookie];
  return {
    persona: cookie,
    label: p.label,
    ctx: {
      tenantId: PLATFORM_TENANT_ID,
      scope: "platform",
      principal: { id: `usr_console_${cookie}`, type: "user", roles: [...p.roles] },
    },
  };
}

/** Whether the AUTHZ port lets the session open a section. */
export async function mayOpen(s: Session, section: StudioSection): Promise<boolean> {
  const c = await getConsole();
  const d = await c.authz.check(
    { id: s.ctx.principal.id, roles: s.ctx.principal.roles },
    { kind: SECTION_RESOURCE, id: section },
    OPEN,
  );
  return d.allowed;
}

/** The sections the session may open, in menu order. */
export async function openSections(s: Session, all: readonly StudioSection[]) {
  const ok = await Promise.all(all.map((x) => mayOpen(s, x)));
  return all.filter((_, i) => ok[i]);
}

export const sessionCookie = (persona: Persona | null, secure: boolean) =>
  `${SESSION_COOKIE}=${persona ?? ""}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}${persona ? "" : "; Max-Age=0"}`;
