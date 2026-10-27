// Every CMS route (PL5 plan §9.2): published content by path, redirects, and 404 for anything else,
// including the hidden Blog and Investors items (O-1, `@IPB-04-AT-40`). Templates that need data
// beyond their blocks (careers, group companies, trust, contact) add it here.
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { jobPostingLd, type PublishedContent } from "@infrabyx/cms";
import { Breadcrumb, Notice } from "@infrabyx/ui";
import { PageBlocks, Rich } from "../../render/blocks.tsx";
import { TrustCentreView } from "../../render/trust.tsx";
import { formStateFrom, formsFor } from "../../server/forms.ts";
import { requestContext, type RequestContext } from "../../server/request.ts";
import { listed } from "../../server/site.ts";

type Params = {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const pathOf = (p?: string[]) => `/${(p ?? []).map(encodeURIComponent).join("/")}`;

async function resolve(ctx: RequestContext, path: string): Promise<PublishedContent> {
  const r = await ctx.site.content.resolve(ctx.packId, "en-IN", path);
  if (r.kind === "redirect") (r.status === 301 ? permanentRedirect : redirect)(r.to);
  if (r.kind !== "content") notFound();
  return r.content;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const ctx = await requestContext();
  const r = await ctx.site.content.resolve(ctx.packId, "en-IN", pathOf((await params).path));
  if (r.kind !== "content") return {};
  const seo = r.content.seo as { title?: string; description?: string };
  const isHome = r.content.path === "/";
  return {
    ...(isHome ? {} : { title: seo.title ?? r.content.title }),
    ...(seo.description ? { description: seo.description } : {}),
    alternates: { canonical: r.content.path },
  };
}

function Crumbs({ c, parent }: { c: PublishedContent; parent?: { label: string; href: string } }) {
  if (c.path === "/") return null;
  return (
    <Breadcrumb
      items={[
        { label: "Home", href: "/" },
        ...(parent ? [parent] : []),
        { label: c.title, href: c.path },
      ]}
    />
  );
}

export default async function CmsPage({ params, searchParams }: Params) {
  const ctx = await requestContext();
  const path = pathOf((await params).path);
  const c = await resolve(ctx, path);
  const sp = await searchParams;
  const sent = typeof sp.sent === "string" ? sp.sent.slice(0, 60) : null;

  if (c.type === "group_company") {
    const b = c.body as {
      name: string;
      description: unknown;
      site_url?: string;
      legal_entity_name: string;
    };
    return (
      <article className="ibx-page">
        <Crumbs c={c} parent={{ label: "Group companies", href: "/group-companies" }} />
        <h1>{b.name}</h1>
        <Rich value={b.description} />
        <dl className="ibx-facts">
          <dt>Legal entity</dt>
          <dd>{b.legal_entity_name}</dd>
          {b.site_url ? (
            <>
              <dt>Website</dt>
              <dd>
                <a href={b.site_url} rel="noopener">
                  {new URL(b.site_url).host}
                </a>
              </dd>
            </>
          ) : null}
        </dl>
      </article>
    );
  }

  if (c.type === "job") {
    const b = c.body as {
      department: string;
      location: string;
      type: string;
      description: unknown;
      closes_at: string;
    };
    return (
      <article className="ibx-page">
        <Crumbs c={c} parent={{ label: "Careers", href: "/careers" }} />
        <h1>{c.title}</h1>
        <dl className="ibx-facts">
          <dt>Team</dt>
          <dd>{b.department}</dd>
          <dt>Location</dt>
          <dd>{b.location}</dd>
          <dt>Applications close</dt>
          <dd>
            <time dateTime={b.closes_at}>{b.closes_at.slice(0, 10)}</time>
          </dd>
        </dl>
        <Rich value={b.description} />
        <p>
          <a href="/careers#apply">Apply through the careers form</a>
        </p>
        <script
          type="application/ld+json"
          nonce={ctx.nonce}
          dangerouslySetInnerHTML={{
            // JSON-LD with `<` escaped, so the payload cannot close the element.
            __html: JSON.stringify(
              jobPostingLd({
                title: c.title,
                description: b.department,
                datePosted: c.publishedAt.slice(0, 10),
                validThrough: b.closes_at,
                employmentType: b.type,
                hiringOrganization: ctx.pack.body.legal_entity.name,
                location: b.location,
              }),
            ).replace(/</g, "\\u003c"),
          }}
        />
      </article>
    );
  }

  if (c.type !== "page") notFound();
  const body = c.body as { template: string; blocks: unknown };
  const forms = await formsFor(ctx);
  const formState = formStateFrom(sp);
  const hero =
    Array.isArray(body.blocks) && body.blocks.some((b) => (b as { type?: string }).type === "hero");
  return (
    <article className={`ibx-page ibx-page--${body.template}`}>
      <Crumbs c={c} />
      {hero ? null : <h1>{c.title}</h1>}
      {sent ? (
        <Notice tone="success" title="Thank you, your message was sent">
          <p>Your reference is {sent}. We reply by email.</p>
        </Notice>
      ) : null}
      <PageBlocks
        template={body.template}
        blocks={body.blocks}
        ctx={{ forms, ...(formState ? { formState } : {}) }}
      />
      <TemplateExtras template={body.template} ctx={ctx} />
    </article>
  );
}

async function TemplateExtras({ template, ctx }: { template: string; ctx: RequestContext }) {
  switch (template) {
    case "group_companies": {
      const companies = await listed(ctx.site, ctx.packId, "group_company");
      return (
        <ul className="ibx-grid ibx-grid--3">
          {companies.map((co) => (
            <li key={co.id} className="ibx-card">
              <h2 className="ibx-card__title">
                <a href={co.path}>{co.title}</a>
              </h2>
              <p>{(co.body as { legal_entity_name: string }).legal_entity_name}</p>
            </li>
          ))}
        </ul>
      );
    }
    case "careers": {
      const now = new Date().toISOString();
      const jobs = (await listed(ctx.site, ctx.packId, "job")).filter(
        (j) => (j.body as { closes_at: string }).closes_at > now,
      );
      return (
        <section aria-labelledby="open-roles">
          <h2 id="open-roles">Open roles</h2>
          {jobs.length ? (
            <ul>
              {jobs.map((j) => (
                <li key={j.id}>
                  <a href={j.path}>{j.title}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p>There are no open roles right now. You can still send a general application.</p>
          )}
        </section>
      );
    }
    case "trust":
      return <TrustCentreView ctx={ctx} />;
    case "contact": {
      const offices = await listed(ctx.site, ctx.packId, "office");
      const officers = await ctx.site.policies.officers(ctx.packId);
      return (
        <>
          <section aria-labelledby="offices">
            <h2 id="offices">Offices</h2>
            <ul className="ibx-grid ibx-grid--3">
              {offices.map((o) => {
                const b = o.body as {
                  label: string;
                  lines: string[];
                  city: string;
                  pin: string;
                  state: string;
                };
                return (
                  <li key={o.id} className="ibx-card">
                    <h3 className="ibx-card__title">{b.label}</h3>
                    <address>
                      {[...b.lines, `${b.city} ${b.pin}`, b.state].map((l) => (
                        <span key={l} className="ibx-line">
                          {l}
                        </span>
                      ))}
                    </address>
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-labelledby="officers">
            <h2 id="officers">Grievance Officer and Data Protection Officer</h2>
            <dl className="ibx-facts">
              <dt>Grievance Officer</dt>
              <dd>
                {officers.grievance.name}
                {officers.grievance.email ? (
                  <>
                    {", "}
                    <a href={`mailto:${officers.grievance.email}`}>{officers.grievance.email}</a>
                  </>
                ) : null}
              </dd>
              <dt>Data Protection Officer</dt>
              <dd>
                {officers.dpo.name}
                {officers.dpo.email ? (
                  <>
                    {", "}
                    <a href={`mailto:${officers.dpo.email}`}>{officers.dpo.email}</a>
                  </>
                ) : null}
              </dd>
            </dl>
          </section>
        </>
      );
    }
    default:
      return null;
  }
}
