---
"@infrabyx/contracts": minor
---

Web snapshots as evidence (PR-LDC-40, R1-D-176; product guide §7ci). New `WebSnapshotPort` (`archive(ctx, req)`, `get`, `open`, `rescan`), `WebSnapshotRequest`, `WebSnapshot`, `OpenedWebSnapshot`, `WEB_SNAPSHOT_CONTENT_TYPES` (no SVG), `WEB_SNAPSHOT_LIMIT_DEFAULTS` and `_MAXIMA`, `resolveWebSnapshotLimits`, `WEB_SNAPSHOT_MAX_REDIRECTS` and `webSnapshotDownloadHeaders`; the `wsn` id prefix. `EgressPort.fetch` takes the optional `maxRedirects` and `allowHosts` and may answer `finalUrl`, `redirects` and `contentEncoding` (`EgressFetchOptions`, `EgressFetchResult`). Additive.
