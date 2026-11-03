// ESTAMP port (IPB-01 ESTAMP; Finbyx PR-FBX-29, R1-D-52). Interfaces and fakes only: stamp duty is
// paid money, so `purchase` is a money-moving call (idempotency key, amount in paise, an approved
// maker-checker request, never an agent) and no vendor adapter exists until the owner approves one.
// NeSL is listed by IPB-01 as an ESTAMP alternative for bank documents; its Digital Document
// Execution (DDE) is modelled as optional methods of this port (`capabilities.dde*`).
import { z } from "zod";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { DocFileRef, OutputPrefix } from "./doc-file.js";
import { MoneyAuthorisation } from "./money.js";
import { AmountMinor } from "./payments.js";
import { classed } from "./payload-class.js";

const regulated = <T extends z.ZodType>(s: T): T => classed(s, "REGULATED");
const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/** Indian state or union territory code (ISO 3166-2:IN suffix, e.g. `MH`, `KA`, `DL`). */
export const StateCode = z.string().regex(/^[A-Z]{2}$/);

export const DutyQuoteRequest = z
  .object({
    state: internal(StateCode),
    /** The article of the state's Stamp Act schedule, e.g. `5(h)` or `loan_agreement`. */
    instrument: internal(z.string().min(1).max(80)),
    considerationMinor: regulated(AmountMinor),
  })
  .strict();

export const EstampParty = z
  .object({
    /** The product's reference for the party; the name is printed on the certificate. */
    partyRef: regulated(z.string().min(1).max(120)),
    name: regulated(z.string().min(1).max(200)),
  })
  .strict();

export const EstampPurchase = z
  .object({
    state: internal(StateCode),
    instrument: internal(z.string().min(1).max(80)),
    dutyMinor: regulated(AmountMinor),
    considerationMinor: regulated(AmountMinor),
    firstParty: EstampParty,
    secondParty: EstampParty,
    /** Who pays the duty and is named as purchaser. */
    purchaser: EstampParty,
    /** Where the certificate PDF is written. */
    outputPrefix: internal(OutputPrefix),
    authorisation: MoneyAuthorisation,
  })
  .strict();

export interface DutyQuote {
  dutyMinor: number;
  /** The RULES rule set and version that computed it (IPB-01: `quoteDuty` delegates to RULES). */
  ruleSet: string;
  ruleVersion: string;
}

export type EstampState = "pending" | "issued" | "failed" | "cancelled";

export interface EstampCertificate {
  certificateId: string;
  /** The issuing authority's certificate number; null until issued. */
  certificateNumber: string | null;
  state: EstampState;
  stateCode: string;
  instrument: string;
  dutyMinor: number;
  purchaserRef: string;
  /** The certificate PDF in STORAGE, once issued. */
  file: DocFileRef | null;
  vendorRef: string;
  adapter: string;
  issuedAt: string | null;
}

export const DdeRegistration = z
  .object({
    /** The executed-to-be document and its stamp certificate. */
    document: DocFileRef,
    certificateId: internal(z.string().min(1).max(120)),
    executants: z.array(EstampParty).min(1).max(20),
    outputPrefix: internal(OutputPrefix),
  })
  .strict();

export type DdeState = "registered" | "pending_execution" | "executed" | "expired" | "rejected";

export interface DdeRecord {
  ddeId: string;
  state: DdeState;
  /** Executants who have signed so far, by product reference. */
  executed: string[];
  vendorRef: string;
  adapter: string;
}

export interface EstampPort extends Port {
  /** Which states and instruments the adapter can stamp (a state it does not cover is refused). */
  covers(state: string, instrument: string): Promise<boolean>;
  quoteDuty(req: z.infer<typeof DutyQuoteRequest>, call?: PortCall): Promise<DutyQuote>;
  /** Money-moving: pays the duty and procures a certificate (`assertMoneyCall` first). */
  purchase(
    req: z.infer<typeof EstampPurchase>,
    idempotencyKey: string,
    call?: PortCall,
  ): Promise<EstampCertificate>;
  /** Links a certificate to the product's document record. */
  attach(certificateId: string, documentId: string): Promise<void>;
  /** Reads the certificate back from the issuing authority. */
  verify(certificateId: string): Promise<EstampCertificate>;
  /** Parses the event, then reads the certificate back; only that is trusted. */
  handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<EstampCertificate>;
  /** NeSL Digital Document Execution (optional; `capabilities.ddeRegister`). */
  ddeRegister?(
    req: z.infer<typeof DdeRegistration>,
    idempotencyKey: string,
    call?: PortCall,
  ): Promise<DdeRecord>;
  ddeStatus?(ddeId: string): Promise<DdeRecord>;
  /** The executed document with the information utility's record, written to STORAGE. */
  ddeDownloadExecuted?(ddeId: string): Promise<DocFileRef>;
}
