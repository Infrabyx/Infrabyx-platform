---
"@infrabyx/connectors": minor
---

R1-D-276. `s3`/`minio` STORAGE: `IPB-KMS-001` (`storage_key_unavailable`) and the read/write outage errors (`IPB-PORT-002`, `IPB-STOR-002`) no longer carry the SDK error as `cause`, whose message can quote a KMS key ARN, a bucket or an object key; `meta.name` and `meta.status` stay. `clamav`: a file whose named key the scanner may not use is now `ERROR` with reason `storage_key_unavailable` (was `unavailable`); still quarantined. Behaviour visible: a product matching that reason should accept the new label.
