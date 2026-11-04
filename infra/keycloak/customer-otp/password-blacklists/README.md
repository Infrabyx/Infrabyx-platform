# Bundled breached-password list (`ipb-common-passwords.txt`)

The list behind Keycloak's `passwordBlacklist` policy (LawDocsComply PR-LDC-04; R1-D-83; the offline list approved by the owner, R1-D-65). The Keycloak customer image copies it to `/opt/keycloak/data/password-blacklists/`, where Keycloak looks lists up by name, and a realm applied with `passwordBlacklist: KEYCLOAK_PASSWORD_BLACKLIST` (`@infrabyx/connectors/identity`) refuses any password on it, compared in lower case. Nothing is fetched at runtime: no k-anonymity range query and no other third-party call.

| Field       | Value                                                                                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source      | SecLists, `Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt` (the most common million of Mark Burnett's ten million password corpus, most frequent first), from `github.com/danielmiessler/SecLists`, branch `master`, retrieved 4 Nov 2026 |
| Licence     | MIT, Copyright (c) 2018 Daniel Miessler; the notice is in `LICENSE.SecLists` beside this file and ships in the image beside the list                                                                                                                              |
| Source file | 1,000,000 lines, SHA-256 `424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51`                                                                                                                                                                       |
| Derivation  | Keep the lines of 12 or more printable ASCII characters (the realm's `length(12)` already refuses anything shorter), lower-case them, drop repeats keeping the first (most frequent) occurrence, and keep the first 10,000                                        |
| This file   | 10,000 lines, 140,276 bytes, SHA-256 `ec8c0a3e04cb76025fbb33469bd8e5b35def58cc913649e548237ffed657a4eb`                                                                                                                                                           |
| Refresh     | Re-run the derivation on a newer source file, update both checksums here and in `infra/docker/keycloak-password-blacklist.test.mjs`, and rebuild the image                                                                                                        |

The derivation, with `LC_ALL=C`:

```sh
awk 'length($0) >= 12 && $0 !~ /[^ -~]/ { p = tolower($0); if (!(p in seen)) { seen[p] = 1; print p; if (++n == 10000) exit } }' \
  xato-net-10-million-passwords-1000000.txt > ipb-common-passwords.txt
```

The file has no header line: Keycloak would read one as a password. The list holds leaked passwords, not credentials of any Infrabyx system.
