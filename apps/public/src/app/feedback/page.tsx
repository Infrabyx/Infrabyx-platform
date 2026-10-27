// The no-JavaScript feedback form (IPB-04-98, `@IPB-04-AT-90`): the same form as the dialog.
import type { Metadata } from "next";
import { FeedbackForm } from "@infrabyx/feedback";
import { AppPage } from "../../render/page.tsx";
import { formStateFrom } from "../../server/forms.ts";

export const metadata: Metadata = { title: "Feedback" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Feedback({ searchParams }: Props) {
  const sp = await searchParams;
  const state = formStateFrom(sp);
  const route =
    typeof sp.from === "string" && /^\/[a-z0-9/:_-]{0,200}$/.test(sp.from) ? sp.from : "/feedback";
  return (
    <AppPage title="Feedback" path="/feedback">
      <p>
        Tell us about a problem, an idea or something that worked well. Do not include personal
        details.
      </p>
      <FeedbackForm route={route} {...(state ? { errors: state.errors } : {})} />
    </AppPage>
  );
}
