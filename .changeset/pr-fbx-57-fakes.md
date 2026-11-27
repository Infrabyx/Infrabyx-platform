---
"@infrabyx/fakes": patch
---

PR-FBX-57 (R1-D-304): `FakeCreditBureau` and `FakeAccountAggregator` attach a CLEAN scan record (`fakeCleanScan`) to each file they return, as the platform's adapters now do. `FakeFileScan` also reports EICAR in its JSON-string form (`EICAR_IN_JSON`), which is what a connector stores when a vendor's JSON carries the test string.
