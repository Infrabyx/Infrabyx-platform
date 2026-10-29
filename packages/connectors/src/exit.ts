// Exit as a design property (IPB-01 §01.4.13, IPB-01-38; PL6 plan §9.2): for every port this
// package builds adapters for, the reference primary, the alternative kept green in CI that an exit
// moves to, how the data moves, the data volume class of the reference deployment, and what cannot
// move (the lock-in residue) with its mitigation. `scripts/exit-runbook.mjs` turns this, the port
// catalogue's RTO tiers, a product's routing file and the drill records into
// `docs/exit/EXIT_RUNBOOK.md`. Adapter names are the descriptors' `adapter` values.
import type { PortName } from "@infrabyx/contracts/ports";

export type DataVolumeClass = "S" | "M" | "L";

export interface PortExit {
  port: PortName;
  /** The reference deployment's primary adapter (a product's routing file overrides it). */
  primary: string;
  /** The alternative adapter an exit moves to; kept green in the port's contract leg. */
  exitTarget: string;
  /**
   * Set only while the port's alternative is not built yet (`exitTarget` is then "none"): why,
   * and the decision it waits for. The runbook shows the gap instead of an exit target.
   */
  pending?: string;
  /** How the data (or the configuration) moves. */
  dataMove: string;
  /** S (< 100 GB), M (< 1 TB), L (> 1 TB) for the reference deployment. */
  volumeClass: DataVolumeClass;
  /** What cannot move and the mitigation; "None" when everything moves. */
  lockIn: string;
}

