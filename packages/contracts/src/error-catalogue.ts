// Error code catalogue. Generated from the IPB error tables; edit by hand only with a DECISIONS entry.
// Sources: IPB-01 §01.6.3, IPB-02 §02.6.3, IPB-07 §07.6.3, IPB-09 §09.6.3, IPB-10 §10.6.3 (IPB-API-018),
// IPB-11 §11.6, PL1-D-03, PL1-D-08.

/** Where the error surfaces when it is not an HTTP response. */
export type NonHttpStatus =
  | "boot"
  | "exit"
  | "cli"
  | "ci"
  | "migration"
  | "warning"
  | "pipeline"
  | "deploy"
  | "git"
  | "typecheck";

export interface ErrorDef {
  status: number | NonHttpStatus;
  title: string;
  helpKey?: string;
  source: string;
}

export const ERROR_CATALOGUE = {
  "IPB-PORT-001": {
    status: 500,
    title: "Port not configured for this environment",
    helpKey: "hlp.int.port_not_configured",
    source: "IPB-01 §01.6.3",
  },
  "IPB-PORT-002": {
    status: 503,
    title: "Adapter unavailable, circuit open",
    helpKey: "hlp.int.adapter_unavailable",
    source: "IPB-01 §01.6.3",
  },
  "IPB-PORT-003": {
    status: 422,
    title: "Residency or data-class violation; call refused",
    helpKey: "hlp.int.residency_blocked",
    source: "IPB-01 §01.6.3",
  },
  "IPB-PORT-004": {
    status: 409,
    title: "Idempotency key reused with a different payload",
    helpKey: "hlp.int.idempotency_conflict",
    source: "IPB-01 §01.6.3",
  },
  "IPB-PORT-005": {
    status: "boot",
    title: "Invalid routing configuration",
    helpKey: "hlp.int.routing_invalid",
    source: "IPB-01 §01.6.3",
  },
  "IPB-MOD-001": {
    status: "boot",
    title: "Module manifest invalid",
    helpKey: "hlp.eng.manifest_invalid",
    source: "IPB-01 §01.6.3",
  },
  "IPB-MOD-002": {
    status: 500,
    title: "Cross-module repository access detected at runtime",
    helpKey: "hlp.eng.module_boundary",
    source: "IPB-01 §01.6.3",
  },
  "IPB-MOD-003": {
    status: 500,
    title: "Mutation committed without an audit ledger entry",
    helpKey: "hlp.eng.ledger_required",
    source: "PL1-D-08 (PR-005)",
  },
  "IPB-STOR-001": { status: 404, title: "Object not found", source: "IPB-01 §01.6.3" },
  "IPB-STOR-002": {
    status: 202,
    title: "Write deferred (storage degraded)",
    helpKey: "hlp.int.storage_deferred",
    source: "IPB-01 §01.6.3",
  },
  "IPB-STOR-003": {
    status: 423,
    title: "Immutable object; modification refused",
    helpKey: "hlp.int.immutable",
    source: "IPB-01 §01.6.3",
  },
  "IPB-STOR-004": {
    status: 500,
    title: "Adapter cannot honour retention",
    source: "IPB-01 §01.6.3",
  },
  "IPB-IDN-001": { status: 401, title: "Token invalid or expired", source: "IPB-01 §01.6.3" },
  "IPB-IDN-002": {
    status: 503,
    title: "Identity provider unavailable for new sessions",
    source: "IPB-01 §01.6.3",
  },
  "IPB-AUTHZ-001": {
    status: 503,
    title: "Policy decision point unavailable; denied",
    source: "IPB-01 §01.6.3",
  },
  "IPB-KMS-001": {
    status: 503,
    title: "Key unavailable; decrypt refused",
    source: "IPB-01 §01.6.3",
  },
  "IPB-AI-021": {
    status: 503,
    title: "No model of required residency available; failed closed",
    helpKey: "hlp.ai.residency_unavailable",
    source: "IPB-01 §01.6.3",
  },
  "IPB-CACHE-001": {
    status: "warning",
    title: "Cache degraded; conservative limits applied",
    source: "IPB-01 §01.6.3",
  },
  "IPB-ENV-001": {
    status: "boot",
    title: "Seed profile refused in production",
    helpKey: "hlp.eng.seed_refused",
    source: "IPB-01 §01.6.3; PL1-D-03",
  },
  "IPB-ENV-002": {
    status: "boot",
    title: "Disallowed engine or host detected (for example Supabase in production)",
    source: "IPB-01 §01.6.3; PL1-D-03",
  },
  "IPB-ENV-003": {
    status: "exit",
    title: "Literal secret in staging, demo, pre-prod, prod or dr",
    source: "IPB-11 §11.6",
  },
  "IPB-ENV-004": {
    status: "exit",
    title: "Forbidden host (localhost etc.) in a production URL",
    source: "IPB-11 §11.6",
  },
  "IPB-ENV-005": {
    status: "exit",
    title: "Known development value refused",
    source: "IPB-11 §11.6",
  },
  "IPB-ENV-006": {
    status: "exit",
    title: "NODE_ENV is not production in a production environment",
    source: "IPB-11 §11.6",
  },
  "IPB-ENV-007": { status: "exit", title: "TLS or SSL mode insufficient", source: "IPB-11 §11.6" },
  "IPB-ENV-008": {
    status: "exit",
    title: "AI adapter region is not India for an India-resident adapter",
    source: "IPB-11 §11.6",
  },
  "IPB-ENV-009": {
    status: "exit",
    title: "Secret reference could not be resolved",
    source: "IPB-11 §11.6",
  },
  "IPB-ENV-010": {
    status: "exit",
    title: "Host map mismatch for public URLs",
    source: "IPB-11 §11.6",
  },
  "IPB-ENV-011": {
    status: "exit",
    title: "Environment schema validation failed",
    source: "PL1-D-03 (PR-002)",
  },
  "IPB-DB-001": {
    status: "migration",
    title: "Extension not in whitelist",
    source: "IPB-01 §01.6.3",
  },
  "IPB-DB-002": {
    status: "migration",
    title: "Engine-specific construct outside adapter",
    source: "IPB-01 §01.6.3",
  },
  "IPB-SEED-001": { status: "cli", title: "Seed refused in production", source: "IPB-11 §11.6" },
  "IPB-SEED-002": {
    status: "cli",
    title: "Load profile without SEED_LOAD_CONFIRM=yes",
    source: "IPB-11 §11.6",
  },
  "IPB-SEED-003": {
    status: "cli",
    title: "Personas file and credentials template mismatch",
    source: "IPB-11 §11.6",
  },
  "IPB-SEED-004": {
    status: "cli",
    title: "Real-identifier validator failed on seed data",
    source: "IPB-11 §11.6",
  },
  "IPB-SEED-005": {
    status: "cli",
    title: "Credential uniqueness check failed",
    source: "IPB-11 §11.6",
  },
  "IPB-SEED-006": {
    status: "cli",
    title: "Vault write failed; file not written",
    source: "IPB-11 §11.6",
  },
  "IPB-SEC-001": { status: 403, title: "MFA required for this role", source: "IPB-02 §02.6.3" },
  "IPB-SEC-002": {
    status: 403,
    title: "Source IP not in tenant allow-list",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-003": {
    status: 403,
    title: "Action not permitted during impersonation",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-004": {
    status: 403,
    title: "Action not permitted for agent principals",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-005": {
    status: 404,
    title: "Outside principal's product scope",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-006": {
    status: 202,
    title: "Maker-checker required; request created",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-007": { status: 409, title: "Checker cannot be the maker", source: "IPB-02 §02.6.3" },
  "IPB-SEC-008": {
    status: 425,
    title: "Action in delay window; not yet executable",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-009": {
    status: 403,
    title: "Break-glass requires a second approver",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-010": { status: 415, title: "Upload rejected: type mismatch", source: "IPB-02 §02.6.3" },
  "IPB-SEC-011": {
    status: 422,
    title: "Upload rejected: malware detected",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-012": {
    status: 422,
    title: "Upload rejected: active content",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-013": {
    status: 413,
    title: "Upload rejected: size or ratio limit",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-014": {
    status: 415,
    title: "Upload rejected: disallowed extension",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-015": {
    status: 202,
    title: "Upload quarantined pending scan",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-016": {
    status: 421,
    title: "Unknown host for brand resolution",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-017": { status: 403, title: "CSRF validation failed", source: "IPB-02 §02.6.3" },
  "IPB-SEC-018": {
    status: 422,
    title: "Blocked outbound URL (SSRF guard)",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-019": { status: 429, title: "Rate limit exceeded", source: "IPB-02 §02.6.3" },
  "IPB-SEC-020": {
    status: 403,
    title: "Platform-locked setting cannot be loosened",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-021": {
    status: 403,
    title: "Reveal of masked field requires role and is ledgered",
    source: "IPB-02 §02.6.3",
  },
  "IPB-SEC-022": {
    status: 409,
    title: "Erasure refused: statutory retention applies",
    source: "IPB-02 §02.6.3",
  },
  // The AI area is owned by IPB-03 §03.6.3 (IPB-01 §01.6.3 note on IPB-AI-021). IPB-AI-001 takes
  // the IPB-03 meaning; IPB-02's 002–005 stay registered, and the gateway emits the IPB-03 codes
  // for the same failures (040, VID-011, 041, 022). Reconciliation asked in PR-024 (PL4-D-02).
  "IPB-AI-001": {
    status: 503,
    title: "AI features paused: gateway disabled for the tenant or a kill switch is on",
    helpKey: "hlp.ai.paused",
    source: "IPB-03 §03.6.3 (PR-024)",
  },
  "IPB-AI-002": { status: 403, title: "Tool not in skill allow-list", source: "IPB-02 §02.6.3" },
  "IPB-AI-003": {
    status: 202,
    title: "Human confirmation required for this action",
    source: "IPB-02 §02.6.3",
  },
  "IPB-AI-004": {
    status: 422,
    title: "Output failed validation or filter",
    source: "IPB-02 §02.6.3",
  },
  "IPB-AI-005": { status: 429, title: "Run stopped: step or cost limit", source: "IPB-02 §02.6.3" },
  "IPB-UX-001": { status: "ci", title: "Journey exceeded click budget", source: "IPB-07 §07.6.3" },
  "IPB-UX-002": {
    status: "ci",
    title: "More than one primary action, or nav exceeds ceiling",
    source: "IPB-07 §07.6.3",
  },
  "IPB-UX-003": {
    status: 400,
    title: "Palette query refused: protected identifier pattern",
    source: "IPB-07 §07.6.3",
  },
  "IPB-UX-004": {
    status: 403,
    title: "Destructive action without typed confirmation or maker-checker",
    source: "IPB-07 §07.6.3",
  },
  "IPB-UX-005": {
    status: 409,
    title: "Scheduled action still inside delay window",
    source: "IPB-07 §07.6.3",
  },
  "IPB-UX-006": {
    status: 409,
    title: "Bulk action exceeds threshold without confirmation",
    source: "IPB-07 §07.6.3",
  },
  "IPB-UX-007": {
    status: 500,
    title: "Setting key not registered in settings tree",
    source: "IPB-07 §07.6.3",
  },
  "IPB-UX-008": {
    status: 422,
    title: "Settings change violates scope precedence",
    source: "IPB-07 §07.6.3",
  },
  "IPB-UX-009": {
    status: "ci",
    title: "Dashboard widget without evidence class",
    source: "IPB-07 §07.6.3",
  },
  "IPB-UX-010": { status: 409, title: "Draft restore conflict", source: "IPB-07 §07.6.3" },
  "IPB-UX-011": {
    status: 403,
    title: "Principal may not change this setting at this tier",
    source: "PL1-D-08 (PR-005)",
  },
  "IPB-UX-012": {
    status: 410,
    title: "Approval request expired; raise it again",
    source: "PL3-D-07 (PR-019)",
  },
  "IPB-HLP-001": {
    status: "ci",
    title: "Missing help key or key not in registry",
    source: "IPB-07 §07.6.3",
  },
  "IPB-HLP-002": {
    status: "ci",
    title: "Plain definition exceeds 40 words",
    source: "IPB-07 §07.6.3",
  },
  "IPB-HLP-003": {
    status: 422,
    title: "Entry with LAW citation lacks legal reviewer of record",
    source: "IPB-07 §07.6.3",
  },
  "IPB-HLP-004": {
    status: 409,
    title: "Attempt to delete a referenced help key",
    source: "IPB-07 §07.6.3",
  },
  "IPB-HLP-005": {
    status: "ci",
    title: "Route without help_article_key",
    source: "IPB-07 §07.6.3",
  },
  "IPB-HLP-006": {
    status: 200,
    title: "Vidhi help answer blocked: outside help corpus",
    source: "IPB-07 §07.6.3",
  },
  "IPB-TUT-001": {
    status: "pipeline",
    title: "Tutorial pipeline attempted against non-demo tenant",
    source: "IPB-07 §07.6.3",
  },
  "IPB-TUT-002": {
    status: "pipeline",
    title: "Tutorial stale beyond threshold; publish held",
    source: "IPB-07 §07.6.3",
  },
  "IPB-TUT-003": {
    status: "ci",
    title: "Tour exceeds 7 steps or targets a regulated-step screen",
    source: "IPB-07 §07.6.3",
  },
  "IPB-NTF-001": {
    status: 422,
    title: "Attempt to disable a mandatory notification class",
    source: "IPB-07 §07.6.3",
  },
  "IPB-NTF-002": {
    status: 422,
    title: "Unknown notification class",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-NTF-003": {
    status: 422,
    title: "No deliverable channel after preferences, consent and suppression",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-NTF-004": {
    status: 503,
    title: "Notification channel is switched off by its kill switch",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-NTF-005": {
    status: 202,
    title: "Resend held for review",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-NTF-006": {
    status: 422,
    title: "Push payload carries more than a title, a deep link and INTERNAL data",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-CST-001": {
    status: 403,
    title: "Custom field with PII class created without checker",
    source: "IPB-07 §07.6.3",
  },
  "IPB-CST-002": {
    status: 422,
    title: "Terminology override collides with a reserved legal term",
    source: "IPB-07 §07.6.3",
  },
  "IPB-ENG-001": {
    status: "git",
    title: "Branch name violates convention",
    source: "IPB-09 §09.6.3",
  },
  "IPB-ENG-002": { status: "ci", title: "PR checklist incomplete", source: "IPB-09 §09.6.3" },
  "IPB-ENG-003": { status: "ci", title: "Changeset missing", source: "IPB-09 §09.6.3" },
  "IPB-ENG-004": { status: "ci", title: "Migration lint failure", source: "IPB-09 §09.6.3" },
  "IPB-ENG-005": {
    status: "deploy",
    title: "Released migration edited (checksum mismatch)",
    source: "IPB-09 §09.6.3",
  },
  "IPB-ENG-006": {
    status: "ci",
    title: "Export map changed without version bump",
    source: "IPB-09 §09.6.3",
  },
  "IPB-ENG-007": { status: "ci", title: "Golden-archive drift detected", source: "IPB-09 §09.6.3" },
  "IPB-ENG-008": { status: "typecheck", title: "Flag not registered", source: "IPB-09 §09.6.3" },
  "IPB-ENG-009": { status: "ci", title: "Flag debt budget exceeded", source: "IPB-09 §09.6.3" },
  "IPB-ENG-015": {
    status: 403,
    title: "Sandbox action attempted to reach live port",
    source: "IPB-09 §09.6.3",
  },
  "IPB-ENG-016": {
    status: 403,
    title: "Kill switch change requires elevated role",
    source: "IPB-09 §09.6.3",
  },
  "IPB-ENG-017": {
    status: "ci",
    title: "Preview secrets scope violation",
    source: "IPB-09 §09.6.3",
  },
  // RULES runtime errors (PL3-D-18). The Ecosystem §3.12 area list has no RULE area yet; PR-017
  // asks the IPB editor to add it, as IPB-UX-011 was registered under PR-005.
  "IPB-RULE-001": {
    status: 422,
    title: "Rule set invalid: a row is outside the CEL subset or the body fails its schema",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-RULE-002": {
    status: 404,
    title: "Rule set has no effective version",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-RULE-003": {
    status: 409,
    title: "Rule set version is not in the state this action needs",
    source: "PL3 plan §10 (PR-017)",
  },
  // EXPORT runtime errors (PL3-D-22), under PR-017 like the RULE area.
  "IPB-EXP-001": {
    status: 403,
    title: "Restricted export folders need a second approver and are not available yet",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-EXP-002": {
    status: 422,
    title: "Export scope or destination not supported",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-EXP-003": {
    status: 500,
    title: "Export control totals differ from the live system; the job failed",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-EXP-004": {
    status: 422,
    title: "Export map names a field that is never exported (secret, sealed, Aadhaar or card data)",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-EXP-005": {
    status: 403,
    title: "This role may not request or download this export",
    source: "PL3 plan §10 (PR-017)",
  },
  "IPB-EXP-006": {
    status: 410,
    title: "Export archive expired and was deleted; request a new export",
    source: "OWNER-QUESTIONS #24 (PL3-D-25, PR-017)",
  },
  // AI gateway and Vidhi (IPB-03 §03.6.3; PL4 plan §11).
  "IPB-AI-010": {
    status: 400,
    title: "Capability not supported by the selected model",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-011": {
    status: 500,
    title: "Embedding dimension mismatch",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-012": {
    status: 409,
    title: "Model not in a servable state, or the pin is not eligible for this data",
    helpKey: "hlp.ai.model_unavailable",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-013": {
    status: 422,
    title: "Promotion blocked: missing evidence or evals",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-020": {
    status: 400,
    title: "Attempt to lower the data class of an AI request",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-022": {
    status: 429,
    title: "AI usage cap reached",
    helpKey: "hlp.ai.cost_cap",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-023": {
    status: 429,
    title: "Provider rate limit; all candidates exhausted",
    helpKey: "hlp.ai.busy",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-030": {
    status: 400,
    title: "Forbidden image use case",
    helpKey: "hlp.ai.image_forbidden",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-031": {
    status: 422,
    title: "SGI label missing on publish",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-040": {
    status: 500,
    title: "Disallowed tool call by the model; run halted",
    helpKey: "hlp.ai.stopped_for_safety",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-041": {
    status: 502,
    title: "Output failed schema validation after repair",
    helpKey: "hlp.ai.invalid_result",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-042": {
    status: 200,
    title: "Output blocked by classifier",
    helpKey: "hlp.ai.withheld",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-050": {
    status: 500,
    title: "Prompt key or version not found or inactive",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-060": {
    status: 401,
    title: "BYOK credential invalid",
    helpKey: "hlp.ai.byok_rejected",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-001": {
    status: "boot",
    title: "Invalid skill manifest",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-010": {
    status: 403,
    title: "Autonomy level exceeds ceiling",
    helpKey: "hlp.vidhi.level",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-011": {
    status: 403,
    title: "Locked action needs a human to approve",
    helpKey: "hlp.vidhi.locked",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-012": {
    status: 403,
    title: "Approver lacks the role or is an agent token",
    helpKey: "hlp.vidhi.approver",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-020": {
    status: "warning",
    title: "Scheduled run skipped: permission, plan or kill switch",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-021": {
    status: "warning",
    title: "Schedule paused after the maximum number of skips",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-022": {
    status: 409,
    title: "Task is not awaiting approval: already decided, cancelled or expired",
    helpKey: "hlp.vidhi.already_decided",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-030": {
    status: 403,
    title: "Agent delegation disabled",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-040": {
    status: 403,
    title: "MCP write tool called without confirmation",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-041": {
    status: 403,
    title: "External MCP server not allow-listed",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-050": {
    status: 403,
    title: "Consent missing for meeting notes or transcription",
    helpKey: "hlp.vidhi.consent",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-060": {
    status: 403,
    title: "Cross-tenant notebook share without approval",
    helpKey: "hlp.vidhi.share",
    source: "IPB-03 §03.6.3",
  },
  "IPB-VID-070": {
    status: 200,
    title: "Mission budget exhausted; stopped",
    helpKey: "hlp.vidhi.budget",
    source: "IPB-03 §03.6.3",
  },
  "IPB-AI-032": {
    status: 422,
    title: "Generated image not approved for publishing",
    helpKey: "hlp.ai.image_unapproved",
    source: "OWN-10; PL4 plan §6 (PR-022)",
  },
  // IPB-10 §10.6.3, added for the Ecosystem inbox: a test event at a live inbox or the reverse
  // (Spec §3.2; R1 plan M10).
  "IPB-API-005": {
    status: 401,
    title: "Key environment mismatch (test key on live host or vice versa)",
    source: "IPB-10 §10.6.3",
  },
  // IPB-10 §10.6.3, added for the inbound idempotency store (IPB-10-07; PR-FBX-10, R1-D-27).
  "IPB-API-010": {
    status: 400,
    title: "Idempotency-Key missing or not UUIDv7",
    source: "IPB-10 §10.6.3",
  },
  "IPB-API-011": {
    status: 409,
    title: "Idempotent request in progress",
    source: "IPB-10 §10.6.3",
  },
  // IPB-10 §10.6.3, added for inbound vendor webhooks (PL2-D-64).
  "IPB-API-018": {
    status: 401,
    title: "HTTP message signature invalid or nonce reused",
    source: "IPB-10 §10.6.3",
  },
  // IPB-04 §04.6.3, IPB-05 §05.6, IPB-06 §06.6.3, IPB-08 §08.6.3, IPB-13 §13.6 (PL5 plan §8).
  "IPB-CMS-001": { status: 422, title: "Invalid block", source: "IPB-04 §04.6.3" },
  "IPB-CMS-002": { status: 422, title: "Slug reserved or already used", source: "IPB-04 §04.6.3" },
  "IPB-CMS-003": {
    status: 422,
    title: "Required slot empty or transition not allowed",
    source: "IPB-04 §04.6.3, §04.4.3 (PR-030)",
  },
  "IPB-CMS-004": {
    status: 403,
    title: "The checker cannot be the maker",
    source: "IPB-04 §04.6.3",
  },
  "IPB-CMS-005": { status: 403, title: "Legal review missing", source: "IPB-04 §04.6.3" },
  "IPB-CMS-006": { status: 410, title: "Preview link expired", source: "IPB-04 §04.6.3" },
  "IPB-CMS-007": { status: 422, title: "Image alt text missing", source: "IPB-04 §04.6.3" },
  "IPB-CMS-008": { status: 200, title: "Sanitiser removed content", source: "IPB-04 §04.6.3" },
  "IPB-CMS-009": {
    status: 422,
    title: "Redirect loop or chain longer than one",
    source: "IPB-04 §04.6.3",
  },
  "IPB-CMS-010": {
    status: 403,
    title: "Claim missing or below evidence class E1",
    source: "IPB-04 §04.6.3",
  },
  "IPB-CMS-011": {
    status: 403,
    title: "Machine-translated draft cannot be published",
    source: "IPB-04 §04.6.3",
  },
  "IPB-CMS-012": { status: 422, title: "Prohibited wording", source: "IPB-04 §04.6.3" },
  "IPB-CMS-013": { status: 422, title: "Captions missing", source: "IPB-04 §04.6.3" },
  "IPB-CMS-014": {
    status: 403,
    title: "Testimonial, logo or photo without permission",
    source: "IPB-04 §04.6.3",
  },
  "IPB-CMS-015": { status: 422, title: "Dark-pattern lint failed", source: "IPB-04 §04.6.3" },
  "IPB-CMS-020": { status: 415, title: "Import file type not supported", source: "IPB-04 §04.6.3" },
  "IPB-CMS-021": { status: 422, title: "Archive rejected", source: "IPB-04 §04.6.3" },
  "IPB-CMS-022": { status: 422, title: "Import blocked by lint", source: "IPB-04 §04.6.3" },
  "IPB-CMS-023": {
    status: 422,
    title: "Antivirus scan failed or positive",
    source: "IPB-04 §04.6.3",
  },
  "IPB-CMS-030": {
    status: 403,
    title: "User post refused: terms, role or rate",
    source: "IPB-04 §04.6.3",
  },
  "IPB-CMS-031": { status: 422, title: "Takedown reason required", source: "IPB-04 §04.6.3" },
  "IPB-CMS-040": {
    status: 403,
    title: "Gated resource: entitlement check failed",
    source: "IPB-04 §04.6.3",
  },
  "IPB-CMS-041": {
    status: 410,
    title: "Resource version withdrawn or expired",
    source: "IPB-04 §04.6.3",
  },
  "IPB-BRD-001": { status: 422, title: "SVG failed sanitisation", source: "IPB-04 §04.6.3" },
  "IPB-BRD-002": {
    status: 409,
    title: "Host already mapped to another brand pack",
    source: "IPB-04 §04.6.3",
  },
  "IPB-BRD-003": {
    status: 422,
    title: "Colour pair fails the contrast guard",
    source: "IPB-04 §04.6.3",
  },
  "IPB-BRD-004": {
    status: 422,
    title: "Font is not WOFF2 or has no licence note",
    source: "IPB-04 §04.6.3",
  },
  "IPB-BRD-005": { status: 403, title: "Email identity not verified", source: "IPB-04 §04.6.3" },
  "IPB-BRD-006": { status: 403, title: "Policy set not published", source: "IPB-04 §04.6.3" },
  "IPB-BRD-007": {
    status: 200,
    title: "Unknown host; default brand pack served with noindex",
    source: "IPB-04 §04.6.3",
  },
  "IPB-WEB-001": {
    status: 503,
    title: "Consent ledger unavailable; choice queued",
    source: "IPB-04 §04.6.3",
  },
  "IPB-WEB-002": {
    status: 422,
    title: "Consent not given for personal fields",
    source: "IPB-04 §04.6.3",
  },
  "IPB-WEB-003": { status: 429, title: "Anti-spam check failed", source: "IPB-04 §04.6.3" },
  "IPB-WEB-004": {
    status: 422,
    title: "Embed provider not allowed or address blocked",
    source: "IPB-04 §04.6.3",
  },
  "IPB-WEB-005": {
    status: 403,
    title: "Tag blocked on a sensitive route",
    source: "IPB-04 §04.6.3",
  },
  "IPB-WEB-006": { status: 503, title: "Pricing catalogue unavailable", source: "IPB-04 §04.6.3" },
  "IPB-FB-001": { status: 422, title: "Feedback field not allowed", source: "IPB-04 §04.6.3" },
  "IPB-FB-002": { status: 429, title: "Feedback rate limit", source: "IPB-04 §04.6.3" },
  "IPB-POL-001": { status: 422, title: "Policy parameter not resolved", source: "IPB-05 §05.6" },
  "IPB-POL-002": { status: 422, title: "Mandatory policy section missing", source: "IPB-05 §05.6" },
  "IPB-POL-003": { status: 422, title: "Banned wording in policy text", source: "IPB-05 §05.6" },
  "IPB-POL-004": { status: 422, title: "Stale legal citation", source: "IPB-05 §05.6" },
  "IPB-POL-005": {
    status: 422,
    title: "Effective date inside the notice period",
    source: "IPB-05 §05.6",
  },
  "IPB-POL-006": {
    status: 403,
    title: "DPO approval missing for a privacy-class policy",
    source: "IPB-05 §05.6",
  },
  "IPB-POL-007": {
    status: 422,
    title: "Hindi version missing or not reviewed",
    source: "IPB-05 §05.6",
  },
  "IPB-POL-008": {
    status: 409,
    title: "Published policy cannot be edited in place",
    source: "IPB-05 §05.6",
  },
  "IPB-POL-009": {
    status: 422,
    title: "Policy set incomplete for the brand pack",
    source: "IPB-05 §05.6",
  },
  "IPB-POL-010": {
    status: 403,
    title: "Action blocked until the current terms are accepted",
    source: "IPB-05 §05.6",
  },
  "IPB-POL-011": {
    status: 403,
    title: "Data processing agreement not executed",
    source: "IPB-05 §05.6",
  },
  "IPB-A11Y-001": {
    status: 422,
    title: "Image needs alt text or the decorative flag",
    source: "IPB-06 §06.6.3",
  },
  "IPB-A11Y-002": {
    status: 422,
    title: "Video needs English and Hindi captions and a transcript",
    source: "IPB-06 §06.6.3",
  },
  "IPB-A11Y-003": {
    status: 400,
    title: "Accessibility overlays are not permitted",
    source: "IPB-06 §06.6.3",
  },
  "IPB-A11Y-004": { status: "ci", title: "Accessibility gate failed", source: "IPB-06 §06.6.3" },
  "IPB-A11Y-005": {
    status: 409,
    title: "Interpreter request inside the lead time is best-effort",
    source: "IPB-06 §06.6.3",
  },
  "IPB-A11Y-006": {
    status: 422,
    title: "Colour pair fails minimum contrast",
    source: "IPB-06 §06.6.3",
  },
  "IPB-A11Y-007": {
    status: 409,
    title: "Timeout fixed by regulation cannot be extended",
    source: "IPB-06 §06.6.3",
  },
  "IPB-A11Y-008": { status: 503, title: "Live captions unavailable", source: "IPB-06 §06.6.3" },
  "IPB-A11Y-009": {
    status: "ci",
    title: "Voice journey without a text twin",
    source: "IPB-06 §06.6.3",
  },
  "IPB-A11Y-010": {
    status: "ci",
    title: "Statement status downgraded by an open defect",
    source: "IPB-06 §06.6.3",
  },
  "IPB-TRUST-001": {
    status: 404,
    title: "Document not available to this organisation",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-002": {
    status: 403,
    title: "Standard NDA must be accepted first",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-003": {
    status: 403,
    title: "Access grant expired, revoked or out of scope",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-004": {
    status: "warning",
    title: "Claim has no current evidence; fallback wording applied",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-005": {
    status: 403,
    title: "A different approver is required",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-006": {
    status: 422,
    title: "Unregistered certification or control claim",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-007": {
    status: 410,
    title: "Download link expired or reused",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-008": {
    status: 422,
    title: "Auditor access longer than the ceiling",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-009": { status: 500, title: "Trust mirror digest mismatch", source: "IPB-08 §08.6.3" },
  "IPB-TRUST-010": {
    status: 422,
    title: "Financial statements gating cannot be loosened",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-011": {
    status: 409,
    title: "Questionnaire answers not yet approved",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-012": {
    status: 503,
    title: "Watermarked copy could not be prepared",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-013": {
    status: 422,
    title: "Per-tenant publication needs a tenant target",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-014": {
    status: 500,
    title: "Document request SLA breached",
    source: "IPB-08 §08.6.3",
  },
  "IPB-TRUST-015": {
    status: 409,
    title: "A newer version is already published",
    source: "IPB-08 §08.6.3",
  },
  "IPB-RES-001": { status: 400, title: "Export format not allowed", source: "IPB-13 §13.6" },
  "IPB-RES-002": {
    status: 422,
    title: "Alt text or long description missing",
    source: "IPB-13 §13.6",
  },
  "IPB-RES-003": { status: 422, title: "Captions or transcript missing", source: "IPB-13 §13.6" },
  "IPB-RES-004": { status: 422, title: "Synthetic media label missing", source: "IPB-13 §13.6" },
  "IPB-RES-005": {
    status: 403,
    title: "Data class forbids this sharing scope",
    source: "IPB-13 §13.6",
  },
  "IPB-RES-010": {
    status: 409,
    title: "Publish blocked: review gate incomplete",
    source: "IPB-13 §13.6",
  },
  "IPB-RES-011": {
    status: 422,
    title: "Numeric content without a source reference",
    source: "IPB-13 §13.6",
  },
} as const satisfies Record<string, ErrorDef>;

export type IpbErrorCode = keyof typeof ERROR_CATALOGUE;
