---
"@infrabyx/connectors": patch
"@infrabyx/testing": patch
---

Remove a promoted file's quarantined copy once the promotion is verified (owner answer #216, R1-D-309, R1-D-310). `writeScanned` now reads the promoted copy back and refuses `IPB-SEC-015` (`promotion_unverified`) unless its SHA-256 equals the scanned one, keeping both copies. `CibilBureau` and `SetuAccountAggregator` take an optional `removal` (`kernel`, `audit`, `context`): the quarantined copy is then deleted and the ledger entry `connectors.scanned_write.quarantine_removed` (reason `promoted_clean_copy_removed`) written in one transaction; a failed delete rolls back and refuses `quarantine_not_removed`. INFECTED and ERROR copies are never deleted. Without `removal` the copy is kept and the adapter warns at start-up outside local and test. `testing`: `quarantineRemovalHarness` and the removal cases in `bureauScannedWriteContractCases` / `aaScannedWriteContractCases`.
