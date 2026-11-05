// DISPATCH port (Finbyx PR-FBX-41; ADR-0008; R1-D-104): sending a document (a recovery notice, a
// demand letter) to a person by post, with tracking and the proof of booking and of delivery or
// return kept as evidence in the tenant's own STORAGE. India Post Speed Post first; couriers,
// print-to-post and newspaper publication later. Interfaces, the in-memory fake and the contract
// cases only; an adapter waits for a tenant's choice and the owner's word (an external account).
// The rules every adapter keeps:
//   * a dispatch is made by a person (or the product's service on a person's behalf), never an agent;
//   * it is idempotent on its key: the same request again is the same dispatch; another request
//     under the key is refused (IPB-PORT-004);
//   * the document sent is the one named, by its SHA-256: the booking evidence records that hash;
//   * proof is stored in the tenant's STORAGE under the request's evidence prefix: the booking
//     receipt once booked, then the proof of delivery or of return once the dispatch is final;
//     a proof that does not exist yet is refused (IPB-PORT-003);
//   * delivered, returned, failed and cancelled are final; only an unbooked dispatch is cancelled.
import { z } from "zod";
import type { Port, PortCall } from "./common.js";
import { DocFileRef, OutputPrefix } from "./doc-file.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");
const confidential = <T extends z.ZodType>(s: T): T => classed(s, "CONFIDENTIAL");

export const DISPATCH_CHANNELS = [
  "india_post_speed_post",
  "courier",
  "print_to_post",
  "newspaper_publication",
] as const;
export type DispatchChannel = (typeof DISPATCH_CHANNELS)[number];

export const DISPATCH_STATES = [
  "queued",
  "booked",
  "in_transit",
  "delivered",
  "returned",
  "failed",
  "cancelled",
] as const;
export type DispatchState = (typeof DISPATCH_STATES)[number];
/** States a dispatch never leaves. */
export const FINAL_DISPATCH_STATES: readonly DispatchState[] = [
  "delivered",
  "returned",
  "failed",
  "cancelled",
];

/** A postal address in India (personal data). */
export const PostalAddress = z
  .object({
    name: z.string().min(1).max(120),
    lines: z.array(z.string().min(1).max(120)).min(1).max(4),
    city: z.string().min(1).max(80),
    state: z.string().min(2).max(60),
    pincode: z.string().regex(/^[1-9][0-9]{5}$/, "a six-digit PIN code"),
  })
  .strict();
export type PostalAddress = z.infer<typeof PostalAddress>;

export const DispatchRequest = z
  .object({
    /** Who sends it: a staff member, or the product's service on their behalf. */
    initiatedBy: internal(
      z.object({ type: z.enum(["user", "service"]), id: z.string().min(3).max(120) }).strict(),
    ),
    channel: internal(z.enum(DISPATCH_CHANNELS)),
    /** The document sent, already in the tenant's STORAGE, by its SHA-256. */
    document: DocFileRef,
    addressee: confidential(PostalAddress),
    /** Why it is sent, e.g. `recovery.notice.demand`; kept with the dispatch. */
    purpose: internal(z.string().regex(/^[a-z][a-z0-9_.]{2,79}$/)),
    /** The product's reference of the person or case. */
    subjectRef: confidential(z.string().min(3).max(120)),
    /** Where the booking receipt and the proof of delivery or return are stored. */
    evidencePrefix: internal(OutputPrefix),
    idempotencyKey: internal(z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)),
  })
  .strict();
export type DispatchRequest = z.infer<typeof DispatchRequest>;

export interface DispatchHandle {
  dispatchId: string;
  state: DispatchState;
  /** The carrier's tracking number (a Speed Post article number), once booked. */
  trackingId: string | null;
  idempotencyKey: string;
}

export interface TrackingEvent {
  /** ISO 8601 instant. */
  at: string;
  /** The carrier's event code, as given. */
  code: string;
  description: string;
  location: string | null;
}

export interface DispatchStatus {
  dispatchId: string;
  channel: DispatchChannel;
  state: DispatchState;
  trackingId: string | null;
  purpose: string;
  /** The SHA-256 of the document sent. */
  documentSha256: string;
  bookedAt: string | null;
  deliveredAt: string | null;
  /** Why it came back (`refused`, `addressee_left`, `insufficient_address`, …), when returned. */
  returnReason: string | null;
  events: TrackingEvent[];
}

export const DISPATCH_PROOF_KINDS = [
  "booking_receipt",
  "proof_of_delivery",
  "proof_of_return",
] as const;
export type DispatchProofKind = (typeof DISPATCH_PROOF_KINDS)[number];

export interface DispatchProof {
  dispatchId: string;
  kind: DispatchProofKind;
  file: DocFileRef;
  contentType: string;
  /** The SHA-256 of the document sent, as the carrier's record binds it. */
  documentSha256: string;
  trackingId: string | null;
}

export interface DispatchPort extends Port {
  /** Send a document; idempotent on `idempotencyKey`. */
  dispatch(req: DispatchRequest, call?: PortCall): Promise<DispatchHandle>;
  /** The dispatch's state and tracking events so far. */
  status(dispatchId: string, call?: PortCall): Promise<DispatchStatus>;
  /**
   * Store a proof in the tenant's STORAGE: the booking receipt once booked, the proof of delivery
   * once delivered, the proof of return once returned. Refused (`IPB-PORT-003`) before it exists;
   * a second call returns the same stored proof.
   */
  storeProof(dispatchId: string, kind: DispatchProofKind, call?: PortCall): Promise<DispatchProof>;
  /** Cancel a dispatch that has not been booked. */
  cancel(dispatchId: string, call?: PortCall): Promise<DispatchHandle>;
}
