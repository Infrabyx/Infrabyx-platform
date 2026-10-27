// HEALTHCHECK of every platform image (IPB-01-31, PL6 plan §3.2): the app's own liveness probe on
// its own port, within 2.5 seconds; exit 0 when it answers 2xx, 1 otherwise.
const port = process.env.PORT ?? "3000";
fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(2_500) }).then(
  (r) => process.exit(r.ok ? 0 : 1),
  () => process.exit(1),
);
