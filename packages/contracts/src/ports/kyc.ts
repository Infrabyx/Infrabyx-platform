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
import { verhoeffValid } from "../aadhaar.js";

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
  "aadhaar_otp",
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

/**
 * The two offline forms a resident can share (PR-UDF-039; R1-D-190): the Offline e-KYC ZIP, opened
 * with its four-digit share code, and the Secure QR (as printed on the Aadhaar letter or e-Aadhaar),
 * which has no share code.
 */
export const AADHAAR_OFFLINE_KINDS = ["xml_zip", "secure_qr"] as const;
export type AadhaarOfflineKind = (typeof AADHAAR_OFFLINE_KINDS)[number];

/**
 * Before any parse or vendor call the adapter reads `file` from its STORAGE and refuses a body whose
 * SHA-256 is not `file.sha256` (`IPB-PORT-001`, `meta.reason: "hash_mismatch"`). An adapter that
 * cannot verify a kind refuses it with `meta.reason: "unsupported"`.
 */
export const AadhaarOfflineCheck = z
  .object({
    /** Omitted: `xml_zip`, the only form before this field (PR-UDF-039). */
    kind: z.enum(AADHAAR_OFFLINE_KINDS).optional(),
    /** The Offline e-KYC ZIP, or the Secure QR's scanned payload, the customer shared, in STORAGE. */
    file: KycFileRef,
    /** Required for `xml_zip`; a Secure QR has none and is refused with one. */
    shareCode: regulated(z.string().regex(/^[0-9]{4}$/)).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const kind = r.kind ?? "xml_zip";
    if (kind === "xml_zip" && r.shareCode === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["shareCode"],
        message: "the Offline e-KYC ZIP needs its share code",
      });
    if (kind === "secure_qr" && r.shareCode !== undefined)
      ctx.addIssue({
        code: "custom",
        path: ["shareCode"],
        message: "a Secure QR has no share code",
      });
  });

export const DIGILOCKER_DOC_TYPES = ["ADHAR", "PANCR", "DRVLC", "VTRCD", "PSPRT"] as const;
export const DigilockerPull = z
  .object({
    /** The consent session the customer completed with DigiLocker. */
    consentSession: regulated(z.string().min(8).max(200)),
    docTypes: z.array(z.enum(DIGILOCKER_DOC_TYPES)).min(1).max(5),
  })
  .strict();

/**
 * Start a DigiLocker consent session (PR-UDF-040; R1-D-193). The adapter builds the vendor's
 * request, so a product never does. `returnUrl` is where DigiLocker sends the customer back: it
 * must be `https:`, carry no user name or password and no 12-digit run, and its host must be one of
 * the hosts the adapter was built with (exact names, none by default); anything else is refused
 * `IPB-PORT-001` with `meta.reason: "return_url_not_allowed"` before any vendor call.
 */
export const StartDigilocker = z
  .object({
    docTypes: z.array(z.enum(DIGILOCKER_DOC_TYPES)).min(1).max(5),
    /** The product's own page; it may carry the product's journey id, so CONFIDENTIAL. */
    returnUrl: classed(z.string().min(9).max(2048), "CONFIDENTIAL"),
  })
  .strict();

/** The fixed `meta.reason` of a refused `returnUrl` (PR-UDF-040). */
export const DIGILOCKER_RETURN_URL_REFUSED = "return_url_not_allowed";

const TWELVE_DIGIT_RUN = /(?<![0-9])[0-9]{12}(?![0-9])/;

/**
 * True when `url` may be a DigiLocker return address for an adapter built with `hosts`: `https:`,
 * no user information, no 12-digit run anywhere, and a host equal (ignoring case) to one of `hosts`.
 * Exact names only: no wildcard and no suffix match. Every platform adapter uses this check.
 */
export function digilockerReturnUrlAllowed(url: string, hosts: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "") return false;
  if (TWELVE_DIGIT_RUN.test(url)) return false;
  const host = u.hostname.toLowerCase();
  return hosts.some((h) => h.toLowerCase() === host);
}

// ---- Aadhaar OTP e-KYC (PR-UDF-041; R1-D-194) ----------------------------------------------------

/** What the resident gives for an OTP e-KYC: the Aadhaar number or a Virtual ID. */
export const AADHAAR_UID_KINDS = ["AADHAAR", "VID"] as const;
export type AadhaarUidKind = (typeof AADHAAR_UID_KINDS)[number];

