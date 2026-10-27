// A policy page (IPB-05-02, 04, 09, 11; `@IPB-05-AT-04`): server-rendered with stable clause
// anchors, the version and dates, "what changed", the archive of earlier versions, and the
// placeholder banner for seeded policies (never in force, `noindex`).
import type { PublicPolicy } from "@infrabyx/cms";
import { Breadcrumb, Notice } from "@infrabyx/ui";

export const slugOf = (key: string) => key.replace(/_/g, "-");
export const keyOf = (slug: string) => slug.replace(/-/g, "_");

export function LegalView({
  p,
  upcoming,
}: {
  p: PublicPolicy;
  upcoming?: {
    versionLabel: string;
    summaryOfChanges: string;
    effectiveFrom: string | null;
  } | null;
}) {
  const base = `/legal/${slugOf(p.key)}`;
  return (
    <article className="ibx-page ibx-legal">
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Policies", href: "/legal" },
          { label: p.title, href: base },
        ]}
      />
      {/* The rendered policy starts with its own h1; a page has one. */}
      {p.html.includes("<h1") ? null : <h1>{p.title}</h1>}
      {p.placeholder ? (
        <Notice tone="warning" title="Placeholder — not legal advice, not in force">
          <p>
            This text is a template for development and testing. Counsel writes the legal wording.
          </p>
        </Notice>
      ) : null}
      {p.supersededBanner ? (
        <Notice tone="info" title={p.supersededBanner}>
          <p>
            <a href={base}>Read the current version</a>
          </p>
        </Notice>
      ) : null}
      {upcoming ? (
        <Notice tone="info" title={`Version ${upcoming.versionLabel} is coming`}>
          <p>{upcoming.summaryOfChanges}</p>
          {upcoming.effectiveFrom ? (
            <p>
              It takes effect on{" "}
              <time dateTime={upcoming.effectiveFrom}>{upcoming.effectiveFrom.slice(0, 10)}</time>.
            </p>
          ) : null}
        </Notice>
      ) : null}
      <dl className="ibx-facts">
        <dt>Version</dt>
        <dd>{p.versionLabel}</dd>
        <dt>Effective</dt>
        <dd>
          <time dateTime={p.effectiveAt}>{p.effectiveAt.slice(0, 10)}</time>
        </dd>
        <dt>Last reviewed</dt>
        <dd>
          <time dateTime={p.lastReviewed}>{p.lastReviewed.slice(0, 10)}</time>
        </dd>
      </dl>
      <section aria-labelledby="what-changed">
        <h2 id="what-changed">What changed</h2>
        <p>{p.summaryOfChanges}</p>
      </section>
      <div className="ibx-prose" dangerouslySetInnerHTML={{ __html: p.html }} />
      {p.versions.length > 1 ? (
        <section aria-labelledby="versions">
          <h2 id="versions">Earlier versions</h2>
          <ul>
            {p.versions.map((v) => (
              <li key={v.versionLabel}>
                <a href={`${base}/v/${v.versionLabel}`}>Version {v.versionLabel}</a>, effective{" "}
                <time dateTime={v.effectiveAt}>{v.effectiveAt.slice(0, 10)}</time>
                {v.state === "effective" ? " (current)" : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
