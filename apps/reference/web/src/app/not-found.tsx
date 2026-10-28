// The 404 page, in the same shell.
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <article className="ibx-page">
      <h1>Page not found</h1>
      <p>
        <a href="/">Go to the home page</a>
      </p>
    </article>
  );
}
