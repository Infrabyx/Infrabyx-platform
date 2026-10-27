import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { keyOf, LegalView } from "../../../render/legal.tsx";
import { requestContext } from "../../../server/request.ts";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const ctx = await requestContext();
  const p = await ctx.site.policies.current(ctx.packId, keyOf((await params).slug));
  return p
    ? { title: p.title, ...(p.noindex ? { robots: { index: false, follow: true } } : {}) }
    : {};
}

export default async function LegalPage({ params }: Params) {
  const ctx = await requestContext();
  const key = keyOf((await params).slug);
  const p = await ctx.site.policies.current(ctx.packId, key);
  if (!p) notFound();
  const upcoming = await ctx.site.policies.upcoming(ctx.packId, key);
  return <LegalView p={p} upcoming={upcoming} />;
}
