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
import { findAadhaarLike, verhoeffValid } from "../aadhaar.js";
import { PortError } from "../errors.js";

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
    /**
     * A session `launchVcip` scheduled (PR-UDF-045): the call starts that session instead of a new
     * one. Its `tenantId` and `customerRef` must be the hand-off's; it keeps the hand-off's journey
     * id as its `sessionId`. Omitted, a new session is started, as before.
     */
    vcipId: z.string().min(3).max(200).optional(),
  })
  .strict();

// ---- The RE-hosted V-CIP launcher (PR-UDF-045; R1-D-198) ----------------------------------------

/**
 * The longest a V-CIP hand-off may live, from `issuedAt` to `expiresAt`: 15 minutes. The signature
 * over it must also be fresh when it is presented (`verifyRegulatedMessage`'s `iat` window, five
 * minutes by default), so an LSP signs the hand-off right before it hands the customer over.
 */
export const VCIP_HANDOFF_MAX_LIFETIME_SECONDS = 900;
/** Clock skew allowed on a hand-off's `issuedAt` (as the regulated-message `iat` window's). */
export const VCIP_HANDOFF_MAX_SKEW_SECONDS = 60;

/**
 * The fixed `meta.reason` of a refused hand-off (`IPB-PORT-001`, definite), sent before any vendor
 * call: `handoff_invalid`, the context is malformed, outlives the bound, names another tenant or
 * RE or an LSP the adapter does not trust, or its signature does not verify over it (a tampered
 * JWS, or a JWS over another context); `handoff_replayed`, the signature's `jti` was accepted
 * before (a hand-off is single use); `handoff_expired`, the context or the signature is no longer
 * fresh.
 */
export const VCIP_HANDOFF_REFUSALS = [
  "handoff_invalid",
  "handoff_replayed",
  "handoff_expired",
] as const;
export type VcipHandoffRefusal = (typeof VCIP_HANDOFF_REFUSALS)[number];
/** The fixed `meta.reason` (`IPB-PORT-003`) of a launch address that is not `vcipLaunchUrlAllowed`. */
export const VCIP_LAUNCH_URL_REFUSED = "launch_url_invalid";

const HANDOFF_ID = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/, "an id: letters, digits and . _ : - only");
const HANDOFF_NONCE = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/, "22 to 64 base64url characters");
const HANDOFF_TIME = z.iso.datetime({ offset: true });
const holdsNumber = (v: string) => TWELVE_DIGIT_RUN.test(v) || findAadhaarLike(v).length > 0;

/**
 * What an LSP hands the RE's V-CIP when it hands a customer over (PR-UDF-045; KYC Directions 2025
 * para 27(1)(i): the RE conducts V-CIP, the LSP hosts no V-CIP component). Ids and times only:
 * the platform tenant, the RE, the LSP, the LSP's customer reference and journey id, when it was
 * issued and when it expires (at most `VCIP_HANDOFF_MAX_LIFETIME_SECONDS` later), and a fresh nonce.
 * Strict: no other field, no name, number or document. A field that carries a 12-digit run or an
 * Aadhaar-like number (`findAadhaarLike`) is refused. The LSP signs it with `signRegulatedMessage`
 * (the context as the signed object, its KMS key's `kid`); the RE side verifies it with
 * `verifyRegulatedMessage` and a replay store before anything else.
 */
export const VcipHandoffContext = z
  .object({
    tenantId: classed(HANDOFF_ID, "INTERNAL"),
    /** The regulated entity whose V-CIP the customer is handed to. */
    reId: classed(HANDOFF_ID, "INTERNAL"),
    /** The lending service provider that hands the customer over and signs the hand-off. */
    lspId: classed(HANDOFF_ID, "INTERNAL"),
    /** The LSP's own reference for the customer (never an identity number). */
    customerRef: classed(HANDOFF_ID, "CONFIDENTIAL"),
    /** The LSP's journey; the scheduled session's `sessionId`. */
    journeyId: classed(HANDOFF_ID, "CONFIDENTIAL"),
    issuedAt: classed(HANDOFF_TIME, "INTERNAL"),
    expiresAt: classed(HANDOFF_TIME, "INTERNAL"),
    nonce: classed(HANDOFF_NONCE, "INTERNAL"),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const [k, v] of Object.entries(c))
      if (holdsNumber(v))
        ctx.addIssue({ code: "custom", path: [k], message: "no 12-digit run or Aadhaar number" });
    const life = Date.parse(c.expiresAt) - Date.parse(c.issuedAt);
    if (!(life > 0 && life <= VCIP_HANDOFF_MAX_LIFETIME_SECONDS * 1000))
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: `a hand-off expires after its issue and within ${VCIP_HANDOFF_MAX_LIFETIME_SECONDS} s`,
      });
  });
