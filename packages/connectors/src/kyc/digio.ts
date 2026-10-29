// KYC reference adapter `digio-kyc` (owner answer #87, R1-D-22, R1-plan M16): the Digio KYC API v2
// over the egress client, no SDK. India-hosted (IN). Off behind `int.kyc.digio.enabled` (default
// false) and `unproven` until the owner's Digio account exists and its sandbox leg runs. Vendor
// facts below are [VERIFY] until then:
// - auth: HTTP Basic with client id and secret; sandbox `ext.digio.in`, production `api.digio.in`;
// - a KYC request is created from a template the tenant configures at Digio (DigiLocker step),
//   the customer completes it in Digio's gateway, and the result is read with
//   `GET /client/kyc/v2/{request_id}/response`; its files with `GET /client/kyc/v2/media/{file_id}`;
// - Aadhaar Offline e-KYC: `POST /client/kyc/v2/offline_aadhaar/verify` with the XML zip (or QR
//   payload) and the share code.
// This adapter provides DigiLocker and Aadhaar offline only. Every other method is `unsupported`,
// so routing (`int.kyc.<method>.provider`) chooses another adapter for it. V-CIP waits for the
// owner (OWNER-QUESTIONS #90): Digio's video KYC records on Digio's side, while the port runs
// the call in a VIDEO_MEET room with no provider copy. Results never carry an Aadhaar number:
// only its last four digits, and any twelve-digit run in vendor text is refused.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AadhaarOfflineCheck,
  DigilockerPull,
  storageKey,
  type AadhaarOfflineResult,
  type AdapterDescriptor,
  type DigilockerDocument,
  type KycFileRef,
  type KycPort,
  type PortCall,
  type PortHealth,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { newId, sha256Hex, type ReplayStore } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import { vendorError } from "../messaging/common.js";

const KYC = "KYC";
const ADAPTER = "digio-kyc";
const HOSTS = { sandbox: "ext.digio.in", production: "api.digio.in" } as const;
/** A consent session is claimed once and remembered for longer than any Digio request lives. */
const CONSENT_MEMORY_MS = 400 * 24 * 3600 * 1000;
const AADHAAR_LIKE = /(?<![0-9])[0-9]{12}(?![0-9])/;

const UNSUPPORTED = [
  "verifyPan",
  "ckycSearch",
  "ckycDownload",
  "startVcip",
  "vcipStatus",
  "livenessCheck",
  "faceMatch",
  "bankAccountVerify",
  "ovdOcr",
  "amlScreen",
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

const refused = (detail: string, reason: string, definite = true): PortError =>
  new PortError("IPB-PORT-001", KYC, { adapter: ADAPTER, detail, meta: { reason, definite } });

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

  constructor(private readonly o: DigioKycOptions) {
    const mode = o.mode ?? "sandbox";
    this.base = (o.baseUrl ?? `https://${HOSTS[mode]}`).replace(/\/$/, "");
    this.now = o.now ?? (() => new Date());
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

  private evidence(vendorRef: string, modelVersion = "kyc-v2") {
    return {
      vendorRef,
      adapter: ADAPTER,
      modelVersion,
      checkedAt: this.now().toISOString(),
    };
  }

  /** Write a vendor file to STORAGE (REGULATED, under the tenant) and return its reference. */
  private async store(tenant: string, body: Uint8Array, ext: string, contentType: string) {
    const key = storageKey(tenant, "kyc", newId("kyc").slice(4), ext);
    const sha256 = sha256Hex(body);
    await this.o.storage.put(key, body, { bucketClass: "REGULATED", contentType, sha256 });
    return { storageKey: key, sha256 } satisfies KycFileRef;
  }

  async digilockerPull(
    raw: Parameters<KycPort["digilockerPull"]>[0],
    call?: PortCall,
  ): Promise<DigilockerDocument[]> {
    await this.guard();
    const r = DigilockerPull.parse(raw);
    const tenant = this.tenant(call);
    const res = (await this.call(
      "GET",
      `/client/kyc/v2/${encodeURIComponent(r.consentSession)}/response`,
    )) as DigioKycResponse;
    const action = (res.actions ?? []).find((a) => a.type === "digilocker");
    const done = ["approved", "completed", "success"];
    if (!action || !done.includes((action.status ?? "").toLowerCase()))
      throw refused("the customer has not completed the DigiLocker step", "consent_incomplete");
    // Claimed only once the vendor confirms the session, so a refused pull does not burn it.
    const fresh = await this.o.consents.claim(
      `kyc:digio:digilocker:${r.consentSession}`,
      new Date(this.now().getTime() + CONSENT_MEMORY_MS),
    );
    if (!fresh) throw refused("the consent session was already used", "consent_used");
    const out: DigilockerDocument[] = [];
    for (const f of action.sub_files ?? []) {
      const docType = r.docTypes.find((t) => t === f.doc_type);
      if (!docType || !f.file_id) continue;
      const media = await this.egress(
        `${this.base}/client/kyc/v2/media/${encodeURIComponent(f.file_id)}`,
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
      });
    }
    return out;
  }

  async verifyAadhaarOffline(
    raw: Parameters<KycPort["verifyAadhaarOffline"]>[0],
    call?: PortCall,
  ): Promise<AadhaarOfflineResult> {
    await this.guard();
    const r = AadhaarOfflineCheck.parse(raw);
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
  livenessCheck(): Promise<never> {
    return this.unsupported("livenessCheck");
  }
  faceMatch(): Promise<never> {
    return this.unsupported("faceMatch");
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
