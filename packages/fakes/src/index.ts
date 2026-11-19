// @infrabyx/fakes — the platform's in-memory port fakes and fixtures, with no test runner (PR-FBX-48,
// R1-D-181). A product may wire these in a fixture environment at runtime (below staging; every
// real adapter fails closed above it) without carrying vitest, Testcontainers or the contract
// harness in its production tree. `@infrabyx/testing` re-exports every name here unchanged, with
// the contract cases that exercise them.
export const PACKAGE_NAME = "@infrabyx/fakes" as const;
export * from "./core.js";
export * from "./ai.js";
export * from "./web.js";
export * from "./png.js";
export * from "./ports/accounting.js";
export * from "./ports/bureau-aa.js";
export * from "./ports/calendar.js";
export * from "./ports/captcha.js";
export * from "./ports/collections.js";
export * from "./ports/company-data.js";
export * from "./ports/court-data.js";
export * from "./ports/device-attestation.js";
export * from "./ports/dispatch.js";
export * from "./ports/documents-money.js";
export * from "./ports/email-inbound.js";
export * from "./ports/file-scan.js";
export * from "./ports/identity.js";
export * from "./ports/kyc.js";
export * from "./ports/mandate-approvals.js";
export * from "./ports/media.js";
export * from "./ports/odr.js";
export * from "./ports/pdf-text.js";
export * from "./ports/rules.js";
export * from "./ports/statement-analysis.js";
export * from "./ports/telephony.js";
export * from "./ports/video-meet.js";
export * from "./ports/web-snapshot.js";
export * from "./lender.js";
