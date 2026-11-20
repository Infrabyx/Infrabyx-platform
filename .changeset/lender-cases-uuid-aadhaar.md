---
"@infrabyx/testing": patch
---

`lenderContractCases` reads each message for Aadhaar-like numbers the way the repository sweep does (`scanTextForAadhaar`): UUIDs, such as the envelope `id`, are blanked first (R1-D-247). Before, a random UUID whose middle groups were all digits could read as a grouped twelve-digit number with a valid check digit, so the case failed at random, about once in a few runs of the full journey. Nothing else in the cases changes.
