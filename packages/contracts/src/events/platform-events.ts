// Internal events emitted by the PL1 kernel packages. Names per IPB-02 §02.6.1, IPB-07 §07.6.1,
// IPB-11 §11.6, IPB-01 §01.6.1. `<product>` is filled in by the emitting product.
import { z } from "zod";
import { SettingTier } from "../tiers.js";

export const PLATFORM_EVENTS = {
  // config / settings (IPB-07 §07.6.1)
  SettingChanged: { module: "settings", name: "SettingChanged" },
  UserPreferenceChanged: { module: "settings", name: "UserPreferenceChanged" },
  ScheduledActionCreated: { module: "settings", name: "ScheduledActionCreated" },
  ScheduledActionCancelled: { module: "settings", name: "ScheduledActionCancelled" },
  ScheduledActionExecuted: { module: "settings", name: "ScheduledActionExecuted" },
  // security (IPB-02 §02.6.1)
  ApprovalRequested: { module: "security", name: "ApprovalRequested" },
  ApprovalDecided: { module: "security", name: "ApprovalDecided" },
  ApprovalExecuted: { module: "security", name: "ApprovalExecuted" },
  ApprovalCancelled: { module: "security", name: "ApprovalCancelled" },
  // PL3-D-07 (PR-019): expiry and escalation of maker-checker requests
  ApprovalExpired: { module: "security", name: "ApprovalExpired" },
  ApprovalEscalated: { module: "security", name: "ApprovalEscalated" },
  BreakGlassGranted: { module: "security", name: "BreakGlassGranted" },
  BreakGlassRevoked: { module: "security", name: "BreakGlassRevoked" },
  // PR-FBX-10 item 3 (R1-D-28): a break-glass grant was used in this tenant, raised in the tenant.
  BreakGlassUsed: { module: "security", name: "BreakGlassUsed" },
  ImpersonationStarted: { module: "security", name: "ImpersonationStarted" },
  ImpersonationEnded: { module: "security", name: "ImpersonationEnded" },
  LedgerAnchorWritten: { module: "security", name: "LedgerAnchorWritten" },
  LedgerChainBroken: { module: "security", name: "LedgerChainBroken" },
  KillSwitchChanged: { module: "security", name: "KillSwitchChanged" },
  // environment and seeds (IPB-11 §11.6)
  ConfigValidated: { module: "eng", name: "ConfigValidated" },
  ConfigGuardFailed: { module: "eng", name: "ConfigGuardFailed" },
  SeedRunStarted: { module: "seed", name: "SeedRunStarted" },
  SeedRunCompleted: { module: "seed", name: "SeedRunCompleted" },
  SeedRefused: { module: "seed", name: "SeedRefused" },
  CredentialsGenerated: { module: "seed", name: "CredentialsGenerated" },
  SandboxReset: { module: "seed", name: "SandboxReset" },
  // module boot and provider routing (IPB-01 §01.6.1)
  ModuleManifestInvalid: { module: "platform", name: "ModuleManifestInvalid" },
  AdapterFailedOver: { module: "platform", name: "AdapterFailedOver" },
  AdapterRecovered: { module: "platform", name: "AdapterRecovered" },
  ResidencyViolationBlocked: { module: "platform", name: "ResidencyViolationBlocked" },
  RoutingConfigChanged: { module: "platform", name: "RoutingConfigChanged" },
  // PL3 (plan §10)
  RuleSetPublished: { module: "rules", name: "RuleSetPublished" },
  NotificationDigestSent: { module: "ntf", name: "NotificationDigestSent" },
  NotificationHeld: { module: "ntf", name: "NotificationHeld" },
  ItemCreated: { module: "inbox", name: "ItemCreated" },
  ItemResolved: { module: "inbox", name: "ItemResolved" },
  ExportMapBumped: { module: "eng", name: "ExportMapBumped" },
  GoldenArchiveDrift: { module: "eng", name: "GoldenArchiveDrift" },
  FlagProviderUnreachable: { module: "eng", name: "FlagProviderUnreachable" },
} as const;
export type PlatformEventName = keyof typeof PLATFORM_EVENTS;

/** `in.<product>.<module>.<Event>.v1` for a platform event. */
export function platformEventType(product: string, event: PlatformEventName, version = 1): string {
  const e = PLATFORM_EVENTS[event];
  return `in.${product.toLowerCase()}.${e.module}.${e.name}.v${version}`;
}

/** Payload schemas for the events whose shape the IPB fixes. */
export const SettingChangedData = z.object({
  key: z.string(),
  tier: SettingTier,
  scope_id: z.string().nullable(),
  old: z.unknown(),
  new: z.unknown(),
  actor: z.string(),
  mc_request_id: z.string().nullable(),
});

export const ApprovalEventData = z.object({
  request_id: z.string(),
  action: z.string(),
  risk_class: z.string(),
  maker_id: z.string(),
  state: z.string(),
  checker_id: z.string().optional(),
  delay_until: z.string().nullable().optional(),
});

export const ConfigGuardFailedData = z.object({
  app_name: z.string(),
  env: z.string(),
  /** Variable names only, never values (IPB-11 §11.6). */
  failing_names: z.array(z.string()),
});

export const CredentialsGeneratedData = z.object({
  run_id: z.string(),
  count: z.number().int().nonnegative(),
  rotated: z.boolean(),
});

/** IPB-01 §01.6.1 provider-routing event payloads. */
export const AdapterFailedOverData = z.object({
  port: z.string(),
  from_adapter: z.string(),
  to_adapter: z.string(),
  reason: z.string(),
  data_class_max: z.string(),
});

export const AdapterRecoveredData = z.object({ port: z.string(), adapter: z.string() });

export const ResidencyViolationBlockedData = z.object({
  port: z.string(),
  adapter: z.string(),
  data_class: z.string(),
  module: z.string(),
  trace_id: z.string(),
});

export const RoutingConfigChangedData = z.object({
  env: z.string(),
  diff_summary: z.string(),
  actor: z.string(),
  approver: z.string().nullable(),
});
