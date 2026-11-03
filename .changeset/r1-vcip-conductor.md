---
"@infrabyx/connectors": minor
---

V-CIP through our own VIDEO_MEET room (R1-plan M24; owner answer #90 (b); R1-D-55). `VcipConductor` in `@infrabyx/connectors/kyc` starts the recording in the tenant's room, sends only frames and the document photo to a KYC scorer for liveness and face match, takes the decision only from the session's official, refuses an approval without passed checks, a geo-tag in India and a recording the provider does not keep, and keeps every artefact in the tenant's STORAGE by hash. `MemoryVcipStore` for tests. Off behind the product's `kyc.vcip.enabled`.
