# R1 plan: Udofin E8, NSDL eSign, SHCIL eStamp, a second eStamp adapter and manual stamp paper (PR-UDF-054)

Owner's order, 19 Nov 2026 night (item E8, after E7; "each planned and built as its own PR"). Decision R1-D-245. Owner question #177. Threat model §3.169, guide §7dy. Spec of record: IPB-01 ESIGN and ESTAMP (ports, adapter lifecycle, an alternative kept green), IPB-02 (agents are makers only; money movement), Ecosystem Specification §6.2 (`ESignCompleted`, `EStampCompleted`) and the pack's `PackStampEvidence` (R1-D-231, R1-D-236).

Locked lists, as the request itself says: no vendor account, contract, sandbox sign-up or cost; **no purchase of stamp duty, stamp paper or e-stamp** (money movement); no live credentials; no cryptography beyond the approved C-items; no production configuration. Every vendor fact below that public documentation does not confirm is **[VERIFY]**, kept in one mapping function per fact so the sandbox run corrects it in one place.

## A. What Udofin asked for

"NSDL eSign and SHCIL eStamp adapters (the master prompt's references), a second production ESTAMP adapter, and a manual stamp-paper adapter that records a physically stamped instrument's details without buying anything. All adapters off and unproven until their sandbox runs pass; no vendor account, contract or cost without the owner's word."

## B. Where things stand

