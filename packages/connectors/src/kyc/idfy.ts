// KYC alternative adapter `idfy-kyc` (owner answer #91, R1-D-33, R1-plan M25): IDfy's verification
// task API over the egress client, no SDK. India-hosted (IN). Off behind `int.kyc.idfy.enabled`
// (default false) and `unproven` until the owner's IDfy sandbox exists and its sandbox leg runs.
// It provides the methods the Digio reference lacks, so the KYC port has a second source for each:
// PAN verification, face match and photo liveness. Every other method is `unsupported` (DigiLocker
// too, start and pull, until IDfy's sandbox confirms its DigiLocker flow; PR-UDF-040), and
// `KycMethodRouter` sends it to an adapter that has it.
//
// Vendor facts below are STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX ([VERIFY]); each one lives in
// one small mapping function so the sandbox can correct it in one place:
// - auth: headers `account-id` and `api-key`; host `eve.idfy.com` for sandbox and production;
// - a synchronous task: `POST /v3/tasks/sync/<action>/<type>` with `{ task_id, group_id, data }`,
//   answered `{ request_id, status: "completed", result }`;
// - PAN: `verify_with_source/ind_pan`, data `{ id_number, full_name, dob }`, result
//   `source_output.{ status: id_found|id_not_found, name_match_score, dob_match, aadhaar_seeding_status }`;
// - face match: `compare/face`, data `{ document1, document2 }` (base64), result `{ match_score }`;
// - liveness: `check_photo_liveness/face`, data `{ document1 }`, result `{ liveness_score }`;
// - Aadhaar OTP e-KYC (PR-UDF-041), as a KUA for a notified RE: `aadhaar_otp_request/ind_aadhaar`,
//   data `{ id_number, id_type, consent, consent_text_version, consent_text_hash, consent_at }`,
//   result `{ transaction_id, otp_valid_till }`; then `aadhaar_otp_verify/ind_aadhaar`, data
//   `{ transaction_id, otp }`, result `{ ekyc_xml (base64), aadhaar_last_4, signature_status,
//   model_version }`; refusals 422 with `error` (`INVALID_ID`, `MOBILE_NOT_LINKED`, `INVALID_OTP`,
//   `OTP_EXPIRED`, `TRANSACTION_NOT_FOUND`). Off unless the adapter is built with `notifiedEntity`.
// Images are read from STORAGE and checked against their SHA-256 before they leave; nothing the
// vendor returns is stored, except UIDAI's signed e-KYC response (written to STORAGE unchanged,
// unless it carries a number). Results never carry an Aadhaar number.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AadhaarOtpRequest,
  AadhaarOtpVerify,
  aadhaarUidValid,
  FaceMatch,
  LivenessCheck,
  PanCheck,
  storageKey,
  type AadhaarOtpRefusal,
  type AadhaarOtpResult,
  type AadhaarOtpStart,
  type AdapterDescriptor,
  type KycFileRef,
  type KycPort,
  type NameMatch,
  type PanResult,
  type PortCall,
  type PortHealth,
  type ScoreResult,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { newId, sha256Hex } from "@infrabyx/crypto";
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

const KYC = "KYC";
const ADAPTER = "idfy-kyc";
const HOST = "eve.idfy.com";
const AADHAAR_LIKE = /(?<![0-9])[0-9]{12}(?![0-9])/;
/** A 12-digit or 16-digit run outside a SHA-256 (PR-UDF-041). */
const UID_LIKE = /(?<![0-9])(?:[0-9]{12}|[0-9]{16})(?![0-9])/;
const uidLike = (v: unknown) => UID_LIKE.test(JSON.stringify(v).replace(/[0-9a-f]{64}/g, ""));

const UNSUPPORTED = [
  "verifyAadhaarOffline",
  "startDigilocker",
  "digilockerPull",
  "ckycSearch",
  "ckycDownload",
  "startVcip",
  "vcipStatus",
  "bankAccountVerify",
  "ovdOcr",
  "amlScreen",
  "handleWebhook",
] as const;

