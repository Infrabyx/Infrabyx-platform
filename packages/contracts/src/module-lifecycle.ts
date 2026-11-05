// Attachable modules: the registry entry, the lifecycle and the entitlement (Ecosystem Spec §11.1;
// Finbyx PR-FBX-43; OWNER-QUESTIONS #123; R1-D-107). Pure: no I/O.
//   * The lifecycle is the Specification's: AVAILABLE → LICENSED → INSTALLED → CONFIGURED
//     (maker-checker) → CERTIFIED → ENABLED → READ_ONLY → DETACHED. AVAILABLE and LICENSED are
//     derived (no stored row: the entitlement decides); the rest are stored by the product.
//     `ModuleAttached` is emitted on ENABLED and `ModuleDetached` on entering READ_ONLY.
//   * An entitlement is the licence of a SKU for a tenant, with its dates, set only by Infrabyx
//     (two different platform people; `@infrabyx/tenancy` `TenantEntitlements`). A lapsed or revoked
//     licence refuses writes and keeps every record readable until the product's detach workflow.
import { z } from "zod";

export const MODULE_STATES = [
  "AVAILABLE",
  "LICENSED",
  "INSTALLED",
  "CONFIGURED",
  "CERTIFIED",
  "ENABLED",
  "READ_ONLY",
  "DETACHED",
] as const;
export type ModuleState = (typeof MODULE_STATES)[number];
/** The states a product stores; AVAILABLE and LICENSED come from the entitlement. */
export type StoredModuleState = Exclude<ModuleState, "AVAILABLE" | "LICENSED">;
/** Read-only states: reads and exports only. */
export const READ_ONLY_MODULE_STATES: readonly StoredModuleState[] = ["READ_ONLY", "DETACHED"];

/** The edges a stored module moves along (a product's trigger should hold the same list). */
export const MODULE_EDGES: readonly (readonly [StoredModuleState, StoredModuleState])[] = [
  ["INSTALLED", "CONFIGURED"],
  ["CONFIGURED", "CERTIFIED"],
  ["CERTIFIED", "ENABLED"],
  // A configuration change sends a configured or certified module back to CONFIGURED.
  ["CONFIGURED", "CONFIGURED"],
  ["CERTIFIED", "CONFIGURED"],
  // Detach: writes stop (READ_ONLY), the export pack is produced, then DETACHED; re-attach configures again.
  ["ENABLED", "READ_ONLY"],
  ["READ_ONLY", "DETACHED"],
  ["READ_ONLY", "CONFIGURED"],
  ["DETACHED", "CONFIGURED"],
];
export const canMoveModule = (from: StoredModuleState, to: StoredModuleState): boolean =>
  MODULE_EDGES.some(([a, b]) => a === from && b === to);

/** What a module guard refuses with (403). */
export const MODULE_GUARD_CODES = [
  "not_entitled",
  "not_enabled",
  "dependency_missing",
  "read_only",
] as const;
export type ModuleGuardCode = (typeof MODULE_GUARD_CODES)[number];

/** A licence SKU, e.g. `RECOVERY_CORE`. */
export const LicenceSku = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/, "an upper-case SKU");

/** The registry entry of an attachable module (`module.yaml`, Spec §11.1), in camel case. */
export const AttachableModule = z
  .object({
    /** `namespace.module`, e.g. `recovery.r1`. */
    id: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    product: z.enum(["FINBYX", "UDOFIN", "EQUATOR", "LAWDOCSCOMPLY", "LAWDOCS", "OPERATIONS_HUB"]),
    /** Other attachable modules (their ids) and the product's core modules it needs live. */
    requires: z
      .object({
        modules: z.array(z.string().regex(/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/)).max(20),
        core: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(20),
      })
      .strict(),
    capabilities: z.array(z.string().regex(/^mod\.[a-z0-9_.]+$/)).min(1),
    eventsProduced: z.array(z.string().regex(/^[A-Z][A-Za-z0-9]+$/)),
    eventsConsumed: z.array(z.string().regex(/^[A-Z][A-Za-z0-9]+$/)),
    apis: z.array(z.string().regex(/^\/[a-z0-9/{}_-]+$/)),
    permissions: z.array(z.string().regex(/^[a-z][a-z0-9_]*\.[a-z_]+\.[a-z_]+$/)),
    dataCategories: z.array(z.string().regex(/^[A-Z][A-Z_]+$/)).min(1),
    regulatoryRefs: z.array(z.string().min(3).max(200)),
    /** The retention class its records follow (detaching never deletes regulated records). */
    retentionClass: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    licenceSku: LicenceSku,
    uiSlots: z.array(z.string().regex(/^[a-z][a-z0-9_.]+$/)),
    migrations: z.array(z.string().regex(/^\d{4}_[a-z0-9_]+\.sql$/)).default([]),
  })
  .strict();
export type AttachableModule = z.infer<typeof AttachableModule>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "an ISO date");

/** A licence change raised by a platform person (#123): a grant with its dates, or a revocation. */
export const EntitlementChangeInput = z
  .object({
    sku: LicenceSku,
    kind: z.enum(["GRANT", "REVOKE"]),
    validFrom: isoDate,
    validUntil: isoDate.nullable().optional(),
    reason: z.string().trim().min(10).max(500),
  })
  .strict()
  .refine((e) => e.kind === "GRANT" || e.validUntil == null, {
    message: "a revocation has no end date",
    path: ["validUntil"],
  })
  .refine((e) => e.validUntil == null || e.validUntil >= e.validFrom, {
    message: "validUntil is on or after validFrom",
    path: ["validUntil"],
  });
export type EntitlementChangeInput = z.infer<typeof EntitlementChangeInput>;

export interface EntitlementVersion {
  id: string;
  sku: string;
  version: number;
  kind: "GRANT" | "REVOKE";
  validFrom: string;
  validUntil: string | null;
  reason: string;
  requestedBy: string;
  approvedBy: string;
  approvalId: string;
  recordedAt: string;
}

/**
 * The status of a SKU on a day from its latest version: ACTIVE (a grant covering the day),
 * NOT_YET (a grant starting later), LAPSED (a grant that ended), REVOKED, or NONE.
 */
export type EntitlementStatus = "ACTIVE" | "NOT_YET" | "LAPSED" | "REVOKED" | "NONE";
export function entitlementStatusOn(
  latest: Pick<EntitlementVersion, "kind" | "validFrom" | "validUntil"> | null,
  day: string,
): EntitlementStatus {
  if (!latest) return "NONE";
  if (latest.kind === "REVOKE") return "REVOKED";
  if (day < latest.validFrom) return "NOT_YET";
  if (latest.validUntil !== null && day > latest.validUntil) return "LAPSED";
  return "ACTIVE";
}

/** What the tenant is told of, and sees on its admin page (#123). */
export const ENTITLEMENT_NOTICE_KINDS = ["GRANT", "REVOKE", "LAPSE"] as const;
export type EntitlementNoticeKind = (typeof ENTITLEMENT_NOTICE_KINDS)[number];
