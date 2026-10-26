// @infrabyx/testing — test kit for products and the platform (IPB-01 §01.4.2, IPB-14 §14.5 item 4):
// startPostgres, context builders, port fakes, NN pattern suites, the port contract harness,
// migration-lint (./migration-lint), the AT report, the IPB ESLint plugin (./eslint), and the PL2
// port harness: pinned test images, sandbox-leg gate and fault-injection proxy.
export const PACKAGE_NAME = "@infrabyx/testing" as const;
export * from "./postgres.js";
export * from "./context.js";
export * from "./fakes.js";
export * from "./nn.js";
export * from "./contract.js";
export * from "./at-report/index.js";
export * from "./containers.js";
export * from "./ports/index.js";
