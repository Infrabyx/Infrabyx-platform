---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
"@infrabyx/testing": minor
---

PR-FBX-56 (R1-D-292): the IPB-02-44 upload pipeline after the AV scan. `releaseUpload` (`@infrabyx/connectors/upload`) takes the bytes, the declared type and the file's CLEAN scan, checks the route's allow-list, size limit and the bytes' own type, then re-encodes raster images through MEDIA (with `raster.keepOriginalAsEvidence`, the original is the record and a re-encoded viewing copy sits beside it, both hashed), sanitises or rasterises SVG (refused by default), checks PDFs for JavaScript, launch and other active names in the body and inside object streams (refused, or flattened by an injected flattener and checked again), and refuses Office files with macros, ActiveX or as legacy OLE unless the route allows macros; it answers the bytes to store or an `IPB-SEC-010` to `-015` refusal. `contracts` gains `UploadRoute`, `UploadRelease` and the refusal codes; `testing` gains `uploadCorpus` and `uploadCorpusContractCases` (`@IPB-02-AT-16`). Every presigned STORAGE download but `PUBLIC_ASSETS` now signs `Content-Disposition: attachment` (`presignAttachment`).
