# Demo Co - REF Archive - Full Tenant - as of 2000-01-01

## Purpose and scope

- This archive holds the Full Tenant export of tenant tnt_demo from REF, release normalised, under export map REF-EXPORT-1.1 and archive standard 1.0 (folder profile platform_reference_v1).
- Archive id: arc_00000000000000000000000000. Predecessor: none.

## As of

- This archive was exported at 2000-01-01T00:00:00.000Z (UTC), which is 2000-01-01T05:30:00.000+05:30 in India Standard Time (IST, UTC+05:30). Every dataset shows the records as they were at that moment.
- Every time inside the data files, manifests and audit trail is in UTC, written in ISO 8601 with its offset (`Z` means UTC). To read a time in IST, add 5 hours 30 minutes.

## Requester and approvers

- Requester: normalised. Approvers: none (the tenant owner's own export needs no approval). Ids only; no names.

## Folder guide

- 00 Start Here: this README, the manifests and signature, the data dictionary, relationships, code tables, JSON Schemas and the offline verifier.
- 01 Data: one CSV (and one JSONL) per dataset: approval_decision, approval_request, inbox_item, legal_entity, membership, notification, setting, tenant.
- 02 Audit Trail: the audit trail, one JSONL file per month, hash-chained.

## Opening CSV files

- The CSV files are UTF-8 with a byte-order mark, comma-separated (RFC 4180), with a header row. To keep leading zeros and long numbers, import them as text: in Excel use Data > From Text/CSV and set the columns to Text; in LibreOffice Calc choose the Text column type in the import dialog.
- Code columns have a `_label` column beside them; the full code lists are in `00 Start Here/code-tables/`.

## Verifying checksums and the signature

- Every file's SHA-256 and size are listed in `00 Start Here/export-manifest.csv` and `manifest.json`. Check one file with `sha256sum <file>` (Linux), `shasum -a 256 <file>` (macOS), `Get-FileHash -Algorithm SHA256 <file>` (PowerShell) or `CertUtil -hashfile <file> SHA256` (Windows).
- `manifest.json.jws` is a detached JWS (RFC 7515 Appendix F, ES256) over `manifest.json`, made with the Infrabyx platform export-signing key.
- Signing key id: local:sign:export. Public key (JWK) in `00 Start Here/verify/export-signing-key.jwk.json`; its SHA-256 fingerprint is 15d7106acc1ed02445f1b2867cc209134a841c62152228da26522c464d620c75.
- To check everything at once (hashes, signature, control totals, CSV headers and the audit chain) run `node "00 Start Here/verify/verify.mjs"` from the archive folder with Node.js 20 or later. It needs no network.

## Joining tables

- `00 Start Here/relationships.csv` lists which column of one dataset refers to which column of another; `data-dictionary.csv` describes every column with its type and data class.

## Glossary

- Tenant: the organisation that owns this data. Ledger: the append-only, hash-chained audit trail. Data class: PUBLIC, INTERNAL, CONFIDENTIAL, REGULATED or SECRET (IPB-02).

## Restricted folders

- This archive contains no restricted folder. HR, privileged legal and collections material is exported separately, encrypted, only with a second approver.

## Retention and legal hold

- No record in this archive is under legal hold. Keep the archive as your own retention policy requires; the producing system keeps its own copies under its retention schedule.

## Contacts

- Ask your organisation's administrator, or raise a support request in the product.
