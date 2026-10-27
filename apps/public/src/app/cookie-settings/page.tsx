// The preference centre (IPB-04-75…84, `@IPB-04-AT-80`): current choices, every category with its
// cookies, and equal Accept all, Reject all and Save actions. Works without JavaScript.
import type { Metadata } from "next";
import { PreferenceCentre } from "@infrabyx/consent";
import { AppPage } from "../../render/page.tsx";
import { requestContext } from "../../server/request.ts";

export const metadata: Metadata = { title: "Cookie settings" };

export default async function CookieSettings() {
  const ctx = await requestContext();
  return (
    <AppPage title="Cookie settings" path="/cookie-settings">
      <PreferenceCentre state={{ ...ctx.consent, show: true }} texts={ctx.cmpTexts} />
    </AppPage>
  );
}
