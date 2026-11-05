// ODR port (Finbyx PR-FBX-44; Ecosystem Spec §2 product ports and Part 8.9 `OdrProvider`; ADR-0010;
// R1-D-104): referring a dispute to an online dispute resolution institution, its status, and the
// settlement or award it produces. Each adapter is one provider (an `OdrProvider` in the
// Specification's words): Equator Resolution, another institution, or a file or portal-manual
// fallback. Interfaces, the in-memory fake and an Equator stub only. The rules every adapter keeps:
//   * provider-neutral (Spec 6.9, 8.1): a provider is chosen by the party, or by the parties under
//     their agreement's clause, never by default; the request says which;
//   * a referral carries its basis: the agreement's clause naming the institution, or the party's
//     written post-dispute consent (A&C Act s.7), by reference; the product's gates (Spec 8.2) run
//     before the call and are not re-decided here;
//   * a provider with a disclosure (Equator: "Equator Resolution is an Infrabyx group company")
//     refuses a referral that does not acknowledge that exact disclosure as shown (IPB-PORT-003);
//   * a referral is made by a person or by the product's service on a person's behalf, never an
//     agent; it is idempotent on its key (another request under the key is IPB-PORT-004);
//   * a settlement or award is stored in the tenant's STORAGE under the referral's output prefix,
//     with its SHA-256; asked before there is one, IPB-PORT-003.
import { z } from "zod";
import type { Port, PortCall } from "./common.js";
import { DocFileRef, OutputPrefix } from "./doc-file.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");
const confidential = <T extends z.ZodType>(s: T): T => classed(s, "CONFIDENTIAL");

/** How a provider offers each capability (Spec 8.9). */
export const ODR_MODES = ["API", "WEBHOOK", "FILE", "PORTAL_MANUAL"] as const;
export type OdrMode = (typeof ODR_MODES)[number];
export const ODR_CAPABILITIES = ["refer", "status", "withdraw", "outcome"] as const;
export type OdrCapability = (typeof ODR_CAPABILITIES)[number];

export const ODR_PROCESSES = [
  "negotiation",
  "conciliation",
  "mediation",
  "arbitration",
  "lok_adalat",
] as const;
export type OdrProcess = (typeof ODR_PROCESSES)[number];

export const ODR_STATES = [
  "referred",
  "screening",
  "returned_for_info",
  "screen_rejected",
  "accepted",
  "in_progress",
  "settled",
  "award_signed",
  "non_settlement",
  "withdrawn",
  "closed",
] as const;
export type OdrState = (typeof ODR_STATES)[number];
/** States after which the referral moves no further through this port. */
export const FINAL_ODR_STATES: readonly OdrState[] = [
  "screen_rejected",
  "non_settlement",
  "withdrawn",
  "closed",
];
/** States in which a settlement or award record exists. */
export const ODR_OUTCOME_STATES: readonly OdrState[] = ["settled", "award_signed"];

/** What a provider tells every party before it is chosen (empty statement: nothing to disclose). */
export interface OdrDisclosure {
  provider: string;
  /** True when the provider shares ownership with Infrabyx. */
  groupCompany: boolean;
  /** The exact words shown, and their version. */
  statement: string | null;
  version: number;
}

export const OdrReferralRequest = z
  .object({
    initiatedBy: internal(
      z.object({ type: z.enum(["user", "service"]), id: z.string().min(3).max(120) }).strict(),
    ),
    /** The product's dispute (or loan) reference. */
    disputeRef: confidential(z.string().min(3).max(120)),
    process: internal(z.enum(ODR_PROCESSES)),
    /** Who chose this provider: never a default. */
    selectedBy: internal(z.enum(["party", "parties_under_clause"])),
    /** The basis: the clause naming the institution, or post-dispute written consent, by reference. */
    basis: internal(
      z
        .object({
          kind: z.enum(["agreement_clause", "post_dispute_consent"]),
          ref: z.string().min(3).max(120),
        })
        .strict(),
    ),
    parties: confidential(
      z
        .array(
          z
            .object({
              role: z.enum(["claimant", "respondent"]),
              partyRef: z.string().min(3).max(120),
            })
            .strict(),
        )
        .min(2)
        .max(20),
    ),
    /** The claim, in rupees (`"125000.00"`), when there is one. */
    claimInr: internal(
      z
        .string()
        .regex(/^\d{1,13}\.\d{2}$/)
        .nullable(),
    ),
    /** The case file, already in the tenant's STORAGE. */
    documents: z.array(DocFileRef).max(50),
    /** The provider's disclosure as shown to the party (its version), when it has one. */
    disclosureShown: internal(
      z
        .object({ version: z.number().int().min(1) })
        .strict()
        .nullable(),
    ),
    /** Where the settlement or award is stored. */
    outputPrefix: internal(OutputPrefix),
    idempotencyKey: internal(z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)),
  })
  .strict();
export type OdrReferralRequest = z.infer<typeof OdrReferralRequest>;

export interface OdrReferralHandle {
  referralId: string;
  /** The provider's case number, once it has one. */
  caseRef: string | null;
  state: OdrState;
  idempotencyKey: string;
}

export interface OdrReferralStatus extends OdrReferralHandle {
  provider: string;
  process: OdrProcess;
  /** ISO 8601 instants. */
  referredAt: string;
  updatedAt: string;
  nextHearingAt: string | null;
  reason: string | null;
}

export interface OdrOutcome {
  referralId: string;
  kind: "settlement" | "award";
  file: DocFileRef;
  contentType: string;
  /** ISO date the settlement was signed or the award made. */
  on: string;
}

export interface OdrPort extends Port {
  /** The provider's disclosure, shown to parties before they choose it. */
  disclosure(): OdrDisclosure;
  /** How the provider offers each capability. */
  modes(): Readonly<Record<OdrCapability, OdrMode>>;
  /** Refer a dispute; idempotent on `idempotencyKey`. */
  refer(req: OdrReferralRequest, call?: PortCall): Promise<OdrReferralHandle>;
  status(referralId: string, call?: PortCall): Promise<OdrReferralStatus>;
  /** Withdraw a referral that has no outcome yet. */
  withdraw(referralId: string, reason: string, call?: PortCall): Promise<OdrReferralHandle>;
  /** Store the settlement or award in the tenant's STORAGE; a second call returns the same file. */
  outcome(referralId: string, call?: PortCall): Promise<OdrOutcome>;
}
