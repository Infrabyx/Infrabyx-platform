// KYC port (IPB-01 KYC; Finbyx platform request PR-FBX-01, owner 29 Oct 2026, R1-D-21). The
// interface is IPB-01's list; adapters wait for the owner's vendor choices (OWNER-QUESTIONS #87).
// Every input and result is REGULATED and stays `IN`. Documents, frames and recordings travel by
// STORAGE reference with their SHA-256, never inline. An Aadhaar number is never returned or kept:
// results carry its last four digits only (no Aadhaar vault). Each result names the vendor's
// reference and model version, so a decision can be traced and re-checked (IPB-01: V-CIP sessions
// store liveness score, face-match score, geo, official ID and vendor model version).
import { z } from "zod";
import type { Port, PortCall, WebhookRequestMeta } from "./common.js";
import { classed } from "./payload-class.js";

const regulated = <T extends z.ZodType>(s: T): T => classed(s, "REGULATED");

/** The methods of the port; routing (`int.kyc.<method>.provider`) chooses an adapter per method. */
export const KYC_METHODS = [
  "pan",
  "aadhaar_offline",
  "digilocker",
  "ckyc_search",
  "ckyc_download",
  "vcip",
  "liveness",
  "face_match",
  "bank_account",
  "ovd_ocr",
  "aml_screen",
] as const;
export type KycMethod = (typeof KYC_METHODS)[number];

export const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** A file in STORAGE: its key and SHA-256 (a document, a frame, an XML, a recording). */
export const KycFileRef = z
  .object({
    storageKey: regulated(z.string().min(1).max(1024)),
    sha256: regulated(z.string().regex(/^[0-9a-f]{64}$/)),
  })
  .strict();
export type KycFileRef = z.infer<typeof KycFileRef>;

export const PanCheck = z
  .object({
    pan: regulated(z.string().regex(PAN)),
    name: regulated(z.string().min(1).max(200)),
    dob: regulated(z.iso.date()).optional(),
  })
  .strict();

export const AadhaarOfflineCheck = z
  .object({
    /** The Offline e-KYC XML (zip) or QR payload the customer shared, in STORAGE. */
    file: KycFileRef,
    shareCode: regulated(z.string().regex(/^[0-9]{4}$/)),
  })
  .strict();

export const DIGILOCKER_DOC_TYPES = ["ADHAR", "PANCR", "DRVLC", "VTRCD", "PSPRT"] as const;
export const DigilockerPull = z
  .object({
    /** The consent session the customer completed with DigiLocker. */
    consentSession: regulated(z.string().min(8).max(200)),
    docTypes: z.array(z.enum(DIGILOCKER_DOC_TYPES)).min(1).max(5),
  })
  .strict();

export const CKYC_ID_TYPES = [
  "PAN",
  "PASSPORT",
  "VOTER_ID",
  "DRIVING_LICENCE",
  "CKYC_NUMBER",
] as const;
export const CkycSearch = z
  .object({
    idType: z.enum(CKYC_ID_TYPES),
    idNumber: regulated(z.string().min(4).max(30)),
  })
  .strict();

export const CkycDownload = z
  .object({
    ckycNumber: regulated(z.string().regex(/^[0-9]{14}$/)),
    /** Authentication factor the registry requires (date of birth or mobile). */
    authFactor: regulated(z.string().min(4).max(20)),
    /** The customer's recorded consent to download (KYC 23(4)). */
    consentRef: z.string().min(3).max(200),
  })
  .strict();

export const VcipSession = z
  .object({
    /** The product's session id; the V-CIP room is created through VIDEO_MEET. */
    sessionId: z.string().min(3).max(200),
    tenantId: z.string().min(1),
    customerRef: z.string().min(3).max(200),
    /** The official conducting the call (KYC 27(3): the activity log names the official). */
    officialRef: z.string().min(3).max(200),
    /** VIDEO_MEET room of the call. */
    roomId: z.string().min(3).max(200),
    /** Documents the official checks against (OVD, PAN image), in STORAGE. */
    documents: z.array(KycFileRef).max(10),
  })
  .strict();

export const LivenessCheck = z.object({ frames: z.array(KycFileRef).min(1).max(30) }).strict();
export const FaceMatch = z.object({ a: KycFileRef, b: KycFileRef }).strict();

export const BankAccountCheck = z
  .object({
    ifsc: regulated(z.string().regex(IFSC)),
    accountNumber: regulated(z.string().regex(/^[0-9A-Z]{6,20}$/)),
    name: regulated(z.string().min(1).max(200)).optional(),
  })
  .strict();

export const OVD_TYPES = [
  "AADHAAR",
  "PAN",
  "PASSPORT",
  "VOTER_ID",
  "DRIVING_LICENCE",
  "NREGA_CARD",
] as const;
export const OvdOcr = z.object({ file: KycFileRef, docType: z.enum(OVD_TYPES) }).strict();

export const AmlParty = z
  .object({
    name: regulated(z.string().min(1).max(200)),
    dob: regulated(z.iso.date()).optional(),
    pan: regulated(z.string().regex(PAN)).optional(),
    nationality: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    kind: z.enum(["individual", "entity"]),
  })
  .strict();

