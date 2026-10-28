// Home: who is signed in (the API's verified claims), and the gate journey's steps (PL6 plan §8.2).
import type { Metadata } from "next";
import { ButtonLink } from "@infrabyx/ui";
import { api, hasSession } from "../server/api.ts";
import { ProblemView } from "../server/views.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Home" };

interface Me {
  sub: string;
  tenantId: string;
  roles: string[];
  mfa: boolean;
}

const STEPS = [
  {
    href: "/pages/welcome",
    label: "Read the welcome page",
    note: "Published content from the CMS.",
  },
  { href: "/greetings", label: "See the greetings", note: "The example module of the template." },
  {
    href: "/assistant",
    label: "Ask the assistant for a summary",
    note: "The assistant drafts; a checker decides.",
  },
  { href: "/export", label: "Export this tenant", note: "A signed archive of the tenant's data." },
  { href: "/trust", label: "Open the Trust Centre", note: "The vendor-assurance documents." },
];

export default async function Home() {
  if (!(await hasSession()))
    return (
      <article className="ibx-page">
        <h1>Reference application</h1>
        <p>Sign in with your account to use the application.</p>
        <p>
          <ButtonLink href="/auth/login" variant="primary">
            Sign in
          </ButtonLink>
        </p>
      </article>
    );
  const me = await api<Me>("/auth/me");
  return (
    <article className="ibx-page">
      <h1>Reference application</h1>
      {me.ok ? (
        <>
          <p data-testid="signed-in">
            Signed in to tenant {me.body.tenantId} as {me.body.roles.join(", ")}
            {me.body.mfa ? ", with a second factor" : ""}.
          </p>
          <h2>What you can do</h2>
          <ol className="ibx-web__steps">
            {STEPS.map((s) => (
              <li key={s.href}>
                <a href={s.href}>{s.label}</a>. {s.note}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <ProblemView problem={me.problem} />
      )}
    </article>
  );
}
