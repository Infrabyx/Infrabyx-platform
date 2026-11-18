// DEVICE_ATTESTATION fake, evidence minters and contract cases (Udofin PR-UDF-028; ADR-0004;
// R1-D-50, R1-D-59). The cases take a minter of device evidence, so the same rules run on the fake
// and on the `native` adapter (the Play Integrity stub and an App Attest test authority): a verdict
// must match its binding and app, a Play Integrity token counts once, an App Attest key registers
// once and its counter only grows, and nothing identifying the device is returned.
import {
  AppAttestAssertion,
  AppAttestRegistration,
  PlayIntegrityCheck,
  type AdapterDescriptor,
  type AppAttestKeyRecord,
  type AttestationBinding,
  type AttestationVerdict,
  type DeviceAttestationPort,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import { randomBytes, toBase64Url, toHex } from "@infrabyx/crypto";

/** Makes device evidence for the contract cases: the fake's own, or real formats for `native`. */
export interface DeviceEvidence {
  playToken(o: {
    packageName: string;
    binding: AttestationBinding;
    verdicts?: string[];
    licensed?: boolean;
  }): string;
  attestation(o: { appId: string; binding: AttestationBinding }): {
    keyId: string;
    attestation: string;
  };
  assertion(o: { keyId: string; binding: AttestationBinding; counter: number }): string;
}

const sameBinding = (a: AttestationBinding, b: AttestationBinding) =>
  a.kind === b.kind && a.value === b.value;

interface FakeToken {
  packageName: string;
  binding: AttestationBinding;
  verdicts: string[];
  licensed: boolean;
}

/** Mints fake device evidence the fake port accepts. */
export class FakeDeviceAttestation implements DeviceAttestationPort, DeviceEvidence {
  readonly descriptor: AdapterDescriptor = {
    port: "DEVICE_ATTESTATION",
    adapter: "fake-device-attestation",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  private readonly play = new Map<string, FakeToken>();
  private readonly attest = new Map<string, { appId: string; binding: AttestationBinding }>();
  private readonly registered = new Set<string>();
  private readonly assertions = new Map<
    string,
    { keyId: string; binding: AttestationBinding; counter: number }
  >();
  private readonly now = () => new Date().toISOString();

  playToken(o: {
    packageName: string;
    binding: AttestationBinding;
    verdicts?: string[];
    licensed?: boolean;
  }): string {
    const t = `play.${toHex(randomBytes(12))}`;
    this.play.set(t, {
      packageName: o.packageName,
      binding: o.binding,
      verdicts: o.verdicts ?? ["MEETS_DEVICE_INTEGRITY"],
      licensed: o.licensed ?? true,
    });
    return t;
  }
  attestation(o: { appId: string; binding: AttestationBinding }): {
    keyId: string;
    attestation: string;
  } {
    const keyId = toBase64Url(randomBytes(16));
    const attestation = `att.${toHex(randomBytes(12))}`;
    this.attest.set(attestation, o);
    return { keyId, attestation };
  }
  assertion(o: { keyId: string; binding: AttestationBinding; counter: number }): string {
    const a = `asr.${toHex(randomBytes(12))}`;
    this.assertions.set(a, o);
    return a;
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: this.now() };
  }

  async verifyPlayIntegrity(raw: PlayIntegrityCheck): Promise<AttestationVerdict> {
    const r = PlayIntegrityCheck.parse(raw);
    const t = this.play.get(r.token);
    if (!t) return { ok: false, reason: "invalid" };
    this.play.delete(r.token);
    if (t.packageName !== r.packageName) return { ok: false, reason: "app_mismatch" };
    if (!sameBinding(t.binding, r.binding)) return { ok: false, reason: "binding_mismatch" };
    if (!t.licensed) return { ok: false, reason: "app_not_licensed" };
    if (!t.verdicts.includes("MEETS_DEVICE_INTEGRITY"))
      return { ok: false, reason: "device_not_trusted" };
    return { ok: true, platform: "android", deviceIntegrity: t.verdicts, checkedAt: this.now() };
  }

  async registerAppAttestKey(raw: AppAttestRegistration) {
    const r = AppAttestRegistration.parse(raw);
    const a = this.attest.get(r.attestation);
    if (!a) return { verdict: { ok: false, reason: "invalid" } as const };
    if (this.registered.has(r.keyId))
      return { verdict: { ok: false, reason: "replayed" } as const };
    if (a.appId !== r.appId) return { verdict: { ok: false, reason: "app_mismatch" } as const };
    if (!sameBinding(a.binding, r.binding))
      return { verdict: { ok: false, reason: "binding_mismatch" } as const };
    this.attest.delete(r.attestation);
    this.registered.add(r.keyId);
    const key: AppAttestKeyRecord = {
      keyId: r.keyId,
      appId: r.appId,
      publicKey: toBase64Url(randomBytes(32)),
      counter: 0,
    };
    return {
      verdict: {
        ok: true,
        platform: "ios",
        deviceIntegrity: ["app_attest"],
        checkedAt: this.now(),
      } as const,
      key,
    };
  }

  async verifyAppAttestAssertion(raw: AppAttestAssertion, key: AppAttestKeyRecord) {
    const r = AppAttestAssertion.parse(raw);
    const a = this.assertions.get(r.assertion);
    if (!a) return { verdict: { ok: false, reason: "invalid" } as const };
    if (r.keyId !== key.keyId || a.keyId !== key.keyId || !this.registered.has(key.keyId))
      return { verdict: { ok: false, reason: "unknown_key" } as const };
    if (r.appId !== key.appId) return { verdict: { ok: false, reason: "app_mismatch" } as const };
    if (!sameBinding(a.binding, r.binding))
      return { verdict: { ok: false, reason: "binding_mismatch" } as const };
    if (a.counter <= key.counter) return { verdict: { ok: false, reason: "replayed" } as const };
    return {
      verdict: {
        ok: true,
        platform: "ios",
        deviceIntegrity: ["app_attest"],
        checkedAt: this.now(),
      } as const,
      counter: a.counter,
    };
  }
}