/** What every result carries for traceability. */
export interface KycEvidence {
  /** The vendor's reference for the call. */
  vendorRef: string;
  adapter: string;
  /** The vendor's model or API version that produced the result. */
  modelVersion: string;
  checkedAt: string;
}

export type NameMatch = "match" | "partial" | "mismatch";

export interface PanResult extends KycEvidence {
  status: "valid" | "invalid" | "not_found";
  nameMatch: NameMatch;
  dobMatch?: boolean;
  aadhaarSeeded?: boolean;
}

export interface AadhaarOfflineResult extends KycEvidence {
  /** The UIDAI signature on the XML or QR verified. */
  signatureValid: boolean;
  /** Last four digits only; the number is never returned. */
  aadhaarLast4: string;
  name: string;
  dob?: string;
  gender?: "M" | "F" | "T";
  /** The photo, written to STORAGE. */
  photo?: KycFileRef;
  /** When UIDAI generated the file (the 3-working-day window is the product's rule). */
  generatedAt: string;
}

export interface DigilockerDocument {
  docType: (typeof DIGILOCKER_DOC_TYPES)[number];
  file: KycFileRef;
  issuer: string;
  issuedAt?: string;
}

export interface CkycSearchResult extends KycEvidence {
  found: boolean;
  ckycNumber?: string;
  name?: string;
  updatedAt?: string;
}

export interface CkycRecord extends KycEvidence {
  ckycNumber: string;
  /** The downloaded record and its images, in STORAGE. */
  record: KycFileRef;
  images: KycFileRef[];
}

export interface ScoreResult extends KycEvidence {
  /** 0 to 1. */
  score: number;
  /** Against the tenant's threshold (`int.kyc.vcip.liveness_threshold` and its face-match peer). */
  passed: boolean;
}

export interface VcipStart extends KycEvidence {
  vcipId: string;
  state: VcipState;
}

export const VCIP_STATES = [
  "scheduled",
  "in_progress",
  "completed",
  "rejected",
  "dropped",
  "expired",
] as const;
export type VcipState = (typeof VCIP_STATES)[number];

/** The session manifest (ADR-0010 of the product; IPB-01 KYC): what the call proved, by hash. */
export interface VcipManifest extends KycEvidence {
  vcipId: string;
  sessionId: string;
  state: VcipState;
  officialRef: string;
  liveness?: { score: number; passed: boolean };
  faceMatch?: { score: number; passed: boolean };
  /** Geo-tag of the customer during the call. */
  geo?: { lat: number; lon: number; country: string; capturedAt: string };
  startedAt?: string;
  endedAt?: string;
  /** Every artefact of the session in the tenant's storage target, by hash. */
  artefacts: Array<{
    kind: "video" | "audio" | "screenshot" | "document" | "transcript";
    file: KycFileRef;
  }>;
  /** Why a session was rejected or dropped. */
  reason?: string;
}

export interface BankAccountResult extends KycEvidence {
  status: "valid" | "invalid" | "closed" | "not_found";
  nameAtBank?: string;
  nameMatch?: NameMatch;
}

export interface OvdOcrResult extends KycEvidence {
  fields: Record<string, string>;
  /** 0 to 1; below `ai.ocr.human_review_below` the product routes to a person. */
  confidence: number;
}

export interface AmlHit {
  list: string;
  matchedName: string;
  score: number;
  listRef: string;
}

export interface AmlResult extends KycEvidence {
  hits: AmlHit[];
  lists: string[];
}

export interface KycPort extends Port {
  verifyPan(req: z.infer<typeof PanCheck>, call?: PortCall): Promise<PanResult>;
  verifyAadhaarOffline(
    req: z.infer<typeof AadhaarOfflineCheck>,
    call?: PortCall,
  ): Promise<AadhaarOfflineResult>;
  /** Documents written to STORAGE; the consent session is single use. */
  digilockerPull(
    req: z.infer<typeof DigilockerPull>,
    call?: PortCall,
  ): Promise<DigilockerDocument[]>;
  ckycSearch(req: z.infer<typeof CkycSearch>, call?: PortCall): Promise<CkycSearchResult>;
  ckycDownload(req: z.infer<typeof CkycDownload>, call?: PortCall): Promise<CkycRecord>;
  /** Start a V-CIP session in a VIDEO_MEET room; the result is read back with `vcipStatus`. */
  startVcip(session: z.infer<typeof VcipSession>, call?: PortCall): Promise<VcipStart>;
  vcipStatus(vcipId: string): Promise<VcipManifest>;
  livenessCheck(req: z.infer<typeof LivenessCheck>, call?: PortCall): Promise<ScoreResult>;
  faceMatch(req: z.infer<typeof FaceMatch>, call?: PortCall): Promise<ScoreResult>;
  bankAccountVerify(
    req: z.infer<typeof BankAccountCheck>,
    call?: PortCall,
  ): Promise<BankAccountResult>;
  /** Delegates to the OCR port where the adapter has no OCR of its own (`emulated`). */
  ovdOcr(req: z.infer<typeof OvdOcr>, call?: PortCall): Promise<OvdOcrResult>;
  amlScreen(party: z.infer<typeof AmlParty>, call?: PortCall): Promise<AmlResult>;
  /** Parses a V-CIP event, then reads the session back from the vendor; only that is trusted. */
  handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<VcipManifest>;
}
