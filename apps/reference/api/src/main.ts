#!/usr/bin/env node
// The API's entrypoint: validate the environment, build the services, serve. A refused environment
// exits with 78 before anything listens (IPB-11-08).
import { createApp } from "./app.js";
import { getServices } from "./services.js";

const services = await getServices().catch((e: Error) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(78);
});
const app = await createApp(services);
await app.listen(services.env.APP_PORT, "0.0.0.0");
process.stdout.write(
  `${JSON.stringify({ msg: "listening", port: services.env.APP_PORT, env: services.env.APP_ENV, product: services.product })}\n`,
);
const stop = async () => {
  await app.close();
  await services.close();
  process.exit(0);
};
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
