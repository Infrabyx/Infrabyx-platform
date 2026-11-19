// KYC reference adapter `digio-kyc` (owner answer #87, R1-D-22, R1-plan M16): the Digio KYC API v2
// over the egress client, no SDK. India-hosted (IN). Off behind `int.kyc.digio.enabled` (default
// false) and `unproven` until the owner's Digio account exists and its sandbox leg runs. Vendor
// facts below are [VERIFY] until then:
// - auth: HTTP Basic with client id and secret; sandbox `ext.digio.in`, production `api.digio.in`;
// - a KYC request is created from a template the tenant configures at Digio (DigiLocker step),
//   the customer completes it in Digio's gateway, and the result is read with
//   `GET /client/kyc/v2/{request_id}/response`; its files with `GET /client/kyc/v2/media/{file_id}`;
// - Aadhaar Offline e-KYC: `POST /client/kyc/v2/offline_aadhaar/verify` with the XML zip (or QR
//   payload) and the share code;
// - starting a DigiLocker session (PR-UDF-040): `POST /client/kyc/v2/request/with_template` with the
//   tenant's template, answered with the request id and an access token with its expiry; the
//   customer signs in at Digio's gateway, which sends them back to the return address;
// - a DigiLocker file's issuer signature result as `signature_valid` beside the file;
// - Aadhaar OTP e-KYC (PR-UDF-041), as a KUA for a notified RE: `POST /client/kyc/v2/aadhaar_otp/
//   request` with the number or VID and the consent, answered with the transaction and the OTP's
//   expiry, then `POST /client/kyc/v2/aadhaar_otp/verify` with the transaction and the code,
//   answered with UIDAI's signed e-KYC XML (base64), the signature result and the masked number;
//   refusals by `code` (`INVALID_AADHAAR`, `MOBILE_NOT_LINKED`, `INVALID_OTP`, `OTP_EXPIRED`).
// - a pennyless bank account check (PR-UDF-043): `POST /client/verify/bank_account` with
//   `{ beneficiary_account_no, beneficiary_ifsc, beneficiary_name?, validation_mode: "PENNY_LESS" }`,
//   answered `{ id, verified, account_status, beneficiary_name_with_bank?, verified_at }`.
// Each of these shapes lives in one small function below (`digioDigilockerStart*`,
// `digioAadhaarOtp*`, `digioBankAccount*`), so the sandbox corrects it in one place.
// This adapter provides DigiLocker, Aadhaar offline, Aadhaar OTP (off unless `notifiedEntity`) and
// pennyless bank account checks (a penny drop is refused `mode_unsupported`: it would move money,
// which the platform does not do; R1-D-196). Every other method is `unsupported`,
// so routing (`int.kyc.<method>.provider`) chooses another adapter for it; liveness and face
// match among them, with no liveness mode or threshold here (PR-UDF-044; whether Digio keeps a face
// template is `unknown` [VERIFY] in `KYC_ADAPTER_RETENTION`). V-CIP waits for the
// owner (OWNER-QUESTIONS #90): Digio's video KYC records on Digio's side, while the port runs
// the call in a VIDEO_MEET room with no provider copy; no RE-hosted V-CIP launcher is known at
// Digio, so `launchVcip` is `unsupported` too (PR-UDF-045; `VcipConductor` takes hand-offs [VERIFY]
// whether Digio offers one). Results never carry an Aadhaar number:
// only its last four digits, and any twelve-digit run in vendor text is refused.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AadhaarOfflineCheck,
  AadhaarOtpRequest,
  AadhaarOtpVerify,
  aadhaarUidValid,
  BankAccountCheck,
  DIGILOCKER_RETURN_URL_REFUSED,
  DigilockerPull,
  StartDigilocker,
  digilockerReturnUrlAllowed,
  storageKey,
  type AadhaarOfflineResult,
  type AadhaarOtpRefusal,
  type AadhaarOtpResult,
  type AadhaarOtpStart,
  type AdapterDescriptor,
  type BankAccountResult,
  type BankAccountStatus,
  type DigilockerDocument,
  type DigilockerStart,
  type KycEvidence,
  type KycFileRef,
  type KycPort,
  type PortCall,
  type PortHealth,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { newId, sha256Hex, type ReplayStore } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import { vendorError } from "../messaging/common.js";
import {
  aadhaarOtpRefused,
  assertNotifiedEntity,
  holdsAadhaarNumber,
  keyedAadhaarOtpVerify,
  MemoryAadhaarOtpVerifyStore,
  type AadhaarOtpVerifyStore,
} from "./aadhaar-otp.js";
import {
  bankAccountMode,
  bankNameMatch,
  keyedBankAccountVerify,
  MemoryBankAccountVerifyStore,
  PLATFORM_BANK_ACCOUNT_MODES,
  type BankAccountVerifyStore,
} from "./bank-account.js";
import {
  MemoryDigilockerPullStore,
  type DigilockerPullRequest,
  type DigilockerPullStore,
} from "./digilocker-pulls.js";

