# R1 plan: borrower email with byte-identical attachments, a delivery receipt and the verified email (PR-UDF-055)

Owner's order, 19 Nov 2026 night (item E6 of E1 to E8, each planned and built as its own PR). Decision R1-D-224. Spec of record: IPB-01 §01.4.4.2 EMAIL (interface `send(message{…, attachments, …})`; "CONFIDENTIAL content goes as a secure link, never inline, so EMAIL adapters may be `GLOBAL` with `maxDataClass: INTERNAL`"), STORAGE (keys, bucket classes), IPB-01 UDF notes (every Udofin adapter `IN`); IPB-02-01, IPB-02-02 and §02.4.6.2 `auth.otp` (one-time codes, rate limits, back-off and lockout), IPB-02-23 (codes never stored in clear or logged), IPB-02-44 (type sniffing); IPB-07-25 (NOTIFY design: digest-first, deep links). Existing decisions: PL2-D-64 (attachments: at most 10 files and 10 MiB, INTERNAL storage classes only), PL2-D-65 (resend classes), R1-D-19 and owner answer #84 (b) (customer sign-in, codes through NOTIFY), R1-D-87 (sandbox tenants), PR-UDF-034 (login change: platform-made codes kept as salted hashes). Nothing under `docs/ipb/` or `docs/ecosystem/` is edited.

## A. What Udofin asked for

1. **Borrower transactional email with attachments that are byte-identical** to the stored documents (a KFS, a sanction letter, a receipt), so the borrower's copy can be checked against the document's SHA-256.
2. **A delivery receipt**: what was sent, when, by which adapter, with the vendor's message id and the hashes of the attached bytes.
3. **A verified-email capture in customer identity**: the borrower (who signs in by mobile number) enters an email address, receives a one-time code there through NOTIFY, confirms it, and the address is recorded on the customer account with the time it was verified.

## B. What the rules already say, and the line this plan keeps

- The EMAIL port already takes `attachments` as STORAGE keys and the two adapters (`ses`, `brevo`) load them, but only from the `GENERAL` and `PUBLIC_ASSETS` bucket classes, at most 10 files and 10 MiB (PL2-D-64). A `CONFIDENTIAL` object is refused (`IPB-PORT-003`) and goes as a secure link. NOTIFY has never offered attachments to products: `NotificationRequest` has none, and its `vars` are INTERNAL with content above INTERNAL fetched in-app by deep link (IPB-07-25).
- A loan document (KFS, sanction letter) is normally `CONFIDENTIAL`. IPB-01's EMAIL rule forbids it inline; this plan does **not** relax that. It builds the attachment path for INTERNAL and PUBLIC objects now, and puts the CONFIDENTIAL path behind a platform setting `ntf.email.attachments.confidential` (default **off**) that, even when on, only lets NOTIFY hand a CONFIDENTIAL attachment to an EMAIL adapter whose descriptor says residency `IN` and `maxDataClass` CONFIDENTIAL or higher. No adapter says so today (SES `ap-south-1` declares INTERNAL), so nothing CONFIDENTIAL can leave by email until the owner decides and, if the answer is yes, IPB-01 is amended through `docs/platform-requests.md`. Owner question #161. `REGULATED`, `AUDIT` and `QUARANTINE` objects and compartment objects are never attached.
- The address of the borrower stays with the product's `ContactResolver` for NOTIFY, as today (addresses are never stored by NOTIFY).

## C. Design

### C1. Attachments on the NOTIFY product door (`NotifyService.send` and `enqueue`)

