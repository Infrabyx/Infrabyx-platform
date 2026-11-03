---
"@infrabyx/connectors": minor
---

The IDfy KYC adapter on a stub (owner answer #91; R1-plan M25; R1-D-45). `idfy-kyc` provides PAN verification, face match and photo liveness, the methods the Digio reference lacks, over the egress client with no SDK; images are read from STORAGE and checked against their SHA-256 before they leave, and nothing the vendor returns is stored. Its request and result shapes are stub-shaped until the owner's IDfy sandbox exists (`mapIdfyPan`, `mapIdfyScore`), so it stays off behind `int.kyc.idfy.enabled` and `unproven`. `kycMethodRouter` routes each KYC method to the first adapter in its order that provides it (Digio first, IDfy second; Finbyx PR-FBX-24) and moves on only when an adapter is off, unavailable or lacks the method, never on an answer about the customer. `PORT_EXIT` names `idfy-kyc` as KYC's exit target.
