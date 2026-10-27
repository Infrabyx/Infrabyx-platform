// The state every Studio page needs: the session (the proxy has already checked it may open the
// section; this checks again), the sections its menu shows, and the result of the last action
// (`?r=`).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeResult, STUDIO_SECTIONS, type StudioSection } from "@infrabyx/ui/studio";
import { mayOpen, openSections, SESSION_COOKIE, sessionFrom } from "./session.ts";
import type { RouteState } from "./screens.tsx";

export async function routeState(
  section: StudioSection,
  search: Record<string, string | string[] | undefined>,
): Promise<RouteState> {
  const session = await sessionFrom((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) redirect("/sign-in");
  if (!(await mayOpen(session, section))) redirect("/denied");
  const query = Object.fromEntries(
    Object.entries(search).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const r = decodeResult(query["r"]);
  return {
    ctx: session.ctx,
    sections: await openSections(
      session,
      STUDIO_SECTIONS.map((x) => x.key),
    ),
    flash: r?.flash ?? null,
    errors: r?.errors ?? [],
    reveal: r?.reveal,
    query,
  };
}
