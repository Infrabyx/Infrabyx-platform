---
"@infrabyx/contracts": minor
---

AV port (IPB-01 AV, IPB-02-44; PR-LDC-41): `FileScanPort.scan(ref)` → `CLEAN`, `INFECTED` or `ERROR` with a reason, and `scanDecision`, the fail-closed mapping (only `CLEAN` releases). `AV` is catalogued with an interface.
