Offline verifier for this archive (Apache-2.0).

Run from the archive folder:  node "00 Start Here/verify/verify.mjs"
It checks every file's size and SHA-256, the pack hash, the manifest signature with
export-signing-key.jwk.json, the CSV headers against schemas/, the row counts against the
control totals, and the audit trail hash chain. Exit code 0 means every check passed.
Public key fingerprint (SHA-256 of the JWK in JCS form): 15d7106acc1ed02445f1b2867cc209134a841c62152228da26522c464d620c75
