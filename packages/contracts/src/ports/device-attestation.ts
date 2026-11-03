// DEVICE_ATTESTATION port (Udofin PR-UDF-028; ADR-0004; R1-D-50): the server checks that a request
// comes from the product's genuine app on a genuine device: an Android Play Integrity
// standard-request token, or an iOS App Attest attestation (once per key) and assertions (per
// request), each bound to a nonce the server issued or to the request's DPoP key thumbprint.
// Interfaces and the in-memory fake only: the Google and Apple adapters need cryptography the
// owner has not approved yet (OWNER-QUESTIONS #99), so they are not built.
import { z } from "zod";
import type { Port } from "./common.js";

/** What the attestation is bound to: a single-use server nonce, or the DPoP key's `jkt`. */
export const AttestationBinding = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("nonce"), value: z.string().min(16).max(128) }),
  z.object({
    kind: z.literal("dpop_jkt"),
    value: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
]);
export type AttestationBinding = z.infer<typeof AttestationBinding>;

export const PlayIntegrityCheck = z.object({
  /** The app's package name, e.g. `in.example.borrower`. */
  packageName: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  /** The standard request's integrity token. */
  token: z.string().min(1).max(16384),
  binding: AttestationBinding,
});
export type PlayIntegrityCheck = z.infer<typeof PlayIntegrityCheck>;

export const AppAttestRegistration = z.object({
  /** `<team id>.<bundle id>`. */
  appId: z.string().regex(/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/),
  keyId: z.string().min(1).max(128),
  /** The CBOR attestation object, base64. */
  attestation: z.string().min(1).max(65536),
  binding: AttestationBinding,
});
export type AppAttestRegistration = z.infer<typeof AppAttestRegistration>;

export const AppAttestAssertion = z.object({
  appId: z.string().regex(/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/),
  keyId: z.string().min(1).max(128),
  /** The CBOR assertion, base64. */
  assertion: z.string().min(1).max(16384),
  binding: AttestationBinding,
});
export type AppAttestAssertion = z.infer<typeof AppAttestAssertion>;

export const ATTESTATION_FAILURES = [
  "invalid",
  "binding_mismatch",
  "app_mismatch",
  "device_not_trusted",
  "app_not_licensed",
  "replayed",
  "unknown_key",
] as const;
export type AttestationFailure = (typeof ATTESTATION_FAILURES)[number];

export type AttestationVerdict =
  | {
      ok: true;
      platform: "android" | "ios";
      /** Play Integrity device verdicts, or `["app_attest"]`; never a device identifier. */
      deviceIntegrity: readonly string[];
      checkedAt: string;
    }
  | { ok: false; reason: AttestationFailure };

/** Public key and counter kept for an App Attest key after registration (the product stores it). */
export interface AppAttestKeyRecord {
  keyId: string;
  appId: string;
  /** SPKI DER, base64. */
  publicKey: string;
  counter: number;
}

export interface DeviceAttestationPort extends Port {
  verifyPlayIntegrity(req: PlayIntegrityCheck): Promise<AttestationVerdict>;
  /** Verify an App Attest attestation; on success, the key record to keep with the device. */
  registerAppAttestKey(
    req: AppAttestRegistration,
  ): Promise<{ verdict: AttestationVerdict; key?: AppAttestKeyRecord }>;
  /** Verify an assertion by a registered key; the counter must grow (returned for storage). */
  verifyAppAttestAssertion(
    req: AppAttestAssertion,
    key: AppAttestKeyRecord,
  ): Promise<{ verdict: AttestationVerdict; counter?: number }>;
}