export interface IdfyKycOptions {
  storage: StoragePort;
  /** `int.kyc.idfy.enabled`, read on every call; off until the owner's sandbox exists. */
  enabled: () => Promise<boolean> | boolean;
  /** `secrets/<env>/kyc/idfy/account_id` and `api_key`. */
  accountId: () => Promise<string> | string;
  apiKey: () => Promise<string> | string;
  /** Pass marks for the scores (the tenant's thresholds); 0.8 each by default. */
  faceMatchThreshold?: number;
  livenessThreshold?: number;
  /**
   * Aadhaar OTP e-KYC (PR-UDF-041): `true` only for a reporting entity notified under PML Act
   * s.11A (KYC Directions 2025 para 23 proviso (i) [VERIFY]). Default false: every Aadhaar OTP call
   * is refused `not_configured` before any vendor call.
   */
  notifiedEntity?: boolean;
  /** Keyed Aadhaar OTP verifies: `PgAadhaarOtpVerifyStore` in production (default in memory). */
  aadhaarOtpVerifies?: AadhaarOtpVerifyStore;
  /** The tenant when the call names none (the tenancy context); the e-KYC is stored under it. */
  currentTenant?: () => string | undefined;
  /** Tests only: the IDfy stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
  now?: () => Date;
}

interface IdfyTask<R> {
  request_id?: string;
  status?: string;
  result?: R;
}

// ---- stub-shaped mappings (to confirm against the sandbox) -------------------------------------

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: the PAN result. */
export function mapIdfyPan(result: unknown): Omit<PanResult, keyof EvidenceKeys> {
  const o = (result as { source_output?: Record<string, unknown> } | undefined)?.source_output;
  if (!o || typeof o.status !== "string")
    throw vendorError(KYC, ADAPTER, 502, "PAN result without its status");
  if (o.status === "id_not_found") return { status: "not_found", nameMatch: "mismatch" };
  if (o.status !== "id_found") return { status: "invalid", nameMatch: "mismatch" };
  const s = typeof o.name_match_score === "number" ? o.name_match_score : 0;
  const nameMatch: NameMatch = s >= 0.99 ? "match" : s >= 0.5 ? "partial" : "mismatch";
  return {
    status: "valid",
    nameMatch,
    ...(typeof o.dob_match === "boolean" ? { dobMatch: o.dob_match } : {}),
    ...(typeof o.aadhaar_seeding_status === "string"
      ? { aadhaarSeeded: o.aadhaar_seeding_status === "Y" }
      : {}),
  };
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: a 0–1 score from a face task's result. */
export function mapIdfyScore(
  result: unknown,
  field: "match_score" | "liveness_score",
): { score: number; modelVersion: string } {
  const r = result as Record<string, unknown> | undefined;
  const raw = r?.[field];
  if (typeof raw !== "number" || !Number.isFinite(raw))
    throw vendorError(KYC, ADAPTER, 502, `face result without ${field}`);
  // IDfy may report 0–100; the port's scores are 0–1.
  const score = raw > 1 ? raw / 100 : raw;
  return {
    score: Math.min(1, Math.max(0, score)),
    modelVersion: typeof r?.model_version === "string" ? r.model_version : `idfy-${field}`,
  };
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: IDfy's refusal codes on the OTP tasks. */
export function mapIdfyAadhaarOtpRefusal(json: unknown): AadhaarOtpRefusal | undefined {
  const code = String((json as { error?: unknown } | undefined)?.error ?? "").toUpperCase();
  if (/^INVALID_ID$|INVALID_AADHAAR|INVALID_VID/.test(code)) return "uid_invalid";
  if (/MOBILE_NOT_LINKED/.test(code)) return "mobile_not_linked";
  if (/OTP_EXPIRED|TRANSACTION_NOT_FOUND|TRANSACTION_EXPIRED|ALREADY_USED/.test(code))
    return "otp_expired";
  if (/INVALID_OTP/.test(code)) return "otp_invalid";
  return undefined;
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: the verify task's result. */
export function mapIdfyAadhaarOtpVerify(result: unknown): {
  modelVersion: string;
  ekyc: Buffer;
  signatureValid: boolean | null;
  uidLast4: string;
} {
  const r = result as Record<string, unknown> | undefined;
  const last = typeof r?.aadhaar_last_4 === "string" ? r.aadhaar_last_4 : "";
  const xml = typeof r?.ekyc_xml === "string" ? Buffer.from(r.ekyc_xml, "base64") : undefined;
  if (!/^[0-9]{4}$/.test(last) || !xml?.length)
    throw vendorError(
      KYC,
      ADAPTER,
      502,
      "Aadhaar OTP result without its e-KYC or last four digits",
    );
  const sig = r?.signature_status;
  return {
    modelVersion:
      typeof r?.model_version === "string" ? r.model_version.slice(0, 100) : "ind_aadhaar-otp-v3",
    ekyc: xml,
    signatureValid: sig === "valid" ? true : sig === "invalid" ? false : null,
    uidLast4: last,
  };
}

type EvidenceKeys = { vendorRef: string; adapter: string; modelVersion: string; checkedAt: string };

const refused = (detail: string, reason: string): PortError =>
  new PortError("IPB-PORT-001", KYC, {
    adapter: ADAPTER,
    detail,
    meta: { reason, definite: true },
  });

export class IdfyKyc implements KycPort {
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
  private readonly otpVerifies: AadhaarOtpVerifyStore;

  constructor(private readonly o: IdfyKycOptions) {
    this.base = (o.baseUrl ?? `https://${HOST}`).replace(/\/$/, "");
    this.now = o.now ?? (() => new Date());
    this.otpVerifies =
      o.aadhaarOtpVerifies ?? new MemoryAadhaarOtpVerifyStore({ now: () => this.now() });
    this.egress = createEgress({
      port: KYC,
      adapter: ADAPTER,
      allow: [HOST],
      retries: 1,
      maxBytes: 4 * 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async guard(): Promise<void> {
    if (!(await this.o.enabled()))
      throw refused("the IDfy KYC adapter is off (int.kyc.idfy.enabled)", "adapter_disabled");
  }

  private evidence(vendorRef: string, modelVersion: string): EvidenceKeys {
    return { vendorRef, adapter: ADAPTER, modelVersion, checkedAt: this.now().toISOString() };
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      "account-id": await this.o.accountId(),
      "api-key": await this.o.apiKey(),
      accept: "application/json",
      "content-type": "application/json",
    };
  }

  /**
   * One synchronous IDfy task; the task and group ids are ours and carry no personal data. `refusal`
   * maps a 400 or 422 answer to the port's own refusal, where the method has fixed labels.
   */
  private async task<R>(
    path: string,
    data: Record<string, string>,
    refusal?: (json: unknown) => PortError | undefined,
  ): Promise<{ ref: string; result: R }> {
    const res = await this.egress(`${this.base}/v3/tasks/sync/${path}`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ task_id: newId("kyt"), group_id: newId("kyg"), data }),
    });
    if ((res.status === 422 || res.status === 400) && refusal) {
      let json: unknown;
      try {
        json = res.json();
      } catch {
        json = undefined;
      }
      const e = refusal(json);
      if (e) throw e;
    }
    if (res.status === 422 || res.status === 400)
      throw refused("IDfy refused the request", "invalid_request");
    if (res.status !== 200) throw vendorError(KYC, ADAPTER, res.status, "IDfy task API");
    const t = res.json() as IdfyTask<R>;
    if (t.status !== "completed" || !t.request_id || t.result === undefined)
      throw vendorError(KYC, ADAPTER, 502, "IDfy task not completed");
    if (AADHAAR_LIKE.test(JSON.stringify(t.result)))
      throw vendorError(KYC, ADAPTER, 502, "the reply carried an Aadhaar-like number");
    return { ref: t.request_id, result: t.result };
  }

  /** Read an image from STORAGE, refusing one whose bytes no longer match its SHA-256. */
  private async image(f: KycFileRef): Promise<string> {
    const o = await this.o.storage.get(f.storageKey);
    if (sha256Hex(o.body) !== f.sha256)
      throw refused("the stored file does not match its SHA-256", "hash_mismatch");
    return Buffer.from(o.body).toString("base64");
  }

  async verifyPan(raw: Parameters<KycPort["verifyPan"]>[0], _call?: PortCall): Promise<PanResult> {
    const r = PanCheck.parse(raw);
    await this.guard();
    const { ref, result } = await this.task("verify_with_source/ind_pan", {
      id_number: r.pan,
      full_name: r.name,
      ...(r.dob ? { dob: r.dob } : {}),
    });
    return { ...this.evidence(ref, "ind_pan-v3"), ...mapIdfyPan(result) };
  }

  async faceMatch(
    raw: Parameters<KycPort["faceMatch"]>[0],
    _call?: PortCall,
  ): Promise<ScoreResult> {
    const r = FaceMatch.parse(raw);
    await this.guard();
    const [a, b] = [await this.image(r.a), await this.image(r.b)];
    const { ref, result } = await this.task("compare/face", { document1: a, document2: b });
    const { score, modelVersion } = mapIdfyScore(result, "match_score");
    return {
      ...this.evidence(ref, modelVersion),
      score,
      passed: score >= (this.o.faceMatchThreshold ?? 0.8),
    };
  }

  /** Each frame is checked; the session scores its weakest frame. */
  async livenessCheck(
    raw: Parameters<KycPort["livenessCheck"]>[0],
    _call?: PortCall,
  ): Promise<ScoreResult> {
    const r = LivenessCheck.parse(raw);
    await this.guard();
    let min = 1;
    let ref = "";
    let modelVersion = "";
    for (const f of r.frames) {
      const t = await this.task("check_photo_liveness/face", { document1: await this.image(f) });
      const s = mapIdfyScore(t.result, "liveness_score");
      if (s.score <= min) {
        min = s.score;
        ref = t.ref;
      }
      modelVersion = s.modelVersion;
    }
    return {
      ...this.evidence(ref, modelVersion),
      score: min,
      passed: min >= (this.o.livenessThreshold ?? 0.8),
    };
  }

  private tenant(call?: PortCall): string {
    const t = call?.tenantId ?? this.o.currentTenant?.();
    if (!t) throw refused("a KYC call needs a tenant to store its files under", "no_tenant");
    return t;
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
    // The number goes in this one task and nowhere else; it is not kept.
    const { ref, result } = await this.task<{ transaction_id?: unknown; otp_valid_till?: unknown }>(
      "aadhaar_otp_request/ind_aadhaar",
      {
        id_number: r.uid,
        id_type: r.uidKind === "VID" ? "vid" : "aadhaar",
        consent: "Y",
        consent_text_version: r.consent.version,
        consent_text_hash: r.consent.textHash,
        consent_at: r.consent.at,
      },
      (json) => {
        const reason = mapIdfyAadhaarOtpRefusal(json);
        return reason === "uid_invalid" || reason === "mobile_not_linked"
          ? aadhaarOtpRefused(ADAPTER, reason, `IDfy refused the OTP request (${reason})`)
          : undefined;
      },
    );
    const txn = result.transaction_id;
    const till =
      typeof result.otp_valid_till === "string" ? Date.parse(result.otp_valid_till) : NaN;
    if (
      typeof txn !== "string" ||
      !/^[A-Za-z0-9_-]{8,200}$/.test(txn) ||
      !Number.isFinite(till) ||
      till <= this.now().getTime()
    )
      throw vendorError(KYC, ADAPTER, 502, "Aadhaar OTP request without its transaction or expiry");
    const out = {
      ...this.evidence(ref, "ind_aadhaar-otp-v3"),
      txn,
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
        const { ref, result } = await this.task(
          "aadhaar_otp_verify/ind_aadhaar",
          { transaction_id: r.txn, otp: r.otp },
          (json) => {
            const reason = mapIdfyAadhaarOtpRefusal(json);
            return reason === "otp_invalid" || reason === "otp_expired"
              ? aadhaarOtpRefused(ADAPTER, reason, `IDfy refused the OTP (${reason})`)
              : undefined;
          },
        );
        const v = mapIdfyAadhaarOtpVerify(result);
        if (holdsAadhaarNumber(v.ekyc.toString("latin1")))
          throw refused(
            "the e-KYC response carries an Aadhaar number or VID; it is not stored outside the RE's vault",
            "ekyc_holds_number",
          );
        // No storage key carries a 12- or 16-digit run: such a ULID is drawn again.
        let key = storageKey(tenant, "kyc", newId("kyc").slice(4), "xml");
        while (UID_LIKE.test(key)) key = storageKey(tenant, "kyc", newId("kyc").slice(4), "xml");
        const sha256 = sha256Hex(v.ekyc);
        await this.o.storage.put(key, v.ekyc, {
          bucketClass: "REGULATED",
          contentType: "application/xml",
          sha256,
        });
        const out: AadhaarOtpResult = {
          ...this.evidence(ref, v.modelVersion),
          ekyc: { storageKey: key, sha256 },
          signatureValid: v.signatureValid,
          uidLast4: v.uidLast4,
        };
        if (uidLike(out))
          throw vendorError(KYC, ADAPTER, 502, "the reply carried an Aadhaar-like number");
        return out;
      },
    });
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled())) status = "down";
      else {
        // An empty task: 400/422 proves the credentials and the route; 401/403/5xx are down.
        const res = await this.egress(`${this.base}/v3/tasks/sync/verify_with_source/ind_pan`, {
          method: "POST",
          headers: await this.headers(),
          body: "{}",
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

  private async unsupported(method: string): Promise<never> {
    throw refused(`${ADAPTER} does not provide ${method}`, "unsupported");
  }
  verifyAadhaarOffline(): Promise<never> {
    return this.unsupported("verifyAadhaarOffline");
  }
  /** IDfy's DigiLocker flow is added when its sandbox confirms it (PR-UDF-040; exit.ts). */
  startDigilocker(): Promise<never> {
    return this.unsupported("startDigilocker");
  }
  digilockerPull(): Promise<never> {
    return this.unsupported("digilockerPull");
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
  bankAccountVerify(): Promise<never> {
    return this.unsupported("bankAccountVerify");
  }
  ovdOcr(): Promise<never> {
    return this.unsupported("ovdOcr");
  }
  amlScreen(): Promise<never> {
    return this.unsupported("amlScreen");
  }
  handleWebhook(): Promise<never> {
    return this.unsupported("handleWebhook");
  }
}
