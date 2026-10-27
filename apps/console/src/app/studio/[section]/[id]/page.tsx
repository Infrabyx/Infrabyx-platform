// `/studio/<section>/<id>`: one item's editor (content, brand pack, policy version).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { STUDIO_SECTIONS } from "@infrabyx/ui/studio";
import { getConsole } from "../../../../server/console.ts";
import { routeState } from "../../../../server/route-state.ts";
import { editScreen, isSection } from "../../../../server/screens.tsx";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ section: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  return {
    title: `Edit · ${STUDIO_SECTIONS.find((s) => s.key === section)?.label ?? "Studio"}`,
  };
}

export default async function EditPage({ params, searchParams }: Props) {
  const { section, id } = await params;
  if (!isSection(section) || !/^[a-z]{2,4}_[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) notFound();
  const state = await routeState(section, await searchParams);
  const screen = await editScreen(await getConsole(), section, id, state);
  if (!screen) notFound();
  return screen;
}