const KYC = "KYC";
const ADAPTER = "digio-kyc";
const HOSTS = { sandbox: "ext.digio.in", production: "api.digio.in" } as const;
/** Digio's customer-facing gateway, where the DigiLocker sign-in happens [VERIFY]. */
const GATEWAY_HOSTS = { sandbox: "ext.digio.in", production: "app.digio.in" } as const;
/** A consent session is claimed once and remembered for longer than any Digio request lives. */
const CONSENT_MEMORY_MS = 400 * 24 * 3600 * 1000;
const AADHAAR_LIKE = /(?<![0-9])[0-9]{12}(?![0-9])/;
/** A 12-digit or 16-digit run outside a SHA-256 (PR-UDF-041). */
const UID_LIKE = /(?<![0-9])(?:[0-9]{12}|[0-9]{16})(?![0-9])/;
const uidLike = (v: unknown) => UID_LIKE.test(JSON.stringify(v).replace(/[0-9a-f]{64}/g, ""));

const UNSUPPORTED = [
  "verifyPan",
  "ckycSearch",
  "ckycDownload",
  "startVcip",
  "vcipStatus",
  "launchVcip",
  "livenessCheck",
  "faceMatch",
  "ovdOcr",
  "amlScreen",
  "verifyWebhook",
  "handleWebhook",
] as const;

export interface DigioKycOptions {
  storage: StoragePort;
  /** Single use of a DigiLocker consent session (Redis in production, as for DPoP `jti`). */
  consents: ReplayStore;
  /** `int.kyc.digio.enabled`, read on every call; off until the owner's credentials exist. */
  enabled: () => Promise<boolean> | boolean;
  /** `secrets/<env>/kyc/digio/client_id` and `client_secret`. */
  clientId: () => Promise<string> | string;
  clientSecret: () => Promise<string> | string;
  /** The tenant when the call names none (the tenancy context). */
  currentTenant?: () => string | undefined;
  /**
   * Keyed DigiLocker pulls (PR-UDF-040): `PgDigilockerPullStore` in production, so a retry on any
   * instance finds the first pull. Default: an in-memory store of this adapter instance.
   */
  pulls?: DigilockerPullStore;
  /**
   * The hosts a DigiLocker return address may name, per tenant (exact names; PR-UDF-040). Default
   * none: every `startDigilocker` is refused `return_url_not_allowed` until the product sets them.
   */
  digilockerReturnHosts?:
    readonly string[] | ((tenantId: string) => readonly string[] | Promise<readonly string[]>);
  /** The tenant's Digio KYC template with the DigiLocker step; without it `startDigilocker` is `not_configured`. */
  digilockerTemplate?: (tenantId: string) => string | undefined | Promise<string | undefined>;
  /**
   * Aadhaar OTP e-KYC (PR-UDF-041): `true` only for a reporting entity notified under PML Act
   * s.11A (KYC Directions 2025 para 23 proviso (i) [VERIFY]). Default false: every Aadhaar OTP call
   * is refused `not_configured` before any vendor call.
   */
  notifiedEntity?: boolean;
  /**
   * Keyed Aadhaar OTP verifies (PR-UDF-041): `PgAadhaarOtpVerifyStore` in production, so a retry on
   * any instance gets the first answer. Default: an in-memory store of this adapter instance.
   */
  aadhaarOtpVerifies?: AadhaarOtpVerifyStore;
  /**
   * Keyed bank account checks (PR-UDF-043): `PgBankAccountVerifyStore` in production, so a retry on
   * any instance gets the first answer. Default: an in-memory store of this adapter instance.
   */
  bankAccountVerifies?: BankAccountVerifyStore;
  /** Test mode until the owner's account exists (default `sandbox`). */
  mode?: "sandbox" | "production";
  /** Tests only: the Digio stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => Date;
}

interface DigioFile {
  doc_type?: string;
  file_id?: string;
  issuer?: string;
  issued_at?: string;
  /** [VERIFY] the issuer signature result; absent means "not reported". */
  signature_valid?: unknown;
}
interface DigioAction {
  type?: string;
  status?: string;
  sub_files?: DigioFile[];
}
interface DigioKycResponse {
  id?: string;
  status?: string;
  actions?: DigioAction[];
}
interface DigioOfflineAadhaar {
  id?: string;
  signature_valid?: boolean;
  model_version?: string;
  details?: {
    aadhaar_last_digits?: string;
    name?: string;
    dob?: string;
    gender?: string;
    photo?: string;
    generated_at?: string;
  };
}

/** The reply's JSON, or undefined when it is not JSON. */
const safeJson = (res: { json(): unknown }): unknown => {
  try {
    return res.json();
  } catch {
    return undefined;
  }
};