export type VcipHandoffContext = z.infer<typeof VcipHandoffContext>;

/** `launchVcip`'s request: the hand-off context and the LSP's detached JWS over it. */
export const LaunchVcip = z
  .object({
    context: VcipHandoffContext,
    jws: classed(z.string().min(10).max(4096), "CONFIDENTIAL"),
  })
  .strict();

/**
 * The time checks of a hand-off whose signature verified, at `now`: issued no later than
 * `VCIP_HANDOFF_MAX_SKEW_SECONDS` ahead, and not yet expired. Undefined when both pass.
 */
export function vcipHandoffTimeRefusal(
  c: Pick<VcipHandoffContext, "issuedAt" | "expiresAt">,
  now: Date,
): VcipHandoffRefusal | undefined {
  const t = now.getTime();
  if (Date.parse(c.issuedAt) > t + VCIP_HANDOFF_MAX_SKEW_SECONDS * 1000) return "handoff_invalid";
  if (Date.parse(c.expiresAt) <= t) return "handoff_expired";
  return undefined;
}

/**
 * The hand-off label for a failed `verifyRegulatedMessage` (its `reason`): `replay` is
 * `handoff_replayed`, `stale` is `handoff_expired`, every other failure is `handoff_invalid`.
 */
export function vcipHandoffFailure(jwsFailure: string): VcipHandoffRefusal {
  if (jwsFailure === "replay") return "handoff_replayed";
  if (jwsFailure === "stale") return "handoff_expired";
  return "handoff_invalid";
}

/**
 * True when `url` may be a V-CIP launch address: as a DigiLocker return address
 * (`digilockerReturnUrlAllowed`: `https:`, no user information, no 12-digit run, a host equal to
 * one of `hosts`), and no Aadhaar-like number anywhere in it.
 */
export function vcipLaunchUrlAllowed(url: string, hosts: readonly string[]): boolean {
  return digilockerReturnUrlAllowed(url, hosts) && findAadhaarLike(url).length === 0;
}

// ---- Webhook verification without a vendor call (PR-UDF-046; R1-D-199) -------------------------

/** The largest V-CIP webhook body an adapter reads: 64 KiB. A larger one is refused unparsed. */
export const KYC_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
/** The window on a delivery's timestamp, either way: five minutes (IPB-10-21). */
export const KYC_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * The fixed `meta.reason` of a refused webhook (`IPB-API-018`, 401, definite), all decided before
 * any vendor call: `body_too_large`, over `KYC_WEBHOOK_MAX_BODY_BYTES`, refused before it is read;
 * `signature_invalid`, a header is missing or malformed or no signature verifies with the
 * provider's secret; `timestamp_stale`, the delivery's timestamp is more than
 * `KYC_WEBHOOK_TOLERANCE_SECONDS` from now either way; `event_replayed`, this delivery (its id and
 * timestamp) was accepted before. A provider's retry of one event carries the same id with a new
 * timestamp and signature, so it verifies again; the product's module inbox de-duplicates it by
 * `eventId` (IPB-10-27).
 */
export const KYC_WEBHOOK_REFUSALS = [
  "body_too_large",
  "signature_invalid",
  "timestamp_stale",
  "event_replayed",
] as const;
export type KycWebhookRefusal = (typeof KYC_WEBHOOK_REFUSALS)[number];
/** The fixed `meta.reason` (`IPB-PORT-001`, definite) of a verified event that names no session. */
export const KYC_WEBHOOK_MALFORMED = "malformed_event";

/** What a verified V-CIP webhook says, ids and a time only: enough to record and acknowledge it. */
export interface KycWebhookReceipt {
  /** The provider's delivery id (`webhook-id`), the same on every retry: the inbox key. */
  eventId: string;
  /** The session the event is about; read it back with `vcipStatus` (from the product's queue). */
  vcipId: string;
  /** When the adapter verified it, by the adapter's clock. */
  receivedAt: string;
}

