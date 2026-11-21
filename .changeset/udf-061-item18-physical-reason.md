---
"@infrabyx/contracts": minor
---

Optional per-document `physical_reason` and `re_instructions` on the execution pack (Udofin PR-UDF-061 item 18; R1-D-252), on both `ExecutionPackManifest.documents[]` and `ExecutionPackIssuedData.documents[]` (`PackDocument`). New `PACK_PHYSICAL_REASONS` (`REGISTRATION_REQUIRED`, `NOTARISATION_REQUIRED`) and `PACK_RE_INSTRUCTIONS_MAX` (1000). `re_instructions` is the lender's plain text, 1 to 1,000 characters, with no control character and no link (the rule of `CoolingOffExitAnswered.payment_instruction`, R1-D-232, now shared). A document with a `physical_reason` must be `execution_mode: WET_INK`. Both fields are optional, so every pack valid before still parses.
