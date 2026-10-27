// A simple app page (utility routes outside the CMS): breadcrumb, one h1, content.
import type { ReactNode } from "react";
import { Breadcrumb } from "@infrabyx/ui";

export function AppPage({
  title,
  path,
  children,
}: {
  title: string;
  path: string;
  children: ReactNode;
}) {
  return (
    <article className="ibx-page">
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: title, href: path },
        ]}
      />
      <h1>{title}</h1>
      {children}
    </article>
  );
}
