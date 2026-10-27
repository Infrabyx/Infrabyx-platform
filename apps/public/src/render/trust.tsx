// The public Trust Centre (IPB-08-01, 06, 22…29; `@IPB-04-AT-72`, `@IPB-08-AT-04`): from the
// read-only mirror only. Certifications appear only when actually held; nothing gated is listed by
// name; a stale mirror shows its "as of" date instead of passing as current.
import { trustCentre } from "@infrabyx/trust";
import type { RequestContext } from "../server/request.ts";

export async function TrustCentreView({ ctx }: { ctx: RequestContext }) {
  const t = await trustCentre(ctx.site.mirror, {
    links: { vdp: "/security", dpaRequest: "/contact", requestAccess: "/contact" },
  });
  return (
    <>
      {t.asOf ? (
        <p className="ibx-trust__asof">
          {t.stale ? "Information as of " : "Updated "}
          <time dateTime={t.asOf}>{t.asOf.slice(0, 10)}</time>
          {t.stale ? ". We are refreshing it." : "."}
        </p>
      ) : null}
      <section aria-labelledby="trust-docs">
        <h2 id="trust-docs">Published documents</h2>
        {t.documents.length ? (
          <ul className="ibx-grid ibx-grid--2">
            {t.documents.map((d) => (
              <li key={d.vadId} className="ibx-card">
                <h3 className="ibx-card__title">{d.title}</h3>
                <p>{d.summary}</p>
                <p className="ibx-meta">
                  Published <time dateTime={d.validFrom}>{d.validFrom}</time>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No documents are published yet.</p>
        )}
      </section>
      {t.certifications.length ? (
        <section aria-labelledby="trust-held">
          <h2 id="trust-held">Held now</h2>
          <ul>
            {t.certifications.map((c) => (
              <li key={c.vadId}>
                {c.title}
                {c.validUntil ? `, valid until ${c.validUntil}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {t.planned.length ? (
        <section aria-labelledby="trust-planned">
          <h2 id="trust-planned">Planned</h2>
          <ul>
            {t.planned.map((p) => (
              <li key={p.name}>
                {p.name}: {p.status}, target {p.targetQuarter}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="trust-more">
        <h2 id="trust-more">More</h2>
        <ul>
          <li>
            <a href={t.links.vdp}>Report a security issue</a>
          </li>
          {t.gatedAvailable ? (
            <li>
              <a href={t.links.requestAccess}>Ask for documents shared under NDA</a> (
              {t.gatedAvailable} available to customers)
            </li>
          ) : null}
        </ul>
      </section>
    </>
  );
}
