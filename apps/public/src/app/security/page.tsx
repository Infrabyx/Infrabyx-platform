// The vulnerability disclosure page (IPB-02 VDP; RFC 9116 `security.txt` points here).
import type { Metadata } from "next";
import { AppPage } from "../../render/page.tsx";
import { requestContext } from "../../server/request.ts";

export const metadata: Metadata = { title: "Report a security issue" };

export default async function Security() {
  const ctx = await requestContext();
  const o = await ctx.site.policies.officers(ctx.packId);
  return (
    <AppPage title="Report a security issue" path="/security">
      <p>
        If you believe you have found a security issue in any group site or product, tell us so we
        can fix it. Please do not access other people's data, disrupt the service or share the issue
        before we have fixed it.
      </p>
      <p>
        Write to{" "}
        {o.dpo.email ? (
          <a href={`mailto:${o.dpo.email}`}>{o.dpo.email}</a>
        ) : (
          "the address in security.txt"
        )}
        . We acknowledge every report. The machine-readable contact is in{" "}
        <a href="/.well-known/security.txt">security.txt</a>.
      </p>
    </AppPage>
  );
}
