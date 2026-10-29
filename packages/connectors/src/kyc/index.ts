// KYC adapters (owner answer #87, R1-D-22): `digio-kyc` (reference for DigiLocker and Aadhaar
// offline), off behind `int.kyc.digio.enabled` and `unproven` until the owner's Digio account
// exists. IDfy or HyperVerge is the alternative, built when the owner chooses one.
export * from "./digio.js";
