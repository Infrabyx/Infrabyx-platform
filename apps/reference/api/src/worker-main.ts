#!/usr/bin/env node
// The worker's entrypoint (`node dist/worker-main.js`): the same environment and services as the
// API, the queue consumers, the health probes on PORT.
import { runWorker } from "./worker.js";

const w = await runWorker().catch((e: Error) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(78);
});
process.stdout.write(
  `${JSON.stringify({ msg: "worker listening", port: w.port, env: w.services.env.APP_ENV })}\n`,
);
const stop = async () => {
  await w.stop();
  process.exit(0);
};
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
