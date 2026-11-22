// @infrabyx/contracts — shared vocabulary of the Infrabyx platform (IPB-01, IPB-10).
// Zero runtime dependencies beyond Zod (IPB-01 §01.4.2). Subpath imports are preferred.
export const PACKAGE_NAME = "@infrabyx/contracts" as const;
export * from "./data-class.js";
export * from "./ids.js";
export * from "./env.js";
export * from "./roles.js";
export * from "./tiers.js";
export * from "./errors.js";
export * from "./events/index.js";
export * from "./modules.js";
export * from "./module-lifecycle.js";
export * from "./kernel.js";
export * from "./ports/index.js";
export * from "./routing.js";
export * from "./connector-manifest.js";
export * from "./export.js";
export * from "./vidhi.js";
export * from "./search-refusal.js";
// `verhoeffValid` comes through ./search-refusal.js (the same function).
export {
  AADHAAR_CARRIER_NAME_ENDINGS,
  AADHAAR_FIELD_NAMES,
  AADHAAR_LABELLED_VALUE_MAX,
  AADHAAR_LIKE_KINDS,
  AADHAAR_LOOK_ALIKES,
  findAadhaarCarrierFields,
  findAadhaarLabelledValues,
  findAadhaarLike,
  findAadhaarNamedFields,
  holdsAadhaarCarrierValue,
  holdsAadhaarLike,
  holdsAadhaarFieldValue,
  isAadhaarCarrierName,
  isAadhaarFieldName,
  isAadhaarLastFourName,
  type AadhaarLabelledFind,
  type AadhaarLikeFind,
  type AadhaarLikeKind,
  type AadhaarLookAlike,
  type AadhaarNamedFieldFind,
  type FindAadhaarOptions,
} from "./aadhaar.js";
