---
"@infrabyx/contracts": minor
---

BUREAU: `Tradeline.emiPaise` (the reported instalment in integer paise, `null` when the CIC reports none). ESTAMP DDE: `DdeRecord.signers` (`DdeSignerEvidence`: signer reference, signed at, signing method, ESP transaction id or signer IP, the shape of ESIGN's signer trail) and `DdeRecord.notStampableReason`; `DdeRegistration.notStampable` with the `DDE_NOT_STAMPABLE_REASONS` code table (`NOT_AN_INSTRUMENT`, `ACKNOWLEDGEMENT`, `OTHER` with a note), refused with a certificate or a duty; `certificateId` is now required only on the stamped path (PR-FBX-35; R1-D-84).
