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
// - a DigiLocker file's issuer signature result as `signature_valid` beside the file.
// Each of these shapes lives in one small function below (`digioDigilockerStart*`), so the sandbox
// corrects it in one place.
// This adapter provides DigiLocker and Aadhaar offline only. Every other method is `unsupported`,
// so routing (`int.kyc.<method>.provider`) chooses another adapter for it. V-CIP waits for the
// owner (OWNER-QUESTIONS #90): Digio's video KYC records on Digio's side, while the port runs
// the call in a VIDEO_MEET room with no provider copy. Results never carry an Aadhaar number:
// only its last four digits, and any twelve-digit run in vendor text is refused.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AadhaarOfflineCheck,
  DIGILOCKER_RETURN_URL_REFUSED,
  DigilockerPull,
  StartDigilocker,
  digilockerReturnUrlAllowed,
  storageKey,
  type AadhaarOfflineResult,
  type AdapterDescriptor,
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
  private readonly gatewayHost: string;

  constructor(private readonly o: DigioKycOptions) {
    const mode = o.mode ?? "sandbox";
    this.base = (o.baseUrl ?? `https://${HOSTS[mode]}`).replace(/\/$/, "");
    this.now = o.now ?? (() => new Date());
    this.pulls = o.pulls ?? new MemoryDigilockerPullStore({ now: () => this.now() });
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
    // No storage key carries a 12-digit run (PR-UDF-040): a ULID that would is drawn again.
    let key = storageKey(tenant, "kyc", newId("kyc").slice(4), ext);
    while (AADHAAR_LIKE.test(key)) key = storageKey(tenant, "kyc", newId("kyc").slice(4), ext);
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