- `NotificationRequest.attachments?: NotificationAttachment[]` (at most 10): `{ storageKey, sha256, filename, mediaType }`. `storageKey` is an IPB-01-27 key inside the caller's tenant (`tenant/<tenantId>/…`), `sha256` lower-case hex of the stored bytes, `filename` a plain name (letters, digits, space, `._()-`, at most 100 characters, no path) whose extension fits `mediaType`, `mediaType` one of `application/pdf`, `image/png`, `image/jpeg` (`EMAIL_ATTACHMENT_MEDIA_TYPES`).
- Admission (in `plan`, before anything is written): the tenant's `ntf.email.attachments.enabled` must be on (default **off**; `IPB-PORT-001` `attachments_off` otherwise); NOTIFY must have been given a STORAGE port (`attachments.storage`); the class must be `urgent`, not marketing, and have an email template (attachments go with the immediate email, never a digest); every key must be in the caller's tenant. The references are written on the notification (`notify.notification.attachments`, new column).
- Delivery (email channel only; in-app, SMS, WhatsApp and push carry the deep link as before): before any vendor call NOTIFY checks the adapter declares `attachments: "native"` (otherwise `IPB-PORT-001` `unsupported`, the delivery fails and nothing is sent); then for each reference it reads the object from STORAGE and refuses (`IPB-PORT-003` with `meta.reason`) a class that is not allowed (`class`), a compartment (`class`), a declared type that differs from the stored `contentType` or from the bytes' magic number (`type`), bytes whose SHA-256 differs from the reference (`sha256`), and more than 10 MiB together (`size`). The bytes are then passed **unchanged** to the adapter in the new `EmailMessage.files` (`{ filename, contentType, sha256, body }`); the call carries `dataClass: "CONFIDENTIAL"` only when a CONFIDENTIAL object is attached (setting on), so the adapter's own class check refuses it too.
- Retries: a `safe` class's resend after an unknown outcome reads and checks the bytes again; a `hold` class is held as today. A sandbox tenant records `sandboxed` and reads nothing (R1-D-87).
- **Receipt:** when the adapter accepts the message, the delivery row records the attached bytes' hashes and sizes (`notify.delivery.attachments`, new column) with the vendor message id (`vendor_ref`, as today). `deliveryStatus` returns them: `DeliveryRecord.vendorRef` and `DeliveryRecord.attachments: [{ sha256, bytes }]` (both optional, added). Delivery reports (`sent`, `delivered`, bounces) update the same record as today.

### C2. The EMAIL port and adapters

- `contracts` `EmailMessage.files?: EmailAttachment[]` (at most 10): bytes the caller fetched and verified, sent as given. A new field rather than a widened `attachments`, so an implementer outside the platform does not break in a minor (owner answer #153's rule). An adapter takes it only if it declares the capability `attachments: "native"`; NOTIFY never hands `files` to one that does not, so attachments are never silently dropped. `EMAIL_ATTACHMENT_LIMITS` (10 files, 10 MiB), `EMAIL_ATTACHMENT_MEDIA_TYPES`, `emailAttachmentTypeOf(bytes)` (magic numbers of PDF, PNG, JPEG).
- `connectors` `ses` and `brevo`: declare `attachments: "native"`; `loadAttachments` counts keys and files together against the same limits and checks each file's SHA-256 once more over the exact bytes handed to the vendor SDK or body (`IPB-PORT-003` `sha256`, before any request). The bytes are not decoded, re-encoded or re-rendered: SES gets them as `RawContent`, Brevo as base64 of the same bytes.
- `testing` stubs: the SES v2 and Brevo stubs record each attachment's SHA-256 over the decoded bytes they received, so a test proves the wire carried the stored bytes.

### C3. The verified email (customer identity)

On `CustomerIdentityPort`, optional (as the PR-UDF-034 methods are), implemented once in `CustomerIdentityBase` for Keycloak and Zitadel:

- `startEmailVerification({ tenantId, userId, email, dpopProof, locale? }) → CustomerChallenge`: the signed-in customer's product API calls it with the customer's device proof (the sign-in proof target), which must be by the key of an active (signed-in) device of that account (`IPB-IDN-001` `device` otherwise). The setting `int.identity.customer.email_capture.enabled` (default **off**; `IPB-PORT-001` `disabled`) must be on. The address is normalised (`CustomerEmail`, lower case). The account's guard admits the send (the same `auth.otp` send limits, resend interval and lockout as sign-in codes). The platform makes a six-digit code (CSPRNG) and keeps only its salted SHA-256 and a hash of the address on the challenge (`purpose: "email_verify"`), bound to the device key; the code goes through the existing `CustomerOtpSender` (NOTIFY `sendOneTimeCode`, the product's email security class) to the address being proven, and is never stored or logged.
- `confirmEmailVerification({ tenantId, userId, challengeId, email, code, dpopProof }) → { email, verifiedAt }`: the same device key; the attempt counts against the code's tries and the account's back-off and lockout (`int.identity.customer.otp.attempts_per_code`, `backoff_*`, `lockout_*`, all registered settings); a wrong code, another address or another account is refused (`IPB-IDN-001` `code` or `challenge`), a locked account `IPB-SEC-019`. On success the address is recorded on the account with `verified_at`, replacing an earlier one, ledgered as `identity.customer.email.verify` with no address in the entry.
- `verifiedEmail(tenantId, userId) → { email, verifiedAt } | null`: what the product's `ContactResolver` reads to address the borrower's email (so NOTIFY sends only to a verified address).
- A sign-in (`verifyChallenge`) refuses an email-verification challenge, as it refuses a login-change one.
- Store: `CustomerAuthStore.saveVerifiedEmail?` and `verifiedEmail?` (optional, so an external store does not break); `MemoryCustomerAuthStore` and `PgCustomerAuthStore` implement them.

## D. Data model and migrations (expand-only)

