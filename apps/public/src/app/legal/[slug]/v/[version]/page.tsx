import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { keyOf, LegalView } from "../../../../../render/legal.tsx";
import { requestContext } from "../../../../../server/request.ts";

type Params = { params: Promise<{ slug: string; version: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const ctx = await requestContext();
  const { slug, version } = await params;
  const p = await ctx.site.policies.version(ctx.packId, keyOf(slug), version);
  return p
    ? { title: `${p.title} v${p.versionLabel}`, robots: { index: !p.noindex, follow: true } }
    : {};
}

export default async function LegalVersionPage({ params }: Params) {
  const ctx = await requestContext();
  const { slug, version } = await params;
  if (!/^\d+\.\d+$/.test(version)) notFound();
  const p = await ctx.site.policies.version(ctx.packId, keyOf(slug), version);
  if (!p) notFound();
  return <LegalView p={p} />;
}