const refused = (detail: string, reason: string, definite = true): PortError =>
  new PortError("IPB-PORT-001", KYC, { adapter: ADAPTER, detail, meta: { reason, definite } });

// ---- DigiLocker start: stub-shaped, to confirm against the sandbox ([VERIFY]) -------------------

/**
 * [VERIFY] The body of Digio's template request. Digio's request names the customer by
 * `customer_identifier` (an e-mail or mobile); the port's start carries no contact, so none is
 * sent [VERIFY that Digio accepts a request without it when it generates the access token]. The
 * documents come from the template's DigiLocker step [VERIFY whether they can be set per request];
 * `digilockerPull` keeps only the types it is asked for.
 */
export function digioDigilockerStartBody(template: string): Record<string, unknown> {
  return { template_name: template, notify_customer: false, generate_access_token: true };
}

/**
 * [VERIFY] Digio's answer: `{ id, access_token: { id, valid_till } }`, and the gateway address
 * `https://<gateway>/#/gateway/login/<request id>/<token id>/<request id>?redirect_url=<return>`.
 */
export function mapDigioDigilockerStart(
  json: unknown,
  o: { gatewayHost: string; returnUrl: string; now: Date },
): { consentSession: string; signInUrl: string; expiresAt: string } {
  const r = json as { id?: unknown; access_token?: { id?: unknown; valid_till?: unknown } };
  const id = typeof r?.id === "string" ? r.id : "";
  const token = typeof r?.access_token?.id === "string" ? r.access_token.id : "";
  const till = typeof r?.access_token?.valid_till === "string" ? r.access_token.valid_till : "";
  const exp = Date.parse(till);
  const safe = /^[A-Za-z0-9_-]{8,200}$/;
  if (!safe.test(id) || !safe.test(token) || !Number.isFinite(exp) || exp <= o.now.getTime())
    throw vendorError(KYC, ADAPTER, 502, "DigiLocker start without its request, token or expiry");
  const u = new URL(`https://${o.gatewayHost}/`);
  u.hash = `/gateway/login/${id}/${token}/${id}?redirect_url=${encodeURIComponent(o.returnUrl)}`;
  return { consentSession: id, signInUrl: u.toString(), expiresAt: new Date(exp).toISOString() };
}

// ---- Aadhaar OTP e-KYC: stub-shaped, to confirm against the sandbox ([VERIFY]) ------------------

/**
 * [VERIFY] The body of Digio's OTP request: the number or VID by `id_type` and `id_number`, and the
 * resident's consent as `consent: "Y"` with the text's version, hash and time [VERIFY the field
 * names, and whether Digio takes the consent text's hash or needs the text itself].
 */
export function digioAadhaarOtpRequestBody(
  r: ReturnType<typeof AadhaarOtpRequest.parse>,
): Record<string, string> {
  return {
    id_type: r.uidKind === "VID" ? "vid" : "aadhaar",
    id_number: r.uid,
    consent: "Y",
    consent_text_version: r.consent.version,
    consent_text_hash: r.consent.textHash,
    consent_at: r.consent.at,
  };
}

/** [VERIFY] Digio's refusal codes on the OTP calls, as the port's fixed labels. */
export function mapDigioAadhaarOtpRefusal(
  status: number,
  json: unknown,
): AadhaarOtpRefusal | undefined {
  if (status === 404) return "otp_expired";
  if (status !== 400 && status !== 422) return undefined;
  const code = String((json as { code?: unknown } | undefined)?.code ?? "").toUpperCase();
  if (/INVALID_(AADHAAR|VID|UID)/.test(code)) return "uid_invalid";
  if (/MOBILE_NOT_LINKED/.test(code)) return "mobile_not_linked";
  if (/OTP_EXPIRED|TXN_EXPIRED|TRANSACTION_EXPIRED|ALREADY_USED/.test(code)) return "otp_expired";
  if (/INVALID_OTP|OTP_MISMATCH/.test(code)) return "otp_invalid";
  return undefined;
}

/**
 * [VERIFY] Digio's OTP verify answer: `{ id, signature_valid?, model_version?, details: {
 * aadhaar_last_digits, ekyc_xml } }`, `ekyc_xml` being UIDAI's signed e-KYC response in base64
 * [VERIFY whether Digio returns UIDAI's signed XML unchanged, and whether it carries the full
 * number, which the adapter then refuses to store].
 */
