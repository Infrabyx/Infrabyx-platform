// The root layout (PL5 plan §9.1–§9.2): one shell for every page, server-rendered, with the site
// stylesheet from this origin only (no font or script CDN) and `noindex` for an unmapped host.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { SiteShell, shellData } from "../render/shell.tsx";
import { requestContext } from "../server/request.ts";

/** Every page is rendered per request (host, consent cookie, CSP nonce). */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await requestContext();
  return {
    title: { template: `%s · ${ctx.pack.body.app_name}`, default: ctx.pack.body.app_name },
    metadataBase: new URL(ctx.site.env.APP_BASE_URL),
    icons: { icon: "/icon.svg" },
    manifest: "/site.webmanifest",
    ...(ctx.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const ctx = await requestContext();
  const path = (await headers()).get("x-path") ?? "/";
  const data = await shellData(ctx);
  return (
    <html lang="en-IN">
      <head>
        <link rel="stylesheet" href="/assets/site.css" />
      </head>
      <body>
        <SiteShell ctx={ctx} data={data} path={path}>
          {children}
        </SiteShell>
      </body>
    </html>
  );
}
