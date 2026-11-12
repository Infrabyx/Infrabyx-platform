// Two more cross-product events the Ecosystem Specification registers without a published schema
// (LawDocsComply PR-LDC-45 and PR-LDC-51; R1-D-123, R1-D-138): `EvidenceSubmitted` (§6.15, domain
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
    /** The Specification names no values; SEV1 (worst) to SEV4 here, [VERIFY] with the registry. */
    severity: z.enum(["SEV1", "SEV2", "SEV3", "SEV4"]),
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
