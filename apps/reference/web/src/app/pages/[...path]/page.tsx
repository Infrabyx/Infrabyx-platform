// A published CMS page of the product's default brand pack (`cms` through the API's `pages/` route).
// The CMS escaped every text node when it rendered the rich text (`toHtml`).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { toHtml } from "@infrabyx/cms";
import { api } from "../../../server/api.ts";
import { ProblemView } from "../../../server/views.tsx";

export const dynamic = "force-dynamic";

interface Page {
  title: string;
  lang: string;
  body: { blocks?: Array<{ type: string; content?: unknown }> };
}

const SEGMENT = /^[a-z0-9-]{1,80}$/;

async function load(path: string[]) {
  if (!path.every((p) => SEGMENT.test(p))) return null;
  return api<Page>(`/pages/en-IN/${path.join("/")}`);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ path: string[] }>;
}): Promise<Metadata> {
  const r = await load((await params).path);
  return { title: r?.ok ? r.body.title : "Page" };
}

export default async function CmsPage({ params }: { params: Promise<{ path: string[] }> }) {
  const r = await load((await params).path);
  if (!r || (!r.ok && r.problem.status === 404)) notFound();
  if (!r.ok)
    return (
      <article className="ibx-page">
        <h1>Page</h1>
        <ProblemView problem={r.problem} />
      </article>
    );
  return (
    <article className="ibx-page" lang={r.body.lang}>
      <h1>{r.body.title}</h1>
      {(r.body.body.blocks ?? [])
        .filter((b) => b.type === "rich_text")
        .map((b, i) => (
          <div
            key={i}
            className="ibx-prose"
            dangerouslySetInnerHTML={{ __html: toHtml(b.content) }}
          />
        ))}
    </article>
  );
}