export function mapDigioAadhaarOtpVerify(json: unknown): {
  vendorRef: string;
  modelVersion: string;
  ekyc: Buffer;
  signatureValid: boolean | null;
  uidLast4: string;
} {
  const v = json as {
    id?: unknown;
    signature_valid?: unknown;
    model_version?: unknown;
    details?: { aadhaar_last_digits?: unknown; ekyc_xml?: unknown };
  };
  const last =
    typeof v?.details?.aadhaar_last_digits === "string" ? v.details.aadhaar_last_digits : "";
  const last4 = /(?<![0-9])([0-9]{4})$/.exec(last)?.[1];
  const xml =
    typeof v?.details?.ekyc_xml === "string"
      ? Buffer.from(v.details.ekyc_xml, "base64")
      : undefined;
  if (typeof v?.id !== "string" || !/^[A-Za-z0-9_-]{8,200}$/.test(v.id) || !last4 || !xml?.length)
    throw vendorError(
      KYC,
      ADAPTER,
      502,
      "Aadhaar OTP verify without its id, e-KYC or masked number",
    );
  if (UID_LIKE.test(last))
    throw vendorError(KYC, ADAPTER, 502, "the reply carried an Aadhaar-like number");
  return {
    vendorRef: v.id,
    modelVersion:
      typeof v.model_version === "string" ? v.model_version.slice(0, 100) : "aadhaar-otp-v2",
    ekyc: xml,
    signatureValid: typeof v.signature_valid === "boolean" ? v.signature_valid : null,
    uidLast4: last4,
  };
}

// ---- Bank account check: stub-shaped, to confirm against the sandbox ([VERIFY]) ----------------

/**
 * [VERIFY] The body of Digio's pennyless check. Only `PENNY_LESS` is ever sent: the adapter refuses
 * a penny drop before it builds a body (R1-D-196).
 */
export function digioBankAccountBody(
  r: ReturnType<typeof BankAccountCheck.parse>,
): Record<string, string> {
  return {
    beneficiary_account_no: r.accountNumber,
    beneficiary_ifsc: r.ifsc,
    ...(r.name ? { beneficiary_name: r.name } : {}),
    validation_mode: "PENNY_LESS",
  };
}

/**
 * [VERIFY] Digio's answer: `verified: true` is `valid`; otherwise `account_status` `CLOSED` is
 * `closed`, `NOT_FOUND` (or `INVALID_ACCOUNT`) is `not_found`, and anything else is `invalid`. The
 * name at the bank is kept only when it carries no run of six or more digits.
 */
export function mapDigioBankAccount(json: unknown): {
  vendorRef: string;
  status: BankAccountStatus;
  nameAtBank?: string;
} {
  const v = json as {
    id?: unknown;
    verified?: unknown;
    account_status?: unknown;
    beneficiary_name_with_bank?: unknown;
  };
  if (typeof v?.id !== "string" || !/^[A-Za-z0-9_-]{8,200}$/.test(v.id))
    throw vendorError(KYC, ADAPTER, 502, "bank account check without its id");
  const acct = String(v.account_status ?? "").toUpperCase();
  const status: BankAccountStatus =
    v.verified === true
      ? "valid"
      : acct === "CLOSED"
        ? "closed"
        : acct === "NOT_FOUND" || acct === "INVALID_ACCOUNT"
          ? "not_found"
          : "invalid";
  const name =
    typeof v.beneficiary_name_with_bank === "string"
      ? v.beneficiary_name_with_bank.trim().slice(0, 200)
      : "";
  if (/[0-9]{6}/.test(name))
    throw vendorError(KYC, ADAPTER, 502, "the reply's account name carried a number");
  return { vendorRef: v.id, status, ...(name ? { nameAtBank: name } : {}) };
}

export class DigioKyc implements KycPort {
  readonly descriptor: AdapterDescriptor = {
    port: KYC,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: Object.fromEntries(UNSUPPORTED.map((m) => [m, "unsupported"])),
  };
  private readonly egress;
  private readonly base: string;
  private readonly now: () => Date;
  private readonly pulls: DigilockerPullStore;
  private readonly otpVerifies: AadhaarOtpVerifyStore;
  private readonly bankVerifies: BankAccountVerifyStore;
  private readonly gatewayHost: string;