/** `IPB-API-018` with a `KYC_WEBHOOK_REFUSALS` label, definite; it never carries the body. */
export function kycWebhookRefused(adapter: string, reason: KycWebhookRefusal): PortError {
  return new PortError("IPB-API-018", "KYC", {
    adapter,
    detail: `webhook refused: ${reason}`,
    meta: { reason, definite: true },
  });
}

/** A delivery replay store: true the first time a key is claimed (`@infrabyx/crypto` `ReplayStore`). */
export interface KycWebhookReplayStore {
  claim(key: string, expiresAt: Date): Promise<boolean>;
}

/** What `verifyKycWebhookWith` needs: the delivery, the scheme's check and the replay store. */
export interface KycWebhookCheck {
  adapter: string;
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string>>;
  /**
   * The provider's Standard Webhooks check over the raw body and these headers, e.g.
   * `verifyStandardWebhook` of `@infrabyx/crypto` with the provider's secrets: null when valid.
   */
  verify(h: {
    id: string;
    timestamp: string;
    signature: string;
  }): "headers" | "timestamp" | "signature" | null;
  /** Durable and shared by every instance in production (as the hand-offs' `jti` store). */
  replay: KycWebhookReplayStore;
  /** The provider's session id in a verified body (parsed JSON). */
  vcipIdOf(body: unknown): unknown;
  now: Date;
  toleranceSeconds?: number;
}

const headerOf = (h: Readonly<Record<string, string>>, name: string): string | undefined => {
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === name) return v;
  return undefined;
};

/**
 * Verify a V-CIP webhook without a vendor call (PR-UDF-046), in this order: the body's size
 * (before anything is parsed), the Standard Webhooks headers, the signature and timestamp (`verify`),
 * the delivery's replay claim, and only then the body's session id. Every refusal before the body
 * is parsed is `kycWebhookRefused`; a verified body naming no well-formed session is `IPB-PORT-001`
 * `malformed_event`, definite. The answer is a `KycWebhookReceipt`.
 */
export async function verifyKycWebhookWith(o: KycWebhookCheck): Promise<KycWebhookReceipt> {
  if (o.rawBody.byteLength > KYC_WEBHOOK_MAX_BODY_BYTES)
    throw kycWebhookRefused(o.adapter, "body_too_large");
  const id = headerOf(o.headers, "webhook-id");
  const timestamp = headerOf(o.headers, "webhook-timestamp");
  const signature = headerOf(o.headers, "webhook-signature");
  if (id === undefined || timestamp === undefined || signature === undefined)
    throw kycWebhookRefused(o.adapter, "signature_invalid");
  const failed = o.verify({ id, timestamp, signature });
  if (failed === "timestamp") throw kycWebhookRefused(o.adapter, "timestamp_stale");
  if (failed !== null) throw kycWebhookRefused(o.adapter, "signature_invalid");
  const tolerance = o.toleranceSeconds ?? KYC_WEBHOOK_TOLERANCE_SECONDS;
  const until = new Date((Number(timestamp) + tolerance) * 1000 + 60_000);
  if (!(await o.replay.claim(`kyc-webhook:${id}.${timestamp}`, until)))
    throw kycWebhookRefused(o.adapter, "event_replayed");
  const malformed = () =>
    new PortError("IPB-PORT-001", "KYC", {
      adapter: o.adapter,
      detail: "a V-CIP event names its session",
      meta: { reason: KYC_WEBHOOK_MALFORMED, definite: true },
    });
  let vcipId: unknown;
  try {
    vcipId = o.vcipIdOf(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(o.rawBody)));
  } catch {
    throw malformed();
  }
  if (
    typeof vcipId !== "string" ||
    !/^[A-Za-z0-9._:-]{3,200}$/.test(vcipId) ||
    TWELVE_DIGIT_RUN.test(vcipId) ||
    findAadhaarLike(vcipId).length > 0
  )
    throw malformed();
  return { eventId: id, vcipId, receivedAt: o.now.toISOString() };
}

