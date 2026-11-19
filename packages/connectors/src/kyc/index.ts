// KYC adapters (owner answers #87 and #91, R1-D-22, R1-D-33): `digio-kyc`, the reference for
// DigiLocker and Aadhaar offline, and `idfy-kyc`, the alternative for PAN, face match and
// liveness. Both are off behind `int.kyc.<vendor>.enabled` and `unproven` until the owner's
// accounts exist. `kycMethodRouter` routes each method to the first adapter that provides it
// (Digio first, IDfy second; Finbyx PR-FBX-24). Keyed DigiLocker pulls are kept in a
// `DigilockerPullStore` (`PgDigilockerPullStore` on `connectors.kyc_digilocker_pull`; PR-UDF-040).
// Aadhaar OTP e-KYC is off unless an adapter is built with `notifiedEntity: true`; keyed verifies
// are kept in an `AadhaarOtpVerifyStore` (`PgAadhaarOtpVerifyStore`, `connectors.kyc_aadhaar_otp_verify`;
// PR-UDF-041). Bank account checks are pennyless only, by mode, and keyed checks are kept in a
// `BankAccountVerifyStore` (`PgBankAccountVerifyStore`, `connectors.kyc_bank_account_verify`;
// PR-UDF-043). Liveness checks are by mode (IDfy: passive), every score carries the threshold
// applied, and keyed liveness and face-match checks are kept in a `KycScoreCheckStore`
// (`PgKycScoreCheckStore`, `connectors.kyc_score_check`; PR-UDF-044).
export * from "./aadhaar-otp.js";
export * from "./bank-account.js";
export * from "./digio.js";
export * from "./digilocker-pulls.js";
export * from "./idfy.js";
export * from "./routing.js";
export * from "./score-checks.js";
export * from "./vcip.js";
