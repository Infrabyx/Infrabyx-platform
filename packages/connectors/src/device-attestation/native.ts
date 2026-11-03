// DEVICE_ATTESTATION reference adapter `native` (Udofin PR-UDF-028; ADR-0004; owner answer #99,
// R1-D-57, R1-D-59): Google Play Integrity and Apple App Attest, both off until the owner's Google
// Cloud project and Apple developer account exist (`int.device_attestation.play_integrity.enabled`,
// `int.device_attestation.app_attest.enabled`), and `unproven` until then.
// - Play Integrity: the standard-request token goes to Google's `decodeIntegrityToken` over the
//   egress client, with an access token from a service-account assertion (C-24, widened to the
//   Play Integrity scope by #99) or from keyless workload identity. The verdict is ours: the
//   request hash must equal the binding, the package and the signing certificate ours, the app
//   recognised and licensed, the device at least MEETS_DEVICE_INTEGRITY, the token recent and used
//   once (a replay store keyed by its SHA-256).
// - App Attest: verified here, with no call to Apple (C-27 in `@infrabyx/crypto`): the chain to
//   Apple's pinned root, the nonce, the app id, the key id and, per request, the ES256 signature
//   and a growing counter. A key registers once (the product's key registry says which exist).
// Nothing identifying the device is returned or stored here.
import { PortError } from "@infrabyx/contracts/errors";
import {
  AppAttestAssertion,
  AppAttestRegistration,
  PlayIntegrityCheck,
  type AdapterDescriptor,
  type AppAttestKeyRecord,
  type AttestationVerdict,
  type DeviceAttestationPort,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import {
  AppAttestError,
  PLAY_INTEGRITY_SCOPE,
  sha256Hex,
  verifyAppAttestAssertion,
  verifyAppAttestAttestation,
  type ReplayStore,
} from "@infrabyx/crypto";
import { googleServiceAccountToken } from "../core/google-token.js";
import { createEgress } from "../core/http.js";
import { vendorError } from "../messaging/common.js";

const PORT = "DEVICE_ATTESTATION";
const ADAPTER = "native";
const PLAY_HOST = "playintegrity.googleapis.com";
/** Play Integrity's device verdicts, weakest first; the minimum is configurable. */
const DEVICE_LEVELS = ["MEETS_BASIC_INTEGRITY", "MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY"];

export type PlayIntegrityCredentials =
  | {
      kind: "service_account";
      clientEmail: string;
      /** `secrets/<env>/device_attestation/play_integrity/service_account_key` (PKCS#8 PEM). */
      privateKey: () => Promise<string> | string;
      privateKeyId?: string;
    }
  | { kind: "access_token"; accessToken: () => Promise<string> | string };

export interface NativeDeviceAttestationOptions {
  /** Remembers used Play Integrity tokens (a shared store, e.g. `RedisReplayStore`). */
  replay: ReplayStore;
  /** The product's App Attest keys: whether one is registered, and recording a new one. */
  keys: { has(keyId: string): Promise<boolean>; add(keyId: string): Promise<void> };
  playIntegrity?: {
    /** `int.device_attestation.play_integrity.enabled`, read on every call. */
    enabled: () => Promise<boolean> | boolean;
    credentials: PlayIntegrityCredentials;
    /** Per package, the SHA-256 digests (base64url) of the app signing certificates accepted. */
    signingCerts: Readonly<Record<string, readonly string[]>>;
    /** The weakest device verdict accepted (default MEETS_DEVICE_INTEGRITY). */
    minDevice?: "MEETS_BASIC_INTEGRITY" | "MEETS_DEVICE_INTEGRITY" | "MEETS_STRONG_INTEGRITY";
    /** How old a token may be (default 5 minutes). */
    maxAgeMs?: number;
    /** Tests only: the Play Integrity and token-endpoint stubs. */
    baseUrl?: string;
    tokenUrl?: string;
  };
  appAttest?: {
    /** `int.device_attestation.app_attest.enabled`, read on every call. */
    enabled: () => Promise<boolean> | boolean;
    /** Accept development-environment keys (never above test environments). */
    allowDevelopment?: boolean;
    /** Tests only: a test authority's root in place of Apple's. */
    testRoots?: readonly string[];
  };
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

interface TokenPayload {
  requestDetails?: { requestPackageName?: string; requestHash?: string; timestampMillis?: string };
  appIntegrity?: {
    appRecognitionVerdict?: string;
    packageName?: string;
    certificateSha256Digest?: string[];
  };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  accountDetails?: { appLicensingVerdict?: string };
}

const refusedOff = (what: string, flag: string) =>
  new PortError("IPB-PORT-001", PORT, {
    adapter: ADAPTER,
    detail: `${what} is off (${flag})`,
    meta: { reason: "adapter_disabled", definite: true },
  });

export class NativeDeviceAttestation implements DeviceAttestationPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    // Only the integrity token reaches Google (device verdicts and our nonce, nothing personal);
    // App Attest is verified here.
    residency: "GLOBAL",
    maxDataClass: "INTERNAL",
  };
  private readonly egress;
  private readonly token?: () => Promise<string>;
  private readonly now: () => number;

  constructor(private readonly o: NativeDeviceAttestationOptions) {
    this.now = o.now ?? Date.now;
    this.egress = createEgress({
      port: PORT,
      adapter: ADAPTER,
      allow: [PLAY_HOST, "oauth2.googleapis.com"],
      retries: 1,
      timeoutMs: 5000,
      maxBytes: 64 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
    const c = o.playIntegrity?.credentials;
    if (c)
      this.token =
        c.kind === "access_token"
          ? async () => c.accessToken()
          : googleServiceAccountToken({
              port: PORT,
              adapter: ADAPTER,
              clientEmail: c.clientEmail,
              privateKey: c.privateKey,
              ...(c.privateKeyId ? { privateKeyId: c.privateKeyId } : {}),
              scope: PLAY_INTEGRITY_SCOPE,
              ...(o.playIntegrity?.tokenUrl ? { tokenUrl: o.playIntegrity.tokenUrl } : {}),
              ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
              ...(o.now ? { now: o.now } : {}),
            });
  }

  private verdict(platform: "android" | "ios", device: readonly string[]): AttestationVerdict {
    return {
      ok: true,
      platform,
      deviceIntegrity: device,
      checkedAt: new Date(this.now()).toISOString(),
    };
  }

  async verifyPlayIntegrity(raw: PlayIntegrityCheck): Promise<AttestationVerdict> {
    const r = PlayIntegrityCheck.parse(raw);
    const p = this.o.playIntegrity;
    if (!p || !this.token || !(await p.enabled()))
      throw refusedOff("Play Integrity", "int.device_attestation.play_integrity.enabled");
    const maxAge = p.maxAgeMs ?? 5 * 60_000;
    // A token is used once, whatever Google says about it.
    if (!(await this.o.replay.claim(`pi:${sha256Hex(r.token)}`, new Date(this.now() + 2 * maxAge))))
      return { ok: false, reason: "invalid" };
    const base = (p.baseUrl ?? `https://${PLAY_HOST}`).replace(/\/$/, "");
    const res = await this.egress(
      `${base}/v1/${encodeURIComponent(r.packageName)}:decodeIntegrityToken`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.token()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ integrity_token: r.token }),
      },
    );
    if (res.status === 400) return { ok: false, reason: "invalid" };
    if (res.status !== 200) throw vendorError(PORT, ADAPTER, res.status, "decodeIntegrityToken");
    const t = res.json<{ tokenPayloadExternal?: TokenPayload }>().tokenPayloadExternal ?? {};
    const req = t.requestDetails ?? {};
    const app = t.appIntegrity ?? {};
    if (req.requestPackageName !== r.packageName || app.packageName !== r.packageName)
      return { ok: false, reason: "app_mismatch" };
    if (req.requestHash !== r.binding.value) return { ok: false, reason: "binding_mismatch" };
    const at = Number(req.timestampMillis);
    if (!Number.isFinite(at) || Math.abs(this.now() - at) > maxAge)
      return { ok: false, reason: "invalid" };
    const certs = p.signingCerts[r.packageName] ?? [];
    if (
      app.appRecognitionVerdict !== "PLAY_RECOGNIZED" ||
      !(app.certificateSha256Digest ?? []).some((d) => certs.includes(d))
    )
      return { ok: false, reason: "app_mismatch" };
    if (t.accountDetails?.appLicensingVerdict !== "LICENSED")
      return { ok: false, reason: "app_not_licensed" };
    const device = t.deviceIntegrity?.deviceRecognitionVerdict ?? [];
    const min = DEVICE_LEVELS.indexOf(p.minDevice ?? "MEETS_DEVICE_INTEGRITY");
    if (!device.some((d) => DEVICE_LEVELS.indexOf(d) >= min))
      return { ok: false, reason: "device_not_trusted" };
    return this.verdict(
      "android",
      device.filter((d) => DEVICE_LEVELS.includes(d)),
    );
  }

  private async appAttestOn(): Promise<NonNullable<NativeDeviceAttestationOptions["appAttest"]>> {
    const a = this.o.appAttest;
    if (!a || !(await a.enabled()))
      throw refusedOff("App Attest", "int.device_attestation.app_attest.enabled");
    return a;
  }

  async registerAppAttestKey(raw: AppAttestRegistration) {
    const r = AppAttestRegistration.parse(raw);
    const a = await this.appAttestOn();
    if (await this.o.keys.has(r.keyId))
      return { verdict: { ok: false, reason: "replayed" } as const };
    try {
      const k = verifyAppAttestAttestation({
        attestation: r.attestation,
        appId: r.appId,
        keyId: r.keyId,
        challenge: r.binding.value,
        ...(a.allowDevelopment ? { allowDevelopment: true } : {}),
        ...(a.testRoots ? { roots: a.testRoots } : {}),
        now: new Date(this.now()),
      });
      await this.o.keys.add(r.keyId);
      const key: AppAttestKeyRecord = {
        keyId: r.keyId,
        appId: r.appId,
        publicKey: Buffer.from(k.publicKey).toString("base64"),
        counter: 0,
      };
      return { verdict: this.verdict("ios", ["app_attest"]), key };
    } catch (e) {
      if (e instanceof AppAttestError) return { verdict: { ok: false, reason: e.reason } as const };
      throw e;
    }
  }

  async verifyAppAttestAssertion(raw: AppAttestAssertion, key: AppAttestKeyRecord) {
    const r = AppAttestAssertion.parse(raw);
    await this.appAttestOn();
    if (r.keyId !== key.keyId || !(await this.o.keys.has(key.keyId)))
      return { verdict: { ok: false, reason: "unknown_key" } as const };
    if (r.appId !== key.appId) return { verdict: { ok: false, reason: "app_mismatch" } as const };
    try {
      const { counter } = verifyAppAttestAssertion({
        assertion: r.assertion,
        appId: r.appId,
        publicKey: Buffer.from(key.publicKey, "base64"),
        challenge: r.binding.value,
        counter: key.counter,
      });
      return { verdict: this.verdict("ios", ["app_attest"]), counter };
    } catch (e) {
      if (e instanceof AppAttestError) return { verdict: { ok: false, reason: e.reason } as const };
      throw e;
    }
  }

  /** Up when an enabled half has what it needs; neither vendor has a probe that spends nothing. */
  async health(): Promise<PortHealth> {
    let status: PortHealth["status"] = "down";
    try {
      const play = this.o.playIntegrity && this.token && (await this.o.playIntegrity.enabled());
      const ios = this.o.appAttest && (await this.o.appAttest.enabled());
      if (play || ios) status = "up";
    } catch {
      status = "down";
    }
    return { status, latency_ms: 0, checked_at: new Date(this.now()).toISOString() };
  }
}