/**
 * Why a session was rejected, dropped or expired (PR-UDF-045): a code, never free text, so nothing
 * an official types reaches the manifest's readers. `official_rejected`, the official rejected it
 * on grounds no other code names; `liveness_failed`; `face_mismatch`; `document_mismatch`, the
 * document shown does not match the record; `outside_india`, the customer's geo-tag; `customer_declined`,
 * the customer declined or withdrew consent; `customer_left`; `connection_lost`, the call broke;
 * `official_unavailable`; `launch_expired`, a launched session no official started before the
 * hand-off expired; `other`.
 */
export const VCIP_REASON_CODES = [
  "official_rejected",
  "liveness_failed",
  "face_mismatch",
  "document_mismatch",
  "outside_india",
  "customer_declined",
  "customer_left",
  "connection_lost",
  "official_unavailable",
  "launch_expired",
  "other",
] as const;
export type VcipReasonCode = (typeof VCIP_REASON_CODES)[number];

// ---- A mode the adapter cannot honour (PR-UDF-043, PR-UDF-044) ----------------------------------

/**
 * The fixed `meta.reason` of an `IPB-PORT-002` refusal from an adapter that cannot honour the mode a
 * call asked for (a bank account check's `mode`, a liveness check's `mode`). Definite, sent before
 * any vendor call, never followed by a fallback to another mode. The core router's breaker does not
 * count it and the KYC router moves on to the next adapter in the method's order.
 */
export const KYC_MODE_UNSUPPORTED = "mode_unsupported";

// ---- Liveness and face match (PR-UDF-044; R1-D-197) ---------------------------------------------

/**
 * How liveness is checked: `passive`, from the frames alone (no action asked of the customer);
 * `active_gesture`, the customer follows a prompted gesture other than a blink (a head turn, a
 * hand movement); `active_voice`, the customer reads out a prompted phrase. A product asks for a
 * non-blink check by naming it (RBC para 105), rather than relying on adapter configuration.
 */
export const LIVENESS_MODES = ["passive", "active_gesture", "active_voice"] as const;
export type LivenessMode = (typeof LIVENESS_MODES)[number];

/**
 * A liveness check on frames in STORAGE. `mode` (PR-UDF-044) asks for a liveness mode: an adapter
 * that cannot honour it refuses the call `IPB-PORT-002` with `meta.reason: "mode_unsupported"`
 * (`KYC_MODE_UNSUPPORTED`) before any vendor call and never falls back to another mode. Omitted,
 * the adapter uses its configured mode. The answer names the mode used (`ScoreResult.mode`).
 */
export const LivenessCheck = z
  .object({
    frames: z.array(KycFileRef).min(1).max(30),
    mode: classed(z.enum(LIVENESS_MODES), "INTERNAL").optional(),
  })
  .strict();
export const FaceMatch = z.object({ a: KycFileRef, b: KycFileRef }).strict();

/** The fixed `meta.reason` of an `IPB-PORT-003` refusal of a vendor score off its scale (PR-UDF-044). */
export const KYC_SCORE_OUT_OF_RANGE = "score_out_of_range";

/**
 * True when `score` is what `ScoreResult.score` must be: a finite number from 0 to 1. An adapter
 * normalises a vendor score whose scale it knows and refuses any other `IPB-PORT-003` with
 * `meta.reason: "score_out_of_range"`; it never clamps.
 */
export function kycScoreValid(score: unknown): score is number {
  return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1;
}

/**
 * Whether a vendor keeps a face template or embedding beyond the call (PR-UDF-044; CF para 14(3)):
 * `none`, the vendor states in writing that it keeps none; `kept`, it keeps one; `unknown`, no
 * written statement from the vendor has been seen.
 */
export type BiometricRetention = "none" | "kept" | "unknown";

export interface KycAdapterRetention {
  /** A face template or embedding derived from the frames or images sent. */
  template: BiometricRetention;
  /** Where the statement comes from, or what is still to be verified. */
  source: string;
}

/**
 * Per adapter (by descriptor name), whether its vendor keeps a template or embedding beyond the
 * call (PR-UDF-044), so a product can record it. A statement only: it changes nothing that is sent
 * or kept, and the platform keeps no image, template or embedding itself (a keyed check's record
 * holds an HMAC binding and the answer; R1-D-197). An adapter not listed is `unknown`.
 */
