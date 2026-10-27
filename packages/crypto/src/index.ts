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
  snsCertUrlAllowed,
  generateWebhookSecret,
  type SnsMessage,
  type SnsVerifyOptions,
  type SnsFailure,
} from "./webhook-sig.js";
export { encodeKmsContext, decodeKmsContext, assertKmsContext } from "./kms-context.js";
export { addressHash, normaliseAddress, type AddressKind } from "./address-hash.js";
export {
  signServiceAccountAssertion,
  GOOGLE_TOKEN_URL,
  FCM_SCOPE,
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
