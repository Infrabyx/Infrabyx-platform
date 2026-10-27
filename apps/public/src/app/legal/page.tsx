// The policy index (IPB-05-02): every effective policy of the pack, with its version and date.
import type { Metadata } from "next";
import { Breadcrumb } from "@infrabyx/ui";
import { requestContext } from "../../server/request.ts";

export const metadata: Metadata = { title: "Policies" };

export default async function LegalIndex() {
  const ctx = await requestContext();
  const idx = await ctx.site.policies.index(ctx.packId, ctx.site.env.APP_BASE_URL);
  return (
    <article className="ibx-page">
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Policies", href: "/legal" },
        ]}
      />
      <h1>Policies</h1>
      <ul>
        {idx.policies.map((p) => (
          <li key={p.key}>
            <a href={new URL(p.url).pathname}>{p.title}</a>, version {p.version}, effective{" "}
            <time dateTime={p.effective_at}>{p.effective_at.slice(0, 10)}</time>
          </li>
        ))}
      </ul>
      <p>
        <a href="/legal/index.json">Machine-readable list of policies</a>
      </p>
    </article>
  );
}
