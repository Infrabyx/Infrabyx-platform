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
    usedFor: [
      "audit ledger chain (C-01)",
      "digests",
      "migration checksums",
      "partner mTLS client-certificate thumbprint x5t#S256 (RFC 8705 §3.1) and fingerprint (PR-UDF-064, R1-D-238)",
      "PAdES/CMS verification digests, ESS certificate hashes and OCSP CertIDs (C-28, R1-D-246); verify only",
    ],
  },
  {
    id: "sha-384",
    purpose: "hash",
    status: "approved",
    primitive: "hash",
    parameterSet: "384",
    oid: "2.16.840.1.101.3.4.2.2",
    usedFor: [
      "PAdES/CMS verification digests, ESS certificate hashes and OCSP CertIDs only (C-28, R1-D-246); verify only",
    ],
  },
  {
    id: "sha-512",
    purpose: "hash",
    status: "approved",
    primitive: "hash",
    parameterSet: "512",
    oid: "2.16.840.1.101.3.4.2.3",
    usedFor: [
      "PAdES/CMS verification digests, ESS certificate hashes and OCSP CertIDs only (C-28, R1-D-246); verify only",
    ],
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
      "vendor webhook signatures: Razorpay, Cashfree, Meta, Standard Webhooks v1 (C-13; R1-D-199, owner review #150)",
      "telemetry and flag-context ID hashes, 128-bit truncation (C-21)",
      "suppression and marketing-consent address hash (C-23)",
      "LiveKit only, as HS256 JWTs: join tokens (≤ 300 s, one room, one identity), server-API tokens (≤ 60 s, one grant) and webhook verification (C-26); never for any other token",
    ],
  },
  {
    id: "hmac-sha1",
    purpose: "mac",
    status: "approved",
    primitive: "mac",
    parameterSet: "160",
    oid: "1.2.840.113549.2.7",
    usedFor: ["Leegality webhook verification only (C-25); never for signing anything of ours"],
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
    usedFor: [
      "audit anchor signatures (C-03)",
      "JWT ES256 verification (C-11)",
      "export manifest and ExportCompleted detached JWS through KMS sign (C-22)",
      "regulated Ecosystem messages, detached JWS with kid, iat and jti through KMS sign (C-22 profile, R1-D-08)",
      "DPoP proof verification for customer sessions: ES256 only, jkt binding, iat window, jti replay (C-11, R1-D-18)",
      "Apple App Attest assertion and credential-certificate verification, with the counter (C-27, R1-D-59); verify only",
      "on-premises agent request proofs: the C-22 profile with typ ipb-agent-request+jws, bound to tenant, agent, seq, method, path and body digest; agent-held P-256 keys (TallyPrime agent, R1-D-178)",
      "document transfer integrity (Ecosystem §3.6): the C-22 profile with typ ipb-document+jws over the JCS descriptor { document_id, version, sha256 } (PR-UDF-053, R1-D-219)",
      "document transfer integrity, descriptor v2: the same C-22 profile with typ ipb-document-v2+jws over the JCS descriptor { application_id?, document_id, media_type, sha256, size_bytes, type, version } (PR-UDF-061, R1-D-236)",
      "partner mTLS pinned-CA check: X.509 issuer signatures on P-256 only, verify only; any other issuer algorithm refused (PR-UDF-064, R1-D-238; owner question #170)",
    ],
  },
  {
    id: "ecdsa-p384-sha384",
    purpose: "signature",
    status: "approved",
    primitive: "signature",
    parameterSet: "P-384",
    oid: "1.2.840.10045.4.3.3",
    usedFor: [
      "Apple App Attest certificate chain to the pinned Apple App Attestation root only (C-27, R1-D-59); verify only",
      "PAdES/CMS signature verification only: the CMS signer, its certificate chain to the pinned CCA India trust, RFC 3161 timestamps, caller-supplied CRLs and OCSP responses (C-28, R1-D-246); verify only, never sign",
    ],
  },
  {
    id: "rsassa-pss-sha256",
    purpose: "signature",
    status: "approved",
    primitive: "signature",
    parameterSet: "RSA ≥ 2048, MGF1-SHA-256, salt 32",
    oid: "1.2.840.113549.1.1.10",
    usedFor: [
      "JWT PS256 verification (C-11)",
      "PAdES/CMS signature verification only: the CMS signer, its certificate chain to the pinned CCA India trust, RFC 3161 timestamps, caller-supplied CRLs and OCSP responses (C-28, R1-D-246); verify only, never sign",
    ],
  },
  {
    id: "rsassa-pss-sha384",
    purpose: "signature",
    status: "approved",
    primitive: "signature",
    parameterSet: "RSA ≥ 2048, MGF1-SHA-384, salt as signed",
    oid: "1.2.840.113549.1.1.10",
    usedFor: [
      "PAdES/CMS signature verification only: the CMS signer, its certificate chain to the pinned CCA India trust, RFC 3161 timestamps, caller-supplied CRLs and OCSP responses (C-28, R1-D-246); verify only, never sign",
    ],
  },
  {
    id: "rsassa-pss-sha512",
    purpose: "signature",
    status: "approved",
    primitive: "signature",
    parameterSet: "RSA ≥ 2048, MGF1-SHA-512, salt as signed",
    oid: "1.2.840.113549.1.1.10",
    usedFor: [
      "PAdES/CMS signature verification only: the CMS signer, its certificate chain to the pinned CCA India trust, RFC 3161 timestamps, caller-supplied CRLs and OCSP responses (C-28, R1-D-246); verify only, never sign",
    ],
  },
  {
    id: "rsassa-pkcs1-v1_5-sha256",
    purpose: "signature",
    status: "approved",
    primitive: "signature",
    parameterSet: "RSA, vendor-defined",
    oid: "1.2.840.113549.1.1.11",
    usedFor: [
      "Amazon SNS SignatureVersion 2 verification only (C-13)",
      "Google service-account assertion for FCM, Vertex AI and Play Integrity OAuth only (C-24, PL4-C-01, R1-D-59); never for platform tokens",
      "PAdES/CMS signature verification only: the CMS signer, its certificate chain to the pinned CCA India trust, RFC 3161 timestamps, caller-supplied CRLs and OCSP responses (C-28, R1-D-246); verify only, never sign",
    ],
  },
  {
    id: "rsassa-pkcs1-v1_5-sha384",
    purpose: "signature",
    status: "approved",
    primitive: "signature",
    parameterSet: "RSA ≥ 2048",
    oid: "1.2.840.113549.1.1.12",
    usedFor: [
      "PAdES/CMS signature verification only: the CMS signer, its certificate chain to the pinned CCA India trust, RFC 3161 timestamps, caller-supplied CRLs and OCSP responses (C-28, R1-D-246); verify only, never sign",
    ],
  },
  {
    id: "rsassa-pkcs1-v1_5-sha512",
    purpose: "signature",
    status: "approved",
    primitive: "signature",
    parameterSet: "RSA ≥ 2048",
    oid: "1.2.840.113549.1.1.13",
    usedFor: [
      "PAdES/CMS signature verification only: the CMS signer, its certificate chain to the pinned CCA India trust, RFC 3161 timestamps, caller-supplied CRLs and OCSP responses (C-28, R1-D-246); verify only, never sign",
    ],
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
