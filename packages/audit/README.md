# @infrabyx/audit

The hash-chained, append-only audit ledger: correction entries, a verifier and signed daily anchors.

**Specified by:** `docs/ipb/` — IPB-02-51, IPB-02-52, IPB-02 §02.4.7.1; cryptography choices PL1-C-01 (chain), C-02 (pseudonyms), C-03 (anchor signatures). Plan: `docs/phases/PL1-plan.md` §8.

## Chain

`entry_hash = sha256_hex(prev_hash ‖ "\n" ‖ JCS(entry))`, with a genesis `prev_hash` of 64 zeros per tenant. The `audit.ledger_chain()` trigger computes it **in the database**: it locks the tenant's `audit.chain_head` row, assigns `seq`, `prev_hash`, `entry_hash` and `occurred_at` (milliseconds, UTC). No application path can write an unchained row. CHECK constraints keep every hashed field to characters JSON never escapes, so `verifyChain()` in TypeScript reproduces the same bytes. JCS covers `action, actor_id, actor_type, after_digest, before_digest, corrects_id, id, ip_hash, occurred_at, resource_id, resource_type, seq, tenant_id, trace_id, ua_hash`.

- Append-only for everyone (NN-02): `UPDATE`/`DELETE`/`TRUNCATE` revoked from `app_rw`, `app_ro`, `app_migrate`, plus triggers that raise for any role, the owner included. Corrections are new entries with `corrects_id`.
- RLS: a tenant reads only its own entries; an insert must carry the context's `app.tenant_id` and `app.actor_id`, so the actor cannot be forged.
- Before/after payloads are stored only as canonical SHA-256 digests; `ip_hash`/`ua_hash` are HMAC-SHA-256 pseudonyms (C-02).

## API

- `new PgAuditSink({ pseudonymKey })` implements `AuditSink`; call `record(tx, entry)` inside `kernel.mutate` (the kernel refuses a commit without it, `IPB-MOD-003`).
- `AuditService.query(ctx, filter)`, `correct(tx, entryId, entry)`, `verify(ctx)` (weekly verifier; emits `LedgerChainBroken` and ledgers the finding), `writeAnchor(ctx, "YYYY-MM-DD")`.
- Anchors: per tenant per day, `{ format, tenant_id, anchor_date, seq, head_hash, head_entry_id, created_at }` in JCS, signed ECDSA P-256/SHA-256 through the KMS port, written write-once to the AUDIT bucket with an 8-year retention (`putWithRetention`), recorded in `audit.anchor`, `LedgerAnchorWritten` emitted. `verifyAnchorFile(file, publicKey)` and `verifyAgainstAnchor(entries, file, publicKey)` let a tenant verify its exported slice with the public key alone.

PL1 stubs: STORAGE and KMS are fakes/LocalKms (S3 Object Lock adapter in PL2); the public timestamp anchor (IPB-OI-02-05) stays off.

## Migrations

`migrations/0001_init.sql`: schema `audit` with `ledger`, `chain_head`, `anchor`, `outbox`. Applied by `infrabyx-migrate` after tenancy.
