// C-27 (owner answer #99; R1-D-59): App Attest attestation and assertion verification against a
// test authority in Apple's format, and the pinned Apple root.
import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  APPLE_APP_ATTEST_ROOT_PEM,
  AppAttestError,
  decodeCbor,
  verifyAppAttestAssertion,
  verifyAppAttestAttestation,
} from "./app-attest.js";
import { appAttestTestAuthority, encodeCbor } from "./app-attest-test.js";

const APP = "ABCDE12345.in.example.borrower";
const ca = appAttestTestAuthority();
const reason = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof AppAttestError ? e.reason : `other: ${(e as Error).message}`;
  }
  return "accepted";
};

describe("C-27 App Attest (owner answer #99)", () => {
  it("pins Apple's App Attestation root", () => {
    const root = new X509Certificate(APPLE_APP_ATTEST_ROOT_PEM);
    expect(root.subject).toContain("CN=Apple App Attestation Root CA");
    expect(root.ca).toBe(true);
    expect(new Date(root.validTo).getUTCFullYear()).toBe(2045);
  });

  it("verifies an attestation for its app, key and challenge, and its assertions", () => {
    const { attestation, key } = ca.attest(APP, "nonce-0123456789abcdef");
    const k = verifyAppAttestAttestation({
      attestation,
      appId: APP,
      keyId: key.keyId,
      challenge: "nonce-0123456789abcdef",
      roots: [ca.rootPem],
    });
    expect(k.environment).toBe("production");
    expect(new TextDecoder().decode(k.receipt)).toBe("test-receipt");
    const a1 = ca.assert(APP, "req-1", key, 1);
    expect(
      verifyAppAttestAssertion({
        assertion: a1,
        appId: APP,
        publicKey: k.publicKey,
        challenge: "req-1",
        counter: 0,
      }),
    ).toEqual({ counter: 1 });
    // The counter must grow; another challenge or app is refused.
    expect(
      reason(() =>
        verifyAppAttestAssertion({
          assertion: a1,
          appId: APP,
          publicKey: k.publicKey,
          challenge: "req-1",
          counter: 1,
        }),
      ),
    ).toBe("replayed");
    expect(
      reason(() =>
        verifyAppAttestAssertion({
          assertion: a1,
          appId: APP,
          publicKey: k.publicKey,
          challenge: "req-2",
          counter: 0,
        }),
      ),
    ).toBe("binding_mismatch");
    expect(
      reason(() =>
        verifyAppAttestAssertion({
          assertion: a1,
          appId: "ABCDE12345.in.example.other",
          publicKey: k.publicKey,
          challenge: "req-1",
          counter: 0,
        }),
      ),
    ).toBe("app_mismatch");
  });

  it("refuses every way an attestation can be wrong", () => {
    const base = (o: Parameters<typeof ca.attest>[2] = {}) =>
      ca.attest(APP, "nonce-0123456789abcdef", o);
    const check = (a: ReturnType<typeof base>, over: Record<string, unknown> = {}) =>
      reason(() =>
        verifyAppAttestAttestation({
          attestation: a.attestation,
          appId: APP,
          keyId: a.key.keyId,
          challenge: "nonce-0123456789abcdef",
          roots: [ca.rootPem],
          ...over,
        }),
      );
    // Not chained to the pinned Apple root (production never passes `roots`).
    expect(check(base(), { roots: undefined })).toBe("invalid");
    expect(check(base(), { roots: [appAttestTestAuthority().rootPem] })).toBe("invalid");
    expect(check(base({ nonceFor: "another-challenge-000" }))).toBe("binding_mismatch");
    expect(check(base(), { appId: "ZZZZZ99999.in.example.other" })).toBe("app_mismatch");
    expect(check(base(), { keyId: Buffer.alloc(32, 1).toString("base64") })).toBe("unknown_key");
    expect(check(base({ counter: 3 }))).toBe("invalid");
    expect(check(base({ development: true }))).toBe("invalid");
    expect(check(base({ development: true }), { allowDevelopment: true })).toBe("accepted");
    expect(check(base({ expired: true }))).toBe("invalid");
    expect(check({ ...base(), attestation: Buffer.from("not cbor").toString("base64") })).toBe(
      "invalid",
    );
    expect(
      check({
        ...base(),
        attestation: encodeCbor({
          fmt: "packed",
          attStmt: {},
          authData: new Uint8Array(1),
        }).toString("base64"),
      }),
    ).toBe("invalid");
  });

  it("decodes only well-formed, bounded CBOR", () => {
    expect(decodeCbor(encodeCbor({ a: [1, "x", new Uint8Array([7])] }))).toEqual(
      new Map<unknown, unknown>([["a", [1, "x", new Uint8Array([7])]]]),
    );
    expect(() => decodeCbor(Buffer.from([0x5f]))).toThrow(AppAttestError); // indefinite length
    expect(() => decodeCbor(Buffer.from([0x42, 0x01]))).toThrow(AppAttestError); // truncated
    expect(() => decodeCbor(Buffer.from([0x01, 0x02]))).toThrow(AppAttestError); // trailing bytes
    let deep: unknown = 1;
    for (let i = 0; i < 12; i++) deep = [deep];
    expect(() => decodeCbor(encodeCbor(deep as never))).toThrow(/too deeply/);
  });
});
