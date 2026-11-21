# ADR-0014 — Register the FILE_TRANSFER port

- **Status:** Accepted — Udofin PR-UDF-071, raised by the owner on 21 Nov 2026 (Finbyx's `BureauSubmitter` the second user); planned and built in R1-D-254; Ed25519 SSH client authentication and the SSH transport on the owner's instruction of 21 Nov 2026 07:30 IST (R1-D-249, C-29); no counterparty chosen
- **Date:** 2026-11-21
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-01 §01.4.4.0 (port registration), §01.4.4.1 (common conventions), §01.4.13 (exit), IPB-01-14, IPB-01-15, IPB-01-16, IPB-02-43 (egress), IPB-12-05 (cryptography through `@infrabyx/crypto`); Ecosystem Specification §3.11 (file-transfer fallback), §6.19 and Part 12 (bureau files), §12.2 (SFTP targets: key-based Ed25519, host key pinned, India location attested); ADR-0012 and ADR-0013 for the pattern

## Context

Udofin exchanges files with lenders and Finbyx submits UCRF files to the credit information companies over SFTP (§6.19, §12.4); §3.11 makes SFTP from allow-listed Indian addresses the Ecosystem's file fallback. IPB-01 has no port for it, so each product would carry its own SSH client, host-key handling and egress checks. The platform's earlier note (`docs/phases/R1-lender-connector-note.md`, G6) said a `FILE_TRANSFER` port would follow when a second product needed SFTP; Finbyx is that second product.

## Decision

| §01.4.4.0 item         | FILE_TRANSFER                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface              | `FileTransferPort` (`list`, `get` with a byte cap, `put` with `ifAbsent: true`) in `packages/contracts/src/ports/file-transfer.ts`; §3.11 name and manifest helpers in `file-exchange.ts`         |
| Contract suite         | `fileTransferContractCases` in `packages/testing/src/ports/file-transfer.ts`                                                                                                                      |
| Catalogue row          | `FILE_TRANSFER`, tier 2, `int.file_transfer.`, owner ADR-0014 (Udofin PR-UDF-071); the request to add it to IPB-01 §01.4.4.3 is for the owner to raise in `docs/platform-requests.md`             |
| Reference adapter      | `sftp` over `ssh2` 1.17.0 (MIT): pinned `ssh-ed25519` host keys, an Ed25519 client key from SECRETS, the India-hosted allow-list, public addresses resolved once, exclusive create; off, unproven |
| Alternatives           | `FakeFileTransfer` (`@infrabyx/fakes`), the CI-green alternative; any other SFTP client is a configuration swap (an open protocol)                                                                |
| Config keys            | `int.file_transfer.sftp.enabled` (false), `int.file_transfer.sftp.allow_hosts` (`[]`); per counterparty the target and its pins in the product's configuration, the key in SECRETS                |
| Residency / data class | `IN`, at most REGULATED (the new port default); SECRET refused                                                                                                                                    |

The rules every adapter keeps: relative paths in safe segments, checked before anything is sent; the class at least REGULATED and never SECRET; `get` never returns more than its cap; `put` never overwrites or truncates (exclusive create, `exists` otherwise); fixed refusal labels with no host, address, host key, key or server message. The `sftp` adapter adds the transport rules (threat model §3.176). Cryptography: the SSH protocol runs inside `ssh2` on `node:crypto`; the platform's own key parsing and fingerprints are in `@infrabyx/crypto` (`ssh.ts`), and the registry lists `ssh-ed25519`, `curve25519-sha256` and `chacha20-poly1305` for SSH only (C-29). No platform state (no migration).

## Verification

`contracts` unit tests (path rule, checks, catalogue, §3.11 helpers); `crypto` unit tests (key format, fingerprints, pins, registry); the contract suite on the fake (`testing`) and on `sftp` against the pinned OpenSSH 10.3p1 container (`TEST_IMAGES.sftp`) in the `port-contract` leg (`pnpm --filter @infrabyx/connectors test:contract -- --port FILE_TRANSFER`): wrong pin, unauthorised key, racing puts, deadline, abort with the partial file removed; the address guard and allow-list on stub resolution (`sftp.test.ts`); `PORT_EXIT` and the exit runbook (`sftp` → `fake-file-transfer`).

## Consequences

- Udofin and Finbyx replace product-local SFTP code with this port; each counterparty is a target in their configuration and an allow-list entry the platform operator adds.
- When the first counterparty's test server is used, the adapter's flag can be turned on per environment and its `sandbox-status.json` entry added.
- KMS-held client keys, wider host-key or cipher lists, and PGP encryption of bureau files are not built; each is an owner decision (#184) and a minor.
