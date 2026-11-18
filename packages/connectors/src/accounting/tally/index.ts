// The TallyPrime adapter of the ACCOUNTING sink and its agent API (Finbyx PR-FBX-46; R1-D-137,
// R1-D-178; threat model §3.121; plan `docs/phases/R1-tallyprime-plan.md`).
export * from "./agents.js";
export * from "./gateway.js";
export * from "./sink.js";
export { assertTenantCaller } from "./shared.js";
