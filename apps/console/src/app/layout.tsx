// The console shell (PL5 plan §9.6): one header with the signed-in persona and sign-out, the
// Studio content in `main`, a plain footer; the stylesheet from this origin only; never indexed.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AppShell, Button, Header } from "@infrabyx/ui";
import { SESSION_COOKIE, sessionFrom } from "../server/session.ts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { template: "%s · Studio", default: "Studio" },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await sessionFrom((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <html lang="en-IN">
      <head>
        <link rel="stylesheet" href="/assets/console.css" />
      </head>
      <body>
        <AppShell
          header={
            <Header
              brand={{ name: "Studio", href: "/studio/approvals" }}
              nav={[]}
              actions={
                session ? (
                  <form method="post" action="/api/sign-out" className="ibx-console__session">
                    <span>Signed in as {session.label}</span>{" "}
                    <Button type="submit" variant="ghost">
                      Sign out
                    </Button>
                  </form>
                ) : null
              }
            />
          }
          footer={
            <footer className="ibx-console__footer">
              <p>Infrabyx Studio. Changes are recorded in the audit ledger.</p>
            </footer>
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
