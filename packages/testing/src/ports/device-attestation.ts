// DEVICE_ATTESTATION fake and contract cases (Udofin PR-UDF-028; ADR-0004; R1-D-50). The Google
// and Apple adapters wait for the owner's cryptography decision (OWNER-QUESTIONS #99); the fake is
// the in-memory implementation products test against meanwhile. It keeps the port's rules: a
// verdict must match its binding and app, an App Attest key is registered once and its counter
// only grows, and nothing identifying the device is returned.
import { expect } from "vitest";
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
import type { ContractCase } from "../contract.js";

const sameBinding = (a: AttestationBinding, b: AttestationBinding) =>
  a.kind === b.kind && a.value === b.value;

interface FakeToken {
  packageName: string;
  binding: AttestationBinding;
  verdicts: string[];
  licensed: boolean;
}

/** Mints fake device evidence the fake port accepts. */
export class FakeDeviceAttestation implements DeviceAttestationPort {
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

const PKG = "in.example.borrower";
const APP = "ABCDE12345.in.example.borrower";
const nonce = (): AttestationBinding => ({ kind: "nonce", value: toHex(randomBytes(16)) });

export function deviceAttestationContractCases(
  f: FakeDeviceAttestation,
): ContractCase<DeviceAttestationPort>[] {
  return [
    {
      name: "Play Integrity: a genuine device and app pass once, bound to the nonce",
      async run(p) {
        const b = nonce();
        const t = f.playToken({ packageName: PKG, binding: b });
        const v = await p.verifyPlayIntegrity({ packageName: PKG, token: t, binding: b });
        expect(v).toMatchObject({ ok: true, platform: "android" });
        expect(await p.verifyPlayIntegrity({ packageName: PKG, token: t, binding: b })).toEqual({
          ok: false,
          reason: "invalid",
        });
      },
    },
    {
      name: "Play Integrity: another nonce, app, an untrusted device or an unlicensed app is refused",
      async run(p) {
        const b = nonce();
        const other = nonce();
        const check = (token: string, binding = b, packageName = PKG) =>
          p.verifyPlayIntegrity({ packageName, token, binding });
        expect(await check(f.playToken({ packageName: PKG, binding: b }), other)).toEqual({
          ok: false,
          reason: "binding_mismatch",
        });
        expect(await check(f.playToken({ packageName: "in.example.other", binding: b }))).toEqual({
          ok: false,
          reason: "app_mismatch",
        });
        expect(
          await check(
            f.playToken({ packageName: PKG, binding: b, verdicts: ["MEETS_BASIC_INTEGRITY"] }),
          ),
        ).toEqual({ ok: false, reason: "device_not_trusted" });
        expect(await check(f.playToken({ packageName: PKG, binding: b, licensed: false }))).toEqual(
          {
            ok: false,
            reason: "app_not_licensed",
          },
        );
      },
    },
    {
      name: "App Attest: a key registers once, then assertions need a growing counter",
      async run(p) {
        const b = nonce();
        const a = f.attestation({ appId: APP, binding: b });
        const reg = await p.registerAppAttestKey({
          appId: APP,
          keyId: a.keyId,
          attestation: a.attestation,
          binding: b,
        });
        expect(reg.verdict).toMatchObject({ ok: true, platform: "ios" });
        expect(reg.key).toMatchObject({ keyId: a.keyId, appId: APP, counter: 0 });
        const again = f.attestation({ appId: APP, binding: b });
        expect(
          (
            await p.registerAppAttestKey({
              appId: APP,
              keyId: a.keyId,
              attestation: again.attestation,
              binding: b,
            })
          ).verdict,
        ).toEqual({ ok: false, reason: "replayed" });
        const key = reg.key!;
        const rb = nonce();
        const one = await p.verifyAppAttestAssertion(
          {
            appId: APP,
            keyId: key.keyId,
            assertion: f.assertion({ keyId: key.keyId, binding: rb, counter: 1 }),
            binding: rb,
          },
          key,
        );
        expect(one).toMatchObject({ verdict: { ok: true }, counter: 1 });
        const stale = await p.verifyAppAttestAssertion(
          {
            appId: APP,
            keyId: key.keyId,
            assertion: f.assertion({ keyId: key.keyId, binding: rb, counter: 1 }),
            binding: rb,
          },
          { ...key, counter: 1 },
        );
        expect(stale.verdict).toEqual({ ok: false, reason: "replayed" });
      },
    },
    {
      name: "a malformed request is refused before any check",
      async run(p) {
        await expect(
          p.verifyPlayIntegrity({ packageName: "Not A Package", token: "t", binding: nonce() }),
        ).rejects.toThrow();
        await expect(
          p.registerAppAttestKey({ appId: "bad", keyId: "k", attestation: "a", binding: nonce() }),
        ).rejects.toThrow();
      },
    },
  ];
}