export const KYC_ADAPTER_RETENTION: Readonly<Record<string, KycAdapterRetention>> = {
  "digio-kyc": {
    template: "unknown",
    source:
      "[VERIFY] against a written statement from Digio; the adapter makes no liveness or face-match call (both unsupported), though Digio receives documents that carry a photo",
  },
  "idfy-kyc": {
    template: "unknown",
    source:
      "[VERIFY] against a written statement from IDfy on its face compare and photo liveness tasks; no such statement is held in the repository",
  },
  "fake-kyc": {
    template: "none",
    source:
      "The fake's own statement: it scores from the files' SHA-256 and keeps only a keyed retry's answer, in memory",
  },
};

/** The retention statement for an adapter; `unknown` for one not listed. */
export function kycAdapterRetention(adapter: string): KycAdapterRetention {
  return (
    KYC_ADAPTER_RETENTION[adapter] ?? {
      template: "unknown",
      source: "No statement for this adapter (KYC_ADAPTER_RETENTION)",
    }
  );
}

// ---- Bank account verification (PR-UDF-043; R1-D-196) --------------------------------------------

/**
 * How an account is verified: `pennyless`, a lookup at the bank (no credit to the account), or
 * `penny_drop`, a small credit to the account whose reply names the holder. Which party funds a
 * penny drop is each adapter's fact, stated in `KYC_ADAPTER_FUNDING`; the platform moves no money.
 */
export const BANK_ACCOUNT_MODES = ["pennyless", "penny_drop"] as const;
export type BankAccountMode = (typeof BANK_ACCOUNT_MODES)[number];

/** The account statuses a verification answers (unchanged by PR-UDF-043). */
export const BANK_ACCOUNT_STATUSES = ["valid", "invalid", "closed", "not_found"] as const;
export type BankAccountStatus = (typeof BANK_ACCOUNT_STATUSES)[number];

/**
 * The fixed `meta.reason` of an adapter that cannot honour the mode asked (PR-UDF-043); the same
 * label as `KYC_MODE_UNSUPPORTED`, which a liveness check uses too (PR-UDF-044).
 */
export const BANK_ACCOUNT_MODE_UNSUPPORTED = KYC_MODE_UNSUPPORTED;

/**
 * Verify a bank account. `mode` (PR-UDF-043) asks for a verification mode: an adapter that cannot
 * honour it refuses the call `IPB-PORT-002` with `meta.reason: "mode_unsupported"` before any
 * vendor call, and never falls back to another mode (the KYC router may then try the next adapter
 * in the method's order, which honours the mode or refuses it too). Omitted, the adapter uses its
 * configured mode. The answer names the mode used (`BankAccountResult.mode`).
 */
export const BankAccountCheck = z
  .object({
    ifsc: regulated(z.string().regex(IFSC)),
    accountNumber: regulated(z.string().regex(/^[0-9A-Z]{6,20}$/)),
    name: regulated(z.string().min(1).max(200)).optional(),
    mode: classed(z.enum(BANK_ACCOUNT_MODES), "INTERNAL").optional(),
  })
  .strict();

/** Who funds a penny-drop credit with an adapter (PR-UDF-043): a statement, never a payment. */
export type PennyDropFunding = "provider" | "tenant" | "unknown";

export interface KycAdapterFunding {
  /**
   * `provider`: the KYC provider credits the account from its own funds (the RE pays the provider's
   * fee); `tenant`: the credit is made from the tenant's (the RE's) own account; `unknown`: not yet
   * confirmed from the provider's documentation and the RE's agreement with it.
   */
  pennyDrop: PennyDropFunding;
  /** Where the statement comes from, or what is still to be verified. */
  source: string;
}

/**
 * Per adapter (by descriptor name), who funds a penny drop (PR-UDF-043; CF para 10(1)-(3): no LSP
 * account in the flow of funds), so an LSP agreement can record it. A statement only: no money moves
 * through the platform, and the platform's Digio and IDfy adapters make no penny drop at all (they
 * refuse `penny_drop` with `mode_unsupported`; R1-D-196). An adapter not listed is `unknown`.
 */
