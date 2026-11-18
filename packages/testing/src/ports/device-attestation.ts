// DEVICE_ATTESTATION fake, evidence minters and contract cases (Udofin PR-UDF-028; ADR-0004;
// R1-D-50, R1-D-59). The cases take a minter of device evidence, so the same rules run on the fake
// and on the `native` adapter (the Play Integrity stub and an App Attest test authority): a verdict
// must match its binding and app, a Play Integrity token counts once, an App Attest key registers
// once and its counter only grows, and nothing identifying the device is returned.
// DEVICE_ATTESTATION fake, evidence minters and contract cases (Udofin PR-UDF-028; ADR-0004;
// R1-D-50, R1-D-59). The cases take a minter of device evidence, so the same rules run on the fake
// and on the `native` adapter (the Play Integrity stub and an App Attest test authority): a verdict
// must match its binding and app, a Play Integrity token counts once, an App Attest key registers
// once and its counter only grows, and nothing identifying the device is returned.
import { expect } from "vitest";
import type { AttestationBinding, DeviceAttestationPort } from "@infrabyx/contracts/ports";
import { randomBytes, toHex } from "@infrabyx/crypto";
import {
  appAttestTestAuthority,
  type AppAttestTestAuthority,
  type TestAppKey,
} from "@infrabyx/crypto/app-attest-test";
import type { ContractCase } from "../contract.js";
import type { PlayIntegrityStub } from "../stubs/play-integrity.js";
import { type DeviceEvidence } from "@infrabyx/fakes";
export { type DeviceEvidence, FakeDeviceAttestation } from "@infrabyx/fakes";

/** Evidence the `native` adapter accepts: Play Integrity stub tokens and App Attest objects. */
export function nativeDeviceEvidence(
  play: PlayIntegrityStub,
  authority: AppAttestTestAuthority = appAttestTestAuthority(),
): DeviceEvidence & { authority: AppAttestTestAuthority } {
  const keys = new Map<string, { appId: string; key: TestAppKey }>();
  return {
    authority,
    playToken: (o) =>
      play.mint({
        packageName: o.packageName,
        requestHash: o.binding.value,
        ...(o.verdicts ? { verdicts: o.verdicts } : {}),
        ...(o.licensed === false ? { licensed: false } : {}),
      }),
    attestation(o) {
      const { attestation, key } = authority.attest(o.appId, o.binding.value);
      keys.set(key.keyId, { appId: o.appId, key });
      return { keyId: key.keyId, attestation };
    },
    assertion(o) {
      const k = keys.get(o.keyId);
      if (!k) throw new Error("no such test key");
      return authority.assert(k.appId, o.binding.value, k.key, o.counter);
    },
  };
}

const PKG = "in.example.borrower";
const APP = "ABCDE12345.in.example.borrower";
const nonce = (): AttestationBinding => ({ kind: "nonce", value: toHex(randomBytes(16)) });

export function deviceAttestationContractCases(
  f: DeviceEvidence,
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
