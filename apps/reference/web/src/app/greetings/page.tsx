// The hello module's greetings (the template's example module), read through the API as the person.
import type { Metadata } from "next";
import { api } from "../../server/api.ts";
import { ProblemView } from "../../server/views.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Greetings" };

interface Greeting {
  id: string;
  message: string;
  createdAt: string;
}

export default async function Greetings() {
  const r = await api<{ greetings: Greeting[] }>("/hello/greetings");
  const items = r.ok ? r.body.greetings : [];
  return (
    <article className="ibx-page">
      <h1>Greetings</h1>
      {!r.ok ? (
        <ProblemView problem={r.problem} />
      ) : items.length ? (
        <ul>
          {items.map((g) => (
            <li key={g.id}>{g.message}</li>
          ))}
        </ul>
      ) : (
        <p>No greetings yet.</p>
      )}
    </article>
  );
}
