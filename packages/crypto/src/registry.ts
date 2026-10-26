// Algorithm registry and CBOM export (IPB-12 §12.6 item 1; fut.cbom-export OFF by default).
export type AlgorithmPurpose = "hash" | "mac" | "aead" | "signature" | "kdf" | "rng";
export type AlgorithmStatus = "approved" | "deprecated" | "planned";

export interface AlgorithmInfo {
  id: string;
  purpose: AlgorithmPurpose;
  status: AlgorithmStatus;
  primitive: string;
  parameterSet: string;
  oid?: string;
  usedFor: string[];
  note?: string;
}

export const ALGORITHMS: readonly AlgorithmInfo[] = Object.freeze([
  {
    id: "sha-256",
    purpose: "hash",
    status: "approved",
    primitive: "hash",
    parameterSet: "256",
    oid: "2.16.840.1.101.3.4.2.1",
    usedFor: ["audit ledger chain (C-01)", "digests", "migration checksums"],
  },
  {
    id: "hmac-sha-256",
    purpose: "mac",
    status: "approved",
    primitive: "mac",
    parameterSet: "256",
    oid: "1.2.840.113549.2.9",
    usedFor: [
      "ip_hash/ua_hash/actor pseudonyms (C-02)",
      "blind index (C-05)",
      "webhook signatures",
      "telemetry and flag-context ID hashes, 128-bit truncation (C-21)",
    ],
  },
  {
    id: "aes-256-gcm",
    purpose: "aead",
    status: "approved",
    primitive: "ae",
    parameterSet: "256",
    oid: "2.16.840.1.101.3.4.1.46",
    usedFor: ["field envelope encryption (C-04)", "LocalKms data-key wrap"],
  },
  {
    id: "ecdsa-p256-sha256",
    purpose: "signature",
    status: "approved",
    primitive: "signature",
    parameterSet: "P-256",
    oid: "1.2.840.10045.4.3.2",
    usedFor: ["audit anchor signatures (C-03)"],
  },
  {
    id: "hkdf-sha256",
    purpose: "kdf",
    status: "approved",
    primitive: "kdf",
    parameterSet: "256",
    usedFor: [
      "LocalKms dev key derivation (C-10)",
      "telemetry ID key, label ipb/telemetry-id/v1 (C-21)",
    ],
  },
  {
    id: "ctr-drbg-os",
    purpose: "rng",
    status: "approved",
    primitive: "drbg",
    parameterSet: "os",
    usedFor: ["node:crypto.randomBytes (C-06)"],
  },
  {
    id: "ed25519",
    purpose: "signature",
    status: "planned",
    primitive: "signature",
    parameterSet: "Ed25519",
    oid: "1.3.101.112",
    usedFor: [],
    note: "KMS support differs between providers [VERIFY] (C-03)",
  },
  {
    id: "ml-dsa-65+ecdsa-p256",
    purpose: "signature",
    status: "planned",
    primitive: "signature",
    parameterSet: "ML-DSA-65 hybrid",
    usedFor: [],
    note: "behind crypto.pqc.sign_hybrid / fut.pqc-hybrid-sign (IPB-OI-01-10)",
  },
]);

export function algorithmInfo(id: string): AlgorithmInfo | undefined {
  return ALGORITHMS.find((a) => a.id === id);
}

export function assertApproved(id: string, purpose?: AlgorithmPurpose): AlgorithmInfo {
  const a = algorithmInfo(id);
  if (!a || a.status !== "approved")
    throw new Error(`algorithm ${id} is not approved in the crypto registry`);
  if (purpose && a.purpose !== purpose)
    throw new Error(`algorithm ${id} is not approved for ${purpose}`);
  return a;
}

/** CycloneDX 1.6 cryptographic-asset BOM (CBOM) of the registry (IPB-12 A6). */
export function cbom(
  opts: { serialNumber?: string; timestamp?: string } = {},
): Record<string, unknown> {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    ...(opts.serialNumber ? { serialNumber: opts.serialNumber } : {}),
    version: 1,
    metadata: {
      ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
      component: { type: "library", name: "@infrabyx/crypto" },
    },
    components: ALGORITHMS.map((a) => ({
      type: "cryptographic-asset",
      "bom-ref": `crypto/algorithm/${a.id}`,
      name: a.id,
      cryptoProperties: {
        assetType: "algorithm",
        ...(a.oid ? { oid: a.oid } : {}),
        algorithmProperties: {
          primitive: a.primitive,
          parameterSetIdentifier: a.parameterSet,
          executionEnvironment: "software-plain-ram",
        },
      },
      properties: [
        { name: "infrabyx:status", value: a.status },
        { name: "infrabyx:usedFor", value: a.usedFor.join("; ") },
      ],
    })),
  };
}
