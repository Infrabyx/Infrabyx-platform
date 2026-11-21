# R1 plan: the FILE_TRANSFER port, an SFTP client (PR-UDF-071)

Udofin PR-UDF-071, raised by the owner on 21 Nov 2026; Finbyx's `BureauSubmitter` (Ecosystem Spec §6.19 and Part 12, UCRF files to the credit information companies over SFTP) is its second user. Decision R1-D-254; ADR-0014; threat model §3.176; product guide §7ef; owner question #184. The owner's instruction of 21 Nov 2026 07:30 IST (R1-D-249) asks for "an ed25519 key from SECRETS or KMS" for client authentication, so ed25519 SSH client authentication and the SSH transport, inside the SSH library, are used on that instruction (C-29 below).

Spec of record: IPB-01 §01.4.4.0 (port registration: interface, contract suite, reference adapter, an alternative that may be a fake, catalogue row, config keys, ADR), §01.4.4.1 (conventions), IPB-01-14 (vendor and protocol libraries only in `packages/connectors`), IPB-01-15 and -16 (contract suites, residency and class), IPB-02-43 (egress guard), IPB-12-05 (cryptography through `@infrabyx/crypto`), PL2-D-32 (7-day dependency rule); Ecosystem Spec §3.11 (file-transfer fallback: SFTP from allow-listed Indian addresses, the manifest and the file name) and §12.2 (SFTP targets: "key-based (ed25519), host key pinned"; India residency by a signed attestation of the server's location).

## A. What was asked

"A FILE_TRANSFER (SFTP client) port with a reference adapter: the host key pinned (no trust on first use); an ed25519 key from SECRETS or KMS; list, get with a cap, put without overwrite; an India-hosted allow-list and public addresses only; a contract suite and an in-memory fake; optionally the §3.11 manifest helpers."

## B. What exists and what is reused

- The SSRF guard `isPublicAddress` (`connectors/egress/governed.ts`, IPB-02-43, R1-D-176): public unicast only, every resolved address checked. Reused unchanged; the adapter resolves the host once, refuses the call if any answer is not public, and connects to the address it checked.
- `ssh2` 1.17.0 is already in the lockfile (a dependency of Testcontainers' Docker client). It becomes a runtime dependency of `@infrabyx/connectors` only (§G).
- No KMS adapter of the platform signs with Ed25519 today (`aws-kms` and `vault-transit` sign ECDSA P-256 only; the registry's `ed25519` entry is `planned`). So the client key comes from SECRETS; a KMS-held key is a recorded gap (§H, #184 (1)): `ssh2` can sign through a custom agent, so a later minor can add a KMS signer once a KMS adapter signs Ed25519, without changing the port.

## C. Design

### C1. The port (`contracts`, `ports/file-transfer.ts`)

```ts
interface FileTransferPort extends Port {
  list(dir: string, o?: FileTransferListOptions): Promise<FileTransferListing>;
  get(path: string, o?: FileTransferGetOptions): Promise<FileTransferFile>;
  put(path: string, bytes: Uint8Array, o: FileTransferPutOptions): Promise<FileTransferPutResult>;
}
```

- Paths are relative to the account's home (normally a chroot): segments of `[A-Za-z0-9._-]` (1 to 255 characters, not `.` or `..`, not starting with `-`), joined by `/`, at most 16 segments and 1024 characters; `.` names the home for `list`. No leading `/`, backslash, NUL, control character or empty segment (`invalid_path`). §3.11 names fit.
- `list` → `{ dir, entries: [{ name, type: file | directory | other, size, modifiedAt }], truncated, skipped }`, sorted by name; `maxEntries` default 1 000, at most 10 000. A name the path rule refuses is not returned (counted in `skipped`), since a caller could not name it back.
- `get(path, { maxBytes })` → `{ path, bytes, size, sha256 }` (lower-case hex of exactly the bytes). Default cap 32 MiB, at most 256 MiB. A file whose stated size is over the cap is refused before reading; a file that grows past it while read is cut off and refused (`too_large`, `IPB-SEC-013`). Only regular files (`not_a_file`).
- `put(path, bytes, { ifAbsent: true })` → `{ path, size, sha256 }`. `ifAbsent` is a required literal `true`: there is no overwrite mode. The adapter opens the file with the SFTP exclusive-create flags (`WRITE | CREAT | EXCL`, no `TRUNC`), so an existing file is refused by the server atomically (`exists`, `IPB-STOR-003`) and never truncated; there is no stat-then-write race. At most 256 MiB. A write that fails after the create is a partial file the adapter made itself: it removes it (best effort) and says so (`meta.partial_removed`).
- Each call takes the trailing `PortCall` fields (`dataClass`, `tenantId`) and an `AbortSignal`. The port default class is `REGULATED` (bureau files carry credit information); `SECRET` is refused (`data_class`).
- Fixed refusal labels (`FILE_TRANSFER_REFUSALS`, `meta.reason`), never a host key, key, address or server message in an answer or error: `adapter_disabled`, `adapter_unconfigured` (`IPB-PORT-001`); `data_class`, `residency` (`IPB-PORT-003`); `invalid_path`, `not_allowed`, `address`, `host_key_mismatch` (`IPB-SEC-018`); `too_large` (`IPB-SEC-013`); `not_found`, `not_a_file` (`IPB-STOR-001`); `exists` (`IPB-STOR-003`); `client_key` (`IPB-PORT-001`, the SECRETS value is not an unencrypted OpenSSH Ed25519 key); `dns`, `auth_failed`, `timeout`, `aborted`, `unavailable` (`IPB-PORT-002`).
- Catalogue row `FILE_TRANSFER` (tier 2, `int.file_transfer.`, ADR-0014), `R1_PORTS`, `PORT_DEFAULT_DATA_CLASS.FILE_TRANSFER = "REGULATED"`; router table (every method `noFailover`: a file is on one server, and another server is another set of files).

### C2. The reference adapter `sftp` (`connectors/file-transfer/sftp.ts`, over `ssh2`)

- **Off** behind `int.file_transfer.sftp.enabled` (default false); `unproven` until a counterparty's test server is used.
- **Target** from the product's configuration (one adapter instance per counterparty): `{ host, port (default 22), username, hostKeySha256: ["SHA256:…"] (1 to 4 pins), clientKeySecret (a SECRETS path) }`. The host is an exact DNS name or an IP literal, lower-case.
- **India-hosted allow-list** `int.file_transfer.sftp.allow_hosts` (json, PLATFORM, default `[]`): entries `{ host, residency: "IN", attestation? }`, exact names or IP literals, no wildcards. A target not on it is refused `not_allowed`; an entry whose declared residency is not `IN` is refused `residency`. The declaration is the operator's record of the tenant's signed attestation of the server's location (§12.2); the platform cannot verify it.
- **Address guard:** the host is resolved once (`dns.lookup`, all answers); any answer outside public unicast (`isPublicAddress`) refuses the call (`address`); the connection goes to the first checked address, so a second lookup cannot rebind it. An IP literal is checked the same way.
- **Host key:** pinned SHA-256 fingerprints only (OpenSSH `SHA256:` form), compared in constant time in `ssh2`'s `hostVerifier`; a mismatch ends the handshake before authentication (`host_key_mismatch`). No trust on first use, no known_hosts file, no fingerprint learnt from the server. Host-key algorithm `ssh-ed25519` only (#184 (3)).
- **Client key:** the SECRETS value at `clientKeySecret`, read on each connection; it must be an unencrypted OpenSSH `ssh-ed25519` private key (`assertSshEd25519PrivateKey`, `@infrabyx/crypto`), else `client_key`. Public-key authentication only (`authHandler: ["publickey"]`): no password, keyboard-interactive, agent or agent forwarding.
- **Algorithms** (fixed lists, no fallback to `ssh2`'s defaults): key exchange `curve25519-sha256`, `curve25519-sha256@libssh.org`; host key `ssh-ed25519`; ciphers `aes256-gcm@openssh.com`, `chacha20-poly1305@openssh.com` (AEAD only, so no MAC is negotiated; the MAC list offers `hmac-sha2-256-etm@openssh.com` only because the protocol needs a list); compression `none`. No CBC, CTR, SHA-1, DH group or NIST-curve exchange.
- **Timeouts and abort:** handshake `connectTimeoutMs` (default 15 s), the whole call `timeoutMs` (default 120 s), and the call's `AbortSignal`; each ends the connection (`timeout`, `aborted`). One connection per call, closed after it.
- **Test-only options** `testOnlyResolve` (stub resolution) and `testOnlyAllowLoopback` (admits 127.0.0.1 and ::1 only, for the pinned SFTP container on the runner): constructor options only, never read from a setting, so production configuration cannot set them (as `GovernedEgress.testAllowLoopback`). The address guard itself is tested with stub resolution (private, mixed and public answers).
- **Health:** no network by default (a probe every 30 s would hit a counterparty's server): `down` when off or unconfigured, `up` when on and the target passes the allow-list; `healthProbe: true` connects and resolves the home directory.

### C3. The fake (`fakes`, `FakeFileTransfer`)

In memory, with the same rules: the path rule, the class, the cap (checked on the stored size), no overwrite (`exists`), `not_found`, `not_a_file`, directories implied by files, `maxEntries`, an `enabled` switch and an abort check. Fixture `seed(path, bytes)` for tests.

### C4. The contract suite (`testing`, `fileTransferContractCases`)

Run on the fake (unit leg) and on `sftp` against the pinned SFTP container (hermetic leg): put then get the same bytes and SHA-256; list shows the file with its size; put on an existing file refused `exists` with the first bytes unchanged; get over the cap refused `too_large` and at the cap accepted; get of a missing file `not_found`; a directory is `not_a_file`; invalid paths refused before any network; `SECRET` refused; every refusal holds no host, address or key material. Adapter-only cases in the connectors leg: a wrong pinned host key refused `host_key_mismatch` (and nothing written); a host off the allow-list `not_allowed`; an allow-list entry not `IN` `residency`; a private, loopback (without the test option) or mixed answer `address`; a non-Ed25519 or encrypted client key `client_key`; an abort and a timeout; off and unconfigured.

### C5. §3.11 manifest helpers (`contracts`, `ports/file-exchange.ts`)

§3.11 defines the manifest's content (layout, version, count, control totals, period, SHA-256), its detached-JWS signature and the file name `[producer]_[reid]_[layoutid]_v[major]_[yyyymmdd]_[seq].[ext]`. Pure helpers, no I/O: `fileExchangeName(parts)` and `parseFileExchangeName(name)`; `FileExchangeManifest` (zod, strict) and `fileExchangeManifest(input)`; `checkFileExchangeManifest(manifest, { fileName, sha256, count? })` → the list of mismatches; `fileExchangeManifestSigningInput(manifest)` (the RFC 8785 bytes a product signs with the existing C-22 `signDetachedJws`). The acknowledgement file's layout is not defined by §3.11 and is not built.

## D. Cryptography (C-29, on the owner's instruction)

Ed25519 SSH client authentication and the SSH transport run inside `ssh2` on `node:crypto`; the platform's own code adds only parsing and fingerprints in `@infrabyx/crypto` (`ssh.ts`): `sshHostKeyFingerprint` (SHA-256, OpenSSH form), `sshHostKeyPinned` (constant time), `assertSshEd25519PrivateKey` (OpenSSH key format, unencrypted, one `ssh-ed25519` key, check integers equal, public half matching) and `generateSshEd25519KeyPair` (tests and operators' tooling). Registry (CBOM): new `ssh-ed25519` (signature, SSH only; the generic `ed25519` entry stays `planned`, so `signRecord` still refuses it), `curve25519-sha256` (new purpose `key-agreement`), `chacha20-poly1305` (SSH transport only); `usedFor` lines on `aes-256-gcm`, `sha-256` and `sha-512`.

## E. Settings and configuration

`int.file_transfer.sftp.enabled` (bool, false, PLATFORM, `PLT_SUPER_ADMIN`, R4) and `int.file_transfer.sftp.allow_hosts` (json, `[]`, PLATFORM, `PLT_SUPER_ADMIN`, R4), registered in `packages/config` before the adapter reads them. The target, its pins and its key path are the product's configuration per counterparty; the key's value is in SECRETS. No environment variable, no migration, no database state.

## F. Tests by IPB ID

`@IPB-01-15` contract suite on the fake and on `sftp` (hermetic, pinned `atmoz/sftp` container, OpenSSH 10.3p1, digest-pinned and older than 7 days, in `TEST_IMAGES` and `infra/docker/TEST_IMAGES.md`); `@IPB-01-16` descriptor `IN` / `REGULATED`; `@IPB-02-43` the address guard with stub resolution; IPB-12-05 crypto unit tests (fingerprint against `ssh-keygen -l` output, key parsing refusals, generated keys accepted by OpenSSH); contracts unit tests (path rule, options, catalogue, manifest helpers). Port matrix leg `FILE_TRANSFER` with its paths; `infra/policy` path-filter test.

## G. Dependency (PL2-D-32)

`ssh2@1.17.0` (MIT; published 20 Aug 2025; one maintainer, mscdex; already resolved in the tree). Runtime dependencies `asn1@0.2.6` (MIT, via `safer-buffer`, MIT) and `bcrypt-pbkdf@1.0.2` (BSD-3-Clause, via `tweetnacl@0.14.5`, Unlicense; used only for passphrase-encrypted keys, which the adapter refuses). Optional native pieces `cpu-features` and `ssh2`'s own `sshcrypto` binding: pnpm 10 runs no lifecycle script not in `onlyBuiltDependencies`, so neither is built and `ssh2` uses `node:crypto` (AES-GCM, ChaCha20 with its bundled Poly1305, X25519, Ed25519). Review in §I.

## H. Owner decisions (#184; nothing blocks)

(1) KMS-held keys: SECRETS only, because no platform KMS adapter signs Ed25519; (2) the allow-list's residency is a declaration, not a check; (3) host keys `ssh-ed25519` only (a server with only RSA or ECDSA host keys is refused); (4) ciphers AES-256-GCM and ChaCha20-Poly1305 only, curve25519 exchange only; (5) caps: get 32 MiB default and 256 MiB at most, put 256 MiB, list 1 000 / 10 000; (6) the not-found and exists refusals reuse `IPB-STOR-001` and `IPB-STOR-003`; (7) health makes no connection unless asked; (8) §3.11 control totals are integer strings by name and the period is two dates (the Specification names them without a shape).

## I. Supply-chain review of `ssh2` (PL2-D-32)

Reviewed 21 Nov 2026 with the build.

| Package        | Version (published)  | Licence      | Role                                                       | Notes                                                                                                                                                                                      |
| -------------- | -------------------- | ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ssh2`         | 1.17.0 (20 Aug 2025) | MIT          | SSH-2 client and SFTP v3, pure JavaScript on `node:crypto` | One maintainer (mscdex), maintained since 2012, releases about yearly; strict key exchange (the Terrapin mitigation, CVE-2023-48795) since 1.15.0, negotiated with OpenSSH 10.3 in the leg |
| `asn1`         | 0.2.6 (4 Nov 2021)   | MIT          | BER reader for OpenSSL-format keys                         | Not reached for OpenSSH-format Ed25519 keys                                                                                                                                                |
| `safer-buffer` | 2.1.2 (8 Apr 2018)   | MIT          | `Buffer` shim under `asn1`                                 |                                                                                                                                                                                            |
| `bcrypt-pbkdf` | 1.0.2 (29 Jun 2018)  | BSD-3-Clause | KDF for passphrase-protected OpenSSH keys                  | Never used here: `assertSshEd25519PrivateKey` refuses an encrypted key before `ssh2` sees it                                                                                               |
| `tweetnacl`    | 0.14.5 (13 Dec 2016) | Unlicense    | Blowfish/SHA-512 inside `bcrypt-pbkdf`                     | As above                                                                                                                                                                                   |
| `cpu-features` | 0.0.10 (3 May 2024)  | MIT          | Optional: CPU flags to order ciphers                       | Native addon, **not built** (pnpm 10 runs no install script outside `onlyBuiltDependencies`); `ssh2` catches its absence. Our cipher list is fixed, so it changes nothing                  |
| `nan`          | 2.30.0 (18 Oct 2026) | MIT          | Optional: headers for the native builds                    | Not built (as above)                                                                                                                                                                       |

- **Age (PL2-D-32):** every version is older than 7 days; `ssh2` 1.17.0 and all of the above were already resolved in `pnpm-lock.yaml` through Testcontainers' Docker client (dev), so the lockfile gains only the importer lines (`ssh2` in `connectors` dependencies, `@types/ssh2` 1.15.6 in its dev dependencies). `minimumReleaseAge`, `trustPolicy: no-downgrade` and `blockExoticSubdeps` apply unchanged.
- **Native code:** none runs. `ssh2`'s own `install.js` would compile an optional `sshcrypto` binding with node-gyp; pnpm 10 blocks it (the install reports it as an ignored build), and without it `ssh2` uses `node:crypto` for AES-GCM, ChaCha20 (with its bundled Poly1305 in JavaScript/asm), X25519 and Ed25519. The hermetic leg ran without the binding. Products on pnpm 10 must not add `ssh2` or `cpu-features` to `onlyBuiltDependencies`.
- **Licences:** `pnpm licence:check` OK (MIT, BSD-3-Clause, Unlicense are on the allow-list; `ssh2`'s legacy `licenses` field is read as MIT). **Advisories:** `pnpm audit --prod`: no known vulnerabilities (21 Nov 2026). The older advisories against `ssh2` that we know of (CVE-2020-26301, a command injection fixed in 1.4.0; Terrapin, CVE-2023-48795, mitigated by strict key exchange from 1.15.0) are fixed in 1.17.0, and the adapter uses no `exec` or shell [VERIFY: the details were not re-read against the GitHub advisory database, which was not consulted beyond `pnpm audit`].
- **Surface kept small:** `ssh2` is imported in one file (`connectors/file-transfer/sftp.ts`), loaded lazily on the first connection; the `vendor-import` lint now lists `ssh2` and `ssh2-sftp-client`. `ssh2-sftp-client` was not taken: it adds `concat-stream`, `promise-retry` and its own retry and overwrite semantics on top of the same library, and the port needs only open, read, write, fstat, readdir and unlink.
- **Alternatives considered:** shelling out to OpenSSH's `sftp` binary (no binary in the runtime image, host-key and key handling through files, harder to cap and cancel) and a self-written SSH client (new protocol cryptography in the platform's own code, against IPB-12-05's spirit). Neither is better.

## Exit gate

`contracts`, `crypto`, `config`, `fakes`, `testing`, `connectors`: build, typecheck, lint, unit and `test:int`; `pnpm --filter @infrabyx/connectors test:contract -- --port FILE_TRANSFER` with the container; `licence:check`, `audit --prod`, `format:check`, `ipb:check`, `test:policy`, `aadhaar:scan`, `registry:check`, `exit-runbook`; one changeset per package (all minor).