/**
 * True when `uid` is a well-formed number of its kind: an Aadhaar number is 12 digits, the first 2
 * to 9, with a valid Verhoeff check digit; a Virtual ID is 16 digits with a valid Verhoeff check
 * digit. Digits only: a grouped form (`2345 6789 0124`, `2345-6789-0124`) is refused, so the
 * product strips spaces and hyphens before the call and nothing else is ever guessed at.
 */
export function aadhaarUidValid(uid: string, kind: AadhaarUidKind): boolean {
  const shape = kind === "AADHAAR" ? /^[2-9][0-9]{11}$/ : /^[0-9]{16}$/;
  return shape.test(uid) && verhoeffValid(uid);
}

/**
 * The fixed `meta.reason` labels of an Aadhaar OTP refusal (PR-UDF-041), each definite:
 * `uid_invalid` (the number or VID is malformed, or UIDAI does not know it), `mobile_not_linked`
 * (no mobile number is linked to it, so no OTP can be sent), `otp_invalid` (the code is wrong),
 * `otp_expired` (the transaction expired, was used, or is not known), `not_configured` (the adapter
 * was not built for a notified reporting entity, or lacks its KUA set-up).
 */
export const AADHAAR_OTP_REFUSALS = [
  "uid_invalid",
  "mobile_not_linked",
  "otp_invalid",
  "otp_expired",
  "not_configured",
] as const;
export type AadhaarOtpRefusal = (typeof AADHAAR_OTP_REFUSALS)[number];

/**
 * Ask UIDAI, through the adapter's KUA, to send an OTP to the mobile linked to `uid`. Only a
 * reporting entity notified under PML Act s.11A may use Aadhaar OTP e-KYC (KYC Directions 2025 para
 * 23 proviso (i) [VERIFY the paragraph against the Directions as published]); an adapter not built
 * with `notifiedEntity: true` refuses every call `not_configured` before any vendor call. `uid` is
 * REGULATED: it goes to the KUA and nowhere else, never into an answer, an error, a log or a stored
 * row, and the adapter drops it once the call returns. A `uid` that is not `aadhaarUidValid` is
 * refused `uid_invalid` before any vendor call.
 */
export const AadhaarOtpRequest = z
  .object({
    uid: regulated(z.string().max(64)),
    uidKind: classed(z.enum(AADHAAR_UID_KINDS), "INTERNAL"),
    /** The resident's consent to the e-KYC, as the product recorded it. */
    consent: classed(
      z
        .object({
          /** The version of the consent text shown. */
          version: z.string().min(1).max(50),
          /** SHA-256 of the consent text shown. */
          textHash: z.string().regex(/^[0-9a-f]{64}$/),
          /** When the resident consented (ISO 8601). */
          at: z.iso.datetime({ offset: true }),
        })
        .strict(),
      "INTERNAL",
    ),
  })
  .strict();

