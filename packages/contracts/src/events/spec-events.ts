// Two more cross-product events the Ecosystem Specification registers without a published schema
// (LawDocsComply PR-LDC-45 and PR-LDC-51; R1-D-123, R1-D-138), and `ObligationPublished`, whose
// payload spec v1.5 fixes (§6.15; R1-D-144, R1-D-151): `EvidenceSubmitted` (§6.15, domain
// `grc`, any product → LDC) and `ProviderIncident` (§6.16, domain `platform`, the detecting
// product → OH13, products on the same adapter, LDC). The field names are the Specification's
// words in snake case, checked against the registry schemas when they are published ([VERIFY]);
// unknown fields pass through, as for the module events.
import { z } from "zod";

export const EVIDENCE_SUBMITTED_TYPE = "in.infrabyx.grc.EvidenceSubmitted.v1";
export const PROVIDER_INCIDENT_TYPE = "in.infrabyx.platform.ProviderIncident.v1";

const id = z.string().regex(/^[A-Za-z0-9_.:-]{3,128}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Idempotency key `evidence_id`. The artefacts are references (`storage:` keys or https URIs) with
 * their SHA-256, never the files; the signer is an id, never a name.
 */
export const EvidenceSubmittedData = z
  .object({
    evidence_id: id,
    control_id: id,
    artefacts: z
      .array(
        z
          .object({
            uri: z
              .string()
              .max(2048)
              .regex(/^(https:\/\/|storage:)/, "an https URI or a storage: key"),
            sha256,
            media_type: z.string().max(127).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    signer: z
      .object({ type: z.enum(["user", "service"]), id: z.string().min(3).max(128) })
      .strict(),
    collected_at: z.iso.datetime({ offset: true }),
    period: z
      .object({ from: z.iso.date(), to: z.iso.date() })
      .strict()
      .refine((p) => p.from <= p.to, "period.from is after period.to")
      .optional(),
  })
  .loose();
export type EvidenceSubmittedData = z.infer<typeof EvidenceSubmittedData>;

export const PROVIDER_INCIDENT_STATUSES = ["OPEN", "DEGRADED", "RECOVERED"] as const;

/**
 * The `ProviderIncident` severity scale (owner answer #131, R1-D-155; the Specification names
 * none). `SEV1` is the most severe. Choose by the impact on the product's callers at the time
 * of the event, and emit a new event (same `incident_id`) when the severity changes:
 * - `SEV1`: a capability is unavailable and no adapter is serving it (no failover).
 * - `SEV2`: a capability works for few callers, or a failover is serving it with reduced function.
 * - `SEV3`: partial or intermittent degradation; the capability works for most callers.
 * - `SEV4`: no caller-visible impact (a failover with full function, or a precautionary block).
 */
export const PROVIDER_INCIDENT_SEVERITIES = ["SEV1", "SEV2", "SEV3", "SEV4"] as const;

/**
 * Idempotency key (incident_id, status). `dataclass = INTERNAL`; never tenant ids (the schema
 * refuses a `tenant_id` or `tenant_ids` field even though other unknown fields pass).
 */
export const ProviderIncidentData = z
  .object({
    incident_id: id,
    product: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/),
    port: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    adapter: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,63}$/),
    residency: z.enum(["IN", "GLOBAL"]),
    /** `SEV1` (most severe) to `SEV4`; see `PROVIDER_INCIDENT_SEVERITIES` (owner answer #131). */
    severity: z.enum(PROVIDER_INCIDENT_SEVERITIES),
    started_at: z.iso.datetime({ offset: true }),
    status: z.enum(PROVIDER_INCIDENT_STATUSES),
    eta: z.iso.datetime({ offset: true }).optional(),
    affected_capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/)).max(64),
  })
  .loose()
  .refine((d) => !("tenant_id" in d) && !("tenant_ids" in d) && !("tenantid" in d), {
    message: "a provider incident never carries tenant ids",
  });
export type ProviderIncidentData = z.infer<typeof ProviderIncidentData>;

export const OBLIGATION_PUBLISHED_TYPE = "in.infrabyx.grc.ObligationPublished.v1";
export const OBLIGATION_CHANGE_TYPES = ["ADDED", "AMENDED", "REPEALED"] as const;

/**
 * `ObligationPublished` (Ecosystem Spec v1.5 §6.15; PR-044, LawDocsComply PR-LDC-33; owner answer
 * #127): ids and keys only, `dataclass = INTERNAL`, no other field (`additionalProperties: false`).
 * Never the obligation's text: a consumer pulls it with `GET /v1/grc/obligations` and matches on
 * `(obligation_ref, version)`, the idempotency key. A lower `version` after a higher one is stored
 * and never applied over it (the consumer's rule, §14.3).
 */
export const ObligationPublishedData = z
  .object({
    obligation_ref: z.string().regex(/^obl_[0-9A-HJKMNP-TV-Z]{26}$/, "obl_ + ULID"),
    business_id: z.string().regex(/^[A-Za-z0-9_.:@/+=-]{1,128}$/),
    version: z.number().int().min(1),
    change_type: z.enum(OBLIGATION_CHANGE_TYPES),
    instrument_ref: z.string().regex(/^[\x20-\x7E]{1,128}$/, "1 to 128 printable characters"),
    authority: z.string().regex(/^[A-Z0-9_]{2,32}$/),
    family: z.string().regex(/^[a-z0-9_.]{2,64}$/),
    effective_from: z.iso.date(),
    effective_to: z.iso.date().optional(),
    release_id: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
    applicability_keys: z
      .array(z.string().regex(/^[a-z0-9_.:]{2,64}$/))
      .max(64)
      .refine((k) => new Set(k).size === k.length, "applicability_keys must not repeat"),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.change_type === "REPEALED" && d.effective_to === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["effective_to"],
        message: "REPEALED needs effective_to",
      });
    if (d.effective_to !== undefined && d.effective_to < d.effective_from)
      ctx.addIssue({
        code: "custom",
        path: ["effective_to"],
        message: "effective_to is before effective_from",
      });
  });
export type ObligationPublishedData = z.infer<typeof ObligationPublishedData>;

/**
 * The envelope rules §6.15 adds for this event: the type, `dataclass = INTERNAL`, and the
 * obligation as the event's `subject`. Returns the problems (empty when the event is valid).
 */
export function obligationPublishedProblems(e: {
  type: string;
  subject?: string;
  dataclass: string;
  data: unknown;
}): string[] {
  const out: string[] = [];
  if (e.type !== OBLIGATION_PUBLISHED_TYPE) out.push(`type must be ${OBLIGATION_PUBLISHED_TYPE}`);
  if (e.dataclass !== "INTERNAL") out.push("dataclass must be INTERNAL");
  const d = ObligationPublishedData.safeParse(e.data);
  if (!d.success)
    out.push(...d.error.issues.map((i) => `${i.path.join(".") || "data"}: ${i.message}`));
  else if (e.subject !== d.data.obligation_ref) out.push("subject must be the obligation_ref");
  return out;
}
