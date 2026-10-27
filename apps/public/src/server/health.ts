// Health probes for the container and the chart (IPB-01 §01.4.8.2; PL6 plan §3.2). `live` answers
// while the process serves requests; `ready` and `startup` also need one database round trip within
// two seconds. The body has the `ReadyBody` shape of `@infrabyx/connectors` health (the database is
// the one critical dependency here); it names no host, version or error text.
import { getSite } from "./site.ts";

const TIMEOUT_MS = 2_000;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

export const live = (): Response => json({ status: "up" }, 200);

export async function ready(): Promise<Response> {
  const t0 = Date.now();
  const up = await getSite()
    .then(({ ping }) =>
      Promise.race([
        ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS).unref(),
        ),
      ]),
    )
    .then(
      () => true,
      () => false,
    );
  const status = up ? "up" : "down";
  return json(
    {
      status,
      checks: [
        {
          port: "DATABASE",
          adapter: "postgres",
          role: "primary",
          status,
          latency_ms: Date.now() - t0,
          checked_at: new Date().toISOString(),
        },
      ],
    },
    up ? 200 : 503,
  );
}