export const KYC_ADAPTER_FUNDING: Readonly<Record<string, KycAdapterFunding>> = {
  "digio-kyc": {
    pennyDrop: "unknown",
    source:
      "[VERIFY] against Digio's published bank account verification reference and the RE's agreement with Digio; the adapter makes pennyless checks only",
  },
  "idfy-kyc": {
    pennyDrop: "unknown",
    source:
      "[VERIFY] against IDfy's published bank account verification reference and the RE's agreement with IDfy; the adapter makes pennyless checks only",
  },
  "fake-kyc": {
    pennyDrop: "provider",
    source:
      "The fake's own statement: its penny drop is simulated as made by the provider, and nothing is credited",
  },
};

/** The funding statement for an adapter; `unknown` for one not listed. */
export function kycAdapterFunding(adapter: string): KycAdapterFunding {
  return (
    KYC_ADAPTER_FUNDING[adapter] ?? {
      pennyDrop: "unknown",
      source: "No statement for this adapter (KYC_ADAPTER_FUNDING)",
    }
  );
}

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
  /**
   * A finite number from 0 to 1 (`kycScoreValid`): the adapter normalises a vendor score whose
   * scale it knows, and refuses any other `IPB-PORT-003` (`meta.reason: "score_out_of_range"`).
   */
  score: number;
  /**
   * `score >= threshold`, against the tenant's threshold (`int.kyc.vcip.liveness_threshold` and its
   * face-match peer).
   */
  passed: boolean;
  /**
   * The threshold the adapter applied, from 0 to 1 (PR-UDF-044). The platform's adapters and the
   * fake always set it; optional in the type only so an implementer outside the platform does not
   * break in a minor (as `AadhaarOfflineResult.kind`).
   */
  threshold?: number;
  /**
   * For `livenessCheck` only: the mode used (PR-UDF-044), the one asked or the adapter's configured
   * mode when none was. Always set by the platform's adapters and the fake for a liveness check;
   * never set for a face match.
   */
  mode?: LivenessMode;
}

export interface VcipStart extends KycEvidence {
  vcipId: string;
  state: VcipState;
}

/** A launched V-CIP session (PR-UDF-045): where the customer goes, and until when. */
export interface VcipLaunch extends KycEvidence {
  /** The scheduled session; read it with `vcipStatus`. */
  vcipId: string;
  /** The RE's V-CIP page for this customer: `https:`, on the adapter's hosts (`vcipLaunchUrlAllowed`). */
  launchUrl: string;
  /** When the launch lapses: never later than the hand-off's `expiresAt`. */
  expiresAt: string;
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
  /** The official conducting the call; empty for a launched session no official has started yet. */
  officialRef: string;
  /** `mode` (PR-UDF-045) is the liveness mode used (`LIVENESS_MODES`), where the scorer reported it. */
  liveness?: { score: number; passed: boolean; mode?: LivenessMode };
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
  /** Why a session was rejected, dropped or expired (PR-UDF-045), from `VCIP_REASON_CODES`. */
  reasonCode?: VcipReasonCode;
  /**
   * @deprecated Since PR-UDF-045: read `reasonCode`. The old free text, kept so no reader breaks;
   * never show it to anyone (an official may have typed anything). The platform's conductor leaves
   * it out when it holds a 12-digit run or an Aadhaar-like number.
   */
  reason?: string;
}

