---
"@infrabyx/connectors": minor
---

`PdfTextExtractor.extractText` passes a disabled or revoked named tenant key through as its own refusal (Udofin PR-UDF-067; R1-D-241). When the STORAGE read fails with `IPB-KMS-001` `storage_key_unavailable` (PR-UDF-058: the object's named key is disabled, deleted or no longer granted), the extractor now throws `IPB-KMS-001` (port `PDF`, adapter `pdf-text`) with `meta: { reason: "storage_key_unavailable" }` and nothing else (no key reference, vendor error name or cause), instead of `IPB-PORT-002` `unavailable`. Every other read failure, including an `IPB-KMS-001` with another reason, stays `IPB-PORT-002` `unavailable`; the parse refusals (`IPB-SEC-010`, `-013`, `-015`, `-011`) are unchanged. Minor, not patch: callers see a new code for this case, so one that treated every `IPB-PORT-002` as a retryable outage should handle `IPB-KMS-001` as "the key owner must restore the grant" instead.
