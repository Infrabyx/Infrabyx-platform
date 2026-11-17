---
"@infrabyx/connectors": minor
---

The `governed` EGRESS adapter (`@infrabyx/connectors/egress`; IPB-04 §04.4.4, IPB-02-43): https on 443 only, the allow-list, every resolved address public (IANA special-purpose ranges refused), the connection pinned to the checked address, each redirect re-checked (at most 5), one deadline, capped body and decoding, a fixed User-Agent and no cookies; off behind `int.egress.governed.enabled`. `PlatformWebSnapshot` (`@infrabyx/connectors/web-snapshot`; PR-LDC-40, R1-D-176): fetch, store with SHA-256, AV scan and record one public page, with its ledger entry in the same transaction; served only as a download. Migration `connectors/0006` (`connectors.web_snapshot`): run `infrabyx-migrate`.
