// The grievance page (IPB-05 template 6; owner rule O-4): the Grievance Officer from the policy
// set, how to complain, and the published grievance policy.
import type { Metadata } from "next";
import { AppPage } from "../../render/page.tsx";
import { requestContext } from "../../server/request.ts";

export const metadata: Metadata = { title: "Grievances" };

export default async function Grievance() {
  const ctx = await requestContext();
  const o = await ctx.site.policies.officers(ctx.packId);
  return (
    <AppPage title="Grievances" path="/grievance">
      <p>
        If you are unhappy with our services or with how we handle your data, write to our Grievance
        Officer.
      </p>
      <dl className="ibx-facts">
        <dt>Grievance Officer</dt>
        <dd>{o.grievance.name}</dd>
        {o.grievance.email ? (
          <>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${o.grievance.email}`}>{o.grievance.email}</a>
            </dd>
          </>
        ) : null}
        {o.grievance.address ? (
          <>
            <dt>Address</dt>
            <dd>{o.grievance.address}</dd>
          </>
        ) : null}
      </dl>
      <p>
        We acknowledge every complaint with a reference number. The{" "}
        <a href="/legal/grievance">grievance policy</a> explains the timelines and how to escalate.
      </p>
    </AppPage>
  );
}
