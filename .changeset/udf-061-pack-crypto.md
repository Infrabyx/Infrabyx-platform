---
"@infrabyx/crypto": minor
---

Document JWS descriptor v2 (PR-UDF-061 item 13; R1-D-236): `signDocumentJwsV2` signs the JCS descriptor `{ application_id?, document_id, media_type, sha256, size_bytes, type, version }` on the same C-22 detached-JWS profile (ES256, `kid`), under `typ: ipb-document-v2+jws` (`DOCUMENT_JWS_V2_TYP`, type `DocumentDescriptorV2`). `verifyDocumentJws` now takes both v1 and v2 JWSs, chosen by the signed `typ`, and an optional fifth argument `{ requireV2: true }` that refuses a v1 JWS with `wrong_typ`. A v1 JWS verifies exactly as before; no new primitive, key type or algorithm.
