// COURT_DATA port (Finbyx PR-FBX-42; ADR-0009; R1-D-104): reading Indian court records — a case's
// status and next hearing by CNR, its hearing history, its orders, and a court's cause list for a
// day (to match listed cases). An aggregator or an eCourts adapter later; interfaces, the in-memory
// fake and the contract cases only. The rules every adapter keeps:
//   * it only reads: nothing is filed, listed or changed at any court;
//   * every result names its source and the time it was read (`source`, `fetchedAt`): it is what
//     the source said then, not a verified record; a product verifies an order before acting on it
//     (and only then emits `OrderRecorded`);
//   * a case is found by its CNR (16 characters) or by court, type, number and year; a case the
//     source does not know is `IPB-PORT-005`;
//   * an order's document is stored in the tenant's STORAGE under the request's output prefix, with
//     its SHA-256; a second call returns the same stored file.
import { z } from "zod";
import type { Port, PortCall } from "./common.js";
import { DocFileRef, OutputPrefix } from "./doc-file.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/** The Case Number Record: state and district codes (4 letters), establishment (2 digits), serial (6), year (4). */
export const CNR_PATTERN = /^[A-Z]{4}[0-9]{2}[0-9]{6}(19|20)[0-9]{2}$/;
export const Cnr = z.string().regex(CNR_PATTERN, "a 16-character CNR");

/** A court establishment as the source codes it. */
export const CourtRef = z
  .object({
    /** e.g. `MH`, or `HC-BOM` for a High Court bench. */
    state: z.string().regex(/^[A-Z]{2}(-[A-Z]{2,6})?$/),
    district: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,32}$/)
      .nullable(),
    establishment: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  })
  .strict();
export type CourtRef = z.infer<typeof CourtRef>;

export const CaseLookup = z.union([
  z.object({ cnr: internal(Cnr) }).strict(),
  z
    .object({
      court: internal(CourtRef),
      caseType: internal(z.string().regex(/^[A-Za-z0-9.() -]{1,40}$/)),
      number: internal(z.string().regex(/^[0-9]{1,10}$/)),
      year: internal(z.number().int().min(1900).max(2100)),
    })
    .strict(),
]);
export type CaseLookup = z.infer<typeof CaseLookup>;

export interface CourtSource {
  /** The adapter, e.g. `ecourts` or an aggregator's name. */
  adapter: string;
  /** ISO 8601 instant the source was read. */
  fetchedAt: string;
}

export interface CourtCase {
  cnr: string;
  court: CourtRef;
  caseType: string;
  number: string;
  year: number;
  /** As the source states it (party names: personal data). */
  title: string;
  status: "pending" | "disposed";
  stage: string | null;
  /** ISO dates (YYYY-MM-DD). */
  filedOn: string | null;
  registeredOn: string | null;
  nextHearingOn: string | null;
  disposedOn: string | null;
  source: CourtSource;
}

export interface Hearing {
  /** ISO date. */
  on: string;
  purpose: string | null;
  business: string | null;
  judge: string | null;
}

export const ORDER_KINDS = ["order", "judgment", "decree", "interim_order"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export interface CourtOrderRef {
  cnr: string;
  /** The source's id of the order, stable for `fetchOrder`. */
  orderId: string;
  kind: OrderKind;
  /** ISO date. */
  on: string;
  source: CourtSource;
}

export interface StoredCourtOrder extends CourtOrderRef {
  file: DocFileRef;
  contentType: string;
}

export const CauseListRequest = z
  .object({
    court: internal(CourtRef),
    /** ISO date. */
    on: internal(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  })
  .strict();
export type CauseListRequest = z.infer<typeof CauseListRequest>;

export interface CauseListEntry {
  item: number;
  cnr: string | null;
  caseNumber: string;
  purpose: string | null;
  bench: string | null;
}

export interface CauseList {
  court: CourtRef;
  on: string;
  entries: CauseListEntry[];
  source: CourtSource;
}

export const FetchOrderRequest = z
  .object({
    cnr: internal(Cnr),
    orderId: internal(z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/)),
    outputPrefix: internal(OutputPrefix),
  })
  .strict();
export type FetchOrderRequest = z.infer<typeof FetchOrderRequest>;

export interface CourtDataPort extends Port {
  /** A case's status and next hearing. */
  lookupCase(req: CaseLookup, call?: PortCall): Promise<CourtCase>;
  /** The case's hearings, oldest first. */
  hearings(cnr: string, call?: PortCall): Promise<Hearing[]>;
  /** The case's orders, oldest first. */
  orders(cnr: string, call?: PortCall): Promise<CourtOrderRef[]>;
  /** Store an order's document in the tenant's STORAGE; a second call returns the same file. */
  fetchOrder(req: FetchOrderRequest, call?: PortCall): Promise<StoredCourtOrder>;
  /** A court's cause list for a day. */
  causeList(req: CauseListRequest, call?: PortCall): Promise<CauseList>;
}
