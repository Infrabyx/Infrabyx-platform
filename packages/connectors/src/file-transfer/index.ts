// FILE_TRANSFER adapters (Udofin PR-UDF-071, R1-D-254, ADR-0014): `sftp`, an SFTP client over `ssh2`
// with pinned host keys, an Ed25519 client key from SECRETS, the India-hosted allow-list and public
// addresses only; off (`int.file_transfer.sftp.enabled`) and unproven until a counterparty's test
// server is used. The fake `FakeFileTransfer` (@infrabyx/fakes) is the CI-green alternative.
export * from "./sftp.js";
