// Fixture sign-in (reference console only; PL5 plan §9.6): choose a synthetic persona. Where
// fixtures are off the page says so; a product uses its IDENTITY sign-in instead.
import type { Metadata } from "next";
import { Button, SelectField } from "@infrabyx/ui";
import { PERSONAS } from "../../server/authz.ts";
import { getConsole } from "../../server/console.ts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function SignIn() {
  const c = await getConsole();
  return (
    <article className="ibx-page">
      <h1>Sign in to Studio</h1>
      {c.env.APP_FIXTURE_ADAPTERS ? (
        <form method="post" action="/api/sign-in" className="ibx-console__signin">
          <p>This reference console signs in test personas. Products use their own sign-in.</p>
          <SelectField
            id="f-persona"
            name="persona"
            label="Persona"
            helpKey="hlp.studio.persona"
            options={Object.entries(PERSONAS).map(([value, p]) => ({ value, label: p.label }))}
          />
          <Button type="submit" variant="primary">
            Sign in
          </Button>
        </form>
      ) : (
        <p>Sign-in is not configured in this environment.</p>
      )}
    </article>
  );
}
