# @infrabyx/contracts

## 0.2.0

### Minor Changes

- 9ac878e: `KmsPort.generateDataKey(keyId, aad?)`: optional AAD that binds the wrapped data key (the C-14
  encryption context). Existing callers are unaffected.
- ded1ae2: PL2 session 1: port interfaces for AUTHZ, QUEUE, WORKFLOW, EMAIL, SMS, WHATSAPP, PAYMENTS and
  OBSERVABILITY and the full IDENTITY interface; `PortCall`, capability flags and idempotency lookup;
  payload data-class annotations with `effectiveDataClass` (a caller may only raise the port default,
  PL2-D-03); delivery-recipient fields (IPB-DEV-05); integer-only paise/decimal conversion (P-04);
  the `provider_routing` schema and `checkRouting` (IPB-01 §01.4.5: secrets paths, residency,
  tighten-only policy, recipient delivery, unproven adapters refused in staging and above); the
  IPB-10 connector manifest schema with the P-18 settlement rule; provider-routing event payloads.
- 9c774b9: STORAGE: `presign(key, op, ttl, opts?)` takes `{ bucketClass, contentType }` so an upload URL is
  bound to its bucket class and content type. KMS: purpose `workflow` in `KMS_PURPOSES` for the
  Temporal payload codec (C-16).
- 7a36249: `KMS_PURPOSES`, `KmsEncryptionContext`, `isKmsEncryptionContext` and `PLATFORM_KMS_TENANT`: the fixed purpose registry and the C-14 context type for data-key wraps (PL2-D-50).
- 13c7379: Messaging (PL2-D-64): `IPB-API-018` in the error catalogue (IPB-10 §10.6.3); optional `WebhookRequestMeta` (source IP, query string) on the EMAIL, SMS and WHATSAPP `verifyWebhook`; optional `pricingCategory` and `errorCode` on `WhatsappEvent`.
- 0c4535d: `PaymentEvent.method`: the payment method category (card, UPI, netbanking, wallet, EMI, other), never card, VPA or account values (P-10).

### Patch Changes

- 2969424: IDENTITY: `authenticate` takes the PKCE `codeVerifier` for an authorisation code; new id prefix
  `rvk` for session and user revocations.
- 858a76a: Add the `idm` id prefix for port idempotency records (PL2 plan §3.5).

## 0.1.0

### Minor Changes

- a17086c: PL1 kernel vocabulary: data classes and residency policy (IPB-02 §02.4.3.1, IPB-01 §01.4.5), prefixed ULID identifiers, the nine-environment catalogue and guard groups (IPB-09-15, IPB-11 §11.2), the role floor (PL1-D-05), settings tiers and risk classes R0–R5, the 99-code error catalogue (incl. IPB-MOD-003 and IPB-UX-011, PL1-D-08) with RFC 9457 rendering (IPB-ENV codes per PL1-D-03), internal (IPB-10-37) and Ecosystem (Spec §3.2) CloudEvents envelopes, the module manifest (IPB-01-10), kernel interfaces, the port catalogue, and the SECRETS, KMS, STORAGE, FEATURE_FLAG and IDENTITY port contracts.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard
