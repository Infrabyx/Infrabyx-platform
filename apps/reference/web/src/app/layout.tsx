// The web app's shell (PL6 plan §8.1): one header with the product's navigation and, when signed in,
// sign-out; the page in `main`; a plain footer. The stylesheet comes from this origin only.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell, Button, Header } from "@infrabyx/ui";
import { hasSession } from "../server/api.ts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { template: "%s · Reference", default: "Reference" },
  robots: { index: false, follow: false },
};

const NAV = [
  { label: "Home", href: "/" },
  { label: "Welcome", href: "/pages/welcome" },
  { label: "Greetings", href: "/greetings" },
  { label: "Assistant", href: "/assistant" },
  { label: "Export", href: "/export" },
  { label: "Trust Centre", href: "/trust" },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const signedIn = await hasSession();
  return (
    <html lang="en-IN">
      <head>
        <link rel="stylesheet" href="/assets/web.css" />
      </head>
      <body>
        <AppShell
          header={
            <Header
              brand={{ name: "Reference", href: "/" }}
              nav={NAV}
              actions={
                signedIn ? (
                  <form method="post" action="/auth/logout" className="ibx-web__session">
                    <Button type="submit" variant="ghost">
                      Sign out
                    </Button>
                  </form>
                ) : null
              }
            />
          }
          footer={
            <footer className="ibx-web__footer">
              <p>The reference application of the Infrabyx platform. Synthetic data only.</p>
            </footer>
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
