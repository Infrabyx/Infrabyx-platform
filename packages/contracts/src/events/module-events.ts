// Module lifecycle and legal-hold events of the Ecosystem Specification (Finbyx PR-FBX-43;
// R1-D-107): `ModuleAttached` and `ModuleDetached` (§6.16, domain `platform`), emitted by the
// product's entitlement service on ENABLED and on entering READ_ONLY (§11.1), and
// `LegalHoldChanged` (§6.14, domain `privacy`; deletion is suspended while a hold stands). The
// Specification names the payload fields but publishes no schema, so the names below are its words
// in snake case, checked against the registry schemas when they are published ([VERIFY]); unknown
// fields pass through.
import { z } from "zod";
import { LicenceSku } from "../module-lifecycle.js";

export const MODULE_ATTACHED_TYPE = "in.infrabyx.platform.ModuleAttached.v1";
export const MODULE_DETACHED_TYPE = "in.infrabyx.platform.ModuleDetached.v1";
export const LEGAL_HOLD_CHANGED_TYPE = "in.infrabyx.privacy.LegalHoldChanged.v1";

const moduleId = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/);
const entitlement = {
  entitlement_id: z.string().min(1).max(128),
  entitlement_version: z.number().int().min(1),
};

/** Idempotency key (tenantid, module_id, version). */
export const ModuleAttachedData = z
  .object({
    module_id: moduleId,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    capabilities: z.array(z.string().regex(/^mod\.[a-z0-9_.]+$/)).min(1),
    sku: LicenceSku,
    ...entitlement,
    /** Who approved the attachment (ids, never names). */
    approvers: z.array(z.string().min(1).max(128)).min(1),
  })
  .loose();
export type ModuleAttachedData = z.infer<typeof ModuleAttachedData>;

/** Idempotency key (tenantid, module_id, detached_at). Writes stop at once. */
export const ModuleDetachedData = z
  .object({
    module_id: moduleId,
    mode: z.literal("READ_ONLY"),
    detached_at: z.iso.datetime(),
    /** SHA-256 of the export pack, once produced (within 5 working days). */
    export_pack_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    /** How many records stay on legal hold. */
    records_on_hold: z.number().int().min(0),
    ...entitlement,
  })
  .loose();
export type ModuleDetachedData = z.infer<typeof ModuleDetachedData>;

/** Idempotency key (hold_id, version). Every holder suspends deletion of the scope while it stands. */
export const LegalHoldChangedData = z
  .object({
    hold_id: z.string().min(1).max(128),
    version: z.number().int().min(1),
    state: z.enum(["APPLIED", "RELEASED"]),
    scope: z
      .object({
        kind: z.enum(["PARTY", "LOAN", "CASE"]),
        ref: z.string().min(1).max(128),
      })
      .strict(),
    reason: z.string().min(3).max(500),
    start: z.iso.date(),
    end: z.iso.date().nullable(),
  })
  .loose();
export type LegalHoldChangedData = z.infer<typeof LegalHoldChangedData>;
