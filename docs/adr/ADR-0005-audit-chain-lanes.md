# ADR-0005 — Chain lanes for the audit ledger and the statutory capture

- **Status:** accepted — the owner's order of 3 Nov 2026 (Finbyx PR-FBX-32, pilot-critical)
- **Date:** 2026-11-03
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-02-51 (hash-chained, append-only ledger with signed anchors), IPB-02-52, IPB-02 §02.4.7.1; PL1-C-01 (the chain's hash); R1-D-25 (statutory capture); R1-D-58

## Context

Every mutation writes the hash-chained audit ledger in its transaction (IPB-02-51). Since `audit/0003`, every write to a registered books-of-account table also appends to the statutory capture's chain.

Both chains kept one head row per tenant (`audit.chain_head`, `audit.capture_head`). An append locked it `FOR UPDATE` until the transaction ended, because the next entry must link to this one's hash, so all of a tenant's writing transactions ran one at a time.

Finbyx's Phase 9 load test measured the effect. One day's close of business ran at about 22 loans a second whatever the number of workers, with the sessions waiting on `Lock:tuple` and `Lock:transactionid`. That is about 158,000 loans in the 2-hour window, against the 1,000,000 required. The request asks for an append path that keeps the tamper evidence without a single hot row per tenant.

The options considered:

1. **A sequence instead of the head lock, with chaining done later by a job.** No contention, but an entry is unchained until the job runs, and a deleted entry between write and job leaves no break. Rejected: weaker than today.
2. **Appends batched per transaction (one chain step per transaction).** It reduces lock hold time only when a transaction is short. The head is still held from the first append to commit, and a COB transaction does its work between appends, so it is still serialised.
3. **Several chains per tenant (lanes), each exactly today's chain, sealed together by the signed daily anchor.** Chosen.

## Decision

Each tenant has N **lanes** per chain (ledger and capture), 32 by default. The number is held in `audit.lane_setting` and is only ever raised (`audit.set_chain_lanes`), so no lane is abandoned.

- **Each lane is today's chain.** `entry_hash = sha256_hex(prev_hash ‖ "\n" ‖ canonical)` with genesis 64 zeros (PL1-C-01 unchanged). The canonical form adds the entry's `lane` and its position `lane_seq`. Both are set by the trigger and hashed, so an entry cannot be moved to another lane or position.
- **Choosing a lane.** A transaction's first append prefers lane `hash(txid) mod N`. It takes the first lane it can lock without waiting (`FOR UPDATE SKIP LOCKED`, the preferred lane first, then the others in turn), and waits for its preferred lane only when all are taken. It keeps that lane for every later entry, through a transaction-local setting (`audit.ledger_lane`, `audit.capture_lane`) that a rolled-back savepoint reverts together with the lock. So up to N transactions of one tenant append at once. Each lane remains a strict sequence, and one transaction's entries are contiguous in one lane. A setting a caller pins (a lane number below N) only chooses which lane it waits for; it cannot skip the lock or the chain.
- **`seq`** becomes a global sequence (`audit.ledger_seq`, `audit.capture_seq`). It is unique, increases within each lane and has gaps; it no longer counts a tenant's entries. It is still hashed.
- **Existing chains continue as lane 0.** Entries written before `audit/0006` have no lane, are lane 0 at their `seq`, and hash exactly as before. A tenant's first append after the upgrade creates its lanes and starts lane 0 from the tenant's old head. It reads that head `FOR UPDATE`, so a transaction still finishing under the old trigger is waited for. The old head tables stay, frozen. Nothing written is changed or re-hashed.
- **Lane heads** (`audit.ledger_lane`, `audit.capture_lane`) are written only by the chains' owners (`app_migrate` for the ledger trigger, `capture_writer` for the capture). Deletes and truncates are refused. The verifiers compare each lane's verified end with its stored head, so a deleted tail is reported (`head-mismatch`). That check is new for the ledger: the old verifier did not read `chain_head`.
- **The daily anchor (format 3)** signs every lane head of both chains at the end of the day, with `head_hash` and `capture_head_hash` as the root over each list (`lanesRoot`, SHA-256 of the sorted canonical list), in KMS (C-22) and in write-once STORAGE. This is the cross-lane seal: a lane edited, shortened or replaced after an anchor no longer matches it. Formats 1 and 2 still verify.

## Verification

- **Unit (`chain.test.ts`, `capture.test.ts`):** the lane is hashed only on laned entries; interleaved lanes verify; an edit, a gap or a relink in any lane is found, as is an entry moved to another lane; lane 0 continues a legacy chain; a deleted tail shows against the stored heads.
- **Integration, on PostgreSQL (`lanes.int.test.ts`):**
  - after the upgrade, an old tenant's next lane-0 entries link to its old ledger and capture heads, and both chains verify across the boundary;
  - 16 concurrent writers × 10 transactions use several lanes, every lane verifies, and each transaction's captured rows sit in one lane;
  - lanes only rise;
  - a deleted lane tail is reported.
- **Load, in the same file (CI):** 16 writers × 8 transactions, each holding its transaction 20 ms. Everything forced into one lane is bounded at 1000 / 20 = 50 tx/s and measured 39 tx/s; lanes measured 360 tx/s. The test requires at least 3×.
- **Measured locally** (4 vCPU, PostgreSQL 16 on the same host; two captured rows and one ledger entry per transaction):

  | Writers | Hold per transaction | One lane | Lanes      |
  | ------- | -------------------- | -------- | ---------- |
  | 1       | none                 | 281 tx/s | 303 tx/s   |
  | 8       | none                 | 349 tx/s | 1,013 tx/s |
  | 16      | none                 | 314 tx/s | 1,027 tx/s |
  | 32      | 10 ms                | 68 tx/s  | 871 tx/s   |

  The 32-writer row is 20 transactions each. With lanes, the CPU becomes the limit.

- **Existing suites:** `audit.int.test.ts` and `capture.int.test.ts` are updated to the lane semantics (gap-free per lane, format 3 anchors, breaks named by lane), and the NN-02 tampering checks in `@infrabyx/testing` pass unchanged.

## Consequences

- **What callers see.** `seq` is no longer dense per tenant: code that counted entries by `seq`, or paged by `afterSeq` expecting commit order, must use the entry count, or page within a snapshot as the verifiers do. `VerifyResult` and `CaptureVerifyResult` gain `lanes`, and `head.hash` is the root over lanes. A break names its `lane` and `laneSeq`.
- **Anchors** are format 3 from this release. Auditors verify with `verifyAgainstAnchor` and `verifyCaptureAgainstAnchor`, which still accept formats 1 and 2.
- **Ordering.** Within a day there is no single hash-linked total order across lanes. Each entry still carries its global `seq` and `occurred_at`, both hashed, and the anchor seals all lanes each day. A product that wants a finer seal can anchor more often in a later minor.
- **Deadlocks.** A transaction that holds a ledger lane and a capture lane, while another holds the same two in the opposite order, can deadlock. PostgreSQL detects it and aborts one; the old single heads allowed the same. Writing the change before its ledger entry, as mutations normally do, keeps the order consistent.
- **Upgrade.** `audit/0006` locks `audit.ledger` and `audit.capture` briefly (its `lock_timeout` is 5 s). `audit/0007` builds two unique indexes concurrently, a no-transaction file.
- **Lanes.** The default of 32 suits a COB of tens of workers. A product raises it in its own migration with `select audit.set_chain_lanes('ledger', 64)` (and `'capture'`).
