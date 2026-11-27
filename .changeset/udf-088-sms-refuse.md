---
"@infrabyx/contracts": minor
"@infrabyx/notify": minor
---

PR-UDF-088 (R1-D-296; guide §7fc). **Behaviour change, fixing a defect:** NOTIFY no longer cuts an SMS variable to 30 characters or the list to 10 variables. It refuses with the new `IPB-NTF-008` (422; `meta.reason` `sms_var_too_long` or `sms_too_many_vars`, naming the variable and its length, never the value) at `send`, `enqueue` and `notifyStaff` when an SMS delivery is planned, in `previewTemplate`, and at delivery. `contracts` exports the limits `SMS_VAR_MAX_LENGTH` (30) and `SMS_MAX_VARS` (10), which the `SmsMessage` schema uses; `notify` re-exports them with `smsVars`. A product whose SMS values can pass 30 characters must split them across DLT variables or use another channel.
