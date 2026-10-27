// Shown with status 404 for an unknown Studio section or item.
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Not found" };

export default function Missing() {
  return (
    <article className="ibx-page">
      <h1>Page not found</h1>
      <p>
        <a href="/studio/approvals">Go to Approvals</a>
      </p>
    </article>
  );
}
