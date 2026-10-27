# @infrabyx/export

Tenant exports to the Ecosystem §12.1 archive standard (`archive_standard_version` 1.0), export maps, and the `export-map-gate` and `golden-archive-diff` checks (IPB-09-34 to 09-37; PL3 plan §7; PL3-D-22).

**Specified by:** IPB-09 §09.4.7, rows 09-34 to 09-38, `@IPB-09-AT-14` and `@IPB-09-AT-15`; Ecosystem spec §12.1. Migrations `export/0001_init.sql` and `0002_owner_answers.sql` are applied by `infrabyx-migrate` when the package is installed.

## What it does

- **Export maps** (`maps/REF-EXPORT-1.1.json`, with 1.0 kept for the dual run; `ExportMapRegistry`). Each product ships its own `<PRODUCT>-EXPORT-x.y` map and registers it. Changing `files` or `fields` bumps the map version: minor for an addition, major for a removal or rename. Changing `views` never does. The previous map is emitted for the 90-day dual run.
- **Archive writer** (`buildArchive`). It is deterministic, so the same rows always give the same bytes:
  - `00 Start Here/` holds the README (TXT and Markdown), `export-manifest.csv`, `manifest.json`, `manifest.json.jws`, the data dictionary, relationships, code tables, JSON Schema 2020-12 per dataset, and `verify/` (an Apache-2.0 offline verifier with the public key);
  - `01 Data/` holds one CSV (RFC 4180, UTF-8 with BOM) and one JSONL per dataset;
  - `02 Audit Trail/` holds `audit-events-YYYY-MM.jsonl`, with the hash chain the verifier recomputes.
- **Signing (C-22).** The manifest is signed with a detached JWS (RFC 7515 Appendix F, ES256), made by KMS `sign` with the platform export-signing key (`kmsArchiveSigner`). The signed `ExportCompleted` is a detached JWS over the JCS form of the event.
- **Jobs** (`ExportService`):
  - `request` is R0 for `ORG_OWNER` and limited to 5 concurrent and 20 a day per principal (`IPB-SEC-019`);
  - `submit` is for `ORG_ADMIN`: an R2 approval (`export.job.request`) that only an `ORG_OWNER` may check; the job is recorded when it is approved. No other role exports (PL3-D-25);
  - `run` takes one REPEATABLE READ snapshot and reconciles the control totals against it (`IPB-EXP-003`), then writes the ZIP to STORAGE (`CONFIDENTIAL`) and records `export.archive`;
  - `download` returns a presigned URL and ledgers `<archive id>:<sha256>`; an ORG_ADMIN downloads only the archive of their own approved job;
  - `sweep` enqueues approved jobs not yet started and deletes archives 30 days after they were made, ledgering each deletion (`export.archive.delete`); after that a download is refused (`IPB-EXP-006`).
- **Times.** Every time in the data is UTC in ISO 8601 with its offset; the README also gives the export time in IST.
- **Refused for now:**
  - restricted folders (`IPB-EXP-001`);
  - destinations other than download (`IPB-EXP-002`);
  - secret, sealed, Aadhaar and card fields (`IPB-EXP-004`).

## For products

1. Ship `maps/<PRODUCT>-EXPORT-1.0.json` and build `ExportService` with that map, STORAGE, the KMS export-signing key, the pseudonym key, your `ecosystemEvent` builder (D-13) and the workflow `approvals` engine (for ORG_ADMIN requests).
2. Enqueue `{ tenantId, jobId }` on QUEUE (`enqueue`), call `run` from a worker, and call `sweep()` from one worker every few minutes.
3. In CI:
   - run `infrabyx-export map-gate --base origin/<base> --maps maps --export-dir <dir>` (add `--unchanged-label` when the PR carries `export:unchanged`);
   - keep a golden archive of your demo tenant (`goldenArchive`) and diff each PR against it with `infrabyx-export diff <archive> --golden <folder>`.
4. `infrabyx-export verify <archive.zip>` runs an archive's own verifier.
