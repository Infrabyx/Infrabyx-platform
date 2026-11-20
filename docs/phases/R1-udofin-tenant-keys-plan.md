# R1 plan: STORAGE puts under a named tenant key (PR-UDF-058)

Owner's addendum, 20 Nov 2026 (accepted, ranked right after E3; needed before Udofin's first real lender). Decision R1-D-227. Spec of record: IPB-01 §01.4.4.2 and IPB-01-27..30 (STORAGE), IPB-02-15 (presigned URLs), IPB-02-19 and C-15, C-17 (tenant CMKs and per-object SSE-KMS keys, approved). Builds on PR-LDC-60 (R1-D-158, separately keyed compartments). Nothing under `docs/ipb/` or `docs/ecosystem/` is edited.

## A. What Udofin asked for

"Let STORAGE put (and presign for get) encrypt an object under a named tenant key (an SSE-KMS key id per object, or a key per tenant prefix), so a product's vault keeps each lender's files under that lender's own KMS key, including a lender-controlled key (UDF-B06). Today `S3StorageOptions.kmsKeyIds` is per bucket class only."

Today an object is encrypted under the class key, the compartment key (PR-LDC-60) or the tenant's own CMK (C-15, C-17). Nothing lets one tenant keep different objects under different keys of its own choosing.

## B. Design (smallest faithful version)

