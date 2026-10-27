// @infrabyx/feedback — the feedback widget, feedback items with payload minimisation, the SUPPORT
// and BACKLOG hand-off and status loop, the accessibility SLA timers and the purge (IPB-04 §04.3.11,
// IPB-06-61/62; PL5 plan §7.1).
export const PACKAGE_NAME = "@infrabyx/feedback" as const;
export * from "./payload.js";
export * from "./service.js";
export * from "./sweep.js";
export * from "./http.js";
export * from "./components.js";
