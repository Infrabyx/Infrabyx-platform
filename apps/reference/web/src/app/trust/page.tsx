// The Trust Centre (PL6 plan §8.2 step 5; IPB-08 §08.3.3): the vendor-assurance documents mirrored
// from OH, built from the mirror only. Gated documents are counted, never shown.
import type { Metadata } from "next";
import { Notice } from "@infrabyx/ui";
import { api } from "../../server/api.ts";
import { ProblemView } from "../../server/views.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trust Centre" };

interface Centre {
  documents: Array<{
    vadId: string;
    title: string;
    category: string;
    summary: string;
    validFrom: string;
    sha256: string;
  }>;
  gatedAvailable: number;
  asOf: string | null;
  stale: boolean;
}

const CATEGORY: Record<string, string> = {
  SUBPROCESSOR_LIST: "Sub-processors",
  ACCESSIBILITY_STATEMENT: "Accessibility",
  POLICY: "Policy",
};

export default async function Trust() {
  const r = await api<Centre>("/trust");
  return (
    <article className="ibx-page">
      <h1>Trust Centre</h1>
      {!r.ok ? (
        <ProblemView problem={r.problem} />
      ) : (
        <>
          {r.body.stale ? (
            <Notice tone="warning" title="These documents may be out of date">
              <p>Last confirmed {r.body.asOf ?? "never"}.</p>
            </Notice>
          ) : null}
          {r.body.documents.length ? (
            r.body.documents.map((d) => (
              <section key={d.vadId} aria-labelledby={`doc-${d.vadId}`}>
                <h2 id={`doc-${d.vadId}`}>{d.title}</h2>
                <p>{d.summary}</p>
                <dl className="ibx-web__facts">
                  <dt>Kind</dt>
                  <dd>{CATEGORY[d.category] ?? d.category}</dd>
                  <dt>Valid from</dt>
                  <dd>{d.validFrom}</dd>
                  <dt>SHA-256</dt>
                  <dd>{d.sha256}</dd>
                </dl>
              </section>
            ))
          ) : (
            <p>No documents are published yet.</p>
          )}
          {r.body.gatedAvailable ? (
            <p>
              {r.body.gatedAvailable} more document{r.body.gatedAvailable === 1 ? "" : "s"} can be
              shared under a non-disclosure agreement.
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}
