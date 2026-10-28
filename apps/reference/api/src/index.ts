// @infrabyx/reference-api — the reference API of apps/reference (PL6 plan §8): the environment,
// the services, the hello module, the HTTP application and the worker. Products copy this app as
// `apps/api` and `apps/worker` (IPB-01 §01.4.2).
export const PACKAGE_NAME = "@infrabyx/reference-api" as const;
export { apiEnv, apiEnvSchema, checkApiEnv, FIXTURE_ENVS, type ApiEnv } from "./env.js";
export {
  buildServices,
  getServices,
  serviceContext,
  EXPORT_QUEUE,
  type Services,
} from "./services.js";
export { createApp } from "./app.js";
export * from "./modules/hello/index.js";
export {
  FixtureIdentity,
  FixtureHelloAuthz,
  FixtureWorkflow,
  FIXTURE_PERSONAS,
  fixtureUserId,
  MemoryQueue,
  missingPort,
} from "./fixtures.js";
export { newPkce, cookie, cookieMap, tokenFrom, SESSION_COOKIE, PKCE_COOKIE } from "./identity.js";
export {
  runWorker,
  handleHelloJob,
  exportJobHandler,
  HELLO_QUEUE,
  type WorkerHandle,
} from "./worker.js";
export { helloSeedModule } from "./seed/hello.js";
export { OutboxRelay, EVENTS_QUEUE, RELAY_PRINCIPAL_ID } from "./relay.js";