export const PORT_EXIT: readonly PortExit[] = [
  {
    port: "IDENTITY",
    primary: "keycloak",
    exitTarget: "zitadel",
    dataMove:
      "Users, roles and tenant attributes provisioned at the target by SCIM from the source; clients re-created from the realm as code",
    volumeClass: "S",
    lockIn:
      "Password hashes and passkeys do not move between identity providers: users set a new password on first sign-in and re-register passkeys and authenticators",
  },
  {
    port: "AUTHZ",
    primary: "cerbos",
    exitTarget: "openfga",
    dataMove:
      "Policies are code in the repository; relationship tuples generated at the target from the tenancy role assignments",
    volumeClass: "S",
    lockIn: "None",
  },
  {
    port: "KMS",
    primary: "aws-kms",
    exitTarget: "vault-transit",
    dataMove:
      "Every data key re-wrapped under the target's key (`FieldEnvelope` re-wrap); field ciphertexts are unchanged",
    volumeClass: "S",
    lockIn:
      "Key material of the source cannot be exported: the source keys stay enabled until every data key is re-wrapped, then are scheduled for deletion",
  },
  {
    port: "SECRETS",
    primary: "aws-sm",
    exitTarget: "vault",
    dataMove: "Each secret copied by path, then rotated at the target on cut-over",
    volumeClass: "S",
    lockIn: "None",
  },
  {
    port: "STORAGE",
    primary: "s3",
    exitTarget: "minio",
    dataMove:
      "`replicateTo` per bucket class with a manifest and SHA-256 verification of every object",
    volumeClass: "M",
    lockIn:
      "Object Lock retention and legal holds are re-applied at the target from the manifest; the source buckets keep their locks until the retention ends",
  },
  {
    port: "QUEUE",
    primary: "bullmq",
    exitTarget: "pg-boss",
    dataMove:
      "Producers paused, in-flight jobs drained, then the route switched; jobs are idempotent by key and the outboxes re-deliver anything lost",
    volumeClass: "S",
    lockIn: "None",
  },
  {
    port: "WORKFLOW",
    primary: "temporal",
    exitTarget: "temporal-cloud",
    dataMove:
      "Drain then restart: new executions start on the target while running ones finish on the source (Worker Versioning)",
    volumeClass: "S",
    lockIn:
      "Workflow histories do not move; long-running workflows restart from their durable state in PostgreSQL. Temporal Cloud takes INTERNAL inputs only (PL2-D-16)",
  },
  {
    port: "FEATURE_FLAG",
    primary: "unleash",
    exitTarget: "config-db",
    dataMove:
      "The flag registry synchronised into the target; tenant overrides exported and replayed",
    volumeClass: "S",
    lockIn: "None",
  },
  {
    port: "OBSERVABILITY",
    primary: "otel",
    exitTarget: "otel",
    dataMove: "The OpenTelemetry Collector's exporters re-pointed at the target backend",
    volumeClass: "M",
    lockIn: "Telemetry history stays in the source backend until its retention ends",
  },
  {
    port: "EMAIL",
    primary: "ses",
    exitTarget: "brevo",
    dataMove: "Configuration swap; the suppression list exported and imported",
    volumeClass: "S",
    lockIn:
      "Sending reputation is rebuilt at the target: DKIM and SPF re-verified and volume ramped over about two weeks",
  },
  {
    port: "SMS",
    primary: "msg91",
    exitTarget: "gupshup-sms",
    dataMove: "Configuration swap",
    volumeClass: "S",
    lockIn:
      "DLT headers and templates are registered per provider: re-registered at the target (allow seven days)",
  },
  {
    port: "WHATSAPP",
    primary: "meta-cloud",
    exitTarget: "gupshup",
    dataMove: "Configuration swap; message templates re-submitted for approval",
    volumeClass: "S",
    lockIn:
      "The business number is tied to its provider: migrated with the provider's number migration, or a new number registered and announced",
  },
  {
    port: "PUSH",
    primary: "fcm",
    exitTarget: "expo",
    dataMove: "Configuration swap; device tokens re-registered by the apps on their next start",
    volumeClass: "S",
    lockIn: "None",
  },
  {
    port: "PAYMENTS",
    primary: "razorpay",
    exitTarget: "cashfree",
    dataMove:
      "Configuration swap for new payments; settlements and refunds of earlier payments finish at the source",
    volumeClass: "S",
    lockIn:
      "Mandates (e-NACH, UPI AutoPay) are tied to the payment aggregator: customers re-authorise at the target",
  },
  {
    port: "ESIGN",
    primary: "leegality",
    exitTarget: "digio",
    dataMove:
      "Configuration swap for new envelopes; signed documents and their audit trails are already held in STORAGE",
    volumeClass: "S",
    lockIn: "Envelopes in flight at cut-over complete at the source",
  },
  {
    port: "KYC",
    primary: "digio-kyc",
    exitTarget: "none",
    pending:
      "The alternative (IDfy or HyperVerge, owner answer #87) is not built until the owner chooses one (OWNER-QUESTIONS #91)",
    dataMove:
      "Configuration swap per method for new checks; documents and results are already held in STORAGE and the product's records",
    volumeClass: "S",
    lockIn:
      "KYC requests the customer has not completed at cut-over are started again at the target",
  },
  {
    port: "RULES",
    primary: "zen",
    exitTarget: "json-rules",
    dataMove: "Decision tables are code in the repository; the routing swaps the evaluator",
    volumeClass: "S",
    lockIn: "None",
  },
  {
    port: "LLM",
    primary: "bedrock-claude-in",
    exitTarget: "gemini-vertex-asia-south1",
    dataMove: "Model route swap in the AI gateway after the target passes the eval gate (IPB-03)",
    volumeClass: "S",
    lockIn: "Prompts are re-evaluated per model against the golden sets before the swap",
  },
  {
    port: "EMBEDDING",
    primary: "bedrock-claude-in",
    exitTarget: "gemini-vertex-asia-south1",
    dataMove: "The retrieval corpus re-embedded into a new index, then the index alias switched",
    volumeClass: "S",
    lockIn: "Vectors are model-specific: the corpus is re-embedded, not copied",
  },
  {
    port: "IMAGE_GEN",
    primary: "gemini-imagen",
    exitTarget: "flux-self-hosted",
    dataMove: "Model route swap in the AI gateway; generated images are already held in STORAGE",
    volumeClass: "S",
    lockIn: "None",
  },
  {
    port: "MEDIA",
    primary: "sharp",
    exitTarget: "passthrough",
    dataMove: "Configuration swap; renditions already held in STORAGE stay valid",
    volumeClass: "S",
    lockIn:
      "Without an image library new uploads are served as uploaded (no re-encoding) until another MEDIA adapter is wired",
  },
];
