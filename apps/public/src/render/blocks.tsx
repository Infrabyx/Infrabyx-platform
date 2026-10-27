// Renders a CMS page body (PL5 plan §5.3, §9.2): blocks in their template's slot order, each with
// `@infrabyx/ui` components. Rich text goes through the CMS's `toHtml`, which sanitises again and
// escapes every text node, so no stored string can become markup (IPB-04-15). No inline styles.
import type { ReactNode } from "react";
import { TEMPLATES, parseBlocks, toHtml, type Block } from "@infrabyx/cms";
import { ButtonLink, ClickToLoad, DataTable } from "@infrabyx/ui";
import { FormBlock } from "./form.tsx";

export interface RenderContext {
  /** Published forms by id, for `form` blocks. */
  forms: ReadonlyMap<string, FormDefinition>;
  /** Field errors and values when a form post is re-rendered. */
  formState?: { formId: string; errors: { fieldId: string; message: string }[] };
  /** Published FAQ items by id, for `faq_accordion` blocks that reference them. */
  faqs?: ReadonlyMap<string, { question: string; answer: unknown }>;
}

export interface FormDefinition {
  id: string;
  title: string;
  body: {
    fields: {
      name: string;
      label: string;
      kind: string;
      required?: boolean;
      personal?: boolean;
      autocomplete?: string;
      options?: string[];
    }[];
    destination: string;
  };
  consentText: string;
}

/** Rich text as HTML; the CMS escaped every text node. */
export function Rich({ value, className }: { value: unknown; className?: string }) {
  return (
    <div className={className ?? "ibx-prose"} dangerouslySetInnerHTML={{ __html: toHtml(value) }} />
  );
}

function BlockView({ b, ctx, level }: { b: Block; ctx: RenderContext; level: 2 | 3 }): ReactNode {
  const H = level === 2 ? "h2" : "h3";
  switch (b.type) {
    case "hero":
      return (
        <section className="ibx-hero" aria-labelledby="hero-title">
          {b.eyebrow ? <p className="ibx-hero__eyebrow">{b.eyebrow}</p> : null}
          <h1 id="hero-title" className="ibx-hero__title">
            {b.heading}
          </h1>
          {b.sub ? <p className="ibx-hero__sub">{b.sub}</p> : null}
          {b.primary_cta || b.secondary_cta ? (
            <p className="ibx-hero__actions">
              {b.primary_cta ? (
                <ButtonLink href={b.primary_cta.href}>{b.primary_cta.label}</ButtonLink>
              ) : null}{" "}
              {b.secondary_cta ? (
                <ButtonLink href={b.secondary_cta.href} variant="secondary">
                  {b.secondary_cta.label}
                </ButtonLink>
              ) : null}
            </p>
          ) : null}
        </section>
      );
    case "feature_grid":
      return (
        <ul className={`ibx-grid ibx-grid--${b.columns}`}>
          {b.items.map((i) => (
            <li key={i.title} className="ibx-card">
              <H className="ibx-card__title">{i.link ? <a href={i.link}>{i.title}</a> : i.title}</H>
              <p>{i.text}</p>
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="ibx-steps">
          {b.items.map((i) => (
            <li key={i.title}>
              <H className="ibx-steps__title">{i.title}</H>
              <p>{i.text}</p>
            </li>
          ))}
        </ol>
      );
    case "rich_text":
      return <Rich value={b.content} />;
    case "cta":
      return (
        <section className={`ibx-cta ibx-cta--${b.variant}`}>
          <H>{b.heading}</H>
          {b.text ? <p>{b.text}</p> : null}
          <p>
            <ButtonLink href={b.button.href} variant={b.variant}>
              {b.button.label}
            </ButtonLink>
          </p>
        </section>
      );
    case "faq_accordion": {
      const items = [
        ...b.items,
        ...b.faq_ids.flatMap((id) => (ctx.faqs?.get(id) ? [ctx.faqs.get(id)!] : [])),
      ];
      return (
        <section className="ibx-faq" aria-label="Frequently asked questions">
          <H>Frequently asked questions</H>
          {items.map((i) => (
            <details key={i.question} className="ibx-faq__item">
              <summary>{i.question}</summary>
              <Rich value={i.answer} />
            </details>
          ))}
        </section>
      );
    }
    case "timeline":
      return (
        <ol className="ibx-timeline">
          {b.items.map((i) => (
            <li key={`${i.date}-${i.title}`}>
              <time dateTime={i.date}>{i.date}</time>
              <H className="ibx-timeline__title">{i.title}</H>
              {i.text ? <p>{i.text}</p> : null}
            </li>
          ))}
        </ol>
      );
    case "form": {
      const f = ctx.forms.get(b.form_id);
      return f ? (
        <FormBlock
          form={f}
          errors={ctx.formState?.formId === f.id ? ctx.formState.errors : []}
          headingLevel={level}
        />
      ) : null;
    }
    case "comparison_table":
      return (
        <DataTable
          caption={`Comparison as of ${b.as_of}`}
          columns={b.columns.map((c, i) => ({ key: String(i), header: c }))}
          rows={b.rows.map((r) => Object.fromEntries(r.map((v, i) => [String(i), v])))}
        />
      );
    case "embed": {
      const provider = b.provider as "youtube" | "vimeo";
      return (
        <ClickToLoad
          id={`embed-${b.key ?? b.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
          provider={provider}
          providerName={provider === "youtube" ? "YouTube" : "Vimeo"}
          videoId={new URL(b.url).pathname.split("/").pop() ?? ""}
          title={b.title}
          category={b.consent_category === "marketing" ? "marketing" : "functional"}
        />
      );
    }
    default:
      // stats, logo_wall, testimonial, pricing, media and team blocks are not on the group site
      // (O-5); a product that turns them on renders them here.
      return null;
  }
}

/** Blocks in the template's slot order; blocks without a known slot follow in their own order. */
export function PageBlocks({
  template,
  blocks,
  ctx,
}: {
  template: string;
  blocks: unknown;
  ctx: RenderContext;
}) {
  const parsed = parseBlocks(blocks).blocks;
  const order = (TEMPLATES[template] ?? []).map((s) => s.name);
  const rank = (b: Block) => {
    const i = b.slot ? order.indexOf(b.slot) : -1;
    return i < 0 ? order.length : i;
  };
  const sorted = [...parsed].sort((a, b) => rank(a) - rank(b));
  return (
    <>
      {sorted.map((b, i) => (
        <BlockView key={`${b.type}-${i}`} b={b} ctx={ctx} level={2} />
      ))}
    </>
  );
}
