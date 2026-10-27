// The status of one feedback item through its private link (`?key=`; only the key's hash is stored).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import { FeedbackStatusView } from "@infrabyx/feedback";
import { AppPage } from "../../../../render/page.tsx";
import { requestContext } from "../../../../server/request.ts";

export const metadata: Metadata = {
  title: "Feedback status",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FeedbackStatus({ params, searchParams }: Props) {
  const ctx = await requestContext();
  const { id } = await params;
  const key = (await searchParams).key;
  if (typeof key !== "string") notFound();
  const view = await ctx.site.feedback.viewByLink(PLATFORM_TENANT_ID, id, key).catch(() => null);
  if (!view) notFound();
  return (
    <AppPage title="Feedback status" path={`/feedback/status/${id}`}>
      <p>Thank you. Keep this page's address to check the status later.</p>
      <FeedbackStatusView view={view} />
    </AppPage>
  );
}
