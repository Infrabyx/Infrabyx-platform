---
"@infrabyx/connectors": patch
---

Keycloak IDENTITY (CVE-2026-114938, CRITICAL; owner answer #143, R1-D-192): no code change in the adapters. Run the platform's Keycloak customer image as built from this release: its entrypoint turns the HotSpot Base64 intrinsic off (`-XX:-UseBASE64Intrinsics`) on every start and every node, and its build fails without it. On the stock Keycloak image, or with your own entrypoint, make `JAVA_OPTS_APPEND` end with `-XX:-UseBASE64Intrinsics` on every node and check your own scans (product guide §7cp).