/** Verify the OTP the resident received; `otp` is UIDAI's six-digit code. */
export const AadhaarOtpVerify = z
  .object({
    /** The transaction `aadhaarOtpRequest` returned. */
    txn: regulated(z.string().min(8).max(200)),
    otp: regulated(z.string().regex(/^[0-9]{6}$/)),
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
  /** The form verified (PR-UDF-039); the platform's adapters always set it. */
  kind?: AadhaarOfflineKind;
  /** The UIDAI signature on the XML or QR verified. */
  signatureValid: boolean;
  /** Last four digits only; no field of the result carries more of the number. */
  aadhaarLast4: string;
  name: string;
  dob?: string;
  gender?: "M" | "F" | "T";
  /** The photo, written to STORAGE. */
  photo?: KycFileRef;
  /** When UIDAI generated the file (the 3-working-day window is the product's rule). */
  generatedAt: string;
}

/** An OTP sent by `aadhaarOtpRequest` (PR-UDF-041). */
export interface AadhaarOtpStart extends KycEvidence {
  /** The KUA's transaction handle, to pass to `aadhaarOtpVerify`; carries no 12-digit run. */
  txn: string;
  /** When the OTP can no longer be verified (ISO 8601). */
  expiresAt: string;
}

/** A verified Aadhaar OTP e-KYC (PR-UDF-041). No field carries a 12-digit or 16-digit run. */
export interface AadhaarOtpResult extends KycEvidence {
  /**
   * UIDAI's signed e-KYC response as the KUA returned it, written unchanged to the STORAGE the
   * adapter was built with, under the call's tenant and REGULATED, with its SHA-256. The platform's
   * adapters refuse to store a response that carries an Aadhaar number or VID (R1-D-194).
   */
  ekyc: KycFileRef;
  /** UIDAI's signature on the response as the KUA checked it; `null` when it does not report it. */
  signatureValid: boolean | null;
  /** The last four digits of the Aadhaar number (for a VID too); never more of it. */
  uidLast4: string;
}

/** A consent session started with `startDigilocker` (PR-UDF-040). */
export interface DigilockerStart extends KycEvidence {
  /** The session to pass to `digilockerPull` once the customer is back. */
  consentSession: string;
  /** The vendor's DigiLocker sign-in address for the customer (`https:`). */
  signInUrl: string;
  /** When the session can no longer be completed (ISO 8601). */
  expiresAt: string;
}

/**
 * A document pulled from DigiLocker. `file` is in the STORAGE the adapter was built with, under the
 * call's tenant and REGULATED; no storage key or `issuer` carries a 12-digit run.
 */
export interface DigilockerDocument {
  docType: (typeof DIGILOCKER_DOC_TYPES)[number];
  file: KycFileRef;
  issuer: string;
  issuedAt?: string;
  /**
   * The vendor's reference, adapter, model version and time of the pull (PR-UDF-040). The
   * platform's adapters and the fake always set it; optional in the type only so an implementer
   * outside the platform does not break in a minor (as `AadhaarOfflineResult.kind`).
   */
  evidence?: KycEvidence;
  /**
   * The issuer's signature on the document as the vendor checked it (KYC Directions 2025 paras
   * 17(11) and 23 proviso (iii) ask the RE to verify it); `null` when the vendor does not report it,
   * which the product records as "not reported". Always set by the platform's adapters and the fake.
   */
  signatureValid?: boolean | null;
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
  /**
   * Start a DigiLocker consent session (PR-UDF-040): the adapter builds the vendor's request and
   * checks `returnUrl` (see `StartDigilocker`). Each call is a new session; one that is not
   * completed simply expires. Optional on the interface so an implementer outside the platform does
   * not break in a minor; every platform adapter and the fake provide it (an adapter without
   * DigiLocker refuses it `unsupported`).
   */
  startDigilocker?(req: z.infer<typeof StartDigilocker>, call?: PortCall): Promise<DigilockerStart>;
  /**
   * Pull the documents of a completed consent session. They are written to the STORAGE the adapter
   * was built with, under the call's tenant and REGULATED, and returned by reference; no storage
   * key or issuer carries a 12-digit run. The consent session is single use: a second pull is
   * refused `consent_used`. A session the customer has not completed yet is refused
   * `consent_incomplete`, which does not use it up: the product may retry within the session.
   * Idempotent on `call.idempotencyKey` (PR-UDF-040): a retry with the same key and request returns
   * the documents the first pull stored, without a new vendor pull, instead of `consent_used`; the
   * same key with another session or other document types is refused `IPB-PORT-004`
   * (`meta.reason: "idempotency_conflict"`). The platform adapters keep a key for 24 hours.
   */
  digilockerPull(
    req: z.infer<typeof DigilockerPull>,
    call?: PortCall,
  ): Promise<DigilockerDocument[]>;
  /**
   * Aadhaar OTP e-KYC, step one (PR-UDF-041; see `AadhaarOtpRequest`): UIDAI sends an OTP to the
   * resident's linked mobile, and the answer is the transaction to verify and its expiry. Refusals,
   * all definite: `not_configured`, `uid_invalid`, `mobile_not_linked`. Each call is a new
   * transaction. Optional on the interface so an implementer outside the platform does not break in
   * a minor; every platform adapter and the fake provide it.
   */
  aadhaarOtpRequest?(
    req: z.infer<typeof AadhaarOtpRequest>,
    call?: PortCall,
  ): Promise<AadhaarOtpStart>;
  /**
   * Step two: verify the OTP; UIDAI's signed e-KYC response goes to the adapter's STORAGE and the
   * answer carries its reference, the signature result and the last four digits only. Refusals, all
   * definite: `not_configured`, `otp_invalid`, `otp_expired` (expired, used or unknown). Idempotent
   * on `call.idempotencyKey`: a retry with the same key and request returns the first answer (a
   * result, or an `otp_invalid` or `otp_expired` refusal) without a new vendor call; the same key
   * with another code or transaction is `IPB-PORT-004` (`meta.reason: "idempotency_conflict"`).
   * The platform adapters keep a key for 24 hours.
   */
  aadhaarOtpVerify?(
    req: z.infer<typeof AadhaarOtpVerify>,
    call?: PortCall,
  ): Promise<AadhaarOtpResult>;
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
