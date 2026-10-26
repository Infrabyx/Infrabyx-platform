// Signature records through the KMS port: every signature stores alg, key_id, created_at and
// cert_chain_ref (IPB-01 KMS port, IPB-12-05; anchors use ECDSA P-256/SHA-256, PL1-C-01).
import { createPublicKey, verify as nodeVerify } from "node:crypto";
import type { KmsPort } from "@infrabyx/contracts/ports";
import { fromBase64Url, toBase64Url, toBytes, type BytesLike } from "./encoding.js";
import { assertApproved } from "./registry.js";

export interface SignatureRecord {
  alg: string;
  digest_alg: "sha-256";
  key_id: string;
  created_at: string;
  cert_chain_ref: string | null;
  /** base64url DER signature */
  value: string;
}

export async function signRecord(
  kms: KmsPort,
  keyId: string,
  message: BytesLike,
  opts: { alg?: string; certChainRef?: string; now?: Date } = {},
): Promise<SignatureRecord> {
  const alg = opts.alg ?? "ecdsa-p256-sha256";
  assertApproved(alg, "signature");
  const sig = await kms.sign(keyId, toBytes(message), alg);
  return {
    alg,
    digest_alg: "sha-256",
    key_id: keyId,
    created_at: (opts.now ?? new Date()).toISOString(),
    cert_chain_ref: opts.certChainRef ?? null,
    value: toBase64Url(sig),
  };
}

/** Verify with a public key alone (SPKI DER), so a tenant can verify an anchor without our KMS. */
export function verifyRecord(
  record: SignatureRecord,
  message: BytesLike,
  publicKeySpkiDer: Uint8Array,
): boolean {
  if (record.alg !== "ecdsa-p256-sha256") throw new Error(`cannot verify ${record.alg} locally`);
  const key = createPublicKey({ key: Buffer.from(publicKeySpkiDer), format: "der", type: "spki" });
  return nodeVerify(
    "sha256",
    toBytes(message),
    { key, dsaEncoding: "der" },
    fromBase64Url(record.value),
  );
}
