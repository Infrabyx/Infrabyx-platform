// Shown with status 403 when the AUTHZ port does not open a section for the person.
import type { Metadata } from "next";

export const metadata: Metadata = { title: "No access" };

export default function Denied() {
  return (
    <article className="ibx-page">
      <h1>You cannot open this section</h1>
      <p>
        Your role does not include this part of Studio.{" "}
        <a href="/studio/approvals">Go to Approvals</a> or ask an administrator for access.
      </p>
    </article>
  );
}
