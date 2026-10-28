// The tenant export (PL6 plan §8.2 step 4; IPB-07-27): an owner exports directly, an admin's request
// waits for the owner. The worker builds the archive (the export map and the signed manifest,
// C-22); the download is a short-lived signed link, ledgered as a download.
import type { Metadata } from "next";
import { Button, ButtonLink, Notice } from "@infrabyx/ui";
import { api, hasSession } from "../../server/api.ts";
import { ProblemView } from "../../server/views.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Export" };

interface Job {
  id: string;
  state: "requested" | "running" | "completed" | "failed";
  archiveId: string | null;
  bytes: number | null;
  fileCount: number | null;
  manifestHash: string | null;
  errorCode: string | null;
}

const ID = /^[a-z]{2,6}_[0-9A-HJKMNP-TV-Z]{26}$/;

function JobView({ job }: { job: Job }) {
  if (job.state === "completed" && job.archiveId)
    return (
      <section aria-labelledby="ready-title">
        <h2 id="ready-title">The export is ready</h2>
        <dl className="ibx-web__facts">
          <dt>Files</dt>
          <dd>{job.fileCount ?? 0}</dd>
          <dt>Size</dt>
          <dd>{job.bytes ?? 0} bytes</dd>
          <dt>Manifest hash</dt>
          <dd data-testid="manifest-hash">{job.manifestHash}</dd>
        </dl>
        <p>
          <ButtonLink
            href={`/export/download?archive=${encodeURIComponent(job.archiveId)}`}
            variant="primary"
          >
            Download the archive
          </ButtonLink>
        </p>
      </section>
    );
  if (job.state === "failed")
    return (
      <Notice tone="danger" title="The export failed">
        <p>{job.errorCode ?? "Unknown error"}</p>
      </Notice>
    );
  return (
    <Notice tone="info" title="The export is running">
      <p>
        <a href={`/export?job=${encodeURIComponent(job.id)}`}>Check again</a>
      </p>
    </Notice>
  );
}

export default async function Export({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; approval?: string; error?: string }>;
}) {
  const q = await searchParams;
  const signedIn = await hasSession();
  const job = q.job && ID.test(q.job) ? await api<Job>(`/export/${q.job}`) : null;
  return (
    <article className="ibx-page">
      <h1>Export this tenant</h1>
      <p>
        The export holds this tenant&apos;s data under the published export map, with a signed
        manifest so you can check the archive is complete.
      </p>
      {q.error ? (
        <Notice tone="danger" title="The export could not start">
          <p>{q.error}</p>
        </Notice>
      ) : null}
      {q.approval ? (
        <Notice tone="info" title="Waiting for the owner">
          <p>Your request {q.approval} waits for the tenant owner to approve it.</p>
        </Notice>
      ) : null}
      {job ? job.ok ? <JobView job={job.body} /> : <ProblemView problem={job.problem} /> : null}
      {signedIn ? (
        <form method="post" action="/export/run">
          <Button type="submit" variant={job ? "secondary" : "primary"}>
            Export this tenant
          </Button>
        </form>
      ) : (
        <ProblemView problem={{ status: 401, title: "Sign in" }} />
      )}
    </article>
  );
}