- **ESIGN** has `leegality` (reference) and `digio` (alternative), both envelope APIs over HTTP, test mode and `unproven`.
- **ESTAMP** has one adapter, `nesl-dde`: NeSL Digital Document Execution only. It **is not production-shaped for stamping**: `covers` answers false and `quoteDuty`, `purchase`, `attach`, `verify` and `handleWebhook` are `unsupported`. The port's only way to obtain a certificate is `purchase`, which is money-moving (`assertMoneyCall`, an approved maker-checker request, never an agent) and has no approved vendor adapter (R1-D-52, R1-D-62).
- Stamp evidence travels as `PackStampEvidence { channel, certificate_no, state, duty_paise, stated_duty_paise?, stamped_document_sha256, issued_at, vendor_certificate_id?, certificate_document_id? }` (R1-D-236) and `EStampCompletedData` (`stamp_mode` `E_STAMP` | `FRANKING` | `PHYSICAL_PAPER`, `stamp_verification_method?`).
- C-items: RS256 is approved only for vendor-dictated Google service-account assertions (C-24, PL3-C-01, PL4-C-01, R1-D-59). The verify-only PAdES/CMS C-item (#162) is approved and is built after E8 (PR-UDF-059). **No XML-DSig signing, no RSA request signing, no CMS signing is approved.**

## C. The gap and how it is closed without buying anything

A regulated entity buys its stamps through its own channel (its SHCIL account or collection centre, a licensed stamp vendor, a franking agent, an aggregator's console). What the platform lacks is a way to **record** such a certificate against the stamped instrument, check it, and turn it into `PackStampEvidence`. So ESTAMP gains one optional, non-money method, and every new ESTAMP adapter is a recording adapter:

| Adapter (descriptor) | Setting (default)                         | Channels                     | Checks the certificate with                                              | Buys?                                                             |
| -------------------- | ----------------------------------------- | ---------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `shcil-estamp`       | `int.estamp.shcil.enabled` (false)        | `E_STAMP`                    | SHCIL's certificate read-back [VERIFY]                                   | Never: `purchase` refused `purchase_not_permitted`                |
| `digio-estamp`       | `int.estamp.digio.enabled` (false)        | `E_STAMP`                    | Digio's e-stamp read-back by its id [VERIFY]                             | Never: `purchase` refused, and no affixing from prepaid inventory |
| `manual-paper`       | `int.estamp.manual_paper.enabled` (false) | `PHYSICAL_PAPER`, `FRANKING` | Nothing external: the RE's own record, checked for shape, hash and reuse | Never; makes no network call at all                               |

and ESIGN gains `nsdl-esign` (`int.esign.nsdl.enabled`, false), an adapter shell whose signing step refuses (§E).

### C.1 The second production ESTAMP adapter (an assumption for the owner, #177 (1))

NeSL DDE is document execution, not stamping, so SHCIL is the first stamping adapter and a second, independent channel is needed. Candidates considered: (a) a State treasury e-challan or e-SBTR portal (one State each, no general API); (b) NeSL e-stamping inside DDE (its availability per State is not publicly documented and would be the same vendor as the current adapter, so no exit value); (c) an aggregator that procures e-stamps for the RE. **Default taken: Digio's e-stamp** (`digio-estamp`), because Digio is already an approved vendor of this stack (ESIGN alternative, KYC, mandates), it is India-hosted, and it is a separate path from the RE's own SHCIL account, so it can serve as SHCIL's exit target. `[ASSUMED – owner review]`; reverse by deleting the adapter and its setting (nothing routes to it).

## D. Contracts (`@infrabyx/contracts`, minor, additive)

`ports/estamp.ts`:

- `STAMP_RECORD_CHANNELS = ["E_STAMP", "FRANKING", "PHYSICAL_PAPER"]` (the names of `STAMP_MODES` and `ESTAMP_MODES`), `STAMP_VERIFICATIONS = ["ISSUER_READBACK", "MANUAL_RECORD"]` (codes usable as `stamp_verification_method`), `STAMP_PURCHASE_NOT_PERMITTED = "purchase_not_permitted"` (the fixed refusal label).
- `StampRecorder { principalId, principalType: "user" | "service" }`: who keyed the record; never an agent (an agent cannot have held the paper; Vidhi stays a maker of drafts only).
- `StampCertificateRecord` (strict): `channel`, `state` (`StateCode`), `instrument` (the Stamp Act article), `certificateNumber` (`[A-Za-z0-9/_.-]{3,64}`, the evidence's rule), `dutyMinor`, `statedDutyMinor?` (duty paid is never less: `deficient_stamping`), `issuedAt` (RFC 3339 with offset), `purchaser` (`EstampParty`), `stampedDocument` (`DocFileRef`), `certificateDocumentId?` (the scanned certificate or paper as the product's document id), `vendorLicence?` (licensed stamp vendor or franking agent), `vendorCertificateId?` (the channel's own id), `recordedBy`. Physical paper and franking **require** `vendorLicence` and `certificateDocumentId`.
- `EstampCertificate` gains optional `channel`, `statedDutyMinor`, `stampedDocumentSha256`, `certificateDocumentId`, `vendorLicence`, `vendorCertificateId`, `verification` (existing adapters and fakes compile unchanged).
- `EstampPort.recordCertificate?(req, idempotencyKey, call?)`: optional (`capabilities.recordCertificate`). Not money-moving: nothing is bought; the stamp was bought outside the platform.

`events/documents.ts`: `stampEvidenceOf(cert)` maps a recorded certificate to `PackStampEvidence` (State `MH` → `IN-MH`) and parses it, so evidence that is incomplete or deficient is refused, not sent.

## E. NSDL eSign (`connectors` `esign/nsdl.ts`, `nsdl-esign`)

NSDL e-Gov is an eSign Service Provider under the CCA's eSign API (e-authentication guidelines; API versions 2.x/3.x). The ASP (the RE's application) sends an `<Esign>` XML request naming the document hash and is answered with an `<EsignResp>` carrying a PKCS#7 signature. Public facts used: the request is XML with an `InputHash` (SHA-256) per document and is **signed by the ASP with an enveloped XML-DSig signature using its own certificate's RSA key**; the response is XML-DSig-signed by the ESP; the signature is embedded in the PDF as CMS. Attribute names, versions, auth-mode codes, gateway URLs and the PDF byte-range preparation are **[VERIFY]**.

- **Signing is not implemented.** The ASP request signature (XML-DSig, RSA-SHA256) is cryptography not on the approved list (C-24 covers only Google assertions), so `aadhaarEsign` builds the unsigned request (`buildEsignRequestXml`, a pure function with escaping; no Aadhaar number ever: the signer enters it on the ESP's page) and hands it to an `EsignRequestSigner` that refuses: `IPB-PORT-001`, reason `unsupported`, `meta.step: "asp_request_signature"`. The signer is fixed inside the adapter; no option accepts another, so no unapproved primitive can be plugged in. Raised to the owner, #177 (2).
- Response verification (`handleWebhook`), `downloadSigned` (CMS embedding) and `verifySignature` are `unsupported`; verification comes with the #162 verifier (PR-UDF-059); embedding the ESP's signature into the PDF and signing the request wait for #177 (2).
- `createEnvelope` works when the flag is on: the envelope is validated, the document read from STORAGE and checked against its SHA-256, and recorded locally (no request leaves). Only `AADHAAR_OTP_ESIGN` and `AADHAAR_BIO_ESIGN` are accepted; every other method is refused `method_unsupported` (never downgraded). `getStatus`/`sendForSignature` report the local state; `dscSign` and `cancel` are `unsupported`.
- No egress client and no host: the adapter makes no network call. `health()` is `down` (off, or signing not approved).

## F. SHCIL eStamp (`estamp/shcil.ts`, `shcil-estamp`)

Stock Holding Corporation of India is the Central Record Keeping Agency for e-stamping in the States that adopted it; its public site verifies a certificate by State, certificate number, issue date and duty. Its integration for regulated entities is not publicly documented, so host, auth (HTTP Basic, client id and secret from SECRETS), the read-back route `POST /estamp/v1/certificates/verify`, the fields (`certificate_no`, `state_code`, `issue_date`, `stamp_duty_amount` in rupees) and the statuses are **[VERIFY]** and stub-shaped.

- `recordCertificate`: validate; refuse a channel other than `E_STAMP`; read the stamped document and check its SHA-256; ask SHCIL for the certificate (sending only its number, State, issue date and duty, no party name); refuse `certificate_not_found` or `certificate_mismatch` (State, number, duty or issue date differ); keep the record with `verification: "ISSUER_READBACK"`.
- `verify` reads the certificate back again (a cancelled certificate becomes `cancelled`); `attach` links one document only.
- `purchase` refused `purchase_not_permitted` before anything else; `quoteDuty` (a RULES computation in the product), `handleWebhook` `unsupported`; `covers` false (it stamps nothing).

## G. Digio e-stamp (`estamp/digio-estamp.ts`, `digio-estamp`)

Digio offers e-stamps procured from an inventory the RE buys in its own console [VERIFY]. The adapter never orders or affixes a stamp (consuming prepaid inventory is spending): it reads back a stamp Digio already issued to the RE, by Digio's id (`vendorCertificateId`, required), through `GET /v2/client/estamp/{id}` on Digio's host [VERIFY], with the same checks and refusals as §F. HTTP Basic with the Digio client id and secret.

## H. Manual stamp paper (`estamp/manual-paper.ts`, `manual-paper`)

Records a physically stamped instrument: State, article, duty, certificate or serial number, the licensed vendor's (or franking agent's) licence, the stamped document's SHA-256 (checked against STORAGE), the scanned certificate's document id, and who recorded it. Channels `PHYSICAL_PAPER` and `FRANKING`. It never calls anything external and never buys; `verification: "MANUAL_RECORD"`. The record is the product's evidence: the product writes it in its kernel mutation, so the hash-chained ledger entry is in the same transaction (the adapter writes only to its `StampRecordStore`, the product's table). **Maker-checker:** the port's evidence calls carry none (DDE registration has none) and approval policy is on the locked list, so none is added; whether a manually keyed stamp needs a checker before it enters a pack is asked, #177 (3).

## I. Shared recording rules (`estamp/record.ts`)

One base for the three ESTAMP adapters: off until its setting; idempotency key (`[A-Za-z0-9_.:-]{8,128}`) → deterministic `est_` id; the same key with another record `IPB-PORT-004`; **a certificate number is recorded once per State and channel** (`IPB-PORT-004`, `certificate_reused`: a stamp is used for one instrument); `issuedAt` not in the future; the stamped document is a PDF whose bytes match; `MemoryStampRecordStore` for tests (a product's store needs a unique index on State, channel and number).

## J. Stubs and tests (by IPB ID)

- `testing` stubs `startShcilEstampStub()` and `startDigioEstampStub()` (an `issue(…)` hook seeds a certificate the RE "bought"; neither stub has any purchase route) [VERIFY shapes].
- `testing` `estampRecordContractCases(fx)` (@IPB-01-15): declares `recordCertificate` and classes the record REGULATED, IN; records once per key, refuses another record under the key, reads back, attaches one document, and its evidence parses as `PackStampEvidence`; refuses a certificate reused under another key; refuses deficient stamping and an agent recorder. Run against `FakeEstamp` (fakes gain `recordCertificate`), `manual-paper`, `shcil-estamp` and `digio-estamp`.
- Adapter legs: off until the flag (no request, health down); `purchase` refused `purchase_not_permitted` with nothing sent; hash mismatch refused before any request; mismatch and not-found refused; only number, State, date and duty leave (no names); the manual adapter makes no `fetch`; NSDL: off; methods other than Aadhaar refused; the unsigned XML's shape and escaping (fixture); `aadhaarEsign` refused at `asp_request_signature`; no XML carries an Aadhaar number.
- `contracts` tests for `StampCertificateRecord` and `stampEvidenceOf`.

## K. Configuration, lifecycle and docs

- Settings (`config`, minor): `int.esign.nsdl.enabled`, `int.estamp.shcil.enabled`, `int.estamp.digio.enabled`, `int.estamp.manual_paper.enabled`, all `bool`, default `false`, `PLT_SUPER_ADMIN`, `R4`.
- `unproven`: as for `nesl-dde`, `idfy-kyc` and `setu-aa`, the adapters are not added to `sandbox-status.json`, whose gate requires an open port-contract issue per unproven adapter and this PR opens no issue; they stay off by setting and are declared `unproven` in their headers. Listing them (with issues) is an owner task, #177 (4). `int.esign.provider` is unchanged (`nsdl` is not routable while it cannot sign).
- Exit table unchanged (ESTAMP's primary stays `nesl-dde`); SHCIL ↔ Digio becomes the stamping exit pair once both are proven.
- Changesets: `contracts`, `fakes`, `testing`, `connectors`, `config` (minors). DECISIONS R1-D-245; threat model §3.169; guide §7dy; OWNER-QUESTIONS #177.

## L. Exit-gate checklist

Build, typecheck, lint and unit tests of the touched packages; ESIGN and ESTAMP contract legs (`pnpm --filter @infrabyx/connectors test:contract -- --port ESIGN|ESTAMP`, hermetic, sandbox legs off); `format:check`, `ipb:check`, `test:policy`, `aadhaar:scan`.

## M. Owner decisions needed (#177)

1. The second stamping adapter is Digio's e-stamp (default, §C.1).
2. NSDL eSign request signing (XML-DSig RSA-SHA256 with the ASP certificate) and embedding the ESP's CMS signature into the PDF: a new C-item, or stay with Leegality/Digio, which sign at their end. Default: not built, refused `unsupported`.
3. Manual-paper evidence rules: who may record (default user or service, never an agent), whether a checker must confirm before the stamp enters a pack (default none added), and the fields required (default: licence and scan for paper and franking).
4. Accounts and port-contract issues for SHCIL, Digio e-stamp and NSDL (and the `sandbox-status.json` entries): none created.
