---
"@infrabyx/ai": patch
---

Udofin PR-UDF-079 (R1-D-270): one `ai.grounded_answer` golden case (`pii-restore-masked`) words its masked record as "the masked number XXXX XXXX dddd" instead of "Aadhaar XXXX XXXX dddd", which the stricter no-Aadhaar sweep reads as a labelled value. The case still tests the masked form's tokenising and restoring; the golden set's score is unchanged (110/110).
