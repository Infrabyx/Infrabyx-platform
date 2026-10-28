// The assistant (PL6 plan §8.2 step 3): the person asks Vidhi for a summary of the greetings. The
// `hello.summarise` skill runs at the tenant's autonomy level L1 with one read tool; the post is an
// R2 approval the agent proposes and a human checker decides (IPB-03 makers only; PL6-D-09). The
// draft is AI output and labelled so (IPB-03-53, IPB-13-04).
import type { Metadata } from "next";
import { AiLabel, Button, Notice } from "@infrabyx/ui";
import { api, hasSession } from "../../server/api.ts";
import { ProblemView } from "../../server/views.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assistant" };

interface Approval {
  id: string;
  state: string;
  summary: string | null;
  createdAt: string;
}

const APPROVAL = /^apr_[0-9A-HJKMNP-TV-Z]{26}$/;

export default async function Assistant({
  searchParams,
}: {
  searchParams: Promise<{ approval?: string; error?: string }>;
}) {
  const q = await searchParams;
  const signedIn = await hasSession();
  const approval =
    q.approval && APPROVAL.test(q.approval)
      ? await api<Approval>(`/approvals/${q.approval}`)
      : null;
  return (
    <article className="ibx-page">
      <h1>Assistant</h1>
      <p>
        The assistant reads this tenant&apos;s greetings and drafts a summary. It cannot post
        anything: the post waits for a person with the checker role to approve it.
      </p>
      {q.error ? (
        <Notice tone="danger" title="The assistant could not run">
          <p>{q.error === "IPB-SEC-001" ? "Your role needs a second factor." : q.error}</p>
        </Notice>
      ) : null}
      {approval && approval.ok ? (
        <section aria-labelledby="draft-title">
          <h2 id="draft-title">Draft summary</h2>
          <p>
            <AiLabel />
          </p>
          <blockquote className="ibx-web__summary" data-testid="summary">
            {approval.body.summary ?? ""}
          </blockquote>
          {approval.body.state === "pending" ? (
            <Notice tone="info" title="Waiting for a checker">
              <p>
                Request {approval.body.id} is waiting for a person with the checker role. The
                assistant cannot approve it.
              </p>
            </Notice>
          ) : (
            <Notice tone="success" title={`The request is ${approval.body.state}`} />
          )}
        </section>
      ) : approval ? (
        <ProblemView problem={approval.problem} />
      ) : null}
      {signedIn ? (
        <form method="post" action="/assistant/run">
          <Button type="submit" variant="primary">
            Summarise the greetings
          </Button>
        </form>
      ) : (
        <ProblemView problem={{ status: 401, title: "Sign in" }} />
      )}
    </article>
  );
}