/** No field carries a 12-digit run or the account number asked (PR-UDF-043). */
export interface BankAccountResult extends KycEvidence {
  status: BankAccountStatus;
  /**
   * The mode used (PR-UDF-043): the one asked, or the adapter's configured mode when none was. The
   * platform's adapters and the fake always set it; optional in the type only so an implementer
   * outside the platform does not break in a minor (as `AadhaarOfflineResult.kind`).
   */
  mode?: BankAccountMode;
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
  /**
   * Hand a customer to an RE-hosted V-CIP (PR-UDF-045; see `VcipHandoffContext`): the LSP hosts no
   * V-CIP component and never needs an official or a room. Before any vendor call the adapter
   * parses the request, checks the context names the call's tenant (when given), its RE and an LSP
   * it trusts, and verifies `jws` over the context with `verifyRegulatedMessage` and its replay
   * store (so the verified payload is the context given), then that the context is fresh; anything
   * else is refused `IPB-PORT-001` with a `VCIP_HANDOFF_REFUSALS` label, definite. The answer is a
   * `scheduled` session, an `https:` launch address and its expiry. A hand-off is single use: a
   * second call with the same JWS is `handoff_replayed`; to retry, sign a fresh hand-off. Optional
   * on the interface so an implementer outside the platform does not break in a minor; the fake
   * provides it, and an adapter without an RE-hosted launcher refuses it `unsupported`.
   */
  launchVcip?(req: z.infer<typeof LaunchVcip>, call?: PortCall): Promise<VcipLaunch>;
  /**
   * The session manifest. `call` (PR-UDF-045, optional so no caller breaks) carries the tenant:
   * an adapter reads the session under `call.tenantId` (else its tenancy context), and a session
   * of another tenant is not found. No field of a manifest carries a 12-digit run.
   */
  vcipStatus(vcipId: string, call?: PortCall): Promise<VcipManifest>;
  /**
   * Liveness on frames (see `LivenessCheck` for `mode`). Idempotent on `call.idempotencyKey`
   * (PR-UDF-044): a retry with the same key and request returns the first answer without a new
   * vendor call; the same key with other frames or another mode (an omitted mode is the configured
   * one) is refused `IPB-PORT-004` (`meta.reason: "idempotency_conflict"`). A key is scoped to its
   * method: the same key on `faceMatch` is another check. A call left unfinished (a vendor error) is
   * asked again on its retry. The answer's `score` is from 0 to 1, with the `threshold` applied and
   * the `mode` used. The platform adapters keep a key for 24 hours.
   */
  livenessCheck(req: z.infer<typeof LivenessCheck>, call?: PortCall): Promise<ScoreResult>;
  /**
   * Compare two face images. Idempotent on `call.idempotencyKey` as `livenessCheck` is (PR-UDF-044):
   * the same key with other images is `IPB-PORT-004`. The answer's `score` is from 0 to 1, with the
   * `threshold` applied; it has no `mode`.
   */
  faceMatch(req: z.infer<typeof FaceMatch>, call?: PortCall): Promise<ScoreResult>;
  /**
   * Verify a bank account (see `BankAccountCheck` for `mode`). Idempotent on `call.idempotencyKey`
   * (PR-UDF-043): a retry with the same key and request returns the first answer without a new
   * vendor call, so an account is never verified, and above all never credited, twice for one key;
   * the same key with another account, IFSC, name or mode (an omitted mode is the configured one)
   * is refused `IPB-PORT-004` (`meta.reason: "idempotency_conflict"`). A keyed penny drop whose first
   * call did not finish is never sent again: its retry is refused `IPB-PORT-002`
   * (`meta.reason: "pending_unresolved"`) for a person to check with the provider. The platform
   * adapters keep a key for 24 hours.
   */
  bankAccountVerify(
    req: z.infer<typeof BankAccountCheck>,
    call?: PortCall,
  ): Promise<BankAccountResult>;
  /** Delegates to the OCR port where the adapter has no OCR of its own (`emulated`). */
  ovdOcr(req: z.infer<typeof OvdOcr>, call?: PortCall): Promise<OvdOcrResult>;
  amlScreen(party: z.infer<typeof AmlParty>, call?: PortCall): Promise<AmlResult>;
  /**
   * Verify a V-CIP webhook without a vendor call (PR-UDF-046): the provider's signature scheme
   * (Standard Webhooks, IPB-10-21) and its five-minute window, a delivery's replay, and a body of at
   * most `KYC_WEBHOOK_MAX_BODY_BYTES`, then the session id; no read-back. Refusals are
   * `IPB-API-018` with a `KYC_WEBHOOK_REFUSALS` label, definite, so the product answers 401; a
   * verified event naming no session is `IPB-PORT-001` `malformed_event`. With the receipt the
   * product records `eventId` in its module inbox, answers 2xx within 2 s and reads the session back
   * with `vcipStatus` from its queue (IPB-10-27). Optional on the interface so an implementer outside
   * the platform does not break in a minor; the fake provides it, and an adapter whose provider's
   * scheme is not yet known refuses it `unsupported`.
   */
  verifyWebhook?(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<KycWebhookReceipt>;
  /**
   * Verify a V-CIP event, then read the session back from the vendor; only that is trusted. Where
   * the adapter provides `verifyWebhook` (PR-UDF-046), this is `verifyWebhook` and then
   * `vcipStatus` of its `vcipId`, so a forged event is refused before any vendor call.
   */
  handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<VcipManifest>;
}
