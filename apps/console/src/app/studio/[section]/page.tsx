// `/studio/<section>`: the section's list screen.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { STUDIO_SECTIONS } from "@infrabyx/ui/studio";
import { getConsole } from "../../../server/console.ts";
import { routeState } from "../../../server/route-state.ts";
import { isSection, listScreen } from "../../../server/screens.tsx";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  return { title: STUDIO_SECTIONS.find((s) => s.key === section)?.label ?? "Studio" };
}

export default async function SectionPage({ params, searchParams }: Props) {
  const { section } = await params;
  if (!isSection(section)) notFound();
  const state = await routeState(section, await searchParams);
  return listScreen(await getConsole(), section, state);
}