1. **Request side: a key reference, never a key id.** `ObjectMeta.keyRef` (on `put` and `putWithRetention`) and `PresignOptions.keyRef` (on `presign(…, "put", …)`) name the key, for example `lender:lnd_01…`. The form is `[a-z0-9][a-z0-9_.:-]{2,63}`, and a reference shaped like a key id (an `arn:` string, an `mrk-` multi-Region key id or a UUID) is refused, so a caller can never pick a raw KMS key. `isValidStorageKeyRef` and the fixed refusal labels live in `@infrabyx/contracts/ports`.
2. **Resolution (adapter configuration, not caller input).** New `S3StorageOptions`:
   - `tenantNamedKmsKeyIds(tenantId, { bucketClass, compartment? })` returns the tenant's named keys for that location as `{ [keyRef]: keyId }`. A map (not a single lookup) so the adapter can check separation.
   - `tenantKeyRefPrefixes(tenantId)` (optional) returns `{ [prefix]: keyRef }`; when a put names no `keyRef`, the longest prefix of the object key (each under `tenant/<tenantId>/`) supplies one. A put whose `keyRef` differs from its prefix's is refused, so a lender's vault prefix never holds another lender's files.
   - The tenant is always the one in the object key (which `checkKey` already ties to the caller's tenant), so a reference resolves only within its own tenant.
3. **Refusals (fail closed, never a fallback to the class key).**
   - Malformed reference: `IPB-PORT-003` `key_ref_invalid`.
   - Class other than `CONFIDENTIAL` or `REGULATED`: `IPB-PORT-003` `key_ref_class` `[ASSUMED – owner review]`. `AUDIT` anchors must stay readable by the platform, `QUARANTINE` is read by the scanner, `PUBLIC_ASSETS` is public, and `GENERAL` is not where a lender's files belong.
   - Unknown reference (no named key for it at that location): `IPB-PORT-001` `key_ref_unknown`.
   - A prefix entry outside `tenant/<tenantId>/`: `IPB-PORT-001` `key_ref_prefix_invalid`. A `keyRef` that conflicts with its prefix's: `IPB-PORT-003` `key_ref_prefix_conflict`.
   - Separation (as PR-LDC-60): a named key equal to any class key or compartment key, to another reference's key of the same tenant, or to the same reference's key in a different location when either location is a compartment: `IPB-PORT-001` `key_ref_shared`. One reference may use one key across `CONFIDENTIAL` and `REGULATED`, the way a tenant CMK spans classes.
   - Tenant with its own CMK (C-15): `IPB-PORT-003` `key_ref_tenant_cmk` `[ASSUMED – owner review]`. C-17 says such a tenant's objects use its CMK so that a tenant purge covers documents; a named key would take objects out of that purge.
   - Overwrite under another reference (or from none to one, or back): `IPB-PORT-003` `key_ref_changed`. The reference is part of the object's identity, like its compartment.
   - `minio` (no per-object SSE-KMS key; the bucket's SSE-S3): `IPB-PORT-001` `unsupported`, declared as capability `put.keyRef: "unsupported"`.
4. **Recording.** The reference (never the key id) is stored as object metadata `ipb-key-ref`; `get` returns it as `meta.keyRef`, so audit and export can show which key protected an object, and `replicateTo` carries it (the replica must have the same named key, or the copy is refused). A caller's tag with that name is dropped, so it cannot be spoofed.
5. **Reads unchanged.** `get` and `presign(…, "get", …)` work as before: S3 decrypts SSE-KMS given `kms:Decrypt`. A key that is disabled, deleted or whose grant was revoked surfaces as `IPB-KMS-001` ("Key unavailable; decrypt refused", 503) with `reason: "storage_key_unavailable"` (the reference in `meta`), on an object under a named key, from a KMS key-state error (`KMS.DisabledException`, `KMS.KMSInvalidStateException`, `KMS.NotFoundException`, `KMS.AccessDeniedException`, `KMS.InvalidGrantTokenException`) or `AccessDenied` (the HEAD succeeded, so the decrypt was refused), on reads and writes alike. Transient KMS errors stay `IPB-PORT-002`, and objects under platform keys keep their failures, so the router's read failover to the DR copy is unchanged for them. The existing catalogue code; no new code.
6. **Presigned upload.** The URL carries the named key as the signed `x-amz-server-side-encryption-aws-kms-key-id` header (exactly as for a compartment) and the reference as signed metadata, so an upload under another key or without the reference fails the signature.
7. **No settings, no migration.** The resolvers are code configuration like `tenantKmsKeyId`; nothing is read before registration. Default behaviour without a `keyRef` or a prefix map is unchanged.
8. **No new cryptography.** SSE-KMS with an AWS KMS key per object is C-17 as approved; the lender-controlled key is a key in the lender's account whose policy grants the platform's role `kms:GenerateDataKey` and `kms:Decrypt`. S3 Bucket Keys stay on, as for every other key (revocation then takes effect when S3's bucket-level data key expires, at most a short period; owner question).

## C. Contracts (`@infrabyx/contracts/ports`, minor)

`ObjectMeta.keyRef?`, `PresignOptions.keyRef?`, `STORAGE_KEY_REF_PATTERN`, `isValidStorageKeyRef`, `NAMED_KEY_CLASSES`, `STORAGE_KEY_REF_META` (`ipb-key-ref`), `STORAGE_KEY_REF_REFUSALS`, and `resolveStorageKeyRef(key, { bucketClass, keyRef? }, prefixes?)` returning `{ keyRef? }` or `{ refusal }` (the shared rule for the format, the class, the prefix and the conflict). Additive and optional: no adapter outside the platform breaks.

## D. Adapters

- `connectors` `S3Storage` (`s3`): the options of §B.2, the refusals of §B.3, the metadata of §B.4, the error mapping of §B.5, the presign of §B.6. `MinioStorage`: refuses with `unsupported`.
- `fakes` `MemoryStorage` (and `DirStorage`, which extends it): second constructor argument `{ keyRefs?(tenantId), keyRefPrefixes?(tenantId) }`; applies `resolveStorageKeyRef`, refuses an unknown reference (`key_ref_unknown`; none are known by default) and a changed one, records the reference on the object, and puts it in a presigned upload URL.

## E. Tests (by IPB ID)

- `contracts` `storage-key-ref.test.ts`: the format, the key-id shapes refused, the classes, the longest prefix, a prefix conflict, a prefix outside the tenant.
- `testing` built-in STORAGE contract case (every leg; `@IPB-01-15`, `@IPB-01-AT-10` parity): a put under `lender:contract` in `REGULATED` reads back with `meta.keyRef` and the body; an overwrite under another or no reference is refused `IPB-PORT-003`; a malformed or key-id-shaped reference `IPB-PORT-003`; an unknown one `IPB-PORT-001`; a `GENERAL` put with a reference `IPB-PORT-003`; a presigned upload with the reference and a presigned get both sign. `minio` legs assert the `unsupported` refusal. `MemoryStorage` runs it in `testing`'s contract test; `s3` on moto with two moto KMS keys.
- `connectors` `named-keys.test.ts` (unit, in-memory client): the key chosen per reference, with the prefix map, in a compartment; every separation refusal; the tenant-CMK refusal; `KMS.DisabledException` and `AccessDenied` on GET mapped to `IPB-KMS-001` `storage_key_unavailable`, on a write too; a throttled KMS call, and an `AccessDenied` or key-state error on a platform-key object, staying `IPB-PORT-002`; the metadata tag cannot be spoofed; `minio` refuses.
- `connectors` moto leg: objects under two lenders' keys carry each key (`HEAD` `SSEKMSKeyId`), and the class key elsewhere; a presigned upload URL signs the KMS key header and, sent with it, stores the object under the named key with its reference; a presigned get then returns the body.
- `fakes`/`testing` unit: the fake records the reference, refuses unknown and changed ones, honours the prefix map.

## F. Stubs and exit checklist

No vendor, no network beyond the hermetic legs, no migration, no setting. Exit: build, lint, typecheck, test for `contracts`, `connectors`, `fakes`, `testing`; STORAGE contract leg; `pnpm test:policy`; `node scripts/ipb-check.mjs`; prettier; `pnpm check:full`. One changeset (`contracts`, `connectors`, `fakes`, `testing` minors); guide §7dl; threat model §3.156; DECISIONS R1-D-227; owner question #165.

## G. Owner decisions needed

#165 (defaults taken, nothing blocks): (1) named keys only in `CONFIDENTIAL` and `REGULATED`; (2) refused for a tenant with its own CMK (C-17's purge rule); (3) S3 Bucket Keys stay on for named keys (fewer KMS calls and the same cost profile, but a revocation takes effect only when S3's bucket-level data key expires, and the lender's CloudTrail sees the bucket, not each object). Creating any lender's key, or granting the platform role on it, is production configuration and stays the owner's.
