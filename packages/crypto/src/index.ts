// @infrabyx/crypto — the only cryptography call-site of the platform (IPB-12-05, PL1-C-01..C-10).
// node:crypto only; no third-party cryptography (C-09). A future PQC or FIPS change touches this package.
export const PACKAGE_NAME = "@infrabyx/crypto" as const;
export * from "./encoding.js";
export * from "./jcs.js";
export { sha256, sha256Hex, hash, canonicalDigest, type HashAlgorithm } from "./hash.js";
export { SecretKey } from "./keys.js";
export {
  hmacSha256,
  hmacSha256Hex,
  pseudonymise,
  hashedActorId,
  deriveSubKey,
  telemetryIdHasher,
  TELEMETRY_ID_LABEL,
} from "./hmac.js";
export { randomBytes, randomInt } from "./random.js";
export { ulid, newId, deterministicId, ulidTime } from "./ulid.js";
export { aesGcmEncrypt, aesGcmDecrypt, AES_GCM_NONCE_BYTES, AES_GCM_TAG_BYTES } from "./aead.js";
export {
  FieldEnvelope,
  fieldAad,
  FIELD_ALG,
  DATA_KEY_MAX_USES,
  DATA_KEY_TTL_MS,
  type SealedField,
  type EnvelopeOptions,
} from "./envelope.js";
export { blindIndex, normaliseForIndex } from "./blind-index.js";
export {
  BlindIndexer,
  blindIndexSecretPath,
  loadBlindIndexRoot,
  localBlindIndexRoot,
  tenantBlindIndexKey,
  type BlindIndexRoot,
  type VersionedIndex,
} from "./blind-index-keys.js";
export { signRecord, verifyRecord, type SignatureRecord } from "./sign.js";
export { ALGORITHMS, algorithmInfo, assertApproved, cbom, type AlgorithmInfo } from "./registry.js";
export { generateSeedPassword, isValidSeedPassword, SEED_PASSWORD_LENGTH } from "./password.js";
export {
  LocalKms,
  LOCAL_KMS_KEYS,
  localTenantKeyId,
  localDevKey,
  devKeyFingerprint,
  devKeyFingerprints,
  matchesDevKey,
} from "./local-kms.js";
export {
  verifyJws,
  verifyJwt,
  jwkToVerifyKey,
  strictBase64Url,
  JwksCache,
  JWS_ALGORITHMS,
  type JwsAlgorithm,
  type PublicJwk,
  type JwtPolicy,
  type JwsVerifyOptions,
  type VerifiedJws,
  type VerifiedJwt,
  type JwtFailure,
  type JwksCacheOptions,
} from "./jwt.js";
export {
  verifyRazorpaySignature,
  verifyCashfreeSignature,
  verifyMetaSignature,
  verifySnsMessage,
  verifyWebhookSecret,
  verifyLeegalityMac,
  verifyStandardWebhook,
  signStandardWebhookForTest,
  STANDARD_WEBHOOK_TOLERANCE_SECONDS,
  STANDARD_WEBHOOK_MAX_SIGNATURES,
  snsCertUrlAllowed,
  generateWebhookSecret,
  type SnsMessage,
  type SnsVerifyOptions,
  type SnsFailure,
  type StandardWebhookHeaders,
  type StandardWebhookFailure,
} from "./webhook-sig.js";
export { encodeKmsContext, decodeKmsContext, assertKmsContext } from "./kms-context.js";
export { addressHash, normaliseAddress, type AddressKind } from "./address-hash.js";
export {
  signServiceAccountAssertion,
  GOOGLE_TOKEN_URL,
  FCM_SCOPE,
  VERTEX_SCOPE,
  PLAY_INTEGRITY_SCOPE,
  GOOGLE_ASSERTION_SCOPES,
  type ServiceAccountAssertionInput,
} from "./google-assertion.js";
export {
  signDetachedJws,
  verifyDetachedJws,
  derToJose,
  spkiToEs256Jwk,
  cloudEventSigningPayload,
  type DerSigner,
  type Es256PublicJwk,
} from "./detached-jws.js";
export {
  signRegulatedMessage,
  verifyRegulatedMessage,
  RegulatedKeyRing,
  localRegulatedSigner,
  MemoryReplayStore,
  REGULATED_JWS_TYP,
  REGULATED_JWS_MAX_AGE_SECONDS,
  REGULATED_JWS_MAX_SKEW_SECONDS,
  type RegulatedJwsHeader,
  type RegulatedVerifyKey,
  type ReplayStore,
  type RegulatedJwsFailure,
  type RegulatedJwsResult,
} from "./regulated-jws.js";
export {
  verifyDpopProof,
  jwkThumbprint,
  accessTokenHash,
  normaliseHtu,
  DPOP_TYP,
  DPOP_MAX_AGE_SECONDS,
  DPOP_MAX_SKEW_SECONDS,
  DPOP_MAX_AGE_LIMIT_SECONDS,
  DPOP_MAX_SKEW_LIMIT_SECONDS,
  type DpopJwk,
  type DpopFailure,
  type DpopResult,
} from "./dpop.js";
export {
  signAgentRequest,
  verifyAgentRequest,
  agentRequestKid,
  agentRequestPayload,
  generateAgentKeyPair,
  agentPublicJwk,
  exportAgentPrivateKey,
  importAgentPrivateKey,
  sha256Matches,
  AGENT_REQUEST_JWS_TYP,
  AGENT_REQUEST_MAX_AGE_SECONDS,
  AGENT_REQUEST_MAX_SKEW_SECONDS,
  type AgentRequest,
  type AgentJwk,
  type AgentKeyPair,
  type AgentPrivateKey,
  type AgentRequestFailure,
  type AgentRequestResult,
} from "./agent-request-jws.js";
export {
  LiveKitCredentials,
  signLiveKitJoinToken,
  signLiveKitServerToken,
  verifyLiveKitWebhook,
  signLiveKitWebhookForTest,
  LIVEKIT_JOIN_TOKEN_MAX_SECONDS,
  LIVEKIT_SERVER_TOKEN_MAX_SECONDS,
  LIVEKIT_WEBHOOK_SKEW_SECONDS,
  LIVEKIT_SERVER_IDENTITY,
  type LiveKitJoinGrants,
  type LiveKitServerGrant,
  type LiveKitWebhookFailure,
} from "./livekit-token.js";
export {
  APPLE_APP_ATTEST_ROOT_PEM,
  APPLE_APP_ATTEST_ROOT_SHA256,
  AppAttestError,
  appleNonceOf,
  decodeCbor,
  verifyAppAttestAssertion,
  verifyAppAttestAttestation,
  type AppAttestAssertionInput,
  type AppAttestAttestationInput,
  type AppAttestFailure,
  type AppAttestKey,
} from "./app-attest.js";
export {
  DOCUMENT_JWS_TYP,
  DOCUMENT_JWS_V2_TYP,
  signDocumentJws,
  signDocumentJwsV2,
  verifyDocumentJws,
  type DocumentDescriptor,
  type DocumentDescriptorV2,
  type DocumentJwsProfile,
  type DocumentJwsResult,
  type DocumentJwsVerification,
  type DocumentJwsVerifyOptions,
} from "./document-jws.js";
export {
  verifyPadesSignatures,
  padesSignerCertificates,
  customTrustStore,
  CCA_INDIA_TRUST,
  PADES_OUTCOMES,
  PADES_DOCUMENT_OUTCOMES,
  PADES_LIMITS,
  type PadesVerifyOptions,
  type PadesVerifyResult,
  type PadesSignatureResult,
  type PadesOutcome,
  type PadesDocumentOutcome,
  type PadesTimeSource,
  type PadesTrustStore,
  type PinnedCertificate,
  type RevocationEvidence,
  type RevocationStatus,
} from "./pades.js";
export { signerCertificateSummary, type SignerCertificateSummary } from "./signer-certificate.js";
export { CCA_INDIA_ROOTS, CCA_INDIA_INTERMEDIATES } from "./cca-india-trust.js";
export { REVOCATION_LIMITS } from "./pades-revocation.js";
export {
  readClientCertificate,
  PinnedCaSet,
  CLIENT_CERT_REFUSALS,
  CLIENT_CERT_MAX_HEADER_BYTES,
  CLIENT_CERT_MAX_INTERMEDIATES,
  CLIENT_CERT_ISSUER_SIGNATURE_OID,
  type ClientCertificate,
  type ClientCertificateSource,
  type ClientCertRefusal,
  type ClientCertResult,
  type EdgeHeaderFormat,
  type ReadClientCertificateOptions,
} from "./client-cert.js";
export {
  checkClientCredential,
  CLIENT_CREDENTIAL_REFUSALS,
  type ClientCredentialInfo,
  type ClientCredentialRefusal,
  type ClientCredentialResult,
} from "./client-credential.js";
export {
  StandardWebhookReceiver,
  STANDARD_WEBHOOK_REFUSALS,
  STANDARD_WEBHOOK_MAX_BODY_BYTES,
  STANDARD_WEBHOOK_BODY_LIMIT_BYTES,
  type StandardWebhookReceiverOptions,
  type StandardWebhookDelivery,
  type StandardWebhookRefusal,
  type StandardWebhookResult,
  type WebhookHeaderBag,
} from "./webhook-receiver.js";
