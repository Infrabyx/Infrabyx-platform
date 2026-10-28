// Health probes for the container and the chart (IPB-01 §01.4.8.2; PL6 plan §3.2). `live` answers
// while the process serves requests; `ready` and `startup` also need the API's liveness within two
// seconds (the API is this app's one critical dependency). The body has the `ReadyBody` shape of
// `@infrabyx/connectors` health; it names no host, version or error text.
import { webEnv } from "./env.ts";

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
  const up = await webEnv()
    .then((env) =>
      fetch(`${env.APP_API_URL.replace(/\/$/, "")}/health/live`, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    )
    .then(
      (r) => r.ok,
      () => false,
    );
  const status = up ? "up" : "down";
  return json(
    {
      status,
      checks: [
        {
          port: "APP",
          adapter: "reference-api",
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