  constructor(private readonly o: DigioKycOptions) {
    const mode = o.mode ?? "sandbox";
    this.base = (o.baseUrl ?? `https://${HOSTS[mode]}`).replace(/\/$/, "");
    this.now = o.now ?? (() => new Date());
    this.pulls = o.pulls ?? new MemoryDigilockerPullStore({ now: () => this.now() });
    this.otpVerifies =
      o.aadhaarOtpVerifies ?? new MemoryAadhaarOtpVerifyStore({ now: () => this.now() });
    this.bankVerifies =
      o.bankAccountVerifies ?? new MemoryBankAccountVerifyStore({ now: () => this.now() });
    this.gatewayHost = GATEWAY_HOSTS[mode];
    this.egress = createEgress({
      port: KYC,
      adapter: ADAPTER,
      allow: [HOSTS[mode]],
      retries: 1,
      maxBytes: 16 * 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async guard(): Promise<void> {
    if (!(await this.o.enabled()))
      throw refused("the Digio KYC adapter is off (int.kyc.digio.enabled)", "adapter_disabled");
  }

  private tenant(call?: PortCall): string {
    const t = call?.tenantId ?? this.o.currentTenant?.();
    if (!t) throw refused("a KYC call needs a tenant to store its files under", "no_tenant");
    return t;
  }

  private evidence(vendorRef: string, modelVersion = "kyc-v2"): KycEvidence {
    return {
      vendorRef,
      adapter: ADAPTER,
      modelVersion,
      checkedAt: this.now().toISOString(),
    };
  }

  /** Write a vendor file to STORAGE (REGULATED, under the tenant) and return its reference. */
  private async store(tenant: string, body: Uint8Array, ext: string, contentType: string) {
    // No storage key carries a 12- or 16-digit run (PR-UDF-040, -041): such a ULID is drawn again.
    let key = storageKey(tenant, "kyc", newId("kyc").slice(4), ext);
    while (UID_LIKE.test(key)) key = storageKey(tenant, "kyc", newId("kyc").slice(4), ext);
    const sha256 = sha256Hex(body);
    await this.o.storage.put(key, body, { bucketClass: "REGULATED", contentType, sha256 });
    return { storageKey: key, sha256 } satisfies KycFileRef;
  }

  async startDigilocker(
    raw: Parameters<NonNullable<KycPort["startDigilocker"]>>[0],
    call?: PortCall,
  ): Promise<DigilockerStart> {
    await this.guard();
    const r = StartDigilocker.parse(raw);
    const tenant = this.tenant(call);
    const hosts =
      typeof this.o.digilockerReturnHosts === "function"
        ? await this.o.digilockerReturnHosts(tenant)
        : (this.o.digilockerReturnHosts ?? []);
    if (!digilockerReturnUrlAllowed(r.returnUrl, hosts))
      throw refused(
        "the return address is not https on one of the tenant's allowed hosts",
        DIGILOCKER_RETURN_URL_REFUSED,
      );
    const template = await this.o.digilockerTemplate?.(tenant);
    if (!template)
      throw refused(
        "no Digio KYC template with a DigiLocker step for the tenant",
        "not_configured",
      );
    const res = await this.egress(`${this.base}/client/kyc/v2/request/with_template`, {
      method: "POST",
      headers: {
        authorization: await this.basic(),
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(digioDigilockerStartBody(template)),
    });
    if (res.status === 400 || res.status === 422)
      throw refused("Digio refused the DigiLocker request", "invalid_request");
    if (res.status !== 200) throw vendorError(KYC, ADAPTER, res.status, "Digio KYC request");
    const out = {
      ...mapDigioDigilockerStart(res.json(), {
        gatewayHost: this.gatewayHost,
        returnUrl: r.returnUrl,
        now: this.now(),
      }),
    };
    const result = { ...this.evidence(out.consentSession), ...out };
    if (AADHAAR_LIKE.test(JSON.stringify(result)))
      throw vendorError(KYC, ADAPTER, 502, "the reply carried an Aadhaar-like number");
    return result;
  }

  async digilockerPull(
    raw: Parameters<KycPort["digilockerPull"]>[0],
    call?: PortCall,
  ): Promise<DigilockerDocument[]> {
    await this.guard();
    const r = DigilockerPull.parse(raw);
    const tenant = this.tenant(call);
    const keyed: DigilockerPullRequest | undefined =
      call?.idempotencyKey === undefined
        ? undefined
        : {
            tenantId: tenant,
            adapter: ADAPTER,
            idempotencyKey: call.idempotencyKey,
            consentSession: r.consentSession,
            docTypes: r.docTypes,
          };
    // A retry with the key: the stored documents, without a vendor call (PR-UDF-040).
    const prior = keyed ? await this.pulls.find(keyed) : { kind: "none" as const };
    if (prior.kind === "done") return prior.documents;
    if (prior.kind === "refused")
      throw refused("the consent session was already used", "consent_used");
    const res = (await this.call(
      "GET",
      `/client/kyc/v2/${encodeURIComponent(r.consentSession)}/response`,
    )) as DigioKycResponse;
    const action = (res.actions ?? []).find((a) => a.type === "digilocker");
    const done = ["approved", "completed", "success"];
    if (!action || !done.includes((action.status ?? "").toLowerCase()))
      throw refused("the customer has not completed the DigiLocker step", "consent_incomplete");
    const files = (action.sub_files ?? []).filter(
      (f) => r.docTypes.some((t) => t === f.doc_type) && f.file_id,
    );
    // Checked before the session is used, so a bad reply does not burn it.
    for (const f of files)
      for (const v of [f.issuer, f.issued_at, f.file_id])
        if (typeof v === "string" && AADHAAR_LIKE.test(v))
          throw vendorError(KYC, ADAPTER, 502, "the reply carried an Aadhaar-like number");
    let pullId = prior.kind === "pending" ? prior.id : undefined;
    // Claimed only once the vendor confirms the session, so a refused pull does not burn it.
    const claim = () =>
      this.o.consents.claim(
        `kyc:digio:digilocker:${r.consentSession}`,
        new Date(this.now().getTime() + CONSENT_MEMORY_MS),
      );
    if (!keyed) {
      if (!(await claim())) throw refused("the consent session was already used", "consent_used");
    } else if (pullId) {
      // This key reserved the session before and did not finish: the claim, if any, was its own.
      await claim();
    } else {
      const res2 = await this.pulls.reserve(keyed);
      if (res2.kind === "done") return res2.documents;
      if (res2.kind === "refused" || res2.kind === "session_taken")
        throw refused("the consent session was already used", "consent_used");
      if (res2.kind === "new" && !(await claim())) {
        await this.pulls.refuse(keyed, res2.id);
        throw refused("the consent session was already used", "consent_used");
      }
      pullId = res2.id;
    }
    const evidence = this.evidence(res.id ?? r.consentSession);
    const out: DigilockerDocument[] = [];
    for (const f of files) {
      const docType = r.docTypes.find((t) => t === f.doc_type)!;
      const media = await this.egress(
        `${this.base}/client/kyc/v2/media/${encodeURIComponent(f.file_id!)}`,
        { method: "GET", headers: { authorization: await this.basic() } },
      );
      if (media.status !== 200) throw vendorError(KYC, ADAPTER, media.status, "Digio media");
      const pdf = Buffer.from(media.body.subarray(0, 5)).toString("latin1") === "%PDF-";
      const file = await this.store(
        tenant,
        media.body,
        pdf ? "pdf" : "xml",
        pdf ? "application/pdf" : "application/xml",
      );
      out.push({
        docType,
        file,
        issuer: (f.issuer ?? "digilocker").slice(0, 200),
        ...(f.issued_at ? { issuedAt: f.issued_at } : {}),
        evidence,
        signatureValid: typeof f.signature_valid === "boolean" ? f.signature_valid : null,
      });
    }
    return keyed && pullId ? this.pulls.complete(keyed, pullId, out) : out;
  }

  async aadhaarOtpRequest(
    raw: Parameters<NonNullable<KycPort["aadhaarOtpRequest"]>>[0],
    call?: PortCall,
  ): Promise<AadhaarOtpStart> {
    // Fail closed first: nothing is read, and nothing is sent, for an RE that is not notified.
    assertNotifiedEntity(ADAPTER, this.o.notifiedEntity);
    await this.guard();
    const r = AadhaarOtpRequest.parse(raw);
    if (!aadhaarUidValid(r.uid, r.uidKind))
      throw aadhaarOtpRefused(ADAPTER, "uid_invalid", "not a well-formed Aadhaar number or VID");
    this.tenant(call);
    // The number goes in this one request body and nowhere else; it is not kept.
    const res = await this.egress(`${this.base}/client/kyc/v2/aadhaar_otp/request`, {
      method: "POST",
      headers: {
        authorization: await this.basic(),
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(digioAadhaarOtpRequestBody(r)),
    });
    const json = safeJson(res);
    const refusal = mapDigioAadhaarOtpRefusal(res.status, json);
    if (refusal === "uid_invalid" || refusal === "mobile_not_linked")
      throw aadhaarOtpRefused(ADAPTER, refusal, `Digio refused the OTP request (${refusal})`);
    if (res.status === 400 || res.status === 422)
      throw refused("Digio refused the Aadhaar OTP request", "invalid_request");
    if (res.status !== 200) throw vendorError(KYC, ADAPTER, res.status, "Digio Aadhaar OTP");
    const j = json as { id?: unknown; otp_valid_till?: unknown };
    const till = typeof j?.otp_valid_till === "string" ? Date.parse(j.otp_valid_till) : NaN;
    if (
      typeof j?.id !== "string" ||
      !/^[A-Za-z0-9_-]{8,200}$/.test(j.id) ||
      !Number.isFinite(till) ||
      till <= this.now().getTime()
    )
      throw vendorError(KYC, ADAPTER, 502, "Aadhaar OTP request without its transaction or expiry");
    const out = {
      ...this.evidence(j.id, "aadhaar-otp-v2"),
      txn: j.id,
      expiresAt: new Date(till).toISOString(),
    };
    if (uidLike(out))
      throw vendorError(KYC, ADAPTER, 502, "the reply carried an Aadhaar-like number");
    return out;
  }

  async aadhaarOtpVerify(
    raw: Parameters<NonNullable<KycPort["aadhaarOtpVerify"]>>[0],
    call?: PortCall,
  ): Promise<AadhaarOtpResult> {
    assertNotifiedEntity(ADAPTER, this.o.notifiedEntity);
    await this.guard();
    const r = AadhaarOtpVerify.parse(raw);
    const tenant = this.tenant(call);
    return keyedAadhaarOtpVerify({
      store: this.otpVerifies,
      request:
        call?.idempotencyKey === undefined
          ? undefined
          : { tenantId: tenant, adapter: ADAPTER, idempotencyKey: call.idempotencyKey, ...r },
      verify: async () => {
        const res = await this.egress(`${this.base}/client/kyc/v2/aadhaar_otp/verify`, {
          method: "POST",
          headers: {
            authorization: await this.basic(),
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: r.txn, otp: r.otp }),
        });
        const json = safeJson(res);
        const refusal = mapDigioAadhaarOtpRefusal(res.status, json);
        if (refusal === "otp_invalid" || refusal === "otp_expired")
          throw aadhaarOtpRefused(ADAPTER, refusal, `Digio refused the OTP (${refusal})`);
        if (res.status === 400 || res.status === 422)
          throw refused("Digio refused the Aadhaar OTP verify", "invalid_request");
        if (res.status !== 200) throw vendorError(KYC, ADAPTER, res.status, "Digio Aadhaar OTP");
        return this.ekycResult(tenant, mapDigioAadhaarOtpVerify(json));
      },
    });
  }

  /** Store UIDAI's e-KYC response unchanged, unless it carries a number (R1-D-194). */
  private async ekycResult(
    tenant: string,
    v: ReturnType<typeof mapDigioAadhaarOtpVerify>,
  ): Promise<AadhaarOtpResult> {
    if (holdsAadhaarNumber(v.ekyc.toString("latin1")))
      throw refused(
        "the e-KYC response carries an Aadhaar number or VID; it is not stored outside the RE's vault",
        "ekyc_holds_number",
      );
    const ekyc = await this.store(tenant, v.ekyc, "xml", "application/xml");
    const result: AadhaarOtpResult = {
      ...this.evidence(v.vendorRef, v.modelVersion),
      ekyc,
      signatureValid: v.signatureValid,
      uidLast4: v.uidLast4,
    };
    if (uidLike(result))
      throw vendorError(KYC, ADAPTER, 502, "the reply carried an Aadhaar-like number");
    return result;
  }

  /**
   * A pennyless check (PR-UDF-043). The mode is checked first, before the flag or any vendor call:
   * a penny drop is refused `mode_unsupported`. Keyed checks are answered from the store.
   */
  async bankAccountVerify(
    raw: Parameters<KycPort["bankAccountVerify"]>[0],
    call?: PortCall,
  ): Promise<BankAccountResult> {
    const r = BankAccountCheck.parse(raw);
    const mode = bankAccountMode(ADAPTER, r.mode, {
      honoured: PLATFORM_BANK_ACCOUNT_MODES,
      configured: "pennyless",
    });
    await this.guard();
    // A keyed check is kept under its tenant; an unkeyed one needs none.
    return keyedBankAccountVerify({
      store: this.bankVerifies,
      request:
        call?.idempotencyKey === undefined
          ? undefined
          : {
              tenantId: this.tenant(call),
              adapter: ADAPTER,
              idempotencyKey: call.idempotencyKey,
              ifsc: r.ifsc,
              accountNumber: r.accountNumber,
              ...(r.name !== undefined ? { name: r.name } : {}),
              mode,
            },
      verify: async () => {
        const res = await this.egress(`${this.base}/client/verify/bank_account`, {
          method: "POST",
          headers: {
            authorization: await this.basic(),
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify(digioBankAccountBody(r)),
        });
        if (res.status === 400 || res.status === 422)
          throw refused("Digio refused the bank account check", "invalid_request");
        if (res.status !== 200) throw vendorError(KYC, ADAPTER, res.status, "Digio bank account");
        const v = mapDigioBankAccount(safeJson(res));
        const result: BankAccountResult = {
          ...this.evidence(v.vendorRef, "bank-account-pennyless-v1"),
          status: v.status,
          mode,
          ...(v.nameAtBank ? { nameAtBank: v.nameAtBank } : {}),
          ...(v.nameAtBank && r.name ? { nameMatch: bankNameMatch(r.name, v.nameAtBank) } : {}),
        };
        if (AADHAAR_LIKE.test(JSON.stringify(result)))
          throw vendorError(KYC, ADAPTER, 502, "the reply carried an Aadhaar-like number");
        return result;
      },
    });
  }

  async verifyAadhaarOffline(
    raw: Parameters<KycPort["verifyAadhaarOffline"]>[0],
    call?: PortCall,
  ): Promise<AadhaarOfflineResult> {
    await this.guard();
    const r = AadhaarOfflineCheck.parse(raw);
    // Digio's offline e-KYC call takes the ZIP and its share code; the Secure QR is not verified
    // here until its path is checked against UIDAI's Secure QR specification (PR-UDF-039, R1-D-190).
    if (r.kind === "secure_qr") return this.unsupported("verifyAadhaarOffline (secure_qr)");
    const tenant = this.tenant(call);
    const o = await this.o.storage.get(r.file.storageKey);
    if (sha256Hex(o.body) !== r.file.sha256)
      throw refused("the stored file does not match its SHA-256", "hash_mismatch");
    const res = await this.egress(`${this.base}/client/kyc/v2/offline_aadhaar/verify`, {
      method: "POST",
      headers: {
        authorization: await this.basic(),
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        file_data: Buffer.from(o.body).toString("base64"),
        share_code: r.shareCode,
      }),
    });
    if (res.status === 400) {
      const code = String((res.json() as { code?: unknown }).code ?? "");
      if (/SHARE_CODE/i.test(code))
        throw refused("the share code does not open the file", "share_code");
      throw refused("Digio refused the offline e-KYC file", "invalid_file");
    }
    if (res.status !== 200) throw vendorError(KYC, ADAPTER, res.status, "Digio offline Aadhaar");
    const v = res.json() as DigioOfflineAadhaar;
    const d = v.details ?? {};
    const last4 = /([0-9]{4})$/.exec(d.aadhaar_last_digits ?? "")?.[1];
    if (!v.id || !last4 || !d.name || !d.generated_at)
      throw vendorError(KYC, ADAPTER, 502, "offline e-KYC response without its fields");
    // The number itself never leaves the vendor: refuse a reply that carries it anywhere.
    for (const s of [d.name, d.dob, d.gender, d.generated_at])
      if (s && AADHAAR_LIKE.test(s))
        throw vendorError(KYC, ADAPTER, 502, "the reply carried an Aadhaar-like number");
    const gender = d.gender?.toUpperCase();
    const photo = d.photo
      ? await this.store(tenant, Buffer.from(d.photo, "base64"), "jpg", "image/jpeg")
      : undefined;
    return {
      ...this.evidence(v.id, v.model_version),
      kind: "xml_zip",
      signatureValid: v.signature_valid === true,
      aadhaarLast4: last4,
      name: d.name,
      ...(d.dob ? { dob: d.dob } : {}),
      ...(gender === "M" || gender === "F" || gender === "T" ? { gender } : {}),
      ...(photo ? { photo } : {}),
      generatedAt: d.generated_at,
    };
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled())) status = "down";
      else {
        const res = await this.egress(`${this.base}/client/kyc/v2/ipb-health/response`, {
          method: "GET",
          headers: { authorization: await this.basic(), accept: "application/json" },
        });
        if (res.status >= 500 || res.status === 401 || res.status === 403) status = "down";
      }
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: this.now().toISOString(),
    };
  }

  private async basic(): Promise<string> {
    const raw = `${await this.o.clientId()}:${await this.o.clientSecret()}`;
    return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
  }

  private async call(method: string, path: string): Promise<unknown> {
    const res = await this.egress(`${this.base}${path}`, {
      method,
      headers: { authorization: await this.basic(), accept: "application/json" },
    });
    if (res.status === 404) throw refused("Digio does not know this KYC request", "not_found");
    if (res.status !== 200) throw vendorError(KYC, ADAPTER, res.status, "Digio KYC API");
    return res.json();
  }

  private async unsupported(method: string): Promise<never> {
    throw refused(`${ADAPTER} does not provide ${method}`, "unsupported");
  }
  verifyPan(): Promise<never> {
    return this.unsupported("verifyPan");
  }
  ckycSearch(): Promise<never> {
    return this.unsupported("ckycSearch");
  }
  ckycDownload(): Promise<never> {
    return this.unsupported("ckycDownload");
  }
  startVcip(): Promise<never> {
    return this.unsupported("startVcip");
  }
  vcipStatus(): Promise<never> {
    return this.unsupported("vcipStatus");
  }
  /** No RE-hosted V-CIP launcher is known at this vendor (PR-UDF-045). */
  launchVcip(): Promise<never> {
    return this.unsupported("launchVcip");
  }
  livenessCheck(): Promise<never> {
    return this.unsupported("livenessCheck");
  }
  faceMatch(): Promise<never> {
    return this.unsupported("faceMatch");
  }
  ovdOcr(): Promise<never> {
    return this.unsupported("ovdOcr");
  }
  amlScreen(): Promise<never> {
    return this.unsupported("amlScreen");
  }
  /** No V-CIP webhook scheme of this vendor is known to the platform (PR-UDF-046) [VERIFY]. */
  verifyWebhook(): Promise<never> {
    return this.unsupported("verifyWebhook");
  }
  handleWebhook(): Promise<never> {
    return this.unsupported("handleWebhook");
  }
}
