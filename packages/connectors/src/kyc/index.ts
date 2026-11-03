// KYC adapters (owner answers #87 and #91, R1-D-22, R1-D-33): `digio-kyc`, the reference for
// DigiLocker and Aadhaar offline, and `idfy-kyc`, the alternative for PAN, face match and
// liveness. Both are off behind `int.kyc.<vendor>.enabled` and `unproven` until the owner's
// accounts exist. `kycMethodRouter` routes each method to the first adapter that provides it
// (Digio first, IDfy second; Finbyx PR-FBX-24).
export * from "./digio.js";
export * from "./idfy.js";
export * from "./routing.js";
export * from "./vcip.js";
