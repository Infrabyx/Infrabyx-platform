---
"@infrabyx/config": minor
---

Registers the FILE_TRANSFER `sftp` adapter's settings (Udofin PR-UDF-071; R1-D-254, ADR-0014): `int.file_transfer.sftp.enabled` (bool, default false, PLATFORM, `PLT_SUPER_ADMIN`, R4) and `int.file_transfer.sftp.allow_hosts` (json, default `[]`, PLATFORM, `PLT_SUPER_ADMIN`, R4: the India-hosted allow-list `[{ host, residency: "IN", attestation? }]`, exact host names or IP literals; empty refuses every connection). Nothing existing changes.