- `notify/0008_email_attachments.sql`: `notify.notification.attachments jsonb` (nullable; array of references; `dataclass:CONFIDENTIAL`, since a filename may name a person) and `notify.delivery.attachments jsonb` (nullable; array of `{ sha256, bytes }`; `dataclass:INTERNAL`), each with a check that it is a JSON array of at most 10. No new grant: `app_rw` already inserts notifications and updates deliveries; the dispatcher's column grants are unchanged (it never reads either column).
- `connectors/0015_customer_verified_email.sql`: `connectors.customer_verified_email` (`tenant_id`, `user_id`, `email`, `verified_at`, `updated_at`; primary key (`tenant_id`, `user_id`)); `user_id` and `email` `dataclass:CONFIDENTIAL`, the rest INTERNAL; forced RLS by tenant; `select, insert, update` to `app_rw`, `select` to `app_ro`; **no delete grant** (removing rows is a retention decision; owner question #161 (3)).
- Checksums regenerated; `migration-lint`, `rls-lint` pass.

## E. Settings (registered in `packages/config/settings-tree.yaml`, registry regenerated)

| Key                                           | Tier     | Type | Default | Who changes            | Why                                                                     |
| --------------------------------------------- | -------- | ---- | ------- | ---------------------- | ----------------------------------------------------------------------- |
| `ntf.email.attachments.enabled`               | TENANT   | bool | `false` | `ORG_ADMIN`            | a product turns attachments on for its tenants                          |
| `ntf.email.attachments.confidential`          | PLATFORM | bool | `false` | `PLT_SECURITY_OFFICER` | CONFIDENTIAL objects to an `IN` CONFIDENTIAL-grade EMAIL adapter (#161) |
| `int.identity.customer.email_capture.enabled` | PLATFORM | bool | `false` | `PLT_SECURITY_OFFICER` | the verified-email capture                                              |

Attempts, back-off and lockout reuse the registered `int.identity.customer.otp.*` keys.

## F. Tests (by IPB ID)

- `contracts`: the request and message schemas (keys, hashes, filenames, media types, the limit of 10); `emailAttachmentTypeOf` on PDF, PNG, JPEG and others.
- `connectors` EMAIL contract (`@IPB-01-15`, both hermetic legs): a file sent as bytes reaches the vendor stub byte-identical (the stub's SHA-256 of what it received equals the stored object's); a file whose bytes do not match its SHA-256, or keys and files over 10 or 10 MiB together, are refused before any request; the descriptor declares `attachments: "native"`.
- `notify` integration (PostgreSQL, every migration; `@IPB-07-25`, `@IPB-01-15`, `@IPB-02-44`): through `NotifyService.send` to the real `SesEmail` on the SES stub, the stub's SHA-256 equals the stored object's and the receipt (`deliveryStatus`) carries the hash, the size and the vendor message id; off by default; a digest class, another tenant's key, a CONFIDENTIAL or REGULATED object (setting off), a changed object (hash), a declared type that is not the bytes' are refused with nothing sent; an adapter without the capability fails `unsupported` with nothing sent; with the CONFIDENTIAL setting on, the INTERNAL-grade adapter still refuses; the ledger holds no filename.
- `connectors` customer identity on the fake IdP (`@IPB-02-01`, `auth.otp`): off by default; the code reaches the address through the sender, is never in the challenge or the result; the wrong code, another address, another device key or another account are refused; tries per code and the lockout apply; a sign-in refuses the challenge; the verified address and time are recorded and read back. `customer-store.int.test.ts` (PostgreSQL): the store writes, replaces and reads the record under RLS and ledgers it without the address; another tenant cannot read it.

## G. Stubs, exit checklist

No vendor, account or cost. Exit: `pnpm check:full` green; the EMAIL contract leg; the `notify` and `connectors` int tests; `ipb-check`, migration-lint, rls-lint, registry check; one changeset (`contracts`, `connectors`, `notify`, `config`, `testing` minors); guide §7di; threat model §3.153; STATUS; DECISIONS R1-D-224; owner question #161.

## H. Owner decisions needed (#161; nothing blocks)

1. CONFIDENTIAL loan documents by email: default **no** (setting off, and no EMAIL adapter is CONFIDENTIAL-grade); the borrower gets the deep link, and attachments carry INTERNAL or PUBLIC objects only. If yes: a platform request to amend IPB-01's EMAIL rule for an `IN` adapter, then an adapter descriptor change and the setting on.
2. Whether every borrower email with an attachment must go to a verified address only: default left to the product (its `ContactResolver` reads `verifiedEmail`).
3. Retention of the verified address: default kept while the account exists, replaced on a new verification, never deleted by the platform (no delete grant); account closure and erasure follow the owner's retention rule when set.
