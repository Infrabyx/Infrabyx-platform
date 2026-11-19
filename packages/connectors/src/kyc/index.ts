// KYC adapters (owner answers #87 and #91, R1-D-22, R1-D-33): `digio-kyc`, the reference for
// DigiLocker and Aadhaar offline, and `idfy-kyc`, the alternative for PAN, face match and
// liveness. Both are off behind `int.kyc.<vendor>.enabled` and `unproven` until the owner's
// accounts exist. `kycMethodRouter` routes each method to the first adapter that provides it
// (Digio first, IDfy second; Finbyx PR-FBX-24). Keyed DigiLocker pulls are kept in a
// `DigilockerPullStore` (`PgDigilockerPullStore` on `connectors.kyc_digilocker_pull`; PR-UDF-040).
// Aadhaar OTP e-KYC is off unless an adapter is built with `notifiedEntity: true`; keyed verifies
// are kept in an `AadhaarOtpVerifyStore` (`PgAadhaarOtpVerifyStore`, `connectors.kyc_aadhaar_otp_verify`;
// PR-UDF-041).
export * from "./aadhaar-otp.js";
export * from "./digio.js";
export * from "./digilocker-pulls.js";
export * from "./idfy.js";
export * from "./routing.js";
export * from "./vcip.js";
